// PATH: app/api/admin/logout/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

/**
 * Admin Logout (Server-side hard cleanup) — ADMIN PLANE ONLY
 *
 * Goals:
 * - Clear ONLY admin-plane cookies (tdlc_a_* and admin-only flags)
 * - Avoid Set-Cookie header explosion (no combinatorial deletion)
 * - Never touch customer cookies
 *
 * Notes:
 * - For cookie deletion, name + path + domain are what matter.
 * - We clear on a small set of plausible paths and domains.
 */

const NO_STORE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
  vary: "origin, cookie",
  "x-tdlc-logout": "admin-only",
};

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function isSameOrigin(request) {
  // Same-origin enforcement for browser contexts; allow missing Origin for same-site fetches.
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const reqOrigin = new URL(request.url).origin;
    return origin === reqOrigin;
  } catch {
    return false;
  }
}

function getHost(request) {
  // Prefer Host header (works behind proxies); fallback to request.url
  const h = request.headers.get("host");
  if (h) return String(h).split(":")[0].trim().toLowerCase();
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getApexDomain(host) {
  const parts = String(host || "")
    .toLowerCase()
    .split(".")
    .filter(Boolean);

  if (parts.length < 2) return "";
  return parts.slice(-2).join(".");
}

function cookieNameVariants(name) {
  const n = String(name || "").trim();
  if (!n) return [];
  // Clear raw + __Secure- + __Host- variants (common in prod).
  return Array.from(new Set([n, `__Secure-${n}`, `__Host-${n}`]));
}

function clearCookie(res, name, { path = "/", domain = undefined, secure = undefined } = {}) {
  // For deletion, maxAge: 0 is enough; value can be empty.
  // For __Host- cookies: must be Secure + path="/" + no Domain. We satisfy that when secure=true and domain is undefined.
  const opts = {
    name,
    value: "",
    path,
    maxAge: 0,
    sameSite: "lax",
  };

  if (domain) opts.domain = domain;

  // Use secure=true for __Secure- / __Host- deletions; safe to set secure in prod.
  if (typeof secure === "boolean") opts.secure = secure;

  // httpOnly is not required to delete, but setting it true is safe for auth cookies.
  // It also avoids accidentally reintroducing a non-httpOnly cookie in some edge clients.
  opts.httpOnly = true;

  res.cookies.set(opts);
}

function clearAdminCookieEverywhere(res, baseName, host) {
  const isProd = process.env.NODE_ENV === "production";

  const apex = getApexDomain(host);
  // Domain candidates:
  // - host-only (no domain attribute)
  // - apex and .apex (covers subdomains)
  const domains = [];
  if (apex) {
    domains.push(apex);
    domains.push(`.${apex}`);
  }

  // Paths where admin cookies may be scoped
  const paths = ["/", "/admin", "/api/admin", "/api/admin/auth"];

  for (const variant of cookieNameVariants(baseName)) {
    const isHostPrefixed = variant.startsWith("__Host-");
    const isSecurePrefixed = variant.startsWith("__Secure-") || isHostPrefixed;

    // FIX: In local dev (http), do NOT force Secure deletions unless cookie is explicitly __Secure/__Host.
    // For __Secure- / __Host- variants we MUST set Secure=true to delete them properly.
    const secure = isSecurePrefixed ? true : isProd;

    // 1) Clear host-only (no domain attribute)
    for (const path of paths) {
      // __Host- cookies MUST use path "/"
      if (isHostPrefixed && path !== "/") continue;
      clearCookie(res, variant, { path, secure });
    }

    // 2) Clear domain-scoped (only for non-__Host cookies)
    if (!isHostPrefixed) {
      for (const domain of domains) {
        for (const path of paths) {
          clearCookie(res, variant, { path, domain, secure });
        }
      }
    }
  }
}

function expireAllAdminCookies(res, host) {
  // ADMIN-ONLY cookie names (keep specific; avoid generic names that might exist in customer plane)
  const adminCookieBaseNames = [
    // Admin Auth.js / NextAuth cookie profile (your intended names)
    "tdlc_a_session",
    "tdlc_a_csrf",
    "tdlc_a_callback",
    "tdlc_a_pkce",
    "tdlc_a_state",
    "tdlc_a_nonce",

    // Admin OTP/session cookies
    "otp_session_admin",
    "admin_session",
    "admin_token",
    "admin_otp",

    // RBAC step-up flags
    "rbac_login",
    "rbac_verified",
    "elevated_admin",

    // Admin role hint (non-authoritative)
    "admin_role",
  ];

  for (const name of adminCookieBaseNames) {
    clearAdminCookieEverywhere(res, name, host);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      allow: "GET, POST, OPTIONS",
    },
  });
}

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return json({ ok: false, error: "FORBIDDEN_ORIGIN" }, 403);
  }

  const host = getHost(request);
  const res = json({ ok: true, cleared: true, scope: "admin" }, 200);

  expireAllAdminCookies(res, host);
  return res;
}

export async function GET(request) {
  if (!isSameOrigin(request)) {
    return json({ ok: false, error: "FORBIDDEN_ORIGIN" }, 403);
  }

  const host = getHost(request);
  const res = json({ ok: true, cleared: true, scope: "admin" }, 200);

  expireAllAdminCookies(res, host);
  return res;
}
