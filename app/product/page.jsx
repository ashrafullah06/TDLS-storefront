// FILE: app/product/page.jsx

export const revalidate = 60;
export const runtime = "nodejs";
export const maxDuration = 60;

import AllProductsClient from "./all-products-client";
import Navbar from "@/components/common/navbar";
import { headers } from "next/headers";
import { fetchStrapiProxy } from "@/lib/strapi-proxy";

/* ───────── Environment helpers ───────── */

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

const RAW_STRAPI_ORIGIN =
  process.env.STRAPI_API_ORIGIN ||
  process.env.STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_ORIGIN ||
  process.env.STRAPI_API_URL ||
  "http://127.0.0.1:1337";

const STRAPI_ORIGIN = String(RAW_STRAPI_ORIGIN || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

/* ───────── SEO ───────── */

const BRAND = "TDLS";

const TITLE = "Shop TDLS | Refined Clothing & Timeless Style";

const DESCRIPTION =
  "Explore TDLS clothing shaped by refined design, effortless comfort and timeless character—pieces created to be worn with confidence and remembered.";

const OG_IMAGE = `${SITE_URL}/tdls-social-preview`;

export const metadata = {
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

/* ───────── Request-aware base URL ───────── */

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

/* ───────── JSON-LD helpers ───────── */

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

/* ───────── Strapi fetch helpers ───────── */

const PRODUCTS_PAGE_SIZE = 24;
const MAX_PRODUCT_PAGES = 1000;

function buildProductsStrapiPath(page) {
  const params = new URLSearchParams();

  params.set("sort", "id:asc");
  params.set("pagination[page]", String(page));
  params.set("pagination[pageSize]", String(PRODUCTS_PAGE_SIZE));
  params.set("pagination[withCount]", "true");

  return `/products?${params.toString()}`;
}

function readPagination(payload) {
  const p = payload?.meta?.pagination || null;

  if (!p) {
    return {
      page: 1,
      pageSize: PRODUCTS_PAGE_SIZE,
      pageCount: 1,
      total: 0,
    };
  }

  const page = Number(p.page);
  const pageSize = Number(p.pageSize);
  const total = Number(p.total);
  const explicitPageCount = Number(p.pageCount);

  const safePage =
    Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  const safePageSize =
    Number.isFinite(pageSize) && pageSize > 0
      ? Math.floor(pageSize)
      : PRODUCTS_PAGE_SIZE;

  const safeTotal =
    Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0;

  let pageCount =
    Number.isFinite(explicitPageCount) && explicitPageCount > 0
      ? Math.floor(explicitPageCount)
      : safeTotal > 0
        ? Math.ceil(safeTotal / safePageSize)
        : 1;

  pageCount = Math.min(MAX_PRODUCT_PAGES, Math.max(1, pageCount));

  return {
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    total: safeTotal,
  };
}

async function fetchProductsPageFromStrapi(
  appBaseUrl,
  page,
  noCache = false
) {
  // Execute the same public proxy used by collection pages directly
  // on the server, without an HTTP request back to this application.
  const proxyUrl = new URL("/api/strapi", "http://tdls.internal");
  proxyUrl.searchParams.set("path", buildProductsStrapiPath(page));

  if (noCache) {
    proxyUrl.searchParams.set("noCache", "1");
  }

  const response = await fetchStrapiProxy(
    new Request(proxyUrl, {
      headers: { Accept: "application/json" },
    })
  );

  if (!response.ok) {
    throw new Error(
      `Product catalogue request failed (HTTP ${response.status}).`
    );
  }

  const payload = await response.json().catch(() => null);
  const strapiPayload = payload?.ok === true ? payload.data : null;

  if (!Array.isArray(strapiPayload?.data)) {
    throw new Error("Invalid product catalogue response.");
  }

  return {
    products: strapiPayload.data,
    pagination: readPagination(strapiPayload),
  };
}

async function fetchProductsPageWithRetry(appBaseUrl, page) {
  try {
    return await fetchProductsPageFromStrapi(
      appBaseUrl,
      page
    );
  } catch (firstError) {
    try {
      return await fetchProductsPageFromStrapi(
        appBaseUrl,
        page,
        true
      );
    } catch (retryError) {
      if (
        retryError instanceof Error &&
        retryError.cause == null
      ) {
        retryError.cause = firstError;
      }

      throw retryError;
    }
  }
}

async function fetchProductsFromStrapi(appBaseUrl) {
  // Render page 1 first. The client progressively loads remaining pages.
  return fetchProductsPageWithRetry(appBaseUrl, 1);
}

/* ───────── Page component ───────── */

export default async function ProductIndexPage() {
  const requestBaseUrl = await resolveRequestBaseUrl();

  let firstPage;

  try {
    firstPage = await fetchProductsFromStrapi(requestBaseUrl);
  } catch (error) {
    console.error(
      "[products] Catalogue request failed:",
      error.message
    );

    return (
      <>
        <Navbar />

        <main
          className="max-w-4xl mx-auto px-4 py-16"
          role="alert"
        >
          <h1 className="text-2xl font-semibold">
            Products could not be loaded
          </h1>

          <p className="mt-3">
            The product service is temporarily unavailable.
            Please try again.
          </p>

          <a
            className="inline-block mt-4 underline"
            href="/product"
          >
            Try again
          </a>
        </main>
      </>
    );
  }

  const safeList = Array.isArray(firstPage?.products)
    ? firstPage.products
    : [];

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${BRAND} Products`,
    itemListElement: safeList.slice(0, 24).map((p, idx) => {
      const slug = pickStrapiProductSlug(p);

      const url = slug
        ? `${SITE_URL.replace(/\/+$/, "")}/product/${encodeURIComponent(slug)}`
        : `${SITE_URL.replace(/\/+$/, "")}/product`;

      return {
        "@type": "ListItem",
        position: idx + 1,
        url,
        name: pickStrapiProductName(p),
      };
    }),
  };

  return (
    <>
      <script
        id="tdls-product-index-itemlist"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(itemListJsonLd),
        }}
      />

      <Navbar />

      <AllProductsClient
        products={safeList}
        initialPageCount={firstPage.pagination.pageCount}
        siteBaseUrl={requestBaseUrl}
      />
    </>
  );
}