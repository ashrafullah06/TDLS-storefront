// FILE: app/server-sitemap.xml/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getBaseUrl, toXml } from "@/lib/site";

export const revalidate = 300;

// Strapi fetch tuning
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGE_SIZE = 1000;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 12000;

// Sitemap spec limit (Google/Bing): max 50,000 URLs per sitemap file.
const MAX_URLS_PER_SITEMAP = 50000;

/* ───────── helpers ───────── */

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function truthyEnv(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function normalizeStrapiBaseUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  // Allow STRAPI_URL to be configured with trailing "/api" without breaking
  s = s.replace(/\/api$/i, "");
  return s;
}

function normalizePathBase(v, fallback) {
  const raw = String(v || "").trim();
  let p = raw || fallback;
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

function normalizeEndpointSegment(raw, fallback) {
  const s = String(raw || "").trim().replace(/^\/+|\/+$/g, "");
  if (!s) return fallback;
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(s)) return fallback;
  return s;
}

function normalizeFieldName(raw, fallback) {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  if (!/^[a-z0-9_]+$/i.test(s)) return fallback;
  return s;
}

// Encode path but preserve slashes (supports nested segments if your “slug” contains /)
function encodePathPreserveSlashes(p) {
  const s = String(p || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!s) return "";
  return s
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
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

    // If Strapi URL is wrong, you often get 200 HTML. Do NOT silently accept.
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
      return { ok: false, status: res.status, json: null, error: "Failed to parse JSON response" };
    }

    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

function buildDirectStrapiUrl({ apiBase, endpoint, queryString }) {
  return `${apiBase}/api/${endpoint}?${queryString}`;
}

function buildProxyUrl({ siteBase, endpoint, queryString }) {
  // Your proxy expects: /api/strapi?path=/endpoint?...
  const path = `/${endpoint}?${queryString}`;
  const u = new URL(`${siteBase}/api/strapi`);
  u.searchParams.set("path", path);
  return u.toString();
}

function unwrapProxyPayload(json) {
  // Proxy returns { ok: true, data: <rawStrapiPayload> }
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

function buildQuery({ page, pageSize, slugField, liveOnly, requirePublishedAt }) {
  const sp = new URLSearchParams();

  sp.set("pagination[page]", String(page));
  sp.set("pagination[pageSize]", String(pageSize));

  sp.append("fields[0]", slugField);
  sp.append("fields[1]", "updatedAt");
  sp.append("fields[2]", "createdAt");
  sp.append("fields[3]", "publishedAt");

  if (liveOnly) sp.set("publicationState", "live");
  if (requirePublishedAt) sp.set("filters[publishedAt][$notNull]", "true");

  sp.set("sort[0]", "updatedAt:desc");

  return sp.toString();
}

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
  const qs = buildQuery({ page, pageSize, slugField, liveOnly, requirePublishedAt });

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
      `Strapi ${endpoint} fetch failed (${r.status || "?"})`;
    const hint = r?.hint ? ` | hint: ${r.hint}` : "";
    throw new Error(`${msg}${hint}`);
  }

  const payload = unwrapProxyPayload(r.json);
  assertStrapiListShape(payload, { endpoint });
  return payload;
}

async function fetchFirstPageMeta({
  mode,
  apiBase,
  siteBase,
  headers,
  endpoint,
  slugField,
  pageSize,
  liveOnly,
  requirePublishedAt,
}) {
  const payload = await fetchStrapiPage({
    mode,
    apiBase,
    siteBase,
    endpoint,
    headers,
    page: 1,
    pageSize,
    slugField,
    liveOnly,
    requirePublishedAt,
  });

  const items = payload.data;
  const meta = payload.meta.pagination;

  const total = clampInt(meta.total, 0, 1_000_000_000) ?? items.length;
  const pageCount = clampInt(meta.pageCount, 1, 1_000_000) || 1;

  return { items, total, pageCount };
}

async function fetchRange({
  mode,
  apiBase,
  siteBase,
  headers,
  endpoint,
  slugField,
  pageSize,
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
  const baseUrl = getBaseUrl();
  const apiBase = normalizeStrapiBaseUrl(process.env.STRAPI_URL || "");
  const token = (process.env.STRAPI_API_TOKEN || "").trim();

  if (!apiBase) {
    return new NextResponse("Missing STRAPI_URL", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const strict = truthyEnv(process.env.SITEMAP_STRICT);
  const strictNonEmpty = truthyEnv(process.env.SITEMAP_STRICT_NONEMPTY);

  // Live-only is best for public SEO (publicationState=live)
  const liveOnly = truthyEnv(process.env.SITEMAP_PUBLICATION_STATE_LIVE);

  // Stronger filter: publishedAt not-null (enable ONLY if you are sure publishedAt exists and is populated)
  const requirePublishedAt = truthyEnv(process.env.SITEMAP_REQUIRE_PUBLISHED_AT);

  // This route exists mainly to include server-driven routes from Strapi.
  // You MUST set these to your real Strapi API IDs if you use them.
  // Default names remain "pages" and "lookbooks" (real-world common).
  const endpoints = [
    {
      endpoint: normalizeEndpointSegment(process.env.STRAPI_PAGES_ENDPOINT, "pages"),
      slugField: normalizeFieldName(process.env.STRAPI_PAGES_SLUG_FIELD, "slug"),
      prefix: normalizePathBase(process.env.SITEMAP_PAGES_PATH_PREFIX, "/"),
      changefreq: "weekly",
      priority: 0.6,
    },
    {
      endpoint: normalizeEndpointSegment(process.env.STRAPI_LOOKBOOKS_ENDPOINT, "lookbooks"),
      slugField: normalizeFieldName(process.env.STRAPI_LOOKBOOKS_SLUG_FIELD, "slug"),
      prefix: normalizePathBase(process.env.SITEMAP_LOOKBOOKS_PATH_PREFIX, "/lookbook"),
      changefreq: "weekly",
      priority: 0.6,
    },
  ];

  // Prefer proxy fallback (your production already has /api/strapi hardened)
  const forceProxy = truthyEnv(process.env.SITEMAP_USE_STRAPI_PROXY);
  const modesToTry = forceProxy ? ["proxy"] : ["direct", "proxy"];

  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const reqUrl = new URL(request.url);
  const partParam = clampInt(reqUrl.searchParams.get("part"), 1, 1_000_000);

  try {
    // 1) For each endpoint, try to fetch meta (and first page) using direct->proxy fallback
    const metas = [];
    const warnings = [];

    for (const ep of endpoints) {
      let meta = null;
      let usedMode = null;
      let lastErr = null;

      for (const mode of modesToTry) {
        try {
          meta = await fetchFirstPageMeta({
            mode,
            apiBase,
            siteBase: baseUrl,
            headers,
            endpoint: ep.endpoint,
            slugField: ep.slugField,
            pageSize: DEFAULT_PAGE_SIZE,
            liveOnly,
            requirePublishedAt,
          });
          usedMode = mode;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }

      if (!meta) {
        if (strict) throw lastErr || new Error(`Failed to fetch ${ep.endpoint}`);
        warnings.push(`${ep.endpoint}:${String(lastErr?.message || lastErr)}`);
        metas.push({ ep, usedMode: usedMode || "none", items: [], total: 0, pageCount: 0 });
        continue;
      }

      metas.push({ ep, usedMode, ...meta });
    }

    const totalAll = metas.reduce((sum, m) => sum + (Number(m.total) || 0), 0);

    // 2) If huge, serve an index unless part specified
    if (totalAll > MAX_URLS_PER_SITEMAP && !partParam) {
      const parts = Math.ceil(totalAll / MAX_URLS_PER_SITEMAP);
      const now = new Date().toISOString();

      const sitemaps = Array.from({ length: parts }).map((_, i) => ({
        loc: `${baseUrl}/server-sitemap.xml?part=${i + 1}`,
        lastmod: now,
      }));

      const indexXml = toSitemapIndexXml(sitemaps);

      return new NextResponse(indexXml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
          "X-TDLS-Sitemap-Mode": "index",
          "X-TDLS-Sitemap-Total": String(totalAll),
          "X-TDLS-Sitemap-Parts": String(parts),
        },
      });
    }

    // 3) Build URL list for all endpoints (this route is typically small)
    const allPairs = [];
    for (const m of metas) {
      // first page already in m.items
      const epItems = [...(m.items || [])];

      const pageCount = clampInt(m.pageCount, 0, 1_000_000) || 0;
      if (pageCount > 1) {
        let fetched = null;
        let lastErr = null;

        for (const mode of modesToTry) {
          try {
            fetched = await fetchRange({
              mode,
              apiBase,
              siteBase: baseUrl,
              headers,
              endpoint: m.ep.endpoint,
              slugField: m.ep.slugField,
              pageSize: DEFAULT_PAGE_SIZE,
              liveOnly,
              requirePublishedAt,
              pageFrom: 2,
              pageTo: pageCount,
            });
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
          }
        }

        if (fetched) epItems.push(...fetched);
        else {
          if (strict) throw lastErr || new Error(`Paged fetch failed for ${m.ep.endpoint}`);
          warnings.push(`${m.ep.endpoint}:paged_fetch_failed:${String(lastErr?.message || lastErr)}`);
        }
      }

      for (const it of epItems) allPairs.push({ ep: m.ep, it });
    }

    const urls = [];
    const seen = new Set();
    let missingSlug = 0;

    for (const row of allPairs) {
      const a = (row.it && row.it.attributes) || {};
      const raw = a[row.ep.slugField];

      if (!raw) {
        missingSlug += 1;
        continue;
      }

      const path = encodePathPreserveSlashes(raw);
      if (!path) {
        missingSlug += 1;
        continue;
      }

      const updatedAt = a.updatedAt || a.publishedAt || a.createdAt || null;
      const lastmod = updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString();

      // Root pages: prefix "/" means /{slug}
      const loc = row.ep.prefix === "/" ? `${baseUrl}/${path}` : `${baseUrl}${row.ep.prefix}/${path}`;

      if (seen.has(loc)) continue;
      seen.add(loc);

      urls.push({
        loc,
        lastmod,
        changefreq: row.ep.changefreq,
        priority: row.ep.priority,
      });
    }

    if (strictNonEmpty && totalAll > 0 && urls.length === 0) {
      throw new Error(
        `Strict non-empty enabled: Strapi total=${totalAll} but generated 0 URLs. Check endpoints/slug fields and publication settings.`
      );
    }

    // 4) Apply part slicing only if needed
    let part = 1;
    let parts = 1;
    let sliced = urls;

    if (urls.length > MAX_URLS_PER_SITEMAP) {
      parts = Math.ceil(urls.length / MAX_URLS_PER_SITEMAP);
      part = clampInt(partParam, 1, parts) || 1;
      const start = (part - 1) * MAX_URLS_PER_SITEMAP;
      const end = Math.min(urls.length, start + MAX_URLS_PER_SITEMAP);
      sliced = urls.slice(start, end);
    }

    const xml = toXml(sliced);

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
        "X-TDLS-Sitemap-Mode": "urlset",
        "X-TDLS-Sitemap-Total": String(totalAll),
        "X-TDLS-Sitemap-Part": String(part),
        "X-TDLS-Sitemap-Parts": String(parts),
        "X-TDLS-Sitemap-Urls": String(sliced.length),
        "X-TDLS-Sitemap-MissingSlug": String(missingSlug),
        ...(warnings.length ? { "X-TDLS-Sitemap-Warn": warnings.slice(0, 6).join(" | ") } : {}),
      },
    });
  } catch (e) {
    // If not strict, return a valid empty urlset (so crawlers don't see 500)
    if (!strict) {
      const xml = toXml([]);
      return new NextResponse(xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
          "X-TDLS-Sitemap-Warn": String(e && e.message ? e.message : e),
        },
      });
    }

    return new NextResponse(`Error: ${e && e.message ? e.message : e}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
