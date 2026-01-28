// FILE: app/sitemap-static.xml/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getBaseUrl, toXml } from "@/lib/site";

export const revalidate = 600;

function normalizePath(p) {
  const s = String(p || "").trim();
  if (!s) return "/";
  if (!s.startsWith("/")) return `/${s}`;
  return s.replace(/\/+$/, "") || "/";
}

export async function GET() {
  const baseUrl = getBaseUrl();
  const now = new Date().toISOString();

  /**
   * STATIC + PUBLIC ROUTES ONLY.
   * No user-specific or auth/checkout/cart/orders/search pages here.
   *
   * Keep this list aligned with your real `app/` routes.
   */

  const urls = [
    { loc: `${baseUrl}${normalizePath("/")}`, lastmod: now, changefreq: "daily", priority: 1.0 },
    { loc: `${baseUrl}${normalizePath("/product")}`, lastmod: now, changefreq: "daily", priority: 0.9 },
    { loc: `${baseUrl}${normalizePath("/collections")}`, lastmod: now, changefreq: "weekly", priority: 0.8 },
    { loc: `${baseUrl}${normalizePath("/health")}`, lastmod: now, changefreq: "weekly", priority: 0.6 },
  ];

  const xml = toXml(urls);

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
      "X-TDLS-Sitemap-Count": String(urls.length),
    },
  });
}
