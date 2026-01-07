// FILE: src/lib/fetchproducts.js
import { fetchStrapi } from "./strapifetch";
import { getFirstGalleryImage } from "./strapimedia";

/**
 * Fetch all products and normalize to:
 *   { id, ...flattenedAttributes, attributes, image }
 *
 * Works with BOTH:
 * - Strapi raw: { data: [...] }
 * - Already-unwrapped arrays: [...]
 */
export default async function fetchproducts() {
  let res;
  try {
    res = await fetchStrapi("/products?populate=*");
  } catch (e) {
    console.error("[fetchproducts] fetchStrapi error:", e);
    return [];
  }

  // Handle:
  // 1) Strapi response: { data: [...] }
  // 2) Already-unwrapped array: [...]
  const rawNodes = Array.isArray(res?.data)
    ? res.data
    : Array.isArray(res)
    ? res
    : [];

  if (!rawNodes.length) {
    console.warn("[fetchproducts] No products returned from Strapi.");
  }

  return rawNodes.map((node) => {
    const attrs = node?.attributes || node || {};

    const base = {
      id: node?.id ?? attrs.id ?? null,
      ...attrs,
    };

    // derive primary image from gallery/images/image/cover_image
    const image = getFirstGalleryImage(base);

    return {
      ...base,
      attributes: base, // for any code still doing product.attributes.xxx
      image,
    };
  });
}
