// PATH: app/api/internal/stock-diff/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const INTERNAL_TOKEN = process.env.INTERNAL_CRON_TOKEN || "";

/* ───────────────── helpers ───────────────── */

function json(body, status = 200) {
  return new NextResponse(
    body === undefined ? "null" : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

/* ───────────────── route ───────────────── */

export async function GET(req) {
  try {
    // ───────── basic protection ─────────
    if (!INTERNAL_TOKEN) {
      return json(
        {
          ok: false,
          code: "NO_TOKEN",
          message: "INTERNAL_CRON_TOKEN is not configured on the server.",
        },
        500
      );
    }

    const auth = req.headers.get("x-internal-cron-token");
    if (auth !== INTERNAL_TOKEN) {
      return json(
        {
          ok: false,
          code: "UNAUTHORIZED",
          message: "Missing or invalid x-internal-cron-token.",
        },
        401
      );
    }

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    let limit = Number(limitParam);
    if (!Number.isFinite(limit) || limit <= 0) limit = 200;
    if (limit > 1000) limit = 1000;

    // ───────── 1) Pull candidates that actually mirror Strapi ─────────
    const candidates = await prisma.productVariant.findMany({
      where: {
        archivedAt: null,
        strapiSizeId: { not: null },
        strapiStockRaw: { not: null },
      },
      select: {
        id: true,
        productId: true,
        sizeName: true,
        colorName: true,
        strapiSizeId: true,
        strapiVariantId: true,
        stockAvailable: true,
        stockReserved: true,
        initialStock: true,
        strapiStockRaw: true,
        strapiStockSyncedAt: true,
        product: {
          select: {
            id: true,
            title: true,
            slug: true,
            strapiId: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: limit * 3, // grab more than needed; we'll trim after diff
    });

    // ───────── 2) Filter mismatches in JS ─────────
    const mismatches = [];
    for (const v of candidates) {
      const live = Number(v.stockAvailable ?? 0);
      const raw = Number(v.strapiStockRaw ?? 0);
      if (!Number.isFinite(live) || !Number.isFinite(raw)) continue;

      if (live !== raw) {
        mismatches.push(v);
        if (mismatches.length >= limit) break;
      }
    }

    return json({
      ok: true,
      count: mismatches.length,
      limit,
      items: mismatches.map((v) => {
        const live = Number(v.stockAvailable ?? 0);
        const raw = Number(v.strapiStockRaw ?? 0);
        return {
          variantId: v.id,
          productId: v.productId,
          productTitle: v.product?.title ?? null,
          productSlug: v.product?.slug ?? null,
          strapiProductId: v.product?.strapiId ?? null,
          strapiSizeId: v.strapiSizeId,
          strapiVariantId: v.strapiVariantId,
          colorName: v.colorName,
          sizeName: v.sizeName,
          stockAvailable: live,
          stockReserved: v.stockReserved,
          initialStock: v.initialStock,
          strapiStockRaw: raw,
          strapiStockSyncedAt: v.strapiStockSyncedAt,
          diff: live - raw,
        };
      }),
    });
  } catch (err) {
    console.error("[stock-diff] error:", err);
    return json(
      {
        ok: false,
        code: "ERROR",
        message: err?.message || "Unexpected error",
      },
      500
    );
  }
}
