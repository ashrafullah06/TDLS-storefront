// FILE: app/api/admin/catalog/variants/stock/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { appDb } from "@/lib/db";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function str(v) {
  return String(v ?? "").trim();
}

function int(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function boolParam(v) {
  const s = str(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function getStrapiBaseUrl() {
  return (
    process.env.STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    process.env.STRAPI_BASE_URL ||
    process.env.STRAPI_API_URL ||
    ""
  );
}

async function pushStockToStrapi(items) {
  const base = str(getStrapiBaseUrl()).replace(/\/$/, "");
  if (!base) {
    return {
      ok: false,
      error: "STRAPI_BASE_URL_MISSING",
      message:
        "Missing STRAPI_URL (or equivalent). Cannot mirror stock to Strapi without a base URL.",
    };
  }

  // Your Strapi route is defined as:
  // POST /api/tdlc-sync/update-stock
  const url = `${base}/api/tdlc-sync/update-stock`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
    // No caching; always live
    cache: "no-store",
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: "STRAPI_WRITE_FAILED",
      status: res.status,
      response: data,
    };
  }

  return { ok: true, response: data };
}

/**
 * GET: lookup current appDb variant stocks by strapiSizeId(s)
 * Query:
 *   ?ids=123,456,789
 */
export async function GET(req) {
  try {
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const url = new URL(req.url);
    const idsCsv = str(url.searchParams.get("ids"));
    const ids = idsCsv
      .split(",")
      .map((x) => str(x))
      .filter(Boolean);

    if (!ids.length) {
      return json({ ok: false, error: "IDS_REQUIRED", message: "Provide ?ids=comma,separated" }, 400);
    }

    const rows = await appDb.productVariant.findMany({
      where: { strapiSizeId: { in: ids } },
      select: {
        id: true,
        productId: true,
        strapiSizeId: true,
        sku: true,
        barcode: true,
        sizeName: true,
        colorName: true,
        stockAvailable: true,
        archivedAt: true,
      },
    });

    // Return in the same order as requested ids (deterministic UI)
    const by = new Map(rows.map((r) => [str(r.strapiSizeId), r]));
    const items = ids.map((sid) => by.get(sid) || null);

    return json({ ok: true, items, found: rows.length, requested: ids.length });
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status === 401) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    if (status === 403) return json({ ok: false, error: "FORBIDDEN" }, 403);

    console.error("[admin/catalog/variants/stock][GET]", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(err?.message || err || "Unknown error"),
      },
      500
    );
  }
}

/**
 * POST: bulk set stockAvailable by strapiSizeId, then mirror to Strapi size_stocks table
 * Body:
 * {
 *   "items": [{ "strapiSizeId": "123", "stock": 10 }, ...],
 *   "mirrorToStrapi": true
 * }
 */
export async function POST(req) {
  try {
    await requireAdmin(req, { permissions: [Permissions.MANAGE_CATALOG] });

    const body = (await req.json().catch(() => null)) || {};
    const rawItems = Array.isArray(body?.items) ? body.items : [];

    const mirrorToStrapi =
      typeof body?.mirrorToStrapi === "boolean" ? body.mirrorToStrapi : true;

    if (!rawItems.length) {
      return json(
        { ok: false, error: "NO_ITEMS", message: 'Body must contain "items": [{strapiSizeId, stock}]' },
        400
      );
    }

    // Normalize + validate
    const items = [];
    const errors = [];

    for (const it of rawItems) {
      const sid = str(it?.strapiSizeId ?? it?.sizeId);
      const stockRaw = it?.stock ?? it?.stockAvailable ?? it?.stock_quantity;

      if (!sid) {
        errors.push({ item: it ?? null, error: "MISSING_strapiSizeId" });
        continue;
      }

      const n = Number(stockRaw);
      if (!Number.isFinite(n)) {
        errors.push({ strapiSizeId: sid, error: "INVALID_stock" });
        continue;
      }

      items.push({
        strapiSizeId: sid,
        stock: clamp(Math.round(n), 0, 1_000_000),
      });
    }

    if (!items.length) {
      return json({ ok: false, error: "NO_VALID_ITEMS", errors }, 400);
    }

    // Update appDb variants (per-item, because each row has distinct stock)
    const results = await appDb.$transaction(
      items.map((it) =>
        appDb.productVariant.updateMany({
          where: { strapiSizeId: it.strapiSizeId },
          data: { stockAvailable: it.stock },
        })
      )
    );

    const updatedCount = results.reduce((sum, r) => sum + Number(r?.count ?? 0), 0);

    // Mirror to Strapi (bulk)
    let strapiMirror = null;
    if (mirrorToStrapi) {
      const payload = items.map((it) => ({
        sizeId: it.strapiSizeId, // IMPORTANT: your Strapi controller expects `sizeId`
        stock: it.stock,
      }));
      strapiMirror = await pushStockToStrapi(payload);
    }

    return json({
      ok: true,
      updatedCount,
      items,
      errors,
      mirrorToStrapi,
      strapi: strapiMirror,
      meta: {
        strapiBaseUrl: str(getStrapiBaseUrl()) || null,
      },
    });
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status === 401) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    if (status === 403) return json({ ok: false, error: "FORBIDDEN" }, 403);

    console.error("[admin/catalog/variants/stock][POST]", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(err?.message || err || "Unknown error"),
      },
      500
    );
  }
}
