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

// Hard safety timeout to avoid “hanging streams” and platform 502 timeouts.
const UPSTREAM_TIMEOUT_MS = (() => {
  const n = Number(process.env.STRAPI_PROXY_TIMEOUT_MS || 12000);
  if (!Number.isFinite(n) || n <= 0) return 12000;
  // clamp: 3s..25s
  return Math.min(25000, Math.max(3000, Math.round(n)));
})();

/* ───────── helpers ───────── */

function j(body, status = 200, extraHeaders = {}) {
  return new NextResponse(body === undefined ? "null" : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // default; can be overridden via extraHeaders
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function normalizeOrigin(raw) {
  let o = (raw || "").trim();

  // Add scheme if someone provided only host
  if (o && !/^https?:\/\//i.test(o)) {
    o = `${IS_PROD ? "https" : "http"}://${o}`;
  }

  // Prefer IPv4 loopback in dev if used
  o = o.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");

  // strip trailing slashes and accidental trailing /api
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
// If this throws during cold start, Vercel can surface it as 502 Bad Gateway.
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

/* ───────── Prisma lazy-load (CRITICAL FIX) ───────── */
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

/**
 * Extract all Strapi size IDs from a Strapi product payload.
 * Supports both flattened JSON and Strapi attributes/data shape.
 */
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

/**
 * Patch Strapi products with live Prisma stock (logic unchanged).
 */
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
      return j(
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
        console.error("STRAPI_SYNC_SECRET is not set in environment");
        return j(
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
        return j({ ok: false, error: "UNAUTHORIZED", message: "Invalid proxy secret" }, 401);
      }
    }

    const rawPath = url.searchParams.get("path") || "";
    const normalizedPath = normalizeStrapiPath(rawPath);

    if (!normalizedPath) {
      return j(
        {
          ok: false,
          error: "BAD_REQUEST",
          message:
            "Invalid or missing `path` query parameter (must be a relative Strapi API path).",
        },
        400
      );
    }

    const isProductEndpoint =
      normalizedPath.startsWith("/products") || normalizedPath.startsWith("/products/");

    const target = `${STRAPI_API_BASE}${normalizedPath}`;

    const baseHeaders = {
      Accept: "application/json",
    };

    // SPEED: edge cache ONLY for non-product + non-secret reads (payload unchanged)
    const noCache = url.searchParams.get("noCache") === "1";
    const cacheControl =
      !noCache && !isProductEndpoint && !hasClientSecret
        ? "public, s-maxage=60, stale-while-revalidate=300"
        : "no-store";

    let res;

    if (STRAPI_TOKEN) {
      res = await fetchWithTimeout(target, {
        method: "GET",
        headers: { ...baseHeaders, Authorization: `Bearer ${STRAPI_TOKEN}` },
        cache: "no-store",
      });

      if (res.status === 401) {
        console.warn(
          "[strapi-proxy] Got 401 with token, retrying without Authorization header"
        );
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
      const ms = Date.now() - t0;

      return j(
        {
          ok: false,
          error: "STRAPI_PROXY_ERROR",
          status: res.status,
          statusText: res.statusText,
          message: "Strapi request failed",
          details: text || null,
          ms,
          target: IS_PROD ? undefined : target,
        },
        502,
        {
          "cache-control": "no-store",
          "x-tdls-upstream-status": String(res.status),
          "x-tdls-proxy-ms": String(ms),
        }
      );
    }

    let data;
    try {
      data = await res.json();
    } catch {
      const ms = Date.now() - t0;
      return j(
        {
          ok: false,
          error: "STRAPI_PROXY_ERROR",
          message: "Upstream returned invalid JSON",
          ms,
          target: IS_PROD ? undefined : target,
        },
        502,
        { "cache-control": "no-store", "x-tdls-proxy-ms": String(ms) }
      );
    }

    // Patch stock ONLY for products (same behavior as before)
    if (isProductEndpoint) {
      try {
        data = await patchProductsWithPrismaStock(data);
      } catch (e) {
        console.error(
          "[strapi-proxy] Failed to patch stock from Prisma – falling back to raw Strapi response",
          e
        );
      }
    }

    const ms = Date.now() - t0;

    return j(
      { ok: true, data, ms },
      200,
      {
        "cache-control": cacheControl,
        "x-tdls-proxy-ms": String(ms),
        "x-tdls-cache": cacheControl.includes("s-maxage") ? "1" : "0",
      }
    );
  } catch (err) {
    const ms = Date.now() - t0;

    const name = String(err?.name || "");
    const isAbort =
      name === "AbortError" ||
      name.toLowerCase().includes("abort") ||
      String(err?.message || "").toLowerCase().includes("aborted");

    if (isAbort) {
      return j(
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
    return j(
      { ok: false, error: "STRAPI_PROXY_ERROR", message: "fetch failed", ms },
      500,
      { "cache-control": "no-store", "x-tdls-proxy-ms": String(ms) }
    );
  }
}
