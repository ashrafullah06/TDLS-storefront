// FILE: app/api/admin/auth/verify-otp/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import bcrypt from "bcryptjs";

/* ───────────────── env ───────────────── */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
const OTP_SECRET = requireEnv("OTP_SECRET");
const OTP_DEBUG = process.env.OTP_DEBUG === "1";

// Prefer admin TTL if present (keeps existing fallback behavior)
const OTP_TTL_SECONDS = Math.max(
  1,
  Number.parseInt(
    process.env.ADMIN_OTP_TTL_SECONDS || process.env.OTP_TTL_SECONDS || "90",
    10
  )
);

// FIX: Admin session TTL must be independent from OTP TTL (default 12 hours).
const ADMIN_SESSION_MAX_SECONDS = Math.max(
  60,
  Number.parseInt(
    process.env.ADMIN_SESSION_MAX_SECONDS ||
      process.env.ADMIN_SESSION_TTL_SECONDS ||
      process.env.OTP_SESSION_MAX_SECONDS ||
      "43200",
    10
  )
);

/* ───────────────── constants ───────────────── */
const IDEMPOTENT_MS = 3 * 60 * 1000;

// FIX: OTP session cookie lifetime must follow ADMIN session TTL, not OTP TTL
const OTP_SESSION_MAX_SECONDS = ADMIN_SESSION_MAX_SECONDS;

// ADMIN-only cookies
const ADMIN_OTP_SESSION_COOKIE = "otp_session_admin";
// Compatibility cookie (middleware accepts it too)
const ADMIN_SESSION_COOKIE = "admin_session";

/* ───────────────── identifier helpers ───────────────── */
const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

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

function detectIdentifier(raw) {
  const val = String(raw || "").trim();
  if (!val) return { type: null, email: null, phone: null };

  if (isEmail(val)) {
    const email = val.toLowerCase();
    return { type: "email", email, phone: null };
  }

  const phoneDigits = normalizePhone(val);
  if (phoneDigits) {
    return { type: "phone", email: null, phone: phoneDigits };
  }

  return { type: null, email: null, phone: null };
}

/* ───────────────── admin eligibility ───────────────── */
const ADMIN_ALLOWED_ROLES = new Set([
  "superadmin",
  "admin",
  "staff",
  "manager",
  "ops",
  "finance",
  "analyst",
]);

// Strong normalizer: spaces/hyphens -> underscores, then a compact variant
function normalizeRoleName(v) {
  const raw = String(v || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
}
function roleVariants(v) {
  const n = normalizeRoleName(v);
  if (!n) return [];
  const compact = n.replace(/_/g, "");
  return Array.from(new Set([n, compact]));
}

function userAdminRoleNames(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const names = [];

  for (const ur of roles) {
    const r = ur?.role || {};
    if (r?.name) names.push(r.name);
    else if (r?.slug) names.push(r.slug);
    else if (r?.key) names.push(r.key);
  }

  // include variants so "Super Admin" matches "superadmin"
  return names.flatMap(roleVariants).filter(Boolean);
}

function isAdminEligibleUser(user) {
  if (!user) return false;
  if (user?.isActive === false) return false;

  const kind = normalizeRoleName(user?.kind);
  const hasStaffProfile = !!user?.staffProfile;

  if (kind === "staff_only" || kind === "customer_and_staff") return true;
  if (hasStaffProfile) return true;

  const roleNames = userAdminRoleNames(user);
  if (roleNames.some((n) => ADMIN_ALLOWED_ROLES.has(n))) return true;

  return false;
}

/* ───────────────── hash helpers ───────────────── */
function asBuf(any) {
  if (any == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(any)) return any;
  if (any instanceof Uint8Array) return Buffer.from(any);
  const str = String(any);
  if (/^[0-9a-f]{64}$/i.test(str)) {
    try {
      return Buffer.from(str, "hex");
    } catch {}
  }
  if (/^[A-Za-z0-9+/=]+$/.test(str)) {
    try {
      const b = Buffer.from(str, "base64");
      if (b.length) return b;
    } catch {}
  }
  return Buffer.from(str, "utf8");
}
function timingEq(a, b) {
  const A = asBuf(a),
    B = asBuf(b);
  if (A.length !== B.length) return false;
  try {
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}
function looksLikeBcrypt(s) {
  return typeof s === "string" && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(s);
}

function buildPlainCandidates({ userId, identifier, purpose, code }) {
  return [
    `${userId}:${purpose}:${code}`,
    `${identifier}:${purpose}:${code}`,
    `${userId}:${code}`,
    `${identifier}:${code}`,
  ];
}

async function rowMatches(row, inputs, secret) {
  for (const input of inputs) {
    if (looksLikeBcrypt(row.codeHash)) {
      const ok = await bcrypt.compare(input, row.codeHash).catch(() => false);
      if (ok) return `bcrypt:${input.slice(0, 6)}…`;
    } else {
      const hex = crypto.createHmac("sha256", secret).update(input).digest("hex");
      const b64 = crypto.createHmac("sha256", secret).update(input).digest("base64");
      if (timingEq(row.codeHash, hex)) return "hmac:hex";
      if (timingEq(row.codeHash, b64)) return "hmac:b64";
      if (timingEq(row.codeHash, input)) return "raw";
    }
  }
  return null;
}

/* ───────────────── purpose normalization ───────────────── */
function normalizePurpose(purposeRaw) {
  const p = String(purposeRaw || "").trim().toLowerCase();
  const map = {
    admin_login: "rbac_login",
    staff_login: "rbac_login",
    elevate: "rbac_elevate",
    sudo_action: "rbac_sensitive_action",
    reset_password: "password_change",
    forgot_password: "password_change",
  };
  const norm = map[p] || p;

  const allowed = new Set([
    "rbac_login",
    "rbac_elevate",
    "rbac_sensitive_action",
    "password_change",
  ]);

  return allowed.has(norm) ? norm : "rbac_login";
}

/* ───────────────── otp-session (short-lived) ───────────────── */
function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signOtpSession({ uid, identifier, purpose, ttlSeconds }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(1, Math.min(ttlSeconds, OTP_SESSION_MAX_SECONDS));
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    ver: 1,
    sid: crypto.randomUUID(),
    uid,
    idf: identifier || null,
    pur: purpose,
    iat: now,
    exp,
    scope: "admin",
  };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", OTP_SECRET)
    .update(`${h}.${p}`)
    .digest("base64url");
  const token = `${h}.${p}.${sig}`;
  return { token, exp };
}

function cookieSerialize(name, value, opts = {}) {
  const parts = [`${name}=${value ?? ""}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.httpOnly) parts.push(`HttpOnly`);
  if (opts.secure) parts.push(`Secure`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.expires instanceof Date) parts.push(`Expires=${opts.expires.toUTCString()}`);
  return parts.join("; ");
}

/* ───────────────── handler ───────────────── */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawId = String(body?.identifier || body?.to || "").trim();
    const code = String(body?.code || "").trim();
    const purposeInput = normalizePurpose(body?.purpose || "rbac_login");

    if (!rawId)
      return NextResponse.json(
        { error: "MISSING_IDENTIFIER", resetTimer: true, canRequestNewOtp: true },
        { status: 400 }
      );
    if (!/^\d{6}$/.test(code))
      return NextResponse.json(
        { error: "INVALID_CODE", resetTimer: true, canRequestNewOtp: true },
        { status: 400 }
      );

    const parsed = detectIdentifier(rawId);
    if (!parsed.type)
      return NextResponse.json(
        { error: "INVALID_IDENTIFIER", resetTimer: true, canRequestNewOtp: true },
        { status: 400 }
      );

    const whereUser = parsed.type === "email" ? { email: parsed.email } : { phone: parsed.phone };

    // Must be admin/staff (robust check: kind/staffProfile/roles)
    const user = await prisma.user.findFirst({
      where: whereUser,
      include: {
        roles: { include: { role: true } },
        staffProfile: true,
      },
    });

    if (!user)
      return NextResponse.json(
        { error: "USER_NOT_FOUND", resetTimer: true, canRequestNewOtp: true },
        { status: 404 }
      );
    if (!isAdminEligibleUser(user))
      return NextResponse.json(
        { error: "NOT_ADMIN", resetTimer: true, canRequestNewOtp: false },
        { status: 403 }
      );

    const now = new Date();

    const identifierCanonical =
      parsed.type === "email"
        ? String(user.email || parsed.email || "").toLowerCase()
        : String(user.phone || parsed.phone || "");

    const [activeRows, recentConsumed] = await Promise.all([
      prisma.otpCode.findMany({
        where: {
          userId: user.id,
          consumedAt: null,
          expiresAt: { gte: now },
          purpose: purposeInput,
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          codeHash: true,
          attemptCount: true,
          maxAttempts: true,
          expiresAt: true,
          purpose: true,
          createdAt: true,
          consumedAt: true,
        },
      }),
      prisma.otpCode.findMany({
        where: {
          userId: user.id,
          purpose: purposeInput,
          consumedAt: { gte: new Date(now.getTime() - IDEMPOTENT_MS) },
        },
        orderBy: { consumedAt: "desc" },
        take: 5,
        select: {
          id: true,
          codeHash: true,
          expiresAt: true,
          purpose: true,
          createdAt: true,
          consumedAt: true,
        },
      }),
    ]);

    if (!activeRows.length && !recentConsumed.length) {
      return NextResponse.json(
        { error: "OTP_NOT_FOUND_OR_EXPIRED", resetTimer: true, canRequestNewOtp: true },
        { status: 410 }
      );
    }

    let matchedRow = null;
    let matchedWhy = null;

    // 1) active
    for (const row of activeRows) {
      const inputs = buildPlainCandidates({
        userId: user.id,
        identifier: identifierCanonical,
        purpose: purposeInput,
        code,
      });
      const why = await rowMatches(row, inputs, OTP_SECRET);
      if (why) {
        matchedRow = row;
        matchedWhy = `active:${why}:${purposeInput}`;
        break;
      }
    }

    // 2) idempotent replay (network retry) — still resets timer on client
    if (!matchedRow && recentConsumed.length) {
      for (const row of recentConsumed) {
        const inputs = buildPlainCandidates({
          userId: user.id,
          identifier: identifierCanonical,
          purpose: purposeInput,
          code,
        });
        const why = await rowMatches(row, inputs, OTP_SECRET);
        if (why) {
          // FIX: Do NOT derive admin session TTL from OTP row expiresAt (may be consumed/forced expired).
          const ttlSeconds = OTP_SESSION_MAX_SECONDS;

          const { token, exp } = signOtpSession({
            uid: user.id,
            identifier: identifierCanonical,
            purpose: purposeInput,
            ttlSeconds,
          });

          const res = NextResponse.json({
            ok: true,
            ttlSeconds,
            userId: user.id,
            idempotent: true,
            resetTimer: true,
            canRequestNewOtp: true,
            matched: OTP_DEBUG ? `recent-consumed:${why}:${purposeInput}` : undefined,
            otpSession: token,
            otpSessionExp: exp,
            purpose: purposeInput,
          });

          const cookieOpts = {
            maxAge: ttlSeconds,
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "Lax",
            path: "/",
          };

          res.headers.append(
            "Set-Cookie",
            cookieSerialize(ADMIN_OTP_SESSION_COOKIE, token, cookieOpts)
          );
          res.headers.append("Set-Cookie", cookieSerialize(ADMIN_SESSION_COOKIE, token, cookieOpts));

          return res;
        }
      }
    }

    // mismatch
    if (!matchedRow) {
      // RULE: timer must go out after failed verification
      // If there is an active OTP, consume it immediately so user can request a new one.
      if (activeRows.length) {
        const newest = activeRows[0];
        const consumedAt = new Date();

        const updated = await prisma.otpCode.update({
          where: { id: newest.id },
          data: {
            attemptCount: { increment: 1 },
            consumedAt,
            expiresAt: consumedAt, // end timer immediately
          },
          select: { attemptCount: true, maxAttempts: true },
        });

        const attemptsLeft = Math.max(
          0,
          (updated.maxAttempts ?? 5) - (updated.attemptCount ?? 0)
        );

        return NextResponse.json(
          OTP_DEBUG
            ? {
                error: "OTP_MISMATCH",
                attemptsLeft,
                resetTimer: true,
                canRequestNewOtp: true,
                debug: { activeCount: activeRows.length, recentConsumed: recentConsumed.length },
              }
            : { error: "OTP_MISMATCH", attemptsLeft, resetTimer: true, canRequestNewOtp: true },
          { status: 401 }
        );
      }

      // If only recentConsumed existed but did not match, still reset timer client-side.
      return NextResponse.json(
        { error: "OTP_MISMATCH", resetTimer: true, canRequestNewOtp: true },
        { status: 401 }
      );
    }

    // consume (success)
    const consumedAt = new Date();

    const tx = [
      prisma.otpCode.update({
        where: { id: matchedRow.id },
        data: { consumedAt, expiresAt: consumedAt }, // end timer immediately on success too
      }),
    ];

    if (parsed.type === "phone") {
      tx.push(
        prisma.user.update({
          where: { id: user.id },
          data: { phoneVerifiedAt: consumedAt },
        })
      );
    }

    await prisma.$transaction(tx);

    // FIX: Do NOT tie admin session TTL to OTP remaining time.
    const ttlSeconds = OTP_SESSION_MAX_SECONDS;

    const { token, exp } = signOtpSession({
      uid: user.id,
      identifier: identifierCanonical,
      purpose: purposeInput,
      ttlSeconds,
    });

    const res = NextResponse.json({
      ok: true,
      ttlSeconds,
      userId: user.id,
      resetTimer: true,
      canRequestNewOtp: true,
      matched: OTP_DEBUG ? matchedWhy : undefined,
      otpSession: token,
      otpSessionExp: exp,
      purpose: purposeInput,
    });

    const cookieOpts = {
      maxAge: ttlSeconds,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
    };

    res.headers.append("Set-Cookie", cookieSerialize(ADMIN_OTP_SESSION_COOKIE, token, cookieOpts));
    res.headers.append("Set-Cookie", cookieSerialize(ADMIN_SESSION_COOKIE, token, cookieOpts));

    return res;
  } catch (e) {
    console.error("[admin/verify-otp] error", e);
    return NextResponse.json(
      { error: "OTP_VERIFY_FAILED", resetTimer: true, canRequestNewOtp: true },
      { status: 500 }
    );
  }
}
