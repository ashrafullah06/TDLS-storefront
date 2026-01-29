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
  try {
    const h = new URL(origin).hostname;
    const isLocal =
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".local");
    if (isLocal) {
      throw new Error(
        `Invalid STRAPI_URL for production (localhost): ${origin}. Set STRAPI_URL/STRAPI_API_ORIGIN to your real Strapi domain (https://...).`
      );
    }
  } catch {
    throw new Error(
      `Invalid STRAPI_URL for production: ${origin}. Set STRAPI_URL/STRAPI_API_ORIGIN to a valid https URL.`
    );
  }
}

const STRAPI_ORIGIN = normalizeOrigin(RAW_STRAPI_ORIGIN);
assertNotLocalhostInProd(STRAPI_ORIGIN);

// Final REST base = origin + /api
const STRAPI_API_BASE = STRAPI_ORIGIN + "/api";

// Secret used by internal / cron calls (OPTIONAL for public reads)
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

/* ───────── helpers ───────── */

function j(body, status = 200, extraHeaders = {}) {
  return new NextResponse(body === undefined ? "null" : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
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

/**
 * Extract all Strapi size IDs from a Strapi product payload.
 * Supports both:
 *   - your flattened JSON (row.variants[].sizes[])
 *   - more "raw" Strapi style (row.attributes.variants.data[].attributes.sizes.data[])
 */
function collectSizeIdsFromStrapiProducts(strapiData) {
  const itemsRaw = strapiData?.data;

  const items = Array.isArray(itemsRaw)
    ? itemsRaw
    : itemsRaw
    ? [itemsRaw]
    : [];

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
        const rawId =
          s.id ?? s.size_id ?? s.strapiSizeId ?? s.attributes?.id;

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

  const bySizeId = new Map(
    prismaVariants.map((v) => [v.strapiSizeId, v.stockAvailable])
  );

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
  try {
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
        return j(
          { ok: false, error: "UNAUTHORIZED", message: "Invalid proxy secret" },
          401
        );
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
      normalizedPath.startsWith("/products") ||
      normalizedPath.startsWith("/products/");

    // Compose final Strapi URL: https://<strapi>/api/products?populate=*
    const target = `${STRAPI_API_BASE}${normalizedPath}`;

    // Prepare headers (with optional token)
    const baseHeaders = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    let res;

    if (STRAPI_TOKEN) {
      const headersWithToken = {
        ...baseHeaders,
        Authorization: `Bearer ${STRAPI_TOKEN}`,
      };

      res = await fetch(target, {
        method: "GET",
        headers: headersWithToken,
        cache: "no-store",
      });

      // If Strapi says "Missing or invalid credentials", retry WITHOUT Authorization
      if (res.status === 401) {
        console.warn(
          "[strapi-proxy] Got 401 with token, retrying without Authorization header"
        );
        res = await fetch(target, {
          method: "GET",
          headers: baseHeaders,
          cache: "no-store",
        });
      }
    } else {
      // No token configured – just call public endpoint
      res = await fetch(target, {
        method: "GET",
        headers: baseHeaders,
        cache: "no-store",
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return j(
        {
          ok: false,
          error: "STRAPI_PROXY_ERROR",
          status: res.status,
          statusText: res.statusText,
          message: "Strapi request failed",
          details: text || null,
          target: IS_PROD ? undefined : target, // avoid leaking internal target in prod
        },
        502
      );
    }

    let data = await res.json();

    // OVERRIDE STOCK WITH PRISMA (OPTION A)
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

    // IMPORTANT:
    // We wrap Strapi's raw payload in { ok: true, data }
    // This keeps compatibility with fetchProductsFromStrapi and other helpers.
    return j({ ok: true, data }, 200);
  } catch (err) {
    console.error("STRAPI PROXY FATAL ERROR:", err);
    return j(
      { ok: false, error: "STRAPI_PROXY_ERROR", message: "fetch failed" },
      500
    );
  }
}
