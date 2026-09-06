// FILE: app/product/page.jsx
export const revalidate = 60;
export const runtime = "nodejs";

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

async function fetchProductsFromStrapi(appBaseUrl) {
  const base = (appBaseUrl || SITE_URL).replace(/\/+$/, "");

  /*
   * Public catalog reads must remain public so /api/strapi can use its
   * existing CDN + memory cache. Supplying STRAPI_SYNC_SECRET here would
   * intentionally disable that cache inside the proxy.
   */
  const url = new URL("/api/strapi", base);

  url.searchParams.set("path", "/products?populate=*");

  const res = await fetch(url.toString(), {
    method: "GET",

    headers: {
      Accept: "application/json",
    },

    next: {
      revalidate,
      tags: ["tdls-products-index"],
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");

    throw new Error(
      `Strapi proxy HTTP error ${res.status} ${res.statusText} – ${
        txt || "no response body"
      }`
    );
  }

  const payload = await res.json().catch((e) => {
    throw new Error(
      "Failed to parse JSON from /api/strapi: " + e.message
    );
  });

  if (!payload?.ok) {
    throw new Error(
      `Strapi proxy payload error: ${payload?.error || "UNKNOWN"} – ${
        payload?.message || ""
      }`
    );
  }

  const list = payload.data?.data;

  return Array.isArray(list) ? list : [];
}

/* ───────── Page component ───────── */

export default async function ProductIndexPage() {
  const requestBaseUrl = await resolveRequestBaseUrl();

  const products = await fetchProductsFromStrapi(requestBaseUrl);

  const safeList = Array.isArray(products) ? products : [];

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
        siteBaseUrl={requestBaseUrl}
      />
    </>
  );
}