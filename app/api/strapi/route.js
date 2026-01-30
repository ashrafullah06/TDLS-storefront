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
  "http://127.0.0.1:1337";

const IS_PROD = process.env.NODE_ENV === "production";

// Optional secret used by internal / cron calls (OPTIONAL for public reads)
const STRAPI_SYNC_SECRET = (process.env.STRAPI_SYNC_SECRET || process.env.STRAPI_PROXY_SECRET || "").trim();

// Token for Strapi REST (optional; will be ignored if invalid)
const STRAPI_TOKEN = (process.env.STRAPI_API_TOKEN || process.env.STRAPI_GRAPHQL_TOKEN || "").trim();

// Hard safety timeout to avoid “hanging streams” and platform timeouts.
const UPSTREAM_TIMEOUT_MS = (() => {
  const n = Number(process.env.STRAPI_PROXY_TIMEOUT_MS || 20000);
  if (!Number.isFinite(n) || n <= 0) return 20000;
  return Math.min(25000, Math.max(3000, Math.round(n)));
})();

/**
 * ✅ CDN caching controls
 * Goal: prevent “empty menu / no pieces match filters” caused by transient upstream failures,
 * especially on serverless cold starts where in-memory fallback is empty.
 *
 * - META endpoints can be cached longer.
 * - PRODUCTS endpoints get SHORT cache (still safe for browsing) + stale-if-error.
 * - Callers can force bypass using `noCache=1`.
 */
const META_CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400";

const PRODUCT_CACHE_CONTROL = (() => {
  // Defaults tuned for “never blank UI” while keeping stock reasonably fresh for browsing.
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
  if (!IS_PROD) return;
  const h = new URL(origin).hostname;
  const isLocal = h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
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
 */
function normalizeStrapiPath(input) {
  const p = String(input || "").trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return "";
  if (p.startsWith("//")) return "";
  if (/[\r\n]/.test(p)) return "";
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

function hasPopulateBranch(params, branch) {
  const prefix = `populate[${branch}]`;
  for (const k of params.keys()) {
    if (k === prefix || k.startsWith(prefix + "[")) return true;
  }
  return false;
}

function ensureDeepPopulate(params, branch, nestedKey) {
  const k = `populate[${branch}][populate][${nestedKey}]`;
  if (!params.has(k)) params.set(k, "*");
}

/**
 * ✅ Normalize product LIST requests so all callers get a consistent dataset.
 * This prevents production-only “random empty filters” caused by:
 * - default Strapi pagination (25)
 * - missing deep relations (variants/sizes) in some callers
 */
const DEFAULT_PRODUCTS_PAGESIZE = (() => {
  const n = Number(process.env.TDLS_STRAPI_PRODUCTS_PAGESIZE ?? 1000);
  if (!Number.isFinite(n) || n <= 0) return 1000;
  return Math.min(1500, Math.max(25, Math.round(n)));
})();

function normalizeProductsPath(p) {
  const { pathname, search } = splitPathAndQuery(p);
  if (!pathname.startsWith("/products")) return p;

  const params = new URLSearchParams(search || "");

  // If no populate at all, ensure listing gets relations.
  if (!hasAnyPopulate(params)) {
    params.set("populate", "*");
  }

  // Always ensure deep populate for sizes under variants to prevent client-side filters from excluding everything.
  // Supports both schemas: product_variants (new) and variants (legacy).
  // Even if populate="*" exists, Strapi won't necessarily deep-populate nested relations.
  ensureDeepPopulate(params, "product_variants", "sizes");
  ensureDeepPopulate(params, "variants", "sizes");

  // If caller explicitly populates variant branches but not sizes, also force sizes.
  if (hasPopulateBranch(params, "product_variants")) ensureDeepPopulate(params, "product_variants", "sizes");
  if (hasPopulateBranch(params, "variants")) ensureDeepPopulate(params, "variants", "sizes");

  // Ensure pagination[pageSize] exists for product LIST calls.
  // (Safe even if caller already provided filters — it just increases page size.)
  const pageSizeKey = "pagination[pageSize]";
  const existing = params.get(pageSizeKey);

  if (!existing) {
    params.set(pageSizeKey, String(DEFAULT_PRODUCTS_PAGESIZE));
  } else {
    const x = Number(existing);
    if (!Number.isFinite(x) || x <= 0) {
      params.set(pageSizeKey, String(DEFAULT_PRODUCTS_PAGESIZE));
    }
  }

  // Avoid “random empty” from callers accidentally paging deep
  const pageKey = "pagination[page]";
  const pageVal = params.get(pageKey);
  if (pageVal) {
    const n = Number(pageVal);
    if (!Number.isFinite(n) || n < 1) params.delete(pageKey);
  }

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * ✅ Build upstream URL using URL() so bracket queries (filters[...], populate[...]) are safely encoded.
 * This eliminates environment-specific fetch URL parsing edge cases.
 */
function buildTargetUrl(normalizedPath) {
  const { pathname, search } = splitPathAndQuery(normalizedPath);

  const base = new URL(STRAPI_API_BASE);
  const basePath = base.pathname.replace(/\/+$/, "");
  base.pathname = `${basePath}${pathname}`;

  base.search = search ? `?${search}` : "";
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
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/* ───────── Prisma lazy-load (stability + speed) ───────── */
/**
 * DO NOT import Prisma at module scope.
 * Only load Prisma when we actually need it (products stock patch).
 */
let _prismaPromise = null;
async function getPrisma() {
  if (_prismaPromise) return _prismaPromise;
  _prismaPromise = import("@/lib/prisma").then((m) => m?.default ?? m);
  return _prismaPromise;
}

/* ───────── micro-cache + in-flight dedupe ───────── */

const INFLIGHT = new Map(); // key -> Promise<{ ok, status, payloadStr, productCount? }>
const MEM_META = new Map(); // key -> { exp, payloadStr, headers }
const MEM_PROD = new Map(); // key -> { exp, payloadStr, headers }

// Last-known-good payload (public reads only), used when upstream fails.
// NOTE: we intentionally do NOT store “empty products list” as last-good.
const LAST_GOOD = new Map(); // key -> { exp, payloadStr }

// Stock cache (sizeId -> stock) used when Prisma temporarily fails.
const STOCK_CACHE = new Map(); // sizeId -> { exp, stock }

const MEM_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_TTL_MS || 120000); // 2 min
  if (!Number.isFinite(n) || n <= 0) return 120000;
  return Math.min(10 * 60 * 1000, Math.max(10 * 1000, Math.round(n)));
})();

const MEM_PROD_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_PRODUCTS_TTL_MS || 15000); // 15s
  if (!Number.isFinite(n) || n <= 0) return 15000;
  return Math.min(120 * 1000, Math.max(2000, Math.round(n)));
})();

const MEM_MAX_BYTES = (() => {
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_MAX_BYTES || 1024 * 1024); // 1MB
  if (!Number.isFinite(n) || n <= 0) return 1024 * 1024;
  return Math.min(6 * 1024 * 1024, Math.max(64 * 1024, Math.round(n)));
})();

const LAST_GOOD_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_LASTGOOD_TTL_MS || 180000); // 3 min
  if (!Number.isFinite(n) || n <= 0) return 180000;
  return Math.min(15 * 60 * 1000, Math.max(30 * 1000, Math.round(n))); // 30s..15m
})();

const STOCK_CACHE_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STOCKCACHE_TTL_MS || 300000); // 5 min
  if (!Number.isFinite(n) || n <= 0) return 300000;
  return Math.min(30 * 60 * 1000, Math.max(30 * 1000, Math.round(n))); // 30s..30m
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

function lastGoodSet(key, payloadStr) {
  if (typeof payloadStr !== "string") return;
  if (payloadStr.length > 8 * 1024 * 1024) return; // hard guard 8MB
  LAST_GOOD.set(key, { exp: Date.now() + LAST_GOOD_TTL_MS, payloadStr });
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

/* ───────── stock patch helpers (logic hardened, behavior preserved) ───────── */

function normalizeRelArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (Array.isArray(x.data)) return x.data;
  if (x.data) return [x.data];
  return [];
}

function getProductVariantsContainers(row) {
  const attrs = row?.attributes || null;

  // Support BOTH field names (production sometimes differs): product_variants and variants
  const raw =
    row?.product_variants ??
    row?.variants ??
    (attrs ? attrs.product_variants ?? attrs.variants : null) ??
    [];

  return normalizeRelArray(raw);
}

function getVariantSizesContainers(variant) {
  const vAttrs = variant?.attributes || null;
  const raw = variant?.sizes ?? (vAttrs ? vAttrs.sizes : null) ?? [];
  return normalizeRelArray(raw);
}

function getSizeId(sizeObj) {
  const sAttrs = sizeObj?.attributes || null;
  const rawId = sizeObj?.id ?? sizeObj?.size_id ?? sizeObj?.strapiSizeId ?? (sAttrs ? sAttrs.id : undefined);
  const sid = Number(rawId);
  return Number.isFinite(sid) && sid > 0 ? sid : null;
}

function collectSizeIdsFromStrapiProducts(strapiData) {
  const itemsRaw = strapiData?.data;
  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];

  const sizeIds = new Set();

  for (const item of items) {
    const variants = getProductVariantsContainers(item);
    for (const v of variants) {
      const sizes = getVariantSizesContainers(v);
      for (const s of sizes) {
        const sid = getSizeId(s);
        if (sid) sizeIds.add(sid);
      }
    }
  }

  return { items, sizeIds };
}

async function getStockMapForSizeIds(sizeIds) {
  const ids = Array.from(sizeIds || []);
  if (ids.length === 0) return { bySizeId: new Map(), source: "none", error: null };

  try {
    const prisma = await getPrisma();

    const prismaVariants = await prisma.productVariant.findMany({
      where: { strapiSizeId: { in: ids } },
      select: { strapiSizeId: true, stockAvailable: true },
    });

    const bySizeId = new Map();
    for (const v of prismaVariants) {
      const sid = Number(v?.strapiSizeId);
      const stock = Number(v?.stockAvailable ?? 0) || 0;
      if (Number.isFinite(sid) && sid > 0) {
        bySizeId.set(sid, stock);
        stockCacheSet(sid, stock);
      }
    }

    return { bySizeId, source: "prisma", error: null };
  } catch (e) {
    // Prisma failed: fall back to cached stock
    const bySizeId = new Map();
    let hits = 0;

    for (const sid of ids) {
      const cached = stockCacheGet(sid);
      if (cached != null) {
        bySizeId.set(sid, cached);
        hits++;
      }
    }

    return { bySizeId, source: hits ? "cache" : "none", error: e };
  }
}

/**
 * ✅ Ensure sizes always have `is_available`
 * (prevents client filters from excluding everything when stock patching can’t run)
 */
function ensureAvailabilityDefaultsOnProducts(strapiData) {
  const itemsRaw = strapiData?.data;
  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];

  for (const item of items) {
    const variants = getProductVariantsContainers(item);

    for (const v of variants) {
      const sizes = getVariantSizesContainers(v);

      for (const s of sizes) {
        const sAttrs = s?.attributes || null;

        const hasBool =
          typeof s.is_available === "boolean" || (sAttrs && typeof sAttrs.is_available === "boolean");

        if (hasBool) continue;

        const stockRaw =
          s.live_stock ??
          s.stock_quantity ??
          (sAttrs ? sAttrs.live_stock ?? sAttrs.stock_quantity : undefined);

        const stockNum = Number(stockRaw);
        const isAvailable = Number.isFinite(stockNum) ? stockNum > 0 : true; // optimistic when unknown

        s.is_available = isAvailable;
        if (sAttrs) {
          s.attributes = { ...sAttrs, is_available: isAvailable };
        }
      }
    }
  }

  return strapiData;
}

/**
 * Patch Strapi products with live Prisma stock.
 * If Prisma is temporarily down, we use cached stock (prevents products “disappearing”).
 */
async function patchProductsWithPrismaStock(strapiData) {
  const { items, sizeIds } = collectSizeIdsFromStrapiProducts(strapiData);
  if (sizeIds.size === 0) return ensureAvailabilityDefaultsOnProducts(strapiData);

  const { bySizeId, source, error } = await getStockMapForSizeIds(sizeIds);

  if (source === "none" && error) {
    return ensureAvailabilityDefaultsOnProducts(strapiData);
  }

  for (const item of items) {
    const variants = getProductVariantsContainers(item);

    for (const v of variants) {
      const sizes = getVariantSizesContainers(v);

      for (const s of sizes) {
        const sAttrs = s?.attributes || null;

        const sid = getSizeId(s);
        if (!sid) continue;

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

async function fetchUpstreamResilient(target, baseHeaders) {
  const attempt = async () => {
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

  try {
    const res1 = await attempt();
    if (shouldRetryStatus(res1.status)) {
      await sleep(220);
      const res2 = await attempt();
      return res2;
    }
    return res1;
  } catch {
    await sleep(220);
    return await attempt();
  }
}

function isProductsListPath(pathname) {
  return pathname === "/products";
}

function productCountFromStrapiData(strapiData) {
  const d = strapiData?.data;
  if (Array.isArray(d)) return d.length;
  return d ? 1 : 0;
}

/**
 * Global products fallback path (used to avoid “random empty grid” in production).
 * We keep this minimal and normalized to ensure it succeeds and returns a full dataset for client filters.
 */
function getGlobalProductsEffectivePath() {
  return canonicalizePath(normalizeProductsPath("/products"));
}

async function fetchGlobalProductsNow(baseHeaders) {
  const effectivePath = getGlobalProductsEffectivePath();
  const target = buildTargetUrl(effectivePath);

  const res = await fetchUpstreamResilient(target, baseHeaders);
  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  data = await patchProductsWithPrismaStock(data);

  const cnt = productCountFromStrapiData(data);
  if (cnt <= 0) return null;

  return { effectivePath, data, cnt };
}

/* ───────── main handler ───────── */

export async function GET(req) {
  const t0 = Date.now();

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

    const hasClientSecret = typeof clientSecretRaw === "string" && clientSecretRaw.trim().length > 0;

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
        return jsonResponse({ ok: false, error: "UNAUTHORIZED", message: "Invalid proxy secret" }, 401);
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

    // ✅ Normalize product list requests + canonicalize query order for stable caching
    const effectivePath = canonicalizePath(normalizeProductsPath(canonicalizePath(normalizedPath0)));
    const { pathname: effPathname } = splitPathAndQuery(effectivePath);

    const isProductEndpoint = effPathname === "/products" || effPathname.startsWith("/products/");
    const isProductsList = isProductEndpoint && isProductsListPath(effPathname);

    const target = buildTargetUrl(effectivePath);
    const baseHeaders = { Accept: "application/json" };

    const noCache = url.searchParams.get("noCache") === "1";

    // Allow CDN caching for PUBLIC reads unless caller forces noCache=1.
    const CACHE_OK = !noCache && !hasClientSecret;

    const cacheControl = CACHE_OK ? (isProductEndpoint ? PRODUCT_CACHE_CONTROL : META_CACHE_CONTROL) : "no-store";

    const cacheKey = `${CACHE_OK ? "pub" : "noc"}|${isProductEndpoint ? "prod" : "meta"}|${effectivePath}`;

    // Key for last-known-good fallback (public only)
    const lastGoodKey = `${hasClientSecret ? "sec" : "pub"}|${isProductEndpoint ? "prod" : "meta"}|${effectivePath}`;

    // Also keep a global products last-good key (public) to avoid blank grids when a filtered/list request glitches.
    const globalProductsEffectivePath = isProductsList ? getGlobalProductsEffectivePath() : "";
    const globalProductsLastGoodKey = globalProductsEffectivePath ? `pub|prod|${globalProductsEffectivePath}` : "";

    // 1) in-memory micro-cache (NEVER serve cached empty products list)
    if (CACHE_OK) {
      const map = isProductEndpoint ? MEM_PROD : MEM_META;
      const hit = memGet(map, cacheKey);
      if (hit?.payloadStr) {
        // For product-list, guard against poisoned cache (empty payload cached earlier).
        if (isProductsList) {
          try {
            const parsed = JSON.parse(hit.payloadStr);
            const cnt = productCountFromStrapiData(parsed?.data);
            if (cnt <= 0) {
              // drop poisoned cache entry
              map.delete(cacheKey);
            } else {
              const ms = Date.now() - t0;
              return rawJsonResponse(hit.payloadStr, 200, {
                ...hit.headers,
                "cache-control": cacheControl,
                "CDN-Cache-Control": cacheControl,
                "x-tdls-proxy-ms": String(ms),
                "x-tdls-cache": "1",
                "x-tdls-mem": "1",
              });
            }
          } catch {
            map.delete(cacheKey);
          }
        } else {
          const ms = Date.now() - t0;
          return rawJsonResponse(hit.payloadStr, 200, {
            ...hit.headers,
            "cache-control": cacheControl,
            "CDN-Cache-Control": cacheControl,
            "x-tdls-proxy-ms": String(ms),
            "x-tdls-cache": "1",
            "x-tdls-mem": "1",
          });
        }
      }
    }

    // 2) dedupe concurrent requests for same key
    const dedupeKey = `${isProductEndpoint ? "prod" : "meta"}|${effectivePath}|${
      hasClientSecret ? "sec" : "pub"
    }|${STRAPI_TOKEN ? "tok" : "notok"}|${noCache ? "nc1" : "nc0"}`;

    const result = await runDedupe(dedupeKey, async () => {
      const res = await fetchUpstreamResilient(target, baseHeaders);

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

      if (isProductEndpoint) {
        data = await patchProductsWithPrismaStock(data);
      }

      const productCount = isProductEndpoint ? productCountFromStrapiData(data) : undefined;

      // ✅ Treat “empty products list” as an anomaly in production/real traffic:
      // do NOT cache/store it as last-good; allow outer logic to fallback to global products.
      if (isProductsList && productCount <= 0) {
        return {
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
          errorText: "Empty products list (guarded)",
          emptyProductsGuard: true,
        };
      }

      const payloadObj = { ok: true, data, ms: Date.now() - t0 };
      const payloadStr = JSON.stringify(payloadObj);

      return { ok: true, status: 200, payloadStr, productCount };
    });

    const ms = Date.now() - t0;

    // Handle upstream failure → serve last-known-good (public only)
    if (!result?.ok) {
      if (!hasClientSecret) {
        // 1) Prefer global products last-good for /products list (strongest “never blank grid” guarantee)
        if (isProductsList && globalProductsLastGoodKey) {
          const lgGlobal = lastGoodGet(globalProductsLastGoodKey);
          if (lgGlobal?.payloadStr) {
            return rawJsonResponse(lgGlobal.payloadStr, 200, {
              "cache-control": cacheControl,
              "CDN-Cache-Control": cacheControl,
              "x-tdls-proxy-ms": String(ms),
              "x-tdls-stale": "1",
              "x-tdls-fallback": "global:last-good",
              "x-tdls-upstream-status": String(result?.status || 0),
            });
          }
        }

        // 2) Then try exact-path last-good
        const lg = lastGoodGet(lastGoodKey);
        if (lg?.payloadStr) {
          return rawJsonResponse(lg.payloadStr, 200, {
            "cache-control": cacheControl,
            "CDN-Cache-Control": cacheControl,
            "x-tdls-proxy-ms": String(ms),
            "x-tdls-stale": "1",
            "x-tdls-fallback": "last-good",
            "x-tdls-upstream-status": String(result?.status || 0),
          });
        }

        // 3) If still nothing and this is /products list → do a direct global products fetch NOW (real data)
        if (isProductsList) {
          const g = await fetchGlobalProductsNow(baseHeaders);
          if (g?.data) {
            const payloadObj = { ok: true, data: g.data, ms: Date.now() - t0 };
            const payloadStr = JSON.stringify(payloadObj);

            // cache + last-good only if non-empty (fetchGlobalProductsNow enforces that)
            if (CACHE_OK) {
              memSet(
                MEM_PROD,
                `${CACHE_OK ? "pub" : "noc"}|prod|${g.effectivePath}`,
                payloadStr,
                { "cache-control": cacheControl, "CDN-Cache-Control": cacheControl },
                MEM_PROD_TTL_MS
              );
            }
            lastGoodSet(`pub|prod|${g.effectivePath}`, payloadStr);

            return rawJsonResponse(payloadStr, 200, {
              "cache-control": cacheControl,
              "CDN-Cache-Control": cacheControl,
              "x-tdls-proxy-ms": String(Date.now() - t0),
              "x-tdls-stale": "1",
              "x-tdls-fallback": "global:refetch",
              "x-tdls-upstream-status": String(result?.status || 0),
            });
          }
        }
      }

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
        }
      );
    }

    // Success path
    const payloadStr = result.payloadStr || JSON.stringify({ ok: true, data: null, ms });

    // Store micro-cache (NEVER cache empty products list — already guarded inside dedupe)
    if (CACHE_OK) {
      const map = isProductEndpoint ? MEM_PROD : MEM_META;
      memSet(
        map,
        cacheKey,
        payloadStr,
        {
          "cache-control": cacheControl,
          "CDN-Cache-Control": cacheControl,
        },
        isProductEndpoint ? MEM_PROD_TTL_MS : MEM_TTL_MS
      );
    }

    // Store last-known-good for public reads
    if (!hasClientSecret) {
      // Never poison last-good with empty product list (also already guarded)
      lastGoodSet(lastGoodKey, payloadStr);

      // Keep a global /products last-good as well (best “never blank” fallback)
      if (isProductsList && globalProductsLastGoodKey) {
        lastGoodSet(globalProductsLastGoodKey, payloadStr);
      }
    }

    return rawJsonResponse(payloadStr, 200, {
      "cache-control": cacheControl,
      "CDN-Cache-Control": cacheControl,
      "x-tdls-proxy-ms": String(ms),
      "x-tdls-cache": CACHE_OK ? "1" : "0",
      "x-tdls-mem": "0",
      "x-tdls-stale": "0",
    });
  } catch (err) {
    const ms = Date.now() - t0;

    const name = String(err?.name || "");
    const isAbort =
      name === "AbortError" ||
      name.toLowerCase().includes("abort") ||
      String(err?.message || "").toLowerCase().includes("aborted");

    // If timeout/abort → serve last-known-good (public only)
    try {
      const url = new URL(req.url);
      const hasSecret = !!(
        url.searchParams.get("secret") ||
        req.headers.get("x-strapi-sync-secret") ||
        req.headers.get("x-strapi-proxy-secret")
      );

      const normalizedPath0 = normalizeStrapiPath(url.searchParams.get("path") || "");
      const effectivePath = canonicalizePath(normalizeProductsPath(canonicalizePath(normalizedPath0)));
      const { pathname } = splitPathAndQuery(effectivePath);
      const isProductEndpoint = pathname === "/products" || pathname.startsWith("/products/");
      const isProductsList = isProductEndpoint && pathname === "/products";

      const lastGoodKey = `${hasSecret ? "sec" : "pub"}|${isProductEndpoint ? "prod" : "meta"}|${effectivePath}`;

      if (!hasSecret) {
        // Prefer global /products last-good for product list
        if (isProductsList) {
          const globalPath = getGlobalProductsEffectivePath();
          const globalKey = `pub|prod|${globalPath}`;
          const lgGlobal = lastGoodGet(globalKey);
          if (lgGlobal?.payloadStr) {
            const cacheControl = PRODUCT_CACHE_CONTROL;
            return rawJsonResponse(lgGlobal.payloadStr, 200, {
              "cache-control": cacheControl,
              "CDN-Cache-Control": cacheControl,
              "x-tdls-proxy-ms": String(ms),
              "x-tdls-stale": "1",
              "x-tdls-fallback": isAbort ? "timeout:global:last-good" : "error:global:last-good",
            });
          }
        }

        const lg = lastGoodGet(lastGoodKey);
        if (lg?.payloadStr) {
          const cacheControl = isProductEndpoint ? PRODUCT_CACHE_CONTROL : META_CACHE_CONTROL;

          return rawJsonResponse(lg.payloadStr, 200, {
            "cache-control": cacheControl,
            "CDN-Cache-Control": cacheControl,
            "x-tdls-proxy-ms": String(ms),
            "x-tdls-stale": "1",
            "x-tdls-fallback": isAbort ? "timeout:last-good" : "error:last-good",
          });
        }
      }
    } catch {
      // ignore fallback parse errors; fall through
    }

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
