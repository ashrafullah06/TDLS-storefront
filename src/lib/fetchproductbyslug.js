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
  "http://127.0.0.1:1337";

const API_BASE = String(RAW_API_BASE || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

const PRODUCT_REVALIDATE_SECONDS = (() => {
  const n = Number(
    process.env.TDLS_PRODUCT_DETAIL_REVALIDATE_SECONDS ?? 60
  );

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return 60;
  }

  return Math.min(
    3600,
    Math.max(
      15,
      Math.round(n)
    )
  );
})();

const PRODUCT_FETCH_TIMEOUT_MS = (() => {
  const n = Number(
    process.env.TDLS_PRODUCT_DETAIL_FETCH_TIMEOUT_MS ?? 8000
  );

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return 8000;
  }

  return Math.min(
    20000,
    Math.max(
      3000,
      Math.round(n)
    )
  );
})();

function productTag(slug) {
  return `tdls-product-${String(
    slug ||
      ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9-_]/g,
      "-"
    )
    .slice(
      0,
      160
    )}`;
}

function buildProductUrl(
  cleanSlug,
  mode = "auto"
) {
  const qs =
    new URLSearchParams();

  qs.set(
    "filters[slug][$eq]",
    cleanSlug
  );

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

  if (
    mode ===
    "auto"
  ) {
    /*
     * Schema-aware populate: Strapi itself populates the relations that
     * actually exist. This avoids false 400s caused by a stale hard-coded
     * relation name.
     */
    qs.set(
      "populate",
      "*"
    );
  }

  return `${API_BASE}/api/products?${qs.toString()}`;
}

async function requestProduct(
  cleanSlug,
  mode
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        try {
          controller.abort();
        } catch {}
      },
      PRODUCT_FETCH_TIMEOUT_MS
    );

  try {
    const res =
      await fetch(
        buildProductUrl(
          cleanSlug,
          mode
        ),
        {
          method:
            "GET",

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
              productTag(
                cleanSlug
              ),
            ],
          },
        }
      );

    if (!res.ok) {
      return null;
    }

    const json =
      await res
        .json()
        .catch(
          () => null
        );

    const node =
      Array.isArray(
        json?.data
      )
        ? json.data[0]
        : null;

    return (
      node ||
      null
    );
  } catch {
    return null;
  } finally {
    clearTimeout(
      timer
    );
  }
}

function normalizeProduct(
  node,
  cleanSlug
) {
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

const fetchProductBySlugCached =
  cache(
    async (
      slug
    ) => {
      const cleanSlug =
        String(
          slug ||
            ""
        ).trim();

      if (!cleanSlug) {
        return null;
      }

      /*
       * First try schema-aware populate for the complete product.
       *
       * If population is rejected, retry the exact slug with NO populate.
       * A real product must never become "Product not found" because one
       * populate relation changed.
       */
      const node =
        (
          await requestProduct(
            cleanSlug,
            "auto"
          )
        ) ||
        (
          await requestProduct(
            cleanSlug,
            "minimal"
          )
        );

      return normalizeProduct(
        node,
        cleanSlug
      );
    }
  );

export async function fetchproductbyslug(
  slug
) {
  return fetchProductBySlugCached(
    slug
  );
}