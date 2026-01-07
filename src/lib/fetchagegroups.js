// src/lib/fetchagegroups.js
import { fetchStrapi } from "./strapifetch";

export default async function fetchagegroups() {
  try {
    const res = await fetchStrapi("/age-groups?populate=*");

    // If request itself failed
    if (!res) {
      throw new Error("Failed to fetch age groups from Strapi");
    }

    // Always return an array; empty if none
    const data = Array.isArray(res.data) ? res.data : [];

    return data.map((item) => ({
      id: item.id,
      name: item.attributes?.name || "",
      slug: item.attributes?.slug || "",
      ...item.attributes,
    }));
  } catch (err) {
    console.error("fetchagegroups error:", err);
    return []; // safe fallback instead of crashing
  }
}
