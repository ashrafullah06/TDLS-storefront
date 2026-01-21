// FILE: src/lib/auth.js
// NextAuth v5 — fully separated Customer plane vs Admin plane in ONE file (no new files).
//
// CUSTOMER:
//   - /api/auth/* uses customerHandlers (tdlc_c_* cookies, scope:"customer")
// ADMIN:
//   - /api/admin/auth/* uses adminHandlers (tdlc_a_* cookies, scope:"admin")
//
// Backward compatibility:
//   - exports.handlers/auth/signIn/signOut = customer plane (storefront default)
//   - requireAuth = customer-only
//   - requireAdmin = admin-only (never falls back to customer session)
//
// NOTE:
//   Admin cookies MUST be path "/" so that /api/admin/* receives them.
//   Separation is guaranteed by cookie prefix + JWT scope claim.
//
// References: this file is the coupling point in your project.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Facebook from "next-auth/providers/facebook";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { getToken } from "next-auth/jwt";

// RBAC helpers (roles + permissions)
import {
  hasPermission,
  permissionsFor,
  userRoles,
  isAdminRole,
  Permissions as RbacPermissions,
} from "@/lib/rbac";

// Optional bcrypt fallback (loaded lazily if installed). No argon2 (avoids bundler warnings).
let bcryptjs = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  bcryptjs = require("bcryptjs");
} catch {}

/* ───────────────── ENV ───────────────── */
const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Base paths (exported for admin/client wiring to prevent accidental /api/auth usage)
 */
export const CUSTOMER_AUTH_BASE_PATH = "/api/auth";
export const ADMIN_AUTH_BASE_PATH = "/api/admin/auth";

/**
 * TrustHost handling
 */
const TRUST_HOST =
  process.env.AUTH_TRUST_HOST === "true"
    ? true
    : process.env.AUTH_TRUST_HOST === "false"
    ? false
    : !IS_PROD
    ? true
    : true;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

// Customer secret
const CUSTOMER_AUTH_SECRET =
  process.env.CUSTOMER_AUTH_SECRET ||
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET;

// Admin secret (separate) — keep fallback, but prefer ADMIN_AUTH_SECRET for hard separation
const ADMIN_AUTH_SECRET =
  process.env.ADMIN_AUTH_SECRET ||
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET;

if (!CUSTOMER_AUTH_SECRET)
  throw new Error(
    "CUSTOMER_AUTH_SECRET or AUTH_SECRET or NEXTAUTH_SECRET is required"
  );
if (!ADMIN_AUTH_SECRET)
  throw new Error(
    "ADMIN_AUTH_SECRET or AUTH_SECRET or NEXTAUTH_SECRET is required"
  );

// OTP secret is still required for OTP hashing/verification routes
const OTP_SECRET = requireEnv("OTP_SECRET");
void OTP_SECRET; // keep required, even if not used directly in this file

// Cookie names (defaults remain unchanged)
export const CUSTOMER_SESSION_COOKIE_NAME =
  process.env.CUSTOMER_AUTH_COOKIE_NAME || "tdlc_c_session";
export const ADMIN_SESSION_COOKIE_NAME =
  process.env.ADMIN_AUTH_COOKIE_NAME || "tdlc_a_session";

// Optional: allow probing default Auth.js cookie names for admin only if explicitly enabled,
// and only when token.scope === "admin". Default OFF to prevent plane coupling.
const ADMIN_ALLOW_DEFAULT_COOKIE_NAMES =
  String(process.env.ADMIN_ALLOW_DEFAULT_COOKIE_NAMES || "").trim() === "1";

// Read OAuth envs from any of the commonly used names (customer only)
const GOOGLE_ID =
  process.env.AUTH_GOOGLE_ID ||
  process.env.GOOGLE_CLIENT_ID ||
  process.env.GOOGLE_ID;
const GOOGLE_SECRET =
  process.env.AUTH_GOOGLE_SECRET ||
  process.env.GOOGLE_CLIENT_SECRET ||
  process.env.GOOGLE_SECRET;

const FACEBOOK_ID =
  process.env.AUTH_FACEBOOK_ID ||
  process.env.FACEBOOK_CLIENT_ID ||
  process.env.FACEBOOK_ID;
const FACEBOOK_SECRET =
  process.env.AUTH_FACEBOOK_SECRET ||
  process.env.FACEBOOK_CLIENT_SECRET ||
  process.env.FACEBOOK_SECRET;

/* ───────────────── separation sanity warnings (non-breaking) ───────────────── */
(function separationWarnings() {
  try {
    if (
      IS_PROD &&
      CUSTOMER_AUTH_SECRET &&
      ADMIN_AUTH_SECRET &&
      CUSTOMER_AUTH_SECRET === ADMIN_AUTH_SECRET
    ) {
      console.warn(
        "[auth] WARNING: ADMIN_AUTH_SECRET equals CUSTOMER_AUTH_SECRET (fallback in effect). " +
          "Hard separation is reduced; set ADMIN_AUTH_SECRET to a distinct value."
      );
    }

    if (CUSTOMER_SESSION_COOKIE_NAME === ADMIN_SESSION_COOKIE_NAME) {
      console.warn(
        "[auth] WARNING: CUSTOMER_AUTH_COOKIE_NAME equals ADMIN_AUTH_COOKIE_NAME. " +
          "This breaks separation. Use distinct cookie names (tdlc_c_* vs tdlc_a_*)."
      );
    }

    if (!process.env.ADMIN_AUTH_SECRET) {
      console.warn(
        "[auth] NOTE: ADMIN_AUTH_SECRET is not set; falling back to AUTH_SECRET/NEXTAUTH_SECRET. " +
          "Recommended: set ADMIN_AUTH_SECRET for true admin/customer isolation."
      );
    }
    if (!process.env.CUSTOMER_AUTH_SECRET) {
      console.warn(
        "[auth] NOTE: CUSTOMER_AUTH_SECRET is not set; falling back to AUTH_SECRET/NEXTAUTH_SECRET."
      );
    }
  } catch {}
})();

/* ───────────────── cookie domain hardening (safe + optional) ───────────────── */

function computeCookieDomain() {
  // Explicit override wins
  const explicit =
    process.env.AUTH_COOKIE_DOMAIN ||
    process.env.NEXT_PUBLIC_COOKIE_DOMAIN ||
    process.env.COOKIE_DOMAIN;

  if (explicit && String(explicit).trim()) return String(explicit).trim();

  // Only attempt auto-domain in production
  if (!IS_PROD) return undefined;

  const site =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL;

  if (!site) return undefined;

  try {
    const u = new URL(site.startsWith("http") ? site : `https://${site}`);
    const host = String(u.hostname || "").trim().toLowerCase();
    if (!host || host === "localhost") return undefined;

    // Only auto-derive when explicitly using www.* (safe)
    if (host.startsWith("www.") && host.split(".").length >= 3) {
      return `.${host.slice(4)}`;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

const COOKIE_DOMAIN = computeCookieDomain();
const COOKIE_DOMAIN_OPT = COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {};

/* ───────────────── helpers ───────────────── */
const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

/**
 * Normalize phone numbers to canonical digits (Bangladesh-friendly).
 */
function normalizePhone(raw) {
  if (!raw) return null;

  let s = String(raw).trim();
  s = s.replace(/[^\d+]/g, "");

  if (/^0\d{10}$/.test(s)) {
    s = "880" + s.slice(1);
  } else if (/^\+880\d{10}$/.test(s)) {
    s = s.replace(/^\+/, "");
  } else if (/^880\d{10}$/.test(s)) {
    // ok
  }

  const digits = s.replace(/\+/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  return digits;
}

/**
 * Candidates for phone matching (handles local/intl variants).
 * Safe additive helper (was missing but referenced).
 */
function phoneCandidates(raw) {
  const p = normalizePhone(raw);
  if (!p) return [];
  const out = new Set();

  // canonical (e.g. 8801XXXXXXXXX)
  out.add(p);

  // with plus
  out.add(`+${p}`);

  // local 01XXXXXXXXX if bd format
  if (p.startsWith("880") && p.length === 13) {
    out.add(`0${p.slice(3)}`);
  }

  // raw stripped
  out.add(String(raw || "").replace(/[^\d+]/g, ""));

  return Array.from(out).filter(Boolean);
}

function detectIdentifier(raw) {
  const val = String(raw || "").trim();
  if (!val) return { type: null, value: null };
  if (isEmail(val)) return { type: "email", value: val.toLowerCase() };
  const phone = normalizePhone(val);
  if (phone) return { type: "phone", value: phone };
  return { type: null, value: null };
}

/**
 * Infer type safely (keeps existing behavior if `type` provided).
 * - If `type` exists: use it
 * - Else if password exists: password
 * - Else if code exists: otp
 * - Else: fallback defaultType
 */
function inferAuthType(creds, defaultType) {
  const raw = creds?.type;
  if (raw != null && String(raw).trim() !== "") return String(raw).toLowerCase();
  if (creds?.password) return "password";
  if (creds?.code) return "otp";
  return String(defaultType || "otp").toLowerCase();
}

/* ───────────────── token/session id bridge (critical for dashboard panels) ───────────────── */

function ensureTokenUid(token) {
  // Backfill uid from sub for existing/older sessions (no behavior change, only compatibility)
  if (token && !token.uid && token.sub) token.uid = token.sub;
  return token;
}

function getTokenUserId(token) {
  const v = token?.uid || token?.userId || token?.sub || null;
  if (!v) return null;
  const s = String(v).trim();
  return s || null;
}

/* ───────────── ADMIN ROLE STABILITY (admin plane only) ───────────── */

const ADMIN_ROLE_PRIORITY = [
  "superadmin",
  "owner",
  "admin",
  "manager",
  "finance",
  "analyst",
  "staff",
  "support",
  "viewer",
];

function sortAdminRoles(roles) {
  const arr = (Array.isArray(roles) ? roles : [])
    .map((r) => String(r || "").trim().toLowerCase())
    .filter(Boolean);

  const uniq = Array.from(new Set(arr));
  const rank = new Map(ADMIN_ROLE_PRIORITY.map((r, i) => [r, i]));

  uniq.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : 999;
    const rb = rank.has(b) ? rank.get(b) : 999;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  return uniq;
}

function normalizePerms(perms) {
  const arr = (Array.isArray(perms) ? perms : [])
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  return Array.from(new Set(arr));
}

/* ───────────────── OTP verification via internal API ───────────────── */

function getBaseUrlFromRequest(req) {
  // Hardened: handle NextAuth authorize `req` objects without `.url`
  // and avoid returning localhost in production if headers provide host/proto.
  try {
    if (req?.url) {
      const u = new URL(req.url);
      return u.origin.replace(/\/$/, "");
    }
  } catch {}

  try {
    const h = req?.headers;

    const host =
      h?.get?.("x-forwarded-host") ||
      h?.get?.("host") ||
      process.env.NEXT_PUBLIC_VERCEL_URL ||
      "localhost:3000";

    const proto =
      h?.get?.("x-forwarded-proto") || (IS_PROD ? "https" : "http");

    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      `${proto}://${String(host).replace(/^https?:\/\//, "")}`;

    return base.replace(/\/$/, "");
  } catch {
    return (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000").replace(
      /\/$/,
      ""
    );
  }
}

async function verifyCustomerOtpViaApi({ req, identifier, purpose, code }) {
  const base = getBaseUrlFromRequest(req);
  const channel = String(identifier || "").includes("@") ? "email" : "sms";

  const payload = {
    identifier,
    purpose,
    code,
    to: identifier,
    via: channel,
    channel,
  };

  // CUSTOMER MUST NEVER call admin OTP endpoints.
  // Also: do NOT fall back to deprecated legacy endpoints (prevents plane coupling).
  const endpoints = ["/api/auth/verify-otp"];

  for (const ep of endpoints) {
    const url = new URL(ep, base);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
    } catch {
      continue;
    }

    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok) return { ok: true, json };

    if (res.status >= 500 && res.status <= 599) continue;
    return { ok: false, json, status: res.status };
  }

  return { ok: false, notFound: true };
}

async function verifyAdminOtpViaApi({ req, identifier, purpose, code }) {
  const base = getBaseUrlFromRequest(req);
  const channel = String(identifier || "").includes("@") ? "email" : "sms";

  const payload = {
    identifier,
    purpose,
    code,
    to: identifier,
    via: channel,
    channel,
  };

  // ADMIN MUST NEVER call customer OTP endpoints
  const endpoints = ["/api/admin/auth/verify-otp"];

  for (const ep of endpoints) {
    const url = new URL(ep, base);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });
    } catch {
      continue;
    }

    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok) return { ok: true, json };

    if (res.status >= 500 && res.status <= 599) continue;
    return { ok: false, json, status: res.status };
  }

  return { ok: false, notFound: true };
}

/* hashing helpers */
const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hmacHex = (secret, s) =>
  crypto.createHmac("sha256", secret).update(s).digest("hex");
void hmacHex; // keep helper (used elsewhere / future hardening)

function safeEqual(a = "", b = "") {
  try {
    const A = Buffer.from(String(a));
    const B = Buffer.from(String(b));
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

/* ───────────── password verification helper ───────────── */
function safeTimingEqual(aBuf, bBuf) {
  try {
    if (!aBuf || !bBuf) return false;
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

async function verifyPassword(rawPassword, storedHash) {
  const pwd = String(rawPassword ?? "");
  const stored = String(storedHash ?? "");
  if (!pwd || !stored) return false;

  // bcrypt
  if (bcryptjs && /^\$2[aby]\$/.test(stored)) {
    try {
      return await bcryptjs.compare(pwd, stored);
    } catch {
      return false;
    }
  }

  // PBKDF2 format: pbkdf2$ITER$SALT_B64$HASH_B64
  if (stored.startsWith("pbkdf2$")) {
    try {
      const parts = stored.split("$");
      if (parts.length === 4) {
        const iter = Number.parseInt(parts[1], 10);
        const saltB64 = parts[2];
        const hashB64 = parts[3];

        const iterSafe = Math.min(Math.max(iter || 0, 10_000), 1_000_000);

        const salt = Buffer.from(saltB64, "base64");
        const expected = Buffer.from(hashB64, "base64");
        if (!salt.length || !expected.length) return false;

        const derived = crypto.pbkdf2Sync(
          pwd,
          salt,
          iterSafe,
          expected.length,
          "sha256"
        );
        return safeTimingEqual(derived, expected);
      }
    } catch {
      return false;
    }
  }

  // sha256 hex fallback
  const shaHex = sha256Hex(pwd);
  if (safeEqual(stored, shaHex)) return true;

  // plain-text fallback (dev only / temporary)
  if (!IS_PROD && safeEqual(stored, pwd)) return true;

  return false;
}

/* ───────────── NEW: password hashing + setter helpers (kept) ───────────── */
export async function hashPassword(rawPassword) {
  const pwd = String(rawPassword ?? "");
  if (!pwd) throw new Error("password_required");

  const rounds = Math.min(
    Math.max(parseInt(process.env.AUTH_BCRYPT_ROUNDS || "12", 10) || 12, 10),
    15
  );

  if (bcryptjs) {
    return await bcryptjs.hash(pwd, rounds);
  }

  const iter = Math.min(
    Math.max(
      parseInt(process.env.AUTH_PBKDF2_ITER || "210000", 10) || 210000,
      10000
    ),
    1000000
  );
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(pwd, salt, iter, 32, "sha256");
  return `pbkdf2$${iter}$${salt.toString("base64")}$${derived.toString(
    "base64"
  )}`;
}

export async function resolveUsersByIdentifier(identifierRaw) {
  const parsed = detectIdentifier(identifierRaw);
  if (!parsed.type) return { parsed, users: [] };

  if (parsed.type === "email") {
    const u = await prisma.user.findFirst({ where: { email: parsed.value } });
    return { parsed, users: u ? [u] : [] };
  }

  const cands = phoneCandidates(identifierRaw);
  const users = await prisma.user.findMany({ where: { phone: { in: cands } } });
  return { parsed, users };
}

export async function setPasswordForIdentifier({
  identifier,
  newPassword,
  requireAdminRole = false,
}) {
  const { parsed, users } = await resolveUsersByIdentifier(identifier);

  if (!parsed?.type) return { ok: false, error: "INVALID_IDENTIFIER" };
  if (!users.length) return { ok: false, error: "USER_NOT_FOUND" };

  if (requireAdminRole) {
    const withRoles = await prisma.user.findMany({
      where: { id: { in: users.map((u) => u.id) } },
      include: { roles: { include: { role: true } } },
    });
    const anyNonAdmin = withRoles.some((u) => !isAdminRole(u));
    if (anyNonAdmin) return { ok: false, error: "TARGET_NOT_ADMIN" };
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.updateMany({
    where: { id: { in: users.map((u) => u.id) } },
    data: { passwordHash },
  });

  return { ok: true, updatedUserIds: users.map((u) => u.id) };
}

/* ───────────── enum-safe purpose handling ───────────── */
const OTP_PURPOSE_ENUM = new Set([
  "signup",
  "login",
  "address_create",
  "address_update",
  "address_delete",
  "mobile_update",
  "cod_confirm",
  "order_confirm",
  "payment_gateway_auth",
  "email_update",
  "password_change",
  "wallet_transfer",
  "refund_destination_confirm",
  "reward_redeem_confirm",
  "privacy_request_confirm",

  // admin/rbac
  "rbac_login",
  "rbac_elevate",
  "rbac_sensitive_action",
]);

function coerceOtpPurpose(raw) {
  if (!raw) return null;

  let p = String(raw).trim().toLowerCase();

  const alias = {
    signin: "login",
    "2fa": "login",

    admin_login: "rbac_login",
    staff_login: "rbac_login",
    rbac: "rbac_login",

    elevate: "rbac_elevate",
    sudo_action: "rbac_sensitive_action",
  };

  p = alias[p] || p;
  return OTP_PURPOSE_ENUM.has(p) ? p : null;
}

/**
 * Admin purpose hardening:
 * Many OTP UIs submit `purpose=login`. For admin-plane, treat that as rbac_login.
 * This avoids false negatives that lead to “no_admin_session”.
 */
function coerceAdminPurpose(raw) {
  const p = coerceOtpPurpose(raw) || "rbac_login";
  if (p === "login") return "rbac_login";
  return p;
}

/* ───────────── customerCode generator ───────────── */
export async function ensureCustomerCode(userId) {
  if (!userId) return null;

  const id = String(userId);
  const MAX_RETRIES = 12;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fast path
  try {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { customerCode: true },
    });
    if (!existing) return null;
    if (existing.customerCode) return existing.customerCode;
  } catch (e) {
    // If DB is degraded, do not block the request flow.
    console.error("[auth] ensureCustomerCode precheck failed", e);
    return null;
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const assigned = await prisma.$transaction(
        async (tx) => {
          const row = await tx.user.findUnique({
            where: { id },
            select: { customerCode: true },
          });

          if (!row) return null;
          if (row.customerCode) return row.customerCode;

          let nextNum = 1;

          // Preferred: numeric max from DB (Postgres). Falls back safely if unsupported.
          try {
            const res = await tx.$queryRaw`
              SELECT
                MAX(CAST(substring("customerCode" from 6) AS INTEGER)) AS "max"
              FROM "User"
              WHERE "customerCode" IS NOT NULL
                AND "customerCode" ~ '^CUST-[0-9]+$'
            `;
            const maxv =
              Array.isArray(res) && res[0] ? Number(res[0].max) : NaN;
            if (Number.isFinite(maxv) && maxv > 0) nextNum = maxv + 1;
          } catch {
            // Fallback: best-effort string scan
            const last = await tx.user.findFirst({
              where: { customerCode: { startsWith: "CUST-" } },
              orderBy: { customerCode: "desc" },
              select: { customerCode: true },
            });

            if (last?.customerCode) {
              const m = last.customerCode.match(/CUST-(\d+)/);
              if (m) {
                const current = parseInt(m[1], 10);
                if (Number.isFinite(current) && current > 0)
                  nextNum = current + 1;
              }
            }
          }

          const code = `CUST-${String(nextNum).padStart(6, "0")}`;

          // Atomic assign: only if still NULL (prevents overwrites)
          const updated = await tx.user.updateMany({
            where: { id, customerCode: null },
            data: { customerCode: code },
          });

          if (updated?.count === 1) return code;

          // If another request already set it, return the new value
          const again = await tx.user.findUnique({
            where: { id },
            select: { customerCode: true },
          });
          return again?.customerCode || null;
        },
        { isolationLevel: "Serializable" }
      );

      if (assigned) return assigned;
    } catch (err) {
      // Concurrency / serialization retries
      const code = err?.code || err?.meta?.cause;
      const isRetryable =
        code === "P2002" || // unique constraint
        code === "P2034" || // transaction conflict (serializable retry)
        /could not serialize|serialization|deadlock/i.test(
          String(err?.message || "")
        );

      if (!isRetryable) {
        console.error("[auth] ensureCustomerCode failed", err);
        return null;
      }
    }

    // backoff + jitter reduces P2002 storms under concurrent server component calls
    await sleep(20 + crypto.randomInt(0, 60) + attempt * 15);
  }

  // Deterministic fallback (unique; non-sequential) to avoid blocking checkout/auth flows
  try {
    const fallback = `CUST-${sha256Hex(id).slice(0, 8).toUpperCase()}`;

    const updated = await prisma.user.updateMany({
      where: { id, customerCode: null },
      data: { customerCode: fallback },
    });

    if (updated?.count === 1) return fallback;

    const again = await prisma.user.findUnique({
      where: { id },
      select: { customerCode: true },
    });

    if (again?.customerCode) return again.customerCode;
  } catch (e) {
    console.error("[auth] ensureCustomerCode fallback failed", e);
  }

  console.error("[auth] ensureCustomerCode gave up after max retries");
  return null;
}

/* ───────────── OAuth → Prisma user linker (customer only) ───────────── */
async function linkOAuthToPrismaUser({ provider, email, name, image }) {
  const p = String(provider || "").toLowerCase();
  if (p !== "google" && p !== "facebook") return null;

  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;

  const existing = await prisma.user.findFirst({
    where: { email: e },
    select: { id: true, name: true, image: true, email: true, phone: true },
  });

  if (existing) {
    try {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          name: existing.name || name || null,
          image: existing.image || image || null,
        },
      });
    } catch (e) {
      console.error("[auth] oauth user update failed", e);
    }
    return existing;
  }

  const created = await prisma.user.create({
    data: {
      email: e,
      name: name || null,
      image: image || null,
      isActive: true,
    },
    select: { id: true, name: true, image: true, email: true, phone: true },
  });

  return created;
}

/* ───────────── RBAC → JWT snapshot helpers ───────────── */
async function loadRbacSnapshotForCustomerToken(token, userId) {
  if (!userId) return token;
  try {
    const u = await prisma.user.findUnique({
      where: { id: String(userId) },
      include: { roles: { include: { role: true } } },
    });
    if (!u) {
      token.roles = [];
      token.isAdminRole = false;
      token.rbacLoadedAt = Date.now();
      return token;
    }

    const rolesArr = userRoles(u);
    token.roles = Array.isArray(rolesArr) ? rolesArr : [];
    token.isAdminRole = isAdminRole(u) === true;
    token.rbacLoadedAt = Date.now();
    if (u.kind != null) token.kind = u.kind;
  } catch (e) {
    console.error("[auth] loadRbacSnapshotForCustomerToken failed", e);
  }
  return token;
}

async function loadRbacSnapshotForAdminToken(token, userId) {
  if (!userId) return token;
  try {
    const u = await prisma.user.findUnique({
      where: { id: String(userId) },
      include: { roles: { include: { role: true } } },
    });
    if (!u) {
      token.roles = [];
      token.permissions = [];
      token.rbacLoadedAt = Date.now();
      return token;
    }

    // ADMIN: stable ordering + normalized permissions
    const rolesArr = userRoles(u);
    token.roles = sortAdminRoles(Array.isArray(rolesArr) ? rolesArr : []);

    const permSet = permissionsFor(u);
    token.permissions = normalizePerms(
      Array.from(permSet || []).map((p) => String(p || "").trim())
    );

    token.rbacLoadedAt = Date.now();
    if (u.kind != null) token.kind = u.kind;
  } catch (e) {
    console.error("[auth] loadRbacSnapshotForAdminToken failed", e);
  }
  return token;
}

/* ───────────────────────── Cookie profiles (separation) ───────────────────────── */

function cookieProfileCustomer() {
  return {
    sessionToken: {
      name: CUSTOMER_SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    csrfToken: {
      name: "tdlc_c_csrf",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    callbackUrl: {
      name: "tdlc_c_callback",
      options: { sameSite: "lax", path: "/", secure: IS_PROD, ...COOKIE_DOMAIN_OPT },
    },
    pkceCodeVerifier: {
      name: "tdlc_c_pkce",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    state: {
      name: "tdlc_c_state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    nonce: {
      name: "tdlc_c_nonce",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
  };
}

function cookieProfileAdmin() {
  return {
    sessionToken: {
      name: ADMIN_SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/", // required for /admin/* + /api/admin/*
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    csrfToken: {
      name: "tdlc_a_csrf",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    callbackUrl: {
      name: "tdlc_a_callback",
      options: { sameSite: "lax", path: "/", secure: IS_PROD, ...COOKIE_DOMAIN_OPT },
    },
    pkceCodeVerifier: {
      name: "tdlc_a_pkce",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    state: {
      name: "tdlc_a_state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
    nonce: {
      name: "tdlc_a_nonce",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_PROD,
        ...COOKIE_DOMAIN_OPT,
      },
    },
  };
}

/* ───────────────────────── CUSTOMER NextAuth options ───────────────────────── */

const customerOptions = {
  // explicit basePath for customer plane
  basePath: CUSTOMER_AUTH_BASE_PATH,

  secret: CUSTOMER_AUTH_SECRET,
  trustHost: TRUST_HOST,
  session: { strategy: "jwt" },
  cookies: cookieProfileCustomer(),
  pages: { signIn: "/login" },

  providers: [
    Credentials({
      id: "credentials",
      name: "CustomerCredentials",
      credentials: {
        identifier: { label: "Email or Phone", type: "text" },
        code: { label: "OTP code", type: "text" },
        purpose: { label: "Purpose", type: "text" },
        password: { label: "Password", type: "password" },
        type: { label: "Type", type: "text" }, // "otp" | "password"
      },

      async authorize(creds, req) {
        const type = inferAuthType(creds, "otp");
        const purposeRaw = String(creds?.purpose || "login");
        const purposeNorm = coerceOtpPurpose(purposeRaw);
        const parsed = detectIdentifier(creds?.identifier);

        if (!parsed.type) return null;

        const purposeEffective = purposeNorm || "login";

        // HARD CUSTOMER RULE: customer auth never handles rbac_* purposes
        if (String(purposeEffective).startsWith("rbac_")) return null;

        const whereUser =
          parsed.type === "email"
            ? { email: parsed.value }
            : { phone: parsed.value };

        if (type === "password") {
          if (!creds?.password) return null;

          const user = await prisma.user.findFirst({ where: whereUser });
          if (!user) return null;

          const ok = await verifyPassword(creds.password, user.passwordHash);
          if (!ok) return null;

          try {
            const now = new Date();
            await prisma.user.update({
              where: { id: user.id },
              data: { lastLoginAt: now },
            });
          } catch {}

          try {
            await ensureCustomerCode(user.id);
          } catch {}

          return {
            id: user.id,
            email: user.email,
            name: user.name || null,
            phone: user.phone || null,
          };
        }

        // OTP customer login/signup
        const code = String(creds?.code || "").trim();
        if (!code) return null;

        let user = await prisma.user.findFirst({ where: whereUser });

        const verify = await verifyCustomerOtpViaApi({
          req,
          identifier: parsed.value,
          purpose: purposeEffective,
          code,
        });

        if (!verify?.ok) return null;

        if (!user) {
          user = await prisma.user.create({ data: { ...whereUser, isActive: true } });
        }

        try {
          const now = new Date();
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: now },
          });
        } catch {}

        try {
          await ensureCustomerCode(user.id);
        } catch {}

        return {
          id: user.id,
          email: user.email,
          name: user.name || null,
          phone: user.phone || null,
        };
      },
    }),

    ...(GOOGLE_ID && GOOGLE_SECRET
      ? [Google({ clientId: GOOGLE_ID, clientSecret: GOOGLE_SECRET })]
      : []),
    ...(FACEBOOK_ID && FACEBOOK_SECRET
      ? [Facebook({ clientId: FACEBOOK_ID, clientSecret: FACEBOOK_SECRET })]
      : []),
  ],

  callbacks: {
    async jwt({ token, user, account, profile }) {
      token.scope = "customer";
      ensureTokenUid(token);

      if (account?.provider)
        token.authProvider = String(account.provider || "").toLowerCase();

      const provider = String(account?.provider || "").toLowerCase();
      const isOAuth = provider === "google" || provider === "facebook";

      if (isOAuth && account) {
        const email = (user?.email || token?.email || profile?.email || "").toString();
        const name =
          user?.name || token?.name || profile?.name || profile?.given_name || null;
        const image = user?.image || token?.picture || profile?.picture || null;

        try {
          const dbUser = await linkOAuthToPrismaUser({ provider, email, name, image });
          if (dbUser?.id) {
            token.uid = dbUser.id;
            token.email = dbUser.email ?? token.email ?? null;
            token.name = dbUser.name ?? token.name ?? null;
            token.phone = dbUser.phone ?? token.phone ?? null;

            try {
              await ensureCustomerCode(dbUser.id);
            } catch {}

            await loadRbacSnapshotForCustomerToken(token, dbUser.id);
          }
        } catch (e) {
          console.error("[customer-auth] oauth mapping failed", e);
        }

        ensureTokenUid(token);
        return token;
      }

      if (user?.id) {
        token.uid = String(user.id);
        if ("name" in user) token.name = user.name ?? null;
        if ("email" in user) token.email = user.email ?? null;
        if ("phone" in user) token.phone = user.phone ?? null;

        await loadRbacSnapshotForCustomerToken(token, user.id);
      }

      // periodic refresh snapshot (non-blocking)
      if (token?.uid && !Array.isArray(token?.roles)) {
        const last = Number(token?.rbacLoadedAt || 0);
        if (!last || Date.now() - last > 6 * 60 * 60 * 1000) {
          await loadRbacSnapshotForCustomerToken(token, token.uid);
        }
      }

      ensureTokenUid(token);
      return token;
    },

    async session({ session, token }) {
      ensureTokenUid(token);

      session.scope = "customer";
      if (!session.user) session.user = {};

      // CRITICAL: always populate session.user.id (uid OR sub) for dashboards/panels
      const uid = getTokenUserId(token);
      if (uid) session.user.id = uid;

      if (token?.name !== undefined) session.user.name = token.name;
      if (token?.email !== undefined) session.user.email = token.email;
      if (token?.phone !== undefined) session.user.phone = token.phone;
      if (token?.authProvider) {
        session.user.authProvider = token.authProvider;
        session.authProvider = token.authProvider;
      }

      // customer session enrichment (unchanged intent, scoped to customer plane)
      if (!uid) return session;

      try {
        await ensureCustomerCode(uid);

        const u = await prisma.user.findUnique({
          where: { id: uid },
          select: {
            name: true,
            email: true,
            phone: true,
            gender: true,
            dob: true,
            kind: true,
            customerCode: true,
            loginPreference: true,
            defaultAddress: {
              select: {
                id: true,
                line1: true,
                line2: true,
                city: true,
                state: true,
                postalCode: true,
                countryIso2: true,
                phone: true,
                label: true,
              },
            },
            loyaltyAccount: {
              select: {
                tier: true,
                currentPoints: true,
                lifetimeEarned: true,
                lifetimeRedeemed: true,
              },
            },
            wallet: { select: { balance: true } },
            roles: { include: { role: true } },
          },
        });

        if (u) {
          session.user.name = session.user.name ?? u.name ?? null;
          session.user.email = session.user.email ?? u.email ?? null;
          session.user.phone = session.user.phone ?? u.phone ?? null;

          session.user.gender = u.gender ?? null;
          session.user.dob = u.dob ?? null;
          session.user.kind = u.kind ?? null;

          session.user.customerCode = u.customerCode ?? null;
          session.user.loginPreference = u.loginPreference ?? null;

          session.user.defaultAddress = u.defaultAddress ?? null;
          session.user.loyalty = u.loyaltyAccount ?? null;
          session.user.wallet = u.wallet ?? null;

          // RBAC data may exist for hybrid users but does not grant admin access
          try {
            const rolesArr = userRoles(u);
            const permSet = permissionsFor(u);
            session.user.roles = rolesArr;
            session.user.permissions = Array.from(permSet);
            session.user.isAdmin = isAdminRole(u);
          } catch {}
        }
      } catch (err) {
        console.error("[customer-auth] session fetch failed", err);
      }

      return session;
    },
  },
};

/* ───────────────────────── ADMIN NextAuth options ───────────────────────── */

/**
 * Shared authorize function for admin credentials.
 * IMPORTANT: admin alias provider id "credentials" keeps UI unchanged if your client still calls signIn("credentials").
 */
async function authorizeAdminCredentials(creds, req) {
  const parsed = detectIdentifier(creds?.identifier);
  if (!parsed.type) return null;

  // infer type if UI didn't send it
  const type = inferAuthType(creds, "password");

  // coerce "login" → "rbac_login" for admin plane (common OTP form behavior)
  const purposeRaw = String(creds?.purpose || "rbac_login");
  const purposeEffective = coerceAdminPurpose(purposeRaw);

  // HARD ADMIN RULE: admin auth handles only rbac_* purposes
  if (!String(purposeEffective).startsWith("rbac_")) return null;

  const whereUser =
    parsed.type === "email" ? { email: parsed.value } : { phone: parsed.value };

  const user = await prisma.user.findFirst({
    where: whereUser,
    include: { roles: { include: { role: true } } },
  });

  if (!user || user.isActive === false) return null;

  // Must be staff-capable
  const kind = String(user.kind || "");
  const isStaffKind = kind === "STAFF_ONLY" || kind === "CUSTOMER_AND_STAFF";
  if (kind && !isStaffKind) return null;

  // Must be admin/staff role
  if (!isAdminRole(user)) return null;

  if (type === "password") {
    const ok = await verifyPassword(creds?.password, user.passwordHash);
    if (!ok) return null;

    try {
      const now = new Date();
      await prisma.user.update({
        where: { id: user.id },
        data: { lastRbacLoginAt: now },
      });
    } catch {}

    // ADMIN: stable roles + normalized perms
    const rolesArr = sortAdminRoles(userRoles(user));
    const permSet = permissionsFor(user);
    const perms = normalizePerms(Array.from(permSet || []));

    return {
      id: user.id,
      email: user.email || undefined,
      name: user.name || undefined,
      phone: user.phone || undefined,
      roles: rolesArr,
      permissions: perms,
      scope: "admin",
    };
  }

  // OTP admin
  const code = String(creds?.code || "").trim();
  if (!code) return null;

  const verify = await verifyAdminOtpViaApi({
    req,
    identifier: parsed.value,
    purpose: purposeEffective,
    code,
  });
  if (!verify?.ok) return null;

  try {
    const now = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: { lastRbacLoginAt: now },
    });
  } catch {}

  const rolesArr = sortAdminRoles(userRoles(user));
  const permSet = permissionsFor(user);
  const perms = normalizePerms(Array.from(permSet || []));

  return {
    id: user.id,
    email: user.email || undefined,
    name: user.name || undefined,
    phone: user.phone || undefined,
    roles: rolesArr,
    permissions: perms,
    scope: "admin",
  };
}

const adminOptions = {
  // explicit basePath for admin plane
  basePath: ADMIN_AUTH_BASE_PATH,

  secret: ADMIN_AUTH_SECRET,
  trustHost: TRUST_HOST,
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  cookies: cookieProfileAdmin(),
  pages: { signIn: "/admin/login" },

  providers: [
    // Keep your explicit admin provider
    Credentials({
      id: "admin-credentials",
      name: "AdminCredentials",
      credentials: {
        identifier: { label: "Email / Phone", type: "text" },
        password: { label: "Password", type: "password" },
        code: { label: "OTP code", type: "text" },
        purpose: { label: "Purpose", type: "text" }, // rbac_login, rbac_elevate, ...
        type: { label: "Type", type: "text" }, // password | otp
      },
      authorize: authorizeAdminCredentials,
    }),

    // CRITICAL COMPATIBILITY: admin alias provider id = "credentials"
    // This makes signIn("credentials") work on the admin plane without touching UI code.
    Credentials({
      id: "credentials",
      name: "AdminCredentialsAlias",
      credentials: {
        identifier: { label: "Email / Phone", type: "text" },
        password: { label: "Password", type: "password" },
        code: { label: "OTP code", type: "text" },
        purpose: { label: "Purpose", type: "text" }, // rbac_login, rbac_elevate, ...
        type: { label: "Type", type: "text" }, // password | otp
      },
      authorize: authorizeAdminCredentials,
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      // Ensure admin tokens are always tagged correctly
      token.scope = "admin";
      ensureTokenUid(token);

      if (user?.id) {
        token.uid = String(user.id);
        token.email = user.email || token.email;
        token.name = user.name || token.name;
        token.phone = user.phone || token.phone;

        token.roles = sortAdminRoles(Array.isArray(user.roles) ? user.roles : []);
        token.permissions = normalizePerms(
          Array.isArray(user.permissions) ? user.permissions : []
        );

        await loadRbacSnapshotForAdminToken(token, user.id);
      }

      // periodic refresh
      if (token?.uid) {
        const last = Number(token?.rbacLoadedAt || 0);
        if (!last || Date.now() - last > 2 * 60 * 60 * 1000) {
          await loadRbacSnapshotForAdminToken(token, token.uid);
        }
      }

      ensureTokenUid(token);
      return token;
    },

    async session({ session, token }) {
      ensureTokenUid(token);

      session.scope = "admin";
      session.user = session.user || {};

      const uid = getTokenUserId(token);
      if (uid) session.user.id = uid;

      session.user.email = token?.email || session.user.email;
      session.user.name = token?.name || session.user.name;
      session.user.phone = token?.phone || undefined;

      // ADMIN: stable roles + primaryRole always highest privilege
      const roles = sortAdminRoles(Array.isArray(token?.roles) ? token.roles : []);
      const perms = normalizePerms(
        Array.isArray(token?.permissions) ? token.permissions : []
      );

      session.user.roles = roles;
      session.user.permissions = perms;
      session.user.primaryRole = roles[0] || "staff";

      return session;
    },

    async redirect({ url, baseUrl }) {
      try {
        const u = new URL(url, baseUrl);
        if ((u.pathname || "/").startsWith("/admin")) return u.toString();
      } catch {}
      return `${baseUrl}/admin`;
    },
  },
};

/* ───────────────────────── Instantiate both planes ───────────────────────── */

const customerAuthInstance = NextAuth(customerOptions);
const adminAuthInstance = NextAuth(adminOptions);

// Plane-specific exports (preferred usage)
export const customerHandlers = customerAuthInstance.handlers;
export const customerAuth = customerAuthInstance.auth;
export const customerSignIn = customerAuthInstance.signIn;
export const customerSignOut = customerAuthInstance.signOut;

export const adminHandlers = adminAuthInstance.handlers;
export const adminAuth = adminAuthInstance.auth;
export const adminSignIn = adminAuthInstance.signIn;
export const adminSignOut = adminAuthInstance.signOut;

/* ───────────────────────── Backward compatibility ───────────────────────── */

// Existing imports across storefront likely reference these
export const handlers = customerHandlers;
export const auth = customerAuth;
export const signIn = customerSignIn;
export const signOut = customerSignOut;

/* ───────────────────────── Guards (separated) ───────────────────────── */

/**
 * CUSTOMER guard — uses customerAuth only.
 */
export async function requireAuth(_req, { optional = false } = {}) {
  const session = await customerAuth();
  const userId =
    session?.user?.id || session?.user?.sub || session?.user?.uid || null;

  if (!userId) {
    if (optional) return { userId: null, session: null };
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }
  return { userId: String(userId), session };
}

/* ───────────── request-like builder (fixes admin no_admin_session in server layouts) ───────────── */

async function buildRequestLikeFromNextHeaders() {
  // Only works in server runtime (App Router). Safe fallback.
  try {
    const mod = await import("next/headers");
    const hdrs = await mod.headers();
    const jar = await mod.cookies();

    const cookieHeader = jar
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    return {
      headers: {
        get: (k) => {
          const key = String(k || "").toLowerCase();
          if (key === "cookie") return cookieHeader || "";
          return hdrs.get(k) || null;
        },
      },
    };
  } catch {
    return null;
  }
}

/**
 * Read admin JWT from cookies robustly (ADMIN COOKIES ONLY by default).
 * - tries your custom cookie name (+ secure variants)
 * - accepts ONLY scope:"admin" if present
 *
 * Optional (env): ADMIN_ALLOW_DEFAULT_COOKIE_NAMES=1
 * - probes default Auth.js cookie names BUT still enforces scope:"admin"
 */
async function readAdminToken(req) {
  const base = String(ADMIN_SESSION_COOKIE_NAME || "tdlc_a_session").trim();

  // If req is missing (common in server components/layouts), build a request-like object.
  let reqLike = req;
  if (!reqLike || typeof reqLike !== "object" || !reqLike.headers?.get) {
    const built = await buildRequestLikeFromNextHeaders();
    if (built) reqLike = built;
  }

  const bases = [base, `${base}-token`].filter(Boolean);

  const names = [];
  for (const b of bases) {
    names.push(b);
    names.push(`__Secure-${b}`);
    names.push(`__Host-${b}`);
  }

  // Optional: allow default cookie names for admin only if explicitly enabled.
  // Still enforces scope:admin to avoid coupling.
  if (ADMIN_ALLOW_DEFAULT_COOKIE_NAMES) {
    names.push("authjs.session-token");
    names.push("__Secure-authjs.session-token");
    names.push("__Host-authjs.session-token");
    names.push("next-auth.session-token");
    names.push("__Secure-next-auth.session-token");
    names.push("__Host-next-auth.session-token");
  }

  const cookieNames = Array.from(new Set(names));
  const secureAttempts = IS_PROD ? [true, false] : [false, true];

  for (const cookieName of cookieNames) {
    for (const secureCookie of secureAttempts) {
      const tok = await getToken({
        req: reqLike,
        secret: ADMIN_AUTH_SECRET,
        cookieName,
        secureCookie,
      }).catch(() => null);

      if (!tok) continue;

      // If scope exists, enforce admin.
      const scope = String(tok?.scope || "").toLowerCase();
      if (scope && scope !== "admin") continue;

      // Extra safety: if this came from a default cookie name, require explicit scope=admin
      // (prevents “customer token accidentally treated as admin”)
      if (
        ADMIN_ALLOW_DEFAULT_COOKIE_NAMES &&
        /^(authjs\.session-token|next-auth\.session-token|__Secure-authjs\.session-token|__Host-authjs\.session-token|__Secure-next-auth\.session-token|__Host-next-auth\.session-token)$/i.test(
          cookieName
        )
      ) {
        if (scope !== "admin") continue;
      }

      ensureTokenUid(tok);
      return tok;
    }
  }

  return null;
}

/**
 * ADMIN guard — uses ONLY admin NextAuth cookie + ADMIN_AUTH_SECRET.
 * Never succeeds via customer session.
 */
export async function requireAdmin(
  req,
  { optional = false, permission, permissions: extraPerms } = {}
) {
  const tok = await readAdminToken(req);

  const scope = String(tok?.scope || "").toLowerCase();
  const userId = getTokenUserId(tok);

  if (!userId || (scope && scope !== "admin")) {
    if (optional) {
      return { userId: null, session: null, user: null, roles: [], permissions: [] };
    }
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });

  if (!user || user.isActive === false) {
    if (optional) return { userId, session: null, user: null, roles: [], permissions: [] };
    const err = new Error("unauthorized");
    err.status = 401;
    throw err;
  }

  const kind = String(user.kind || "");
  const isStaffKind = kind === "STAFF_ONLY" || kind === "CUSTOMER_AND_STAFF";
  if (kind && !isStaffKind) {
    if (optional) return { userId, session: null, user, roles: [], permissions: [] };
    const err = new Error("forbidden");
    err.status = 403;
    throw err;
  }

  if (!isAdminRole(user)) {
    if (optional) {
      return {
        userId,
        session: null,
        user,
        roles: sortAdminRoles(userRoles(user)),
        permissions: normalizePerms(Array.from(permissionsFor(user))),
      };
    }
    const err = new Error("forbidden");
    err.status = 403;
    throw err;
  }

  const roles = sortAdminRoles(userRoles(user));
  const permSet = permissionsFor(user);
  const perms = normalizePerms(Array.from(permSet));

  const required = [];
  if (permission) required.push(permission);
  if (Array.isArray(extraPerms)) required.push(...extraPerms);

  if (required.length) {
    const ok = required.some((p) => hasPermission(user, p));
    if (!ok) {
      if (optional) return { userId, session: null, user, roles, permissions: perms };
      const err = new Error("forbidden");
      err.status = 403;
      throw err;
    }
  } else {
    void RbacPermissions;
  }

  return {
    userId,
    session: null,
    user,
    roles,
    permissions: perms,
    authSource: "admin_nextauth",
  };
}

// ✅ Useful exports (no breaking changes)
export { normalizePhone, detectIdentifier };
