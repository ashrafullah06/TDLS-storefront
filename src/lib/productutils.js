// lib/productutils.js

function getBaseUrl() {
  let url = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";
  url = url.replace(/\/$/, "");        // remove trailing slash
  if (url.endsWith("/api")) {          // remove trailing /api if present
    url = url.slice(0, -4);
  }
  return url;
}

export function safe(val, def = "") {
  if (val === undefined || val === null) return def;
  if (typeof val === "object") {
    if (Array.isArray(val)) return val.length > 0 ? String(val[0]) : def;
    if (val.data && Array.isArray(val.data) && val.data.length > 0) {
      const first = val.data[0];
      if (typeof first === "object") {
        if (typeof first.name === "string") return first.name;
        if (first.attributes && typeof first.attributes.name === "string") return first.attributes.name;
        if (first.id !== undefined) return String(first.id);
      }
      return String(first);
    }
    return def;
  }
  return val;
}

export function getCategorySlug(product) {
  const cat = product.category;
  if (typeof cat === "string") return cat.toLowerCase();
  if (cat?.data) {
    const arr = Array.isArray(cat.data) ? cat.data : [cat.data];
    return arr[0]?.attributes?.slug?.toLowerCase() || arr[0]?.attributes?.name?.toLowerCase() || "";
  }
  return "";
}

export function getAudienceSlug(product) {
  const aud = product.audience;
  if (typeof aud === "string") return aud.toLowerCase();
  if (aud?.data) {
    const arr = Array.isArray(aud.data) ? aud.data : [aud.data];
    return arr[0]?.attributes?.slug?.toLowerCase() || arr[0]?.attributes?.name?.toLowerCase() || "";
  }
  return "";
}

export function getUnique(variants, field) {
  return [...new Set((variants || []).map(v => v[field]).filter(Boolean))];
}

export function getImageArr(product, variants, selectedColor) {
  const baseUrl = getBaseUrl();

  if (selectedColor && Array.isArray(variants)) {
    const colorVariant = variants.find(v => v.color === selectedColor && v.images?.data?.length);
    if (colorVariant) {
      return colorVariant.images.data.map(imgObj =>
        baseUrl + imgObj.attributes.url
      );
    }
  }

  if (Array.isArray(variants)) {
    for (const v of variants) {
      if (v.images?.data?.length) {
        return v.images.data.map(imgObj =>
          baseUrl + imgObj.attributes.url
        );
      }
    }
  }

  const imagesData =
    product.images?.data ||
    product.attributes?.images?.data ||
    [];

  if (imagesData.length) {
    return imagesData.map(imgObj =>
      baseUrl + imgObj.attributes.url
    );
  }

  return ["/img/product-placeholder.png"]; // Optional fallback
}
