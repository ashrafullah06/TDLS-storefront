// FILE: app/sitemap-products.xml/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getBaseUrl, toXml } from "@/lib/site";

export const revalidate = 60; // seconds

// Strapi fetch tuning
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 12000;

// Sitemap spec limit (Google/Bing): max 50,000 URLs per sitemap file.
const MAX_URLS_PER_SITEMAP = 50000;

/* ───────── small helpers ───────── */

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function truthyEnv(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function normalizePathBase(v, fallback) {
  const raw = String(v || "").trim();
  let p = raw || fallback;
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

function normalizeStrapiBaseUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  // Allow STRAPI_URL configured with trailing "/api" without breaking
  s = s.replace(/\/api$/i, "");
  return s;
}

function normalizeEndpointSegment(raw, fallback = "products") {
  const s = String(raw || "").trim().replace(/^\/+|\/+$/g, "");
  // Strapi API collection names are typically simple; enforce safe segment
  if (!s) return fallback;
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(s)) return fallback;
  return s;
}

function normalizeFieldName(raw, fallback = "slug") {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  // allow typical Strapi field naming (letters, numbers, underscore)
  if (!/^[a-z0-9_]+$/i.test(s)) return fallback;
  return s;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toSitemapIndexXml(sitemaps) {
  const body = sitemaps
    .map((sm) => {
      const loc = `<loc>${escapeXml(sm.loc)}</loc>`;
      const lastmod = sm.lastmod ? `<lastmod>${escapeXml(sm.lastmod)}</lastmod>` : "";
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

async function fetchJson(url, { headers, revalidateSeconds, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      next: { revalidate: revalidateSeconds },
      signal: controller.signal,
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    // Wrong origin / proxy HTML / Vercel error pages: fail loudly.
    if (!ct.includes("application/json")) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        json: null,
        error: `Expected JSON but got "${ct || "unknown"}"`,
        hint: text ? text.slice(0, 260) : "",
      };
    }

    const json = await res.json().catch(() => null);
    if (!json) {
      return {
        ok: false,
        status: res.status,
        json: null,
        error: "Failed to parse JSON response",
      };
    }

    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

/* ───────── Strapi URL builders ───────── */

function buildProductsQuery({
  page,
  pageSize,
  slugField,
  liveOnly,
  requirePublishedAt,
}) {
  const sp = new URLSearchParams();

  // Strapi v4 pagination
  sp.set("pagination[page]", String(page));
  sp.set("pagination[pageSize]", String(pageSize));

  // minimal fields only
  sp.append("fields[0]", slugField);
  sp.append("fields[1]", "updatedAt");
  sp.append("fields[2]", "createdAt");
  sp.append("fields[3]", "publishedAt");

  // Optional: live-only listings
  if (liveOnly) {
    sp.set("publicationState", "live");
  }

  // Optional: hard exclude non-published rows (ONLY if you explicitly want this behavior)
  // NOTE: This can yield 0 results if Draft/Publish is disabled or publishedAt is not populated as expected.
  if (requirePublishedAt) {
    sp.set("filters[publishedAt][$notNull]", "true");
  }

  // stable order
  sp.set("sort[0]", "updatedAt:desc");

  return sp.toString();
}

function buildDirectStrapiUrl({ apiBase, endpoint, queryString }) {
  return `${apiBase}/api/${endpoint}?${queryString}`;
}

function buildProxyUrl({ siteBase, endpoint, queryString }) {
  // Your proxy expects: /api/strapi?path=/products?... (relative to Strapi /api base)
  const path = `/${endpoint}?${queryString}`;
  const u = new URL(`${siteBase}/api/strapi`);
  u.searchParams.set("path", path);
  return u.toString();
}

function unwrapProxyPayload(json) {
  // Your proxy returns: { ok: true, data: <rawStrapiPayload> }
  if (json && typeof json === "object" && json.ok === true && json.data) return json.data;
  return json;
}

function assertStrapiListShape(payload, { endpoint }) {
  const dataArr = payload?.data;
  const pag = payload?.meta?.pagination;

  const okData = Array.isArray(dataArr);
  const okPag = pag && typeof pag === "object";

  if (!okData || !okPag) {
    const hint = JSON.stringify(payload)?.slice(0, 240) || "";
    throw new Error(
      `Unexpected Strapi JSON shape for "${endpoint}": missing data[] or meta.pagination | hint: ${hint}`
    );
  }
}

/* ───────── Fetchers ───────── */

async function fetchStrapiPage({
  mode,
  apiBase,
  siteBase,
  endpoint,
  headers,
  page,
  pageSize,
  slugField,
  liveOnly,
  requirePublishedAt,
}) {
  const qs = buildProductsQuery({
    page,
    pageSize,
    slugField,
    liveOnly,
    requirePublishedAt,
  });

  const url =
    mode === "proxy"
      ? buildProxyUrl({ siteBase, endpoint, queryString: qs })
      : buildDirectStrapiUrl({ apiBase, endpoint, queryString: qs });

  const r = await fetchJson(url, {
    headers,
    revalidateSeconds: revalidate,
    timeoutMs: FETCH_TIMEOUT_MS,
  });

  if (!r.ok) {
    const msg =
      r?.json?.error?.message ||
      r?.error ||
      `Strapi fetch failed (${r.status || "?"})`;
    const hint = r?.hint ? ` | hint: ${r.hint}` : "";
    throw new Error(`${msg}${hint}`);
  }

  const payload = unwrapProxyPayload(r.json);
  assertStrapiListShape(payload, { endpoint });

  return payload;
}

async function fetchFirstPageMeta(args) {
  const payload = await fetchStrapiPage({ ...args, page: 1 });
  const items = payload.data;
  const meta = payload.meta.pagination;

  const total = clampInt(meta.total, 0, 1_000_000_000) ?? items.length;
  const pageCount = clampInt(meta.pageCount, 1, 1_000_000) || 1;

  return { items, total, pageCount };
}

async function fetchProductsRange({
  mode,
  apiBase,
  siteBase,
  endpoint,
  headers,
  pageSize,
  slugField,
  liveOnly,
  requirePublishedAt,
  pageFrom,
  pageTo,
}) {
  if (pageFrom > pageTo) return [];

  const pages = [];
  for (let p = pageFrom; p <= pageTo; p += 1) pages.push(p);

  const out = [];
  let idx = 0;
  const workerCount = Math.min(CONCURRENCY, pages.length);

  const workers = Array.from({ length: workerCount }).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= pages.length) break;

      const page = pages[i];
      const payload = await fetchStrapiPage({
        mode,
        apiBase,
        siteBase,
        endpoint,
        headers,
        page,
        pageSize,
        slugField,
        liveOnly,
        requirePublishedAt,
      });

      out.push(...payload.data);
    }
  });

  await Promise.all(workers);
  return out;
}

/* ───────── handler ───────── */

export async function GET(request) {
  const siteBase = getBaseUrl(); // MUST be absolute origin (https://www.thednalabstore.com)
  const apiBase = normalizeStrapiBaseUrl(process.env.STRAPI_URL || "");
  const token = (process.env.STRAPI_API_TOKEN || "").trim();

  if (!apiBase) {
    return new NextResponse("Missing STRAPI_URL", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // MUST match your real PDP route base.
  const productBase = normalizePathBase(process.env.SITEMAP_PRODUCT_PATH_BASE, "/product");

  // Strapi API ID defaults to "products"
  const endpoint = normalizeEndpointSegment(process.env.STRAPI_PRODUCTS_ENDPOINT, "products");

  // Slug field defaults to "slug"
  const slugField = normalizeFieldName(process.env.STRAPI_PRODUCTS_SLUG_FIELD, "slug");

  const envPageSize = clampInt(process.env.SITEMAP_PRODUCTS_PAGE_SIZE, 50, MAX_PAGE_SIZE);
  const pageSize = envPageSize || DEFAULT_PAGE_SIZE;

  // Live-only switch (publicationState=live)
  const liveOnly = truthyEnv(process.env.SITEMAP_PUBLICATION_STATE_LIVE);

  // Stronger filter: publishedAt not-null (use ONLY if you are 100% sure your Strapi uses Draft/Publish and publishedAt is populated)
  const requirePublishedAt = truthyEnv(process.env.SITEMAP_REQUIRE_PUBLISHED_AT);

  // Optional strict mode: error if Strapi reports total>0 but generated 0 URLs
  const strictNonEmpty = truthyEnv(process.env.SITEMAP_STRICT_NONEMPTY);

  // Force proxy mode if you want the sitemap to go through your hardened /api/strapi gateway
  const forceProxy = truthyEnv(process.env.SITEMAP_USE_STRAPI_PROXY);

  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Mode selection:
  // - If SITEMAP_USE_STRAPI_PROXY=1 => always proxy
  // - Else => try direct first, then proxy if direct returns empty/mis-shaped (hard, deterministic fallback)
  const modesToTry = forceProxy ? ["proxy"] : ["direct", "proxy"];

  try {
    const reqUrl = new URL(request.url);
    const partParam = clampInt(reqUrl.searchParams.get("part"), 1, 1_000_000);

    let lastError = null;

    for (const mode of modesToTry) {
      try {
        const { items: firstItems, total, pageCount } = await fetchFirstPageMeta({
          mode,
          apiBase,
          siteBase,
          endpoint,
          headers,
          pageSize,
          slugField,
          liveOnly,
          requirePublishedAt,
        });

        // If Strapi says there are products but we got none, still proceed (it can happen with permissions/filtering)
        // Strict mode can fail later if you want.
        const wantsIndex = total > MAX_URLS_PER_SITEMAP && !partParam;

        if (wantsIndex) {
          const pagesPerPart = Math.max(1, Math.floor(MAX_URLS_PER_SITEMAP / pageSize));
          const parts = Math.ceil(pageCount / pagesPerPart);
          const now = new Date().toISOString();

          const sitemaps = Array.from({ length: parts }).map((_, i) => ({
            loc: `${siteBase}/sitemap-products.xml?part=${i + 1}`,
            lastmod: now,
          }));

          const indexXml = toSitemapIndexXml(sitemaps);

          return new NextResponse(indexXml, {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
              "X-TDLS-Sitemap-Mode": "index",
              "X-TDLS-Sitemap-Source": mode,
              "X-TDLS-Sitemap-Endpoint": endpoint,
              "X-TDLS-Sitemap-Total": String(total),
              "X-TDLS-Sitemap-Parts": String(parts),
            },
          });
        }

        // Determine which page range to fetch (single sitemap or a part)
        let parts = 1;
        let part = 1;
        let pageFrom = 1;
        let pageTo = pageCount;

        if (total > MAX_URLS_PER_SITEMAP) {
          const pagesPerPart = Math.max(1, Math.floor(MAX_URLS_PER_SITEMAP / pageSize));
          parts = Math.ceil(pageCount / pagesPerPart);
          part = clampInt(partParam, 1, parts) || 1;

          pageFrom = 1 + (part - 1) * pagesPerPart;
          pageTo = Math.min(pageCount, pageFrom + pagesPerPart - 1);
        }

        // Collect items for this part
        const items = [];

        // Reuse first page if it belongs to this range
        if (pageFrom === 1) items.push(...firstItems);

        // Fetch remaining pages
        const start = Math.max(2, pageFrom);
        if (start <= pageTo) {
          const more = await fetchProductsRange({
            mode,
            apiBase,
            siteBase,
            endpoint,
            headers,
            pageSize,
            slugField,
            liveOnly,
            requirePublishedAt,
            pageFrom: start,
            pageTo,
          });
          items.push(...more);
        }

        // Build URL entries
        const urls = [];
        const seen = new Set();
        let missingSlug = 0;

        for (const p of items) {
          const a = (p && p.attributes) || {};
          const slug = a[slugField];

          if (!slug) {
            missingSlug += 1;
            continue;
          }

          const updatedAt = a.updatedAt || a.publishedAt || a.createdAt || null;
          const lastmod = updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString();

          const loc = `${siteBase}${productBase}/${encodeURIComponent(String(slug))}`;
          if (seen.has(loc)) continue;
          seen.add(loc);

          urls.push({
            loc,
            lastmod,
            changefreq: "daily",
            priority: 0.9,
          });
        }

        if (strictNonEmpty && total > 0 && urls.length === 0) {
          throw new Error(
            `Strict non-empty enabled: Strapi total=${total} but generated 0 URLs. Check slug field "${slugField}", endpoint "${endpoint}", and publication settings.`
          );
        }

        const xml = toXml(urls);

        return new NextResponse(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
            "X-TDLS-Sitemap-Mode": "urlset",
            "X-TDLS-Sitemap-Source": mode,
            "X-TDLS-Sitemap-Endpoint": endpoint,
            "X-TDLS-Sitemap-SlugField": slugField,
            "X-TDLS-Sitemap-LiveOnly": liveOnly ? "1" : "0",
            "X-TDLS-Sitemap-RequirePublishedAt": requirePublishedAt ? "1" : "0",
            "X-TDLS-Sitemap-Part": String(part),
            "X-TDLS-Sitemap-Parts": String(parts),
            "X-TDLS-Sitemap-PageFrom": String(pageFrom),
            "X-TDLS-Sitemap-PageTo": String(pageTo),
            "X-TDLS-Sitemap-Urls": String(urls.length),
            "X-TDLS-Sitemap-MissingSlug": String(missingSlug),
          },
        });
      } catch (e) {
        lastError = e;
        // try next mode
      }
    }

    throw lastError || new Error("Unknown sitemap failure");
  } catch (e) {
    return new NextResponse(`Error: ${e && e.message ? e.message : e}`, {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
