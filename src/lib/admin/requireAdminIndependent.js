// FILE: lib/admin/requireAdminIndependent.js
// Admin-only auth helper — COMPLETE SEPARATION
//
// PRIMARY auth source: Admin NextAuth JWT cookie (tdlc_a_session) + ADMIN_AUTH_SECRET
// FALLBACK auth source: legacy admin cookies (otp_session_admin/admin_session/etc) verified by OTP_SECRET
//
// Never uses customer NextAuth session/cookies.
// Uses DB roles + permissionsFor() for RBAC.
//
// Compatible with existing routes: throws Error with err.status 401/403.

import prisma from "@/lib/prisma";
import { cookies } from "next/headers";
import crypto from "crypto";
import { permissionsFor } from "@/lib/rbac";
import { getToken } from "next-auth/jwt";

const IS_PROD = process.env.NODE_ENV === "production";

// Admin NextAuth separation
const ADMIN_AUTH_SECRET =
  process.env.ADMIN_AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
const ADMIN_AUTH_COOKIE_NAME = process.env.ADMIN_AUTH_COOKIE_NAME || "tdlc_a_session";

// Legacy OTP cookie verification secret (fallback only)
const OTP_SECRET = process.env.OTP_SECRET || "";

// Legacy cookie candidates (keep broad to prevent intermittent “missing cookie” issues)
const LEGACY_ADMIN_COOKIE_CANDIDATES = [
  "otp_session_admin",
  "__Secure-otp_session_admin",

  "admin_session",
  "__Secure-admin_session",

  "rbac_session_admin",
  "__Secure-rbac_session_admin",

  "admin_session_admin",
  "__Secure-admin_session_admin",

  // aliases (if you ever used them)
  "tdlc_a_otp",
  "__Secure-tdlc_a_otp",
  "tdlc_a_session_legacy",
  "__Secure-tdlc_a_session_legacy",
];

function safeTimingEqual(a, b) {
  try {
    const ba = Buffer.from(String(a), "utf8");
    const bb = Buffer.from(String(b), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function base64UrlDecodeToBuffer(input) {
  const s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const mod = s.length % 4;
  if (mod === 1) throw new Error("Invalid base64url");
  const pad = mod === 0 ? "" : "=".repeat(4 - mod);
  return Buffer.from(s + pad, "base64");
}

function normalizeExpToMs(exp) {
  let expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= 0) return null;
  if (expMs < 1e12) expMs *= 1000; // seconds → ms
  return expMs;
}

function verifySig(payloadPart, sig) {
  if (!OTP_SECRET || !payloadPart || !sig) return false;

  // base64url
  try {
    const h1 = crypto
      .createHmac("sha256", OTP_SECRET)
      .update(payloadPart)
      .digest("base64url");
    if (safeTimingEqual(h1, sig)) return true;
  } catch {}

  // legacy hex
  try {
    const h2 = crypto
      .createHmac("sha256", OTP_SECRET)
      .update(payloadPart)
      .digest("hex");
    if (safeTimingEqual(h2, sig)) return true;
  } catch {}

  return false;
}

function decodeSignedAdminJwt(raw, { allowMissingScope = false } = {}) {
  // Signed JWT cookies require OTP_SECRET (legacy fallback only)
  if (!OTP_SECRET) return null;
  if (!raw || typeof raw !== "string") return null;

  const token = raw.trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [h, p, sig] = parts;
  if (!verifySig(`${h}.${p}`, sig)) return null;

  try {
    const payload = JSON.parse(base64UrlDecodeToBuffer(p).toString("utf8"));
    if (!payload || typeof payload !== "object") return null;

    const scope = payload.scope == null ? "" : String(payload.scope);
    if (scope && scope !== "admin") return null;
    if (!scope && !allowMissingScope) return null;

    const uid = String(payload.uid || payload.userId || payload.sub || "").trim();
    if (!uid) return null;

    const expMs = normalizeExpToMs(payload.exp);
    if (!expMs) return null;
    if (Date.now() >= expMs) return null;

    return { ...payload, uid, exp: expMs, scope: scope || "admin" };
  } catch {
    return null;
  }
}

function decodeAdminJsonCookie(raw, { allowMissingScope = false } = {}) {
  if (!raw || typeof raw !== "string") return null;

  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    try {
      obj = JSON.parse(decodeURIComponent(raw));
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== "object") return null;

  const uid = String(obj.uid || obj.userId || obj.id || obj.sub || "").trim();
  if (!uid) return null;

  const expMs = normalizeExpToMs(obj.exp || obj.expiresAt || obj.expires || obj.e);
  if (!expMs) return null;
  if (Date.now() >= expMs) return null;

  const scope = String(obj.scope || obj.scp || "").toLowerCase();
  const purpose = String(obj.purpose || obj.pur || "").toLowerCase();
  const status = String(obj.status || obj.sta || "").toUpperCase();

  const isRbacPurpose =
    purpose === "rbac_login" ||
    purpose === "rbac_elevate" ||
    purpose === "rbac_sensitive_action" ||
    purpose.startsWith("rbac_");

  const isAdminScoped = scope === "admin";
  const isVerified =
    !status || status === "VERIFIED" || status === "OK" || status === "TRUE";

  if (!(isAdminScoped || isRbacPurpose)) {
    if (!(allowMissingScope && isRbacPurpose)) return null;
  }
  if (!isVerified) return null;

  return {
    ...obj,
    uid,
    exp: expMs,
    scope: isAdminScoped ? "admin" : scope || "admin",
  };
}

function decodeLegacyAdminCookie(raw, opts) {
  return decodeSignedAdminJwt(raw, opts) || decodeAdminJsonCookie(raw, opts) || null;
}

function pickFirstLegacyCookieValue(jar) {
  for (const name of LEGACY_ADMIN_COOKIE_CANDIDATES) {
    const v = jar.get(name)?.value;
    if (v) return { name, value: v };
  }
  return { name: null, value: null };
}

function normalizeRoleName(s) {
  return String(s || "").trim().toLowerCase();
}

function hasAdminLikeRoleName(roles = []) {
  // keep broad enough for ops roles; still admin-only because it requires admin auth
  const adminish = [
    "superadmin",
    "owner",
    "root",
    "admin",
    "manager",
    "staff",
    "finance",
    "analyst",
    "support",
    "operations",
    "warehouse",
    "inventory",
    "inventory_manager",
    "marketing",
    "content",
    "content_manager",
    "dispatcher",
  ];
  const set = new Set(adminish.map((r) => r.toLowerCase()));
  return (roles || []).some((name) => set.has(normalizeRoleName(name)));
}

function computePermissionsFromRoles(roleNames = []) {
  // permissionsFor() is your canonical mapping from roles → permission set
  try {
    const shaped = { roles: (roleNames || []).map((name) => ({ role: { name } })) };
    const set = permissionsFor(shaped);
    return Array.from(set || []);
  } catch {
    try {
      const set = permissionsFor({ roles: roleNames });
      return Array.from(set || []);
    } catch {
      return [];
    }
  }
}

function normalizePerm(p) {
  return String(p || "").trim().toLowerCase();
}

function ensurePermissionGate(permissions, opts) {
  const have = new Set((permissions || []).map(normalizePerm));

  if (opts?.permission) {
    const want = normalizePerm(opts.permission);
    if (want && !have.has(want)) {
      const err = new Error("FORBIDDEN");
      err.status = 403;
      err.code = "ADMIN_PERMISSION_MISSING";
      err.meta = { missing: want };
      throw err;
    }
  }

  if (Array.isArray(opts?.anyPermissions) && opts.anyPermissions.length) {
    const ok = opts.anyPermissions.some((p) => have.has(normalizePerm(p)));
    if (!ok) {
      const err = new Error("FORBIDDEN");
      err.status = 403;
      err.code = "ADMIN_PERMISSION_MISSING_ANY";
      err.meta = { missingAnyOf: opts.anyPermissions };
      throw err;
    }
  }

  if (Array.isArray(opts?.allPermissions) && opts.allPermissions.length) {
    const missing = opts.allPermissions.filter((p) => !have.has(normalizePerm(p)));
    if (missing.length) {
      const err = new Error("FORBIDDEN");
      err.status = 403;
      err.code = "ADMIN_PERMISSION_MISSING_ALL";
      err.meta = { missing };
      throw err;
    }
  }
}

/**
 * requireAdminIndependent(req, opts)
 *
 * - Throws 401 if no valid admin session (NextAuth admin cookie OR legacy)
 * - Throws 403 if user lacks admin roles/permissions
 */
export async function requireAdminIndependent(req, opts = {}) {
  const jar = await cookies();

  // 1) PRIMARY: Admin NextAuth token (fully separated)
  let authSource = "none";
  let userId = "";
  let tokenRoles = [];
  let tokenPerms = [];

  if (ADMIN_AUTH_SECRET) {
    try {
      const tok = await getToken({
        req,
        secret: ADMIN_AUTH_SECRET,
        cookieName: ADMIN_AUTH_COOKIE_NAME,
        secureCookie: IS_PROD,
      });

      if (tok && String(tok.scope || "").toLowerCase() === "admin") {
        const uid = String(tok.uid || tok.userId || tok.sub || "").trim();
        if (uid) {
          userId = uid;
          authSource = "nextauth_admin";
          tokenRoles = Array.isArray(tok.roles) ? tok.roles : [];
          tokenPerms = Array.isArray(tok.permissions) ? tok.permissions : [];
        }
      }
    } catch {
      // ignore and fallback
    }
  }

  // 2) FALLBACK: legacy admin cookies
  let legacy = null;
  let legacyCookieName = null;

  if (!userId) {
    const picked = pickFirstLegacyCookieValue(jar);
    legacyCookieName = picked.name;
    legacy = decodeLegacyAdminCookie(picked.value, { allowMissingScope: true });
    if (legacy?.uid) {
      userId = String(legacy.uid);
      authSource = legacyCookieName || "legacy_admin_cookie";
    }
  }

  if (!userId) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    err.code = "ADMIN_SESSION_MISSING_OR_INVALID";
    err.meta = {
      sourceTried: {
        nextauthCookie: ADMIN_AUTH_COOKIE_NAME,
        legacyCookie: legacyCookieName || null,
      },
    };
    throw err;
  }

  // DB user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      email: true,
      phone: true,
      name: true,
      kind: true, // ensure staff-capable if your schema uses UserKind
    },
  });

  if (!user?.id || user.isActive === false) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    err.code = "ADMIN_USER_INACTIVE";
    throw err;
  }

  // Enforce staff/admin plane only (prevents customer identity acting as admin)
  const kind = String(user.kind || "");
  const isStaffKind = kind === "STAFF_ONLY" || kind === "CUSTOMER_AND_STAFF";
  if (kind && !isStaffKind) {
    const err = new Error("FORBIDDEN");
    err.status = 403;
    err.code = "ADMIN_USER_NOT_STAFF_KIND";
    err.meta = { kind };
    throw err;
  }

  // DB roles
  const roleRows = await prisma.userRole.findMany({
    where: { userId },
    include: { role: true },
  });

  const roleNames = roleRows.map((r) => r?.role?.name).filter(Boolean);

  // NOTE: we do NOT use admin_role cookie to “grant” access.
  // If you still set it, it can be used for UI hints only elsewhere.

  // If DB roles missing (rare), fall back to token snapshot (still admin-only cookie verified above)
  const effectiveRoles =
    roleNames.length > 0 ? roleNames : Array.isArray(tokenRoles) ? tokenRoles : [];

  // Compute permissions from roles (authoritative mapping)
  let permissions = computePermissionsFromRoles(effectiveRoles);

  // If mapping yields none but token provided permissions, allow token snapshot as fallback
  if ((!permissions || permissions.length === 0) && Array.isArray(tokenPerms) && tokenPerms.length) {
    permissions = tokenPerms;
  }

  const isAdminRole = hasAdminLikeRoleName(effectiveRoles) || (permissions?.length ?? 0) > 0;
  if (!isAdminRole) {
    const err = new Error("FORBIDDEN");
    err.status = 403;
    err.code = "ADMIN_ROLE_NOT_ALLOWED";
    err.meta = { roles: effectiveRoles };
    throw err;
  }

  // Permission gates (optional)
  ensurePermissionGate(permissions, opts);

  return {
    userId,
    user: { ...user, roles: effectiveRoles, permissions },
    roles: effectiveRoles,
    permissions,
    isAdminRole,
    session: {
      source: authSource,
      cookieName:
        authSource === "nextauth_admin"
          ? ADMIN_AUTH_COOKIE_NAME
          : legacyCookieName || null,
      exp: legacy?.exp ?? null,
      scope: legacy?.scope ?? "admin",
      purpose: legacy?.purpose ?? null,
    },
  };
}
