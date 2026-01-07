// FILE: src/lib/catalog/catalog-queries.js

import { api as strapiApi } from "@/lib/strapi";

/**
 * Catalog Queries (Strapi)
 * - Central place for Strapi read queries used by Catalog APIs.
 * - Uses your existing Strapi client layer (strapiApi).
 * - Supports REST query building (primary) and optional GraphQL (if you later enable it).
 *
 * No placeholders / no inferred fields:
 * - We only request fields/relations that are explicitly used by Catalog.
 */

function str(v) {
  return String(v ?? "").trim();
}

function int(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function normalizeStrapiProductStatus(raw) {
  const v = str(raw);
  if (!v) return "";
  if (["Draft", "Active", "Archived"].includes(v)) return v;
  const lc = v.toLowerCase();
  if (lc === "draft") return "Draft";
  if (lc === "active") return "Active";
  if (lc === "archived") return "Archived";
  return "";
}

/**
 * Convert admin sort format into Strapi REST sort.
 * Input examples:
 *  - "updatedAt:desc"
 *  - "createdAt:asc"
 *  - "name:asc"
 *  - "price:desc"  => selling_price
 */
export function toStrapiSort(sortRaw) {
  const s = str(sortRaw) || "updatedAt:desc";
  const [f, d] = s.split(":");
  const dir = (d || "desc").toLowerCase() === "asc" ? "asc" : "desc";

  if (f === "createdAt") return `createdAt:${dir}`;
  if (f === "name") return `name:${dir}`;
  if (f === "price") return `selling_price:${dir}`;
  return `updatedAt:${dir}`;
}

/**
 * Build a Strapi REST list query for products.
 * - Minimal populate for list view (media + small relations if needed later).
 */
export function buildStrapiProductsListQuery(params = {}) {
  const page = Math.max(1, int(params.page, 1));
  const pageSize = clamp(int(params.pageSize, 24), 1, 100);
  const q = str(params.q);
  const status = normalizeStrapiProductStatus(params.status);
  const sort = toStrapiSort(params.sort);

  // Optional filter by IDs ($in)
  const ids = Array.isArray(params.ids)
    ? params.ids
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
    : [];

  const qs = [];
  qs.push(`pagination[page]=${page}`);
  qs.push(`pagination[pageSize]=${pageSize}`);
  qs.push(`sort=${encodeURIComponent(sort)}`);

  if (status) qs.push(`filters[status][$eq]=${encodeURIComponent(status)}`);

  if (q) {
    // Search name/slug/product_code/base_sku (all exist in your schema.json)
    qs.push(`filters[$or][0][name][$containsi]=${encodeURIComponent(q)}`);
    qs.push(`filters[$or][1][slug][$containsi]=${encodeURIComponent(q)}`);
    qs.push(`filters[$or][2][product_code][$containsi]=${encodeURIComponent(q)}`);
    qs.push(`filters[$or][3][base_sku][$containsi]=${encodeURIComponent(q)}`);
  }

  if (ids.length) {
    // filters[id][$in]=1&filters[id][$in]=2...
    for (const id of ids) qs.push(`filters[id][$in]=${id}`);
  }

  // Populate only what list needs for real thumbnails.
  // Components like product_variants are inline; no populate required.
  qs.push("populate[images]=*");
  qs.push("populate[gallery]=*");
  qs.push("populate[thumbnail]=*");
  qs.push("populate[cover]=*");

  // Keep payload lean: only request key fields + timestamps.
  // Strapi REST v4 supports fields[]=...
  qs.push("fields[0]=name");
  qs.push("fields[1]=slug");
  qs.push("fields[2]=status");
  qs.push("fields[3]=selling_price");
  qs.push("fields[4]=compare_price");
  qs.push("fields[5]=currency");
  qs.push("fields[6]=updatedAt");
  qs.push("fields[7]=createdAt");
  qs.push("fields[8]=publishedAt");
  qs.push("fields[9]=disable_frontend");
  qs.push("fields[10]=is_featured");

  return qs.join("&");
}

/**
 * Build a Strapi REST detail query for a single product id.
 * - Full gallery/images + taxonomy + factory + collections
 * - Variants are inline components; no populate required.
 */
export function buildStrapiProductDetailQuery(params = {}) {
  // Only populate relations that are present in your Product schema.json.
  const qs = [
    "populate[images]=*",
    "populate[gallery]=*",
    "populate[thumbnail]=*",
    "populate[cover]=*",

    "populate[categories]=*",
    "populate[sub_categories]=*",
    "populate[super_categories]=*",
    "populate[audience_categories]=*",
    "populate[age_groups]=*",
    "populate[gender_groups]=*",
    "populate[brand_tiers]=*",

    "populate[events_products_collections]=*",
    "populate[factory]=*",
  ];

  // Fields requested for detail (keeps response consistent).
  qs.push("fields[0]=name");
  qs.push("fields[1]=slug");
  qs.push("fields[2]=status");
  qs.push("fields[3]=fit");
  qs.push("fields[4]=size_system");
  qs.push("fields[5]=description");
  qs.push("fields[6]=short_description");
  qs.push("fields[7]=care_instructions");
  qs.push("fields[8]=country_of_origin");
  qs.push("fields[9]=selling_price");
  qs.push("fields[10]=compare_price");
  qs.push("fields[11]=currency");
  qs.push("fields[12]=uuid");
  qs.push("fields[13]=product_code");
  qs.push("fields[14]=base_sku");
  qs.push("fields[15]=generated_sku");
  qs.push("fields[16]=barcode");
  qs.push("fields[17]=hs_code");
  qs.push("fields[18]=color_code");
  qs.push("fields[19]=disable_frontend");
  qs.push("fields[20]=is_featured");
  qs.push("fields[21]=is_archived");
  qs.push("fields[22]=updatedAt");
  qs.push("fields[23]=createdAt");
  qs.push("fields[24]=publishedAt");

  return qs.join("&");
}

/**
 * Execute: fetch products list from Strapi REST.
 * Returns raw Strapi response { data, meta }.
 */
export async function fetchStrapiProductsList(params = {}) {
  const query = buildStrapiProductsListQuery(params);
  return strapiApi(`/api/products?${query}`);
}

/**
 * Execute: fetch product detail from Strapi REST.
 * Returns raw Strapi response { data }.
 */
export async function fetchStrapiProductDetail(strapiId, params = {}) {
  const id = Number(strapiId);
  if (!Number.isFinite(id) || id <= 0) {
    const e = new Error("Invalid Strapi product id");
    e.status = 400;
    throw e;
  }
  const query = buildStrapiProductDetailQuery(params);
  return strapiApi(`/api/products/${id}?${query}`);
}

/**
 * Execute: fetch lightweight existence check for slugs or IDs (for launch validation).
 * This is intentionally minimal and safe.
 */
export async function fetchStrapiProductsBySlug(slug) {
  const s = str(slug);
  if (!s) {
    const e = new Error("slug required");
    e.status = 400;
    throw e;
  }
  const qs = [];
  qs.push("pagination[page]=1");
  qs.push("pagination[pageSize]=10");
  qs.push(`filters[slug][$eq]=${encodeURIComponent(s)}`);
  qs.push("fields[0]=slug");
  qs.push("fields[1]=name");
  qs.push("fields[2]=status");
  return strapiApi(`/api/products?${qs.join("&")}`);
}

/**
 * Optional GraphQL entry point (only if you already have Strapi GraphQL enabled).
 * This function is inert unless you call it.
 */
export async function fetchStrapiGraphQL({ query, variables }) {
  const q = str(query);
  if (!q) {
    const e = new Error("GraphQL query required");
    e.status = 400;
    throw e;
  }
  // Your project already has src/lib/strapi-graphql.js; keep this centralized wrapper.
  const { graphql } = await import("@/lib/strapi-graphql");
  return graphql({ query: q, variables: variables || {} });
}
