// FILE: app/api/admin/catalog/launch-drafts/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { strapiWriteRequest, strapiCreate } from "@/lib/strapi/strapi-write";
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

function bool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n") return false;
  return null;
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function pickStrapiTitle(attrs) {
  return (
    str(attrs?.name) ||
    str(attrs?.title) ||
    str(attrs?.product_name) ||
    str(attrs?.label) ||
    ""
  );
}

function mapDraftRow(node, { bridgeByStrapiId, sumsByAppProductId } = {}) {
  const id = node?.id ?? null;
  const a = node?.attributes || {};

  const title = pickStrapiTitle(a);
  const slug = str(a?.slug) || null;

  const galleryUrls = getMediaArray(a?.gallery);
  const imagesUrls = getMediaArray(a?.images);

  const thumb =
    getFirstGalleryImage(a) ||
    (imagesUrls.length ? imagesUrls[0] : null) ||
    null;

  const publishedAt = a?.publishedAt || null;
  const updatedAt = a?.updatedAt || null;
  const createdAt = a?.createdAt || null;

  const isArchived = typeof a?.is_archived === "boolean" ? a.is_archived : null;
  const disableFrontend =
    typeof a?.disable_frontend === "boolean" ? a.disable_frontend : null;

  const productCode = str(a?.product_code) || null;
  const productUuid = str(a?.uuid) || null;
  const baseSku = str(a?.base_sku) || null;
  const generatedSku = str(a?.generated_sku) || null;
  const barcode = str(a?.barcode) || null;
  const hsCode = str(a?.hs_code) || null;

  const bridged = bridgeByStrapiId?.get(Number(id)) || null;

  const app = bridged
    ? {
        productId: bridged.id,
        status: str(bridged.status) || null,
        archivedAt: bridged.archivedAt || null,
        updatedAt: bridged.updatedAt || null,
        variantsCount:
          typeof bridged?._count?.variants === "number"
            ? bridged._count.variants
            : null,
        stockAvailable:
          sumsByAppProductId?.get(bridged.id) ??
          (typeof bridged?.stockAvailable === "number" ? bridged.stockAvailable : null),
      }
    : null;

  return {
    id,
    title,
    slug,
    publication: {
      isDraft: !publishedAt,
      publishedAt,
      updatedAt,
      createdAt,
    },
    flags: {
      isArchived,
      disableFrontend,
    },
    codes: {
      uuid: productUuid,
      productCode,
      baseSku,
      generatedSku,
      barcode,
      hsCode,
    },
    media: {
      thumbnail: thumb ? getStrapiMediaUrl(thumb) : null,
      gallery: galleryUrls.map(getStrapiMediaUrl).filter(Boolean),
      images: imagesUrls.map(getStrapiMediaUrl).filter(Boolean),
    },
    bridged: Boolean(app),
    app,
    raw: node, // retained for admin tooling (no guessing)
  };
}

function buildDraftListQuery(url) {
  const u = new URL(url);

  const q = str(u.searchParams.get("q"));
  const page = clamp(int(u.searchParams.get("page"), 1), 1, 1_000_000);
  const pageSize = clamp(int(u.searchParams.get("pageSize"), 20), 1, 100);
  const sort = str(u.searchParams.get("sort")) || "updatedAt:desc";

  const categoryId = str(u.searchParams.get("categoryId"));
  const collectionId = str(u.searchParams.get("collectionId"));
  const tagId = str(u.searchParams.get("tagId"));

  const isArchived = bool(u.searchParams.get("is_archived"));
  const disableFrontend = bool(u.searchParams.get("disable_frontend"));
  const isFeatured = bool(u.searchParams.get("is_featured"));

  // bridged filter: "true" => only bridged, "false" => only unbridged
  const bridged = bool(u.searchParams.get("bridged"));

  // includeVariants = true can be heavy; default false for list speed
  const includeVariants = bool(u.searchParams.get("includeVariants")) === true;

  // Date window (Strapi updatedAt)
  const from = str(u.searchParams.get("from")); // ISO
  const to = str(u.searchParams.get("to")); // ISO

  const params = new URLSearchParams();

  // Draft mode: include drafts; filter to drafts only.
  params.set("publicationState", "preview");
  params.set("filters[publishedAt][$null]", "true");

  params.set("pagination[page]", String(page));
  params.set("pagination[pageSize]", String(pageSize));
  params.set("sort", sort);

  // Populate for real images
  params.set("populate[gallery]", "true");
  params.set("populate[images]", "true");

  // Relations (only if provided)
  // These names must match your Strapi schema; your uploaded schema shows:
  // - categories (manyToMany)
  // - collections (manyToMany)
  // - tags (manyToMany)
  if (categoryId) params.set("filters[categories][id][$eq]", categoryId);
  if (collectionId) params.set("filters[collections][id][$eq]", collectionId);
  if (tagId) params.set("filters[tags][id][$eq]", tagId);

  if (isArchived !== null) params.set("filters[is_archived][$eq]", String(isArchived));
  if (disableFrontend !== null)
    params.set("filters[disable_frontend][$eq]", String(disableFrontend));
  if (isFeatured !== null) params.set("filters[is_featured][$eq]", String(isFeatured));

  if (from) params.set("filters[updatedAt][$gte]", from);
  if (to) params.set("filters[updatedAt][$lte]", to);

  // Search across known fields (no guessing beyond schema.json fields)
  if (q) {
    // $or across name/slug/product_code/base_sku/generated_sku/barcode
    params.set("filters[$or][0][name][$containsi]", q);
    params.set("filters[$or][1][slug][$containsi]", q);
    params.set("filters[$or][2][product_code][$containsi]", q);
    params.set("filters[$or][3][base_sku][$containsi]", q);
    params.set("filters[$or][4][generated_sku][$containsi]", q);
    params.set("filters[$or][5][barcode][$containsi]", q);
  }

  if (includeVariants) {
    // Your Strapi schema uses "product_variants" component
    params.set("populate[product_variants]", "true");
  }

  return {
    page,
    pageSize,
    sort,
    q,
    bridged,
    includeVariants,
    qs: params.toString(),
  };
}

/* ───────────────── handlers ───────────────── */

export async function GET(req) {
  try {
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const query = buildDraftListQuery(req.url);

    // Use WRITE client to guarantee preview/drafts visibility server-side.
    const res = await strapiWriteRequest(`/products?${query.qs}`, { method: "GET" });

    const rows = Array.isArray(res?.data) ? res.data : [];
    const meta = res?.meta || null;

    const strapiIds = rows
      .map((r) => Number(r?.id))
      .filter((n) => Number.isFinite(n));

    // appDb join (optional)
    const bridgeByStrapiId = new Map();
    const sumsByAppProductId = new Map();

    if (strapiIds.length) {
      const bridgedProducts = await prisma.product.findMany({
        where: { strapiId: { in: strapiIds } },
        select: {
          id: true,
          strapiId: true,
          status: true,
          archivedAt: true,
          updatedAt: true,
          _count: { select: { variants: true } },
        },
      });

      for (const p of bridgedProducts) {
        if (typeof p?.strapiId === "number") bridgeByStrapiId.set(p.strapiId, p);
      }

      const appProductIds = bridgedProducts.map((p) => p.id);

      if (appProductIds.length) {
        const grouped = await prisma.productVariant.groupBy({
          by: ["productId"],
          where: { productId: { in: appProductIds } },
          _sum: { stockAvailable: true },
        });

        for (const g of grouped) {
          sumsByAppProductId.set(g.productId, g?._sum?.stockAvailable ?? 0);
        }
      }
    }

    const mapped = rows.map((node) =>
      mapDraftRow(node, { bridgeByStrapiId, sumsByAppProductId })
    );

    // bridged filter post-join (because Strapi doesn't know appDb)
    const filtered =
      query.bridged === null
        ? mapped
        : mapped.filter((x) => (query.bridged ? x.bridged : !x.bridged));

    // KPI summary (computed from returned page only)
    const kpi = {
      pageDrafts: filtered.length,
      pageBridged: filtered.filter((x) => x.bridged).length,
      pageUnbridged: filtered.filter((x) => !x.bridged).length,
      pageStockAvailable: filtered.reduce((sum, x) => sum + (x?.app?.stockAvailable ?? 0), 0),
    };

    return json(
      {
        ok: true,
        query: {
          page: query.page,
          pageSize: query.pageSize,
          sort: query.sort,
          q: query.q || null,
          bridged: query.bridged,
          includeVariants: query.includeVariants,
        },
        kpi,
        meta,
        data: filtered,
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json(
      { ok: false, error: str(e?.message || e), code: e?.code || null },
      status
    );
  }
}

export async function POST(req) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const payload = await req.json().catch(() => ({}));

    // Accept either { data: {...} } or direct fields
    const inData = payload?.data && typeof payload.data === "object" ? payload.data : payload;

    const name = str(inData?.name);
    if (!name) return json({ ok: false, error: "name is required" }, 400);

    // Only pass through defined fields (avoid sending undefined)
    const out = {};
    for (const [k, v] of Object.entries(inData || {})) {
      if (v === undefined) continue;
      out[k] = v;
    }

    // Ensure "name" exists
    out.name = name;

    // Create draft in Strapi (draftAndPublish => publishedAt stays null until publish)
    const created = await strapiCreate("products", out);

    const node = created?.data || null;
    const strapiId = node?.id ?? null;
    const a = node?.attributes || {};

    if (!strapiId) {
      return json({ ok: false, error: "Strapi create returned no id" }, 502);
    }

    // Bridge into appDb Product (real record; not a placeholder)
    const title = pickStrapiTitle(a) || name;
    const slug = str(a?.slug) || null;

    // Required appDb fields: title, slug
    if (!slug) {
      // Strapi should generate slug for uid fields. If it did not, we cannot invent one here.
      return json(
        {
          ok: false,
          error:
            "Strapi did not return a slug for this product. Ensure the Product schema generates/returns slug (uid) on create.",
          strapiId,
        },
        502
      );
    }

    const priceCurrency = str(a?.price_currency || a?.currency || "");
    const priceMrp = a?.price_mrp ?? null;
    const priceSale = a?.price_sale ?? null;
    const priceMin = a?.price_range?.min ?? a?.price_min ?? null;
    const priceMax = a?.price_range?.max ?? a?.price_max ?? null;

    const productUuid = str(a?.uuid) || null;
    const productCode = str(a?.product_code) || null;
    const baseSku = str(a?.base_sku) || null;
    const productBarcode = str(a?.barcode) || null;
    const hsCode = str(a?.hs_code) || null;

    const fit = str(a?.fit) || null;
    const sizeSystem = str(a?.size_system) || null;

    const publishedAt = a?.publishedAt || null;
    const strapiUpdatedAt = a?.updatedAt ? new Date(a.updatedAt) : null;

    let upserted = null;
    try {
      upserted = await prisma.product.upsert({
        where: { strapiId: Number(strapiId) },
        create: {
          title,
          subtitle: str(a?.short_description) || null,
          slug,
          description: a?.description ?? null,
          status: publishedAt ? "active" : "draft",
          brand: str(a?.brand) || null,

          fit,
          sizeSystem,

          priceCurrency: priceCurrency ? priceCurrency : null,
          priceMrp: priceMrp ?? null,
          priceSale: priceSale ?? null,
          priceMin: priceMin ?? null,
          priceMax: priceMax ?? null,

          hasVariants: typeof a?.has_variants === "boolean" ? a.has_variants : null,
          strapiStockTotal: typeof a?.stock_total === "number" ? a.stock_total : null,

          productUuid,
          productCode,
          baseSku,
          productBarcode,
          hsCode,

          seoJson: a?.seo ?? null,
          altNamesJson: a?.alt_names_entries ?? null,
          translationsJson: a?.translations ?? null,

          metaTitle: str(a?.meta_title) || null,
          metaDescription: str(a?.meta_description) || null,

          strapiId: Number(strapiId),
          strapiUpdatedAt,
          strapiSlug: slug,
        },
        update: {
          title,
          subtitle: str(a?.short_description) || null,
          slug,
          description: a?.description ?? null,
          status: publishedAt ? "active" : "draft",
          brand: str(a?.brand) || null,

          fit,
          sizeSystem,

          priceCurrency: priceCurrency ? priceCurrency : null,
          priceMrp: priceMrp ?? null,
          priceSale: priceSale ?? null,
          priceMin: priceMin ?? null,
          priceMax: priceMax ?? null,

          hasVariants: typeof a?.has_variants === "boolean" ? a.has_variants : null,
          strapiStockTotal: typeof a?.stock_total === "number" ? a.stock_total : null,

          productUuid,
          productCode,
          baseSku,
          productBarcode,
          hsCode,

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
    } catch (e) {
      // Do not guess; surface Prisma unique/constraint failures clearly.
      const msg = str(e?.message || e);
      return json(
        {
          ok: false,
          error: "appDb bridge failed",
          detail: msg,
          strapiId,
        },
        500
      );
    }

    const media = {
      thumbnail: null,
      gallery: [],
      images: [],
    };

    try {
      const g = getMediaArray(a?.gallery).map(getStrapiMediaUrl).filter(Boolean);
      const imgs = getMediaArray(a?.images).map(getStrapiMediaUrl).filter(Boolean);
      const thumb =
        getFirstGalleryImage(a) ||
        (imgs.length ? imgs[0] : null) ||
        null;

      media.thumbnail = thumb ? getStrapiMediaUrl(thumb) : null;
      media.gallery = g;
      media.images = imgs;
    } catch {
      // non-fatal; media helpers are deterministic but depend on env base url
    }

    return json(
      {
        ok: true,
        strapi: {
          id: strapiId,
          slug: str(a?.slug) || null,
          updatedAt: a?.updatedAt || null,
          publishedAt: a?.publishedAt || null,
        },
        app: upserted,
        media,
        raw: node,
      },
      201
    );
  } catch (e) {
    const status = e?.status || 500;
    return json(
      { ok: false, error: str(e?.message || e), code: e?.code || null },
      status
    );
  }
}

/**
 * PATCH (optional convenience):
 * - Update an existing Strapi product draft by id, and refresh appDb bridge.
 * Body: { id, data } or { strapiId, data }.
 */
export async function PATCH(req) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const payload = await req.json().catch(() => ({}));
    const idRaw = payload?.id ?? payload?.strapiId ?? null;
    const id = int(idRaw, 0);
    if (!id) return json({ ok: false, error: "id is required" }, 400);

    const inData =
      payload?.data && typeof payload.data === "object" ? payload.data : null;
    if (!inData) return json({ ok: false, error: "data is required" }, 400);

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
    const slug = str(a?.slug) || null;

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

    const title = pickStrapiTitle(a) || "";
    const strapiUpdatedAt = a?.updatedAt ? new Date(a.updatedAt) : null;
    const publishedAt = a?.publishedAt || null;

    const priceCurrency = str(a?.price_currency || a?.currency || "");

    const app = await prisma.product.upsert({
      where: { strapiId: id },
      create: {
        title: title || slug,
        subtitle: str(a?.short_description) || null,
        slug,
        description: a?.description ?? null,
        status: publishedAt ? "active" : "draft",
        brand: str(a?.brand) || null,

        fit: str(a?.fit) || null,
        sizeSystem: str(a?.size_system) || null,

        priceCurrency: priceCurrency ? priceCurrency : null,
        priceMrp: a?.price_mrp ?? null,
        priceSale: a?.price_sale ?? null,
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

        strapiId: id,
        strapiUpdatedAt,
        strapiSlug: slug,
      },
      update: {
        title: title || slug,
        subtitle: str(a?.short_description) || null,
        slug,
        description: a?.description ?? null,
        status: publishedAt ? "active" : "draft",
        brand: str(a?.brand) || null,

        fit: str(a?.fit) || null,
        sizeSystem: str(a?.size_system) || null,

        priceCurrency: priceCurrency ? priceCurrency : null,
        priceMrp: a?.price_mrp ?? null,
        priceSale: a?.price_sale ?? null,
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
    return json(
      { ok: false, error: str(e?.message || e), code: e?.code || null },
      status
    );
  }
}

/**
 * DELETE (optional convenience):
 * - Delete a Strapi draft by id.
 * - Does NOT delete appDb Product automatically (safety); returns whether a bridge exists.
 * Query: ?id=123  OR JSON body: { id: 123 }
 */
export async function DELETE(req) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const u = new URL(req.url);
    let id = int(u.searchParams.get("id"), 0);

    if (!id) {
      const payload = await req.json().catch(() => ({}));
      id = int(payload?.id ?? payload?.strapiId, 0);
    }

    if (!id) return json({ ok: false, error: "id is required" }, 400);

    const bridged = await prisma.product.findUnique({
      where: { strapiId: id },
      select: { id: true, strapiId: true, slug: true, status: true },
    });

    await strapiWriteRequest(`/products/${id}`, { method: "DELETE" });

    return json(
      {
        ok: true,
        deleted: { strapiId: id },
        bridged: Boolean(bridged),
        app: bridged || null,
        note:
          "App DB product record is not deleted by this endpoint. If you want a hard-delete bridge, create an explicit endpoint with safeguards.",
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json(
      { ok: false, error: str(e?.message || e), code: e?.code || null },
      status
    );
  }
}
