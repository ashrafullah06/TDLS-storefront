// FILE: app/api/admin/catalog/launch-drafts/[id]/push/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { strapiWriteRequest } from "@/lib/strapi/strapi-write";
import { getMediaArray, getFirstGalleryImage, getStrapiMediaUrl } from "@/lib/strapimedia";

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
function bool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n") return false;
  return null;
}
function pickTitle(attrs) {
  return str(attrs?.name) || str(attrs?.title) || str(attrs?.product_name) || str(attrs?.label) || "";
}
function normalizeColorLabel(v) {
  return (
    str(v?.color) ||
    str(v?.color_name) ||
    str(v?.colour) ||
    str(v?.colour_name) ||
    str(v?.name) ||
    ""
  );
}
function normalizeColorKey(v) {
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
function firstNumber(...vals) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function buildDetailQS() {
  const p = new URLSearchParams();
  // preview: we are pushing from drafts
  p.set("publicationState", "preview");

  // media
  p.set("populate[images]", "true");
  p.set("populate[gallery]", "true");

  // taxonomy (schema-driven)
  p.set("populate[categories]", "true");
  p.set("populate[sub_categories]", "true");
  p.set("populate[super_categories]", "true");
  p.set("populate[audience_categories]", "true");
  p.set("populate[brand_tiers]", "true");
  p.set("populate[tags]", "true");
  p.set("populate[collections]", "true");

  // component
  p.set("populate[product_variants]", "true");

  return p.toString();
}

function mapProductToAppFields(strapiNode) {
  const a = strapiNode?.attributes || {};
  const title = pickTitle(a);
  const slug = str(a?.slug);

  const gallery = getMediaArray(a?.gallery);
  const images = getMediaArray(a?.images);
  const thumb = getFirstGalleryImage(a) || (images.length ? images[0] : null) || null;

  return {
    title: title || slug || null,
    subtitle: str(a?.short_description) || null,
    slug: slug || null,
    description: a?.description ?? null,

    // status: align to your app enum used elsewhere
    status: a?.publishedAt ? "active" : "draft",

    brand: str(a?.brand) || null,
    fit: str(a?.fit) || null,
    sizeSystem: str(a?.size_system) || null,

    priceCurrency: str(a?.currency) || null,
    priceMrp: a?.compare_price ?? null,
    priceSale: a?.selling_price ?? null,

    // optional min/max if present
    priceMin: a?.price_range?.min ?? a?.price_min ?? null,
    priceMax: a?.price_range?.max ?? a?.price_max ?? null,

    hasVariants: typeof a?.has_variants === "boolean" ? a.has_variants : null,
    strapiStockTotal: typeof a?.stock_total === "number" ? a.stock_total : null,

    productUuid: str(a?.uuid) || null,
    productCode: str(a?.product_code) || null,
    baseSku: str(a?.base_sku) || null,
    productBarcode: str(a?.barcode) || null,
    hsCode: str(a?.hs_code) || null,

    seoJson: a?.seo ?? null,
    altNamesJson: a?.alt_names_entries ?? null,
    translationsJson: a?.translations ?? null,

    metaTitle: str(a?.meta_title) || null,
    metaDescription: str(a?.meta_description) || null,

    strapiUpdatedAt: a?.updatedAt ? new Date(a.updatedAt) : null,
    strapiSlug: slug || null,

    media: {
      thumbnail: thumb ? getStrapiMediaUrl(thumb) : null,
      gallery: gallery.map(getStrapiMediaUrl).filter(Boolean),
      images: images.map(getStrapiMediaUrl).filter(Boolean),
    },
  };
}

function mapVariantsFromStrapi(strapiNode) {
  const a = strapiNode?.attributes || {};
  const variants = Array.isArray(a?.product_variants) ? a.product_variants : [];

  const out = [];
  for (const v of variants) {
    const colorName = normalizeColorLabel(v) || null;
    const colorKey = normalizeColorKey(v) || null;

    const sizeStocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    for (const s of sizeStocks) {
      const strapiSizeId = int(s?.id, 0);
      const sizeName = normalizeSizeLabel(s) || null;

      // We only set stockAvailable if Strapi provides a numeric field.
      // Otherwise we omit it and let appDb defaults/rules apply (no guessing).
      const stockAvailable = firstNumber(
        s?.stockAvailable,
        s?.stock_available,
        s?.stock,
        s?.qty,
        s?.quantity,
        s?.available,
        s?.stock_total
      );

      out.push({
        strapiSizeId: strapiSizeId || null,
        sku: str(s?.generated_sku ?? s?.generatedSku ?? "") || null,
        barcode: str(s?.barcode ?? "") || null,
        sizeName,
        colorName,
        colorKey,
        isActive: typeof s?.is_active === "boolean" ? s.is_active : null,
        price: s?.price ?? null,
        compareAtPrice: s?.compare_at_price ?? s?.compareAtPrice ?? null,
        stockAvailable: typeof stockAvailable === "number" && Number.isFinite(stockAvailable) ? stockAvailable : null,
        raw: s,
      });
    }
  }

  return out;
}

/* ───────────────── handler ───────────────── */

export async function POST(req, ctx) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const params = await ctx?.params;
    const id = int(params?.id, 0);
    if (!id) return json({ ok: false, error: "Draft id required" }, 400);

    const u = new URL(req.url);
    const dryRun = bool(u.searchParams.get("dryRun")) === true;

    const qs = buildDetailQS();
    const res = await strapiWriteRequest(`/products/${id}?${qs}`, { method: "GET" });

    const node = res?.data || null;
    if (!node?.id) return json({ ok: false, error: "Draft not found" }, 404);

    const a = node?.attributes || {};
    const slug = str(a?.slug);
    if (!slug) {
      return json(
        {
          ok: false,
          error:
            "Strapi draft has no slug. Ensure slug exists before pushing into appDb (routing depends on it).",
          strapiId: id,
        },
        400
      );
    }

    const productFields = mapProductToAppFields(node);
    const variantRows = mapVariantsFromStrapi(node);

    const missingSizeIds = variantRows.filter((r) => !r.strapiSizeId).length;
    const uniqueSizeIds = Array.from(new Set(variantRows.map((r) => r.strapiSizeId).filter(Boolean)));

    const plan = {
      upsertProduct: {
        where: { strapiId: Number(id) },
        data: {
          title: productFields.title,
          slug: productFields.slug,
          status: productFields.status,
          // other fields are included below in actual write
        },
      },
      variants: {
        totalRows: variantRows.length,
        uniqueStrapiSizeIds: uniqueSizeIds.length,
        missingStrapiSizeIdRows: missingSizeIds,
      },
      media: productFields.media,
    };

    if (dryRun) {
      return json(
        {
          ok: true,
          dryRun: true,
          strapiId: id,
          strapi: {
            slug,
            publishedAt: a?.publishedAt || null,
            updatedAt: a?.updatedAt || null,
          },
          plan,
          note:
            "Dry-run only. No appDb writes were performed.",
        },
        200
      );
    }

    // Upsert Product bridge
    const appProduct = await prisma.product.upsert({
      where: { strapiId: Number(id) },
      create: {
        title: productFields.title || slug,
        subtitle: productFields.subtitle,
        slug,
        description: productFields.description,
        status: productFields.status,
        brand: productFields.brand,

        fit: productFields.fit,
        sizeSystem: productFields.sizeSystem,

        priceCurrency: productFields.priceCurrency,
        priceMrp: productFields.priceMrp,
        priceSale: productFields.priceSale,
        priceMin: productFields.priceMin,
        priceMax: productFields.priceMax,

        hasVariants: productFields.hasVariants,
        strapiStockTotal: productFields.strapiStockTotal,

        productUuid: productFields.productUuid,
        productCode: productFields.productCode,
        baseSku: productFields.baseSku,
        productBarcode: productFields.productBarcode,
        hsCode: productFields.hsCode,

        seoJson: productFields.seoJson,
        altNamesJson: productFields.altNamesJson,
        translationsJson: productFields.translationsJson,

        metaTitle: productFields.metaTitle,
        metaDescription: productFields.metaDescription,

        strapiId: Number(id),
        strapiUpdatedAt: productFields.strapiUpdatedAt,
        strapiSlug: productFields.strapiSlug,
      },
      update: {
        title: productFields.title || slug,
        subtitle: productFields.subtitle,
        slug,
        description: productFields.description,
        status: productFields.status,
        brand: productFields.brand,

        fit: productFields.fit,
        sizeSystem: productFields.sizeSystem,

        priceCurrency: productFields.priceCurrency,
        priceMrp: productFields.priceMrp,
        priceSale: productFields.priceSale,
        priceMin: productFields.priceMin,
        priceMax: productFields.priceMax,

        hasVariants: productFields.hasVariants,
        strapiStockTotal: productFields.strapiStockTotal,

        productUuid: productFields.productUuid,
        productCode: productFields.productCode,
        baseSku: productFields.baseSku,
        productBarcode: productFields.productBarcode,
        hsCode: productFields.hsCode,

        seoJson: productFields.seoJson,
        altNamesJson: productFields.altNamesJson,
        translationsJson: productFields.translationsJson,

        metaTitle: productFields.metaTitle,
        metaDescription: productFields.metaDescription,

        strapiUpdatedAt: productFields.strapiUpdatedAt,
        strapiSlug: productFields.strapiSlug,
      },
      select: { id: true, title: true, slug: true, status: true, strapiId: true, updatedAt: true },
    });

    // Upsert ProductVariants by strapiSizeId
    let created = 0;
    let updated = 0;
    let skippedNoStrapiSizeId = 0;
    let setStockFromStrapi = 0;

    for (const row of variantRows) {
      if (!row.strapiSizeId) {
        skippedNoStrapiSizeId += 1;
        continue;
      }

      // Check existence first to return accurate created/updated counts
      const existing = await prisma.productVariant.findUnique({
        where: { strapiSizeId: Number(row.strapiSizeId) },
        select: { id: true, strapiSizeId: true },
      });

      const dataBase = {
        productId: appProduct.id,
        sku: row.sku,
        barcode: row.barcode,
        sizeName: row.sizeName,
        colorName: row.colorName,
      };

      // Only set stockAvailable if Strapi provided a numeric value; otherwise do not touch.
      const dataWithStock =
        typeof row.stockAvailable === "number"
          ? { ...dataBase, stockAvailable: row.stockAvailable }
          : dataBase;

      if (typeof row.stockAvailable === "number") setStockFromStrapi += 1;

      await prisma.productVariant.upsert({
        where: { strapiSizeId: Number(row.strapiSizeId) },
        create: {
          ...dataWithStock,
          strapiSizeId: Number(row.strapiSizeId),
        },
        update: dataWithStock,
      });

      if (existing) updated += 1;
      else created += 1;
    }

    // Summaries for UI
    const totals = await prisma.productVariant.groupBy({
      by: ["productId"],
      where: { productId: appProduct.id },
      _sum: { stockAvailable: true },
      _count: { _all: true },
    });

    const row0 = Array.isArray(totals) ? totals[0] : null;

    return json(
      {
        ok: true,
        dryRun: false,
        strapiId: id,
        app: {
          product: appProduct,
          variants: {
            created,
            updated,
            skippedNoStrapiSizeId,
            attemptedRows: variantRows.length,
            uniqueStrapiSizeIds: uniqueSizeIds.length,
            setStockFromStrapi,
            totalVariantsForProduct: row0?._count?._all ?? null,
            sumStockAvailable: row0?._sum?.stockAvailable ?? null,
          },
        },
        media: productFields.media,
        strapi: {
          slug,
          publishedAt: a?.publishedAt || null,
          updatedAt: a?.updatedAt || null,
        },
        warnings:
          skippedNoStrapiSizeId > 0
            ? [
                {
                  code: "STRAPI_SIZE_STOCK_ID_MISSING",
                  message:
                    "Some size_stocks entries had no Strapi component id, so they were skipped and cannot be mapped to appDb ProductVariant.strapiSizeId.",
                  meta: { skipped: skippedNoStrapiSizeId },
                },
              ]
            : [],
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json({ ok: false, error: str(e?.message || e), code: e?.code || null }, status);
  }
}
