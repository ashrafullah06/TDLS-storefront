// FILE: lib/fetchproductbyslug.js

import { cache } from "react";

const RAW_API_BASE =
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.STRAPI_API_URL ||
  "http://localhost:1337";

// Normalize base (remove trailing slash and trailing /api)
const API_BASE = RAW_API_BASE.replace(/\/+$/, "").replace(/\/api$/, "");

/*
 * Product content does not need to hit Strapi on every request.
 *
 * Stock remains handled independently by the product page / Prisma,
 * so caching the Strapi product document does not replace live stock logic.
 */
const PRODUCT_REVALIDATE_SECONDS = (() => {
  const n = Number(process.env.TDLS_PRODUCT_REVALIDATE_SEC ?? 60);

  if (!Number.isFinite(n) || n < 1) {
    return 60;
  }

  return Math.min(3600, Math.max(15, Math.round(n)));
})();

function productCacheTag(slug) {
  const clean = String(slug || "")
    .trim()
    .slice(0, 180);

  return clean
    ? `tdls-product:${clean}`
    : "tdls-product";
}

/**
 * Fetch a single product by slug from Strapi and normalize the shape:
 *   returns: { id, ...flatFields, attributes }
 *
 * Works with BOTH:
 * - Strapi raw: { data: [{ id, attributes: {...} }] }
 * - Flattened:  { data: [{ id, slug, name, ... }] }
 *
 * Performance:
 * - Uses the Next.js Data Cache instead of `cache: "no-store"`.
 * - Revalidates product content periodically.
 * - The exported function is wrapped in React `cache()` so
 *   generateMetadata() and the page render share the same request.
 */
async function fetchProductBySlugInternal(slug) {
  if (!slug) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[fetchproductbyslug] called without slug");
    }

    return null;
  }

  const cleanSlug = String(slug).trim();

  if (!cleanSlug) {
    return null;
  }

  const qs = new URLSearchParams({
    "filters[slug][$eq]": cleanSlug,

    // Keep existing product-detail population exactly intact.
    "populate[image]": "*",
    "populate[images]": "*",
    "populate[gallery]": "*",
    "populate[product_variants][populate]": "*,image,color,size",
  });

  const url =
    `${API_BASE}/api/products?${qs.toString()}`;

  let res;

  try {
    res = await fetch(url, {
      method: "GET",

      headers: {
        Accept: "application/json",
      },

      next: {
        revalidate: PRODUCT_REVALIDATE_SECONDS,

        tags: [
          "tdls-products",
          productCacheTag(cleanSlug),
        ],
      },
    });
  } catch (e) {
    console.error(
      "[fetchproductbyslug] Network error:",
      e
    );

    return null;
  }

  if (!res.ok) {
    console.error(
      "[fetchproductbyslug] Bad status:",
      res.status,
      res.statusText
    );

    return null;
  }

  let json;

  try {
    json = await res.json();
  } catch (e) {
    console.error(
      "[fetchproductbyslug] JSON parse error:",
      e
    );

    return null;
  }

  const node =
    Array.isArray(json?.data)
      ? json.data[0]
      : null;

  if (!node) {
    return null;
  }

  // SUPPORT BOTH:
  // - node = { id, attributes: {...} }
  // - node = { id, slug, name, ... } (flattened)
  const attrs =
    node.attributes ||
    node ||
    {};

  const base = {
    id:
      node.id ??
      attrs.id ??
      null,

    ...attrs,
  };

  // Keep attributes alias for any older code expecting product.attributes.x
  const product = {
    ...base,
    attributes: attrs,
  };

  // Ensure slug exists at top-level
  if (!product.slug && cleanSlug) {
    product.slug = cleanSlug;
  }

  // Map currency from price_currency if needed
  if (
    !product.currency &&
    (
      attrs.price_currency ||
      attrs.currency
    )
  ) {
    product.currency =
      attrs.price_currency ||
      attrs.currency;
  }

  // Hoist variants if they came under attributes
  if (
    !product.variants &&
    attrs.variants
  ) {
    product.variants =
      attrs.variants;
  }

  // Maintain any product_variants relation as top-level if present
  if (
    !product.product_variants &&
    attrs.product_variants
  ) {
    product.product_variants =
      attrs.product_variants;
  }

  // If you want a simple primary image, also hoist cover_image.
  if (
    !product.image &&
    attrs.cover_image
  ) {
    product.image =
      attrs.cover_image;
  }

  return product;
}

/*
 * Request-level memoization:
 *
 * app/product/[slug]/page.js currently calls fetchproductbyslug()
 * from both generateMetadata() and ProductPage().
 *
 * This makes those consumers share the same result for the same slug
 * during a render instead of performing duplicate work.
 */
export const fetchproductbyslug =
  cache(fetchProductBySlugInternal);