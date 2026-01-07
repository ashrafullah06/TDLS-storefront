// FILE: lib/fetchproductbyslug.js

const RAW_API_BASE =
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.STRAPI_API_URL ||
  "http://localhost:1337";

// Normalize base (remove trailing slash and trailing /api)
const API_BASE = RAW_API_BASE.replace(/\/+$/, "").replace(/\/api$/, "");

/**
 * Fetch a single product by slug from Strapi and normalize the shape:
 *   returns: { id, ...flatFields, attributes }
 *
 * Works with BOTH:
 * - Strapi raw: { data: [{ id, attributes: {...} }] }
 * - Flattened:  { data: [{ id, slug, name, ... }] }
 */
export async function fetchproductbyslug(slug) {
  if (!slug) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[fetchproductbyslug] called without slug");
    }
    return null;
  }

  const qs = new URLSearchParams({
    "filters[slug][$eq]": slug,
    // pull in images + variants
    "populate[image]": "*",
    "populate[images]": "*",
    "populate[gallery]": "*",
    "populate[product_variants][populate]": "*,image,color,size",
  });

  const url = `${API_BASE}/api/products?${qs.toString()}`;

  let res;
  try {
    res = await fetch(url, {
      cache: "no-store",
    });
  } catch (e) {
    console.error("[fetchproductbyslug] Network error:", e);
    return null;
  }

  if (!res.ok) {
    console.error("[fetchproductbyslug] Bad status:", res.status, res.statusText);
    return null;
  }

  let json;
  try {
    json = await res.json();
  } catch (e) {
    console.error("[fetchproductbyslug] JSON parse error:", e);
    return null;
  }

  const node = Array.isArray(json?.data) ? json.data[0] : null;
  if (!node) return null;

  // SUPPORT BOTH:
  // - node = { id, attributes: {...} }
  // - node = { id, slug, name, ... } (flattened)
  const attrs = node.attributes || node || {};

  const base = {
    id: node.id ?? attrs.id ?? null,
    ...attrs,
  };

  // keep attributes alias for any older code expecting product.attributes.x
  const product = {
    ...base,
    attributes: attrs,
  };

  // Ensure slug exists at top-level
  if (!product.slug && slug) {
    product.slug = slug;
  }

  // Map currency from price_currency if needed
  if (!product.currency && (attrs.price_currency || attrs.currency)) {
    product.currency = attrs.price_currency || attrs.currency;
  }

  // Hoist variants if they came under attributes
  if (!product.variants && attrs.variants) {
    product.variants = attrs.variants;
  }

  // Maintain any product_variants relation as top-level if present
  if (!product.product_variants && attrs.product_variants) {
    product.product_variants = attrs.product_variants;
  }

  // If you want a simple primary image, you can also hoist cover_image:
  if (!product.image && attrs.cover_image) {
    product.image = attrs.cover_image;
  }

  return product;
}
