// FILE: src/lib/catalog/catalog-mapper.js

import {
  getStrapiMediaUrl,
  pickBestImageUrl,
} from "@/lib/strapimedia";

/**
 * Catalog Mapper
 *  - Maps Strapi "Product" REST nodes ({ id, attributes }) into a normalized DTO
 *  - Thumbnail rules: images[0] → gallery[0] → thumbnail → cover → null
 *  - Media URLs: always absolute via getStrapiMediaUrl()
 *  - Taxonomy mapping: categories/sub_categories/super_categories/audience_categories/age_groups/gender_groups/brand_tiers/tags
 *
 * This module does not fabricate or infer missing values (no placeholders/ghosting).
 */

function str(v) {
  return String(v ?? "").trim();
}

function normalizeMoney(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function iso(dt) {
  if (!dt) return null;
  const t = new Date(dt);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/** Normalize a Strapi media relation { data: [...] } into rich media objects. */
export function mapStrapiMediaRelation(rel) {
  if (!rel?.data) return [];
  const nodes = Array.isArray(rel.data) ? rel.data : [rel.data];

  return nodes
    .map((n) => {
      const id = n?.id ?? null;
      const a = n?.attributes || {};

      const bestUrl = pickBestImageUrl(a) || a?.url || null;
      const url = bestUrl ? getStrapiMediaUrl(bestUrl) : null;

      if (!url) return null;

      const formats = a.formats && typeof a.formats === "object" ? a.formats : null;
      const formatsAbs = formats
        ? Object.fromEntries(
            Object.entries(formats).map(([k, fv]) => [
              k,
              fv?.url ? getStrapiMediaUrl(fv.url) : null,
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
        url,
        formats: formatsAbs,
      };
    })
    .filter(Boolean);
}

/** Normalize a Strapi relation list into {id,name,slug}. */
export function mapStrapiNamedRelation(rel) {
  if (!rel?.data) return [];
  const nodes = Array.isArray(rel.data) ? rel.data : [rel.data];
  return nodes
    .map((n) => {
      const id = n?.id ?? null;
      const a = n?.attributes || {};
      const name = a?.name ?? null;
      const slug = a?.slug ?? null;
      if (id == null) return null;
      return { id, name, slug };
    })
    .filter(Boolean);
}

/** Pick a single thumbnail URL from attributes using strict priority order. */
export function pickProductThumbnailUrl(attrs) {
  if (!attrs || typeof attrs !== "object") return null;

  const images = mapStrapiMediaRelation(attrs.images);
  if (images[0]?.url) return images[0].url;

  const gallery = mapStrapiMediaRelation(attrs.gallery);
  if (gallery[0]?.url) return gallery[0].url;

  const thumb =
    attrs.thumbnail?.data?.attributes?.url
      ? getStrapiMediaUrl(attrs.thumbnail.data.attributes.url)
      : null;
  if (thumb) return thumb;

  const cover =
    attrs.cover?.data?.attributes?.url
      ? getStrapiMediaUrl(attrs.cover.data.attributes.url)
      : null;
  if (cover) return cover;

  return null;
}

/**
 * Normalize Strapi product_variants component (repeatable) into a stable structure.
 * - Preserves component ids as provided by Strapi.
 * - Preserves size_stocks ids as provided by Strapi.
 */
export function mapStrapiProductVariants(attrs) {
  const variants = arr(attrs?.product_variants);

  return variants.map((v) => {
    const sizeStocks = arr(v?.size_stocks);
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
        price: normalizeMoney(s?.price),
        compare_at_price: normalizeMoney(s?.compare_at_price),
        price_override:
          typeof s?.price_override === "boolean" ? s.price_override : null,
        is_active: typeof s?.is_active === "boolean" ? s.is_active : null,
      })),
    };
  });
}

/**
 * Primary mapper: Strapi Product REST node -> Catalog Product DTO
 *
 * Input expected:
 *  node: { id, attributes: {...} }
 */
export function mapStrapiProductNodeToCatalogDTO(node) {
  if (!node || typeof node !== "object") return null;

  const id = Number(node.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const a = node.attributes || {};

  // Name/slug are required in your Strapi schema; fallback to "title" only if present.
  const title = a?.name ?? a?.title ?? null;
  const slug = a?.slug ?? null;

  const dto = {
    id,
    title: title ?? null,
    slug: slug ?? null,

    status: a?.status ?? null,
    fit: a?.fit ?? null,
    size_system: a?.size_system ?? null,

    description: a?.description ?? null,
    short_description: a?.short_description ?? null,
    care_instructions: a?.care_instructions ?? null,
    country_of_origin: a?.country_of_origin ?? null,

    pricing: {
      selling_price: normalizeMoney(a?.selling_price),
      compare_price: normalizeMoney(a?.compare_price),
      currency: a?.currency ?? null,
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

    flags: {
      is_featured: typeof a?.is_featured === "boolean" ? a.is_featured : null,
      is_archived: typeof a?.is_archived === "boolean" ? a.is_archived : null,
      disable_frontend:
        typeof a?.disable_frontend === "boolean" ? a.disable_frontend : null,
    },

    media: {
      thumbnail: pickProductThumbnailUrl(a),
      images: mapStrapiMediaRelation(a.images),
      gallery: mapStrapiMediaRelation(a.gallery),
    },

    taxonomy: {
      categories: mapStrapiNamedRelation(a.categories),
      sub_categories: mapStrapiNamedRelation(a.sub_categories),
      super_categories: mapStrapiNamedRelation(a.super_categories),
      audience_categories: mapStrapiNamedRelation(a.audience_categories),
      age_groups: mapStrapiNamedRelation(a.age_groups),
      gender_groups: mapStrapiNamedRelation(a.gender_groups),
      brand_tiers: mapStrapiNamedRelation(a.brand_tiers),
      tags: mapStrapiNamedRelation(a.tags),
    },

    relations: {
      factory: a?.factory?.data
        ? {
            id: a.factory.data.id ?? null,
            name: a.factory.data.attributes?.name ?? null,
            slug: a.factory.data.attributes?.slug ?? null,
          }
        : null,
      events_products_collections: mapStrapiNamedRelation(a.events_products_collections),
    },

    variants: mapStrapiProductVariants(a),

    timestamps: {
      createdAt: iso(a?.createdAt),
      updatedAt: iso(a?.updatedAt),
      publishedAt: iso(a?.publishedAt),
    },

    // Keep raw node if caller explicitly needs it (e.g., advanced diagnostics).
    // This is not "ghosting"; it's the original source object.
    raw: node,
  };

  return dto;
}

/** Convenience: map an array of Strapi nodes */
export function mapStrapiProductNodesToCatalogDTO(nodes) {
  return arr(nodes)
    .map(mapStrapiProductNodeToCatalogDTO)
    .filter(Boolean);
}
