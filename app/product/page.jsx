// FILE: app/product/page.jsx
export const revalidate = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import AllProductsClient from "./all-products-client";
import Navbar from "@/components/common/navbar";
import { headers } from "next/headers";

/* ───────── env helpers ───────── */

// Canonical public site URL (for SEO/social). Keep stable.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

/* ───────── SEO (no UI/UX or business logic impact) ───────── */

const BRAND = "TDLS";

const TITLE = "Shop TDLS | Refined Clothing & Timeless Style";

const DESCRIPTION =
  "Explore TDLS clothing shaped by refined design, effortless comfort and timeless character—pieces created to be worn with confidence and remembered.";

const OG_IMAGE = `${SITE_URL}/tdls-social-preview`;

export const metadata = {
  /*
   * ✅ absolute prevents:
   * Shop TDLS | Refined Clothing & Timeless Style | TDLS
   */
  title: {
    absolute: TITLE,
  },

  description: DESCRIPTION,

  alternates: {
    canonical: `${SITE_URL}/product`,
  },

  openGraph: {
    type: "website",
    url: `${SITE_URL}/product`,
    siteName: BRAND,
    title: TITLE,
    description: DESCRIPTION,

    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Shop TDLS — refined clothing, effortless comfort and timeless character.",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

/* ───────── request-aware base URL (prevents origin drift in dev) ───────── */
/**
 * Hydration mismatches commonly happen when SSR uses NEXT_PUBLIC_SITE_URL (www)
 * but the browser is on localhost. We derive the origin from request headers
 * so SSR uses the same origin as the current environment.
 *
 * - Dev: http://localhost:3000
 * - Prod: https://www.thednalabstore.com
 */
async function resolveRequestBaseUrl() {
  try {
    const h = await headers();

    const host =
      h.get("x-forwarded-host") ||
      h.get("host") ||
      SITE_URL.replace(/^https?:\/\//i, "");

    const proto =
      h.get("x-forwarded-proto") ||
      (host.includes("localhost") ? "http" : "https");

    return `${proto}://${host}`.replace(/\/+$/, "");
  } catch {
    return SITE_URL.replace(/\/+$/, "");
  }
}

/* ───────── JSON-LD helper (no UI) ───────── */

function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function getStrapiText(val) {
  if (!val) return "";

  if (typeof val === "string") return val;

  return String(val);
}

function pickStrapiProductSlug(node) {
  return (
    node?.attributes?.slug ||
    node?.slug ||
    node?.attributes?.handle ||
    node?.handle ||
    ""
  );
}

function pickStrapiProductName(node) {
  return (
    getStrapiText(node?.attributes?.name) ||
    getStrapiText(node?.name) ||
    "Product"
  );
}

/* ───────── Strapi fetch helper (via Next proxy) ───────── */

const PRODUCTS_PAGE_SIZE = 24;
const PRODUCTS_FETCH_CONCURRENCY = 3;
const MAX_PRODUCT_PAGES = 1000;

function buildProductsStrapiPath(page) {
  const params = new URLSearchParams();

  params.set(
    "pagination[page]",
    String(page)
  );

  params.set(
    "pagination[pageSize]",
    String(PRODUCTS_PAGE_SIZE)
  );

  params.set(
    "pagination[withCount]",
    "true"
  );

  /*
   * Product media used by ProductCard / QuickView.
   */
  params.set(
    "populate[image]",
    "*"
  );

  params.set(
    "populate[images]",
    "*"
  );

  params.set(
    "populate[gallery]",
    "*"
  );

  /*
   * Current TDLS Strapi product relation.
   */
  params.set(
    "populate[product_variants][populate][sizes]",
    "*"
  );

  params.set(
    "populate[product_variants][populate][image]",
    "*"
  );

  params.set(
    "populate[product_variants][populate][color]",
    "*"
  );

  /*
   * Taxonomy relations used by the existing All Products filter system.
   */
  const taxonomyRelations = [
    "audience_categories",
    "categories",
    "sub_categories",
    "events_products_collections",
    "gender_groups",
    "age_groups",
  ];

  for (const relation of taxonomyRelations) {
    params.set(
      `populate[${relation}][fields][0]`,
      "slug"
    );

    params.set(
      `populate[${relation}][fields][1]`,
      "name"
    );
  }

  return `/products?${params.toString()}`;
}

function readPagination(payload) {
  const p =
    payload?.meta?.pagination ||
    null;

  if (!p) {
    return {
      page: 1,
      pageSize: PRODUCTS_PAGE_SIZE,
      pageCount: 1,
      total: 0,
    };
  }

  const page =
    Number(p.page);

  const pageSize =
    Number(p.pageSize);

  const total =
    Number(p.total);

  const explicitPageCount =
    Number(p.pageCount);

  const safePage =
    Number.isFinite(page) &&
    page > 0
      ? Math.floor(page)
      : 1;

  const safePageSize =
    Number.isFinite(pageSize) &&
    pageSize > 0
      ? Math.floor(pageSize)
      : PRODUCTS_PAGE_SIZE;

  const safeTotal =
    Number.isFinite(total) &&
    total >= 0
      ? Math.floor(total)
      : 0;

  let pageCount =
    Number.isFinite(explicitPageCount) &&
    explicitPageCount > 0
      ? Math.floor(explicitPageCount)
      : safeTotal > 0
      ? Math.ceil(
          safeTotal /
            safePageSize
        )
      : 1;

  pageCount = Math.min(
    MAX_PRODUCT_PAGES,
    Math.max(
      1,
      pageCount
    )
  );

  return {
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    total: safeTotal,
  };
}

/**
 * One proxy request.
 *
 * IMPORTANT:
 * A Strapi/proxy failure must NOT throw through the Next.js page render.
 * Returning null allows the caller to retry and, if necessary, let the
 * existing AllProductsClient browser fallback take over.
 */
async function fetchProductsPageFromStrapi(
  appBaseUrl,
  page,
  noCache = false
) {
  try {
    const base =
      (
        appBaseUrl ||
        SITE_URL
      ).replace(
        /\/+$/,
        ""
      );

    /*
     * Public catalog reads must remain public so /api/strapi can use its
     * existing CDN + memory cache.
     */
    const url =
      new URL(
        "/api/strapi",
        base
      );

    url.searchParams.set(
      "path",
      buildProductsStrapiPath(
        page
      )
    );

    /*
     * Only the retry bypasses proxy memory/cache.
     */
    if (noCache) {
      url.searchParams.set(
        "noCache",
        "1"
      );
    }

    const res =
      await fetch(
        url.toString(),
        {
          method: "GET",

          headers: {
            Accept:
              "application/json",
          },

          next: {
            revalidate,

            tags: [
              "tdls-products-index",
            ],
          },
        }
      );

    if (!res.ok) {
      return null;
    }

    const payload =
      await res
        .json()
        .catch(
          () => null
        );

    if (
      !payload ||
      payload?.ok !== true
    ) {
      return null;
    }

    const strapiPayload =
      payload?.data ||
      {};

    const list =
      Array.isArray(
        strapiPayload?.data
      )
        ? strapiPayload.data
        : [];

    return {
      products:
        list,

      pagination:
        readPagination(
          strapiPayload
        ),
    };
  } catch {
    /*
     * Never convert temporary Strapi/proxy/network failure into a
     * server-side Next.js exception.
     */
    return null;
  }
}

/**
 * One normal request + one no-cache retry.
 */
async function fetchProductsPageWithRetry(
  appBaseUrl,
  page
) {
  const first =
    await fetchProductsPageFromStrapi(
      appBaseUrl,
      page,
      false
    );

  if (first) {
    return first;
  }

  return await fetchProductsPageFromStrapi(
    appBaseUrl,
    page,
    true
  );
}

function mergeUniqueProducts(
  target,
  incoming
) {
  const out =
    Array.isArray(target)
      ? target
      : [];

  const seen =
    new Set(
      out
        .map(
          (product) =>
            String(
              product?.id ??
                product?.documentId ??
                product?.attributes?.id ??
                product?.slug ??
                product?.attributes?.slug ??
                ""
            )
        )
        .filter(Boolean)
    );

  for (
    const product of
      Array.isArray(incoming)
        ? incoming
        : []
  ) {
    const key =
      String(
        product?.id ??
          product?.documentId ??
          product?.attributes?.id ??
          product?.slug ??
          product?.attributes?.slug ??
          ""
      );

    if (!key) {
      out.push(
        product
      );

      continue;
    }

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    out.push(
      product
    );
  }

  return out;
}

async function fetchProductsFromStrapi(
  appBaseUrl
) {
  /*
   * Page 1 gives both the first 24 products and Strapi pagination metadata.
   *
   * If both attempts fail, return [] instead of throwing.
   * AllProductsClient already contains its browser recovery path.
   */
  const first =
    await fetchProductsPageWithRetry(
      appBaseUrl,
      1
    );

  if (!first) {
    return [];
  }

  const allProducts =
    mergeUniqueProducts(
      [],
      first.products
    );

  const pageCount =
    Math.min(
      MAX_PRODUCT_PAGES,
      Math.max(
        1,
        Number(
          first.pagination
            ?.pageCount ||
            1
        )
      )
    );

  if (
    pageCount <=
    1
  ) {
    return allProducts;
  }

  /*
   * Retrieve remaining pages in small batches.
   *
   * If one required page completely fails, return [] rather than handing
   * the client an incomplete catalog. The browser fallback can then retry
   * the complete catalog itself.
   */
  for (
    let startPage = 2;
    startPage <=
    pageCount;
    startPage +=
    PRODUCTS_FETCH_CONCURRENCY
  ) {
    const pages = [];

    for (
      let offset = 0;
      offset <
        PRODUCTS_FETCH_CONCURRENCY;
      offset++
    ) {
      const page =
        startPage +
        offset;

      if (
        page >
        pageCount
      ) {
        break;
      }

      pages.push(
        page
      );
    }

    const results =
      await Promise.all(
        pages.map(
          (page) =>
            fetchProductsPageWithRetry(
              appBaseUrl,
              page
            )
        )
      );

    /*
     * Do not render a partial catalog as if it were complete.
     */
    if (
      results.some(
        (result) =>
          !result
      )
    ) {
      return [];
    }

    for (
      const result of
        results
    ) {
      mergeUniqueProducts(
        allProducts,
        result.products
      );
    }
  }

  return allProducts;
}

/* ───────── Page component ───────── */

export default async function ProductIndexPage() {
  const requestBaseUrl =
    await resolveRequestBaseUrl();

  /*
   * This function is intentionally non-throwing.
   *
   * If Strapi/proxy is temporarily unavailable it returns [] and the
   * existing AllProductsClient client-side recovery path takes over.
   */
  const products =
    await fetchProductsFromStrapi(
      requestBaseUrl
    );

  const safeList =
    Array.isArray(
      products
    )
      ? products
      : [];

  const itemListJsonLd = {
    "@context":
      "https://schema.org",

    "@type":
      "ItemList",

    name:
      `${BRAND} Products`,

    itemListElement:
      safeList
        .slice(
          0,
          24
        )
        .map(
          (
            p,
            idx
          ) => {
            const slug =
              pickStrapiProductSlug(
                p
              );

            const url =
              slug
                ? `${SITE_URL.replace(
                    /\/+$/,
                    ""
                  )}/product/${encodeURIComponent(
                    slug
                  )}`
                : `${SITE_URL.replace(
                    /\/+$/,
                    ""
                  )}/product`;

            return {
              "@type":
                "ListItem",

              position:
                idx + 1,

              url,

              name:
                pickStrapiProductName(
                  p
                ),
            };
          }
        ),
  };

  return (
    <>
      <script
        id="tdls-product-index-itemlist"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html:
            safeJsonLd(
              itemListJsonLd
            ),
        }}
      />

      <Navbar />

      <AllProductsClient
        products={
          safeList
        }
        siteBaseUrl={
          requestBaseUrl
        }
      />
    </>
  );
}