// FILE: app/api/strapi/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/* ───────── envs ───────── */

// Base Strapi origin (no /api at the end)
const RAW_STRAPI_ORIGIN =
  process.env.STRAPI_API_ORIGIN ||
  process.env.STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_ORIGIN ||
  "http://127.0.0.1:1337";

const IS_PROD = process.env.NODE_ENV === "production";

/**
 * ✅ IMPORTANT:
 * We only *enforce* “no localhost Strapi” on real Vercel runtime.
 * This allows `next start` (NODE_ENV=production) locally with Strapi on 127.0.0.1.
 */
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

// Optional secret used by internal / cron calls (OPTIONAL for public reads)
const STRAPI_SYNC_SECRET = (
  process.env.STRAPI_SYNC_SECRET ||
  process.env.STRAPI_PROXY_SECRET ||
  ""
).trim();

// Token for Strapi REST (optional; will be ignored if invalid)
const STRAPI_TOKEN = (
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_GRAPHQL_TOKEN ||
  ""
).trim();

// Hard safety timeout to avoid “hanging streams” and platform timeouts.
const UPSTREAM_TIMEOUT_MS = (() => {
  const n = Number(process.env.STRAPI_PROXY_TIMEOUT_MS || 20000);
  if (!Number.isFinite(n) || n <= 0) return 20000;
  return Math.min(25000, Math.max(3000, Math.round(n)));
})();

/**
 * ✅ Default products populate mode:
 * - "filtersafe" (recommended): includes all relations your filters need (taxonomy + variants.sizes)
 * - "light": taxonomy only (NOT recommended for your current UI; causes empty-filter false negatives)
 * - "full": populate=*
 *
 * NOTE (production fix):
 * For /products list, we ALWAYS enforce a minimum “filter-safe” dataset (taxonomy + variants.sizes)
 * even if the caller passes populate=*, because Strapi's populate=* is shallow and can omit
 * nested relations (ex: variants.sizes). Missing those nested relations is the #1 reason your
 * UI sometimes shows: “No pieces match these filters right now…”.
 */
const DEFAULT_PRODUCTS_POPULATE_MODE = String(
  process.env.TDLS_STRAPI_DEFAULT_PRODUCTS_POPULATE || "filtersafe"
)
  .trim()
  .toLowerCase();

/**
 * ✅ Heavy-query guard (PUBLIC only)
 * Protect production from deep populate monsters that time out / 502.
 */
const HEAVY_GUARD_ENABLED =
  String(process.env.TDLS_STRAPI_HEAVY_GUARD ?? "1").trim().toLowerCase() !== "0";

const HEAVY_MAX_QUERY_CHARS = (() => {
  const n = Number(process.env.TDLS_STRAPI_HEAVY_MAX_QUERY_CHARS ?? 1400);
  if (!Number.isFinite(n) || n <= 0) return 1400;
  return Math.min(6000, Math.max(400, Math.round(n)));
})();

const HEAVY_MAX_POPULATE_KEYS = (() => {
  const n = Number(process.env.TDLS_STRAPI_HEAVY_MAX_POPULATE_KEYS ?? 40);
  if (!Number.isFinite(n) || n <= 0) return 40;
  return Math.min(250, Math.max(10, Math.round(n)));
})();

/**
 * ✅ CDN caching controls
 */
const META_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400";

const PRODUCT_CACHE_CONTROL = (() => {
  const maxAge = Number(process.env.TDLS_STRAPI_PRODUCT_MAXAGE_SEC ?? 15); // browser
  const sMaxAge = Number(process.env.TDLS_STRAPI_PRODUCT_SMAXAGE_SEC ?? 180); // CDN
  const swr = Number(process.env.TDLS_STRAPI_PRODUCT_SWR_SEC ?? 3600);
  const sie = Number(process.env.TDLS_STRAPI_PRODUCT_SIE_SEC ?? 86400);

  const clamp = (v, lo, hi, fallback) => {
    const x = Number(v);
    if (!Number.isFinite(x)) return fallback;
    return Math.min(hi, Math.max(lo, Math.round(x)));
  };

  const a = clamp(maxAge, 0, 300, 15);
  const b = clamp(sMaxAge, 0, 3600, 180);
  const c = clamp(swr, 0, 86400, 3600);
  const d = clamp(sie, 0, 604800, 86400);

  return `public, max-age=${a}, s-maxage=${b}, stale-while-revalidate=${c}, stale-if-error=${d}`;
})();

/* ───────── response helpers ───────── */

function jsonResponse(bodyObj, status = 200, extraHeaders = {}) {
  return new NextResponse(bodyObj === undefined ? "null" : JSON.stringify(bodyObj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function rawJsonResponse(bodyString, status = 200, extraHeaders = {}) {
  return new NextResponse(bodyString ?? "null", {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ───────── origin helpers ───────── */

function normalizeOrigin(raw) {
  let o = (raw || "").trim();

  if (o && !/^https?:\/\//i.test(o)) {
    o = `${IS_PROD ? "https" : "http"}://${o}`;
  }

  o = o.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");
  o = o.replace(/\/+$/, "").replace(/\/api$/, "");

  return o;
}

function assertNotLocalhostInProd(origin) {
  // ✅ Only enforce on Vercel runtime; allow localhost for local `next start`.
  if (!IS_PROD || !IS_VERCEL) return;

  const h = new URL(origin).hostname;
  const isLocal =
    h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  if (isLocal) {
    throw new Error(
      `Invalid STRAPI_URL for production (localhost): ${origin}. Set STRAPI_URL/STRAPI_API_ORIGIN to your real Strapi domain (https://...).`
    );
  }
}

// IMPORTANT: never throw at module init in production.
let STRAPI_ORIGIN = "";
let STRAPI_API_BASE = "";
let STRAPI_BOOT_ERROR = "";

try {
  STRAPI_ORIGIN = normalizeOrigin(RAW_STRAPI_ORIGIN);
  assertNotLocalhostInProd(STRAPI_ORIGIN);
  STRAPI_API_BASE = STRAPI_ORIGIN + "/api";
} catch (e) {
  STRAPI_BOOT_ERROR = e instanceof Error ? e.message : String(e || "BOOT_ERROR");
}

/**
 * Hardening: ensure `path` is a relative API path (not a full URL),
 * and does not contain CRLF or protocol tricks.
 *
 * ✅ Production stability: also accept full Strapi URLs ONLY if same-origin.
 * (Helps if any client accidentally passes https://cms.../api/... into `path`.)
 */
function normalizeStrapiPath(input) {
  const p0 = String(input || "").trim();
  if (!p0) return "";

  // Block protocol-relative and CRLF always
  if (p0.startsWith("//")) return "";
  if (/[\r\n]/.test(p0)) return "";

  // If full URL, allow ONLY if it matches STRAPI_ORIGIN or STRAPI_API_BASE
  if (/^https?:\/\//i.test(p0)) {
    try {
      const u = new URL(p0);
      const origin = u.origin;
      if (!STRAPI_ORIGIN || !STRAPI_API_BASE) return "";

      const ok = origin === STRAPI_ORIGIN || origin === new URL(STRAPI_API_BASE).origin;
      if (!ok) return "";

      // Must contain /api/ path
      const idx = u.pathname.indexOf("/api/");
      if (idx === -1) return "";

      const rel = u.pathname.slice(idx + 4) + (u.search || "");
      const relTrim = rel.startsWith("/") ? rel : `/${rel}`;
      return relTrim;
    } catch {
      return "";
    }
  }

  const p = p0;
  if (!p) return "";
  return p.startsWith("/") ? p : `/${p}`;
}

function splitPathAndQuery(p) {
  const s = String(p || "");
  const i = s.indexOf("?");
  if (i === -1) return { pathname: s, search: "" };
  return { pathname: s.slice(0, i), search: s.slice(i + 1) };
}

/**
 * ✅ Canonicalize query params (stable cache keys in production)
 */
function canonicalizePath(p) {
  const { pathname, search } = splitPathAndQuery(p);
  if (!search) return pathname;

  const params = new URLSearchParams(search);
  const entries = Array.from(params.entries());
  entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  const out = new URLSearchParams();
  for (const [k, v] of entries) out.append(k, v);

  const qs = out.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function hasAnyPopulate(params) {
  if (params.has("populate")) return true;
  for (const k of params.keys()) {
    if (k.startsWith("populate[")) return true;
  }
  return false;
}

function hasObjectPopulate(params) {
  for (const k of params.keys()) {
    if (k.startsWith("populate[")) return true;
  }
  return false;
}

function countPopulateKeys(params) {
  let c = 0;
  for (const k of params.keys()) {
    if (k === "populate" || k.startsWith("populate[")) c++;
  }
  return c;
}

function stripPopulateParams(params) {
  for (const k of Array.from(params.keys())) {
    if (k === "populate" || k.startsWith("populate[")) params.delete(k);
  }
}

function hasFiltersInPath(path) {
  const { search } = splitPathAndQuery(path);
  if (!search) return false;
  const params = new URLSearchParams(search);
  for (const k of params.keys()) {
    if (k === "filters" || k.startsWith("filters[") || k.includes("filters[")) return true;
  }
  return false;
}

function isHeavyPopulateRequest(path) {
  const { search } = splitPathAndQuery(path);
  if (!search) return false;

  if (search.length > HEAVY_MAX_QUERY_CHARS) return true;

  const params = new URLSearchParams(search);
  const popCount = countPopulateKeys(params);
  if (popCount > HEAVY_MAX_POPULATE_KEYS) return true;

  const pop = params.get("populate");
  if (pop === "*" && popCount > Math.max(10, Math.floor(HEAVY_MAX_POPULATE_KEYS / 2))) return true;

  return false;
}

const DEFAULT_PRODUCTS_PAGESIZE = (() => {
  const n = Number(process.env.TDLS_STRAPI_PRODUCTS_PAGESIZE ?? 1000);
  if (!Number.isFinite(n) || n <= 0) return 1000;
  return Math.min(1500, Math.max(25, Math.round(n)));
})();

/* ───────── products populate profiles ───────── */

const TAXONOMY_RELS = [
  ["audience_categories", ["slug", "name", "order"]],
  ["categories", ["slug", "name", "order"]],
  ["sub_categories", ["slug", "name", "order"]],
  ["super_categories", ["slug", "name", "order"]],
  ["age_groups", ["slug", "name", "order"]],
  ["gender_groups", ["slug", "name", "order"]],
  ["tiers", ["slug", "name", "order"]],
  ["brand_tiers", ["slug", "name", "order"]],
  ["collection_tiers", ["slug", "name", "order"]],
  ["events_products_collections", ["slug", "name", "order"]],
  ["product_collections", ["slug", "name", "order"]],
];

const TAXONOMY_REL_SET = new Set(TAXONOMY_RELS.map((x) => x[0]));

/**
 * ✅ Fast meta profiles (PUBLIC optimization)
 * These endpoints are tiny lists; populate=* is unnecessary and often slow in production.
 *
 * Only applied when:
 * - PUBLIC request (no secret)
 * - AND caller uses populate=* OR no populate
 * - AND noOptimize=1 is NOT present inside the Strapi path query
 */
const FAST_META_DEFAULT_PAGE_SIZE = (() => {
  const n = Number(process.env.TDLS_STRAPI_META_PAGESIZE ?? 1000);
  if (!Number.isFinite(n) || n <= 0) return 1000;
  return Math.min(2000, Math.max(50, Math.round(n)));
})();

const FAST_META_PROFILES = new Map([
  ["/audience-categories", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/categories", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/sub-categories", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/super-categories", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/age-groups", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/gender-groups", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/tiers", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/brand-tiers", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  ["/collection-tiers", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
  [
    "/events-products-collections",
    { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] },
  ],
  ["/product-collections", { fields: ["slug", "name", "order"], sort: ["order:asc", "name:asc"] }],
]);

function hasAnyFields(params) {
  for (const k of params.keys()) {
    if (k === "fields" || k.startsWith("fields[")) return true;
  }
  return false;
}

function hasAnySort(params) {
  for (const k of params.keys()) {
    if (k === "sort" || k.startsWith("sort[")) return true;
  }
  return false;
}

function applyFastMetaProfile(pathname, params) {
  const prof = FAST_META_PROFILES.get(pathname);
  if (!prof) return;

  stripPopulateParams(params);

  if (!hasAnyFields(params)) {
    for (let i = 0; i < prof.fields.length; i++) {
      params.set(`fields[${i}]`, String(prof.fields[i]));
    }
  }

  if (!hasAnySort(params)) {
    for (let i = 0; i < prof.sort.length; i++) {
      params.set(`sort[${i}]`, String(prof.sort[i]));
    }
  }

  if (!params.get("pagination[pageSize]")) {
    params.set("pagination[pageSize]", String(FAST_META_DEFAULT_PAGE_SIZE));
  }
  if (!params.get("pagination[page]")) params.set("pagination[page]", "1");
}

function normalizeMetaPath(p, { isPublic } = { isPublic: true }) {
  const { pathname, search } = splitPathAndQuery(p);
  if (!FAST_META_PROFILES.has(pathname)) return p;

  const params = new URLSearchParams(search || "");

  if (params.has("populate") && hasObjectPopulate(params)) {
    params.delete("populate");
  }

  const noOptimize = params.get("noOptimize") === "1";
  if (noOptimize) params.delete("noOptimize");

  const pop = String(params.get("populate") || "").trim();
  const wantsFast = isPublic && !noOptimize && (!pop || pop === "*" || !hasAnyPopulate(params));

  if (wantsFast) {
    applyFastMetaProfile(pathname, params);
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function hasPopulateForRel(params, rel) {
  const prefix = `populate[${rel}]`;
  for (const k of params.keys()) {
    if (k === prefix || k.startsWith(`${prefix}[`)) return true;
  }
  return false;
}

function applyProductsTaxonomyPopulate(params) {
  for (const [rel, fields] of TAXONOMY_RELS) {
    if (hasPopulateForRel(params, rel)) continue;
    for (let i = 0; i < fields.length; i++) {
      params.set(`populate[${rel}][fields][${i}]`, String(fields[i]));
    }
  }
}

function applyProductsFilterSafePopulate(params) {
  applyProductsTaxonomyPopulate(params);

  if (!hasPopulateForRel(params, "variants")) {
    params.set("populate[variants][populate][sizes]", "*");
  } else {
    let hasSizes = false;
    for (const k of params.keys()) {
      if (k.startsWith("populate[variants][populate][sizes]")) {
        hasSizes = true;
        break;
      }
    }
    if (!hasSizes) params.set("populate[variants][populate][sizes]", "*");
  }

  if (!hasPopulateForRel(params, "thumbnail")) {
    params.set("populate[thumbnail]", "*");
  }
}

function applyProductDetailPopulate(params) {
  applyProductsTaxonomyPopulate(params);

  if (!hasPopulateForRel(params, "variants")) {
    params.set("populate[variants][populate][sizes]", "*");
  } else {
    let hasSizes = false;
    for (const k of params.keys()) {
      if (k.startsWith("populate[variants][populate][sizes]")) {
        hasSizes = true;
        break;
      }
    }
    if (!hasSizes) params.set("populate[variants][populate][sizes]", "*");
  }

  if (!hasPopulateForRel(params, "images")) params.set("populate[images]", "*");
  if (!hasPopulateForRel(params, "thumbnail")) params.set("populate[thumbnail]", "*");
}

function normalizePopulateStringToObject(params, mode = "products-list") {
  const raw = String(params.get("populate") || "").trim();
  if (!raw) return;

  if (hasObjectPopulate(params)) {
    params.delete("populate");
    return;
  }

  params.delete("populate");

  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const hasStar = parts.includes("*") || raw === "*";

  if (hasStar) {
    if (mode === "products-detail") {
      applyProductDetailPopulate(params);
    } else {
      applyProductsFilterSafePopulate(params);
    }
    return;
  }

  for (const rel of parts) {
    if (!rel) continue;
    if (TAXONOMY_REL_SET.has(rel)) continue;

    if (rel === "variants") {
      params.set("populate[variants][populate][sizes]", "*");
      continue;
    }

    if (!hasPopulateForRel(params, rel)) params.set(`populate[${rel}]`, "*");
  }
}

/**
 * ✅ CRITICAL PROD FIX (your issue):
 * For PUBLIC /products requests we DO NOT trust client populate=* spam.
 * We enforce a stable, filter-safe populate profile so Strapi is fast and consistent.
 *
 * Opt-out: add `noOptimize=1` inside the `path` query (proxy-only flag).
 */
function normalizeProductsPath(p, opts = {}) {
  const isPublic = Boolean(opts?.isPublic);

  const { pathname, search } = splitPathAndQuery(p);
  if (!pathname.startsWith("/products")) return p;

  const params = new URLSearchParams(search || "");

  // proxy-only flag: never send to Strapi
  const noOptimize = params.get("noOptimize") === "1";
  if (noOptimize) params.delete("noOptimize");

  const isList = pathname === "/products";
  const isDetail = !isList;

  // ✅ PUBLIC enforcement: strip all client populate keys unless opted out.
  if (isPublic && !noOptimize) {
    stripPopulateParams(params);

    if (isDetail) {
      applyProductDetailPopulate(params);
    } else {
      // If caller is intentionally requesting a tiny payload via fields[],
      // keep it light (taxonomy only) to stay "electric fast".
      if (hasAnyFields(params)) {
        applyProductsTaxonomyPopulate(params);
      } else {
        applyProductsFilterSafePopulate(params);
      }
    }
  } else {
    // Legacy behavior (internal/secret calls can request extra populates)
    if (params.has("populate") && hasObjectPopulate(params)) {
      params.delete("populate");
    }

    if (params.has("populate") && !hasObjectPopulate(params)) {
      normalizePopulateStringToObject(params, isDetail ? "products-detail" : "products-list");
    }

    if (isDetail) {
      applyProductDetailPopulate(params);
    } else {
      if (!hasAnyPopulate(params)) {
        // Even in "light/full" modes, we keep it filter-safe because your UI depends on it.
        applyProductsFilterSafePopulate(params);
      } else {
        applyProductsFilterSafePopulate(params);
      }
    }
  }

  // pagination enforcement for list
  if (isList) {
    const pageSizeKey = "pagination[pageSize]";
    const existing = params.get(pageSizeKey);

    if (!existing) {
      params.set(pageSizeKey, String(DEFAULT_PRODUCTS_PAGESIZE));
    } else {
      const x = Number(existing);
      if (!Number.isFinite(x) || x <= 0) params.set(pageSizeKey, String(DEFAULT_PRODUCTS_PAGESIZE));
    }

    if (!params.get("pagination[page]")) params.set("pagination[page]", "1");
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/* ───────── PUBLIC heavy-guard sanitizers ───────── */

function sanitizeMetaPathForPublic(p) {
  const { pathname, search } = splitPathAndQuery(p);
  if (!search) return pathname;

  const params = new URLSearchParams(search);
  stripPopulateParams(params);

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function sanitizeProductsListPathForPublic(p) {
  const { pathname, search } = splitPathAndQuery(p);
  if (pathname !== "/products") return p;

  const params = new URLSearchParams(search || "");
  stripPopulateParams(params);

  applyProductsFilterSafePopulate(params);

  const pageSizeKey = "pagination[pageSize]";
  const existing = params.get(pageSizeKey);
  if (!existing) {
    params.set(pageSizeKey, String(DEFAULT_PRODUCTS_PAGESIZE));
  } else {
    const x = Number(existing);
    if (!Number.isFinite(x) || x <= 0) params.set(pageSizeKey, String(DEFAULT_PRODUCTS_PAGESIZE));
  }
  if (!params.get("pagination[page]")) params.set("pagination[page]", "1");

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function buildTargetUrl(normalizedPath) {
  const { pathname, search } = splitPathAndQuery(normalizedPath);

  const base = new URL(STRAPI_API_BASE);
  const basePath = base.pathname.replace(/\/+$/, "");
  base.pathname = `${basePath}${pathname}`;

  if (search) {
    const params = new URLSearchParams(search);
    const qs = params.toString();
    base.search = qs ? `?${qs}` : "";
  } else {
    base.search = "";
  }

  return base.toString();
}

function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  return fetch(url, {
    ...init,
    signal: controller.signal,
    redirect: "follow",
  }).finally(() => clearTimeout(t));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldRetryStatus(status) {
  return (
    status === 408 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 520 ||
    status === 521
  );
}

/* ───────── retry profiles ───────── */

const RETRY_DELAYS_PRODUCTS = [0, 140, 320];
const RETRY_DELAYS_META = [0, 180, 420, 900];

/* ───────── Prisma lazy-load (stability + speed) ───────── */

let _prismaPromise = null;
async function getPrisma() {
  if (_prismaPromise) return _prismaPromise;
  _prismaPromise = import("@/lib/prisma").then((m) => m?.default ?? m);
  return _prismaPromise;
}

/* ───────── micro-cache + in-flight dedupe (persist per runtime instance) ───────── */

const G = globalThis;

const INFLIGHT = G.__TDLS_STRAPI_INFLIGHT__ ?? (G.__TDLS_STRAPI_INFLIGHT__ = new Map());
const MEM_META = G.__TDLS_STRAPI_MEM_META__ ?? (G.__TDLS_STRAPI_MEM_META__ = new Map());
const MEM_PROD = G.__TDLS_STRAPI_MEM_PROD__ ?? (G.__TDLS_STRAPI_MEM_PROD__ = new Map());
const LAST_GOOD = G.__TDLS_STRAPI_LAST_GOOD__ ?? (G.__TDLS_STRAPI_LAST_GOOD__ = new Map());
const STOCK_CACHE = G.__TDLS_STRAPI_STOCK__ ?? (G.__TDLS_STRAPI_STOCK__ = new Map());

const LAST_GOOD_ANY_PRODUCTS_KEY = "pub|prod|__any__";

function metaAnyKeyFromPathname(pathname) {
  return `pub|meta|__any__:${pathname}`;
}

// meta cache TTL
const MEM_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_TTL_MS || 120000);
  if (!Number.isFinite(n) || n <= 0) return 120000;
  return Math.min(10 * 60 * 1000, Math.max(10 * 1000, Math.round(n)));
})();

// products mem cache TTL
const MEM_PROD_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_PRODUCTS_TTL_MS || 15000);
  if (!Number.isFinite(n) || n <= 0) return 15000;
  return Math.min(120 * 1000, Math.max(2000, Math.round(n)));
})();

/**
 * ✅ BIG FIX: default 1MB was too small for products payloads.
 * This made products effectively "uncacheable" → slow + inconsistent on every click.
 *
 * Keep env override. Clamp remains 6MB.
 */
const MEM_MAX_BYTES = (() => {
  const fallback = 4 * 1024 * 1024; // 4MB default (safe)
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_MAX_BYTES || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(6 * 1024 * 1024, Math.max(64 * 1024, Math.round(n)));
})();

const LAST_GOOD_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_LASTGOOD_TTL_MS || 180000);
  if (!Number.isFinite(n) || n <= 0) return 180000;
  return Math.min(15 * 60 * 1000, Math.max(30 * 1000, Math.round(n)));
})();

const LAST_GOOD_ANY_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_LASTGOOD_ANY_TTL_MS || 600000);
  if (!Number.isFinite(n) || n <= 0) return 600000;
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, Math.round(n)));
})();

const STOCK_CACHE_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STOCKCACHE_TTL_MS || 300000);
  if (!Number.isFinite(n) || n <= 0) return 300000;
  return Math.min(30 * 60 * 1000, Math.max(30 * 1000, Math.round(n)));
})();

function memGet(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (v.exp <= Date.now()) {
    map.delete(key);
    return null;
  }
  return v;
}

function memSet(map, key, payloadStr, headers, ttlMs) {
  if (typeof payloadStr !== "string") return;
  if (payloadStr.length > MEM_MAX_BYTES) return;
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : MEM_TTL_MS;
  map.set(key, { exp: Date.now() + ttl, payloadStr, headers });
}

function lastGoodGet(key) {
  const v = LAST_GOOD.get(key);
  if (!v) return null;
  if (v.exp <= Date.now()) {
    LAST_GOOD.delete(key);
    return null;
  }
  return v;
}

function lastGoodSet(key, payloadStr, ttlMs = LAST_GOOD_TTL_MS) {
  if (typeof payloadStr !== "string") return;
  if (payloadStr.length > 8 * 1024 * 1024) return;
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : LAST_GOOD_TTL_MS;
  LAST_GOOD.set(key, { exp: Date.now() + ttl, payloadStr });
}

function stockCacheGet(sizeId) {
  const v = STOCK_CACHE.get(sizeId);
  if (!v) return null;
  if (v.exp <= Date.now()) {
    STOCK_CACHE.delete(sizeId);
    return null;
  }
  return v.stock;
}

function stockCacheSet(sizeId, stock) {
  if (!Number.isFinite(sizeId) || sizeId <= 0) return;
  const s = Number(stock);
  if (!Number.isFinite(s) || s < 0) return;
  STOCK_CACHE.set(sizeId, { exp: Date.now() + STOCK_CACHE_TTL_MS, stock: s });
}

async function runDedupe(key, fn) {
  const existing = INFLIGHT.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      return await fn();
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, p);
  return p;
}

/* ───────── warm meta caches (soft preload) ───────── */

const WARM_STATE = G.__TDLS_STRAPI_WARM_STATE__ ?? (G.__TDLS_STRAPI_WARM_STATE__ = { exp: 0 });

const WARM_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_WARM_TTL_MS || 10 * 60 * 1000);
  if (!Number.isFinite(n) || n <= 0) return 10 * 60 * 1000;
  return Math.min(60 * 60 * 1000, Math.max(60 * 1000, Math.round(n)));
})();

async function warmMetaCachesIfNeeded(baseHeaders) {
  const now = Date.now();
  if (WARM_STATE.exp > now) return;

  WARM_STATE.exp = now + WARM_TTL_MS;

  const paths = Array.from(FAST_META_PROFILES.keys());

  await Promise.allSettled(
    paths.map(async (pathname) => {
      const eff = canonicalizePath(normalizeMetaPath(`${pathname}?populate=*`, { isPublic: true }));
      const target = buildTargetUrl(eff);

      const cacheKey = `pub|meta|${eff}`;
      const lastGoodKey = `pub|meta|${eff}`;
      const anyKey = metaAnyKeyFromPathname(pathname);

      if (memGet(MEM_META, cacheKey)?.payloadStr) return;

      const dk = `warm|meta|${eff}`;
      await runDedupe(dk, async () => {
        const res = await fetchUpstreamResilient(target, baseHeaders, { delays: RETRY_DELAYS_META });
        if (!res.ok) return;

        const text = await res.text().catch(() => "");
        const parsed = safeJsonParse(text);
        if (!parsed) return;

        const payloadStr = JSON.stringify({ ok: true, data: parsed, ms: 0, warmed: true });

        memSet(
          MEM_META,
          cacheKey,
          payloadStr,
          { "cache-control": META_CACHE_CONTROL, "CDN-Cache-Control": META_CACHE_CONTROL },
          MEM_TTL_MS
        );

        lastGoodSet(lastGoodKey, payloadStr, LAST_GOOD_TTL_MS);
        lastGoodSet(anyKey, payloadStr, LAST_GOOD_ANY_TTL_MS);
      });
    })
  );
}

/* ───────── stock patch helpers ───────── */

function collectSizeIdsFromStrapiProducts(strapiData) {
  const itemsRaw = strapiData?.data;
  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];
  const sizeIds = new Set();

  for (const item of items) {
    const row = item;
    const attrs = row.attributes || null;

    let variants = row.variants || attrs?.variants || [];
    if (variants && Array.isArray(variants.data)) variants = variants.data.map((v) => v.attributes || v);
    if (!Array.isArray(variants)) continue;

    for (const v of variants) {
      let sizes = v.sizes || v.attributes?.sizes || [];
      if (sizes && Array.isArray(sizes.data)) sizes = sizes.data.map((s) => s);
      if (!Array.isArray(sizes)) continue;

      for (const s of sizes) {
        const rawId = s.id ?? s.size_id ?? s.strapiSizeId ?? s.attributes?.id;
        const sid = Number(rawId);
        if (Number.isFinite(sid) && sid > 0) sizeIds.add(sid);
      }
    }
  }

  return { items, sizeIds };
}

/**
 * ✅ Speed improvement WITHOUT changing behavior:
 * - Use STOCK_CACHE first
 * - Query Prisma only for missing sizeIds
 */
async function getStockMapForSizeIds(sizeIds) {
  const ids = Array.from(sizeIds || []);
  if (ids.length === 0) return { bySizeId: new Map(), source: "none", error: null };

  const bySizeId = new Map();
  const missing = [];

  for (const sid0 of ids) {
    const sid = Number(sid0);
    if (!Number.isFinite(sid) || sid <= 0) continue;

    const cached = stockCacheGet(sid);
    if (cached != null) {
      bySizeId.set(sid, cached);
    } else {
      missing.push(sid);
    }
  }

  if (missing.length === 0) return { bySizeId, source: "cache", error: null };

  try {
    const prisma = await getPrisma();
    const prismaVariants = await prisma.productVariant.findMany({
      where: { strapiSizeId: { in: missing } },
      select: { strapiSizeId: true, stockAvailable: true },
    });

    for (const v of prismaVariants) {
      const sid = Number(v?.strapiSizeId);
      const stock = Number(v?.stockAvailable ?? 0) || 0;
      if (Number.isFinite(sid) && sid > 0) {
        bySizeId.set(sid, stock);
        stockCacheSet(sid, stock);
      }
    }

    return { bySizeId, source: bySizeId.size ? "prisma" : "none", error: null };
  } catch (e) {
    // still return whatever cache hits we had
    return { bySizeId, source: bySizeId.size ? "cache" : "none", error: e };
  }
}

function ensureAvailabilityDefaultsOnProducts(strapiData) {
  const itemsRaw = strapiData?.data;
  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];

  for (const item of items) {
    const row = item;
    const attrs = row.attributes || null;

    let variants = row.variants || attrs?.variants || [];
    if (variants && Array.isArray(variants.data)) variants = variants.data.map((v) => v);
    if (!Array.isArray(variants)) continue;

    for (const v of variants) {
      const vAttrs = v.attributes || null;

      let sizes = v.sizes || vAttrs?.sizes || [];
      if (sizes && Array.isArray(sizes.data)) sizes = sizes.data.map((s) => s);
      if (!Array.isArray(sizes)) continue;

      for (const s of sizes) {
        const sAttrs = s.attributes || null;

        const hasBool =
          typeof s.is_available === "boolean" ||
          (sAttrs && typeof sAttrs.is_available === "boolean");

        if (hasBool) continue;

        const stockRaw =
          s.live_stock ??
          s.stock_quantity ??
          (sAttrs ? (sAttrs.live_stock ?? sAttrs.stock_quantity) : undefined);

        const stockNum = Number(stockRaw);
        const isAvailable = Number.isFinite(stockNum) ? stockNum > 0 : true;

        s.is_available = isAvailable;
        if (sAttrs) s.attributes = { ...sAttrs, is_available: isAvailable };
      }
    }
  }

  return strapiData;
}

async function patchProductsWithPrismaStock(strapiData) {
  const { items, sizeIds } = collectSizeIdsFromStrapiProducts(strapiData);
  if (sizeIds.size === 0) return ensureAvailabilityDefaultsOnProducts(strapiData);

  const { bySizeId, source, error } = await getStockMapForSizeIds(sizeIds);
  if (source === "none" && error) return ensureAvailabilityDefaultsOnProducts(strapiData);

  for (const item of items) {
    const row = item;
    const attrs = row.attributes || null;

    let variants = row.variants || attrs?.variants || [];
    if (variants && Array.isArray(variants.data)) variants = variants.data.map((v) => v);
    if (!Array.isArray(variants)) continue;

    for (const v of variants) {
      const vAttrs = v.attributes || null;

      let sizes = v.sizes || vAttrs?.sizes || [];
      if (sizes && Array.isArray(sizes.data)) sizes = sizes.data.map((s) => s);
      if (!Array.isArray(sizes)) continue;

      for (const s of sizes) {
        const sAttrs = s.attributes || null;

        const rawId = s.id ?? s.size_id ?? s.strapiSizeId ?? sAttrs?.id;
        const sid = Number(rawId);
        if (!Number.isFinite(sid) || sid <= 0) continue;

        if (!bySizeId.has(sid)) {
          if (
            typeof s.is_available !== "boolean" &&
            !(sAttrs && typeof sAttrs.is_available === "boolean")
          ) {
            s.is_available = true;
            if (sAttrs) s.attributes = { ...sAttrs, is_available: true };
          }
          continue;
        }

        const liveStock = Number(bySizeId.get(sid)) || 0;
        const isAvailable = liveStock > 0;

        s.stock_quantity = liveStock;
        s.live_stock = liveStock;
        s.is_available = isAvailable;

        if (sAttrs) {
          s.attributes = {
            ...sAttrs,
            stock_quantity: liveStock,
            live_stock: liveStock,
            is_available: isAvailable,
          };
        }
      }
    }
  }

  return ensureAvailabilityDefaultsOnProducts(strapiData);
}

/* ───────── upstream fetch (retry hardened) ───────── */

async function fetchUpstreamResilient(target, baseHeaders, opts = {}) {
  const delays = Array.isArray(opts.delays) ? opts.delays : RETRY_DELAYS_PRODUCTS;

  const attemptOnce = async () => {
    let res;

    if (STRAPI_TOKEN) {
      res = await fetchWithTimeout(target, {
        method: "GET",
        headers: { ...baseHeaders, Authorization: `Bearer ${STRAPI_TOKEN}` },
        cache: "no-store",
      });

      if (res.status === 401) {
        res = await fetchWithTimeout(target, {
          method: "GET",
          headers: baseHeaders,
          cache: "no-store",
        });
      }
    } else {
      res = await fetchWithTimeout(target, {
        method: "GET",
        headers: baseHeaders,
        cache: "no-store",
      });
    }

    return res;
  };

  let lastErr = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i] + Math.floor(Math.random() * 60));
    try {
      const res = await attemptOnce();
      if (shouldRetryStatus(res.status) && i < delays.length - 1) continue;
      return res;
    } catch (e) {
      lastErr = e;
      if (i === delays.length - 1) throw e;
    }
  }

  if (lastErr) throw lastErr;
  return await attemptOnce();
}

function productCountFromStrapiPayload(data) {
  const itemsRaw = data?.data;
  if (Array.isArray(itemsRaw)) return itemsRaw.length;
  if (itemsRaw) return 1;
  return 0;
}

/**
 * ✅ Treat empty /products (no filters) as suspect.
 * Your store is not empty, so an empty list is almost always a Strapi/proxy failure mode.
 */
function isSuspectEmptyProductsResponse(data, assumeNonEmpty = false) {
  const items = data?.data;
  if (!Array.isArray(items)) return false;
  if (items.length !== 0) return false;

  const total = Number(data?.meta?.pagination?.total ?? 0);
  if (Number.isFinite(total) && total > 0) return true;

  return assumeNonEmpty;
}

async function fetchBroaderProductsFallback(baseHeaders) {
  const fallbackPath = canonicalizePath(
    normalizeProductsPath(`/products?pagination[pageSize]=${DEFAULT_PRODUCTS_PAGESIZE}`, { isPublic: true })
  );
  const target = buildTargetUrl(fallbackPath);

  let res;
  try {
    res = await fetchUpstreamResilient(target, baseHeaders, { delays: RETRY_DELAYS_PRODUCTS });
  } catch {
    return null; // ✅ never throw; allow main pipeline to continue fallbacks
  }

  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  data = await patchProductsWithPrismaStock(data);

  const payloadObj = { ok: true, data, degraded: true, reason: "BROAD_FALLBACK" };
  const payloadStr = JSON.stringify(payloadObj);

  const parsed = safeJsonParse(payloadStr);
  const count = productCountFromStrapiPayload(parsed?.data);
  if (count <= 0) return null;

  return payloadStr;
}

/* ───────── main handler ───────── */

export async function GET(req) {
  const t0 = Date.now();
  let guarded = false;

  try {
    if (STRAPI_BOOT_ERROR) {
      return jsonResponse(
        { ok: false, error: "SERVER_MISCONFIGURED", message: STRAPI_BOOT_ERROR },
        500,
        { "cache-control": "no-store" }
      );
    }

    const url = new URL(req.url);

    const clientSecretRaw =
      url.searchParams.get("secret") ||
      req.headers.get("x-strapi-sync-secret") ||
      req.headers.get("x-strapi-proxy-secret");

    const hasClientSecret =
      typeof clientSecretRaw === "string" && clientSecretRaw.trim().length > 0;

    if (hasClientSecret) {
      if (!STRAPI_SYNC_SECRET) {
        return jsonResponse(
          {
            ok: false,
            error: "SERVER_MISCONFIGURED",
            message: "Strapi sync secret is not configured",
          },
          500
        );
      }

      const clientSecret = clientSecretRaw.trim();
      if (clientSecret !== STRAPI_SYNC_SECRET) {
        return jsonResponse(
          { ok: false, error: "UNAUTHORIZED", message: "Invalid proxy secret" },
          401
        );
      }
    }

    const rawPath = url.searchParams.get("path") || "";
    const normalizedPath0 = normalizeStrapiPath(rawPath);

    if (!normalizedPath0) {
      return jsonResponse(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: "Invalid or missing `path` query parameter (must be a relative Strapi API path).",
        },
        400
      );
    }

    const noCache = url.searchParams.get("noCache") === "1";
    const allowHeavy = url.searchParams.get("allowHeavy") === "1";

    // ✅ IMPORTANT: normalize /products differently for PUBLIC vs SECRET.
    let effectivePath = canonicalizePath(
      normalizeProductsPath(canonicalizePath(normalizedPath0), { isPublic: !hasClientSecret })
    );

    let { pathname: effPathname } = splitPathAndQuery(effectivePath);
    let isProductEndpoint = effPathname === "/products" || effPathname.startsWith("/products/");
    let isProductsList = isProductEndpoint && effPathname === "/products";

    if (
      HEAVY_GUARD_ENABLED &&
      !allowHeavy &&
      !hasClientSecret &&
      isHeavyPopulateRequest(effectivePath)
    ) {
      if (!isProductEndpoint) {
        effectivePath = canonicalizePath(sanitizeMetaPathForPublic(effectivePath));
        guarded = true;
      } else if (isProductsList) {
        effectivePath = canonicalizePath(sanitizeProductsListPathForPublic(effectivePath));
        guarded = true;
      }

      ({ pathname: effPathname } = splitPathAndQuery(effectivePath));
      isProductEndpoint = effPathname === "/products" || effPathname.startsWith("/products/");
      isProductsList = isProductEndpoint && effPathname === "/products";
    }

    if (!hasClientSecret && !isProductEndpoint) {
      const normalizedMeta = normalizeMetaPath(effectivePath, { isPublic: true });
      effectivePath = canonicalizePath(normalizedMeta);

      ({ pathname: effPathname } = splitPathAndQuery(effectivePath));
      isProductEndpoint = effPathname === "/products" || effPathname.startsWith("/products/");
      isProductsList = isProductEndpoint && effPathname === "/products";
    }

    const target = buildTargetUrl(effectivePath);
    const baseHeaders = { Accept: "application/json" };

    const CACHE_OK = !noCache && !hasClientSecret;

    const cacheControl = CACHE_OK
      ? isProductEndpoint
        ? PRODUCT_CACHE_CONTROL
        : META_CACHE_CONTROL
      : "no-store";

    const cacheKey = `${CACHE_OK ? "pub" : "noc"}|${isProductEndpoint ? "prod" : "meta"}|${effectivePath}`;
    const lastGoodKey = `${hasClientSecret ? "sec" : "pub"}|${isProductEndpoint ? "prod" : "meta"}|${effectivePath}`;

    if (!hasClientSecret && CACHE_OK && isProductsList) {
      warmMetaCachesIfNeeded(baseHeaders).catch(() => {});
    }

    if (CACHE_OK) {
      const map = isProductEndpoint ? MEM_PROD : MEM_META;
      const hit = memGet(map, cacheKey);
      if (hit?.payloadStr) {
        const ms = Date.now() - t0;
        const parsed = isProductEndpoint ? safeJsonParse(hit.payloadStr) : null;
        const cnt = isProductEndpoint ? productCountFromStrapiPayload(parsed?.data) : null;

        return rawJsonResponse(hit.payloadStr, 200, {
          ...hit.headers,
          "cache-control": cacheControl,
          "CDN-Cache-Control": cacheControl,
          "x-tdls-proxy-ms": String(ms),
          "x-tdls-cache": "1",
          "x-tdls-mem": "1",
          "x-tdls-guard": guarded ? "1" : "0",
          ...(isProductEndpoint ? { "x-tdls-products-count": String(cnt ?? 0) } : {}),
        });
      }
    }

    const dedupeKey = `${isProductEndpoint ? "prod" : "meta"}|${effectivePath}|${
      hasClientSecret ? "sec" : "pub"
    }|${STRAPI_TOKEN ? "tok" : "notok"}|${noCache ? "nc1" : "nc0"}|${guarded ? "g1" : "g0"}`;

    const result = await runDedupe(dedupeKey, async () => {
      // ✅ CRITICAL STABILITY FIX:
      // Never let upstream fetch throws bypass your fallback pipeline.
      try {
        const delays = isProductEndpoint ? RETRY_DELAYS_PRODUCTS : RETRY_DELAYS_META;

        const res = await fetchUpstreamResilient(target, baseHeaders, { delays });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return {
            ok: false,
            status: res.status,
            statusText: res.statusText,
            errorText: text || null,
          };
        }

        let data;
        try {
          data = await res.json();
        } catch {
          return { ok: false, status: 502, statusText: "Bad Gateway", errorText: "Invalid JSON" };
        }

        // ✅ If /products is empty (and should not be), retry once quickly.
        if (isProductsList) {
          const hasFilters = hasFiltersInPath(effectivePath);
          const assumeNonEmpty = !hasFilters;
          if (isSuspectEmptyProductsResponse(data, assumeNonEmpty)) {
            await sleep(120);
            try {
              const res2 = await fetchUpstreamResilient(target, baseHeaders, { delays: RETRY_DELAYS_PRODUCTS });
              if (res2.ok) {
                try {
                  const data2 = await res2.json();
                  if (!isSuspectEmptyProductsResponse(data2, assumeNonEmpty)) data = data2;
                } catch {}
              }
            } catch {
              // ignore; fallbacks below will cover empties if needed
            }
          }
        }

        if (isProductEndpoint) {
          data = await patchProductsWithPrismaStock(data);
        }

        if (!hasClientSecret && isProductsList) {
          const countNow = productCountFromStrapiPayload(data);
          const hasFilters = hasFiltersInPath(effectivePath);

          if (countNow === 0) {
            const lgExact = lastGoodGet(lastGoodKey);
            if (lgExact?.payloadStr) {
              return {
                ok: true,
                status: 200,
                payloadStr: lgExact.payloadStr,
                degraded: true,
                reason: hasFilters ? "EMPTY->EXACT_LAST_GOOD_FILTERED" : "EMPTY->EXACT_LAST_GOOD",
              };
            }

            const any = lastGoodGet(LAST_GOOD_ANY_PRODUCTS_KEY);
            if (any?.payloadStr) {
              return {
                ok: true,
                status: 200,
                payloadStr: any.payloadStr,
                degraded: true,
                reason: hasFilters ? "EMPTY->ANY_PRODUCTS_CACHE_FILTERED" : "EMPTY->ANY_PRODUCTS_CACHE",
              };
            }

            const broad = await fetchBroaderProductsFallback(baseHeaders);
            if (broad) {
              lastGoodSet(LAST_GOOD_ANY_PRODUCTS_KEY, broad, LAST_GOOD_ANY_TTL_MS);
              return {
                ok: true,
                status: 200,
                payloadStr: broad,
                degraded: true,
                reason: hasFilters ? "EMPTY->BROAD_FETCH_FILTERED" : "EMPTY->BROAD_FETCH",
              };
            }
          }
        }

        const payloadObj = { ok: true, data, ms: Date.now() - t0 };
        const payloadStr = JSON.stringify(payloadObj);

        return { ok: true, status: 200, payloadStr };
      } catch (e) {
        const name = String(e?.name || "");
        const isAbort =
          name === "AbortError" ||
          name.toLowerCase().includes("abort") ||
          String(e?.message || "").toLowerCase().includes("aborted");

        return {
          ok: false,
          status: isAbort ? 504 : 502,
          statusText: isAbort ? "Gateway Timeout" : "Bad Gateway",
          errorText: String(e?.message || "fetch failed"),
        };
      }
    });

    const ms = Date.now() - t0;

    if (!result?.ok) {
      if (hasClientSecret) {
        return jsonResponse(
          {
            ok: false,
            error: "STRAPI_PROXY_ERROR",
            status: result?.status || 502,
            statusText: result?.statusText || "Bad Gateway",
            message: "Strapi request failed",
            details: result?.errorText || null,
            ms,
            target: IS_PROD ? undefined : target,
          },
          502,
          {
            "cache-control": "no-store",
            "x-tdls-upstream-status": String(result?.status || 0),
            "x-tdls-proxy-ms": String(ms),
            "x-tdls-cache": "0",
            "x-tdls-guard": guarded ? "1" : "0",
          }
        );
      }

      const lg = lastGoodGet(lastGoodKey);
      if (lg?.payloadStr) {
        const parsed = isProductEndpoint ? safeJsonParse(lg.payloadStr) : null;
        const cnt = isProductEndpoint ? productCountFromStrapiPayload(parsed?.data) : null;

        return rawJsonResponse(lg.payloadStr, 200, {
          "cache-control": cacheControl,
          "CDN-Cache-Control": cacheControl,
          "x-tdls-proxy-ms": String(ms),
          "x-tdls-stale": "1",
          "x-tdls-fallback": "last-good",
          "x-tdls-upstream-status": String(result?.status || 0),
          "x-tdls-guard": guarded ? "1" : "0",
          ...(isProductEndpoint ? { "x-tdls-products-count": String(cnt ?? 0) } : {}),
        });
      }

      if (!isProductEndpoint) {
        const anyMeta = lastGoodGet(metaAnyKeyFromPathname(effPathname));
        if (anyMeta?.payloadStr) {
          return rawJsonResponse(anyMeta.payloadStr, 200, {
            "cache-control": cacheControl,
            "CDN-Cache-Control": cacheControl,
            "x-tdls-proxy-ms": String(ms),
            "x-tdls-stale": "1",
            "x-tdls-fallback": "any-meta",
            "x-tdls-upstream-status": String(result?.status || 0),
            "x-tdls-guard": guarded ? "1" : "0",
          });
        }
      }

      if (isProductEndpoint) {
        const any = lastGoodGet(LAST_GOOD_ANY_PRODUCTS_KEY);
        if (any?.payloadStr) {
          const parsed = safeJsonParse(any.payloadStr);
          const cnt = productCountFromStrapiPayload(parsed?.data);

          return rawJsonResponse(any.payloadStr, 200, {
            "cache-control": cacheControl,
            "CDN-Cache-Control": cacheControl,
            "x-tdls-proxy-ms": String(ms),
            "x-tdls-stale": "1",
            "x-tdls-fallback": "any-products",
            "x-tdls-upstream-status": String(result?.status || 0),
            "x-tdls-guard": guarded ? "1" : "0",
            "x-tdls-products-count": String(cnt ?? 0),
          });
        }

        const broad = await fetchBroaderProductsFallback(baseHeaders);
        if (broad) {
          lastGoodSet(LAST_GOOD_ANY_PRODUCTS_KEY, broad, LAST_GOOD_ANY_TTL_MS);

          const parsed = safeJsonParse(broad);
          const cnt = productCountFromStrapiPayload(parsed?.data);

          return rawJsonResponse(broad, 200, {
            "cache-control": cacheControl,
            "CDN-Cache-Control": cacheControl,
            "x-tdls-proxy-ms": String(ms),
            "x-tdls-stale": "1",
            "x-tdls-fallback": "broad-fetch",
            "x-tdls-upstream-status": String(result?.status || 0),
            "x-tdls-guard": guarded ? "1" : "0",
            "x-tdls-products-count": String(cnt ?? 0),
          });
        }
      }

      const payloadStr = JSON.stringify({
        ok: true,
        data: { data: [], meta: { degraded: true } },
        degraded: true,
        reason: isProductEndpoint ? "PUBLIC_PRODUCTS_DEGRADED_EMPTY" : "PUBLIC_META_DEGRADED_EMPTY",
        ms,
      });

      return rawJsonResponse(payloadStr, 200, {
        "cache-control": "no-store",
        "x-tdls-proxy-ms": String(ms),
        "x-tdls-stale": "1",
        "x-tdls-fallback": "degraded-empty",
        "x-tdls-upstream-status": String(result?.status || 0),
        "x-tdls-guard": guarded ? "1" : "0",
        ...(isProductEndpoint ? { "x-tdls-products-count": "0" } : {}),
      });
    }

    const payloadStr = result.payloadStr || JSON.stringify({ ok: true, data: null, ms });

    let productCount = null;
    if (isProductEndpoint) {
      const parsed = safeJsonParse(payloadStr);
      productCount = productCountFromStrapiPayload(parsed?.data);
    }
    const isGoodProductPayload =
      !isProductEndpoint || (Number.isFinite(productCount) && productCount > 0);

    if (CACHE_OK) {
      if (!isProductEndpoint || isGoodProductPayload) {
        const map = isProductEndpoint ? MEM_PROD : MEM_META;
        memSet(
          map,
          cacheKey,
          payloadStr,
          { "cache-control": cacheControl, "CDN-Cache-Control": cacheControl },
          isProductEndpoint ? MEM_PROD_TTL_MS : MEM_TTL_MS
        );
      }
    }

    if (!hasClientSecret) {
      if (!isProductEndpoint || isGoodProductPayload) {
        lastGoodSet(lastGoodKey, payloadStr, LAST_GOOD_TTL_MS);
      }
      if (isProductEndpoint && isGoodProductPayload) {
        lastGoodSet(LAST_GOOD_ANY_PRODUCTS_KEY, payloadStr, LAST_GOOD_ANY_TTL_MS);
      }
      if (!isProductEndpoint) {
        lastGoodSet(metaAnyKeyFromPathname(effPathname), payloadStr, LAST_GOOD_ANY_TTL_MS);
      }
    }

    return rawJsonResponse(payloadStr, 200, {
      "cache-control": cacheControl,
      "CDN-Cache-Control": cacheControl,
      "x-tdls-proxy-ms": String(ms),
      "x-tdls-cache": CACHE_OK ? "1" : "0",
      "x-tdls-mem": "0",
      "x-tdls-stale": result?.reason ? "1" : "0",
      "x-tdls-fallback": result?.reason ? String(result.reason) : "0",
      "x-tdls-guard": guarded ? "1" : "0",
      ...(isProductEndpoint ? { "x-tdls-products-count": String(productCount ?? 0) } : {}),
    });
  } catch (err) {
    const ms = Date.now() - t0;

    const name = String(err?.name || "");
    const isAbort =
      name === "AbortError" ||
      name.toLowerCase().includes("abort") ||
      String(err?.message || "").toLowerCase().includes("aborted");

    if (isAbort) {
      return jsonResponse(
        {
          ok: false,
          error: "UPSTREAM_TIMEOUT",
          message: `Strapi did not respond within ${UPSTREAM_TIMEOUT_MS}ms`,
          ms,
        },
        504,
        { "cache-control": "no-store", "x-tdls-proxy-ms": String(ms) }
      );
    }

    console.error("STRAPI PROXY FATAL ERROR:", err);
    return jsonResponse(
      { ok: false, error: "STRAPI_PROXY_ERROR", message: "fetch failed", ms },
      500,
      { "cache-control": "no-store", "x-tdls-proxy-ms": String(ms) }
    );
  }
}