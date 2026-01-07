// src/lib/fetchevents.js
import { fetchStrapi } from "./strapifetch";

export async function fetchevents() {
  try {
    const res = await fetchStrapi("/events-products-collections?populate=*");

    // If request itself failed
    if (!res) {
      throw new Error("Failed to fetch event collections from Strapi");
    }

    // Always return an array; empty if none
    const data = Array.isArray(res.data) ? res.data : [];

    return data.map((item) => ({
      id: item.id,
      ...item.attributes,
    }));
  } catch (err) {
    console.error("fetchevents error:", err);
    return []; // safe fallback instead of crashing
  }
}
