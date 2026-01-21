// PATH: app/api/home/highlights/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * TDLS Home Highlights API – LIVE DATA
 *
 * - TRENDING PRODUCTS:
 *      last 3 months, aggregated by PRODUCT (via variants),
 *      sorted by total quantity sold (desc).
 *
 * - BEST-SELLER PRODUCTS:
 *      all-time, aggregated by PRODUCT (via variants),
 *      sorted by total quantity sold (desc).
 *
 * Notes:
 * - OrderItem typically references productVariant via variantId.
 * - Trending is filtered by Order.createdAt (not OrderItem.createdAt).
 *
 * Production fix:
 * - Add short in-memory cache to reduce DB pressure and prevent P2024 pool timeouts.
 * - Run both groupBy queries inside a single transaction to minimize connection churn.
 */

const MAX_ITEMS = 12;
const SOLD_STATUSES = ["PLACED", "CONFIRMED", "COMPLETED"];

/**
 * IMPORTANT:
 * We group by variantId then bucket by productId (because OrderItem stores variantId).
 * To avoid losing multi-variant totals due to variant-level limiting, we sample more variants.
 */
const VARIANT_SAMPLE = Math.min(600, Math.max(120, MAX_ITEMS * 50)); // 12 -> 600 max

/* ───────────────── response helper ───────────────── */

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/* ───────────────── tiny in-memory cache (server-side) ─────────────────
   - Per server instance (Vercel/Node runtime instance).
   - Prevents stampede that triggers P2024 when connection_limit is low.
----------------------------------------------------------------------- */

const MEM_CACHE_KEY = "__TDLS_HOME_HIGHLIGHTS_CACHE_V1__";
const MEM_TTL_MS = 60 * 1000; // 60s (short TTL; safe for "live" feel; huge DB relief)

function readMemCache() {
  try {
    const c = globalThis[MEM_CACHE_KEY];
    if (!c || typeof c !== "object") return null;
    const ts = Number(c.ts || 0);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > MEM_TTL_MS) return null;
    if (!c.data || typeof c.data !== "object") return null;
    return c.data;
  } catch {
    return null;
  }
}

function writeMemCache(data) {
  try {
    globalThis[MEM_CACHE_KEY] = { ts: Date.now(), data };
  } catch {
    // ignore
  }
}

/* ───────────────── price & image helpers ───────────────── */

function extractPriceRange(product) {
  if (!product) return { priceFrom: null, priceTo: null };

  // Preferred canonical fields
  if (product.priceMin != null || product.priceMax != null) {
    const min = product.priceMin ?? product.priceMax;
    const max = product.priceMax ?? product.priceMin;
    return {
      priceFrom: Number.isFinite(Number(min)) ? Number(min) : null,
      priceTo: Number.isFinite(Number(max)) ? Number(max) : null,
    };
  }

  // Legacy / mirrored fields (safe: accessing unknown fields is OK in JS)
  const prices = [];
  const pushNum = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) prices.push(n);
  };

  pushNum(product.priceSale ?? product.price_sale);
  pushNum(product.priceMrp ?? product.price_mrp);
  pushNum(product.selling_price);
  pushNum(product.compare_price);

  if (prices.length === 0) return { priceFrom: null, priceTo: null };

  prices.sort((a, b) => a - b);
  return { priceFrom: prices[0], priceTo: prices[prices.length - 1] };
}

function extractCoverImage(product) {
  if (!product) return null;

  // Prisma Product.media -> ProductMedia -> MediaAsset.url
  if (Array.isArray(product.media) && product.media.length > 0) {
    const first = product.media[0];
    if (first?.media?.url) return first.media.url;
  }

  // Optional fallbacks (only if your schema has these fields)
  const direct =
    product.coverImageUrl ||
    product.coverImage ||
    product.cover_image ||
    product.thumbnail ||
    product.image ||
    null;

  if (direct) return direct;

  const gallery = product.gallery || product.images || [];
  if (Array.isArray(gallery) && gallery.length > 0) {
    const first = gallery[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") return first.url || first.src || null;
  }

  return null;
}

function mapHighlightRowFromProduct(product, totalSold) {
  if (!product) return null;

  const { priceFrom, priceTo } = extractPriceRange(product);
  const coverImageUrl = extractCoverImage(product);

  const slug = product.slug || product.strapiSlug || product.productCode || null;
  const title =
    product.title ||
    product.name ||
    product.displayName ||
    product.productCode ||
    "TDLS piece";

  const href = slug ? `/product/${slug}` : "/product";

  return {
    id: product.id,
    slug,
    title,
    href,
    priceFrom,
    priceTo,
    coverImageUrl: coverImageUrl || null,
    coverImageAlt: title,
    totalSold: Number(totalSold ?? 0),
  };
}

/* ───────────────── aggregation helpers ───────────────── */

function buildProductBuckets(groupRows, variantMap) {
  const buckets = new Map(); // productId -> { totalQty, variantIds:Set }

  for (const row of groupRows || []) {
    const vid = row?.variantId;
    if (!vid) continue;

    const variant = variantMap.get(vid);
    if (!variant || !variant.productId) continue;

    const pid = variant.productId;
    const qty = Number(row?._sum?.quantity ?? 0);

    if (!buckets.has(pid)) {
      buckets.set(pid, { totalQty: 0, variantIds: new Set() });
    }

    const entry = buckets.get(pid);
    entry.totalQty += Number.isFinite(qty) ? qty : 0;
    entry.variantIds.add(variant.id);
  }

  return buckets;
}

/* ───────────────── GET handler ───────────────── */

export async function GET() {
  // Fast path: serve hot cache to avoid DB stampede (prevents P2024 in production)
  const cached = readMemCache();
  if (cached) return json(cached);

  try {
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    /**
     * Run both aggregates inside a single transaction.
     * This reduces connection churn per request and behaves better under low pool limits.
     */
    const [trendingGroup, bestGroup] = await prisma.$transaction(
      [
        prisma.orderItem.groupBy({
          by: ["variantId"],
          where: {
            variantId: { not: null },
            order: {
              status: { in: SOLD_STATUSES },
              createdAt: { gte: threeMonthsAgo },
            },
          },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: VARIANT_SAMPLE,
        }),

        prisma.orderItem.groupBy({
          by: ["variantId"],
          where: {
            variantId: { not: null },
            order: {
              status: { in: SOLD_STATUSES },
            },
          },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: "desc" } },
          take: VARIANT_SAMPLE,
        }),
      ],
      // These options help Prisma wait a bit longer for the single connection when needed
      // (but the in-memory cache is the main protection).
      { maxWait: 8000, timeout: 20000 }
    );

    const variantIds = Array.from(
      new Set([
        ...(trendingGroup || []).map((r) => r.variantId).filter(Boolean),
        ...(bestGroup || []).map((r) => r.variantId).filter(Boolean),
      ])
    );

    if (variantIds.length === 0) {
      const empty = {
        ok: true,
        mode: "LIVE",
        trendingProducts: [],
        bestSellerProducts: [],
      };
      writeMemCache(empty);
      return json(empty);
    }

    /**
     * Load variants + product + first media only.
     * Keep includes conservative to avoid schema mismatches.
     */
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          include: {
            media: {
              take: 1,
              include: { media: true },
            },
          },
        },
      },
    });

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const productMap = new Map();

    for (const v of variants) {
      if (v?.product?.id) productMap.set(v.product.id, v.product);
    }

    const trendingBuckets = buildProductBuckets(trendingGroup, variantMap);
    const bestBuckets = buildProductBuckets(bestGroup, variantMap);

    const trendingSorted = Array.from(trendingBuckets.entries())
      .sort(([, a], [, b]) => (b?.totalQty ?? 0) - (a?.totalQty ?? 0))
      .slice(0, MAX_ITEMS);

    const bestSorted = Array.from(bestBuckets.entries())
      .sort(([, a], [, b]) => (b?.totalQty ?? 0) - (a?.totalQty ?? 0))
      .slice(0, MAX_ITEMS);

    const trendingProducts = [];
    for (const [productId, bucket] of trendingSorted) {
      const product = productMap.get(productId);
      const mapped = mapHighlightRowFromProduct(product, bucket?.totalQty ?? 0);
      if (mapped) trendingProducts.push(mapped);
    }

    const bestSellerProducts = [];
    for (const [productId, bucket] of bestSorted) {
      const product = productMap.get(productId);
      const mapped = mapHighlightRowFromProduct(product, bucket?.totalQty ?? 0);
      if (mapped) bestSellerProducts.push(mapped);
    }

    const payload = {
      ok: true,
      mode: "LIVE",
      trendingProducts,
      bestSellerProducts,
    };

    // Cache the computed payload briefly to prevent pool timeouts under load
    writeMemCache(payload);

    return json(payload);
  } catch (err) {
    console.error("[home/highlights] error:", err);
    return json(
      {
        ok: false,
        error: "HIGHLIGHTS_FAILED",
      },
      500
    );
  }
}
