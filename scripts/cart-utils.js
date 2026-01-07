// FILE: src/lib/cart-utils.js

/**
 * Shared cart helpers.
 *
 * These are used to:
 *  - Clamp quantities consistently
 *  - Derive "max available" from any of the stock fields we use
 *  - Normalize cart lines into the shape expected by /api/cart/sync
 */

/* ---------------- numeric helpers ---------------- */

export function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n | 0 : fallback;
}

export function toMoney(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

/* ---------------- stock helper (same semantics as backend) ---------------- */

export function effectiveMaxAvailable(item) {
  if (!item || typeof item !== "object") return null;

  const fields = [
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
    // Strapi size stock fields
    "stock_quantity",
    "stockQuantity",
    "sizeStock",
    "size_stock",
    "strapiStockQty",
    "strapi_stock_qty",
  ];

  const vals = [];

  for (const f of fields) {
    const v = toInt(item[f], 0);
    if (v > 0) vals.push(v);
  }

  if (!vals.length) return null;
  return Math.max(...vals);
}

/* ---------------- cart line normalizer ---------------- */

/**
 * Normalize a cart item into the shape expected by /api/cart/sync.
 *
 * Supports:
 *  - Items produced by ClientUX.handleAddToCart (product detail page)
 *  - Items from src/lib/cart.js CartApi (localStorage)
 *  - Items from any legacy shape that uses { qty, color, size, ... }
 */
export function normalizeCartItemForSync(raw) {
  if (!raw || typeof raw !== "object") return null;

  const quantity = Math.max(
    1,
    toInt(
      raw.quantity ??
        raw.qty ??
        raw.count ??
        raw.amount ??
        1,
      1
    )
  );

  const selectedColor =
    raw.selectedColor ??
    raw.color ??
    raw.colour ??
    raw.colorName ??
    null;

  const selectedSize =
    raw.selectedSize ??
    raw.size ??
    raw.sizeName ??
    null;

  const productId =
    raw.productId ??
    raw.product_id ??
    raw.product?.id ??
    null;

  const slug =
    raw.slug ??
    raw.product_slug ??
    raw.product?.slug ??
    null;

  const variantId =
    raw.variantId ??
    raw.variant_id ??
    raw.id ??
    raw.variant?.id ??
    null;

  const strapiSizeId =
    raw.strapiSizeId ??
    raw.strapi_size_id ??
    raw.sizeId ??
    raw.size_id ??
    null;

  const price =
    raw.price ??
    raw.unitPrice ??
    raw.unit_price ??
    raw.unit ??
    0;

  const currency =
    raw.currency ??
    raw.currencyCode ??
    raw.product?.currency ??
    "BDT";

  const sku =
    raw.sku ??
    raw.variant?.sku ??
    raw.product?.sku ??
    null;

  const maxAvailable = effectiveMaxAvailable(raw);

  let finalQty = quantity;
  if (maxAvailable != null) {
    finalQty = Math.min(finalQty, maxAvailable);
  }
  if (finalQty <= 0) return null;

  return {
    productId: productId ? String(productId) : null,
    slug: slug ? String(slug) : null,
    variantId: variantId ? String(variantId) : null,
    strapiSizeId: strapiSizeId ?? null,
    selectedColor: selectedColor || null,
    selectedSize: selectedSize || null,
    quantity: finalQty,
    price: toMoney(price, 0),
    currency: String(currency || "BDT").toUpperCase(),
    sku: sku || null,
    maxAvailable,
    // keep a reference to the raw item in case callers need it
    _raw: raw,
  };
}

/**
 * Build the payload you send to /api/cart/sync from a list of cart items.
 */
export function buildSyncPayloadFromCart(items, explicitCurrency) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((it) => normalizeCartItemForSync(it))
    .filter(Boolean);

  if (!normalized.length) {
    return { items: [], currency: explicitCurrency || "BDT" };
  }

  const currency =
    explicitCurrency ||
    normalized[0].currency ||
    "BDT";

  return {
    currency,
    items: normalized.map(
      ({ _raw, ...line }) => line // strip _raw
    ),
  };
}
