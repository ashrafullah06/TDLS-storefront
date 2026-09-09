// FILE: src/lib/strapimedia.js

function isProd() {
  return process.env.NODE_ENV === "production";
}

function normalizeBase(raw) {
  let base = (raw || "").trim();

  if (!base) {
    return "";
  }

  // Add scheme if missing.
  if (!/^https?:\/\//i.test(base)) {
    base =
      `${isProd() ? "https" : "http"}://${base}`;
  }

  // Prefer IPv4 localhost in development.
  base = base.replace(
    /^http:\/\/localhost(?=[/:]|$)/i,
    "http://127.0.0.1"
  );

  // Strip trailing slash and a trailing /api.
  base = base
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  return base;
}

function assertNotLocalhost(base) {
  if (!isProd()) {
    return;
  }

  try {
    const hostname = new URL(base).hostname;

    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local");

    if (isLocal) {
      throw new Error(
        `Strapi base URL is localhost in production: ${base}. Set NEXT_PUBLIC_STRAPI_URL (recommended) to your real Strapi domain.`
      );
    }
  } catch {
    throw new Error(
      `Invalid Strapi base URL in production: ${base}. Set NEXT_PUBLIC_STRAPI_URL to a valid URL (https://...).`
    );
  }
}

/**
 * Base URL for Strapi, without /api
 * and without a trailing slash.
 */
export function getStrapiBaseUrl() {
  const raw =
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_API_ORIGIN ||
    process.env.STRAPI_API_ORIGIN ||
    process.env.STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.STRAPI_API_URL ||
    "";

  const base = normalizeBase(raw);

  if (!base) {
    if (isProd()) {
      throw new Error(
        "Missing Strapi base URL in production. Set NEXT_PUBLIC_STRAPI_URL (and STRAPI_URL if needed)."
      );
    }

    return "http://127.0.0.1:1337";
  }

  assertNotLocalhost(base);

  return base;
}

/**
 * Resolve a Strapi media URL to an absolute URL.
 */
export function getStrapiMediaUrl(url) {
  if (!url) {
    return null;
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  const base = getStrapiBaseUrl();

  return (
    base +
    (url.startsWith("/") ? url : `/${url}`)
  );
}

/**
 * Given a Strapi file object, return its
 * preferred image URL.
 */
export function pickBestImageUrl(fileAttributes) {
  if (!fileAttributes) {
    return null;
  }

  const formats =
    fileAttributes.formats || {};

  return (
    formats.small?.url ||
    formats.medium?.url ||
    formats.large?.url ||
    fileAttributes.url ||
    null
  );
}

/**
 * Supports:
 * - Strapi v4: { data: [{ attributes: {...} }] }
 * - Flat media objects
 * - Arrays of media objects
 * - URL strings
 */
export function getMediaArray(relation) {
  if (!relation) {
    return [];
  }

  const value =
    relation.data ?? relation;

  const nodes = Array.isArray(value)
    ? value
    : [value];

  return nodes
    .map((node) => {
      if (typeof node === "string") {
        return node;
      }

      return pickBestImageUrl(
        node?.attributes || node
      );
    })
    .filter(Boolean)
    .map(getStrapiMediaUrl);
}

/**
 * Return the first available product image.
 */
export function getFirstGalleryImage(
  productAttributes
) {
  const product =
    productAttributes?.attributes ||
    productAttributes ||
    {};

  for (const key of [
    "gallery",
    "images",
    "image",
    "cover_image",
  ]) {
    const first = getMediaArray(
      product[key]
    )[0];

    if (first) {
      return first;
    }
  }

  return null;
}

/**
 * Build an absolute Strapi API URL
 * with exactly one /api prefix.
 */
export function getStrapiApiUrl(path = "") {
  const base = getStrapiBaseUrl();

  const normalizedPath =
    "/" +
    String(path)
      .replace(/^\/+/, "")
      .replace(/^api\//i, "");

  return `${base}/api${normalizedPath}`;
}