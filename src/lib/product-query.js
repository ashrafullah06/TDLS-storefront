// FILE: src/lib/product-query.js
// Product relations verified against the supplied Strapi Product schema.

const TAXONOMY = [
  "categories",
  "sub_categories",
  "super_categories",
  "audience_categories",
  "age_groups",
  "gender_groups",
  "brand_tiers",
  "events_products_collections",
  "tags",
];

export function normalizeProductPath(path) {
  const url = new URL(path, "http://strapi.invalid");

  const pathname = url.pathname.replace(
    /^\/api(?=\/)/,
    ""
  );

  if (
    pathname !== "/products" &&
    !pathname.startsWith("/products/")
  ) {
    return path;
  }

  const p = url.searchParams;

  // Recognize only the exact five-branch tier query emitted
  // by the old clients. Other OR expressions and event filters
  // retain their original meaning.
  const legacy = [
    "tiers",
    "brand_tiers",
    "collection_tiers",
    "events_products_collections",
    "product_collections",
  ];

  const keys = legacy.map(
    (rel, i) =>
      `filters[$or][${i}][${rel}][slug][$eq]`
  );

  const orKeys = [...p.keys()].filter(
    (key) => key.startsWith("filters[$or]")
  );

  const values = keys.map((key) => p.get(key));

  if (
    orKeys.length === keys.length &&
    values[0] &&
    values.every((value) => value === values[0])
  ) {
    keys.forEach((key) => p.delete(key));

    p.set(
      "filters[brand_tiers][slug][$eq]",
      values[0]
    );
  }

  // Replace the obsolete product population profile,
  // not the caller's filters.
  for (const key of [...p.keys()]) {
    if (
      key === "populate" ||
      key.startsWith("populate[")
    ) {
      p.delete(key);
    }
  }

  for (const relation of [
    "images",
    "gallery",
    ...TAXONOMY,
  ]) {
    p.set(`populate[${relation}]`, "*");
  }

  // Populate the immediate children of each variant,
  // including its size rows. No guessed child relation
  // names are needed.
  p.set(
    "populate[product_variants][populate]",
    "*"
  );

  const detail =
    pathname !== "/products" ||
    [...p.keys()].some((key) =>
      /^filters\[slug\]/.test(key)
    );

  if (detail) {
    for (const component of [
      "seo",
      "alt_names_entries",
      "materials_lines",
      "translations",
    ]) {
      p.set(
        `populate[${component}][populate]`,
        "*"
      );
    }
  }

  if (pathname === "/products") {
    if (
      !p.has("pagination[start]") &&
      !p.has("pagination[limit]")
    ) {
      if (!p.has("pagination[page]")) {
        p.set("pagination[page]", "1");
      }

      if (!p.has("pagination[pageSize]")) {
        p.set("pagination[pageSize]", "24");
      }
    }

    const hasSort = [...p.keys()].some(
      (key) =>
        key === "sort" ||
        key.startsWith("sort[")
    );

    if (!hasSort) {
      p.set("sort", "id:asc");
    }
  }

  return `${pathname}?${p.toString()}`;
}