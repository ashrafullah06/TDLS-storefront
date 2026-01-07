// FILE: src/lib/strapimedia.js

function isProd() {
  return process.env.NODE_ENV === "production";
}

function normalizeBase(raw) {
  let b = (raw || "").trim();
  if (!b) return "";

  // Add scheme if missing
  if (!/^https?:\/\//i.test(b)) {
    b = `${isProd() ? "https" : "http"}://${b}`;
  }

  // Prefer IPv4 localhost in dev
  b = b.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");

  // Strip trailing slash and a trailing "/api" if provided
  b = b.replace(/\/+$/, "").replace(/\/api$/, "");

  return b;
}

function assertNotLocalhost(base) {
  if (!isProd()) return;
  try {
    const h = new URL(base).hostname;
    const isLocal =
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".local");
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

/** Base URL for Strapi, without /api and without trailing slash. */
export function getStrapiBaseUrl() {
  const raw =
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    process.env.STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.STRAPI_API_URL ||
    "";

  const base = normalizeBase(raw);

  if (!base) {
    // Dev fallback only; production must be explicit.
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

/** Resolve any Strapi media URL to an absolute URL. */
export function getStrapiMediaUrl(url) {
  if (!url) return null;
  // If already absolute, return as-is.
  if (/^https?:\/\//i.test(url)) return url;
  // Else prefix with Strapi base.
  const base = getStrapiBaseUrl();
  return base + (url.startsWith("/") ? url : `/${url}`);
}

/** Given a Strapi file object (attributes), return best-fit URL. */
export function pickBestImageUrl(fileAttr) {
  if (!fileAttr) return null;
  const fmts = fileAttr.formats || {};
  // Prefer small > medium > large (or whatever exists) then original url.
  return (
    fmts.small?.url ||
    fmts.medium?.url ||
    fmts.large?.url ||
    fileAttr.url ||
    null
  );
}

/** Return an array of absolute URLs from a relation like { data: [...] }. */
export function getMediaArray(rel) {
  if (!rel || !rel.data) return [];
  const arr = Array.isArray(rel.data) ? rel.data : [rel.data];
  return arr
    .map((n) => pickBestImageUrl(n?.attributes) || n?.attributes?.url || null)
    .filter(Boolean)
    .map(getStrapiMediaUrl);
}

/** Convenience: get first image URL from a product’s gallery. */
export function getFirstGalleryImage(productAttributes) {
  const items = getMediaArray(productAttributes?.gallery);
  return items.length ? items[0] : null;
}

/** Build an absolute Strapi API URL safely (always includes /api). */
export function getStrapiApiUrl(path = "") {
  const base = getStrapiBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}/api${p}`;
}
