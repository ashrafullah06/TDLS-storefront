// FILE: src/lib/cookies.js

/**
 * Shared cookie helpers for TDLC.
 *
 * - Server side: use getServerCookie / setServerCookie
 * - Client side: use getClientCookie / setClientCookie
 */

export const PRIMARY_CART_COOKIE = "cart_session_id";
export const CART_COOKIE_ALIASES = ["tdlc_sid"];

/* ---------------- internal helpers ---------------- */

function parseCookieHeader(header) {
  if (!header || typeof header !== "string") return {};
  const out = {};
  const parts = header.split(";");

  for (const part of parts) {
    const [rawName, ...rest] = part.split("=");
    if (!rawName) continue;
    const name = rawName.trim();
    if (!name) continue;
    const value = rest.join("=").trim();
    out[name] = decodeURIComponent(value || "");
  }

  return out;
}

/**
 * RFC6265-ish cookie serializer (enough for our use-cases).
 */
export function serializeCookie(name, value, options = {}) {
  const opts = options || {};
  const enc = encodeURIComponent;

  let cookie = `${name}=${enc(value)}`;

  if (opts.maxAge != null) cookie += `; Max-Age=${opts.maxAge | 0}`;
  if (opts.domain) cookie += `; Domain=${opts.domain}`;
  if (opts.path) cookie += `; Path=${opts.path}`;
  if (opts.expires instanceof Date) cookie += `; Expires=${opts.expires.toUTCString()}`;
  if (opts.httpOnly) cookie += `; HttpOnly`;
  if (opts.secure) cookie += `; Secure`;
  if (opts.sameSite) {
    const s = opts.sameSite;
    if (s === "strict" || s === "lax" || s === "none") {
      cookie += `; SameSite=${s[0].toUpperCase()}${s.slice(1).toLowerCase()}`;
    }
  }

  return cookie;
}

/* ---------------- server-side helpers ---------------- */

/**
 * Read a cookie from a Next.js Request-like object
 * (anything that has headers.get("cookie")).
 */
export function getServerCookie(reqOrHeaders, name) {
  try {
    const headers =
      reqOrHeaders instanceof Headers ? reqOrHeaders : reqOrHeaders?.headers;
    const raw = headers?.get("cookie") || "";
    const parsed = parseCookieHeader(raw);
    return parsed[name] ?? null;
  } catch {
    return null;
  }
}

/**
 * Append a Set-Cookie header to a Headers instance.
 */
export function setServerCookie(headers, name, value, options = {}) {
  if (!(headers instanceof Headers)) {
    throw new Error("setServerCookie expects a Headers instance");
  }
  const cookie = serializeCookie(name, value, options);
  headers.append("set-cookie", cookie);
}

/* ---------------- client-side helpers ---------------- */

export function getClientCookie(name) {
  if (typeof document === "undefined") return null;
  const parsed = parseCookieHeader(document.cookie || "");
  return parsed[name] ?? null;
}

export function setClientCookie(name, value, options = {}) {
  if (typeof document === "undefined") return;
  const cookie = serializeCookie(name, value, options);
  document.cookie = cookie;
}

/**
 * Resolve a TDLC cart session id (client-side only).
 * - Prefer PRIMARY_CART_COOKIE
 * - Fallback to CART_COOKIE_ALIASES
 */
export function resolveClientCartSessionId() {
  const primary = getClientCookie(PRIMARY_CART_COOKIE);
  if (primary) return primary;
  for (const alias of CART_COOKIE_ALIASES) {
    const v = getClientCookie(alias);
    if (v) return v;
  }
  return null;
}
