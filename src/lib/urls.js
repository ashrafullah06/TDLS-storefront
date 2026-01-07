// PATH: src/lib/urls.js
// Safe helpers to build absolute URLs when possible, otherwise return relative.

export function getOriginFromRequest(req) {
  try {
    const url = req?.url ? new URL(req.url) : null;
    if (url) return `${url.protocol}//${url.host}`;
  } catch {}
  return null;
}

export function getOriginFromHeaders(headersLike) {
  try {
    const h = typeof headersLike?.get === "function" ? headersLike : null;
    if (!h) return null;
    const xfProto = h.get("x-forwarded-proto");
    const xfHost  = h.get("x-forwarded-host") || h.get("host");
    if (xfProto && xfHost) return `${xfProto}://${xfHost}`;
  } catch {}
  return null;
}

/**
 * If `origin` or NEXT_PUBLIC_SITE_URL is available, returns absolute URL.
 * Otherwise, returns a safe relative path so it never throws on server.
 */
export function absoluteUrl(origin, path = "") {
  const cleanPath = String(path || "").replace(/^\/*/, "/");
  const base = (origin || process.env.NEXT_PUBLIC_SITE_URL || "").replace?.(/\/+$/,"") || "";
  if (!base) return cleanPath; // fallback to relative
  return `${base}${cleanPath}`;
}
