// FILE: app/api/admin/catalog/products/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { api as strapiApi } from "@/lib/strapi";
import { getFirstGalleryImage, getMediaArray, getStrapiMediaUrl } from "@/lib/strapimedia";

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
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
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

function buildStrapiSort(sortKey) {
  // Accept UI formats:
  // - "updatedAt:desc" (preferred)
  // - legacy aliases like "updated_desc"
  const key = str(sortKey);
  if (!key) return "updatedAt:desc";
  if (key.includes(":")) return key;

  if (key === "updated_desc") return "updatedAt:desc";
  if (key === "updated_asc") return "updatedAt:asc";
  if (key === "created_desc") return "createdAt:desc";
  if (key === "created_asc") return "createdAt:asc";
  if (key === "name_asc") return "name:asc";
  if (key === "name_desc") return "name:desc";

  // These are used by the UI; map them to typical Strapi fields if present.
  // If your Product field is selling_price, sorting by it will work; otherwise Strapi will ignore safely.
  if (key === "price_desc") return "selling_price:desc";
  if (key === "price_asc") return "selling_price:asc";

  return "updatedAt:desc";
}

function buildStrapiStatusFilters(params) {
  const status = str(params.get("status")).toLowerCase();
  const filters = [];

  if (!status || status === "all") return { and: filters, special: null };

  if (status === "archived") {
    filters.push(["status", "$eq", "Archived"]);
    return { and: filters, special: null };
  }

  if (status === "active" || status === "live") {
    return {
      and: filters,
      special: {
        kind: "or",
        triplets: [
          ["publishedAt", "$notNull", true],
          ["status", "$eq", "Active"],
          ["status", "$eq", "Live"],
        ],
      },
    };
  }

  if (status === "draft") {
    return {
      and: filters,
      special: {
        kind: "or",
        triplets: [
          ["publishedAt", "$null", true],
          ["status", "$eq", "Draft"],
        ],
      },
    };
  }

  const normalized = status.charAt(0).toUpperCase() + status.slice(1);
  filters.push(["status", "$eq", normalized]);
  return { and: filters, special: null };
}

function buildStrapiSearchFilters(q) {
  const query = str(q);
  if (!query) return null;

  // Search in: name, slug, product_code, base_sku
  return [
    ["name", "$containsi", query],
    ["slug", "$containsi", query],
    ["product_code", "$containsi", query],
    ["base_sku", "$containsi", query],
  ];
}

function addFilterTriplet(p, idxBase, triplet) {
  const [field, op, value] = triplet;
  const k = `filters[$and][${idxBase}][${field}][${op}]`;
  p.set(k, value === true ? "true" : value === false ? "false" : String(value));
}

function addOrFilters(p, orTriplets, baseKey = "filters[$or]") {
  orTriplets.forEach((t, i) => {
    const [field, op, value] = t;
    const k = `${baseKey}[${i}][${field}][${op}]`;
    p.set(k, String(value));
  });
}

function normalizeMediaItem(m) {
  if (!m) return null;

  const url = getStrapiMediaUrl(m);
  const alt =
    str(m?.alternativeText) ||
    str(m?.attributes?.alternativeText) ||
    str(m?.caption) ||
    str(m?.attributes?.caption) ||
    null;

  const id = m?.id ?? m?.attributes?.id ?? null;

  return {
    id,
    url: url || null,
    alternativeText: alt,
  };
}

function normalizeMediaArray(mediaLike) {
  const arr = getMediaArray(mediaLike);
  return arr.map(normalizeMediaItem).filter((x) => x && x.url);
}

function deriveStatus(a) {
  const statusAttr = a?.status;
  if (str(statusAttr)) return statusAttr;

  const publishedAt = a?.publishedAt;
  if (publishedAt) return "Active";
  return "Draft";
}

function mapStrapiProduct(node) {
  const id = node?.id;
  const a = node?.attributes || {};

  const title =
    str(a?.name) ||
    str(a?.title) ||
    str(a?.product_name) ||
    str(a?.label) ||
    "";

  const slug = str(a?.slug) || null;

  const galleryThumb = getFirstGalleryImage(a);
  const imagesArr = getMediaArray(a?.images);
  const galleryArr = getMediaArray(a?.gallery);

  // Thumbnail selection rules:
  // 1) first gallery image (preferred)
  // 2) first images
  // 3) first gallery (fallback)
  const thumbnailObj =
    galleryThumb ||
    (imagesArr.length ? imagesArr[0] : null) ||
    (galleryArr.length ? galleryArr[0] : null) ||
    null;

  const thumbnailUrl = thumbnailObj ? getStrapiMediaUrl(thumbnailObj) : null;

  const images = normalizeMediaArray(a?.images);
  const gallery = normalizeMediaArray(a?.gallery);

  const cats = Array.isArray(a?.categories?.data) ? a.categories.data : [];
  const categories = cats
    .map((c) => ({
      id: c?.id ?? null,
      name: str(c?.attributes?.name) || null,
      slug: str(c?.attributes?.slug) || null,
    }))
    .filter((x) => x.id);

  const status = deriveStatus(a);

  const normalized = {
    id: Number(id),
    strapiId: Number(id),
    title,
    slug,
    status,
    timestamps: {
      createdAt: a?.createdAt ?? null,
      updatedAt: a?.updatedAt ?? null,
      publishedAt: a?.publishedAt ?? null,
    },
    pricing: {
      currency: a?.currency ?? null,
      selling_price: a?.selling_price ?? null,
      compare_price: a?.compare_price ?? null,
    },
    media: {
      thumbnail: thumbnailUrl || null,
      images,
      gallery,
    },
    taxonomy: {
      categories,
    },
  };

  return {
    // Existing fields preserved (no feature deletion)
    strapiId: Number(id),
    title,
    slug,
    statusAttr: a?.status ?? null,
    publishedAt: a?.publishedAt ?? null,
    createdAt: a?.createdAt ?? null,
    updatedAt: a?.updatedAt ?? null,
    productCode: a?.product_code ?? null,
    baseSku: a?.base_sku ?? null,
    currency: a?.currency ?? null,
    sellingPrice: a?.selling_price ?? null,
    comparePrice: a?.compare_price ?? null,
    thumbnail: thumbnailUrl || null,
    gallery,
    images,
    categories,
    raw: null,

    ...normalized,
  };
}

function computeAvailability(appProduct) {
  if (!appProduct) {
    return {
      bridged: false,
      appProductId: null,
      totalVariants: 0,
      totalAvailable: null,
    };
  }
  const variants = Array.isArray(appProduct?.variants) ? appProduct.variants : [];
  const sum = variants.reduce((acc, v) => acc + Number(v?.stockAvailable ?? 0), 0);

  return {
    bridged: true,
    appProductId: appProduct.id,
    totalVariants: variants.length,
    totalAvailable: Number.isFinite(sum) ? sum : 0,
  };
}

function hasThumb(item) {
  const t = str(item?.media?.thumbnail || item?.thumbnail);
  return Boolean(t);
}

/* ───────────────── GET: list ───────────────── */
export async function GET(req) {
  try {
    // RBAC: allow MANAGE_CATALOG OR VIEW_ANALYTICS
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const url = new URL(req.url);
    const sp = url.searchParams;

    const q = str(sp.get("q"));
    const page = clamp(int(sp.get("page"), 1), 1, 10_000);
    const pageSize = clamp(int(sp.get("pageSize"), 24), 1, 100);
    const sort = buildStrapiSort(sp.get("sort"));

    // Optional filters
    const statusFilter = buildStrapiStatusFilters(sp);
    const orTriplets = buildStrapiSearchFilters(q);

    // Post-join filters (page-deterministic)
    const stock = str(sp.get("stock")).toLowerCase(); // all | in | out | low
    const lowThreshold = clamp(int(sp.get("lowThreshold"), 3), 1, 999);

    const bridge = str(sp.get("bridge")).toLowerCase(); // all | bridged | unbridged
    const media = str(sp.get("media")).toLowerCase(); // all | has | none

    // Strapi query
    const p = new URLSearchParams();
    p.set("pagination[page]", String(page));
    p.set("pagination[pageSize]", String(pageSize));
    p.set("sort", sort);

    // Populates needed for real media + categories.
    // Use "*" for media fields for more reliable url/formats, instead of "true".
    p.set("populate[gallery]", "*");
    p.set("populate[images]", "*");
    p.set("populate[categories]", "true");

    // AND filters
    let andIdx = 0;
    for (const t of statusFilter.and) addFilterTriplet(p, andIdx++, t);

    // OR search filters
    if (orTriplets) addOrFilters(p, orTriplets, "filters[$or]");

    // SPECIAL status OR logic
    if (statusFilter.special?.kind === "or" && Array.isArray(statusFilter.special.triplets)) {
      const base = `filters[$and][${andIdx}][$or]`;
      addOrFilters(p, statusFilter.special.triplets, base);
      andIdx += 1;
    }

    const strapiRes = await strapiApi(`/api/products?${p.toString()}`);
    const rows = Array.isArray(strapiRes?.data) ? strapiRes.data : [];
    const pg = strapiRes?.meta?.pagination || null;

    const itemsStrapi = rows.map(mapStrapiProduct);

    // Join appDb availability by strapiId
    const strapiIds = itemsStrapi.map((x) => x.strapiId).filter(Boolean);

    const appProducts = strapiIds.length
      ? await prisma.product.findMany({
          where: { strapiId: { in: strapiIds } },
          select: {
            id: true,
            strapiId: true,
            status: true,
            slug: true,
            variants: {
              select: {
                id: true,
                stockAvailable: true,
              },
            },
          },
        })
      : [];

    const appByStrapiId = new Map(appProducts.map((p) => [Number(p.strapiId), p]));

    let joined = itemsStrapi.map((it) => {
      const app = appByStrapiId.get(Number(it.strapiId)) || null;
      const avail = computeAvailability(app);
      return {
        ...it,
        availability: avail,
        app: app
          ? { id: app.id, status: app.status ?? null, slug: app.slug ?? null, hasBridge: true }
          : { hasBridge: false },
      };
    });

    // Apply filters after join (page-deterministic, consistent with UI "This page" KPIs)
    if (bridge && bridge !== "all") {
      if (bridge === "bridged") joined = joined.filter((x) => Boolean(x?.app?.hasBridge));
      if (bridge === "unbridged") joined = joined.filter((x) => !Boolean(x?.app?.hasBridge));
    }

    if (media && media !== "all") {
      if (media === "has") joined = joined.filter((x) => hasThumb(x));
      if (media === "none") joined = joined.filter((x) => !hasThumb(x));
    }

    if (stock && stock !== "all") {
      if (stock === "bridged") joined = joined.filter((x) => x.availability.bridged);
      else if (stock === "unbridged") joined = joined.filter((x) => !x.availability.bridged);
      else if (stock === "in") joined = joined.filter((x) => (x.availability.totalAvailable ?? 0) > 0);
      else if (stock === "out") joined = joined.filter((x) => (x.availability.totalAvailable ?? 0) <= 0);
      else if (stock === "low")
        joined = joined.filter((x) => {
          const ta = Number(x?.availability?.totalAvailable ?? 0);
          return ta > 0 && ta <= lowThreshold;
        });
    }

    // Page KPI counts (based on returned list)
    const pageCounts = joined.reduce(
      (acc, x) => {
        if (x?.app?.hasBridge) acc.bridged += 1;
        else acc.unbridged += 1;

        const ta = x?.availability?.totalAvailable;
        if (typeof ta === "number") {
          if (ta > 0) acc.inStock += 1;
          else acc.outStock += 1;

          if (ta > 0 && ta <= lowThreshold) acc.lowStock += 1;
        }

        if (!hasThumb(x)) acc.missingThumb += 1;
        else acc.hasThumb += 1;

        return acc;
      },
      { bridged: 0, unbridged: 0, inStock: 0, outStock: 0, lowStock: 0, missingThumb: 0, hasThumb: 0 }
    );

    const total = pg?.total ?? null;
    const pageCount = pg?.pageCount ?? null;

    return json(
      {
        ok: true,
        items: joined,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: pageCount,
          pageCount,
        },
        countsThisPage: pageCounts,
        meta: {
          source: "strapi_rest + appDb_join",
          strapiBaseUrl: getStrapiBaseUrl() || null,
          lowThreshold,
          applied: {
            bridge: bridge || "all",
            media: media || "all",
            stock: stock || "all",
          },
        },
        source: "strapi_rest + appDb_join",
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    const payload = {
      ok: false,
      error: status === 403 ? "FORBIDDEN" : status === 401 ? "UNAUTHORIZED" : "SERVER_ERROR",
      message: String(e?.message || e || "Unknown error"),
    };

    if (process.env.NODE_ENV !== "production") {
      payload.detail = {
        name: e?.name || null,
        code: e?.code || null,
        stack: e?.stack || null,
      };
    }

    return json(payload, status);
  }
}
