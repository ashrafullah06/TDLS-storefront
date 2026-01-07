// FILE: my-project/app/api/admin/auth/[...nextauth]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin Auth Router (Auth.js / NextAuth) — FULL SEPARATION (ENFORCED)
 *
 * This route mounts ONLY the admin-plane auth handlers.
 * Source of truth: src/lib/auth.js must export `adminHandlers` { GET, POST }.
 *
 * HARD GUARANTEE:
 * - This wrapper FAILS if handlers attempt to set any non-admin cookie names
 *   (prevents accidental coupling with customer auth plane).
 *
 * Admin cookie policy: only `tdlc_a_*` (and secure variants __Secure-/__Host-).
 */

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

let _handlersPromise = null;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function jsonNoStore(body, status = 500, extraHeaders = {}) {
  return NextResponse.json(body ?? null, {
    status,
    headers: { ...NO_STORE_HEADERS, ...extraHeaders },
  });
}

function assertAdminPath(req) {
  const p =
    (req?.nextUrl && String(req.nextUrl.pathname || "")) ||
    String(new URL(req.url).pathname || "");

  if (!p.startsWith("/api/admin/auth/")) {
    const err = new Error("INVALID_ADMIN_AUTH_PATH");
    err.status = 400;
    throw err;
  }
}

/**
 * Admin cookie allow-list:
 * - Your dedicated admin cookies: tdlc_a_*
 * - plus secure cookie prefixes (__Secure- / __Host-) for those same names
 *
 * IMPORTANT: This does NOT allow default authjs/next-auth cookies.
 * If your adminHandlers is still using default cookies, fix it in src/lib/auth.js.
 */
function isAllowedAdminCookieName(name) {
  const n = String(name || "");
  if (!n) return false;

  // Strip secure prefixes for checking base name
  const base = n.startsWith("__Secure-")
    ? n.slice("__Secure-".length)
    : n.startsWith("__Host-")
    ? n.slice("__Host-".length)
    : n;

  return base.startsWith("tdlc_a_");
}

/**
 * Extract cookie-name from a Set-Cookie header value.
 */
function cookieNameFromSetCookie(sc) {
  const s = String(sc || "");
  const eq = s.indexOf("=");
  if (eq <= 0) return "";
  return s.slice(0, eq).trim();
}

/**
 * Get array of Set-Cookie strings from a Response/NextResponse headers.
 * Next.js can expose headers.getSetCookie() (preferred).
 */
function getSetCookieArray(res) {
  try {
    if (!res?.headers) return [];
    if (typeof res.headers.getSetCookie === "function") {
      const arr = res.headers.getSetCookie();
      return Array.isArray(arr) ? arr : [];
    }
    const single = res.headers.get("set-cookie");
    if (!single) return [];
    // Fallback: best-effort. (Auth.js typically emits separate Set-Cookie headers;
    // getSetCookie() should exist in Node runtime.)
    return [single];
  } catch {
    return [];
  }
}

function enforceAdminCookiePolicy(res, requestId) {
  const setCookies = getSetCookieArray(res);
  if (!setCookies.length) return res;

  const offending = [];
  const allowed = [];

  for (const sc of setCookies) {
    const name = cookieNameFromSetCookie(sc);
    if (!name) continue;

    if (isAllowedAdminCookieName(name)) allowed.push(sc);
    else offending.push(name);
  }

  if (offending.length) {
    const err = new Error(
      `ADMIN_COOKIE_POLICY_VIOLATION: handlers attempted to set non-admin cookies: ${offending.join(
        ", "
      )}`
    );
    err.status = 500;
    err.offending = offending;
    err.requestId = requestId;
    throw err;
  }

  // If we reached here: all cookies are allowed.
  return res;
}

async function resolveAdminHandlers() {
  if (_handlersPromise) return _handlersPromise;

  _handlersPromise = (async () => {
    const mod = await import("@/lib/auth");

    const admin =
      mod.adminHandlers ||
      mod.handlersAdmin ||
      mod.adminAuthHandlers ||
      mod.admin_auth_handlers ||
      null;

    if (!admin?.GET || !admin?.POST) {
      const err = new Error(
        "Admin auth handlers not found. Ensure src/lib/auth.js exports { adminHandlers: { GET, POST } }."
      );
      err.status = 500;
      throw err;
    }

    return admin;
  })();

  return _handlersPromise;
}

function stampNoStore(res, requestId) {
  try {
    res?.headers?.set?.("Cache-Control", NO_STORE_HEADERS["Cache-Control"]);
    res?.headers?.set?.("Pragma", NO_STORE_HEADERS.Pragma);
    res?.headers?.set?.("Expires", NO_STORE_HEADERS.Expires);
    res?.headers?.set?.("Vary", NO_STORE_HEADERS.Vary);

    // Debug + enforcement markers
    res?.headers?.set?.("X-Admin-Auth-Scope", "admin");
    res?.headers?.set?.("X-Admin-Cookie-Policy", "tdlc_a_only");
    res?.headers?.set?.("X-Request-Id", requestId);

    // Prevent caching by intermediaries + prevent indexing
    res?.headers?.set?.("X-Robots-Tag", "noindex, nofollow, noarchive");
  } catch {
    // ignore
  }
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...NO_STORE_HEADERS,
      Allow: "GET, POST, OPTIONS",
      "X-Admin-Auth-Scope": "admin",
      "X-Admin-Cookie-Policy": "tdlc_a_only",
    },
  });
}

export async function GET(req) {
  const requestId = randomUUID();
  try {
    assertAdminPath(req);

    const handlers = await resolveAdminHandlers();
    const res = await handlers.GET(req);

    // ✅ hard separation: admin cookies only
    enforceAdminCookiePolicy(res, requestId);

    return stampNoStore(res, requestId);
  } catch (e) {
    const status = Number(e?.status) || 500;
    const msg = String(e?.message || "ADMIN_AUTH_GET_FAILED");

    console.error("[api/admin/auth][GET]", {
      requestId,
      status,
      msg,
      offendingCookies: e?.offending || null,
    });

    return jsonNoStore(
      {
        ok: false,
        scope: "admin",
        requestId,
        error: status === 400 ? "BAD_REQUEST" : "ADMIN_AUTH_FAILED",
        message: msg,
        offendingCookies: e?.offending || undefined,
      },
      status,
      {
        "X-Admin-Auth-Scope": "admin",
        "X-Admin-Cookie-Policy": "tdlc_a_only",
        "X-Request-Id": requestId,
      }
    );
  }
}

export async function POST(req) {
  const requestId = randomUUID();
  try {
    assertAdminPath(req);

    const handlers = await resolveAdminHandlers();
    const res = await handlers.POST(req);

    // ✅ hard separation: admin cookies only
    enforceAdminCookiePolicy(res, requestId);

    return stampNoStore(res, requestId);
  } catch (e) {
    const status = Number(e?.status) || 500;
    const msg = String(e?.message || "ADMIN_AUTH_POST_FAILED");

    console.error("[api/admin/auth][POST]", {
      requestId,
      status,
      msg,
      offendingCookies: e?.offending || null,
    });

    return jsonNoStore(
      {
        ok: false,
        scope: "admin",
        requestId,
        error: status === 400 ? "BAD_REQUEST" : "ADMIN_AUTH_FAILED",
        message: msg,
        offendingCookies: e?.offending || undefined,
      },
      status,
      {
        "X-Admin-Auth-Scope": "admin",
        "X-Admin-Cookie-Policy": "tdlc_a_only",
        "X-Request-Id": requestId,
      }
    );
  }
}
