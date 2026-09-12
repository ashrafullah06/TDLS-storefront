// FILE: src/lib/product-query.js
// Keep list queries aligned with the public proxy while preserving detail fields.

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

const LIST_TAXONOMY = [
  "audience_categories",
  "categories",
  "sub_categories",
  "age_groups",
  "gender_groups",
  "events_products_collections",
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

  normalizeProductFilters(p);

  // Replace the obsolete product population profile,
  // preserving the caller's normalized filters.
  for (const key of [...p.keys()]) {
    if (
      key === "populate" ||
      key.startsWith("populate[")
    ) {
      p.delete(key);
    }
  }

  const detail =
    pathname !== "/products" ||
    [...p.keys()].some((key) =>
      /^filters\[slug\]/.test(key)
    );

  if (detail) {
    // Preserve the full product-detail fields and variant children.
    for (const relation of [
      "images",
      "gallery",
      ...TAXONOMY,
    ]) {
      p.set(`populate[${relation}]`, "*");
    }

    p.set(
      "populate[product_variants][populate]",
      "*"
    );

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
  } else {
    // Match the proxy's cardlite list profile. Filtered lists use
    // its filtersafe profile, which also includes variant sizes.
    for (const relation of LIST_TAXONOMY) {
      p.set(`populate[${relation}][fields][0]`, "slug");
      p.set(`populate[${relation}][fields][1]`, "name");
    }

    p.set("populate[images]", "*");

    if (
      [...p.keys()].some(
        (key) => key === "filters" || key.startsWith("filters[")
      )
    ) {
      p.set(
        "populate[product_variants][populate][sizes]",
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

// Shared by direct CMS fetches and the public proxy.
export function normalizeProductFilters(p) {
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

  return p;
}