// FILE: app/product/page.jsx
export const dynamic = "force-dynamic";

import AllProductsClient from "./all-products-client";
import Navbar from "@/components/common/navbar";

/* ───────── env helpers ───────── */

const STRAPI_PROXY_SECRET = process.env.STRAPI_SYNC_SECRET || "";

// Base URL for this Next app (for server-side fetch to /api/strapi)
const APP_BASE_URL =
  process.env.AUTH_URL ||
  process.env.NEXTAUTH_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000";

/* ───────── Strapi fetch helper (via Next proxy) ───────── */

async function fetchProductsFromStrapi() {
  if (!STRAPI_PROXY_SECRET) {
    throw new Error("STRAPI_SYNC_SECRET is not set in environment");
  }

  // /api/strapi?path=/products?populate=*
  const url = new URL("/api/strapi", APP_BASE_URL);
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
  const products = await fetchProductsFromStrapi();
  const safeList = Array.isArray(products) ? products : [];

  return (
    <>
      {/* Shared premium navbar, same as cart & collections */}
      <Navbar />
      {/* AllProductsClient is a "use client" component */}
      <AllProductsClient products={safeList} />
    </>
  );
}
