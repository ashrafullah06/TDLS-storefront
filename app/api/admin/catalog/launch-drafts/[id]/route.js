// FILE: app/api/admin/catalog/launch-drafts/[id]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { strapiWriteRequest } from "@/lib/strapi/strapi-write";
import {
  getFirstGalleryImage,
  getStrapiMediaUrl,
  getMediaArray,
} from "@/lib/strapimedia";

/* ───────────────── helpers ───────────────── */
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

function boolish(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n") return false;
  return null;
}

function computeAvailableFromInventoryItems(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const onHand = Number(item?.onHand ?? 0);
    const safety = Number(item?.safetyStock ?? 0);
    const reserved = Number(item?.reserved ?? 0);
    return sum + (onHand - safety - reserved);
  }, 0);
}

function pickTitle(attrs) {
  return (
    str(attrs?.name) ||
    str(attrs?.title) ||
    str(attrs?.product_name) ||
    str(attrs?.label) ||
    ""
  );
}

function normalizeVariantLabel(v) {
  // Heuristic mapping from real Strapi component keys (no invented values).
  // If none exist, returns "" and caller can fall back to "Variant".
  return (
    str(v?.color) ||
    str(v?.color_name) ||
    str(v?.colour) ||
    str(v?.colour_name) ||
    str(v?.name) ||
    ""
  );
}

function normalizeVariantKey(v) {
  return str(v?.color_key) || str(v?.colorCode) || str(v?.color_code) || "";
}

function normalizeSizeLabel(s) {
  return (
    str(s?.size_name) ||
    str(s?.sizeName) ||
    str(s?.primary_value) ||
    str(s?.secondary_value) ||
    str(s?.name) ||
    ""
  );
}

/**
 * Build Strapi REST populate query for a product (draft or published).
 * We do not "guess" nested component relations; we only populate known media/relations
 * present in your Product schema (schema.json uploaded).
 */
function buildStrapiProductDetailQS({ preview = true } = {}) {
  const params = new URLSearchParams();
  if (preview) params.set("publicationState", "preview");

  // Product media
  params.set("populate[images]", "true");
  params.set("populate[gallery]", "true");

  // Taxonomy relations from schema.json
  params.set("populate[categories]", "true");
  params.set("populate[sub_categories]", "true");
  params.set("populate[super_categories]", "true");
  params.set("populate[audience_categories]", "true");
  params.set("populate[brand_tiers]", "true");
  params.set("populate[tags]", "true");
  params.set("populate[collections]", "true");

  // Embedded component - product_variants:
  // Component values come back with the entity by default; we include populate=true for safety.
  params.set("populate[product_variants]", "true");

  return params.toString();
}

function mapTaxonomyRel(rel) {
  // Strapi returns relation as { data: [{id, attributes}, ...] } or { data: {id, attributes} }
  const data = rel?.data;
  const arr = Array.isArray(data) ? data : data ? [data] : [];
  return arr
    .map((x) => ({
      id: x?.id ?? null,
      name: x?.attributes?.name ?? null,
      slug: x?.attributes?.slug ?? null,
    }))
    .filter((x) => x.id != null);
}

function mapProductNode(node) {
  const id = node?.id ?? null;
  const a = node?.attributes || {};

  const title = pickTitle(a);
  const slug = str(a?.slug) || null;

  const galleryUrls = getMediaArray(a?.gallery);
  const imagesUrls = getMediaArray(a?.images);

  const thumb =
    getFirstGalleryImage(a) ||
    (imagesUrls.length ? imagesUrls[0] : null) ||
    null;

  return {
    id,
    title: title || null,
    slug,
    status: a?.status ?? null, // your schema has status enum
    publication: {
      isDraft: !a?.publishedAt,
      publishedAt: a?.publishedAt || null,
      createdAt: a?.createdAt || null,
      updatedAt: a?.updatedAt || null,
    },
    flags: {
      isFeatured: typeof a?.is_featured === "boolean" ? a.is_featured : null,
      isArchived: typeof a?.is_archived === "boolean" ? a.is_archived : null,
      disableFrontend:
        typeof a?.disable_frontend === "boolean" ? a.disable_frontend : null,
    },
    pricing: {
      selling_price: a?.selling_price ?? null,
      compare_price: a?.compare_price ?? null,
      currency: a?.currency ?? null,
    },
    meta: {
      fit: a?.fit ?? null,
      size_system: a?.size_system ?? null,
      country_of_origin: a?.country_of_origin ?? null,
    },
    codes: {
      uuid: a?.uuid ?? null,
      product_code: a?.product_code ?? null,
      base_sku: a?.base_sku ?? null,
      generated_sku: a?.generated_sku ?? null,
      barcode: a?.barcode ?? null,
      hs_code: a?.hs_code ?? null,
      color_code: a?.color_code ?? null,
    },
    content: {
      short_description: a?.short_description ?? null,
      description: a?.description ?? null,
      care_instructions: a?.care_instructions ?? null,
    },
    taxonomy: {
      categories: mapTaxonomyRel(a?.categories),
      sub_categories: mapTaxonomyRel(a?.sub_categories),
      super_categories: mapTaxonomyRel(a?.super_categories),
      audience_categories: mapTaxonomyRel(a?.audience_categories),
      brand_tiers: mapTaxonomyRel(a?.brand_tiers),
      tags: mapTaxonomyRel(a?.tags),
      collections: mapTaxonomyRel(a?.collections),
    },
    media: {
      thumbnail: thumb ? getStrapiMediaUrl(thumb) : null,
      gallery: galleryUrls.map(getStrapiMediaUrl).filter(Boolean),
      images: imagesUrls.map(getStrapiMediaUrl).filter(Boolean),
    },
    raw: node, // deterministic: contains the real Strapi payload
  };
}

function mapVariantsMatrix(productNode) {
  const a = productNode?.attributes || {};
  const variants = Array.isArray(a?.product_variants) ? a.product_variants : [];

  // Strapi components typically have an "id" property.
  // size_stocks component instances also typically have "id".
  const out = variants.map((v) => {
    const vid = v?.id ?? null;

    const colorLabel = normalizeVariantLabel(v);
    const colorKey = normalizeVariantKey(v);

    const sizeStocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];

    return {
      id: vid,
      // keep normalized fields for UI convenience
      color: colorLabel || null,
      color_key: colorKey || null,

      // preserve common known keys if present (no invention)
      generated_sku: v?.generated_sku ?? v?.generatedSku ?? null,
      barcode: v?.barcode ?? null,

      // raw component payload for exactness
      raw: v,

      size_stocks: sizeStocks.map((s) => ({
        id: s?.id ?? null,
        size_name: s?.size_name ?? s?.sizeName ?? null,
        primary_value: s?.primary_value ?? null,
        secondary_value: s?.secondary_value ?? null,
        is_active: typeof s?.is_active === "boolean" ? s.is_active : null,
        generated_sku: s?.generated_sku ?? s?.generatedSku ?? null,
        barcode: s?.barcode ?? null,
        price: s?.price ?? null,
        compare_at_price: s?.compare_at_price ?? s?.compareAtPrice ?? null,
        raw: s,
        // app join filled later (or null)
        app: null,
      })),
    };
  });

  return out;
}

function collectStrapiSizeIds(variantsMatrix) {
  const ids = [];
  for (const v of Array.isArray(variantsMatrix) ? variantsMatrix : []) {
    for (const s of Array.isArray(v?.size_stocks) ? v.size_stocks : []) {
      const sid = int(s?.id, 0);
      if (sid) ids.push(sid);
    }
  }
  return Array.from(new Set(ids));
}

/* ───────────────── handlers ───────────────── */

export async function GET(req, ctx) {
  try {
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const params = await ctx?.params;
    const id = int(params?.id, 0);
    if (!id) return json({ ok: false, error: "Draft id required" }, 400);

    const u = new URL(req.url);
    const warehouseMode = boolish(u.searchParams.get("warehouse")) === true;

    const qs = buildStrapiProductDetailQS({ preview: true });
    const res = await strapiWriteRequest(`/products/${id}?${qs}`, { method: "GET" });

    const node = res?.data || null;
    if (!node?.id) {
      return json({ ok: false, error: "Strapi returned no product for this id" }, 404);
    }

    const product = mapProductNode(node);
    const variantsMatrix = mapVariantsMatrix(node);

    const strapiSizeIds = collectStrapiSizeIds(variantsMatrix);

    // appDb bridge: Product (by strapiId)
    const appProduct = await prisma.product?.findUnique?.({
      where: { strapiId: Number(id) },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        updatedAt: true,
        archivedAt: true,
        strapiId: true,
      },
    }).catch(() => null);

    // appDb join: ProductVariant by strapiSizeId
    const appByStrapiSizeId = new Map();

    if (strapiSizeIds.length && prisma.productVariant?.findMany) {
      const variants = await prisma.productVariant.findMany({
        where: { strapiSizeId: { in: strapiSizeIds } },
        include: warehouseMode
          ? {
              product: { select: { id: true, title: true, slug: true } },
              inventoryItems: {
                include: { warehouse: { select: { id: true, name: true, code: true } } },
              },
            }
          : {
              product: { select: { id: true, title: true, slug: true } },
            },
        orderBy: { createdAt: "desc" },
      });

      for (const v of variants) {
        const sid = Number(v?.strapiSizeId);
        if (!Number.isFinite(sid)) continue;

        const computed = warehouseMode ? computeAvailableFromInventoryItems(v?.inventoryItems) : null;

        appByStrapiSizeId.set(sid, {
          id: v?.id ?? null,
          productId: v?.productId ?? null,
          sku: v?.sku ?? null,
          barcode: v?.barcode ?? null,
          sizeName: v?.sizeName ?? null,
          colorName: v?.colorName ?? null,
          stockAvailable: typeof v?.stockAvailable === "number" ? v.stockAvailable : null,
          computedAvailable: warehouseMode ? computed : null,
          inventory: warehouseMode
            ? (Array.isArray(v?.inventoryItems) ? v.inventoryItems : []).map((ii) => ({
                id: ii?.id ?? null,
                warehouseId: ii?.warehouseId ?? null,
                warehouseName: ii?.warehouse?.name ?? null,
                warehouseCode: ii?.warehouse?.code ?? null,
                onHand: ii?.onHand ?? null,
                reserved: ii?.reserved ?? null,
                safetyStock: ii?.safetyStock ?? null,
              }))
            : null,
        });
      }
    }

    // Fill joins into matrix + compute summary
    let mappedSizeStocks = 0;
    let totalSizeStocks = 0;
    let totalAvailable = 0;
    let computedTotalAvailable = 0;

    const missingMappings = [];

    for (const v of variantsMatrix) {
      for (const s of Array.isArray(v?.size_stocks) ? v.size_stocks : []) {
        totalSizeStocks += 1;
        const sid = int(s?.id, 0);
        const app = sid ? appByStrapiSizeId.get(sid) : null;
        if (app) {
          s.app = {
            variantId: app.id,
            sku: app.sku,
            barcode: app.barcode,
            stockAvailable: app.stockAvailable,
            computedAvailable: app.computedAvailable,
            inventory: app.inventory,
          };
          mappedSizeStocks += 1;

          if (typeof app.stockAvailable === "number") totalAvailable += app.stockAvailable;
          if (warehouseMode && typeof app.computedAvailable === "number") computedTotalAvailable += app.computedAvailable;
        } else {
          s.app = null;
          if (sid) missingMappings.push(sid);
        }
      }
    }

    const diagnostics = {
      missingVariantMappings: Array.from(new Set(missingMappings)),
      counts: {
        totalSizeStocks,
        mappedSizeStocks,
        unmappedSizeStocks: totalSizeStocks - mappedSizeStocks,
      },
    };

    return json(
      {
        ok: true,
        warehouseMode,
        strapi: {
          id: product?.id ?? null,
          publishedAt: product?.publication?.publishedAt ?? null,
          updatedAt: product?.publication?.updatedAt ?? null,
        },
        product: {
          ...product,
          app: appProduct
            ? {
                hasBridge: true,
                productId: appProduct.id,
                status: appProduct.status ?? null,
                slug: appProduct.slug ?? null,
                title: appProduct.title ?? null,
                updatedAt: appProduct.updatedAt ?? null,
                archivedAt: appProduct.archivedAt ?? null,
              }
            : { hasBridge: false },
          availability: {
            totalSizeStocks,
            mappedSizeStocks,
            unmappedSizeStocks: totalSizeStocks - mappedSizeStocks,
            totalAvailable,
            computedTotalAvailable: warehouseMode ? computedTotalAvailable : null,
          },
        },
        variantsMatrix,
        diagnostics,
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json({ ok: false, error: str(e?.message || e), code: e?.code || null }, status);
  }
}

/**
 * PATCH: update a draft product in Strapi, then refresh appDb bridge fields.
 * Body: { data: {...} } or direct fields.
 */
export async function PATCH(req, ctx) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const params = await ctx?.params;
    const id = int(params?.id, 0);
    if (!id) return json({ ok: false, error: "Draft id required" }, 400);

    const payload = await req.json().catch(() => ({}));
    const inData =
      payload?.data && typeof payload.data === "object" ? payload.data : payload;

    if (!inData || typeof inData !== "object") {
      return json({ ok: false, error: "data is required" }, 400);
    }

    const out = {};
    for (const [k, v] of Object.entries(inData)) {
      if (v === undefined) continue;
      out[k] = v;
    }

    const updated = await strapiWriteRequest(`/products/${id}`, {
      method: "PUT",
      body: { data: out },
      json: true,
    });

    const node = updated?.data || null;
    const a = node?.attributes || {};

    const slug = str(a?.slug);
    if (!slug) {
      return json(
        {
          ok: false,
          error:
            "Strapi update returned no slug. Ensure Product schema returns slug.",
          strapiId: id,
        },
        502
      );
    }

    // Refresh appDb bridge (real fields only; no invention)
    const title = pickTitle(a) || slug;
    const publishedAt = a?.publishedAt || null;
    const strapiUpdatedAt = a?.updatedAt ? new Date(a.updatedAt) : null;

    const priceCurrency = str(a?.currency);
    const app = await prisma.product?.upsert?.({
      where: { strapiId: Number(id) },
      create: {
        title,
        subtitle: a?.short_description ?? null,
        slug,
        description: a?.description ?? null,
        status: publishedAt ? "active" : "draft",
        brand: str(a?.brand) || null,

        fit: a?.fit ?? null,
        sizeSystem: a?.size_system ?? null,

        priceCurrency: priceCurrency || null,
        priceMrp: a?.compare_price ?? null,
        priceSale: a?.selling_price ?? null,
        priceMin: null,
        priceMax: null,

        hasVariants: typeof a?.inventory === "boolean" ? a.inventory : null,
        strapiStockTotal: null,

        productUuid: a?.uuid ?? null,
        productCode: a?.product_code ?? null,
        baseSku: a?.base_sku ?? null,
        productBarcode: a?.barcode ?? null,
        hsCode: a?.hs_code ?? null,

        seoJson: a?.seo ?? null,
        altNamesJson: a?.alt_names_entries ?? null,
        translationsJson: a?.translations ?? null,

        metaTitle: str(a?.meta_title) || null,
        metaDescription: str(a?.meta_description) || null,

        strapiId: Number(id),
        strapiUpdatedAt,
        strapiSlug: slug,
      },
      update: {
        title,
        subtitle: a?.short_description ?? null,
        slug,
        description: a?.description ?? null,
        status: publishedAt ? "active" : "draft",
        brand: str(a?.brand) || null,

        fit: a?.fit ?? null,
        sizeSystem: a?.size_system ?? null,

        priceCurrency: priceCurrency || null,
        priceMrp: a?.compare_price ?? null,
        priceSale: a?.selling_price ?? null,

        productUuid: a?.uuid ?? null,
        productCode: a?.product_code ?? null,
        baseSku: a?.base_sku ?? null,
        productBarcode: a?.barcode ?? null,
        hsCode: a?.hs_code ?? null,

        seoJson: a?.seo ?? null,
        altNamesJson: a?.alt_names_entries ?? null,
        translationsJson: a?.translations ?? null,

        metaTitle: str(a?.meta_title) || null,
        metaDescription: str(a?.meta_description) || null,

        strapiUpdatedAt,
        strapiSlug: slug,
      },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        strapiId: true,
        updatedAt: true,
      },
    });

    return json({ ok: true, strapi: node, app }, 200);
  } catch (e) {
    const status = e?.status || 500;
    return json({ ok: false, error: str(e?.message || e), code: e?.code || null }, status);
  }
}

/**
 * POST actions:
 * - action=publish   => sets publishedAt now
 * - action=unpublish => sets publishedAt null
 *
 * Query: ?action=publish|unpublish
 */
export async function POST(req, ctx) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const params = await ctx?.params;
    const id = int(params?.id, 0);
    if (!id) return json({ ok: false, error: "Draft id required" }, 400);

    const u = new URL(req.url);
    const action = str(u.searchParams.get("action")).toLowerCase();
    if (!action) return json({ ok: false, error: "action is required" }, 400);

    if (action !== "publish" && action !== "unpublish") {
      return json({ ok: false, error: "Unsupported action" }, 400);
    }

    const publishedAt = action === "publish" ? new Date().toISOString() : null;

    const updated = await strapiWriteRequest(`/products/${id}`, {
      method: "PUT",
      body: { data: { publishedAt } },
      json: true,
    });

    const node = updated?.data || null;
    const a = node?.attributes || {};
    const slug = str(a?.slug) || null;

    // Update appDb product status if bridged
    let app = null;
    if (prisma.product?.update && slug) {
      app = await prisma.product
        .update({
          where: { strapiId: Number(id) },
          data: {
            status: publishedAt ? "active" : "draft",
            strapiUpdatedAt: a?.updatedAt ? new Date(a.updatedAt) : null,
            strapiSlug: slug,
          },
          select: { id: true, title: true, slug: true, status: true, strapiId: true, updatedAt: true },
        })
        .catch(() => null);
    }

    return json(
      {
        ok: true,
        action,
        strapi: node,
        app,
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json({ ok: false, error: str(e?.message || e), code: e?.code || null }, status);
  }
}

/**
 * DELETE: delete the draft entry from Strapi.
 * Note: appDb product is NOT deleted by design (safety). Caller can decide.
 */
export async function DELETE(req, ctx) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const params = await ctx?.params;
    const id = int(params?.id, 0);
    if (!id) return json({ ok: false, error: "Draft id required" }, 400);

    const bridged = await prisma.product?.findUnique?.({
      where: { strapiId: Number(id) },
      select: { id: true, strapiId: true, slug: true, status: true },
    }).catch(() => null);

    await strapiWriteRequest(`/products/${id}`, { method: "DELETE" });

    return json(
      {
        ok: true,
        deleted: { strapiId: id },
        bridged: Boolean(bridged),
        app: bridged || null,
        note:
          "App DB product record is not deleted by this endpoint. Use an explicit bridge-delete endpoint if you want that behavior.",
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json({ ok: false, error: str(e?.message || e), code: e?.code || null }, status);
  }
}
