// FILE: app/api/admin/catalog/products/[id]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { appDb } from "@/lib/db";
import { api as strapiApi } from "@/lib/strapi";
import { getStrapiMediaUrl, pickBestImageUrl } from "@/lib/strapimedia";

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

function toAbsMediaUrl(urlLike) {
  const u = str(urlLike);
  if (!u) return null;

  // If already absolute, keep it.
  if (/^https?:\/\//i.test(u)) return u;

  // Prefer base URL from env if present (UI + API consistent).
  const base = str(getStrapiBaseUrl());
  if (base) return base.replace(/\/$/, "") + (u.startsWith("/") ? u : `/${u}`);

  // Fallback to your helper (handles common Strapi media shapes).
  try {
    return getStrapiMediaUrl(u);
  } catch {
    return null;
  }
}

function computeAvailableFromInventoryItems(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const onHand = Number(item?.onHand ?? 0);
    const safety = Number(item?.safetyStock ?? 0);
    const reserved = Number(item?.reserved ?? 0);
    return sum + (onHand - safety - reserved);
  }, 0);
}

function normalizeMediaNode(n) {
  // n is Strapi REST node: { id, attributes }
  const id = n?.id ?? null;
  const a = n?.attributes || {};

  // pickBestImageUrl returns a "url" string (often relative in Strapi)
  const relOrAbs = pickBestImageUrl(a) || a.url || null;
  const abs = toAbsMediaUrl(relOrAbs);

  // formats: absolute URLs per format when present (only if provided)
  const formats = a.formats && typeof a.formats === "object" ? a.formats : null;
  const formatsAbs = formats
    ? Object.fromEntries(
        Object.entries(formats).map(([k, fv]) => [
          k,
          fv?.url ? toAbsMediaUrl(fv.url) : null,
        ])
      )
    : null;

  return {
    id,
    name: a.name ?? null,
    alternativeText: a.alternativeText ?? null,
    caption: a.caption ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
    mime: a.mime ?? null,
    size: a.size ?? null,
    url: abs,
    formats: formatsAbs,
  };
}

function normalizeMediaRelation(rel) {
  if (!rel?.data) return [];
  const arr = Array.isArray(rel.data) ? rel.data : [rel.data];
  return arr.map(normalizeMediaNode).filter((x) => x?.url);
}

function normalizeRelationNames(rel) {
  // For relations like categories/sub_categories/etc.
  // Return { id, name, slug } when present; never fabricate.
  if (!rel?.data) return [];
  const arr = Array.isArray(rel.data) ? rel.data : [rel.data];
  return arr
    .map((n) => {
      const id = n?.id ?? null;
      const a = n?.attributes || {};
      return {
        id,
        name: a.name ?? null,
        slug: a.slug ?? null,
      };
    })
    .filter((x) => x?.id != null);
}

function normalizeProductVariants(attrs) {
  // product_variants is a repeatable component in your schema.json.
  const pv = attrs?.product_variants;
  const variants = Array.isArray(pv) ? pv : [];
  return variants.map((v) => {
    const sizeStocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    return {
      id: v?.id ?? null,
      color: v?.color ?? null,
      color_key: v?.color_key ?? null,
      generated_sku: v?.generated_sku ?? null,
      barcode: v?.barcode ?? null,
      size_system: v?.size_system ?? null,
      size_stocks: sizeStocks.map((s) => ({
        id: s?.id ?? null,
        size_name: s?.size_name ?? null,
        size_system: s?.size_system ?? null,
        primary_value: s?.primary_value ?? null,
        secondary_value: s?.secondary_value ?? null,
        generated_sku: s?.generated_sku ?? null,
        barcode: s?.barcode ?? null,
        stock_quantity: s?.stock_quantity ?? null,
        price: s?.price ?? null,
        compare_at_price: s?.compare_at_price ?? null,
        price_override: s?.price_override ?? null,
        is_active: typeof s?.is_active === "boolean" ? s.is_active : null,
      })),
    };
  });
}

export async function GET(req, ctx) {
  try {
    // RBAC: allow either MANAGE_CATALOG or VIEW_ANALYTICS
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const params = await Promise.resolve(ctx?.params);
    const idRaw = params?.id;
    const strapiId = Number(String(idRaw ?? "").trim());
    if (!Number.isFinite(strapiId) || strapiId <= 0) {
      return json({ ok: false, error: "Product id required" }, 400);
    }

    const url = new URL(req.url);
    const warehouseMode =
      boolParam(url.searchParams.get("warehouse")) ||
      boolParam(url.searchParams.get("warehouseMode")) ||
      boolParam(url.searchParams.get("includeWarehouses"));

    // Strapi detail: populate only fields that exist in your Product schema.json
    const qs = [
      "populate[images]=*",
      "populate[gallery]=*",
      "populate[categories]=*",
      "populate[sub_categories]=*",
      "populate[super_categories]=*",
      "populate[audience_categories]=*",
      "populate[age_groups]=*",
      "populate[gender_groups]=*",
      "populate[brand_tiers]=*",
      "populate[events_products_collections]=*",
      "populate[factory]=*",
    ].join("&");

    const res = await strapiApi(`/api/products/${strapiId}?${qs}`);
    const node = res?.data || null;
    if (!node?.id) {
      return json({ ok: false, error: "NOT_FOUND" }, 404);
    }

    const a = node.attributes || {};

    // Media
    const images = normalizeMediaRelation(a.images);
    const gallery = normalizeMediaRelation(a.gallery);

    // Thumbnail: first available in order: images[0] → gallery[0]
    const thumbnail = images[0]?.url || gallery[0]?.url || null;

    // Variants from Strapi (component)
    const strapiVariants = normalizeProductVariants(a);

    // Collect size_stock component ids to join against appDb ProductVariant.strapiSizeId
    const sizeStockIds = [];
    for (const v of strapiVariants) {
      for (const s of v.size_stocks) {
        if (s?.id != null) sizeStockIds.push(String(s.id));
      }
    }
    const uniqSizeStockIds = Array.from(new Set(sizeStockIds));

    // Load appDb product bridge
    const appProduct = await appDb.product.findFirst({
      where: { strapiId: strapiId },
      select: {
        id: true,
        strapiId: true,
        archivedAt: true,
      },
    });

    // Load per-sizeStock availability from appDb
    const appVariants = uniqSizeStockIds.length
      ? await appDb.productVariant.findMany({
          where: { strapiSizeId: { in: uniqSizeStockIds } },
          select: warehouseMode
            ? {
                id: true,
                productId: true,
                sku: true,
                barcode: true,
                sizeName: true,
                colorName: true,
                strapiSizeId: true,
                stockAvailable: true,
                archivedAt: true,
                inventoryItems: {
                  select: {
                    id: true,
                    warehouseId: true,
                    onHand: true,
                    reserved: true,
                    safetyStock: true,
                    warehouse: { select: { id: true, name: true, code: true } },
                  },
                },
              }
            : {
                id: true,
                productId: true,
                sku: true,
                barcode: true,
                sizeName: true,
                colorName: true,
                strapiSizeId: true,
                stockAvailable: true,
                archivedAt: true,
              },
        })
      : [];

    const byStrapiSizeId = new Map();
    for (const v of appVariants) {
      const key = str(v?.strapiSizeId);
      if (key) byStrapiSizeId.set(key, v);
    }

    // Build matrix with app availability merged onto Strapi size_stocks
    const variantsMatrix = strapiVariants.map((v) => {
      const sizeStocks = v.size_stocks.map((s) => {
        const key = str(s?.id);
        const av = key ? byStrapiSizeId.get(key) : null;

        const computedAvailable = warehouseMode
          ? computeAvailableFromInventoryItems(av?.inventoryItems || [])
          : null;

        return {
          ...s,
          app: av
            ? {
                variantId: av.id,
                productId: av.productId ?? null,
                sku: av.sku ?? null,
                barcode: av.barcode ?? null,
                sizeName: av.sizeName ?? null,
                colorName: av.colorName ?? null,
                strapiSizeId: av.strapiSizeId ?? null,
                stockAvailable: av.stockAvailable ?? null,
                computedAvailable,
                archivedAt: av.archivedAt
                  ? new Date(av.archivedAt).toISOString()
                  : null,
                inventory: warehouseMode
                  ? (av.inventoryItems || []).map((ii) => ({
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
            : {
                variantId: null,
                productId: null,
                sku: null,
                barcode: null,
                sizeName: null,
                colorName: null,
                strapiSizeId: key || null,
                stockAvailable: null,
                computedAvailable: null,
                archivedAt: null,
                inventory: null,
              },
        };
      });

      return { ...v, size_stocks: sizeStocks };
    });

    // Product-level availability summary
    let totalAvailable = 0;
    let totalComputed = 0;
    let mappedSizeStocks = 0;

    for (const sId of uniqSizeStockIds) {
      const av = byStrapiSizeId.get(sId);
      if (!av) continue;
      mappedSizeStocks += 1;
      totalAvailable += Number(av.stockAvailable ?? 0);
      if (warehouseMode) {
        totalComputed += computeAvailableFromInventoryItems(av.inventoryItems || []);
      }
    }

    const product = {
      // canonical identifiers
      id: Number(node.id),
      strapiId: Number(node.id),

      title: a.name ?? null,
      slug: a.slug ?? null,
      status: a.status ?? null,
      fit: a.fit ?? null,
      size_system: a.size_system ?? null,

      description: a.description ?? null,
      short_description: a.short_description ?? null,
      care_instructions: a.care_instructions ?? null,
      country_of_origin: a.country_of_origin ?? null,

      pricing: {
        selling_price: a.selling_price ?? null,
        compare_price: a.compare_price ?? null,
        currency: a.currency ?? null,
      },

      timestamps: {
        createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : null,
        updatedAt: a.updatedAt ? new Date(a.updatedAt).toISOString() : null,
        publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : null,
      },

      media: {
        thumbnail,
        images,
        gallery,
      },

      taxonomy: {
        categories: normalizeRelationNames(a.categories),
        sub_categories: normalizeRelationNames(a.sub_categories),
        super_categories: normalizeRelationNames(a.super_categories),
        audience_categories: normalizeRelationNames(a.audience_categories),
        age_groups: normalizeRelationNames(a.age_groups),
        gender_groups: normalizeRelationNames(a.gender_groups),
        brand_tiers: normalizeRelationNames(a.brand_tiers),
      },

      collections: {
        events_products_collections: normalizeRelationNames(a.events_products_collections),
      },

      app: {
        productId: appProduct?.id ?? null,
        hasBridge: Boolean(appProduct),
        archivedAt: appProduct?.archivedAt
          ? new Date(appProduct.archivedAt).toISOString()
          : null,
      },

      availability: {
        mappedSizeStocks,
        totalSizeStocks: uniqSizeStockIds.length,
        totalAvailable,
        computedTotalAvailable: warehouseMode ? totalComputed : null,
      },
    };

    return json({
      ok: true,
      product,
      variantsMatrix,
      meta: {
        warehouseMode,
        strapiBaseUrl: str(getStrapiBaseUrl()) || null,
        source: "strapi_detail + appDb_join",
      },
      source: "strapi_detail + appDb_join",
    });
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status === 401) return json({ ok: false, error: "Unauthorized" }, 401);
    if (status === 403) return json({ ok: false, error: "Forbidden" }, 403);

    console.error("[catalog/products/:id][GET]", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        detail:
          process.env.NODE_ENV === "production"
            ? undefined
            : String(err?.message || err),
      },
      500
    );
  }
}
