// FILE: app/product/page.jsx
export const dynamic = "force-dynamic";

import AllProductsClient from "./all-products-client";
import Navbar from "@/components/common/navbar";
import { headers } from "next/headers";

/* ───────── env helpers ───────── */

const STRAPI_PROXY_SECRET = process.env.STRAPI_SYNC_SECRET || "";

// Canonical public site URL (for SEO/social). Keep stable.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

/* ───────── SEO (no UI/UX or business logic impact) ───────── */

const BRAND = "TDLS";
const TITLE = `${BRAND} — Premium multi-product ecommerce`;
const DESCRIPTION =
  "TDLS is a premium multi-product ecommerce brand. Shop curated essentials across multiple categories with a clean, reliable buying experience.";
const OG_IMAGE = `${SITE_URL}/favicon.ico`;

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/product` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/product`,
    siteName: BRAND,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 256,
        height: 256,
        alt: BRAND,
      },
    ],
  },
  twitter: {
    card: "summary",
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
    const h = await headers(); // ✅ Next.js 15: headers() is async
    const host =
      h.get("x-forwarded-host") ||
      h.get("host") ||
      SITE_URL.replace(/^https?:\/\//i, "");
    const proto =
      h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
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
  if (!STRAPI_PROXY_SECRET) {
    throw new Error("STRAPI_SYNC_SECRET is not set in environment");
  }

  const base = (appBaseUrl || SITE_URL).replace(/\/+$/, "");

  // /api/strapi?path=/products?populate=*
  const url = new URL("/api/strapi", base);
  url.searchParams.set("path", "/products?populate=*");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-strapi-sync-secret": STRAPI_PROXY_SECRET,
    },
    cache: "no-store",
    next: { revalidate: 0 },
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
    throw new Error("Failed to parse JSON from /api/strapi: " + e.message);
  });

  if (!payload?.ok) {
    throw new Error(
      `Strapi proxy payload error: ${payload?.error || "UNKNOWN"} – ${
        payload?.message || ""
      }`
    );
  }

  // Strapi products live under payload.data.data
  const list = payload.data?.data;
  return Array.isArray(list) ? list : [];
}

/* ───────── Page component ───────── */

export default async function ProductIndexPage() {
  const requestBaseUrl = await resolveRequestBaseUrl(); // ✅ await the async helper

  const products = await fetchProductsFromStrapi(requestBaseUrl);
  const safeList = Array.isArray(products) ? products : [];

  // Optional: JSON-LD ItemList (no UI change) — helps crawlers understand this page lists products.
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
      {/* JSON-LD (no UI) */}
      <script
        id="tdls-product-index-itemlist"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(itemListJsonLd) }}
      />

      {/* Shared premium navbar, same as cart & collections */}
      <Navbar />

      {/* AllProductsClient is a "use client" component */}
      {/* siteBaseUrl prop is provided to keep SSR/CSR origin consistent (no UI change). */}
      <AllProductsClient products={safeList} siteBaseUrl={requestBaseUrl} />
    </>
  );
}
