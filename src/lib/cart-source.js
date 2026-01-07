// FILE: my-project/src/lib/cart-source.js
// Unified cart snapshot for checkout (BULLETPROOF, LOOP-SAFE).
// 1) Prefer client CartApi
// 2) Fallback to window globals and localStorage keys
// 3) Normalize item shape (includes Fabric, GSM, Fit, SKU, Barcode, PID, VID)
// 4) Avoid infinite cart:changed loops by diffing before dispatch

import { CartApi } from "@/lib/cart";

const FALLBACK_KEYS = [
  "tdlc_buy_now", "buy_now", "TDLC_BUY_NOW",
  "tdlc_cart_v1", "tdlc_cart", "cart", "TDLC_CART", "shop_cart",
];

function num(n, d = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
}

function mapToLine(it) {
  if (!it || typeof it !== "object") return null;

  // ---- base variant id (for server sync) ----
  const baseVariantId =
    it?.variantId ??
    it?.variant_id ??
    it?.variant?.id ??
    it?.id ??          // legacy
    it?.sku ??         // sometimes sku used as id
    it?.productId ??
    null;

  if (!baseVariantId) return null;

  const quantity = Math.max(
    1,
    Math.floor(
      num(
        it?.quantity ??
          it?.qty ??
          it?.count ??
          it?.amount ??
          1,
        1
      )
    )
  );

  const unitPrice = num(
    it?.unitPrice ??
      it?.price ??
      it?.unit_price ??
      it?.unit ??
      0,
    0
  );

  const metadata = it.metadata || {};
  const product =
    it.product ||
    it.productRef ||
    metadata.product ||
    null;

  const variant =
    it.variant ||
    metadata.variant ||
    null;

  // ---- product / variant ids (PID / VID) ----
  const pid =
    it.pid ??
    it.productId ??
    it.product_id ??
    metadata.productId ??
    product?.documentId ??
    product?.uuid ??
    product?.externalId ??
    product?.prismaId ??
    product?.cuid ??
    product?.code ??
    product?.id ??
    null;

  const vid =
    it.vid ??
    it.variantId ??
    it.variant_id ??
    metadata.variantId ??
    variant?.documentId ??
    variant?.uuid ??
    variant?.externalId ??
    variant?.prismaId ??
    variant?.cuid ??
    variant?.sku ??
    variant?.id ??
    baseVariantId ??
    null;

  // ---- human-facing text ----
  const title =
    it?.title ||
    it?.name ||
    it?.variantTitle ||
    it?.productTitle ||
    variant?.title ||
    product?.title ||
    "Item";

  const sku =
    it?.sku ??
    variant?.sku ??
    product?.sku ??
    metadata.sku ??
    null;

  const barcode =
    it?.barcode ??
    it?.bar_code ??
    variant?.barcode ??
    variant?.bar_code ??
    product?.barcode ??
    metadata.barcode ??
    metadata.productBarcode ??
    null;

  // ---- imagery ----
  const image =
    it?.image ||
    it?.thumbnail ||
    variant?.media?.[0]?.url ||
    product?.media?.[0]?.url ||
    it?.media?.[0]?.url ||
    null;

  // ---- options ----
  const color =
    it?.selectedColor ??
    it?.color ??
    it?.colour ??
    metadata.color ??
    metadata.colour ??
    variant?.color ??
    variant?.colour ??
    null;

  const size =
    it?.selectedSize ??
    it?.size ??
    metadata.size ??
    metadata.sizeLabel ??
    variant?.size ??
    variant?.sizeLabel ??
    null;

  // ---- fabric / gsm / fit ----
  const fabric =
    it?.fabric ??
    metadata.fabric ??
    product?.fabric ??
    product?.material ??
    variant?.fabric ??
    variant?.material ??
    null;

  const gsm =
    it?.gsm ??
    metadata.gsm ??
    product?.gsm ??
    product?.GSM ??
    variant?.gsm ??
    variant?.GSM ??
    null;

  const fit =
    it?.fit ??
    metadata.fit ??
    product?.fit ??
    product?.fitName ??
    variant?.fit ??
    null;

  // ---- stock hints (for /api/cart/sync clamping) ----
  const maxAvailable =
    it?.maxAvailable ??
    it?.max_available ??
    it?.stockAvailable ??
    it?.stock_available ??
    it?.stock ??
    metadata.maxAvailable ??
    metadata.stockAvailable ??
    null;

  const stock =
    it?.stock ??
    it?.stockTotal ??
    it?.stock_total ??
    metadata.stock ??
    null;

  const stock_quantity =
    it?.stock_quantity ??
    it?.stockQuantity ??
    metadata.stock_quantity ??
    metadata.stockQuantity ??
    null;

  return {
    // line identity
    id: it?.id ?? null,
    lineId: it?.lineId ?? it?.id ?? null,

    // product / variant identity
    variantId: vid,
    variant_id: vid,
    productId: pid,
    product_id: pid,
    pid,
    vid,

    slug: it?.slug ?? product?.slug ?? null,

    // human-facing
    title,
    sku,
    barcode,
    image,

    // options
    size,
    color,

    // garment meta
    fabric,
    gsm,
    fit,

    // quantity & price
    quantity,
    qty: quantity,
    unitPrice,
    price: unitPrice,
    currency: (it?.currency || "BDT").toUpperCase(),

    // stock hints
    maxAvailable,
    stock,
    stock_quantity,

    // nested for richer UIs
    product,
    variant,
    metadata,
  };
}

function normalizeFromArray(arr, source) {
  const lines = (arr || []).map(mapToLine).filter(Boolean);
  const subtotal = lines.reduce((s, x) => s + x.quantity * num(x.unitPrice, 0), 0);
  return {
    items: lines,
    subtotal,
    discount: 0,
    tax: 0,
    shipping: 0,
    shippingTotal: 0,
    source,
  };
}

export async function readCartSnapshot() {
  // 1) Client CartApi
  try {
    const items = CartApi?.items?.();
    if (Array.isArray(items) && items.length) {
      const normalized = normalizeFromArray(items, "client:CartApi");
      if (normalized.items.length) return normalized;
    }
  } catch {}

  // 2) Window globals
  try {
    if (typeof window !== "undefined") {
      const g = window.__CART__ || window.__SHOP_CART__ || null;
      if (g) {
        if (Array.isArray(g?.items) && g.items.length) {
          const n = normalizeFromArray(g.items, "win:__CART__");
          if (n.items.length) return n;
        }
        if (Array.isArray(g) && g.length) {
          const n = normalizeFromArray(g, "win:array");
          if (n.items.length) return n;
        }
      }
    }
  } catch {}

  // 3) localStorage keys (SSR-safe)
  if (typeof window !== "undefined" && window.localStorage) {
    for (const k of FALLBACK_KEYS) {
      try {
        const raw = window.localStorage.getItem(k);
        if (!raw) continue;
        const data = JSON.parse(raw);

        if (Array.isArray(data?.items) && data.items.length) {
          const n = normalizeFromArray(data.items, `local:${k}`);
          if (n.items.length) return n;
        }
        if (Array.isArray(data?.cart?.items) && data.cart.items.length) {
          const n = normalizeFromArray(data.cart.items, `local:${k}:cart.items`);
          if (n.items.length) return n;
        }
        if (Array.isArray(data) && data.length) {
          const n = normalizeFromArray(data, `local:${k}:array`);
          if (n.items.length) return n;
        }
      } catch {}
    }
  }

  return {
    items: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    shipping: 0,
    shippingTotal: 0,
    source: "empty",
  };
}

/** Persist snapshot to window + localStorage without causing re-emit loops. */
export function persistSnapshot(snapshot) {
  try {
    if (!snapshot || !Array.isArray(snapshot.items)) return;

    // normalize minimal stored shape
    const payload = { items: snapshot.items.map(mapToLine).filter(Boolean) };
    const nextStr = JSON.stringify(payload);

    // read last stringified version (both global & LS)
    const prevStr =
      (typeof window !== "undefined" && window.__CART_STR__) ||
      (typeof window !== "undefined" &&
        window.localStorage?.getItem("TDLC_CART_STR")) ||
      "";

    // only write & dispatch if changed
    if (nextStr !== prevStr) {
      if (typeof window !== "undefined") {
        window.__CART__ = payload;
        window.__CART_STR__ = nextStr;
        window.localStorage?.setItem("TDLC_CART", nextStr); // minimal uniform shape
        window.localStorage?.setItem("tdlc_cart_v1", nextStr);
        window.localStorage?.setItem("TDLC_CART_STR", nextStr);

        // Dispatch once; listeners (Summary, etc.) must NOT re-persist to avoid loops
        window.dispatchEvent(new Event("cart:changed"));
      }
    }
  } catch {}
}

/** Try to extract any cart token/id useful for strict backends. */
export function extractCartTokenLike() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const keys = [
        "tdlc_cart_id",
        "cart_id",
        "cartId",
        "cart_token",
        "cartToken",
        "TDLC_CART_ID",
      ];
      for (const k of keys) {
        const v = window.localStorage.getItem(k);
        if (v && typeof v === "string") return v.replace(/"/g, "");
      }
    }
  } catch {}
  return null;
}
