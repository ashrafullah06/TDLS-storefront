"use client";

/** ---------------- cart helpers (robust + ENRICHED) ----------------
 * Goals:
 * - Normalize heterogeneous cart item shapes into a stable snapshot.
 * - Prefer authoritative server cart when available (logged-in users).
 * - Keep canonical localStorage keys in sync for instant hydration.
 * - Maintain compatibility with legacy readers (notably localStorage "cart").
 * - Avoid fetch hangs via hard timeout + abort.
 */

/* ---------------- internal utils ---------------- */

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function withTimeoutSignal(signal, timeoutMs = 2200) {
  // If caller provided a signal, respect it and do not override.
  if (signal) return { signal, cleanup: () => {} };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(300, Number(timeoutMs) || 2200));
  return {
    signal: ctrl.signal,
    cleanup: () => clearTimeout(t),
  };
}

/* ---------------- mapping / normalization ---------------- */

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
    if (m) out.size = String(m[1]).toUpperCase();
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

  const variantTitle = it?.variantTitle ?? it?.variant?.title ?? null;
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

  const slug =
    it?.slug ?? it?.handle ?? it?.product?.slug ?? it?.product?.handle ?? null;

  if (!Number.isFinite(qty) || qty <= 0) return null;

  const options = extractOptionsShape(it);
  const size = options.size ?? null;
  const color = options.color ?? null;
  const title = variantTitle || productTitle || it?.title || "Item";

  const q = Math.max(1, Math.floor(qty));
  const u = Number.isFinite(unit) ? unit : 0;

  return {
    // keep original fields (non-destructive), but normalize the common ones below
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

    lineId: it?.lineId ?? it?.id ?? null,

    quantity: q,
    unitPrice: u,
    price: u,
    subtotal: q * u,
  };
}

function decorateForDisplay(items = []) {
  return items.map((it) => {
    const parts = [];
    if (it?.size) parts.push(`Size: ${it.size}`);
    if (it?.color) parts.push(`Color: ${it.color}`);
    const optionSummary = parts.join(" • ");
    return { ...it, optionSummary };
  });
}

/* ---------- purge legacy cart keys (prevents demo data bleed) ---------- */
export function purgeLegacyCartKeysIfCanonicalExists() {
  try {
    if (typeof window === "undefined") return;

    const canonicalStr =
      localStorage.getItem("tdlc_cart_v1") || localStorage.getItem("TDLC_CART");

    if (!canonicalStr) return;

    // Remove known bad legacy keys that can carry stale/demo data.
    // IMPORTANT: keep "cart" for compatibility, but we overwrite it to canonical below.
    ["shop_cart", "tdlc_cart"].forEach((k) => localStorage.removeItem(k));

    // Keep window globals consistent
    try {
      const parsed = safeJsonParse(canonicalStr);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      window.__CART__ = { items };
      window.__SHOP_CART__ = { items };
      window.__CART_STR__ = JSON.stringify({ items });
    } catch {}

    // Overwrite legacy "cart" with canonical snapshot so older readers stay correct.
    localStorage.setItem("cart", canonicalStr);
  } catch {}
}

/* ---------- prefer canonical keys, legacy last-resort only ---------- */
export function snapshotFromLocalStorage() {
  try {
    if (typeof window === "undefined") return null;

    const canonicalKeys = ["tdlc_cart_v1", "TDLC_CART"];
    for (const k of canonicalKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = safeJsonParse(raw);
      if (!parsed) continue;

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

    // Legacy keys (including "cart" for compatibility)
    const legacyKeys = ["cart", "tdlc_cart", "shop_cart"];
    for (const k of legacyKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = safeJsonParse(raw);
      if (!parsed) continue;

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
    if (typeof window === "undefined") return null;

    const hasCanonical = !!(
      localStorage.getItem("tdlc_cart_v1") || localStorage.getItem("TDLC_CART")
    );

    // If canonical exists, we don't need window fallbacks.
    if (hasCanonical) return null;

    const cand = window.__CART__ || window.__SHOP_CART__ || null;

    const arr =
      cand && Array.isArray(cand.items)
        ? cand.items
        : Array.isArray(cand)
        ? cand
        : [];

    const mapped = arr.map(mapAnyItemToSnapshotShape).filter(Boolean);
    if (mapped.length) return { items: decorateForDisplay(mapped), _source: "window" };
  } catch {}

  return null;
}

export function persistSnapshot(snapshot) {
  try {
    if (typeof window === "undefined") return;
    if (!snapshot || !Array.isArray(snapshot.items)) return;

    const payload = JSON.stringify({ items: snapshot.items });

    // Canonical keys
    localStorage.setItem("tdlc_cart_v1", payload);
    localStorage.setItem("TDLC_CART", payload);

    // Compatibility key used by some fallback readers (e.g., older Review logic)
    localStorage.setItem("cart", payload);

    // Window globals
    window.__CART__ = { items: snapshot.items };
    window.__SHOP_CART__ = { items: snapshot.items };
    window.__CART_STR__ = payload;

    purgeLegacyCartKeysIfCanonicalExists();
  } catch {}
}

/**
 * buildFreshCartSnapshot(setCartId?, opts?)
 * - Server-first: if server returns items, it wins.
 * - Falls back to canonical localStorage, then window, then legacy.
 * - Uses hard timeout (default 2200ms) to prevent long hangs.
 */
export async function buildFreshCartSnapshot(setCartId, opts = {}) {
  const timeoutMs = Number(opts?.timeoutMs ?? 2200);
  const { signal, cleanup } = withTimeoutSignal(opts?.signal, timeoutMs);

  let serverDecorated = [];
  let serverCartId = null;
  let serverOk = false;

  try {
    const rc = await fetch("/api/cart", {
      credentials: "include",
      cache: "no-store",
      signal,
    });

    if (rc.ok) {
      serverOk = true;
      const c = (await rc.json().catch(() => ({}))) || {};
      const serverItems = Array.isArray(c?.items)
        ? c.items
        : Array.isArray(c?.cart?.items)
        ? c.cart.items
        : [];

      const normalized = serverItems.map(mapAnyItemToSnapshotShape).filter(Boolean);
      serverDecorated = decorateForDisplay(normalized);

      serverCartId = c?.id || c?.cartId || c?.cart?.id || null;
    }
  } catch {
    // swallow: we hard-fallback to local snapshots
  } finally {
    cleanup();
  }

  purgeLegacyCartKeysIfCanonicalExists();

  const fromLS = snapshotFromLocalStorage();
  const fromWin = snapshotFromWindow();

  // Server-first (authoritative), otherwise best available fallback
  let snap = null;

  if (serverOk && serverDecorated.length) {
    snap = { items: serverDecorated, _source: "server" };
  } else if (fromLS?.items?.length) {
    snap = fromLS;
  } else if (fromWin?.items?.length) {
    snap = fromWin;
  } else if (serverOk && !serverDecorated.length) {
    // Explicit empty server cart: keep it as the truth (avoid resurrecting stale locals)
    snap = { items: [], _source: "server-empty" };
  }

  if (snap) {
    if (serverCartId && typeof setCartId === "function") setCartId(String(serverCartId));
    persistSnapshot(snap);
    return snap;
  }

  return null;
}

/**
 * Convenience: read best available snapshot immediately (no server call).
 * Useful as a shared helper across checkout / review / summary if needed.
 */
export function readCartSnapshot() {
  const fromLS = snapshotFromLocalStorage();
  if (fromLS?.items?.length) return fromLS;
  const fromWin = snapshotFromWindow();
  if (fromWin?.items?.length) return fromWin;
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
    if (typeof window === "undefined") return;

    window.__CART__ = { items: [] };
    window.__SHOP_CART__ = { items: [] };
    window.__CART_STR__ = JSON.stringify({ items: [] });

    const keys = [
      // canonical + compat
      "TDLC_CART",
      "tdlc_cart_v1",
      "cart",

      // legacy / misc
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

      // checkout transient keys (avoid ghost state)
      "checkout_ctx",
      "checkout_address",
      "checkout_address_shipping",
      "checkout_address_billing",
    ];

    for (const k of keys) localStorage.removeItem(k);

    window.dispatchEvent(new Event("cart:changed"));
  } catch {}
}
