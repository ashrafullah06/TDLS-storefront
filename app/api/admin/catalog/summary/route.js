// FILE: app/api/admin/catalog/summary/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { appDb } from "@/lib/db";
import { api as strapiApi } from "@/lib/strapi";

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

function deriveStatusFromAttrs(attrs) {
  // Prefer explicit enum-like status if present; fallback to publishedAt inference.
  const s = str(attrs?.status);
  if (s) return s;
  return attrs?.publishedAt ? "Active" : "Draft";
}

function hasAnyMedia(attrs) {
  // No guessing: only checks relations if they are populated in the response.
  const images = attrs?.images?.data;
  const gallery = attrs?.gallery?.data;
  const thumb = attrs?.thumbnail?.data;
  const cover = attrs?.cover?.data;

  const hasRel = (x) =>
    Array.isArray(x) ? x.length > 0 : x && typeof x === "object" ? Boolean(x?.id) : false;

  return hasRel(images) || hasRel(gallery) || hasRel(thumb) || hasRel(cover);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req) {
  try {
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const url = new URL(req.url);
    const sp = url.searchParams;

    // Controls
    const includeMedia = boolParam(sp.get("includeMedia")) || boolParam(sp.get("media"));
    const includeStatuses = boolParam(sp.get("includeStatuses")) || true;

    // Safety cap (real data; if truncated we explicitly return flags)
    const maxProducts = clamp(int(sp.get("maxProducts"), 5000), 1, 50_000);
    const pageSize = clamp(int(sp.get("pageSize"), 100), 1, 200);

    // 1) Get totals from Strapi pagination
    const headRes = await strapiApi(
      `/api/products?pagination[page]=1&pagination[pageSize]=1`
    );
    const pg = headRes?.meta?.pagination || {};
    const total = int(pg?.total, 0);
    const totalPages = int(pg?.pageCount, 0);

    // If Strapi returns 0, short-circuit but still provide appDb summary
    if (!total) {
      const appCount = await appDb.product.count({ where: { strapiId: { not: null } } });
      return json({
        ok: true,
        totals: { strapiTotalProducts: 0, strapiScannedProducts: 0, truncated: false },
        bridge: {
          bridgedActive: 0,
          bridgedArchived: 0,
          unbridged: 0,
          appDbProductsWithStrapiId: appCount,
        },
        stock: {
          bridgedInStock: 0,
          bridgedOutOfStock: 0,
          bridgedUnknown: 0,
          totalAvailableAcrossBridged: 0,
        },
        media: includeMedia
          ? { withMedia: 0, missingMedia: 0, scannedForMedia: 0 }
          : { withMedia: null, missingMedia: null, scannedForMedia: null },
        status: includeStatuses
          ? { Active: 0, Draft: 0, Archived: 0, Other: 0 }
          : null,
        meta: { source: "strapi_rest + appDb", strapiBaseUrl: getStrapiBaseUrl() || null },
      });
    }

    // 2) Scan Strapi IDs (and optionally media/status)
    const scanLimit = Math.min(total, maxProducts);
    const pageLimit = Math.ceil(scanLimit / pageSize);

    let scanned = 0;
    const strapiIds = [];
    const statusCounts = { Active: 0, Draft: 0, Archived: 0, Other: 0 };
    let withMedia = 0;
    let missingMedia = 0;
    let mediaScanned = 0;

    for (let page = 1; page <= pageLimit; page++) {
      const qs = new URLSearchParams();
      qs.set("pagination[page]", String(page));
      qs.set("pagination[pageSize]", String(pageSize));

      // We only request what we actually use
      // Note: id is always present in Strapi REST list nodes.
      qs.set("fields[0]", "status");
      qs.set("fields[1]", "publishedAt");

      if (includeMedia) {
        // Minimal populate for presence checks
        qs.set("populate[images][fields][0]", "url");
        qs.set("populate[gallery][fields][0]", "url");
        qs.set("populate[thumbnail][fields][0]", "url");
        qs.set("populate[cover][fields][0]", "url");
      }

      const res = await strapiApi(`/api/products?${qs.toString()}`);
      const rows = Array.isArray(res?.data) ? res.data : [];

      if (!rows.length) break;

      for (const n of rows) {
        if (scanned >= scanLimit) break;

        const sid = Number(n?.id);
        if (Number.isFinite(sid) && sid > 0) strapiIds.push(sid);

        const attrs = n?.attributes || {};
        if (includeStatuses) {
          const s = deriveStatusFromAttrs(attrs);
          if (s === "Active") statusCounts.Active += 1;
          else if (s === "Draft") statusCounts.Draft += 1;
          else if (s === "Archived") statusCounts.Archived += 1;
          else statusCounts.Other += 1;
        }

        if (includeMedia) {
          mediaScanned += 1;
          if (hasAnyMedia(attrs)) withMedia += 1;
          else missingMedia += 1;
        }

        scanned += 1;
      }
    }

    const truncated = scanned < total && scanned === scanLimit;

    // 3) Bridge counts from appDb (exact for scanned set)
    const bridgedActiveSet = new Set();
    const bridgedArchivedSet = new Set();
    const scannedIdChunks = chunk(strapiIds, 1000);

    for (const idsChunk of scannedIdChunks) {
      const rows = await appDb.product.findMany({
        where: { strapiId: { in: idsChunk } },
        select: { id: true, strapiId: true, archivedAt: true },
      });

      for (const r of rows) {
        const sid = Number(r?.strapiId);
        if (!Number.isFinite(sid)) continue;

        if (r?.archivedAt) bridgedArchivedSet.add(sid);
        else bridgedActiveSet.add(sid);
      }
    }

    // Ensure no double-counting if any edge-case overlaps
    for (const sid of bridgedArchivedSet) bridgedActiveSet.delete(sid);

    const bridgedActive = bridgedActiveSet.size;
    const bridgedArchived = bridgedArchivedSet.size;
    const unbridged = Math.max(0, scanned - bridgedActive - bridgedArchived);

    // 4) Stock summary (bridged products only)
    // We compute:
    // - bridgedInStock: active bridged products whose summed ProductVariant.stockAvailable > 0
    // - bridgedOutOfStock: active bridged products whose sum <= 0
    // - bridgedUnknown: active bridged products where variants cannot be read (should be 0 normally)
    let bridgedInStock = 0;
    let bridgedOutOfStock = 0;
    let bridgedUnknown = 0;
    let totalAvailableAcrossBridged = 0;

    if (bridgedActive > 0) {
      // Map strapiId -> app productId
      const activeStrapiIds = Array.from(bridgedActiveSet);
      const productIdByStrapiId = new Map();

      for (const idsChunk of chunk(activeStrapiIds, 1000)) {
        const prows = await appDb.product.findMany({
          where: { strapiId: { in: idsChunk }, archivedAt: null },
          select: { id: true, strapiId: true },
        });
        for (const p of prows) {
          productIdByStrapiId.set(Number(p.strapiId), p.id);
        }
      }

      const activeProductIds = Array.from(new Set(productIdByStrapiId.values()));
      const sumsByProductId = new Map();

      // Prefer groupBy; fallback to JS reduce if needed.
      try {
        for (const pidChunk of chunk(activeProductIds, 1000)) {
          const grouped = await appDb.productVariant.groupBy({
            by: ["productId"],
            where: { productId: { in: pidChunk }, archivedAt: null },
            _sum: { stockAvailable: true },
          });
          for (const g of grouped) {
            const pid = g?.productId;
            const sum = Number(g?._sum?.stockAvailable ?? 0);
            sumsByProductId.set(pid, sum);
          }
        }
      } catch {
        for (const pidChunk of chunk(activeProductIds, 500)) {
          const vars = await appDb.productVariant.findMany({
            where: { productId: { in: pidChunk }, archivedAt: null },
            select: { productId: true, stockAvailable: true },
          });
          for (const v of vars) {
            const pid = v.productId;
            const sum = sumsByProductId.get(pid) ?? 0;
            sumsByProductId.set(pid, sum + Number(v.stockAvailable ?? 0));
          }
        }
      }

      // Count in/out based on sums; products with zero variants => treated as out-of-stock (sum 0).
      for (const sid of activeStrapiIds) {
        const pid = productIdByStrapiId.get(sid);
        if (!pid) {
          // This should not happen if bridgedActiveSet is correct, but keep deterministic.
          bridgedUnknown += 1;
          continue;
        }
        const sum = Number(sumsByProductId.get(pid) ?? 0);
        totalAvailableAcrossBridged += sum;
        if (sum > 0) bridgedInStock += 1;
        else bridgedOutOfStock += 1;
      }
    }

    // Extra useful metric: total appDb products that have a strapiId (can reveal orphan bridges)
    const appDbProductsWithStrapiId = await appDb.product.count({
      where: { strapiId: { not: null } },
    });

    return json({
      ok: true,
      totals: {
        strapiTotalProducts: total,
        strapiScannedProducts: scanned,
        truncated,
        maxProducts,
        pageSize,
        totalPagesReportedByStrapi: totalPages,
      },
      bridge: {
        bridgedActive,
        bridgedArchived,
        unbridged,
        appDbProductsWithStrapiId,
      },
      stock: {
        bridgedInStock,
        bridgedOutOfStock,
        bridgedUnknown,
        totalAvailableAcrossBridged,
      },
      media: includeMedia
        ? {
            withMedia,
            missingMedia,
            scannedForMedia: mediaScanned,
          }
        : { withMedia: null, missingMedia: null, scannedForMedia: null },
      status: includeStatuses ? statusCounts : null,
      meta: {
        source: "strapi_rest + appDb",
        strapiBaseUrl: str(getStrapiBaseUrl()) || null,
      },
    });
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status === 401) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    if (status === 403) return json({ ok: false, error: "FORBIDDEN" }, 403);

    console.error("[admin/catalog/summary][GET]", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(err?.message || err || "Unknown error"),
        detail:
          process.env.NODE_ENV === "production"
            ? undefined
            : { name: err?.name || null, stack: err?.stack || null },
      },
      500
    );
  }
}
