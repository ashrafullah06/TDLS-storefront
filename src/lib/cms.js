// ✅ PATH: src/lib/cms.js
"use server";

import { api as strapiApi } from "@/lib/strapi";
import {
  getFirstGalleryImage,
  getStrapiMediaUrl,
} from "@/lib/strapimedia";

/**
 * Map a raw Strapi product node into a safe, frontend-friendly object.
 * Adjust field names here to match your Strapi Product CT.
 */
function mapProductNode(node) {
  if (!node) return null;

  const id = node.id;
  const a = node.attributes || {};

  const title =
    a.title ||
    a.name ||
    a.product_name ||
    a.label ||
    "";

  const slug = a.slug || null;

  // Try to resolve a thumbnail:
  // 1) gallery (via helper)
  // 2) thumbnail media field
  // 3) cover image / featured image
  const galleryThumb = getFirstGalleryImage(a);
  const thumbFromThumbnail =
    a.thumbnail?.data?.attributes?.url
      ? getStrapiMediaUrl(a.thumbnail.data.attributes.url)
      : null;
  const thumbFromCover =
    a.cover?.data?.attributes?.url
      ? getStrapiMediaUrl(a.cover.data.attributes.url)
      : null;

  const thumbnail = galleryThumb || thumbFromThumbnail || thumbFromCover || null;

  return {
    id,
    slug,
    title,
    description: a.description || a.short_description || "",
    sku: a.sku || null,
    price: a.price ?? null,
    compareAtPrice: a.compare_at_price ?? null,
    currency: a.currency || "BDT",

    // Any other fields you rely on can be added here:
    status: a.status || a.state || null,
    tags: Array.isArray(a.tags) ? a.tags : [],
    raw: node,          // keep full Strapi node for advanced use
    thumbnail,
  };
}

/**
 * Fetch a list of products from Strapi.
 *
 * @param {Object} options
 * @param {string} [options.qs]    Raw querystring (without leading "?"),
 *                                 e.g. 'populate=*&pagination[pageSize]=100'
 * @param {string} [options.populate='*'] Default populate if qs not supplied.
 */
export async function getProducts({ qs, populate = "*" } = {}) {
  const query =
    typeof qs === "string" && qs.trim().length > 0
      ? qs.trim().replace(/^\?+/, "")
      : `populate=${encodeURIComponent(populate)}`;

  const res = await strapiApi(`/api/products?${query}`);
  const rows = Array.isArray(res?.data) ? res.data : [];

  return rows
    .map(mapProductNode)
    .filter(Boolean);
}

/**
 * Fetch a single product by slug.
 *
 * @param {string} slug
 * @param {Object} options
 * @param {string} [options.populate='*']
 * @param {string} [options.extraQs] extra raw querystring to append
 *                                   (without leading "?"), e.g. "publicationState=live"
 */
export async function getProductBySlug(
  slug,
  { populate = "*", extraQs } = {}
) {
  if (!slug) return null;

  const parts = [
    `filters[slug][$eq]=${encodeURIComponent(slug)}`,
    `populate=${encodeURIComponent(populate)}`,
  ];
  if (extraQs && extraQs.trim()) {
    parts.push(extraQs.trim().replace(/^\?+/, ""));
  }

  const qs = parts.join("&");
  const res = await strapiApi(`/api/products?${qs}`);
  const rows = Array.isArray(res?.data) ? res.data : [];
  if (!rows.length) return null;

  return mapProductNode(rows[0]);
}

/**
 * Very small generic helper if you want to fetch arbitrary collections
 * without re-writing boilerplate.
 *
 * Example:
 *   const cats = await fetchCollection("/api/categories?populate=*");
 */
export async function fetchCollection(path) {
  const res = await strapiApi(path);
  const data = Array.isArray(res?.data) ? res.data : [];
  return data;
}
