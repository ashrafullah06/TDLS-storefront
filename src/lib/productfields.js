// src/lib/productfields.js
// Public fields we frequently expose (taken from your Strapi model/example payloads)
export const product_public_fields = [
  "name",
  "slug",
  "short_description",
  "description",
  "is_featured",
  "is_archived",
  "disable_frontend",
  "base_price",
  "discount_price",
  "currency",
  "inventory",
  "status",
  "fit",
  "images",          // relation
  "gallery",         // relation
  "product_variants",// component/relation
  "seo",             // component
  "alt_names_entries",
  "materials_lines",
  "categories",          // relation
  "sub_categories",      // relation
  "super_categories",    // relation
  "audience_categories", // relation (Women/Men/Kids/Young/New Arrival/On Sale/Monsoon/Summer/Winter...)
  "age_groups",          // relation
  "gender_groups",       // relation
  "brand_tiers",         // relation
  "events_products_collections",
  "tags",
  "createdAt",
  "updatedAt",
  "publishedAt",
];
