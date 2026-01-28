// FILE: app/sitemap.xml/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/site";

export const revalidate = 300;

function truthyEnv(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toSitemapIndexXml(list) {
  const body = list
    .map((it) => {
      const loc = `<loc>${escapeXml(it.loc)}</loc>`;
      const lastmod = it.lastmod ? `<lastmod>${escapeXml(it.lastmod)}</lastmod>` : "";
      return `<sitemap>${loc}${lastmod}</sitemap>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    body +
    `</sitemapindex>`
  );
}

function normalizeIndexPath(p, fallback) {
  const raw = String(p || "").trim();
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw; // already absolute
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/* ---------------- strict public-only enforcement ---------------- */

const FORBIDDEN_PREFIXES = [
  "/admin",
  "/api",
  "/internal",
  "/draft",
  "/private",
  "/preview",
  "/login",
  "/signin",
  "/signup",
  "/logout",
  "/account",
  "/customer",
  "/profile",
  "/orders",
  "/cart",
  "/checkout",
  "/info",
];

function stripQueryHash(s) {
  const x = String(s || "").trim();
  if (!x) return "";
  const q = x.indexOf("?");
  const h = x.indexOf("#");
  const cut =
    q === -1 && h === -1 ? x : x.slice(0, Math.min(q === -1 ? x.length : q, h === -1 ? x.length : h));
  return cut.trim();
}

function looksLikeSitemapXmlPath(p) {
  const s = stripQueryHash(p);
  // Defensive: require .xml and "sitemap" somewhere in the path to avoid accidental inclusion.
  return /\.xml$/i.test(s) && /sitemap/i.test(s);
}

function isForbiddenPath(pathname) {
  const p = String(pathname || "");
  return FORBIDDEN_PREFIXES.some((fx) => p === fx || p.startsWith(fx + "/"));
}

function isSafePublicSitemapTarget(pathOrAbs) {
  const raw = String(pathOrAbs || "").trim();
  if (!raw) return { ok: false };

  // Absolute URL
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(stripQueryHash(raw));
      if (!looksLikeSitemapXmlPath(u.pathname)) return { ok: false };
      if (isForbiddenPath(u.pathname)) return { ok: false };
      return { ok: true, kind: "abs", loc: u.toString() };
    } catch {
      return { ok: false };
    }
  }

  // Site-relative
  const relRaw = stripQueryHash(raw);
  const rel = relRaw.startsWith("/") ? relRaw : `/${relRaw}`;
  if (!looksLikeSitemapXmlPath(rel)) return { ok: false };
  if (isForbiddenPath(rel)) return { ok: false };
  return { ok: true, kind: "rel", rel };
}

/* ---------------- route ---------------- */

export async function GET() {
  const baseUrl = String(getBaseUrl() || "").replace(/\/+$/, "");
  const now = new Date().toISOString();

  /**
   * HARD RULES (SEO + privacy):
   * - This index must list ONLY public sitemaps.
   * - Do not include any Next auto-sitemaps that may contain private routes.
   * - Each listed sitemap should respond with a valid XML (urlset OR sitemapindex).
   */

  // Toggles
  const enableStatic = truthyEnv(process.env.SITEMAP_ENABLE_STATIC ?? "true");
  const enableProducts = truthyEnv(process.env.SITEMAP_ENABLE_PRODUCTS ?? "true");
  const enableCollections = truthyEnv(process.env.SITEMAP_ENABLE_COLLECTIONS ?? "true");
  const enableBlog = truthyEnv(process.env.SITEMAP_ENABLE_BLOG ?? "true");
  const enableServer = truthyEnv(process.env.SITEMAP_ENABLE_SERVER ?? "true");

  // Emergency disables
  const disableStatic = truthyEnv(process.env.SITEMAP_DISABLE_STATIC ?? "false");
  const disableProducts = truthyEnv(process.env.SITEMAP_DISABLE_PRODUCTS ?? "false");
  const disableCollections = truthyEnv(process.env.SITEMAP_DISABLE_COLLECTIONS ?? "false");
  const disableBlog = truthyEnv(process.env.SITEMAP_DISABLE_BLOG ?? "false");
  const disableServer = truthyEnv(process.env.SITEMAP_DISABLE_SERVER ?? "false");

  // Public sitemap endpoints (relative or absolute). Defaults match your current routes.
  const productsIndex = normalizeIndexPath(process.env.SITEMAP_PRODUCTS_INDEX_PATH, "/sitemap-products.xml");
  const collectionsIndex = normalizeIndexPath(process.env.SITEMAP_COLLECTIONS_INDEX_PATH, "/sitemap-collections.xml");
  const blogIndex = normalizeIndexPath(process.env.SITEMAP_BLOG_INDEX_PATH, "/sitemap-blog.xml");
  const serverIndex = normalizeIndexPath(process.env.SITEMAP_SERVER_INDEX_PATH, "/server-sitemap.xml");
  const staticIndex = normalizeIndexPath(process.env.SITEMAP_STATIC_INDEX_PATH, "/sitemap-static.xml");

  // Optional: extra sitemap URLs (comma-separated absolute URLs OR site-relative paths)
  const extraRaw = String(process.env.SITEMAP_EXTRA_URLS || "").trim();
  const extraMax = clampInt(process.env.SITEMAP_EXTRA_URLS_MAX, 1, 50) || 20;

  const extraUrls = extraRaw
    ? extraRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, extraMax)
    : [];

  const list = [];

  const pushLoc = (pathOrAbs) => {
    const check = isSafePublicSitemapTarget(pathOrAbs);
    if (!check.ok) return;

    if (check.kind === "abs") {
      list.push({ loc: check.loc, lastmod: now });
      return;
    }

    // rel
    list.push({ loc: `${baseUrl}${check.rel}`, lastmod: now });
  };

  if (enableStatic && !disableStatic) pushLoc(staticIndex);
  if (enableProducts && !disableProducts) pushLoc(productsIndex);
  if (enableCollections && !disableCollections) pushLoc(collectionsIndex);
  if (enableBlog && !disableBlog) pushLoc(blogIndex);
  if (enableServer && !disableServer) pushLoc(serverIndex);

  for (const u of extraUrls) pushLoc(u);

  // De-dup (defensive)
  const seen = new Set();
  const final = [];
  for (const sm of list) {
    const loc = sm?.loc;
    if (!loc) continue;
    if (seen.has(loc)) continue;
    seen.add(loc);
    final.push(sm);
  }

  const xml = toSitemapIndexXml(final);

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
      "X-Content-Type-Options": "nosniff",
      "X-TDLS-Sitemap-Index-Count": String(final.length),
    },
  });
}
