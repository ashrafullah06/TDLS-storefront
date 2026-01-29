//FULL FILE: my-project/middleware.js
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * GOAL: ZERO CONFUSION, COMPLETE SEPARATION
 *
 * CUSTOMER PLANE:
 *  - NextAuth JWT cookie: tdlc_c_session
 *  - Secret: CUSTOMER_AUTH_SECRET (fallback AUTH_SECRET / NEXTAUTH_SECRET)
 *  - Scope: "customer" (older tokens may have no scope; allow if not admin)
 *
 * ADMIN PLANE:
 *  - NextAuth JWT cookie: tdlc_a_session
 *  - Secret: ADMIN_AUTH_SECRET (fallback AUTH_SECRET / NEXTAUTH_SECRET)
 *  - Scope: "admin"
 *
 * IMPORTANT HARDENING:
 *  - If any admin UI code accidentally calls /api/auth/* (customer NextAuth),
 *    we REWRITE it to /api/admin/auth/* (admin NextAuth) robustly.
 *
 * NEW RULE (your request):
 *  - NEVER allow forced redirects to /admin/login?reason=logged_out...
 *    Instead, bounce back to /admin and let the dashboard show an error.
 *  - Only /api/admin/* should be blocked with JSON 401/403.
 */

const IS_PROD = process.env.NODE_ENV === "production";

// Admin-only health checks
const ADMIN_HEALTH_PATHS = ["/admin/health", "/api/admin/health"];

// Keep your asset bypasses (expanded for prod safety)
const PASS_THROUGH_PREFIXES = [
  "/_next",
  "/favicon.ico",
  "/assets",
  "/images",
  "/public",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.json",
  "/site.webmanifest",
  "/apple-touch-icon",
];

// Admin auth pages must be publicly reachable (otherwise infinite redirect loop)
const ADMIN_PUBLIC_AUTH_PATHS = [
  "/admin/login",
  "/admin/login/otp",
  "/admin/forgot-password",
  "/admin/reset-password",
  "/admin/otp",
  "/admin/signout",
];

// Customer auth pages that should remain publicly reachable
const CUSTOMER_PUBLIC_AUTH_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth/signup",
];

// Roles considered admin/staff for edge gating (ONLY used as a hint/secondary check)
const ADMIN_ROLES = new Set([
  "admin",
  "superadmin",
  "staff",
  "manager",
  "ops",
  "finance",
  "analyst",
]);

/* ───────────────────────── helpers ───────────────────────── */

function safeRedirectTarget(raw, fallback = "/") {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  if (!s.startsWith("/")) return fallback;
  if (s.startsWith("//")) return fallback;
  if (s.includes("://")) return fallback;
  if (s.includes("\n") || s.includes("\r")) return fallback;
  return s;
}

function isSafeAdminPath(p) {
  const s = String(p || "").trim();
  if (!s) return false;
  if (!s.startsWith("/admin")) return false;
  if (s.startsWith("//")) return false;
  if (s.includes("://")) return false;
  if (s.includes("\n") || s.includes("\r")) return false;
  return true;
}

function fullPathWithQuery(url) {
  return `${url.pathname}${url.search || ""}`;
}

function redirectToCustomerLogin(url, redirectTo) {
  const r = url.clone();
  r.pathname = "/login";
  r.search = `?redirect=${encodeURIComponent(
    safeRedirectTarget(redirectTo, "/customer/dashboard")
  )}`;
  return NextResponse.redirect(r);
}

function jsonError(status, payload) {
  return new NextResponse(JSON.stringify(payload || { ok: false }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      expires: "0",
      vary: "Cookie",
    },
  });
}

function jsonUnauthorized(extra = {}) {
  return jsonError(401, { ok: false, error: "UNAUTHORIZED", ...extra });
}

function jsonForbidden(extra = {}) {
  return jsonError(403, { ok: false, error: "FORBIDDEN", ...extra });
}

function isExactOrUnder(pathname, basePath) {
  if (pathname === basePath) return true;
  return pathname.startsWith(basePath + "/");
}

function refererPath(req) {
  const ref = req.headers.get("referer") || "";
  if (!ref) return "";
  try {
    return new URL(ref).pathname || "";
  } catch {
    return "";
  }
}

/**
 * IMPORTANT:
 * Referer is NOT reliable. Use cookies as primary signal, referer/query as secondary.
 */
function hasCookie(req, name) {
  return !!String(req.cookies.get(name)?.value || "").trim();
}

function adminCallbackSignal(url) {
  const cb =
    url.searchParams.get("callbackUrl") ||
    url.searchParams.get("redirect") ||
    "";
  const cbSafe = safeRedirectTarget(cb, "");
  return cbSafe.startsWith("/admin");
}

function isAdminSignal(req, url) {
  // Optional explicit signal (safe, does not change UI)
  const hdr = String(req.headers.get("x-tdlc-scope") || "").trim().toLowerCase();
  if (hdr === "admin") return true;

  // Secondary: request came from an /admin page
  const refPath = refererPath(req);
  if (refPath.startsWith("/admin")) return true;

  // Secondary: callbackUrl/redirect tries to go to /admin
  if (adminCallbackSignal(url)) return true;

  // Primary cookie signals (used as a hint; do NOT override customer plane when both exist)
  if (
    hasCookie(req, ADMIN_COOKIE) ||
    hasCookie(req, LEGACY_ADMIN_OTP_COOKIE_PRIMARY) ||
    hasCookie(req, LEGACY_ADMIN_OTP_COOKIE_ALIAS) ||
    hasCookie(req, LEGACY_ADMIN_SESSION_COOKIE_PRIMARY) ||
    hasCookie(req, LEGACY_ADMIN_SESSION_COOKIE_ALIAS) ||
    hasCookie(req, "admin_role")
  ) {
    return true;
  }

  return false;
}

function isCustomerSignal(req) {
  // Primary: customer cookie present
  return hasCookie(req, CUSTOMER_COOKIE);
}

function rewriteCustomerAuthToAdminAuth(req, url) {
  // Rewrite /api/auth/* -> /api/admin/auth/*
  const r = url.clone();
  r.pathname = String(url.pathname || "").replace(
    /^\/api\/auth\//,
    "/api/admin/auth/"
  );
  const res = NextResponse.rewrite(r);
  try {
    res.headers.set("x-tdlc-auth-rewrite", "api/auth -> api/admin/auth");
    res.headers.set("cache-control", "no-store, max-age=0");
    res.headers.set("pragma", "no-cache");
    res.headers.set("expires", "0");
    res.headers.set("vary", "Cookie");
  } catch {}
  return res;
}

function noStoreNext(extraHeaders = null) {
  const res = NextResponse.next();
  try {
    res.headers.set("cache-control", "no-store, max-age=0");
    res.headers.set("pragma", "no-cache");
    res.headers.set("expires", "0");
    res.headers.set("vary", "Cookie");
    if (extraHeaders && typeof extraHeaders === "object") {
      for (const [k, v] of Object.entries(extraHeaders)) {
        res.headers.set(k, String(v));
      }
    }
  } catch {}
  return res;
}

function noStoreRedirect(targetUrl, status = 307) {
  const res = NextResponse.redirect(targetUrl, status);
  try {
    res.headers.set("cache-control", "no-store, max-age=0");
    res.headers.set("pragma", "no-cache");
    res.headers.set("expires", "0");
    res.headers.set("vary", "Cookie");
  } catch {}
  return res;
}

/**
 * Safe helper: build absolute URL from a safe *relative* target (can include query),
 * then redirect with no-store headers.
 */
function noStoreRedirectRelative(baseUrl, relativeTarget, status = 307) {
  const rel = safeRedirectTarget(relativeTarget, "/");
  const target = new URL(rel, baseUrl.origin);
  // Preserve query in rel; do not inherit baseUrl.search.
  return noStoreRedirect(target, status);
}

/* ───────────────────────── health bypass (optional) ───────────────────────── */

function isHealthBypassed(req, url) {
  const envToken = String(process.env.HEALTH_BYPASS_TOKEN || "").trim();
  if (!envToken) return false;

  const headerToken = String(req.headers.get("x-health-token") || "").trim();
  const queryToken = String(url.searchParams.get("health_token") || "").trim();

  return headerToken === envToken || queryToken === envToken;
}

/* ───────────────────────── COOKIE / TOKEN SEPARATION ───────────────────────── */

const CUSTOMER_COOKIE = "tdlc_c_session";
const ADMIN_COOKIE = "tdlc_a_session";

// Keep parity with src/lib/auth.js fallbacks
const CUSTOMER_SECRET =
  process.env.CUSTOMER_AUTH_SECRET ||
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "";

const ADMIN_SECRET =
  process.env.ADMIN_AUTH_SECRET ||
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "";

/**
 * Legacy admin cookie fallback (for migration only)
 * Supports: otp_session_admin, admin_session, tdlc_a_otp
 * Verified using small secret-set and rejects explicit non-admin scopes
 */
const LEGACY_ADMIN_OTP_COOKIE_PRIMARY = "otp_session_admin";
const LEGACY_ADMIN_SESSION_COOKIE_PRIMARY = "admin_session";
const LEGACY_ADMIN_OTP_COOKIE_ALIAS = "tdlc_a_otp";
const LEGACY_ADMIN_SESSION_COOKIE_ALIAS = "tdlc_a_session_legacy";

function readCookie(req, name) {
  return String(req.cookies.get(name)?.value || "").trim();
}

function b64UrlToUint8(b64url) {
  const s = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  const padded =
    pad === 2 ? s + "==" : pad === 3 ? s + "=" : pad === 1 ? s + "===" : s;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ToB64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function safeJsonParseUint8(u8) {
  try {
    const txt = new TextDecoder().decode(u8);
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function constantTimeEqual(a, b) {
  const A = String(a || "");
  const B = String(b || "");
  if (A.length !== B.length) return false;
  let ok = 0;
  for (let i = 0; i < A.length; i++) ok |= A.charCodeAt(i) ^ B.charCodeAt(i);
  return ok === 0;
}

function legacyAdminSecrets() {
  // Align with your /api/admin/session logic: try a small deterministic set.
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s) out.push(s);
  };
  push(process.env.ADMIN_AUTH_SECRET);
  push(process.env.OTP_SECRET);
  push(process.env.AUTH_SECRET);
  push(process.env.NEXTAUTH_SECRET);
  push(process.env.CUSTOMER_AUTH_SECRET); // harmless; scope check will reject customer tokens
  return Array.from(new Set(out));
}

function extractLegacyScope(payload) {
  const s = String(
    payload?.scope || payload?.tdlcScope || payload?.scp || ""
  ).toLowerCase();
  return s || null;
}

function extractLegacyUid(payload) {
  const uid =
    payload?.uid ||
    payload?.userId ||
    payload?.sub ||
    payload?.user?.id ||
    payload?.adminId ||
    payload?.id ||
    null;
  const v = String(uid || "").trim();
  return v || null;
}

function extractLegacyExpMs(payload) {
  const raw =
    payload?.exp ??
    payload?.expiresAt ??
    payload?.expires ??
    payload?.expiry ??
    null;

  let expMs = Number(raw);
  if (!Number.isFinite(expMs) || expMs <= 0) return null;
  if (expMs < 1e12) expMs = expMs * 1000;
  return expMs;
}

async function verifyHs256JwtWithSecret(token, secret) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 3) return null;

  const [h, p, sig] = parts;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(String(secret || "")),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${h}.${p}`)
    );
    const computed = uint8ToB64Url(new Uint8Array(signed));
    if (!constantTimeEqual(computed, sig)) return null;
  } catch {
    return null;
  }

  const payload = safeJsonParseUint8(b64UrlToUint8(p));
  if (!payload || typeof payload !== "object") return null;
  return payload;
}

async function verifyLegacyAdminOtpJwt(tokenRaw) {
  const token = String(tokenRaw || "").trim();
  if (!token) return null;

  const secrets = legacyAdminSecrets();
  if (!secrets.length) return null;

  let payload = null;
  for (const sec of secrets) {
    // eslint-disable-next-line no-await-in-loop
    const p = await verifyHs256JwtWithSecret(token, sec);
    if (p) {
      payload = p;
      break;
    }
  }
  if (!payload) return null;

  // If scope is explicitly present, it MUST be admin. If absent, allow (legacy admin cookies only).
  const scope = extractLegacyScope(payload);
  if (scope && scope !== "admin") return null;

  const uid = extractLegacyUid(payload);
  if (!uid) return null;

  const expMs = extractLegacyExpMs(payload);
  if (!expMs) return null;
  if (Date.now() >= expMs) return null;

  // normalize for downstream usage
  payload.uid = payload.uid || uid;
  payload.scope = payload.scope || scope || "admin";
  payload.exp = payload.exp || Math.floor(expMs / 1000);

  return payload;
}

async function getTokenRobust({ req, secret, baseName }) {
  if (!secret) return null;

  const names = IS_PROD
    ? [baseName, `__Secure-${baseName}`, `__Host-${baseName}`]
    : [baseName, `__Secure-${baseName}`, `__Host-${baseName}`]; // dev: also check prefixed cookies (plane mismatch protection)

  for (const cookieName of names) {
    const tok = await getToken({
      req,
      secret,
      cookieName,
      secureCookie: IS_PROD,
    }).catch(() => null);
    if (tok) return tok;
  }
  return null;
}

async function getAdminAuth(req) {
  const roleHint = String(req.cookies.get("admin_role")?.value || "")
    .trim()
    .toLowerCase();

  const adminToken = await getTokenRobust({
    req,
    secret: ADMIN_SECRET,
    baseName: ADMIN_COOKIE,
  });

  const adminScope = String(adminToken?.scope || "").toLowerCase();
  const adminUid = String(
    adminToken?.uid || adminToken?.userId || adminToken?.sub || ""
  ).trim();

  if (adminToken && adminScope === "admin" && adminUid) {
    return {
      isAuthed: true,
      source: "admin_nextauth",
      uid: adminUid,
      token: adminToken,
      roleHint,
      hasRole: !!roleHint,
      isPotentialAdmin: true,
    };
  }

  const legacyOtp =
    readCookie(req, LEGACY_ADMIN_OTP_COOKIE_PRIMARY) ||
    readCookie(req, LEGACY_ADMIN_OTP_COOKIE_ALIAS);

  const legacySession =
    readCookie(req, LEGACY_ADMIN_SESSION_COOKIE_PRIMARY) ||
    readCookie(req, LEGACY_ADMIN_SESSION_COOKIE_ALIAS);

  const payload = legacyOtp
    ? await verifyLegacyAdminOtpJwt(legacyOtp)
    : legacySession
    ? await verifyLegacyAdminOtpJwt(legacySession)
    : null;

  const isAuthed = !!payload;

  const legacyUid = payload
    ? String(
        payload.uid ||
          payload.userId ||
          payload.sub ||
          payload.adminId ||
          payload.id ||
          ""
      ).trim()
    : "";

  return {
    isAuthed,
    source: isAuthed ? "admin_legacy" : "none",
    uid: isAuthed ? legacyUid : "",
    token: payload || null,
    roleHint,
    hasRole: !!roleHint,
    isPotentialAdmin: isAuthed || (roleHint && ADMIN_ROLES.has(roleHint)),
  };
}

async function getCustomerAuth(req) {
  const t = await getTokenRobust({
    req,
    secret: CUSTOMER_SECRET,
    baseName: CUSTOMER_COOKIE,
  });

  if (!t) return { isAuthed: false, token: null };

  const scope = String(t.scope || "").toLowerCase();
  if (scope === "admin") return { isAuthed: false, token: null };

  return { isAuthed: true, token: t };
}

function acceptsJson(req) {
  const a = String(req.headers.get("accept") || "").toLowerCase();
  return a.includes("application/json") || a.includes("+json") || a.includes("text/json");
}

function isLikelyFetch(req) {
  const dest = String(req.headers.get("sec-fetch-dest") || "").toLowerCase();
  // "document" usually indicates navigation; "empty" is common for fetch/XHR.
  if (!dest) return false;
  return dest !== "document";
}

export default async function middleware(req) {
  const url = req.nextUrl;
  const { pathname, searchParams } = url;

  // Assets / Next internals
  if (PASS_THROUGH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  /**
   * HARD STOP: If something tries to force-login with reason=logged_out,
   * do NOT let the user land on the login page.
   * Bounce back to /admin (or the safe redirect target), and attach auth_error
   * so your dashboard can show the mismatch.
   */
  if (pathname === "/admin/login" || pathname === "/admin/login/otp") {
    const reason = String(searchParams.get("reason") || "").trim();
    const redirectRaw = String(searchParams.get("redirect") || "").trim();

    if (reason === "logged_out") {
      const targetPath = isSafeAdminPath(redirectRaw) ? redirectRaw : "/admin";
      const target = new URL(targetPath, url.origin);
      target.searchParams.set("auth_error", "logged_out");
      target.searchParams.set("auth_src", "forced_login");
      target.searchParams.set("t", String(Date.now())); // anti-cache
      return noStoreRedirect(target, 307);
    }
  }

  /**
   * FIX: If Admin Health UI (or Raw JSON panel) accidentally hits /admin/health/<x>
   * expecting JSON, Next will return HTML. Rewrite ONLY when request expects JSON/fetch.
   * Keeps /admin/health page behavior unchanged.
   */
  if (pathname.startsWith("/admin/health/") && pathname !== "/admin/health") {
    if (acceptsJson(req) || isLikelyFetch(req)) {
      const r = url.clone();
      r.pathname = pathname.replace(/^\/admin\/health\//, "/api/admin/health/");
      const res = NextResponse.rewrite(r);
      try {
        res.headers.set("x-tdlc-health-rewrite", "admin_page -> api_admin_health");
        res.headers.set("cache-control", "no-store, max-age=0");
        res.headers.set("pragma", "no-cache");
        res.headers.set("expires", "0");
        res.headers.set("vary", "Cookie");
      } catch {}
      return res;
    }
  }

  // Admin NextAuth endpoints must be public
  if (pathname.startsWith("/api/admin/auth/")) {
    return noStoreNext({ "x-tdlc-auth-plane": "admin" });
  }

  /**
   * Customer NextAuth endpoints:
   * Rewrite to admin plane ONLY when admin intent exists AND no customer session cookie exists.
   * This preserves true dual-session behavior in one browser (no cross-plane theft).
   */
  if (pathname.startsWith("/api/auth/")) {
    const adminSig = isAdminSignal(req, url);
    const hasCustomerCookie = isCustomerSignal(req);
    const hdrScope = String(req.headers.get("x-tdlc-scope") || "")
      .trim()
      .toLowerCase();

    // Strong intent signals (do NOT rely only on presence of admin cookie)
    const strongAdminIntent =
      hdrScope === "admin" ||
      adminCallbackSignal(url) ||
      refererPath(req).startsWith("/admin");

    if ((strongAdminIntent || adminSig) && !hasCustomerCookie) {
      return rewriteCustomerAuthToAdminAuth(req, url);
    }

    return noStoreNext({
      "x-tdlc-auth-plane": hasCustomerCookie
        ? "customer"
        : adminSig
        ? "customer_ambiguous"
        : "customer_default",
    });
  }

  // signout normalization (customer)
  if (pathname === "/api/auth/signout" && req.method !== "POST") {
    const hasCallbackUrl = !!searchParams.get("callbackUrl");
    if (hasCallbackUrl) return noStoreNext();

    const r = url.clone();
    r.pathname = "/signout";
    r.search = "";
    return noStoreRedirect(r, 307);
  }

  // Admin auth (for API enforcement)
  const adminAuth = await getAdminAuth(req);

  // Admin public auth routes stay public
  for (const p of ADMIN_PUBLIC_AUTH_PATHS) {
    if (isExactOrUnder(pathname, p)) {
      // If already authed, redirect away from login pages (normal behavior)
      if (adminAuth.isAuthed) {
        const desired = safeRedirectTarget(searchParams.get("redirect"), "/admin");
        return noStoreRedirectRelative(url, desired, 307);
      }
      return noStoreNext();
    }
  }

  // Customer public auth routes
  if (pathname === "/auth/signup") {
    const r = url.clone();
    r.pathname = "/signup";
    r.search = "";
    return noStoreRedirect(r, 307);
  }

  const needsCustomerToken =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/auth/signup" ||
    pathname.startsWith("/customer");

  const customerAuth = needsCustomerToken
    ? await getCustomerAuth(req)
    : { isAuthed: false, token: null };

  const isCustomerAuthed = !!customerAuth.isAuthed;

  if (pathname === "/login" && isCustomerAuthed) {
    const requested = safeRedirectTarget(
      searchParams.get("redirect"),
      "/customer/dashboard"
    );
    const redirectTo = requested.startsWith("/admin")
      ? "/customer/dashboard"
      : requested;

    return noStoreRedirectRelative(url, redirectTo, 307);
  }

  if (CUSTOMER_PUBLIC_AUTH_PATHS.some((p) => isExactOrUnder(pathname, p))) {
    return noStoreNext();
  }

  // gate /admin/health & /api/admin/health
  if (ADMIN_HEALTH_PATHS.some((p) => pathname.startsWith(p))) {
    if (isHealthBypassed(req, url)) return noStoreNext();

    // UI health page: never redirect
    if (pathname.startsWith("/admin/")) return noStoreNext();

    // API health: enforce auth
    if (!adminAuth.isAuthed) {
      return jsonUnauthorized({ scope: "admin", reason: "health_admin_required" });
    }
    return noStoreNext();
  }

  // protect /customer/*
  if (pathname.startsWith("/customer")) {
    if (!isCustomerAuthed) {
      return redirectToCustomerLogin(url, fullPathWithQuery(url));
    }
  }

  /**
   * ADMIN UI: never redirect here (per your rule).
   * Always allow /admin/* pages to render and show mismatch in UI.
   */
  if (pathname.startsWith("/admin")) {
    const res = noStoreNext({
      "x-tdlc-auth-plane": "admin_ui",
      "x-tdlc-admin-auth": adminAuth.isAuthed ? "ok" : "missing",
      "x-tdlc-admin-auth-reason": adminAuth.isAuthed ? "ok" : "not_signed_in",
      "x-tdlc-admin-auth-src": adminAuth.source || "unknown",
    });
    return res;
  }

  // protect /api/admin/*
  if (pathname.startsWith("/api/admin")) {
    // Allow explicit logout handler if you have one
    if (pathname === "/api/admin/logout") return noStoreNext();

    /**
     * FIX: /api/admin/session must be callable even when not authenticated.
     * It reports admin session state (authenticated true/false) and is admin-plane only.
     */
    if (pathname === "/api/admin/session") {
      return noStoreNext({ "x-tdlc-auth-plane": "admin_session" });
    }

    if (!adminAuth.isAuthed) {
      return jsonUnauthorized({ scope: "admin", reason: "not_signed_in" });
    }

    // Optional: role hint check (never authenticates by itself)
    if (
      adminAuth.hasRole &&
      adminAuth.roleHint &&
      !ADMIN_ROLES.has(adminAuth.roleHint)
    ) {
      return jsonForbidden({ scope: "admin", reason: "role_hint_not_allowed" });
    }

    return noStoreNext({ "x-tdlc-auth-plane": "admin_api" });
  }

  return noStoreNext();
}

export const config = {
  matcher: [
    "/login",
    "/signup",
    "/auth/signup",
    "/forgot-password",
    "/reset-password",

    "/customer/:path*",

    "/admin/:path*",
    "/api/admin/:path*",

    "/api/auth/:path*",
  ],
};
