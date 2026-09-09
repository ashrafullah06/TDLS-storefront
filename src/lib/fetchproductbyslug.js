// FILE: src/lib/fetchproductbyslug.js

import { cache } from "react";
import { fetchStrapi } from "./strapifetch";

const fetchProductBySlugCached = cache(
  async (slug) => {
    const cleanSlug = String(
      slug || ""
    ).trim();

    if (!cleanSlug) {
      return null;
    }

    const params = new URLSearchParams({
      "filters[slug][$eq]": cleanSlug,
      "pagination[page]": "1",
      "pagination[pageSize]": "1",
      "pagination[withCount]": "false",
    });

    const requestedRevalidate = Number(
      process.env
        .TDLS_PRODUCT_DETAIL_REVALIDATE_SECONDS ||
        60
    );

    const revalidate =
      Number.isFinite(requestedRevalidate) &&
      requestedRevalidate > 0
        ? Math.min(
            3600,
            Math.max(
              15,
              Math.round(requestedRevalidate)
            )
          )
        : 60;

    const productTag =
      "tdls-product-" +
      cleanSlug
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, "-")
        .slice(0, 160);

    const json = await fetchStrapi(
      `/products?${params}`,
      {
        timeoutMs: Number(
          process.env
            .TDLS_PRODUCT_DETAIL_FETCH_TIMEOUT_MS ||
            10000
        ),

        next: {
          revalidate,
          tags: [
            "tdls-products",
            productTag,
          ],
        },
      }
    );

    if (!Array.isArray(json?.data)) {
      throw new Error(
        "Invalid Strapi product response."
      );
    }

    const node = json.data[0];

    // Only a successful, empty response means
    // the product does not exist.
    if (!node) {
      return null;
    }

    const attributes =
      node.attributes || node;

    return {
      ...attributes,

      id:
        node.id ??
        attributes.id ??
        null,

      attributes,

      slug:
        attributes.slug ||
        cleanSlug,

      currency:
        attributes.currency ||
        attributes.price_currency,

      ...(
        attributes.image
          ? {}
          : attributes.cover_image
          ? {
              image:
                attributes.cover_image,
            }
          : {}
      ),
    };
  }
);

export async function fetchproductbyslug(
  slug
) {
  return fetchProductBySlugCached(slug);
}