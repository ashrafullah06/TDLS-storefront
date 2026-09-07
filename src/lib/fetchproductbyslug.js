// FILE: lib/fetchproductbyslug.js

import { cache } from "react";

const RAW_API_BASE =
  process.env.STRAPI_API_ORIGIN ||
  process.env.STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_ORIGIN ||
  process.env.STRAPI_API_URL ||
  "http://localhost:1337";

const API_BASE = String(RAW_API_BASE || "")
  .trim()
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

const PRODUCT_FETCH_RETRY_DELAY_MS = (() => {
  const n = Number(
    process.env.TDLS_PRODUCT_DETAIL_RETRY_DELAY_MS ?? 180
  );

  if (!Number.isFinite(n) || n < 0) {
    return 180;
  }

  return Math.min(
    1500,
    Math.max(0, Math.round(n))
  );
})();

function productTag(slug) {
  return `tdls-product-${String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .slice(0, 160)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status) {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 520 ||
    status === 521
  );
}

function buildProductUrl(cleanSlug) {
  const qs = new URLSearchParams();

  qs.set(
    "filters[slug][$eq]",
    cleanSlug
  );

  // We only need one product for an exact slug lookup.
  qs.set(
    "pagination[page]",
    "1"
  );

  qs.set(
    "pagination[pageSize]",
    "1"
  );

  qs.set(
    "pagination[withCount]",
    "false"
  );

  // Product media used by the product page / metadata.
  qs.set(
    "populate[image]",
    "*"
  );

  qs.set(
    "populate[images]",
    "*"
  );

  qs.set(
    "populate[gallery]",
    "*"
  );

  /*
   * Preferred TDLS Strapi relation.
   *
   * The previous request used:
   *   populate[product_variants][populate]=*,image,color,size
   *
   * That is much broader and can produce a slow / invalid deep-populate query.
   * Request only the nested relations actually needed by the storefront.
   */
  qs.set(
    "populate[product_variants][populate][sizes]",
    "*"
  );

  qs.set(
    "populate[product_variants][populate][image]",
    "*"
  );

  qs.set(
    "populate[product_variants][populate][color]",
    "*"
  );

  return `${API_BASE}/api/products?${qs.toString()}`;
}

async function fetchProductResponse(url, cleanSlug) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, PRODUCT_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",

      headers: {
        Accept: "application/json",
      },

      signal: controller.signal,

      next: {
        revalidate: PRODUCT_REVALIDATE_SECONDS,

        tags: [
          "tdls-products",
          productTag(cleanSlug),
        ],
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProductJson(url, cleanSlug) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0 && PRODUCT_FETCH_RETRY_DELAY_MS > 0) {
      await sleep(PRODUCT_FETCH_RETRY_DELAY_MS);
    }

    let res;

    try {
      res = await fetchProductResponse(
        url,
        cleanSlug
      );
    } catch (e) {
      lastError = e;

      if (attempt === 0) {
        continue;
      }

      if (process.env.NODE_ENV !== "production") {
        console.error(
          "[fetchproductbyslug] Network/timeout error:",
          e
        );
      }

      return null;
    }

    if (!res.ok) {
      if (
        attempt === 0 &&
        shouldRetryStatus(res.status)
      ) {
        continue;
      }

      if (process.env.NODE_ENV !== "production") {
        console.error(
          "[fetchproductbyslug] Bad status:",
          res.status,
          res.statusText
        );
      }

      return null;
    }

    try {
      return await res.json();
    } catch (e) {
      lastError = e;

      if (attempt === 0) {
        continue;
      }

      if (process.env.NODE_ENV !== "production") {
        console.error(
          "[fetchproductbyslug] JSON parse error:",
          e
        );
      }

      return null;
    }
  }

  if (
    lastError &&
    process.env.NODE_ENV !== "production"
  ) {
    console.error(
      "[fetchproductbyslug] Fetch failed:",
      lastError
    );
  }

  return null;
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
 * - Exact slug requests are limited to pageSize=1.
 * - Nested product-variant population is explicit instead of wildcard/deep.
 * - A hard per-attempt timeout prevents a slow Railway/Strapi request from
 *   leaving the Next route stuck on loading forever.
 * - React cache deduplicates repeated lookups for the same slug during one
 *   server render/request (for example metadata + page rendering).
 */
const fetchProductBySlugCached = cache(async (slug) => {
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

  const url = buildProductUrl(cleanSlug);

  const json = await fetchProductJson(
    url,
    cleanSlug
  );

  if (!json) {
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
});

export async function fetchproductbyslug(slug) {
  return fetchProductBySlugCached(slug);
}