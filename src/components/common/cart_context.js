// FILE: src/components/common/cart_context.js
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
 * IMPORTANT FIX (Customer-specific carts):
 * - The previous implementation used a single, global localStorage key (tdlc_cart_v1).
 *   That makes carts bleed across different customers on the same browser/device (logout/login,
 *   different accounts, guest vs logged-in).
 *
 * NEW BEHAVIOR:
 * - Logged-in customers persist cart in localStorage under:  tdlc_cart_v1:u:<userId>
 * - Guests persist cart in sessionStorage under:             tdlc_cart_v1:g:<guestSid>
 *   (sessionStorage + session cookie means a new visitor starts empty; no cross-guest bleed)
 *
 * - We still keep server sync (/api/cart, /api/cart/sync) unchanged; we only scope local persistence.
 * - We also migrate the legacy global key once (best-effort) into the first resolved scope.
 */

const STORAGE_KEY_BASE = "tdlc_cart_v1";
const LEGACY_GLOBAL_KEY = STORAGE_KEY_BASE; // backward compatibility
const GUEST_SID_COOKIE = "tdlc_sid"; // server already reads this (and aliases) in cart routes

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
  // session cookie (no Max-Age/Expires): disappears when browser closes
  if (typeof document === "undefined") return;
  const isHttps =
    typeof location !== "undefined" &&
    String(location.protocol || "").toLowerCase() === "https:";
  const secure = isHttps ? "; Secure" : "";
  // SameSite=Lax to avoid cross-site leakage; Path=/ for global access.
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    String(value || "")
  )}; Path=/; SameSite=Lax${secure}`;
}

function getOrCreateGuestSid() {
  // Prefer an existing cookie value (server uses it)
  const existing =
    readCookie("tdlc_sid") || readCookie("cart_sid") || readCookie("guest_sid");
  if (existing) {
    // Normalize: always keep canonical cookie name for future reads
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
    // Fallback: good-enough entropy for session identifier (not security token)
    sid = `g_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  setCookieSession(GUEST_SID_COOKIE, sid);
  return sid;
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
 * Read cart payload from a specific Storage (localStorage/sessionStorage).
 * Accepts legacy formats: [] or { items: [] }.
 */
function readFromStorage(storage, key) {
  try {
    if (!storage) return { items: [] };
    const raw = storage.getItem(key);
    if (!raw) return { items: [] };

    const parsed = safeParse(raw);
    if (Array.isArray(parsed)) return { items: parsed };
    if (!parsed || typeof parsed !== "object") return { items: [] };
    if (!Array.isArray(parsed.items)) return { items: [] };
    return { items: parsed.items };
  } catch {
    return { items: [] };
  }
}

function writeToStorage(storage, key, data) {
  try {
    if (!storage) return;
    const payload = { items: Array.isArray(data?.items) ? data.items : [] };
    storage.setItem(key, JSON.stringify(payload));

    // notify any listeners (cart page, recommendations, etc.)
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new Event("cart:changed"));
      } catch {}
    }
  } catch {
    // ignore
  }
}

/**
 * For guests we prefer sessionStorage so carts do not persist across different visitors.
 * If sessionStorage is unavailable (some privacy modes), we fall back to localStorage.
 */
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

/** stable line key: product/variant/color/size + strapiSizeId */
function makeKey(x = {}) {
  const sizeRow =
    x.strapiSizeId ||
    x.strapi_size_id ||
    x.sizeStockId ||
    x.size_stock_id ||
    x.sizeId ||
    x.size_id ||
    "";

  // tolerant variant identity
  const variantRaw =
    x.variantId || x.variant_id || x.vid || (x.variant && x.variant.id) || "";

  return [
    sizeRow,
    x.productId || x.id || x.slug || "",
    variantRaw,
    x.selectedColor || x.color || "",
    x.selectedSize || x.size || "",
  ].join("|");
}

/**
 * Variant-level identity: used to cap stock **across multiple lines**
 * for the same (size-stock or variant + color + size).
 */
function makeVariantKey(x = {}) {
  const sizeRow =
    x.strapiSizeId ||
    x.strapi_size_id ||
    x.sizeStockId ||
    x.size_stock_id ||
    x.sizeId ||
    x.size_id ||
    "";
  const prismaVar = x.variantPrismaId || x.prisma_id || x.pid || "";

  const variantStrapi =
    x.variantId || x.variant_id || x.vid || (x.variant && x.variant.id) || "";

  const product = x.productId || x.id || x.slug || "";
  const color = x.selectedColor || x.color || "";
  const size = x.selectedSize || x.size || "";

  if (sizeRow) return `ss:${String(sizeRow)}`;
  if (prismaVar || variantStrapi) {
    return [
      "v",
      prismaVar || "",
      variantStrapi || "",
      product || "",
      color || "",
      size || "",
    ].join("|");
  }
  return ["p", product || "", color || "", size || ""].join("|");
}

function numOrNull(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Push any numeric stock candidates from an item into `out[]`.
 * Handles both direct numeric fields and nested Strapi sizeStock objects.
 */
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

/**
 * Derive a max-available cap from any of the known stock fields on the
 * existing line and the incoming line.
 */
function effectiveMaxAvailable(existing, incoming) {
  const candidates = [];
  collectStockCandidatesFromItem(existing, candidates);
  collectStockCandidatesFromItem(incoming, candidates);
  const positives = candidates.filter((v) => Number.isFinite(v) && v > 0);
  if (!positives.length) return null;
  return Math.max(...positives);
}

/**
 * Normalize a cart line into the shape needed by /api/cart/sync.
 * Also forwards rich metadata (fabric, GSM, fit, SKU, barcode, thumbnail, etc.)
 */
function normalizeLineForSync(it = {}) {
  if (!it || typeof it !== "object") return null;

  const quantity = Number(it.quantity || it.qty || 1) || 1;
  const price = Number(it.price || it.unitPrice || 0) || 0;

  const productId =
    it.productId ??
    it.product_id ??
    it.pid ??
    it.id ??
    (it.product && it.product.id) ??
    null;

  const slug = it.slug ?? it.productSlug ?? (it.product && it.product.slug) ?? null;

  const variantId =
    it.variantId ?? it.variant_id ?? it.vid ?? (it.variant && it.variant.id) ?? null;

  const selectedSize = it.selectedSize ?? it.size ?? it.size_name ?? it.sizeLabel ?? null;

  const selectedColor = it.selectedColor ?? it.color ?? it.colour ?? it.color_name ?? null;

  const strapiSizeId =
    it.strapiSizeId ??
    it.strapi_size_id ??
    it.sizeStockId ??
    it.size_stock_id ??
    it.sizeId ??
    it.size_id ??
    null;

  const fabric =
    it.fabric ??
    it.fabricName ??
    (it.variant && (it.variant.fabric || it.variant.fabricName)) ??
    (it.product && (it.product.fabric || it.product.fabricName)) ??
    null;

  const gsm =
    it.gsm ??
    it.gsmValue ??
    (it.variant && (it.variant.gsm || it.variant.gsmValue)) ??
    (it.product && (it.product.gsm || it.product.gsmValue)) ??
    null;

  const fit =
    it.fit ??
    it.fitName ??
    (it.variant && (it.variant.fit || it.variant.fitName)) ??
    (it.product && (it.product.fit || it.product.fitName)) ??
    null;

  const sku =
    it.sku ??
    (it.variant && (it.variant.sku || it.variant.skuCode || it.variant.sku_code)) ??
    (it.product && (it.product.sku || it.product.skuCode || it.product.sku_code)) ??
    null;

  const barcode =
    it.barcode ??
    it.bar_code ??
    it.ean13 ??
    it.ean ??
    (it.variant &&
      (it.variant.barcode ||
        it.variant.barCode ||
        it.variant.ean13 ||
        it.variant.ean ||
        it.variant.barcodeEan13 ||
        it.variant.barcode_ean13)) ??
    (it.product &&
      (it.product.barcode ||
        it.product.barCode ||
        it.product.ean13 ||
        it.product.ean ||
        it.product.barcodeEan13 ||
        it.product.barcode_ean13)) ??
    null;

  const originalUnitPrice =
    it.originalUnitPrice ??
    it.compareAtPrice ??
    it.mrp ??
    (it.metadata && (it.metadata.originalUnitPrice || it.metadata.compareAt || it.metadata.mrp)) ??
    null;

  const thumbnail =
    it.thumbnail ??
    it.thumbnailUrl ??
    it.thumbUrl ??
    it.thumb ??
    (it.image && (it.image.url || it.image.src)) ??
    (Array.isArray(it.images) && it.images[0]
      ? it.images[0].url || it.images[0].src || null
      : null) ??
    (it.product && it.product.thumbnail && (it.product.thumbnail.url || it.product.thumbnail.src)) ??
    null;

  const productName =
    it.productName ?? it.title ?? it.name ?? (it.product && (it.product.name || it.product.title)) ?? null;

  const variantTitle = it.variantTitle ?? (it.variant && (it.variant.title || it.variant.name)) ?? null;

  const metadata = {
    productId,
    pid: productId,
    productSlug: slug,
    variantId,
    vid: variantId,

    size: selectedSize,
    size_name: selectedSize,
    selectedSize,

    color: selectedColor,
    colour: selectedColor,
    color_name: selectedColor,
    selectedColor,

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
    ean: it.ean ?? null,
    ean13: it.ean13 ?? null,

    originalUnitPrice,

    productName,
    variantTitle,

    thumbnail,
    thumbnailUrl: thumbnail,
    thumb: thumbnail,
    image: thumbnail,
    imageUrl: thumbnail,
  };

  return {
    productId,
    slug,
    variantId,

    selectedColor,
    selectedSize,

    strapiSizeId,

    quantity,
    price,
    currency: (it.currency || "BDT").toUpperCase(),

    stock_quantity: it.stock_quantity ?? it.stockQuantity ?? null,
    sizeStock: it.sizeStock ?? it.size_stock ?? null,
    maxAvailable: it.maxAvailable ?? null,
    stock: it.stock ?? null,
    strapiStockQty: it.strapiStockQty ?? it.strapi_stock_qty ?? null,

    metadata,
  };
}

/* ---------------- provider ---------------- */

export function CartProvider({ children }) {
  const [ready, setReady] = useState(false);

  // Scope: "g:<sid>" (guest) OR "u:<id>" (logged-in)
  const [scope, setScope] = useState("g:boot");
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const [items, setItems] = useState([]);

  const saveTimer = useRef(null);
  const syncTimer = useRef(null);

  // keeps last synced JSON payload to avoid repeated calls
  const lastSyncPayloadRef = useRef("");

  /**
   * Resolve session (customer) and decide scope.
   * We intentionally do NOT import next-auth/react to avoid changing bundle shape;
   * using the NextAuth session endpoint keeps this file standalone.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    (async () => {
      // Always ensure a guest SID cookie exists (session cookie)
      const guestSid = getOrCreateGuestSid();
      const guestScope = `g:${guestSid}`;

      // Default to guest scope immediately (so UI works fast)
      if (!cancelled) setScope(guestScope);

      // Load from guest storage quickly
      const gStore = guestStorage();
      const gData = readFromStorage(gStore, scopedKey(guestScope));

      // If scoped guest storage is empty, try migrating legacy global key into guest scope
      if ((!gData.items || !gData.items.length) && typeof window !== "undefined") {
        const legacy = readFromStorage(customerStorage(), LEGACY_GLOBAL_KEY);
        if (Array.isArray(legacy.items) && legacy.items.length) {
          writeToStorage(gStore, scopedKey(guestScope), { items: legacy.items });
          // best-effort clear legacy global key so it doesn't bleed again
          try {
            customerStorage()?.removeItem(LEGACY_GLOBAL_KEY);
          } catch {}
        }
      }

      if (!cancelled) {
        const afterLegacy = readFromStorage(gStore, scopedKey(guestScope));
        if (Array.isArray(afterLegacy.items)) setItems(afterLegacy.items);
      }

      // Now check if customer session exists (logged-in)
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
          setScope(userScope);

          // Migrate guest items into user cart storage (merge, no data loss)
          const uStore = customerStorage();
          const gStore2 = guestStorage();

          const guestLines = readFromStorage(gStore2, scopedKey(guestScope)).items || [];
          const userLines = readFromStorage(uStore, scopedKey(userScope)).items || [];

          const merged = mergeLines(userLines, guestLines);
          setItems(merged);

          writeToStorage(uStore, scopedKey(userScope), { items: merged });

          // Clear guest scope so next guest starts empty
          try {
            gStore2?.removeItem(scopedKey(guestScope));
          } catch {}
        }
      } catch {
        // If session fetch fails, remain in guest scope.
      }

      if (!cancelled) setReady(true);

      // 2) Server canonical cart hydration (per cookie/user)
      try {
        const res = await fetch("/api/cart", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data && Array.isArray(data.items)) {
          setItems((prev) => {
            try {
              const prevJson = JSON.stringify(prev || []);
              const nextJson = JSON.stringify(data.items || []);
              if (prevJson === nextJson) return prev;
            } catch {}
            return data.items;
          });

          // Persist to the current scope storage
          const sc = scopeRef.current || guestScope;
          const store = sc.startsWith("u:") ? customerStorage() : guestStorage();
          writeToStorage(store, scopedKey(sc), { items: data.items });
        }
      } catch {
        // ignore; stay on local cart
      }
    })();

    // storage listeners (same-tab + other tabs)
    const onStorage = (e) => {
      if (cancelled) return;

      const sc = scopeRef.current;
      const key = scopedKey(sc);

      // For real StorageEvent, only react to changes of our active key
      if (e && e.type === "storage") {
        if (e.key && e.key !== key) return;
      }

      const store = sc.startsWith("u:") ? customerStorage() : guestStorage();
      const data = readFromStorage(store, key);

      if (!Array.isArray(data.items)) return;

      setItems((prev) => {
        try {
          const prevJson = JSON.stringify(prev || []);
          const nextJson = JSON.stringify(data.items || []);
          if (prevJson === nextJson) return prev;
        } catch {}
        return data.items;
      });
    };

    const onCartChanged = () => onStorage({ type: "cart:changed" });

    window.addEventListener("storage", onStorage);
    window.addEventListener("cart:changed", onCartChanged);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cart:changed", onCartChanged);
    };
  }, []);

  // persist (debounced) whenever items change
  useEffect(() => {
    if (!ready) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(() => {
      const sc = scopeRef.current;
      const store = sc.startsWith("u:") ? customerStorage() : guestStorage();
      writeToStorage(store, scopedKey(sc), { items });
    }, 80);
  }, [items, ready]);

  /* ---------- line merge helper ---------- */

  function mergeLines(baseLines, incomingLines) {
    const base = Array.isArray(baseLines) ? [...baseLines] : [];
    const inc = Array.isArray(incomingLines) ? incomingLines : [];
    if (!inc.length) return base;

    for (const line of inc) {
      if (!line) continue;
      const lk = makeKey(line);
      const idx = base.findIndex((x) => makeKey(x) === lk);

      if (idx >= 0) {
        const prevLine = base[idx];
        const prevQty = Number(prevLine.quantity || prevLine.qty || 0) || 0;
        const addQty = Number(line.quantity || line.qty || 0) || 0;

        // Respect stock cap if present
        const cap = effectiveMaxAvailable(prevLine, line);
        let nextQty = prevQty + addQty;
        if (cap != null) nextQty = Math.min(nextQty, cap);

        base[idx] = {
          ...prevLine,
          ...line,
          maxAvailable: cap ?? prevLine.maxAvailable ?? line.maxAvailable ?? null,
          stock: cap ?? prevLine.stock ?? line.stock ?? null,
          quantity: Math.max(1, nextQty || 1),
        };
      } else {
        base.push(line);
      }
    }

    return base;
  }

  /* ---------- core mutators (functional) ---------- */

  const addItem = useCallback((item) => {
    setItems((prev) => {
      if (!item) return prev;

      const next = [...prev];

      const lineKey = makeKey(item);
      const variantKey = makeVariantKey(item);

      const incomingQty = Number(item.quantity || 1) || 1;

      // Compute existing total qty for this variant across all lines
      let existingVariantQty = 0;
      let variantCapFromExisting = null;

      next.forEach((line) => {
        if (makeVariantKey(line) !== variantKey) return;
        const q = Number(line.quantity || line.qty || 0) || 0;
        existingVariantQty += q;

        const capForLine = effectiveMaxAvailable(line, item);
        if (capForLine != null) {
          variantCapFromExisting =
            variantCapFromExisting == null
              ? capForLine
              : Math.max(variantCapFromExisting, capForLine);
        }
      });

      const capFromIncoming = effectiveMaxAvailable(null, item);
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

      const idx = next.findIndex((x) => makeKey(x) === lineKey);

      if (idx >= 0) {
        const prevLine = next[idx];
        const prevQty = Number(prevLine.quantity || prevLine.qty || 0) || 0;
        const finalQty = prevQty + allowedQty;

        next[idx] = {
          ...prevLine,
          ...item,
          maxAvailable: max ?? prevLine.maxAvailable ?? item.maxAvailable ?? null,
          stock: max ?? prevLine.stock ?? item.stock ?? null,
          quantity: Math.max(1, finalQty),
        };
        return next;
      }

      let q = allowedQty;
      if (max != null) q = Math.min(q, max);

      next.push({
        ...item,
        maxAvailable: max ?? item.maxAvailable ?? null,
        stock: max ?? item.stock ?? null,
        quantity: Math.max(1, q),
      });
      return next;
    });

    // CENTRAL TRIGGER: any Add to Cart opens the global cart panel
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new Event("cart:open-panel"));
      } catch {}
    }
  }, []);

  const removeItem = useCallback((matcher) => {
    setItems((prev) => {
      if (matcher && typeof matcher === "object") {
        const mk = makeKey(matcher);
        return prev.filter((x) => makeKey(x) !== mk);
      }
      return prev.filter(
        (x) =>
          x.id !== matcher &&
          x.variantId !== matcher &&
          x.slug !== matcher &&
          x.productId !== matcher
      );
    });
  }, []);

  const updateQuantity = useCallback((matcher, quantity) => {
    const desired = Math.max(1, Number(quantity || 1) || 1);

    setItems((prev) => {
      if (!prev.length) return prev;

      const next = [...prev];

      let targetIndex = -1;
      if (typeof matcher === "number") {
        targetIndex = matcher;
      } else if (matcher && typeof matcher === "object") {
        const mk = makeKey(matcher);
        targetIndex = next.findIndex((x) => makeKey(x) === mk);
      } else {
        targetIndex = next.findIndex(
          (x) =>
            x.id === matcher ||
            x.variantId === matcher ||
            x.slug === matcher ||
            x.productId === matcher
        );
      }

      if (targetIndex < 0 || targetIndex >= next.length) return prev;

      const targetLine = next[targetIndex];
      const variantKey = makeVariantKey(targetLine);

      // compute total qty for this variant on OTHER lines
      let otherQty = 0;
      let capFromLines = effectiveMaxAvailable(targetLine, null);

      next.forEach((line, idx) => {
        if (idx === targetIndex) return;
        if (makeVariantKey(line) !== variantKey) return;

        const q = Number(line.quantity || line.qty || 0) || 0;
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
        if (maxForThisLine <= 0) return prev;
        if (finalQty > maxForThisLine) finalQty = maxForThisLine;
      }

      next[targetIndex] = {
        ...targetLine,
        quantity: Math.max(1, finalQty),
        maxAvailable: cap ?? targetLine.maxAvailable ?? null,
        stock: cap ?? targetLine.stock ?? null,
      };

      return next;
    });
  }, []);

  const clear = useCallback(() => setItems([]), []);

  /* ---------- server sync (soft, non-fatal) ---------- */

  const syncToServer = useCallback(async (lines) => {
    if (typeof fetch === "undefined") return;

    const normalized = Array.isArray(lines)
      ? lines.map(normalizeLineForSync).filter(Boolean)
      : [];

    // If normalized is empty, clear server cart (no ghosts)
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

  // Debounce sync whenever items change (including empty -> clears server cart)
  useEffect(() => {
    if (!ready) return;

    if (syncTimer.current) clearTimeout(syncTimer.current);

    syncTimer.current = setTimeout(() => {
      syncToServer(items);
    }, 250);

    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [items, ready, syncToServer]);

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
            setItems((prev) => prev.filter((_, i) => i !== action.idx));
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
      items.reduce(
        (sum, it) => sum + (Number(it.quantity || it.qty || 1) || 1),
        0
      ),
    [items]
  );

  const subtotal = useMemo(
    () =>
      items.reduce((sum, it) => {
        const price = Number(it.price || it.unitPrice || 0) || 0;
        const qty = Number(it.quantity || it.qty || 1) || 1;
        return sum + price * qty;
      }, 0),
    [items]
  );

  const value = useMemo(
    () => ({
      // core
      ready,
      items,
      itemCount,
      subtotal,

      // simple API
      add: addItem,
      addItem,
      remove: removeItem,
      removeItem,
      updateQuantity,
      clear,

      // legacy shape
      cart: {
        items,
        itemCount,
        subtotal,
      },
      dispatch,

      // debug (non-UI)
      cartScope: scope,
    }),
    [
      ready,
      items,
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
