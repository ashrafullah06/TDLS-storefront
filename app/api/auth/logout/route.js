// FILE: app/api/auth/logout/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "origin, cookie",
      // bump version so you can confirm deploy behavior quickly
      "x-tdlc-customer-logout": "v4", // <- bumped
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

function safeHostFromRequestUrl(requestUrl) {
  const u = safeUrl(requestUrl);
  return u?.hostname || "";
}

/**
 * Same-site origin validation (apex <-> www safe)
 * - Blocks foreign origins
 * - Allows:
 *   - exact origin match
 *   - www <-> apex swap
 *   - same registrable domain (best-effort, last-2 labels)
 */
function isAllowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // server-to-server / same-origin navigation may omit Origin

  const reqUrl = safeUrl(request.url);
  const oriUrl = safeUrl(origin);
  if (!reqUrl || !oriUrl) return false;

  // Exact match
  if (oriUrl.origin === reqUrl.origin) return true;

  const reqHost = String(reqUrl.hostname || "").toLowerCase();
  const oriHost = String(oriUrl.hostname || "").toLowerCase();

  // localhost/dev tolerance
  if (reqHost === "localhost" || oriHost === "localhost") return true;

  // www swap tolerance
  const stripWww = (h) => (h.startsWith("www.") ? h.slice(4) : h);
  if (stripWww(reqHost) === stripWww(oriHost)) return true;

  // registrable-domain best-effort (last 2 labels; acceptable for your domain)
  const last2 = (h) => h.split(".").filter(Boolean).slice(-2).join(".");
  if (last2(reqHost) && last2(reqHost) === last2(oriHost)) return true;

  return false;
}

function candidateDomains(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return [null];

  const out = [null, host];

  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 2) {
    const apex = parts.slice(-2).join(".");
    out.push(apex);
    out.push(`.${apex}`);
  }

  out.push(`.${host}`);
  return Array.from(new Set(out));
}

/**
 * Expand cookie names to also clear chunked variants.
 * NextAuth/Auth.js may set:
 * - authjs.session-token
 * - authjs.session-token.0 / .1 / ...
 */
function expandChunkedNames(name, maxChunks = 16) {
  const n = String(name || "").trim();
  if (!n) return [];
  const out = [n];
  for (let i = 0; i < maxChunks; i++) out.push(`${n}.${i}`);
  return out;
}

function expireCookieMatrix(response, name, hostname) {
  const domains = candidateDomains(hostname);

  /**
   * CRITICAL:
   * Auth.js/NextAuth can scope cookies to /api/auth.
   * If we don't also expire on /api/auth, manual logout may "bounce back".
   *
   * Customer paths only (NO /admin, NO /api/admin).
   */
  const paths = ["/", "/api", "/api/auth", "/customer"];

  // Important: to reliably delete Secure/HttpOnly cookies, match common variants.
  const secures = [true, false];
  const httpOnlys = [true, false];
  const sameSites = ["lax", "strict", "none"];

  for (const path of paths) {
    for (const secure of secures) {
      for (const httpOnly of httpOnlys) {
        for (const sameSite of sameSites) {
          for (const domain of domains) {
            const base = {
              name,
              value: "",
              path,
              maxAge: 0,
              secure,
              httpOnly,
              sameSite,
            };
            if (!domain) response.cookies.set(base);
            else response.cookies.set({ ...base, domain });
          }
        }
      }
    }
  }
}

/**
 * Mirror the customer cookie default logic used in src/lib/auth.js
 * - prod: __Secure-authjs.session-token
 * - dev : authjs.session-token
 * - override: CUSTOMER_AUTH_COOKIE_NAME wins
 */
function effectiveCustomerSessionCookieName() {
  const explicit = String(process.env.CUSTOMER_AUTH_COOKIE_NAME || "").trim();
  if (explicit) return explicit;

  const isProd = process.env.NODE_ENV === "production";
  return isProd ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export async function POST(request) {
  if (!isAllowedOrigin(request)) {
    return json({ ok: false, error: "FORBIDDEN_ORIGIN" }, 403);
  }

  const host = safeHostFromRequestUrl(request.url);
  const res = json({ ok: true, cleared: true });

  /**
   * Customer auth cookies only.
   * - Clear Auth.js/NextAuth defaults
   * - Clear TDLS/TDLC customer-plane custom cookies (tdlc_c_*)
   * - Clear effective session cookie name + legacy tdlc_c_session
   */
  const customerAuthCookies = [
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

    // Customer-plane custom cookies used in your auth.js
    "tdlc_c_csrf",
    "tdlc_c_callback",
    "tdlc_c_pkce",
    "tdlc_c_state",
    "tdlc_c_nonce",

    // Legacy / older customer session cookie name
    "tdlc_c_session",
  ];

  // Also clear the effective cookie name (covers override + current default)
  const effective = effectiveCustomerSessionCookieName();
  if (effective) customerAuthCookies.push(effective);

  // De-dup base names
  const baseUniq = Array.from(new Set(customerAuthCookies.map(String).filter(Boolean)));

  // Expand chunked names (base + .0..)
  const namesToClear = new Set();
  for (const n of baseUniq) {
    for (const x of expandChunkedNames(n, 16)) namesToClear.add(x);
  }

  for (const name of namesToClear) {
    expireCookieMatrix(res, name, host);
  }

  return res;
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
