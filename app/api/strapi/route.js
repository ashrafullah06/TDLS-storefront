// PATH: app/api/strapi/route.js
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
  const n = Number(process.env.STRAPI_PROXY_TIMEOUT_MS || 20000); // bumped default to reduce false timeouts
  if (!Number.isFinite(n) || n <= 0) return 20000;
  return Math.min(25000, Math.max(3000, Math.round(n)));
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
 */
function normalizeStrapiPath(input) {
  const p = String(input || "").trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return "";
  if (p.startsWith("//")) return "";
  if (/[\r\n]/.test(p)) return "";
  return p.startsWith("/") ? p : `/${p}`;
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

const INFLIGHT = new Map(); // key -> Promise<{ ok, status, payloadStr, headers }>
const MEM = new Map(); // key -> { exp, payloadStr, headers }

const MEM_TTL_MS = (() => {
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_TTL_MS || 120000); // 2 min
  if (!Number.isFinite(n) || n <= 0) return 120000;
  return Math.min(10 * 60 * 1000, Math.max(10 * 1000, Math.round(n))); // clamp 10s..10m
})();

const MEM_MAX_BYTES = (() => {
  const n = Number(process.env.TDLS_STRAPI_MEMCACHE_MAX_BYTES || 1024 * 1024); // 1MB
  if (!Number.isFinite(n) || n <= 0) return 1024 * 1024;
  return Math.min(6 * 1024 * 1024, Math.max(64 * 1024, Math.round(n))); // clamp 64KB..6MB
})();

function memGet(key) {
  const v = MEM.get(key);
  if (!v) return null;
  if (v.exp <= Date.now()) {
    MEM.delete(key);
    return null;
  }
  return v;
}

function memSet(key, payloadStr, headers) {
  if (typeof payloadStr !== "string") return;
  if (payloadStr.length > MEM_MAX_BYTES) return; // size guard
  MEM.set(key, { exp: Date.now() + MEM_TTL_MS, payloadStr, headers });
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

/* ───────── stock patch helpers (logic unchanged) ───────── */

function collectSizeIdsFromStrapiProducts(strapiData) {
  const itemsRaw = strapiData?.data;
  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];

  const sizeIds = new Set();

  for (const item of items) {
    const row = item;
    const attrs = row.attributes || null;

    let variants = row.variants || attrs?.variants || [];

    if (variants && Array.isArray(variants.data)) {
      variants = variants.data.map((v) => v.attributes || v);
    }
    if (!Array.isArray(variants)) continue;

    for (const v of variants) {
      let sizes = v.sizes || v.attributes?.sizes || [];

      if (sizes && Array.isArray(sizes.data)) {
        sizes = sizes.data.map((s) => s);
      }
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

async function patchProductsWithPrismaStock(strapiData) {
  const { items, sizeIds } = collectSizeIdsFromStrapiProducts(strapiData);
  if (sizeIds.size === 0) return strapiData;

  const prisma = await getPrisma();

  const prismaVariants = await prisma.productVariant.findMany({
    where: { strapiSizeId: { in: Array.from(sizeIds) } },
    select: { strapiSizeId: true, stockAvailable: true },
  });

  const bySizeId = new Map(prismaVariants.map((v) => [v.strapiSizeId, v.stockAvailable]));

  for (const item of items) {
    const row = item;
    const attrs = row.attributes || null;

    let variants = row.variants || attrs?.variants || [];

    if (variants && Array.isArray(variants.data)) {
      variants = variants.data.map((v) => v);
    }
    if (!Array.isArray(variants)) continue;

    for (const v of variants) {
      const vAttrs = v.attributes || null;

      let sizes = v.sizes || vAttrs?.sizes || [];

      if (sizes && Array.isArray(sizes.data)) {
        sizes = sizes.data.map((s) => s);
      }
      if (!Array.isArray(sizes)) continue;

      for (const s of sizes) {
        const sAttrs = s.attributes || null;

        const rawId = s.id ?? s.size_id ?? s.strapiSizeId ?? sAttrs?.id;
        const sid = Number(rawId);
        if (!Number.isFinite(sid) || sid <= 0) continue;

        const live = bySizeId.get(sid);
        if (live == null) continue;

        const liveStock = Number(live) || 0;
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

  return strapiData;
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
    const normalizedPath = normalizeStrapiPath(rawPath);

    if (!normalizedPath) {
      return jsonResponse(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: "Invalid or missing `path` query parameter (must be a relative Strapi API path).",
        },
        400
      );
    }

    const isProductEndpoint =
      normalizedPath.startsWith("/products") || normalizedPath.startsWith("/products/");

    const target = `${STRAPI_API_BASE}${normalizedPath}`;

    const baseHeaders = { Accept: "application/json" };

    // cache policy (NO logic change):
    // - cache ONLY non-product + non-secret
    // - allow opt-out: &noCache=1
    const noCache = url.searchParams.get("noCache") === "1";
    const CACHE_OK = !noCache && !isProductEndpoint && !hasClientSecret;

    const cacheControl = CACHE_OK
      ? "public, max-age=60, s-maxage=300, stale-while-revalidate=3600, stale-if-error=86400"
      : "no-store";

    const cacheKey = `${CACHE_OK ? "pub" : "noc"}|${normalizedPath}`;

    // 1) in-memory micro-cache (only for CACHE_OK)
    if (CACHE_OK) {
      const hit = memGet(cacheKey);
      if (hit?.payloadStr) {
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

    // 2) dedupe concurrent requests for same key (CACHE_OK + products too)
    const dedupeKey = `${isProductEndpoint ? "prod" : "meta"}|${normalizedPath}|${
      hasClientSecret ? "sec" : "pub"
    }|${STRAPI_TOKEN ? "tok" : "notok"}|${noCache ? "nc1" : "nc0"}`;

    const result = await runDedupe(dedupeKey, async () => {
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
        try {
          data = await patchProductsWithPrismaStock(data);
        } catch (e) {
          console.error("[strapi-proxy] Failed to patch stock from Prisma – fallback to raw", e);
        }
      }

      const payloadObj = { ok: true, data };
      const payloadStr = JSON.stringify(payloadObj);

      return { ok: true, status: 200, payloadStr };
    });

    const ms = Date.now() - t0;

    // Handle upstream failure
    if (!result?.ok) {
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
    const payloadStr = result.payloadStr || JSON.stringify({ ok: true, data: null });

    // Store micro-cache for CACHE_OK
    if (CACHE_OK) {
      memSet(cacheKey, payloadStr, {
        "cache-control": cacheControl,
        "CDN-Cache-Control": cacheControl,
      });
    }

    return rawJsonResponse(payloadStr, 200, {
      "cache-control": cacheControl,
      "CDN-Cache-Control": cacheControl,
      "x-tdls-proxy-ms": String(ms),
      "x-tdls-cache": CACHE_OK ? "1" : "0",
      "x-tdls-mem": CACHE_OK ? "0" : "0",
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
