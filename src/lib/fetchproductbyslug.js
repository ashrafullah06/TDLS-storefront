// FILE: lib/fetchproductbyslug.js

const RAW_API_BASE =
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.STRAPI_API_URL ||
  "http://localhost:1337";

const API_BASE = RAW_API_BASE
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

const PRODUCT_REVALIDATE_SECONDS = (() => {
  const n = Number(
    process.env.TDLS_PRODUCT_DETAIL_REVALIDATE_SECONDS ?? 60
  );

  if (!Number.isFinite(n) || n <= 0) {
    return 60;
  }

  return Math.min(
    3600,
    Math.max(15, Math.round(n))
  );
})();

const PRODUCT_FETCH_TIMEOUT_MS = (() => {
  const n = Number(
    process.env.TDLS_PRODUCT_DETAIL_FETCH_TIMEOUT_MS ?? 8000
  );

  if (!Number.isFinite(n) || n <= 0) {
    return 8000;
  }

  return Math.min(
    20000,
    Math.max(3000, Math.round(n))
  );
})();

function productTag(slug) {
  return `tdls-product-${String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 160)}`;
}

/**
 * Fetch a single product by slug from Strapi and normalize the shape:
 *   returns: { id, ...flatFields, attributes }
 *
 * Works with BOTH:
 * - Strapi raw: { data: [{ id, attributes: {...} }] }
 * - Flattened:  { data: [{ id, slug, name, ... }] }
 *
 * IMPORTANT:
 * - Product content is cacheable.
 * - A hard timeout prevents a slow Railway/Strapi request from leaving the
 *   Next route stuck on loading forever.
 */
export async function fetchproductbyslug(slug) {
  const cleanSlug =
    String(slug || "").trim();

  if (!cleanSlug) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[fetchproductbyslug] called without slug"
      );
    }

    return null;
  }

  const qs =
    new URLSearchParams({
      "filters[slug][$eq]":
        cleanSlug,

      "populate[image]":
        "*",

      "populate[images]":
        "*",

      "populate[gallery]":
        "*",

      "populate[product_variants][populate]":
        "*,image,color,size",
    });

  const url =
    `${API_BASE}/api/products?${qs.toString()}`;

  const controller =
    new AbortController();

  const timer =
    setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, PRODUCT_FETCH_TIMEOUT_MS);

  let res;

  try {
    res = await fetch(url, {
      method: "GET",

      headers: {
        Accept:
          "application/json",
      },

      signal:
        controller.signal,

      next: {
        revalidate:
          PRODUCT_REVALIDATE_SECONDS,

        tags: [
          "tdls-products",
          productTag(cleanSlug),
        ],
      },
    });
  } catch (e) {
    if (
      process.env.NODE_ENV !==
      "production"
    ) {
      console.error(
        "[fetchproductbyslug] Network/timeout error:",
        e
      );
    }

    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (
      process.env.NODE_ENV !==
      "production"
    ) {
      console.error(
        "[fetchproductbyslug] Bad status:",
        res.status,
        res.statusText
      );
    }

    return null;
  }

  let json;

  try {
    json =
      await res.json();
  } catch (e) {
    if (
      process.env.NODE_ENV !==
      "production"
    ) {
      console.error(
        "[fetchproductbyslug] JSON parse error:",
        e
      );
    }

    return null;
  }

  const node =
    Array.isArray(json?.data)
      ? json.data[0]
      : null;

  if (!node) {
    return null;
  }

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

  const product = {
    ...base,

    attributes:
      attrs,
  };

  if (
    !product.slug &&
    cleanSlug
  ) {
    product.slug =
      cleanSlug;
  }

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

  if (
    !product.variants &&
    attrs.variants
  ) {
    product.variants =
      attrs.variants;
  }

  if (
    !product.product_variants &&
    attrs.product_variants
  ) {
    product.product_variants =
      attrs.product_variants;
  }

  if (
    !product.image &&
    attrs.cover_image
  ) {
    product.image =
      attrs.cover_image;
  }

  return product;
}