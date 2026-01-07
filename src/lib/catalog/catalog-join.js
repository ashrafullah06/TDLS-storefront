// FILE: src/lib/catalog/catalog-join.js

import { appDb } from "@/lib/db";

/**
 * Catalog Join Helpers
 * - Strictly appDb-based (Prisma)
 * - Provides deterministic joins:
 *    Product:   appDb.Product.strapiId  <-> Strapi Product id (number)
 *    Variant:   appDb.ProductVariant.strapiSizeId <-> Strapi size_stock.id (string/number)
 * - Bulk availability hydration for list pages
 *
 * No placeholders / no inferred values.
 */

function str(v) {
  return String(v ?? "").trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Fetch appDb products by Strapi ids.
 * Returns a map: strapiId (number) -> app product row (minimal)
 */
export async function fetchAppProductsByStrapiIds(strapiIds) {
  const ids = uniq((Array.isArray(strapiIds) ? strapiIds : [])
    .map(num)
    .filter((x) => x != null && x > 0));

  if (!ids.length) return new Map();

  const rows = await appDb.product.findMany({
    where: { strapiId: { in: ids } },
    select: {
      id: true,
      strapiId: true,
      archivedAt: true,
      updatedAt: true,
    },
  });

  const map = new Map();
  for (const r of rows) {
    const sid = num(r?.strapiId);
    if (sid != null) map.set(sid, r);
  }
  return map;
}

/**
 * Fetch appDb variants by Strapi size stock ids (strapiSizeId).
 * Returns a map: strapiSizeId (string) -> app variant row (minimal)
 */
export async function fetchAppVariantsByStrapiSizeIds(strapiSizeIds, opts = {}) {
  const includeInventory = Boolean(opts?.includeInventory);
  const ids = uniq((Array.isArray(strapiSizeIds) ? strapiSizeIds : [])
    .map((x) => str(x))
    .filter(Boolean));

  if (!ids.length) return new Map();

  const rows = await appDb.productVariant.findMany({
    where: { strapiSizeId: { in: ids } },
    select: includeInventory
      ? {
          id: true,
          productId: true,
          strapiSizeId: true,
          sku: true,
          barcode: true,
          sizeName: true,
          colorName: true,
          stockAvailable: true,
          archivedAt: true,
          updatedAt: true,
          inventoryItems: {
            select: {
              id: true,
              warehouseId: true,
              onHand: true,
              reserved: true,
              safetyStock: true,
              warehouse: {
                select: { id: true, name: true, code: true },
              },
            },
          },
        }
      : {
          id: true,
          productId: true,
          strapiSizeId: true,
          sku: true,
          barcode: true,
          sizeName: true,
          colorName: true,
          stockAvailable: true,
          archivedAt: true,
          updatedAt: true,
        },
  });

  const map = new Map();
  for (const r of rows) {
    const key = str(r?.strapiSizeId);
    if (key) map.set(key, r);
  }
  return map;
}

/**
 * Compute product-level availability summary from a list of app variants.
 * - Uses only `stockAvailable` (appDb authoritative)
 * - Low-stock threshold is configurable (default 3)
 */
export function computeAvailabilitySummaryFromVariants(variants, lowThreshold = 3) {
  const th = clamp(Number(lowThreshold) || 3, 1, 999);

  const live = (Array.isArray(variants) ? variants : []).filter((v) => !v?.archivedAt);

  let totalAvailable = 0;
  let inStockVariants = 0;
  let outOfStockVariants = 0;
  let lowStockVariants = 0;

  for (const v of live) {
    const a = Number(v?.stockAvailable ?? 0);
    totalAvailable += a;

    if (a > 0) inStockVariants += 1;
    else outOfStockVariants += 1;

    if (a > 0 && a <= th) lowStockVariants += 1;
  }

  return {
    totalAvailable,
    inStockVariants,
    outOfStockVariants,
    lowStockVariants,
    variantsTotal: live.length,
    lowThreshold: th,
  };
}

/**
 * Hydrate availability for a list page:
 * - Input: array of Strapi product ids (numbers)
 * - Output:
 *    {
 *      byStrapiId: Map<number, { appProduct, availability }>
 *    }
 *
 * This is intentionally minimal and fast.
 */
export async function hydrateListAvailabilityByStrapiIds(strapiIds, opts = {}) {
  const lowThreshold = clamp(Number(opts?.lowThreshold) || 3, 1, 999);

  const ids = uniq((Array.isArray(strapiIds) ? strapiIds : [])
    .map(num)
    .filter((x) => x != null && x > 0));

  if (!ids.length) return { byStrapiId: new Map() };

  // Pull product + variants in one query
  const rows = await appDb.product.findMany({
    where: { strapiId: { in: ids } },
    select: {
      id: true,
      strapiId: true,
      archivedAt: true,
      updatedAt: true,
      variants: {
        select: {
          archivedAt: true,
          stockAvailable: true,
        },
      },
    },
  });

  const byStrapiId = new Map();
  for (const p of rows) {
    const sid = num(p?.strapiId);
    if (sid == null) continue;

    const availability = computeAvailabilitySummaryFromVariants(p?.variants, lowThreshold);

    byStrapiId.set(sid, {
      appProduct: {
        id: p.id,
        strapiId: sid,
        archivedAt: p.archivedAt ? new Date(p.archivedAt).toISOString() : null,
        updatedAt: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
      },
      availability,
    });
  }

  return { byStrapiId };
}

/**
 * Given a mapped Strapi product (with variants.size_stocks),
 * extract unique Strapi size stock ids to join with app variants.
 */
export function extractSizeStockIdsFromCatalogDTO(catalogProductDto) {
  const out = [];
  const variants = Array.isArray(catalogProductDto?.variants) ? catalogProductDto.variants : [];
  for (const v of variants) {
    const ss = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    for (const s of ss) {
      if (s?.id != null) out.push(str(s.id));
    }
  }
  return uniq(out.filter(Boolean));
}

/**
 * Merge app variant info into a catalogProductDto variants matrix.
 * - Does not fabricate missing app rows. Missing joins become app: null for that size row.
 */
export function mergeAppVariantsIntoVariantMatrix(catalogProductDto, appVariantsByStrapiSizeId, opts = {}) {
  const warehouseMode = Boolean(opts?.warehouseMode);

  const bySizeId =
    appVariantsByStrapiSizeId instanceof Map
      ? appVariantsByStrapiSizeId
      : new Map();

  const variants = Array.isArray(catalogProductDto?.variants) ? catalogProductDto.variants : [];

  const mergedVariants = variants.map((v) => {
    const sizeStocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    const mergedSizeStocks = sizeStocks.map((s) => {
      const key = s?.id != null ? str(s.id) : "";
      const av = key ? bySizeId.get(key) : null;

      return {
        ...s,
        app: av
          ? {
              variantId: av.id,
              productId: av.productId ?? null,
              strapiSizeId: av.strapiSizeId ?? null,
              sku: av.sku ?? null,
              barcode: av.barcode ?? null,
              sizeName: av.sizeName ?? null,
              colorName: av.colorName ?? null,
              stockAvailable: av.stockAvailable ?? null,
              archivedAt: av.archivedAt ? new Date(av.archivedAt).toISOString() : null,
              updatedAt: av.updatedAt ? new Date(av.updatedAt).toISOString() : null,
              inventory: warehouseMode
                ? (Array.isArray(av.inventoryItems) ? av.inventoryItems : []).map((ii) => ({
                    id: ii.id,
                    warehouseId: ii.warehouseId,
                    warehouseName: ii.warehouse?.name ?? null,
                    warehouseCode: ii.warehouse?.code ?? null,
                    onHand: ii.onHand ?? null,
                    reserved: ii.reserved ?? null,
                    safetyStock: ii.safetyStock ?? null,
                  }))
                : null,
            }
          : null,
      };
    });

    return { ...v, size_stocks: mergedSizeStocks };
  });

  return {
    ...catalogProductDto,
    variants: mergedVariants,
  };
}
