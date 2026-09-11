// FILE: src/lib/product-query.js
// Retains the existing product population fields.

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
  ).replace(/\/+$/, "");

  if (
    pathname !== "/products" &&
    !pathname.startsWith("/products/")
  ) {
    return path;
  }

  const p = url.searchParams;

  normalizeProductFilters(p);

  // Respect an explicit population profile. Replacing it here can turn
  // a small card/menu request into a much larger query.
  const hasPopulate = [...p.keys()].some(
    (key) => key === "populate" || key.startsWith("populate[")
  );

  if (!hasPopulate) {
    // Keep the existing default fields when the caller supplies no profile.
    for (const relation of ["images", "gallery", ...TAXONOMY]) {
      p.set(`populate[${relation}]`, "*");
    }

    // Keep the existing variant children, including size rows.
    p.set("populate[product_variants][populate]", "*");

    const detail =
      pathname !== "/products" ||
      [...p.keys()].some((key) =>
        /^filters(?:\[\$(?:and|or)\]\[\d+\])*\[slug\](?:\[|$)/.test(key)
      );

    if (detail) {
      for (const component of [
        "seo",
        "alt_names_entries",
        "materials_lines",
        "translations",
      ]) {
        p.set(`populate[${component}][populate]`, "*");
      }
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
    keys.every((key) => p.getAll(key).length === 1) &&
    values.every((value) => value === values[0])
  ) {
    keys.forEach((key) => p.delete(key));

    const canonicalKey = "filters[brand_tiers][slug][$eq]";

    // A separate tier condition is implicitly ANDed with this OR group.
    // Do not overwrite that condition and accidentally broaden the results.
    if (p.has(canonicalKey)) {
      p.set("filters[$or][0][brand_tiers][slug][$eq]", values[0]);
    } else {
      p.set(canonicalKey, values[0]);
    }
  }

  return p;
}