// FILE: src/lib/fetchproducts.js

import { fetchStrapi } from "./strapifetch";
import { getFirstGalleryImage } from "./strapimedia";

export default async function fetchproducts() {
  const products = [];
  const seen = new Set();

  let pageCount = 1;

  for (
    let page = 1;
    page <= pageCount;
    page++
  ) {
    const response = await fetchStrapi(
      `/products?pagination[page]=${page}` +
        "&pagination[pageSize]=100" +
        "&pagination[withCount]=true"
    );

    const nodes = Array.isArray(response)
      ? response
      : response?.data;

    if (!Array.isArray(nodes)) {
      throw new Error(
        "Invalid Strapi product catalogue response."
      );
    }

    const count = Number(
      response?.meta?.pagination?.pageCount
    );

    if (
      Number.isFinite(count) &&
      count > 0
    ) {
      pageCount = Math.ceil(count);
    }

    for (const node of nodes) {
      const attributes =
        node?.attributes ||
        node ||
        {};

      const id =
        node?.id ??
        attributes.id ??
        null;

      const key =
        id ??
        attributes.slug;

      if (
        key != null &&
        seen.has(key)
      ) {
        continue;
      }

      if (key != null) {
        seen.add(key);
      }

      const base = {
        ...attributes,
        id,
      };

      products.push({
        ...base,
        attributes: base,
        image: getFirstGalleryImage(base),
      });
    }
  }

  return products;
}