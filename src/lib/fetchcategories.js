// src/lib/fetchcategories.js
import { fetchStrapi } from "./strapifetch";

/** Minimal read that always returns an array of { id, name, slug, ... } */
export default async function fetchcategories() {
  const res = await fetchStrapi("/categories?populate=*");
  const data = Array.isArray(res?.data) ? res.data : [];
  return data.map((item) => ({
    id: item.id,
    name: item.attributes?.name || "",
    slug: item.attributes?.slug || "",
    ...item.attributes,
  }));
}
