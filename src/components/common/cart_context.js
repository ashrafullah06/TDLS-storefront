// src/components/common/cart_context.js
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * CART CONTEXT — TDLS/TDLC
 *
 * Hard requirements implemented:
 * 1) Customer-specific scoped persistence (user -> localStorage, guest -> sessionStorage).
 * 2) Same item added from different pages must MERGE (qty increments) using stable identity.
 * 3) Already-added item info must NEVER change when adding from another page/source.
 *    - Incoming payloads may ONLY fill missing/placeholder fields.
 *    - No overwrites of existing “good” display/identity fields.
 * 4) React keys must be stable: lineId/id never changes once created.
 * 5) All lines have consistent display fields (title/productName/name/thumbnail/size/color/fit).
 *
 * Additional fixes in this version:
 * A) Prevent “temporary empty cart” flashes on PDP by hydrating from storage synchronously
 *    (useState initializer) and never letting late async hydration clobber user mutations.
 * B) Prevent cart panel auto-open on /product page load by gating open-panel behind
 *    actual user activation (User Activation API or recent pointer/key gesture).
 * C) Prevent “image lost” regressions by making ALL thumbnail aliases stable and always populated:
 *    - thumbnailUrl, thumb, thumbUrl, image, imageUrl
 *    This protects mixed renderers across pages that may read different fields.
 * D) Prevent “cart is empty” flash on refresh by synchronously hydrating the last-known
 *    authenticated user scope (ONLY when an auth cookie is present), before async session fetch.
 *
 * ✅ NEW (ghosting elimination):
 * E) Prevent self-trigger loops: this provider writes storage then emits "cart:changed".
 *    Previously it also listened to "cart:changed" and re-set state in the same tab, which can
 *    cause flicker/ghosting. We now emit a CustomEvent token and ignore our own event.
 * F) Scope switching is atomic: scopeRef is updated synchronously inside setScopeSafe().
 *
 * ✅ NEW (this patch):
 * G) Eliminate render-churn: do NOT re-stabilize items on every render.
 *    Items are stabilized at write boundaries (mutators/hydration). This prevents continuous
 *    persist/sync loops and UI flicker caused by new object identities each render.
 * H) Auth scope guard: if the auth cookie disappears (logout), immediately fall back to guest scope
 *    and rehydrate guest cart. If auth cookie appears (login) and we have last-known user scope,
 *    promote to user scope and merge guest cart safely.
 */

const STORAGE_KEY_BASE = "tdlc_cart_v1";
const LEGACY_GLOBAL_KEY = STORAGE_KEY_BASE; // backward compatibility
const GUEST_SID_COOKIE = "tdlc_sid"; // server already reads this (and aliases) in cart routes

// Last-known logged-in scope pointer (used only when auth cookie exists)
const LS_LAST_USER_SCOPE_KEY = "tdlc_cart_last_user_scope_v1";

const CartCtx = createContext(null);

/* ---------------- cookie helpers ---------------- */

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const target = `${encodeURIComponent(name)}=`;
  const parts = String(document.cookie || "").split(";");
  for (const p of parts) {
    const s = p.trim();
    if (s.startsWith(target)) {
      return decodeURIComponent(s.slice(target.length));
    }
  }
  return "";
}

function setCookieSession(name, value) {
  if (typeof document === "undefined") return;
  const isHttps =
    typeof location !== "undefined" &&
    String(location.protocol || "").toLowerCase() === "https:";
  const secure = isHttps ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    String(value || "")
  )}; Path=/; SameSite=Lax${secure}`;
}

function getOrCreateGuestSid() {
  const existing =
    readCookie("tdlc_sid") || readCookie("cart_sid") || readCookie("guest_sid");
  if (existing) {
    if (!readCookie(GUEST_SID_COOKIE))
      setCookieSession(GUEST_SID_COOKIE, existing);
    return existing;
  }

  let sid = "";
  try {
    sid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "";
  } catch {}

  if (!sid) {
    sid = `g_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  setCookieSession(GUEST_SID_COOKIE, sid);
  return sid;
}

function hasLikelyAuthCookie() {
  // Heuristic: only preload last user scope if an auth session cookie exists.
  // Supports NextAuth/Auth.js common cookie names.
  if (typeof document === "undefined") return false;
  const c = String(document.cookie || "");
  if (!c) return false;

  const names = [
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
    "authjs.session-token",
    "__Secure-authjs.session-token",
    // sometimes custom
    "session-token",
    "__Secure-session-token",
  ];

  for (const n of names) {
    if (c.includes(`${encodeURIComponent(n)}=`)) return true;
    if (c.includes(`${n}=`)) return true;
  }
  return false;
}

/* ---------------- storage helpers ---------------- */

function scopedKey(scope) {
  return `${STORAGE_KEY_BASE}:${scope}`;
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read cart payload from a specific Storage.
 * Returns meta.hasKey=false if storage key does not exist (getItem returned null).
 * This is critical: missing key MUST NOT be treated as "cart cleared".
 */
function readFromStorageWithMeta(storage, key) {
  try {
    if (!storage) return { items: [], hasKey: false };

    const raw = storage.getItem(key);
    if (raw === null) return { items: [], hasKey: false };
    if (!raw) return { items: [], hasKey: true };

    const parsed = safeParse(raw);
    if (Array.isArray(parsed)) return { items: parsed, hasKey: true };
    if (!parsed || typeof parsed !== "object") return { items: [], hasKey: true };
    if (!Array.isArray(parsed.items)) return { items: [], hasKey: true };
    return { items: parsed.items, hasKey: true };
  } catch {
    return { items: [], hasKey: false };
  }
}

function readFromStorage(storage, key) {
  const r = readFromStorageWithMeta(storage, key);
  return { items: r.items };
}

/**
 * Emit a cart:changed event with a token, so this provider can ignore its own emissions
 * (prevents self-trigger loops that cause ghosting).
 */
function emitCartChanged(detail) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("cart:changed", { detail }));
  } catch {
    try {
      window.dispatchEvent(new Event("cart:changed"));
    } catch {}
  }
}

function writeToStorage(storage, key, data, opts = {}) {
  const { emitEvent = true, eventDetail = null } = opts || {};
  try {
    if (!storage) return;
    const payload = { items: Array.isArray(data?.items) ? data.items : [] };
    storage.setItem(key, JSON.stringify(payload));

    // IMPORTANT: do not spam "cart:changed" on hydration/migration writes.
    if (emitEvent) {
      emitCartChanged(eventDetail || null);
    }
  } catch {
    // ignore
  }
}

function guestStorage() {
  try {
    if (typeof window === "undefined") return null;
    if (window.sessionStorage) return window.sessionStorage;
  } catch {}
  try {
    if (typeof window === "undefined") return null;
    if (window.localStorage) return window.localStorage;
  } catch {}
  return null;
}

function customerStorage() {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/* ---------------- core helpers ---------------- */

function isPlainObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function s(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

function clean(v) {
  return s(v).trim();
}

function isEmptyValue(v) {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && v.trim() === "")
  );
}

function isPlaceholderTitle(v) {
  const x = String(v ?? "").trim().toLowerCase();
  if (!x) return true;
  return x === "item" || x === "product" || x === "untitled product";
}

function normColor(v) {
  const x = clean(v);
  return x ? x.toLowerCase() : "";
}

function normSize(v) {
  const x = clean(v);
  if (!x) return "";
  if (/^[a-z]+$/i.test(x)) return x.toUpperCase();
  return x;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const x = clean(v);
    if (x) return x;
  }
  return "";
}

function firstNonEmptyNonPlaceholderTitle(...vals) {
  for (const v of vals) {
    const x = clean(v);
    if (!x) continue;
    if (isPlaceholderTitle(x)) continue;
    return x;
  }
  return "";
}

function looksLikeLineId(val) {
  const x = clean(val);
  if (!x) return false;
  if (x.includes("|")) return true;
  if (x.startsWith("l:")) return true;
  if (x.startsWith("line_")) return true;
  return false;
}

/* ---------------- image/url helpers (bulletproof) ---------------- */

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isProbablyImageUrl(u) {
  if (!isNonEmptyString(u)) return false;
  const s2 = u.trim();
  if (!s2) return false;
  if (s2 === "[object Object]") return false;
  return (
    s2.startsWith("http://") ||
    s2.startsWith("https://") ||
    s2.startsWith("//") ||
    s2.startsWith("/") ||
    s2.startsWith("data:") ||
    s2.startsWith("blob:")
  );
}

function extractImageUrl(val) {
  if (!val) return "";

  if (typeof val === "string") {
    const t = val.trim();
    return isProbablyImageUrl(t) ? t : "";
  }

  if (Array.isArray(val)) {
    for (const it of val) {
      const u = extractImageUrl(it);
      if (u) return u;
    }
    return "";
  }

  if (!isPlainObject(val)) return "";

  const direct = [
    val.url,
    val.src,
    val.path,
    val.href,
    val.secure_url,
    val.publicUrl,
    val.publicURL,
  ];
  for (const c of direct) {
    const u = extractImageUrl(c);
    if (u) return u;
  }

  const nested = [
    val.image,
    val.thumbnail,
    val.thumb,
    val.asset,
    val.file,
    val.media,
  ];
  for (const n of nested) {
    const u = extractImageUrl(n);
    if (u) return u;
  }

  if (isPlainObject(val.formats)) {
    const f = val.formats;
    const order = ["thumbnail", "small", "medium", "large"];
    for (const k of order) {
      if (f[k]) {
        const u = extractImageUrl(f[k]?.url || f[k]?.src || f[k]);
        if (u) return u;
      }
    }
  }

  if (isPlainObject(val.data)) {
    const u = extractImageUrl(val.data);
    if (u) return u;
  }
  if (isPlainObject(val.attributes)) {
    const a = val.attributes;
    const u =
      extractImageUrl(a.formats) ||
      extractImageUrl(a.url) ||
      extractImageUrl(a.src);
    if (u) return u;
  }

  return "";
}

function pickImageUrl(...candidates) {
  for (const c of candidates) {
    const u = extractImageUrl(c);
    if (u) return u;
  }
  return "";
}

/* ---------------- identity derivation ---------------- */

function deriveIdentity(x = {}) {
  const m = isPlainObject(x.metadata) ? x.metadata : {};
  const p = isPlainObject(x.product) ? x.product : {};
  const v = isPlainObject(x.variant) ? x.variant : {};

  const productId = firstNonEmpty(
    x.productId,
    x.product_id,
    x.pid,
    x.productID,
    x.__originalId,
    m.productId,
    m.product_id,
    m.pid,
    p.id,
    p.productId,
    !looksLikeLineId(x.id) ? x.id : ""
  );

  const slug = firstNonEmpty(
    x.slug,
    x.productSlug,
    m.productSlug,
    m.slug,
    p.slug
  );

  const variantId = firstNonEmpty(
    x.variantId,
    x.variant_id,
    x.vid,
    x.variantID,
    m.variantId,
    m.variant_id,
    m.vid,
    v.id
  );

  const strapiSizeId = firstNonEmpty(
    x.strapiSizeId,
    x.strapi_size_id,
    x.sizeStockId,
    x.size_stock_id,
    x.sizeId,
    x.size_id,
    m.strapiSizeId,
    m.strapi_size_id,
    m.sizeStockId,
    m.size_stock_id,
    m.sizeId,
    m.size_id
  );

  const selectedSize = normSize(
    firstNonEmpty(
      x.selectedSize,
      x.size,
      x.size_name,
      x.sizeLabel,
      m.selectedSize,
      m.size,
      m.size_name,
      m.sizeLabel,
      v.selectedSize
    )
  );

  const selectedColor = normColor(
    firstNonEmpty(
      x.selectedColor,
      x.color,
      x.colour,
      x.color_name,
      m.selectedColor,
      m.color,
      m.colour,
      m.color_name,
      v.selectedColor
    )
  );

  return {
    productId,
    slug,
    variantId,
    strapiSizeId,
    selectedSize,
    selectedColor,
  };
}

function makeKeyLooseFromIdentity(id) {
  return [
    id.productId || id.slug || "",
    id.variantId || "",
    id.selectedColor || "",
    id.selectedSize || "",
  ].join("|");
}

function makeKeyStrictFromIdentity(id) {
  return [
    id.productId || id.slug || "",
    id.variantId || "",
    id.selectedColor || "",
    id.selectedSize || "",
    id.strapiSizeId || "",
  ].join("|");
}

function getOrCreateIdentityKeys(line) {
  const m = isPlainObject(line?.metadata) ? line.metadata : {};
  const existingLoose = clean(
    line?.identityKeyLoose || m.identityKeyLoose || m.cartKeyLoose
  );
  const existingStrict = clean(
    line?.identityKeyStrict || m.identityKeyStrict || m.cartKeyStrict
  );

  if (existingLoose || existingStrict) {
    return {
      identityKeyLoose: existingLoose || "",
      identityKeyStrict: existingStrict || "",
    };
  }

  const id = deriveIdentity(line || {});
  return {
    identityKeyLoose: makeKeyLooseFromIdentity(id),
    identityKeyStrict: makeKeyStrictFromIdentity(id),
  };
}

function findLineIndex(lines, item) {
  const incomingId = deriveIdentity(item || {});
  const incLoose = makeKeyLooseFromIdentity(incomingId);
  const incStrict = makeKeyStrictFromIdentity(incomingId);

  let idx = lines.findIndex((l) => {
    const keys = getOrCreateIdentityKeys(l);
    return (
      (keys.identityKeyStrict && keys.identityKeyStrict === incStrict) ||
      (keys.identityKeyLoose && keys.identityKeyLoose === incLoose)
    );
  });
  if (idx >= 0) return idx;

  idx = lines.findIndex((l) => {
    const lid = deriveIdentity(l || {});
    return (
      makeKeyStrictFromIdentity(lid) === incStrict ||
      makeKeyLooseFromIdentity(lid) === incLoose
    );
  });

  return idx;
}

function makeVariantKey(x = {}) {
  const id = deriveIdentity(x);

  if (id.strapiSizeId) return `ss:${id.strapiSizeId}`;

  const prismaVar = firstNonEmpty(x.variantPrismaId, x.prisma_id, x.pid);
  if (prismaVar || id.variantId) {
    return [
      "v",
      prismaVar || "",
      id.variantId || "",
      id.productId || id.slug || "",
      id.selectedColor || "",
      id.selectedSize || "",
    ].join("|");
  }
  return [
    "p",
    id.productId || id.slug || "",
    id.selectedColor || "",
    id.selectedSize || "",
  ].join("|");
}

/* ---------------- numeric + stock helpers ---------------- */

function numOrNull(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function collectStockCandidatesFromItem(it, out) {
  if (!it || typeof it !== "object") return;

  const directFields = [
    "maxAvailable",
    "max_available",
    "stock",
    "stock_total",
    "stockTotal",
    "inventory",
    "inventoryQty",
    "inventory_qty",
    "availableQty",
    "available_qty",
    "stockAvailable",
    "stock_available",
    "stock_quantity",
    "stockQuantity",
    "strapiStockQty",
    "strapi_stock_qty",
  ];

  for (const f of directFields) {
    const v = numOrNull(it[f]);
    if (v != null && v > 0) out.push(v);
  }

  const sizeObjs = [];
  if (it.sizeStock && typeof it.sizeStock === "object") sizeObjs.push(it.sizeStock);
  if (it.size_stock && typeof it.size_stock === "object") sizeObjs.push(it.size_stock);

  for (const sz of sizeObjs) {
    const v =
      numOrNull(
        sz.stock_quantity ??
          sz.stock ??
          sz.inventory ??
          sz.available_qty ??
          sz.available ??
          sz.qty ??
          null
      ) ?? null;
    if (v != null && v > 0) out.push(v);
  }

  const meta = it.metadata;
  if (meta && typeof meta === "object") {
    const mv =
      numOrNull(
        meta.stock_quantity ??
          meta.stock ??
          meta.inventory ??
          meta.availableQty ??
          meta.available_qty ??
          null
      ) ?? null;
    if (mv != null && mv > 0) out.push(mv);
  }

  const variant = it.variant;
  if (variant && typeof variant === "object") {
    const vv =
      numOrNull(
        variant.stock_quantity ??
          variant.stock ??
          variant.inventory ??
          variant.stock_total ??
          null
      ) ?? null;
    if (vv != null && vv > 0) out.push(vv);
  }
}

function effectiveMaxAvailable(existing, incoming) {
  const candidates = [];
  collectStockCandidatesFromItem(existing, candidates);
  collectStockCandidatesFromItem(incoming, candidates);
  const positives = candidates.filter((v) => Number.isFinite(v) && v > 0);
  if (!positives.length) return null;
  return Math.max(...positives);
}

/* ---------------- merge rules ---------------- */

const IMAGE_FIELDS = new Set([
  "thumbnail",
  "thumbnailUrl",
  "thumb",
  "thumbUrl",
  "image",
  "imageUrl",
]);

const STABLE_FIELDS = new Set([
  // identity
  "productId",
  "slug",
  "variantId",
  "strapiSizeId",
  "selectedSize",
  "selectedColor",
  "size",
  "color",

  // display
  "title",
  "productName",
  "name",
  "thumbnail",
  "thumbnailUrl",
  "thumb",
  "thumbUrl",
  "image",
  "imageUrl",

  "variantTitle",
  "fit",

  // identifiers
  "sku",
  "barcode",
  "ean",
  "ean13",

  // pricing
  "price",
  "unitPrice",
  "originalUnitPrice",
  "compareAtPrice",
  "mrp",

  // identity keys must be sticky
  "identityKeyLoose",
  "identityKeyStrict",

  // line id must be sticky
  "lineId",
  "id",
]);

function isEffectivelyEmptyForField(field, value) {
  if (IMAGE_FIELDS.has(field)) {
    const u = extractImageUrl(value);
    return !u;
  }

  if (value === undefined || value === null) return true;
  if (typeof value === "string" && value.trim() === "") return true;

  if (
    (field === "title" ||
      field === "productName" ||
      field === "name" ||
      field === "variantTitle") &&
    isPlaceholderTitle(value)
  )
    return true;

  return false;
}

function normalizeFieldValueForMerge(field, value) {
  if (IMAGE_FIELDS.has(field)) {
    const u = extractImageUrl(value);
    return u || "";
  }
  return value;
}

function mergeMetadataPreserveStable(prevMeta, incMeta) {
  const out = { ...(isPlainObject(prevMeta) ? prevMeta : {}) };
  const inc = isPlainObject(incMeta) ? incMeta : {};

  for (const k of Object.keys(inc)) {
    let incV = inc[k];
    const prevV = out[k];

    incV = normalizeFieldValueForMerge(k, incV);

    const isTitleLike =
      k === "title" ||
      k === "productName" ||
      k === "name" ||
      k === "variantTitle";

    if (
      isTitleLike &&
      !isEffectivelyEmptyForField(k, prevV) &&
      isEffectivelyEmptyForField(k, incV)
    ) {
      continue;
    }

    if (isEffectivelyEmptyForField(k, incV)) continue;

    if (
      !isEffectivelyEmptyForField(k, prevV) &&
      (k === "productId" ||
        k === "productSlug" ||
        k === "variantId" ||
        k === "selectedSize" ||
        k === "selectedColor" ||
        k === "size" ||
        k === "color" ||
        k === "thumbnail" ||
        k === "thumbnailUrl" ||
        k === "thumb" ||
        k === "thumbUrl" ||
        k === "image" ||
        k === "imageUrl" ||
        k === "identityKeyLoose" ||
        k === "identityKeyStrict" ||
        k === "clientLineId")
    ) {
      continue;
    }

    if (isPlainObject(prevV) && isPlainObject(incV)) {
      out[k] = mergeMetadataPreserveStable(prevV, incV);
      continue;
    }

    if (Array.isArray(incV)) {
      if (incV.length) out[k] = incV;
      continue;
    }

    out[k] = incV;
  }

  return out;
}

function mergePreserveStable(prev, incoming) {
  if (!prev) return incoming || {};
  if (!incoming) return prev || {};

  const out = { ...prev };

  for (const k of Object.keys(incoming)) {
    let incV = incoming[k];
    const prevV = prev[k];

    incV = normalizeFieldValueForMerge(k, incV);

    if (isEffectivelyEmptyForField(k, incV)) continue;

    if (k === "metadata" && isPlainObject(prevV) && isPlainObject(incV)) {
      out[k] = mergeMetadataPreserveStable(prevV, incV);
      continue;
    }

    if (STABLE_FIELDS.has(k)) {
      if (!isEffectivelyEmptyForField(k, prevV)) continue;
      out[k] = incV;
      continue;
    }

    if (isPlainObject(prevV) && isPlainObject(incV)) {
      out[k] = mergePreserveStable(prevV, incV);
      continue;
    }

    if (Array.isArray(incV)) {
      if (incV.length) out[k] = incV;
      continue;
    }

    out[k] = incV;
  }

  return out;
}

/* ---------------- display + line stabilization ---------------- */

function backfillDisplayFields(line) {
  if (!line || typeof line !== "object") return line;

  const m = isPlainObject(line.metadata) ? line.metadata : {};
  const p = isPlainObject(line.product) ? line.product : {};
  const v = isPlainObject(line.variant) ? line.variant : {};

  const id = deriveIdentity({ ...line, metadata: m, product: p, variant: v });

  const bestTitle = firstNonEmptyNonPlaceholderTitle(
    line.title,
    line.productName,
    line.name,
    m.productName,
    m.title,
    m.name,
    p.name,
    p.title,
    v.title,
    v.name
  );

  const fit = firstNonEmpty(
    line.fit,
    line.fitName,
    m.fit,
    m.fitName,
    v.fit,
    v.fitName,
    p.fit,
    p.fitName
  );

  const bestThumb = pickImageUrl(
    line.thumbnail,
    line.thumbnailUrl,
    line.thumbUrl,
    line.thumb,
    line.image,
    line.imageUrl,
    line.images,
    m.thumbnail,
    m.thumbnailUrl,
    m.thumbUrl,
    m.thumb,
    m.image,
    m.imageUrl,
    m.images,
    p.thumbnail,
    p.image,
    p.images,
    v.thumbnail,
    v.image,
    v.images
  );

  const stableTitle = !isEffectivelyEmptyForField("title", line.title)
    ? clean(line.title)
    : bestTitle
    ? bestTitle
    : "Untitled product";

  const stableProductName = !isEffectivelyEmptyForField(
    "productName",
    line.productName
  )
    ? clean(line.productName)
    : stableTitle;

  const stableName = !isEffectivelyEmptyForField("name", line.name)
    ? clean(line.name)
    : stableTitle;

  const existingThumb = pickImageUrl(
    line.thumbnail,
    line.thumbnailUrl,
    line.thumbUrl,
    line.thumb,
    line.image,
    line.imageUrl
  );

  const patched = {
    ...line,

    productId: !isEmptyValue(line.productId) ? line.productId : id.productId || null,
    slug: !isEmptyValue(line.slug) ? line.slug : id.slug || null,
    variantId: !isEmptyValue(line.variantId) ? line.variantId : id.variantId || null,
    strapiSizeId: !isEmptyValue(line.strapiSizeId)
      ? line.strapiSizeId
      : id.strapiSizeId || null,

    selectedSize: !isEmptyValue(line.selectedSize)
      ? line.selectedSize
      : id.selectedSize || null,
    selectedColor: !isEmptyValue(line.selectedColor)
      ? line.selectedColor
      : id.selectedColor || null,

    size: !isEmptyValue(line.size)
      ? line.size
      : firstNonEmpty(id.selectedSize, m.size, m.selectedSize),
    color: !isEmptyValue(line.color)
      ? line.color
      : firstNonEmpty(id.selectedColor, m.color, m.selectedColor),

    fit: !isEmptyValue(line.fit) ? line.fit : fit || null,

    title: stableTitle,
    productName: stableProductName,
    name: stableName,

    variantTitle: !isEffectivelyEmptyForField("variantTitle", line.variantTitle)
      ? clean(line.variantTitle)
      : firstNonEmptyNonPlaceholderTitle(
          (line.variant && (line.variant.title || line.variant.name)) || "",
          m.variantTitle,
          m.variant_name
        ) || null,

    thumbnail: existingThumb || bestThumb || null,
  };

  const finalThumb = pickImageUrl(
    patched.thumbnail,
    patched.thumbnailUrl,
    patched.thumbUrl,
    patched.thumb,
    patched.image,
    patched.imageUrl,
    bestThumb
  );

  if (finalThumb) {
    patched.thumbnail = finalThumb;
    if (isEffectivelyEmptyForField("thumbnailUrl", patched.thumbnailUrl))
      patched.thumbnailUrl = finalThumb;
    if (isEffectivelyEmptyForField("thumbUrl", patched.thumbUrl)) patched.thumbUrl = finalThumb;
    if (isEffectivelyEmptyForField("thumb", patched.thumb)) patched.thumb = finalThumb;
    if (isEffectivelyEmptyForField("image", patched.image)) patched.image = finalThumb;
    if (isEffectivelyEmptyForField("imageUrl", patched.imageUrl)) patched.imageUrl = finalThumb;
  } else {
    patched.thumbnail = null;
    if (patched.thumbnailUrl === "[object Object]") patched.thumbnailUrl = null;
    if (patched.thumbUrl === "[object Object]") patched.thumbUrl = null;
    if (patched.thumb === "[object Object]") patched.thumb = null;
    if (patched.image === "[object Object]") patched.image = null;
    if (patched.imageUrl === "[object Object]") patched.imageUrl = null;
  }

  const q = Number(patched.quantity || patched.qty || 1) || 1;
  patched.quantity = Math.max(1, q);

  const keys = getOrCreateIdentityKeys(patched);
  if (isEffectivelyEmptyForField("identityKeyLoose", patched.identityKeyLoose))
    patched.identityKeyLoose = keys.identityKeyLoose;
  if (isEffectivelyEmptyForField("identityKeyStrict", patched.identityKeyStrict))
    patched.identityKeyStrict = keys.identityKeyStrict;

  const nextMeta = mergeMetadataPreserveStable(
    {
      productId: patched.productId,
      productSlug: patched.slug,
      variantId: patched.variantId,
      selectedSize: patched.selectedSize,
      selectedColor: patched.selectedColor,
      size: patched.size,
      color: patched.color,
      fit: patched.fit,

      title: patched.title,
      productName: patched.productName,
      name: patched.name,
      variantTitle: patched.variantTitle,

      thumbnail: patched.thumbnail,
      thumbnailUrl: patched.thumbnailUrl || patched.thumbnail,
      thumb: patched.thumb || patched.thumbnail,
      thumbUrl: patched.thumbUrl || patched.thumbnail,
      image: patched.image || patched.thumbnail,
      imageUrl: patched.imageUrl || patched.thumbnail,

      identityKeyLoose: patched.identityKeyLoose,
      identityKeyStrict: patched.identityKeyStrict,
    },
    m
  );

  patched.metadata = nextMeta;

  return patched;
}

function ensureLineIdAndUniqueId(line) {
  const patched = backfillDisplayFields(line);

  const m = isPlainObject(patched.metadata) ? patched.metadata : {};

  const existingLineId = firstNonEmpty(
    patched.lineId,
    m.clientLineId,
    looksLikeLineId(patched.id) ? patched.id : ""
  );

  const keys = getOrCreateIdentityKeys(patched);
  const identityLoose = firstNonEmpty(
    patched.identityKeyLoose,
    m.identityKeyLoose,
    m.cartKeyLoose,
    keys.identityKeyLoose
  );

  const generated =
    identityLoose && identityLoose !== "|||"
      ? `l:${identityLoose}`
      : `line_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const lineId = existingLineId || generated;

  const out = {
    ...patched,
    lineId,
    id: lineId,
    identityKeyLoose: identityLoose || "",
    identityKeyStrict: firstNonEmpty(
      patched.identityKeyStrict,
      m.identityKeyStrict,
      m.cartKeyStrict,
      keys.identityKeyStrict
    ),
  };

  if (!isEmptyValue(patched.__originalId)) {
    out.__originalId = patched.__originalId;
  } else if (
    !isEmptyValue(line?.id) &&
    !looksLikeLineId(line.id) &&
    String(line.id) !== String(lineId)
  ) {
    out.__originalId = line.id;
  }

  const best = pickImageUrl(
    out.thumbnail,
    out.thumbnailUrl,
    out.thumbUrl,
    out.thumb,
    out.image,
    out.imageUrl,
    out.images,
    out.metadata &&
      (out.metadata.thumbnail ||
        out.metadata.thumbnailUrl ||
        out.metadata.thumbUrl ||
        out.metadata.thumb ||
        out.metadata.image ||
        out.metadata.imageUrl ||
        out.metadata.images)
  );

  if (best) {
    out.thumbnail = best;
    if (isEffectivelyEmptyForField("thumbnailUrl", out.thumbnailUrl)) out.thumbnailUrl = best;
    if (isEffectivelyEmptyForField("thumbUrl", out.thumbUrl)) out.thumbUrl = best;
    if (isEffectivelyEmptyForField("thumb", out.thumb)) out.thumb = best;
    if (isEffectivelyEmptyForField("image", out.image)) out.image = best;
    if (isEffectivelyEmptyForField("imageUrl", out.imageUrl)) out.imageUrl = best;
  }

  out.metadata = mergeMetadataPreserveStable(
    { ...(isPlainObject(out.metadata) ? out.metadata : {}), clientLineId: lineId },
    {}
  );

  return out;
}

function stabilizeLines(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  const normalized = arr.map((l) => ensureLineIdAndUniqueId(l));

  const byKey = new Map();

  for (const line of normalized) {
    const keys = getOrCreateIdentityKeys(line);
    const k = firstNonEmpty(keys.identityKeyStrict, keys.identityKeyLoose, line.lineId);

    if (!byKey.has(k)) {
      byKey.set(k, line);
      continue;
    }

    const prev = byKey.get(k);
    const prevQty = Number(prev.quantity || 1) || 1;
    const addQty = Number(line.quantity || 1) || 1;

    const cap = effectiveMaxAvailable(prev, line);
    let nextQty = prevQty + addQty;
    if (cap != null) nextQty = Math.min(nextQty, cap);

    const merged = ensureLineIdAndUniqueId(mergePreserveStable(prev, line));

    byKey.set(
      k,
      ensureLineIdAndUniqueId({
        ...merged,
        quantity: Math.max(1, nextQty),
        maxAvailable: cap ?? merged.maxAvailable ?? null,
        stock: cap ?? merged.stock ?? null,
      })
    );
  }

  return Array.from(byKey.values());
}

/**
 * Server reconciliation:
 * - Never drop local-only lines.
 * - Never overwrite stable identity/display fields already set.
 * - Allow server to update non-stable fields (e.g., quantity/price) when provided.
 */
function reconcileServerWithLocal(localLines, serverLines) {
  const local = Array.isArray(localLines) ? localLines : [];
  const server = Array.isArray(serverLines) ? serverLines : [];

  if (!server.length && local.length) return stabilizeLines(local);

  const localByKey = new Map();
  for (const l of local) {
    const ll = ensureLineIdAndUniqueId(l);
    const keys = getOrCreateIdentityKeys(ll);
    const k = firstNonEmpty(keys.identityKeyStrict, keys.identityKeyLoose, ll.lineId);
    localByKey.set(k, ll);
  }

  const out = [];
  const seen = new Set();

  for (const sLine of server) {
    const ss = ensureLineIdAndUniqueId(sLine);
    const skeys = getOrCreateIdentityKeys(ss);
    const k = firstNonEmpty(skeys.identityKeyStrict, skeys.identityKeyLoose, ss.lineId);

    const l = localByKey.get(k);

    const merged = l ? ensureLineIdAndUniqueId(mergePreserveStable(l, ss)) : ss;

    out.push(merged);
    seen.add(k);
  }

  for (const l of local) {
    const ll = ensureLineIdAndUniqueId(l);
    const keys = getOrCreateIdentityKeys(ll);
    const k = firstNonEmpty(keys.identityKeyStrict, keys.identityKeyLoose, ll.lineId);
    if (seen.has(k)) continue;
    out.push(ll);
  }

  return stabilizeLines(out);
}

/* ---------------- early merge helper (static, used in initializer) ---------------- */

function mergeLinesAdditiveStatic(baseLines, incomingLines) {
  const base = stabilizeLines(baseLines);
  const inc = stabilizeLines(incomingLines);
  if (!inc.length) return base;

  const next = [...base];

  for (const line of inc) {
    if (!line) continue;

    const idx = findLineIndex(next, line);
    if (idx >= 0) {
      const prevLine = next[idx];
      const prevQty = Number(prevLine.quantity || 1) || 1;
      const addQty = Number(line.quantity || 1) || 1;

      const cap = effectiveMaxAvailable(prevLine, line);
      let nextQty = prevQty + addQty;
      if (cap != null) nextQty = Math.min(nextQty, cap);

      const merged = ensureLineIdAndUniqueId(
        mergePreserveStable(prevLine, ensureLineIdAndUniqueId(line))
      );

      next[idx] = ensureLineIdAndUniqueId({
        ...merged,
        maxAvailable: cap ?? merged.maxAvailable ?? null,
        stock: cap ?? merged.stock ?? null,
        quantity: Math.max(1, nextQty || 1),
      });
    } else {
      next.push(ensureLineIdAndUniqueId(line));
    }
  }

  return stabilizeLines(next);
}

/* ---------------- sync normalization ---------------- */

function normalizeLineForSync(it = {}) {
  if (!it || typeof it !== "object") return null;

  const line = ensureLineIdAndUniqueId(it);

  const quantity = Number(line.quantity || line.qty || 1) || 1;
  const price = Number(line.price || line.unitPrice || 0) || 0;

  const id = deriveIdentity(line);

  const fabric =
    line.fabric ??
    line.fabricName ??
    (line.variant && (line.variant.fabric || line.variant.fabricName)) ??
    (line.product && (line.product.fabric || line.product.fabricName)) ??
    (line.metadata && (line.metadata.fabric || line.metadata.fabricName)) ??
    null;

  const gsm =
    line.gsm ??
    line.gsmValue ??
    (line.variant && (line.variant.gsm || line.variant.gsmValue)) ??
    (line.product && (line.product.gsm || line.product.gsmValue)) ??
    (line.metadata && (line.metadata.gsm || line.metadata.gsmValue)) ??
    null;

  const fit =
    line.fit ??
    line.fitName ??
    (line.variant && (line.variant.fit || line.variant.fitName)) ??
    (line.product && (line.product.fit || line.product.fitName)) ??
    (line.metadata && (line.metadata.fit || line.metadata.fitName)) ??
    null;

  const sku =
    line.sku ??
    (line.variant &&
      (line.variant.sku || line.variant.skuCode || line.variant.sku_code)) ??
    (line.product &&
      (line.product.sku || line.product.skuCode || line.product.sku_code)) ??
    (line.metadata &&
      (line.metadata.sku || line.metadata.skuCode || line.metadata.sku_code)) ??
    null;

  const barcode =
    line.barcode ??
    line.bar_code ??
    line.ean13 ??
    line.ean ??
    (line.variant &&
      (line.variant.barcode ||
        line.variant.barCode ||
        line.variant.ean13 ||
        line.variant.ean ||
        line.variant.barcodeEan13 ||
        line.variant.barcode_ean13)) ??
    (line.product &&
      (line.product.barcode ||
        line.product.barCode ||
        line.product.ean13 ||
        line.product.ean ||
        line.product.barcodeEan13 ||
        line.product.barcode_ean13)) ??
    (line.metadata &&
      (line.metadata.barcode ||
        line.metadata.barCode ||
        line.metadata.ean13 ||
        line.metadata.ean)) ??
    null;

  const originalUnitPrice =
    line.originalUnitPrice ??
    line.compareAtPrice ??
    line.mrp ??
    (line.metadata &&
      (line.metadata.originalUnitPrice ||
        line.metadata.compareAt ||
        line.metadata.mrp)) ??
    null;

  const thumbnail = pickImageUrl(
    line.thumbnail,
    line.thumbnailUrl,
    line.thumbUrl,
    line.thumb,
    line.image,
    line.imageUrl,
    line.images,
    line.metadata &&
      (line.metadata.thumbnail ||
        line.metadata.thumbnailUrl ||
        line.metadata.thumbUrl ||
        line.metadata.thumb ||
        line.metadata.image ||
        line.metadata.imageUrl ||
        line.metadata.images)
  );

  const productName =
    firstNonEmptyNonPlaceholderTitle(
      line.productName,
      line.title,
      line.name,
      line.metadata &&
        (line.metadata.productName || line.metadata.title || line.metadata.name)
    ) || null;

  const title =
    productName ||
    (isPlaceholderTitle(line.title) ? null : clean(line.title)) ||
    null;

  const variantTitle =
    firstNonEmptyNonPlaceholderTitle(
      line.variantTitle,
      line.variant && (line.variant.title || line.variant.name),
      line.metadata && line.metadata.variantTitle
    ) || null;

  const metadata = mergeMetadataPreserveStable(
    {
      productId: id.productId || null,
      pid: id.productId || null,
      productSlug: id.slug || null,
      slug: id.slug || null,
      variantId: id.variantId || null,
      vid: id.variantId || null,

      size: id.selectedSize || null,
      size_name: id.selectedSize || null,
      selectedSize: id.selectedSize || null,

      color: id.selectedColor || null,
      colour: id.selectedColor || null,
      color_name: id.selectedColor || null,
      selectedColor: id.selectedColor || null,

      fabric,
      fabricName: fabric,
      gsm,
      gsmValue: gsm,
      fit,
      fitName: fit,

      sku,
      skuCode: sku,
      barcode,
      barCode: barcode,
      ean: line.ean ?? null,
      ean13: line.ean13 ?? null,

      originalUnitPrice,

      title,
      productName,
      name: productName,
      variantTitle,

      thumbnail: thumbnail || null,
      thumbnailUrl: thumbnail || null,
      thumb: thumbnail || null,
      thumbUrl: thumbnail || null,
      image: thumbnail || null,
      imageUrl: thumbnail || null,

      clientLineId: line.lineId,
      identityKeyLoose: line.identityKeyLoose || null,
      identityKeyStrict: line.identityKeyStrict || null,
    },
    isPlainObject(line.metadata) ? line.metadata : {}
  );

  return {
    productId: id.productId ? String(id.productId) : null,
    slug: id.slug || null,
    variantId: id.variantId ? String(id.variantId) : null,

    selectedColor: id.selectedColor || null,
    selectedSize: id.selectedSize || null,

    strapiSizeId: id.strapiSizeId ? String(id.strapiSizeId) : null,

    quantity: Math.max(1, quantity),
    price,
    currency: (line.currency || "BDT").toUpperCase(),

    stock_quantity: line.stock_quantity ?? line.stockQuantity ?? null,
    sizeStock: line.sizeStock ?? line.size_stock ?? null,
    maxAvailable: line.maxAvailable ?? null,
    stock: line.stock ?? null,
    strapiStockQty: line.strapiStockQty ?? line.strapi_stock_qty ?? null,

    metadata,
  };
}

/* ---------------- provider ---------------- */

export function CartProvider({ children }) {
  const [ready, setReady] = useState(() =>
    typeof window !== "undefined" ? true : false
  );

  const mutatedSinceMountRef = useRef(false);
  const lastUserGestureRef = useRef(0);
  const didInitialPersistRef = useRef(false);
  const selfEventTokenRef = useRef("");

  const [{ scope: initialScope, items: initialItems }] = useState(() => {
    if (typeof window === "undefined") return { scope: "g:boot", items: [] };

    const guestSid = getOrCreateGuestSid();
    const guestScope = `g:${guestSid}`;

    const gStore = guestStorage();
    const gRead = readFromStorageWithMeta(gStore, scopedKey(guestScope));
    const guestItems = stabilizeLines(gRead.items || []);

    let chosenScope = guestScope;
    let mergedItems = guestItems;

    try {
      const authCookiePresent = hasLikelyAuthCookie();
      if (authCookiePresent) {
        const lastUserScope = clean(
          customerStorage()?.getItem(LS_LAST_USER_SCOPE_KEY) || ""
        );
        if (lastUserScope && lastUserScope.startsWith("u:")) {
          const uStore = customerStorage();
          const uRead = readFromStorageWithMeta(uStore, scopedKey(lastUserScope));
          const userItems = stabilizeLines(uRead.items || []);

          if (userItems.length) {
            chosenScope = lastUserScope;
            mergedItems = mergeLinesAdditiveStatic(userItems, guestItems);
          }
        }
      }
    } catch {}

    return { scope: chosenScope, items: mergedItems };
  });

  const [scope, setScope] = useState(initialScope || "g:boot");
  const scopeRef = useRef(scope);

  const setScopeSafe = useCallback((nextOrFn) => {
    setScope((prev) => {
      const next = typeof nextOrFn === "function" ? nextOrFn(prev) : nextOrFn;
      scopeRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const [items, setItems] = useState(() => stabilizeLines(initialItems || []));

  /**
   * ✅ IMPORTANT:
   * Do NOT call stabilizeLines() here again.
   * items state is stabilized at every mutation/hydration boundary.
   * Re-stabilizing per-render creates new object identities and can cause
   * repeated persist/sync activity (ghosting/flicker).
   */
  const stabilizedItems = useMemo(() => items || [], [items]);

  const saveTimer = useRef(null);
  const syncTimer = useRef(null);
  const lastSyncPayloadRef = useRef("");

  // Gesture capture
  useEffect(() => {
    if (typeof window === "undefined") return;

    const mark = () => {
      try {
        lastUserGestureRef.current =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();
      } catch {
        lastUserGestureRef.current = Date.now();
      }
    };

    window.addEventListener("pointerdown", mark, { capture: true, passive: true });
    window.addEventListener("keydown", mark, { capture: true });
    window.addEventListener("touchstart", mark, { capture: true, passive: true });

    return () => {
      window.removeEventListener("pointerdown", mark, { capture: true });
      window.removeEventListener("keydown", mark, { capture: true });
      window.removeEventListener("touchstart", mark, { capture: true });
    };
  }, []);

  function isLikelyUserActivation() {
    try {
      if (typeof navigator !== "undefined" && navigator.userActivation) {
        if (navigator.userActivation.isActive) return true;
      }
    } catch {}

    const last = Number(lastUserGestureRef.current || 0) || 0;
    if (last <= 0) return false;

    try {
      const now =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      return now - last <= 1500;
    } catch {
      return false;
    }
  }

  function mergeLinesAdditive(baseLines, incomingLines) {
    return mergeLinesAdditiveStatic(baseLines, incomingLines);
  }

  /**
   * ✅ Auth scope guard:
   * - If auth cookie disappears while scope is u:*, immediately fall back to guest scope
   *   and hydrate guest cart.
   * - If auth cookie appears while scope is g:* and lastUserScope exists, promote to that
   *   user scope and safely merge guest cart.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const computeGuestScope = () => {
      const guestSid = getOrCreateGuestSid();
      return `g:${guestSid}`;
    };

    const guard = () => {
      const sc = scopeRef.current || "";
      const auth = hasLikelyAuthCookie();

      // Logged out while still in user scope → immediately fall back to guest
      if (sc.startsWith("u:") && !auth) {
        const gScope = computeGuestScope();
        setScopeSafe(gScope);

        const gStore = guestStorage();
        const gMeta = readFromStorageWithMeta(gStore, scopedKey(gScope));

        setItems(() => stabilizeLines(gMeta.hasKey ? gMeta.items || [] : []));

        try {
          customerStorage()?.removeItem(LS_LAST_USER_SCOPE_KEY);
        } catch {}

        lastSyncPayloadRef.current = "";
        return;
      }

      // Logged in while in guest scope and we have last-known user scope → promote & merge
      if (sc.startsWith("g:") && auth) {
        const lastUserScope = clean(
          customerStorage()?.getItem(LS_LAST_USER_SCOPE_KEY) || ""
        );
        if (!lastUserScope || !lastUserScope.startsWith("u:")) return;

        const gScope = sc || computeGuestScope();
        const gStore = guestStorage();
        const uStore = customerStorage();

        const gLines = readFromStorageWithMeta(gStore, scopedKey(gScope)).items || [];
        const uLines = readFromStorageWithMeta(uStore, scopedKey(lastUserScope)).items || [];

        // Promote scope first (atomic), then merge safely
        setScopeSafe(lastUserScope);

        setItems((prev) => {
          const prevStable = stabilizeLines(prev || []);
          const mergedUser = mergeLinesAdditive(uLines, gLines);
          const merged = mergeLinesAdditive(mergedUser, prevStable);
          return stabilizeLines(merged);
        });

        // Persist merged into user scope (silent)
        const mergedNow = mergeLinesAdditive(uLines, gLines);
        writeToStorage(uStore, scopedKey(lastUserScope), { items: mergedNow }, { emitEvent: false });

        // Clear guest scope (best-effort)
        try {
          gStore?.removeItem(scopedKey(gScope));
        } catch {}

        lastSyncPayloadRef.current = "";
      }
    };

    // Run once immediately
    guard();

    const onVis = () => {
      if (document.visibilityState === "visible") guard();
    };

    window.addEventListener("focus", guard);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("tdls:auth-changed", guard);

    return () => {
      window.removeEventListener("focus", guard);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("tdls:auth-changed", guard);
    };
  }, [setScopeSafe]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    (async () => {
      const guestSid = getOrCreateGuestSid();
      const guestScope = `g:${guestSid}`;

      if (!cancelled) {
        setScopeSafe((prev) => (prev && prev.startsWith("u:") ? prev : guestScope));
      }

      const gStore = guestStorage();
      const gKey = scopedKey(guestScope);
      const gRead = readFromStorageWithMeta(gStore, gKey);

      if ((!gRead.items || !gRead.items.length) && typeof window !== "undefined") {
        const legacy = readFromStorage(customerStorage(), LEGACY_GLOBAL_KEY);
        if (Array.isArray(legacy.items) && legacy.items.length) {
          writeToStorage(gStore, gKey, { items: legacy.items }, { emitEvent: false });
          try {
            customerStorage()?.removeItem(LEGACY_GLOBAL_KEY);
          } catch {}
        }
      }

      if (!cancelled && !mutatedSinceMountRef.current) {
        const afterLegacy = readFromStorageWithMeta(gStore, gKey);
        if (afterLegacy.hasKey) {
          setItems((prev) => reconcileServerWithLocal(prev, afterLegacy.items || []));
        }
      }

      try {
        const res = await fetch("/api/auth/session", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const sess = await res.json().catch(() => null);

        const userId = sess?.user?.id ? String(sess.user.id) : "";
        if (!cancelled && userId) {
          const userScope = `u:${userId}`;

          try {
            customerStorage()?.setItem(LS_LAST_USER_SCOPE_KEY, userScope);
          } catch {}

          setScopeSafe(userScope);

          const uStore = customerStorage();
          const gStore2 = guestStorage();

          const guestLines =
            readFromStorageWithMeta(gStore2, scopedKey(guestScope)).items || [];
          const userLines =
            readFromStorageWithMeta(uStore, scopedKey(userScope)).items || [];

          setItems((prev) => {
            const prevStable = stabilizeLines(prev || []);
            const mergedUser = mergeLinesAdditive(userLines, guestLines);
            const merged = mergeLinesAdditive(mergedUser, prevStable);
            return stabilizeLines(merged);
          });

          const mergedNow = mergeLinesAdditive(userLines, guestLines);
          writeToStorage(uStore, scopedKey(userScope), { items: mergedNow }, { emitEvent: false });

          try {
            gStore2?.removeItem(scopedKey(guestScope));
          } catch {}
        } else {
          try {
            customerStorage()?.removeItem(LS_LAST_USER_SCOPE_KEY);
          } catch {}
        }
      } catch {}

      if (!cancelled) setReady(true);

      try {
        const res = await fetch("/api/cart", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data && Array.isArray(data.items)) {
          setItems((prev) => reconcileServerWithLocal(prev, data.items));

          const sc = scopeRef.current || guestScope;
          const store = sc.startsWith("u:") ? customerStorage() : guestStorage();
          const localNowMeta = readFromStorageWithMeta(store, scopedKey(sc));

          const reconciled = reconcileServerWithLocal(
            localNowMeta.items || [],
            data.items
          );

          writeToStorage(store, scopedKey(sc), { items: reconciled }, { emitEvent: false });
        }
      } catch {}
    })();

    const onStorage = (e) => {
      if (cancelled) return;

      const sc = scopeRef.current;
      const key = scopedKey(sc);

      if (e && e.type === "storage") {
        if (e.key && e.key !== key) return;
      }

      const store = sc.startsWith("u:") ? customerStorage() : guestStorage();
      const dataMeta = readFromStorageWithMeta(store, key);

      if (!dataMeta.hasKey) return;

      setItems((prev) => reconcileServerWithLocal(prev, dataMeta.items || []));
    };

    const onCartChanged = (e) => {
      const d = e && typeof e === "object" ? e.detail : null;
      if (d && d.__source === "cart_context" && d.__token) {
        if (d.__token === selfEventTokenRef.current) return;
      }
      onStorage({ type: "cart:changed" });
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("cart:changed", onCartChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cart:changed", onCartChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setScopeSafe]);

  // persist (debounced)
  useEffect(() => {
    if (!ready) return;

    if (!didInitialPersistRef.current) {
      didInitialPersistRef.current = true;
      if (!mutatedSinceMountRef.current) return;
    }

    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      const sc = scopeRef.current;
      const store = sc.startsWith("u:") ? customerStorage() : guestStorage();

      const token = `w_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      selfEventTokenRef.current = token;

      writeToStorage(
        store,
        scopedKey(sc),
        { items: stabilizedItems },
        {
          emitEvent: true,
          eventDetail: { __source: "cart_context", __token: token, scope: sc },
        }
      );
    }, 80);
  }, [stabilizedItems, ready]);

  /* ---------- core mutators ---------- */

  const addItem = useCallback((item) => {
    mutatedSinceMountRef.current = true;

    setItems((prev) => {
      if (!item) return prev;

      const next = stabilizeLines(prev);
      const incoming = ensureLineIdAndUniqueId(item);

      const variantKey = makeVariantKey(incoming);
      const incomingQty = Number(incoming.quantity || 1) || 1;

      let existingVariantQty = 0;
      let variantCapFromExisting = null;

      next.forEach((line) => {
        if (makeVariantKey(line) !== variantKey) return;
        const q = Number(line.quantity || 0) || 0;
        existingVariantQty += q;

        const capForLine = effectiveMaxAvailable(line, incoming);
        if (capForLine != null) {
          variantCapFromExisting =
            variantCapFromExisting == null
              ? capForLine
              : Math.max(variantCapFromExisting, capForLine);
        }
      });

      const capFromIncoming = effectiveMaxAvailable(null, incoming);
      const max =
        variantCapFromExisting != null
          ? variantCapFromExisting
          : capFromIncoming != null
          ? capFromIncoming
          : null;

      let allowedQty = incomingQty;

      if (max != null) {
        const remaining = max - existingVariantQty;
        if (remaining <= 0) return next;
        if (incomingQty > remaining) allowedQty = remaining;
      }

      if (allowedQty <= 0) return next;

      const idx = findLineIndex(next, incoming);

      if (idx >= 0) {
        const prevLine = next[idx];
        const prevQty = Number(prevLine.quantity || 0) || 0;
        const finalQty = prevQty + allowedQty;

        const cap = effectiveMaxAvailable(prevLine, incoming) ?? max;

        const merged = ensureLineIdAndUniqueId(
          mergePreserveStable(prevLine, incoming)
        );

        next[idx] = ensureLineIdAndUniqueId({
          ...merged,
          maxAvailable: cap ?? merged.maxAvailable ?? null,
          stock: cap ?? merged.stock ?? null,
          quantity: Math.max(1, finalQty),
        });

        return stabilizeLines(next);
      }

      let q = allowedQty;
      if (max != null) q = Math.min(q, max);

      next.push(
        ensureLineIdAndUniqueId({
          ...incoming,
          quantity: Math.max(1, q),
          maxAvailable: max ?? incoming.maxAvailable ?? null,
          stock: max ?? incoming.stock ?? null,
        })
      );

      return stabilizeLines(next);
    });

    if (typeof window !== "undefined") {
      if (isLikelyUserActivation()) {
        try {
          window.dispatchEvent(new Event("cart:open-panel"));
        } catch {}
        try {
          window.__TDLC_OPEN_CART_PANEL__?.({ reason: "add-to-cart" });
        } catch {}
      }
    }
  }, []);

  const removeItem = useCallback((matcher) => {
    mutatedSinceMountRef.current = true;

    setItems((prev) => {
      const next = stabilizeLines(prev);

      if (matcher && typeof matcher === "object") {
        const mi = ensureLineIdAndUniqueId(matcher);
        const mkeys = getOrCreateIdentityKeys(mi);
        const mk = firstNonEmpty(
          mkeys.identityKeyStrict,
          mkeys.identityKeyLoose,
          mi.lineId
        );

        return stabilizeLines(
          next.filter((x) => {
            const xi = ensureLineIdAndUniqueId(x);
            const xkeys = getOrCreateIdentityKeys(xi);
            const xk = firstNonEmpty(
              xkeys.identityKeyStrict,
              xkeys.identityKeyLoose,
              xi.lineId
            );
            return xk !== mk;
          })
        );
      }

      const m = String(matcher ?? "");
      if (!m) return next;

      return stabilizeLines(
        next.filter(
          (x) =>
            String(x.lineId || "") !== m &&
            String(x.id || "") !== m &&
            String(x.variantId || "") !== m &&
            String(x.slug || "") !== m &&
            String(x.productId || "") !== m
        )
      );
    });
  }, []);

  const updateQuantity = useCallback((matcher, quantity) => {
    mutatedSinceMountRef.current = true;

    const desired = Math.max(1, Number(quantity || 1) || 1);

    setItems((prev) => {
      const next = stabilizeLines(prev);
      if (!next.length) return next;

      let targetIndex = -1;

      if (typeof matcher === "number") {
        targetIndex = matcher;
      } else if (matcher && typeof matcher === "object") {
        targetIndex = findLineIndex(next, matcher);
      } else {
        const m = String(matcher ?? "");
        if (!m) return next;
        targetIndex = next.findIndex(
          (x) =>
            String(x.lineId || "") === m ||
            String(x.id || "") === m ||
            String(x.variantId || "") === m ||
            String(x.slug || "") === m ||
            String(x.productId || "") === m
        );
      }

      if (targetIndex < 0 || targetIndex >= next.length) return next;

      const targetLine = next[targetIndex];
      const variantKey = makeVariantKey(targetLine);

      let otherQty = 0;
      let capFromLines = effectiveMaxAvailable(targetLine, null);

      next.forEach((line, idx) => {
        if (idx === targetIndex) return;
        if (makeVariantKey(line) !== variantKey) return;

        const q = Number(line.quantity || 0) || 0;
        otherQty += q;

        const c = effectiveMaxAvailable(line, targetLine);
        if (c != null)
          capFromLines = capFromLines == null ? c : Math.max(capFromLines, c);
      });

      const cap =
        capFromLines != null
          ? capFromLines
          : effectiveMaxAvailable(null, targetLine);

      let finalQty = desired;

      if (cap != null) {
        const maxForThisLine = cap - otherQty;
        if (maxForThisLine <= 0) return next;
        if (finalQty > maxForThisLine) finalQty = maxForThisLine;
      }

      next[targetIndex] = ensureLineIdAndUniqueId({
        ...targetLine,
        quantity: Math.max(1, finalQty),
        maxAvailable: cap ?? targetLine.maxAvailable ?? null,
        stock: cap ?? targetLine.stock ?? null,
      });

      return stabilizeLines(next);
    });
  }, []);

  const clear = useCallback(() => {
    mutatedSinceMountRef.current = true;
    setItems([]);
  }, []);

  /* ---------- server sync ---------- */

  const syncToServer = useCallback(async (lines) => {
    if (typeof fetch === "undefined") return;

    const stableLines = stabilizeLines(lines);

    const normalized = Array.isArray(stableLines)
      ? stableLines.map(normalizeLineForSync).filter(Boolean)
      : [];

    if (!normalized.length) {
      try {
        await fetch("/api/cart", {
          method: "DELETE",
          credentials: "include",
          cache: "no-store",
        });
      } catch (err) {
        console.warn("Cart clear network/parse error (ignored):", err);
      }
      lastSyncPayloadRef.current = "";
      return;
    }

    normalized.sort((a, b) => {
      const ak =
        (a?.metadata?.identityKeyStrict || a?.metadata?.identityKeyLoose || "") +
        "|" +
        (a?.metadata?.productId || "") +
        "|" +
        (a?.variantId || "") +
        "|" +
        (a?.selectedColor || "") +
        "|" +
        (a?.selectedSize || "") +
        "|" +
        (a?.strapiSizeId || "");
      const bk =
        (b?.metadata?.identityKeyStrict || b?.metadata?.identityKeyLoose || "") +
        "|" +
        (b?.metadata?.productId || "") +
        "|" +
        (b?.variantId || "") +
        "|" +
        (b?.selectedColor || "") +
        "|" +
        (b?.selectedSize || "") +
        "|" +
        (b?.strapiSizeId || "");
      return ak.localeCompare(bk);
    });

    const currency = (normalized[0].currency || "BDT").toUpperCase();
    const payload = { items: normalized, currency };
    const json = JSON.stringify(payload);

    if (json === lastSyncPayloadRef.current) return;
    lastSyncPayloadRef.current = json;

    try {
      const res = await fetch("/api/cart/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
        credentials: "include",
        cache: "no-store",
      });

      const responseJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("Cart sync HTTP error:", res.status, responseJson);
        return;
      }
      if (responseJson && responseJson.ok === false) {
        console.warn("Cart sync soft-failed:", responseJson);
        return;
      }
    } catch (err) {
      console.warn("Cart sync network/parse error (ignored):", err);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;

    if (syncTimer.current) clearTimeout(syncTimer.current);

    syncTimer.current = setTimeout(() => {
      syncToServer(stabilizedItems);
    }, 250);

    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [stabilizedItems, ready, syncToServer]);

  /* ---------- reducer-style dispatch (compat) ---------- */

  const dispatch = useCallback(
    (action) => {
      if (!action || typeof action !== "object") return;

      switch (action.type) {
        case "ADD":
        case "ADD_ITEM":
        case "ADD_TO_CART": {
          const line = action.payload || action.line;
          if (!line) return;
          addItem(line);
          return;
        }

        case "UPDATE_QTY": {
          if (typeof action.idx === "number") {
            updateQuantity(action.idx, action.quantity);
            return;
          }
          if (action.matcher != null) {
            updateQuantity(action.matcher, action.quantity);
            return;
          }
          return;
        }

        case "REMOVE": {
          if (typeof action.idx === "number") {
            mutatedSinceMountRef.current = true;
            setItems((prev) => stabilizeLines(stabilizeLines(prev).filter((_, i) => i !== action.idx)));
            return;
          }
          if (action.matcher != null) {
            removeItem(action.matcher);
            return;
          }
          return;
        }

        case "CLEAR": {
          clear();
          return;
        }

        default:
          return;
      }
    },
    [addItem, updateQuantity, removeItem, clear]
  );

  /* ---------- derived values ---------- */

  const itemCount = useMemo(
    () =>
      stabilizedItems.reduce(
        (sum, it) => sum + (Number(it.quantity || it.qty || 1) || 1),
        0
      ),
    [stabilizedItems]
  );

  const subtotal = useMemo(
    () =>
      stabilizedItems.reduce((sum, it) => {
        const price = Number(it.price || it.unitPrice || 0) || 0;
        const qty = Number(it.quantity || it.qty || 1) || 1;
        return sum + price * qty;
      }, 0),
    [stabilizedItems]
  );

  const value = useMemo(
    () => ({
      ready,
      items: stabilizedItems,
      itemCount,
      subtotal,

      add: addItem,
      addItem,
      remove: removeItem,
      removeItem,
      updateQuantity,
      clear,

      cart: {
        items: stabilizedItems,
        itemCount,
        subtotal,
      },
      dispatch,

      cartScope: scope,
    }),
    [
      ready,
      stabilizedItems,
      itemCount,
      subtotal,
      addItem,
      removeItem,
      updateQuantity,
      clear,
      dispatch,
      scope,
    ]
  );

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

/* default export */
export default CartProvider;

export function useCart() {
  const ctx = useContext(CartCtx);
  if (!ctx) {
    throw new Error("useCart must be used within <CartProvider>");
  }
  return ctx;
}
