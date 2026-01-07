// src/lib/fetchmenu.js
import { fetchStrapi } from "./strapifetch";

// Helper to safely extract slug from relation (single or array)
const getSlug = (relation) =>
  relation?.data?.[0]?.attributes?.slug || relation?.data?.attributes?.slug || "unknown";

export default async function fetchmenu() {
  const res = await fetchStrapi("/products?populate[brand_tier][fields][0]=slug&populate[category][fields][0]=slug");
  const data = res.data || [];

  // Build menu tree by brand_tier (tier), then category
  const menu = {};

  data.forEach((item) => {
    const attributes = item.attributes || {};
    const tier = getSlug(attributes.brand_tier);
    const category = getSlug(attributes.category);

    if (!menu[tier]) menu[tier] = {};
    if (!menu[tier][category]) menu[tier][category] = [];
    menu[tier][category].push({
      id: item.id,
      name: attributes.name,
      slug: attributes.slug,
    });
  });

  return menu;
}
