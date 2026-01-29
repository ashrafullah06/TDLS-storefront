// PATH: app/api/strapi/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

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

// Hard safety timeout to avoid “hanging streams” and Vercel platform 502 timeouts.
// Keep it below typical serverless hard limits.
const UPSTREAM_TIMEOUT_MS = (() => {
  const n = Number(process.env.STRAPI_PROXY_TIMEOUT_MS || 12000);
  if (!Number.isFinite(n) || n <= 0) return 12000;
  // clamp: 3s..25s (safe)
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
 *
 * Allowed:
 *  - "/products?populate=*"
 *  - "products?populate=*"
 *  - "/products/123?populate=*"
 */
function normalizeStrapiPath(input) {
  const p = String(input || "").trim();
  if (!p) return "";

  // Reject full URLs to avoid SSRF and odd behavior
  if (/^https?:\/\//i.test(p)) return "";

  // Reject protocol-relative urls like //evil.com
  if (p.startsWith("//")) return "";

  // Reject any CRLF
  if (/[\r\n]/.test(p)) return "";

  // Ensure leading slash
  return p.startsWith("/") ? p : `/${p}`;
}

function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  return fetch(url, {
    ...init,
    signal: controller.signal,
    // Always follow redirects (Strapi behind proxies/CDNs sometimes redirects)
    redirect: "follow",
  }).finally(() => clearTimeout(t));
}

/**
 * Extract all Strapi size IDs from a Strapi product payload.
 * Supports both:
 *   - your flattened JSON (row.variants[].sizes[])
 *   - more "raw" Strapi style (row.attributes.variants.data[].attributes.sizes.data[])
 */
function collectSizeIdsFromStrapiProducts(strapiData) {
  const itemsRaw = strapiData?.data;

  const items = Array.isArray(itemsRaw) ? itemsRaw : itemsRaw ? [itemsRaw] : [];

  const sizeIds = new Set();

  for (const item of items) {
    // flattened vs attributes
    let row = item;
    const attrs = row.attributes || null;

    let variants = row.variants || attrs?.variants || [];

    // if Strapi-style collection (with .data)
    if (variants && Array.isArray(variants.data)) {
      variants = variants.data.map((v) => v.attributes || v);
    }

    if (!Array.isArray(variants)) continue;

    for (const v of variants) {
      let sizes = v.sizes || v.attributes?.sizes || [];

      if (sizes && Array.isArray(sizes.data)) {
        sizes = sizes.data.map((s) => s); // keep id + attributes
      }

      if (!Array.isArray(sizes)) continue;

      for (const s of sizes) {
        // support multiple styles of id storage
        const rawId = s.id ?? s.size_id ?? s.strapiSizeId ?? s.attributes?.id;

        const sid = Number(rawId);
        if (Number.isFinite(sid) && sid > 0) {
          sizeIds.add(sid);
        }
      }
    }
  }

  return { items, sizeIds };
}

/**
 * Patch Strapi products with live Prisma stock:
 *  - For each size row, override:
 *      s.stock_quantity
 *      s.live_stock
 *      s.is_available
 *    and also mirror to s.attributes.* if present.
 */
async function patchProductsWithPrismaStock(strapiData) {
  const { items, sizeIds } = collectSizeIdsFromStrapiProducts(strapiData);

  if (sizeIds.size === 0) {
    return strapiData; // nothing to patch
  }

  // Load all matching variants from Prisma
  const prismaVariants = await prisma.productVariant.findMany({
    where: {
      strapiSizeId: { in: Array.from(sizeIds) },
    },
    select: {
      strapiSizeId: true,
      stockAvailable: true,
    },
  });

  const bySizeId = new Map(prismaVariants.map((v) => [v.strapiSizeId, v.stockAvailable]));

  // Patch in-place
  for (const item of items) {
    const row = item;
    const attrs = row.attributes || null;

    let variants = row.variants || attrs?.variants || [];

    if (variants && Array.isArray(variants.data)) {
      variants = variants.data.map((v) => v); // keep id + attributes
    }

    if (!Array.isArray(variants)) continue;

    for (const v of variants) {
      const vAttrs = v.attributes || null;

      let sizes = v.sizes || vAttrs?.sizes || [];

      if (sizes && Array.isArray(sizes.data)) {
        sizes = sizes.data.map((s) => s); // keep id + attributes
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

        // Direct fields (flattened / custom JSON)
        s.stock_quantity = liveStock;
        s.live_stock = liveStock;
        s.is_available = isAvailable;

        // If Strapi nested attributes exists, mirror there as well
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
      // Prevent platform 502 (module init crash) by returning a clean JSON error.
      return j(
        {
          ok: false,
          error: "SERVER_MISCONFIGURED",
          message: STRAPI_BOOT_ERROR,
        },
        500,
        { "cache-control": "no-store" }
      );
    }

    const url = new URL(req.url);

    // Optional secret – only validated when actually provided
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

    // Extract Strapi path (like /products?populate=*)
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

    // Detect product endpoints so we can patch stock from Prisma
    const isProductEndpoint =
      normalizedPath.startsWith("/products") || normalizedPath.startsWith("/products/");

    // Compose final Strapi URL: https://<strapi>/api/products?populate=*
    const target = `${STRAPI_API_BASE}${normalizedPath}`;

    // Prepare headers (with optional token)
    const baseHeaders = {
      Accept: "application/json",
      // Avoid setting Content-Type on GET (not needed and sometimes harms proxies)
    };

    // Faster delivery without changing logic:
    // - Allow CDN caching ONLY for non-product, non-secret reads.
    //   Products must remain no-store because live stock is patched via Prisma.
    // - Also allow opt-out: ?noCache=1
    const noCache = url.searchParams.get("noCache") === "1";
    const cacheControl =
      !noCache && !isProductEndpoint && !hasClientSecret
        ? "public, s-maxage=60, stale-while-revalidate=300"
        : "no-store";

    let res;

    // Fetch with token (if present), else public fetch.
    // Logic unchanged: 401 with token -> retry without Authorization.
    if (STRAPI_TOKEN) {
      const headersWithToken = {
        ...baseHeaders,
        Authorization: `Bearer ${STRAPI_TOKEN}`,
      };

      res = await fetchWithTimeout(target, {
        method: "GET",
        headers: headersWithToken,
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

      // Keep your behavior (proxy returns 502 on upstream failure),
      // but add timing + upstream status for faster debugging.
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
    } catch (e) {
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

    // OVERRIDE STOCK WITH PRISMA (OPTION A) — unchanged logic
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

    // IMPORTANT:
    // We wrap Strapi's raw payload in { ok: true, data }
    // This keeps compatibility with fetchProductsFromStrapi and other helpers.
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

    // Distinguish timeout aborts vs generic failure
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
