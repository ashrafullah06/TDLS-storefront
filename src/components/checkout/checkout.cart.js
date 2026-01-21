//✅ FILE 2: src/components/checkout/checkout.cart.js
"use client";

/** ---------------- cart helpers (robust + ENRICHED) ---------------- */

function extractOptionsShape(it) {
  const opts =
    it?.options ??
    it?.variant?.options ??
    it?.attributes ??
    it?.variantAttributes ??
    it?.selectedOptions ??
    it?.variant?.selectedOptions ??
    null;

  const out = {};
  const kvPairs = Array.isArray(opts)
    ? opts
    : opts && typeof opts === "object"
    ? Object.entries(opts).map(([name, value]) => ({ name, value }))
    : [];

  for (const pair of kvPairs) {
    const name = String(pair?.name ?? pair?.key ?? "").toLowerCase();
    const value = String(pair?.value ?? pair?.label ?? "").trim();
    if (!name) continue;
    out[name] = value;
    if (name === "size" || name === "option1") out.size = value;
    if (name === "color" || name === "colour" || name === "option2") out.color = value;
  }

  out.size = out.size ?? it?.size ?? it?.Size ?? it?.variant?.size ?? null;
  out.color = out.color ?? it?.color ?? it?.colour ?? it?.Color ?? it?.variant?.color ?? null;

  const sku = it?.sku || it?.variant?.sku || "";
  if (!out.size && /(?:^|[-_])([XSML]{1,3}\d?)(?:$|[-_])/.test(sku)) {
    const m = sku.match(/(?:^|[-_])([XSML]{1,3}\d?)(?:$|[-_])/i);
    if (m) out.size = m[1].toUpperCase();
  }

  return out;
}

function mapAnyItemToSnapshotShape(it) {
  const variantId =
    it?.variantId ?? it?.variant_id ?? it?.variant?.id ?? it?.id ?? null;

  const productId =
    it?.productId ?? it?.product_id ?? it?.product?.id ?? it?.parentId ?? null;

  const qty = Number(it?.quantity ?? it?.qty ?? it?.count ?? it?.amount ?? 0);
  const unit = Number(it?.unitPrice ?? it?.price ?? it?.unit_price ?? it?.unit ?? 0);

  const productTitle =
    it?.productTitle ?? it?.product?.title ?? it?.product?.name ?? it?.title ?? null;

  const variantTitle = it?.variantTitle ?? it?.variant?.title ?? it?.title ?? null;
  const sku = it?.sku ?? it?.variant?.sku ?? it?.product?.sku ?? null;
  const barcode = it?.barcode ?? it?.variant?.barcode ?? it?.product?.barcode ?? null;

  const imageUrl =
    it?.image?.url ??
    it?.image_url ??
    it?.variant?.image?.url ??
    it?.variant?.featuredImage?.url ??
    it?.product?.thumbnail?.url ??
    it?.product?.image?.url ??
    null;

  const slug = it?.slug ?? it?.handle ?? it?.product?.slug ?? it?.product?.handle ?? null;

  if (!Number.isFinite(qty) || qty <= 0) return null;

  const options = extractOptionsShape(it);
  const size = options.size ?? null;
  const color = options.color ?? null;
  const title = variantTitle || productTitle || it?.title || "Item";

  return {
    ...it,
    productId: productId ? String(productId) : null,
    variantId: variantId ? String(variantId) : null,
    productTitle: productTitle || null,
    variantTitle: variantTitle || null,
    title,
    slug,
    sku,
    barcode,
    imageUrl,
    options,
    size,
    color,
    lineId: it?.id ?? null,
    quantity: Math.max(1, Math.floor(qty)),
    unitPrice: Number.isFinite(unit) ? unit : 0,
    price: Number.isFinite(unit) ? unit : 0,
    subtotal: Number.isFinite(unit) ? Math.max(1, Math.floor(qty)) * unit : 0,
  };
}

function decorateForDisplay(items = []) {
  return items.map((it) => {
    const parts = [];
    if (it.size) parts.push(`Size: ${it.size}`);
    if (it.color) parts.push(`Color: ${it.color}`);
    const optionSummary = parts.join(" • ");
    return { ...it, optionSummary };
  });
}

/* ---------- purge legacy cart keys (prevents demo data bleed) ---------- */
export function purgeLegacyCartKeysIfCanonicalExists() {
  try {
    const canonicalStr =
      localStorage.getItem("tdlc_cart_v1") || localStorage.getItem("TDLC_CART");
    if (canonicalStr) {
      ["cart", "shop_cart", "tdlc_cart"].forEach((k) => localStorage.removeItem(k));
      if (typeof window !== "undefined") {
        if (window.__SHOP_CART__ && !window.__CART__) window.__SHOP_CART__ = { items: [] };
        if (window.__CART_STR__) window.__CART_STR__ = JSON.stringify({ items: [] });
      }
    }
  } catch {}
}

/* ---------- prefer canonical keys, legacy last-resort only ---------- */
export function snapshotFromLocalStorage() {
  try {
    const canonicalKeys = ["tdlc_cart_v1", "TDLC_CART"];
    for (const k of canonicalKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.cart?.items)
        ? parsed.cart.items
        : [];
      const mapped = arr.map(mapAnyItemToSnapshotShape).filter(Boolean);
      if (mapped.length) return { items: decorateForDisplay(mapped), _source: `local:${k}` };
    }

    const legacyKeys = ["tdlc_cart", "shop_cart", "cart"];
    for (const k of legacyKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.cart?.items)
        ? parsed.cart.items
        : [];
      const mapped = arr.map(mapAnyItemToSnapshotShape).filter(Boolean);
      if (mapped.length) return { items: decorateForDisplay(mapped), _source: `local:${k}` };
    }
  } catch {}
  return null;
}

export function snapshotFromWindow() {
  try {
    const hasCanonical = !!(
      localStorage.getItem("tdlc_cart_v1") || localStorage.getItem("TDLC_CART")
    );
    if (hasCanonical) return null;

    const cand =
      (typeof window !== "undefined" && (window.__CART__ || window.__SHOP_CART__)) || null;

    const arr = cand && Array.isArray(cand.items) ? cand.items : Array.isArray(cand) ? cand : [];
    const mapped = arr.map(mapAnyItemToSnapshotShape).filter(Boolean);
    if (mapped.length) return { items: decorateForDisplay(mapped), _source: "window" };
  } catch {}
  return null;
}

export function persistSnapshot(snapshot) {
  try {
    if (!snapshot || !Array.isArray(snapshot.items)) return;
    const payload = JSON.stringify({ items: snapshot.items });
    localStorage.setItem("tdlc_cart_v1", payload);
    localStorage.setItem("TDLC_CART", payload);
    if (typeof window !== "undefined") window.__CART__ = { items: snapshot.items };
    purgeLegacyCartKeysIfCanonicalExists();
  } catch {}
}

export async function buildFreshCartSnapshot(setCartId) {
  let decorated = [];
  let serverCartId = null;

  try {
    const rc = await fetch("/api/cart", { credentials: "include", cache: "no-store" });
    if (rc.ok) {
      const c = await rc.json().catch(() => ({}));
      const serverItems = Array.isArray(c?.items)
        ? c.items
        : Array.isArray(c?.cart?.items)
        ? c.cart.items
        : [];
      const normalized = serverItems.map(mapAnyItemToSnapshotShape).filter(Boolean);
      decorated = decorateForDisplay(normalized);
      serverCartId = c?.id || c?.cartId || c?.cart?.id || null;
    }
  } catch {}

  purgeLegacyCartKeysIfCanonicalExists();

  const fromLS = snapshotFromLocalStorage();
  const fromWin = snapshotFromWindow();

  let snap = null;
  const candidates = [];
  if (decorated.length) candidates.push({ items: decorated, _source: "server" });
  if (fromLS?.items?.length) candidates.push(fromLS);
  if (fromWin?.items?.length) candidates.push(fromWin);

  if (candidates.length) {
    snap = candidates.reduce((best, cur) => {
      const bLen = best?.items?.length || 0;
      const cLen = cur?.items?.length || 0;
      if (cLen > bLen) return cur;
      return best;
    });
  }

  if (snap && Array.isArray(snap.items) && snap.items.length) {
    if (serverCartId && typeof setCartId === "function") setCartId(String(serverCartId));
    persistSnapshot(snap);
    return snap;
  }

  return null;
}

/* ---------------- cart clear helpers ---------------- */
export async function clearServerCartIfAny() {
  try {
    await fetch("/api/cart", { method: "DELETE", credentials: "include" });
  } catch {}
}

export function clearClientCartEverywhere() {
  try {
    if (typeof window !== "undefined") {
      window.__CART__ = { items: [] };
      window.__SHOP_CART__ = { items: [] };
      window.__CART_STR__ = JSON.stringify({ items: [] });

      const keys = [
        "TDLC_CART",
        "tdlc_cart_v1",
        "cart",
        "shop_cart",
        "TDLC_CART_STR",
        "tdlc_buy_now",
        "buy_now",
        "TDLC_BUY_NOW",
        "tdlc_cart_id",
        "cart_id",
        "cartId",
        "cart_token",
        "cartToken",
        "TDLC_CART_ID",
        "checkout_ctx",
        "checkout_address",
        "checkout_address_shipping",
        "checkout_address_billing",
      ];
      for (const k of keys) localStorage.removeItem(k);
      window.dispatchEvent(new Event("cart:changed"));
    }
  } catch {}
}
