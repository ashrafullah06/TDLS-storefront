// FILE: app/api/auth/logout/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

/**
 * Customer-only logout:
 * - Clears customer-plane cookies deterministically (minimal Set-Cookie, no header explosions)
 * - Supports fetch(JSON) AND standards form POST (redirect via callbackUrl when Accept: text/html)
 * - Does NOT touch admin-plane cookies/routes
 */

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "origin, cookie",
      "x-tdlc-customer-logout": "v5", // bumped (was v4)
    },
  });
}

function safeUrl(u) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function hostFromHeaders(request) {
  // Prefer forwarded host (Vercel/CF), then Host, then request.url
  const xf = request.headers.get("x-forwarded-host");
  const hostHeader = (xf ? xf.split(",")[0].trim() : request.headers.get("host")) || "";
  const host = String(hostHeader).split(":")[0].trim();
  if (host) return host.toLowerCase();

  const u = safeUrl(request.url);
  return (u?.hostname || "").toLowerCase();
}

// last-2 labels best-effort (good for your domain)
function apexFromHost(host) {
  const parts = String(host || "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(-2).join(".");
}

/**
 * Same-site origin validation (apex <-> www safe)
 * - Blocks foreign origins
 * - Allows:
 *   - exact origin match
 *   - www <-> apex swap
 *   - same registrable domain (last-2 labels)
 */
function isAllowedOrigin(request, host) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const oriUrl = safeUrl(origin);
  if (!oriUrl) return false;

  const oriHost = String(oriUrl.hostname || "").toLowerCase();
  const reqHost = String(host || "").toLowerCase();

  if (!oriHost || !reqHost) return false;
  if (oriHost === reqHost) return true;

  const stripWww = (h) => (h.startsWith("www.") ? h.slice(4) : h);
  if (stripWww(oriHost) === stripWww(reqHost)) return true;

  const last2 = (h) => h.split(".").filter(Boolean).slice(-2).join(".");
  return last2(oriHost) && last2(oriHost) === last2(reqHost);
}

function looksLikeHtmlRequest(request) {
  const accept = (request.headers.get("accept") || "").toLowerCase();
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  return accept.includes("text/html") || ct.includes("application/x-www-form-urlencoded");
}

async function readCallbackUrl(request) {
  // Try form first (works for form-encoded and multipart). If it throws, try JSON.
  try {
    const fd = await request.formData();
    const cb = fd.get("callbackUrl") || fd.get("redirectTo");
    if (typeof cb === "string" && cb.trim()) return cb.trim();
  } catch {}

  try {
    const j = await request.json();
    const cb = j?.callbackUrl || j?.redirectTo;
    if (typeof cb === "string" && cb.trim()) return cb.trim();
  } catch {}

  return "";
}

function normalizeCallbackUrl(raw, requestUrl, host) {
  const v = String(raw || "").trim();
  if (!v) return null;

  // allow relative paths
  if (v.startsWith("/")) {
    try {
      return new URL(v, requestUrl);
    } catch {
      return null;
    }
  }

  // allow absolute ONLY if same-site (host/apex)
  const u = safeUrl(v);
  if (!u) return null;

  const targetHost = String(u.hostname || "").toLowerCase();
  const reqHost = String(host || "").toLowerCase();

  const stripWww = (h) => (h.startsWith("www.") ? h.slice(4) : h);
  if (stripWww(targetHost) === stripWww(reqHost)) return u;

  const last2 = (h) => h.split(".").filter(Boolean).slice(-2).join(".");
  if (last2(targetHost) && last2(targetHost) === last2(reqHost)) return u;

  return null;
}

/**
 * Expand chunked names only where it matters (session-token cookies).
 * Keeps Set-Cookie header size under control in production.
 */
function expandSessionTokenChunks(name, maxChunks = 8) {
  const n = String(name || "").trim();
  if (!n) return [];
  const out = [n];
  if (!n.includes("session-token")) return out;
  for (let i = 0; i < maxChunks; i++) out.push(`${n}.${i}`);
  return out;
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function pathsForCookie(name) {
  const n = String(name || "");
  // Auth.js/NextAuth commonly scopes some cookies to /api/auth
  if (n.includes("next-auth") || n.includes("authjs")) return ["/", "/api/auth"];
  // Customer custom cookies may appear on these paths
  if (n.startsWith("tdlc_") || n.startsWith("tdls_")) return ["/", "/api", "/api/auth", "/customer"];
  return ["/"];
}

function domainsForCookie(host, apex, name) {
  const n = String(name || "");
  // __Host- cookies MUST NOT have Domain and MUST be Path=/
  if (n.startsWith("__Host-")) return [undefined];

  const out = [undefined];
  if (host) out.push(host);
  if (apex) out.push(apex);
  return unique(out);
}

function mustBeSecure(name) {
  const n = String(name || "");
  if (n.startsWith("__Secure-") || n.startsWith("__Host-")) return true;
  return process.env.NODE_ENV === "production";
}

function expireCookie(res, { name, domain, path, secure }) {
  // Deterministic expiry: domain+path define the cookie identity.
  // Other attributes are not part of cookie matching; keep minimal to avoid header bloat.
  res.cookies.set({
    name,
    value: "",
    path,
    domain,
    secure,
    httpOnly: true,
    sameSite: "lax",
    expires: new Date(0),
    maxAge: 0,
  });
}

function clearCustomerCookies(res, host) {
  const apex = apexFromHost(host);

  // Clear BOTH naming families (TDLC + TDLS) plus NextAuth/Auth.js defaults
  const baseNames = [
    // NextAuth classic
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
    "__Host-next-auth.session-token",
    "next-auth.csrf-token",
    "__Secure-next-auth.csrf-token",
    "__Host-next-auth.csrf-token",
    "next-auth.callback-url",
    "__Secure-next-auth.callback-url",
    "__Host-next-auth.callback-url",

    // Auth.js newer
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "__Host-authjs.session-token",
    "authjs.csrf-token",
    "__Secure-authjs.csrf-token",
    "__Host-authjs.csrf-token",
    "authjs.callback-url",
    "__Secure-authjs.callback-url",
    "__Host-authjs.callback-url",

    // Customer-plane custom cookies (TDLC + TDLS)
    "tdlc_c_csrf",
    "tdlc_c_callback",
    "tdlc_c_pkce",
    "tdlc_c_state",
    "tdlc_c_nonce",
    "tdlc_c_session",

    "tdls_c_csrf",
    "tdls_c_callback",
    "tdls_c_pkce",
    "tdls_c_state",
    "tdls_c_nonce",
    "tdls_c_session",
  ];

  const names = [];
  for (const n of unique(baseNames.map(String))) {
    for (const x of expandSessionTokenChunks(n, 8)) names.push(x);
  }

  const finalNames = unique(names);

  for (const name of finalNames) {
    const secure = mustBeSecure(name);

    // __Host- rule: Path MUST be "/" only
    const paths = name.startsWith("__Host-") ? ["/"] : pathsForCookie(name);
    const domains = domainsForCookie(host, apex, name);

    for (const path of paths) {
      for (const domain of domains) {
        expireCookie(res, { name, domain, path, secure });
      }
    }
  }
}

export async function POST(request) {
  const host = hostFromHeaders(request);

  if (!isAllowedOrigin(request, host)) {
    return json({ ok: false, error: "FORBIDDEN_ORIGIN" }, 403);
  }

  const rawCb = await readCallbackUrl(request);
  const cb = normalizeCallbackUrl(rawCb, request.url, host);

  const html = looksLikeHtmlRequest(request);

  // If form/HTML request and callbackUrl exists -> redirect after clearing cookies
  let res;
  if (html && cb) {
    res = NextResponse.redirect(cb, { status: 303 });
    res.headers.set("cache-control", "no-store");
    res.headers.set("x-tdlc-customer-logout", "v5");
    res.headers.append("vary", "origin, cookie");
  } else {
    res = json({ ok: true, cleared: true, redirectTo: cb ? cb.toString() : null }, 200);
  }

  clearCustomerCookies(res, host);
  return res;
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
