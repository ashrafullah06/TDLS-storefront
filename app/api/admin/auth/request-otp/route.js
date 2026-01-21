// FILE: app/api/admin/auth/request-otp/route.js
// PURPOSE (Admin OTP):
// - Responds after the provider call is CONFIRMED (accepted) OR the provider-ack hard timeout elapses.
// - If provider send FAILS (explicit false / error) -> OTP is immediately consumed/expired (never remains active).
// - If provider ack TIMES OUT -> treat as "PENDING" (unknown outcome): do NOT consume OTP; return ok:true.
// - If an active OTP exists, we return it and do NOT re-send (single-OTP rule, cross-channel).
// - Concurrency-safe per user+purpose using PG advisory lock (try-lock + short poll; avoids request pile-ups).
//
// IMPORTANT (production reliability):
// - No fire-and-forget sending after the HTTP response. Background tasks are not reliable on serverless.
//   This route sends synchronously with a bounded ack timeout (same contract as customer OTP).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { sendOtpEmail } from "@/lib/email";
import { sendOtpSms } from "@/lib/sms";
import { sendOtpWhatsapp as sendOtpWhatsApp } from "@/lib/whatsapp";

/* ------------------------------------------------------------------ */
/* Admin OTP purposes (RBAC + Admin Recovery)                          */
/* ------------------------------------------------------------------ */
const ALLOWED_ADMIN_PURPOSES = new Set([
  "rbac_login",
  "rbac_elevate",
  "rbac_sensitive_action",
  "password_change",
]);

/**
 * Admin roles allowed to receive admin OTP.
 */
const ADMIN_ALLOWED_ROLES = new Set([
  "superadmin",
  "admin",
  "staff",
  "manager",
  "ops",
  "finance",
  "analyst",
]);

/* ---------------------------- helpers ---------------------------- */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function jsonNoStore(body, status = 200, extraHeaders = undefined) {
  return NextResponse.json(body ?? null, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(extraHeaders || {}),
    },
  });
}

function getClientIp(req) {
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",")[0].trim();
  const xreal = req.headers.get("x-real-ip");
  if (xreal) return xreal.trim();
  return "0.0.0.0";
}

function getUserAgent(req) {
  return req.headers.get("user-agent") || "";
}

function isEmail(value) {
  const s = String(value || "").trim();
  return !!s && /\S+@\S+\.\S+/.test(s);
}

/**
 * Phone normalization:
 * - Prefers Bangladesh mobile normalization (same as customer flow) to avoid provider rejects.
 * - For non-BD numbers: accepts E.164-like digits length 8–15 IF user includes country code (+CC...).
 * Returns digits-only (no "+") or null.
 */
function normalizePhone(raw) {
  if (!raw) return null;

  let s = String(raw).trim();
  if (!s) return null;

  // keep digits and "+"
  s = s.replace(/[^\d+]/g, "");

  // 00-prefixed international -> +
  if (s.startsWith("00")) s = "+" + s.slice(2);

  // "+0..." -> treat as local "0..."
  if (s.startsWith("+0")) s = s.slice(1);

  // strip "+"
  let digits = s.startsWith("+") ? s.slice(1) : s;

  // --- Bangladesh normalization (preferred) ---
  // common legacy mistake: 8800 1XXXXXXXXX -> 8801XXXXXXXXX
  const m8800 = digits.match(/^8800(1\d{9})$/);
  if (m8800) digits = "880" + m8800[1];

  // 08801XXXXXXXXX -> 8801XXXXXXXXX
  if (/^0880\d{10}$/.test(digits)) digits = "880" + digits.slice(4);

  // 008801XXXXXXXXX -> 8801XXXXXXXXX (some UIs keep leading 00 in digits-only)
  if (/^00880\d{10}$/.test(digits)) digits = "880" + digits.slice(5);

  // 01XXXXXXXXX -> 8801XXXXXXXXX
  if (/^0\d{10}$/.test(digits)) digits = "880" + digits.slice(1);

  // 1XXXXXXXXX (10 digits) -> 8801XXXXXXXXX
  if (/^1\d{9}$/.test(digits)) digits = "880" + digits;

  // If it looks like BD mobile, enforce strict BD pattern.
  if (digits.startsWith("8801") || digits.startsWith("01") || digits.startsWith("1")) {
    if (!/^8801\d{9}$/.test(digits)) return null;

    // operator/prefix sanity (013–019; 011 legacy)
    const prefix = digits.slice(3, 5);
    const allowed = new Set(["13", "14", "15", "16", "17", "18", "19", "11"]);
    if (!allowed.has(prefix)) return null;

    return digits;
  }

  // --- Fallback: accept non-BD E.164 digits (must include country code) ---
  // If the user provided "+CC..." we already stripped '+' above.
  // Guard to prevent sending local-only numbers without country code.
  if (s.startsWith("+")) {
    const len = digits.length;
    if (len >= 8 && len <= 15) return digits;
  }

  return null;
}

function detectIdentifier(raw) {
  const val = String(raw || "").trim();
  if (!val) return { type: null, email: null, phone: null, e164: null };

  if (isEmail(val)) {
    const email = val.toLowerCase();
    return { type: "email", email, phone: null, e164: null };
  }

  const phoneDigits = normalizePhone(val);
  if (phoneDigits) {
    const e164 = `+${phoneDigits}`;
    return { type: "phone", email: null, phone: phoneDigits, e164 };
  }

  return { type: null, email: null, phone: null, e164: null };
}

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
  return ALLOWED_ADMIN_PURPOSES.has(norm) ? norm : "rbac_login";
}

function buildPlainCandidates({ userId, identifier, purpose, code }) {
  return [
    `${userId}:${purpose}:${code}`,
    `${identifier}:${purpose}:${code}`,
    `${userId}:${code}`,
    `${identifier}:${code}`,
  ];
}

function buildCodeHash({ userId, identifier, purpose, code, secret }) {
  const candidates = buildPlainCandidates({ userId, identifier, purpose, code });

  const primaryHex = crypto
    .createHmac("sha256", secret)
    .update(candidates[0])
    .digest("hex");

  const altBase64 = crypto
    .createHmac("sha256", secret)
    .update(candidates[0])
    .digest("base64");

  const rawSha256Hex = crypto
    .createHash("sha256")
    .update(candidates[0])
    .digest("hex");

  return { primaryHex, altBase64, rawSha256Hex };
}

function ttlRemainingSeconds(expiresAt, now = new Date()) {
  try {
    const ms = new Date(expiresAt).getTime() - new Date(now).getTime();
    return Math.max(0, Math.ceil(ms / 1000));
  } catch {
    return 0;
  }
}

function clampInt(n, lo, hi) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function isTimeoutErrorMessage(msg) {
  const s = String(msg || "");
  return /_TIMEOUT_\d+ms$/.test(s);
}

async function advisoryTryLock(tx, key) {
  // Non-blocking advisory lock (same pattern as customer OTP).
  const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS locked`;
  const locked = Array.isArray(rows) ? rows?.[0]?.locked : rows?.locked;
  return !!locked;
}

async function auditOtpEvent(event) {
  try {
    const model = prisma?.otpAudit;
    if (model?.create) {
      await model.create({ data: event });
      return;
    }
  } catch {
    // swallow, fallback to console
  }
  try {
    console.info("[otp-audit]", { ...event, ts: new Date().toISOString() });
  } catch {}
}

function auditOtpEventAsync(event) {
  try {
    setImmediate(() => {
      auditOtpEvent(event).catch(() => {});
    });
  } catch {
    // ignore
  }
}

/* ------------------- Upstash RL: cache imports + instances ------------------- */
let _upstashReady = false;
let _upstashFailed = false;
let _Ratelimit = null;
let _Redis = null;

let _upstashRedisClient = null;
const _rlInstanceCache = new Map(); // key => Ratelimit instance

async function initUpstashOnce() {
  if (_upstashReady || _upstashFailed) return;
  const hasUpstashEnv =
    !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!hasUpstashEnv) {
    _upstashFailed = true;
    return;
  }
  try {
    const [{ Ratelimit }, { Redis }] = await Promise.all([
      import("@upstash/ratelimit"),
      import("@upstash/redis"),
    ]);
    _Ratelimit = Ratelimit;
    _Redis = Redis;
    _upstashReady = true;
  } catch {
    _upstashFailed = true;
  }
}

function getUpstashRedisOnce() {
  if (_upstashRedisClient) return _upstashRedisClient;
  if (!_upstashReady || !_Redis) return null;
  _upstashRedisClient = new _Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _upstashRedisClient;
}

function getRatelimitInstance({ namespace, limit, windowSeconds }) {
  if (!_upstashReady || !_Ratelimit) return null;

  const key = `${namespace}|${limit}|${windowSeconds}`;
  const existing = _rlInstanceCache.get(key);
  if (existing) return existing;

  const redis = getUpstashRedisOnce();
  if (!redis) return null;

  const rl = new _Ratelimit({
    redis,
    limiter: _Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: false,
    prefix: namespace,
  });

  _rlInstanceCache.set(key, rl);
  return rl;
}

async function rateLimitOrPass({ namespace, key, limit, windowSeconds }) {
  // Optional: avoid adding latency if you disable Upstash RL
  const USE_UPSTASH =
    process.env.ADMIN_OTP_USE_UPSTASH_RL === "1" ||
    process.env.ADMIN_OTP_USE_UPSTASH_RL === "true";

  if (!USE_UPSTASH) return { ok: true };

  await initUpstashOnce();
  if (!_upstashReady || !_Ratelimit || !_Redis) return { ok: true };

  try {
    const rl = getRatelimitInstance({ namespace, limit, windowSeconds });
    if (!rl) return { ok: true };

    const res = await rl.limit(key);
    if (!res.success) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil(res.reset / 1000)),
      };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/* -------------------- admin eligibility + password verify -------------------- */
function normalizeRoleName(v) {
  return String(v || "").trim().toLowerCase();
}

function userAdminRoleNames(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const names = [];

  for (const ur of roles) {
    const r = ur?.role || {};
    if (r?.name) names.push(r.name);
  }

  return names.map(normalizeRoleName).filter(Boolean);
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

let _compareFn = null;
let _compareInit = false;

async function getPasswordCompareFn() {
  if (_compareFn) return _compareFn;
  if (_compareInit) return null;
  _compareInit = true;

  try {
    const mod = await import("bcryptjs");
    _compareFn = mod?.compare || mod?.default?.compare || null;
    if (_compareFn) return _compareFn;
  } catch {}

  return null;
}

async function verifyPasswordOrFail({
  user,
  passwordPlain,
  ip,
  ua,
  purpose,
  identifierKey,
}) {
  const pw = String(passwordPlain || "");
  if (!pw) {
    await auditOtpEvent({
      scope: "admin",
      event: "bad_password",
      purpose,
      identifier: identifierKey,
      channel: "N/A",
      ip,
      ua,
      reason: "PASSWORD_REQUIRED",
      userId: user?.id || null,
    });
    return { ok: false, status: 401, error: "PASSWORD_REQUIRED" };
  }

  const hash = String(user?.passwordHash || "");
  if (!hash) {
    await auditOtpEvent({
      scope: "admin",
      event: "bad_password",
      purpose,
      identifier: identifierKey,
      channel: "N/A",
      ip,
      ua,
      reason: "PASSWORD_NOT_SET",
      userId: user?.id || null,
    });
    return { ok: false, status: 401, error: "PASSWORD_NOT_SET" };
  }

  const compare = await getPasswordCompareFn();
  if (!compare) {
    await auditOtpEvent({
      scope: "admin",
      event: "bad_password",
      purpose,
      identifier: identifierKey,
      channel: "N/A",
      ip,
      ua,
      reason: "PASSWORD_VERIFIER_MISSING",
      userId: user?.id || null,
    });
    return { ok: false, status: 500, error: "PASSWORD_VERIFIER_MISSING" };
  }

  const ok = await compare(pw, hash);
  if (!ok) {
    await auditOtpEvent({
      scope: "admin",
      event: "bad_password",
      purpose,
      identifier: identifierKey,
      channel: "N/A",
      ip,
      ua,
      reason: "INVALID_CREDENTIALS",
      userId: user?.id || null,
    });
    return { ok: false, status: 401, error: "INVALID_CREDENTIALS" };
  }

  return { ok: true };
}

/**
 * Provider send contract (same semantics as customer):
 * - ok:true  => accepted/confirmed (no throw, no timeout, not explicit false)
 * - ok:false + reason: SEND_TIMEOUT => provider ack did not arrive (unknown outcome)
 * - ok:false + reason: SEND_ERROR / SEND_FAILED => explicit failure (consume OTP)
 */
async function sendOtpAndConfirm({
  otpId,
  channel,
  purpose,
  brand,
  code,
  ttlSeconds,
  email,
  phoneDigits,
  phoneE164,
  ip,
  ua,
  sendTimeoutMs,
  attempts = 1,
}) {
  const identifier = email || phoneDigits || phoneE164 || "";

  let sawTimeout = false;
  let lastNonTimeoutErr = null;

  for (let i = 1; i <= Math.max(1, attempts); i++) {
    try {
      let res;

      if (channel === "EMAIL") {
        res = await withTimeout(
          Promise.resolve().then(() =>
            sendOtpEmail({
              to: email,
              code,
              ttlSeconds,
              purpose,
              brand,
              meta: { otpId, purpose, scope: "admin" },
            })
          ),
          sendTimeoutMs,
          "EMAIL_SEND"
        );
      } else if (channel === "SMS") {
        res = await withTimeout(
          Promise.resolve().then(() =>
            sendOtpSms({ to: phoneDigits, code, ttlSeconds, purpose, brand })
          ),
          sendTimeoutMs,
          "SMS_SEND"
        );
      } else if (channel === "WHATSAPP") {
        res = await withTimeout(
          Promise.resolve().then(() =>
            sendOtpWhatsApp({ to: phoneE164, code, ttlSeconds, purpose, brand })
          ),
          sendTimeoutMs,
          "WHATSAPP_SEND"
        );
      } else {
        return { ok: false, reason: "CHANNEL_UNSUPPORTED" };
      }

      // accepted if not explicit false
      const ok = res !== false;

      auditOtpEventAsync({
        scope: "admin",
        event: ok ? "sent" : "send_failed",
        purpose,
        identifier,
        channel,
        ip,
        ua,
        otpId,
        meta: ok ? { attempt: i } : { attempt: i, returnedFalse: true },
      });

      if (ok) return { ok: true, reason: null, attempt: i };
      lastNonTimeoutErr = new Error("RETURNED_FALSE");
    } catch (e) {
      const msg = String(e?.message || e);
      if (isTimeoutErrorMessage(msg)) {
        sawTimeout = true;
        auditOtpEventAsync({
          scope: "admin",
          event: "send_timeout",
          purpose,
          identifier,
          channel,
          ip,
          ua,
          otpId,
          meta: { attempt: i, message: msg.slice(0, 220) },
        });
        // no backoff; try next attempt if available
        continue;
      }

      lastNonTimeoutErr = e;
      auditOtpEventAsync({
        scope: "admin",
        event: "send_error",
        purpose,
        identifier,
        channel,
        ip,
        ua,
        otpId,
        meta: { attempt: i, message: msg.slice(0, 220) },
      });
      // try next attempt (fast)
    }
  }

  if (sawTimeout && !lastNonTimeoutErr) return { ok: false, reason: "SEND_TIMEOUT" };
  if (sawTimeout) return { ok: false, reason: "SEND_TIMEOUT" }; // timeout dominates (unknown outcome)
  return { ok: false, reason: lastNonTimeoutErr ? "SEND_ERROR" : "SEND_FAILED" };
}

async function consumeOtpNow(otpId) {
  const now = new Date();
  try {
    await prisma.otpCode.update({
      where: { id: otpId },
      data: { consumedAt: now, expiresAt: now },
    });
  } catch {}
}

/* ------------------------------ route ------------------------------ */
export async function POST(req) {
  const ip = getClientIp(req);
  const ua = getUserAgent(req);

  const t0 = Date.now();
  const timingsMs = {};
  const mark = (k) => (timingsMs[k] = Date.now() - t0);

  try {
    const body = await req.json().catch(() => ({}));
    mark("parsedBody");

    const purpose = normalizePurpose(body?.purpose ?? "rbac_login");
    const { identifier, channel } = body || {};

    if (!ALLOWED_ADMIN_PURPOSES.has(purpose)) {
      return jsonNoStore({ error: "INVALID_PURPOSE", purpose }, 400);
    }

    const parsed = detectIdentifier(identifier);
    if (!parsed.type) {
      return jsonNoStore({ error: "IDENTIFIER_REQUIRED" }, 400);
    }

    const OTP_SECRET = requireEnv("OTP_SECRET");

    const adminTtlRaw =
      process.env.ADMIN_OTP_TTL_SECONDS ?? process.env.OTP_TTL_SECONDS;
    if (!adminTtlRaw) {
      throw new Error("ADMIN_OTP_TTL_SECONDS or OTP_TTL_SECONDS is required");
    }

    const ttlFromEnv = Number.parseInt(adminTtlRaw, 10);
    if (!Number.isFinite(ttlFromEnv) || ttlFromEnv <= 0) {
      return jsonNoStore({ error: "INVALID_TTL" }, 400);
    }

    const TTL_MIN = 60;
    const TTL_MAX = 210; // 3.5 minutes
    const ttlSeconds = Math.min(TTL_MAX, Math.max(TTL_MIN, ttlFromEnv));

    // Provider acknowledgement hard cap:
    // - Default: 6500ms (admin email can include provider failover)
    // - Min: 800ms
    // - Max: 12000ms
    const SEND_TIMEOUT_MS = clampInt(
      process.env.ADMIN_OTP_SEND_TIMEOUT_MS || "6500",
      800,
      12000
    );

    const SEND_ATTEMPTS = clampInt(
      process.env.ADMIN_OTP_SEND_ATTEMPTS || "2",
      1,
      3
    );

    // schema-safe role select (no slug/key)
    // NOTE: phone lookup uses canonical digits-only; require user input to include country code or BD patterns.
    const user =
      parsed.type === "email"
        ? await prisma.user.findFirst({
            where: { email: parsed.email },
            select: {
              id: true,
              email: true,
              phone: true,
              isActive: true,
              kind: true,
              passwordHash: true,
              staffProfile: { select: { id: true } },
              roles: { select: { role: { select: { id: true, name: true } } } },
            },
          })
        : await prisma.user.findFirst({
            where: { phone: parsed.phone },
            select: {
              id: true,
              email: true,
              phone: true,
              isActive: true,
              kind: true,
              passwordHash: true,
              staffProfile: { select: { id: true } },
              roles: { select: { role: { select: { id: true, name: true } } } },
            },
          });
    mark("userLookup");

    if (!user) return jsonNoStore({ error: "USER_NOT_FOUND" }, 404);

    let resolvedChannel = "EMAIL";
    if (parsed.type === "phone") {
      const upper = String(channel || "SMS").toUpperCase();
      resolvedChannel = upper === "WHATSAPP" ? "WHATSAPP" : "SMS";
    }

    const idKey = parsed.type === "email" ? parsed.email : parsed.phone;

    if (!isAdminEligibleUser(user)) {
      await auditOtpEvent({
        scope: "admin",
        event: "not_admin",
        purpose,
        identifier: idKey,
        channel: resolvedChannel,
        ip,
        ua,
        userId: user?.id || null,
      });
      return jsonNoStore({ error: "NOT_ADMIN" }, 403);
    }

    // For rbac_login we require valid password BEFORE sending OTP.
    if (purpose === "rbac_login") {
      const passwordPlain = body?.password;
      const v = await verifyPasswordOrFail({
        user,
        passwordPlain,
        ip,
        ua,
        purpose,
        identifierKey: idKey,
      });
      mark("passwordVerify");
      if (!v.ok) {
        return jsonNoStore({ error: v.error, timingsMs }, v.status);
      }
    }

    const rl = await rateLimitOrPass({
      namespace: "otp:admin",
      key: `${ip}:${idKey}:${purpose}`,
      limit: Number.parseInt(process.env.ADMIN_OTP_RATELIMIT_PER_MIN || "8", 10),
      windowSeconds: 60,
    });
    mark("rateLimit");

    if (!rl.ok) {
      await auditOtpEvent({
        scope: "admin",
        event: "rate_limited",
        purpose,
        identifier: idKey,
        channel: resolvedChannel,
        ip,
        ua,
      });
      return jsonNoStore(
        { error: "RATE_LIMITED", retryAfterSeconds: rl.retryAfterSeconds, timingsMs },
        429,
        { "retry-after": String(rl.retryAfterSeconds) }
      );
    }

    const now = new Date();

    // SINGLE-OTP RULE:
    // If an active OTP exists, do NOT send a new one. Return remaining seconds.
    // (Cross-channel: prevents confusion where EMAIL active blocks SMS and vice versa.)
    const result = await prisma.$transaction(async (tx) => {
      const lockKey = `admin-otp:${user.id}:${purpose}`;
      const locked = await advisoryTryLock(tx, lockKey);

      if (!locked) {
        // Another request is currently creating/refreshing OTP.
        // Poll briefly for an active OTP row instead of waiting on the lock.
        for (let i = 0; i < 8; i++) {
          const active2 = await tx.otpCode.findFirst({
            where: {
              userId: user.id,
              purpose,
              consumedAt: null,
              expiresAt: { gt: now },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, expiresAt: true, channel: true },
          });
          if (active2?.id) {
            const remaining = ttlRemainingSeconds(active2.expiresAt, now);
            return {
              kind: "alreadyActive",
              ttlSeconds: remaining,
              resendAfterSeconds: remaining,
              channel: active2.channel || resolvedChannel,
              existingId: active2.id,
              locked: false,
            };
          }
          await sleepMs(15);
        }
        return { kind: "busy" };
      }

      const existing = await tx.otpCode.findFirst({
        where: {
          userId: user.id,
          purpose,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, expiresAt: true, channel: true },
      });

      if (existing?.id) {
        const remaining = ttlRemainingSeconds(existing.expiresAt, now);
        return {
          kind: "alreadyActive",
          ttlSeconds: remaining,
          resendAfterSeconds: remaining,
          channel: existing.channel || resolvedChannel,
          existingId: existing.id,
          locked: true,
        };
      }

      // Ensure no other active OTPs remain for this user+purpose (defensive).
      await tx.otpCode.updateMany({
        where: { userId: user.id, purpose, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now, expiresAt: now },
      });

      const code = String(crypto.randomInt(100000, 1000000));
      const canonicalIdentifier =
        parsed.type === "email"
          ? String(user.email || parsed.email || "").toLowerCase()
          : String(user.phone || parsed.phone || "");

      const { primaryHex, altBase64, rawSha256Hex } = buildCodeHash({
        userId: user.id,
        identifier: canonicalIdentifier,
        purpose,
        code,
        secret: OTP_SECRET,
      });

      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      const created = await tx.otpCode.create({
        data: {
          userId: user.id,
          channel: resolvedChannel,
          purpose,
          codeHash: primaryHex,
          expiresAt,
          attemptCount: 0,
          maxAttempts: 5,
          fingerprint: JSON.stringify({
            alg: "HMAC-SHA256",
            base64: altBase64.slice(0, 16),
            rawsha: rawSha256Hex.slice(0, 16),
            v: 7,
            scope: "admin",
            mode: "sync_send_confirm",
          }),
        },
        select: { id: true, expiresAt: true },
      });

      return {
        kind: "created",
        ttlSeconds: ttlSeconds,
        resendAfterSeconds: ttlSeconds,
        code,
        channel: resolvedChannel,
        createdId: created.id,
        expiresAt,
      };
    });

    mark("dbTransaction");

    if (result.kind === "busy") {
      await auditOtpEventAsync({
        scope: "admin",
        event: "busy",
        purpose,
        identifier: idKey,
        channel: resolvedChannel,
        ip,
        ua,
      });
      mark("done");
      return jsonNoStore({ error: "OTP_BUSY_RETRY", timingsMs }, 409);
    }

    if (result.kind === "alreadyActive") {
      await auditOtpEventAsync({
        scope: "admin",
        event: "already_active",
        purpose,
        identifier: idKey,
        channel: result.channel,
        ip,
        ua,
        otpId: result.existingId,
      });

      mark("done");
      return jsonNoStore(
        {
          ok: true,
          sent: false,
          alreadyActive: true,
          ttlSeconds: result.ttlSeconds,
          resendAfterSeconds: result.resendAfterSeconds,
          channel: result.channel,
          purpose,
          timingsMs,
        },
        200
      );
    }

    await auditOtpEventAsync({
      scope: "admin",
      event: "requested",
      purpose,
      identifier: idKey,
      channel: result.channel,
      ip,
      ua,
      otpId: result.createdId,
    });

    const brand = process.env.BRAND_NAME || "TDLS";

    // Targets
    const targetEmail = String(user.email || parsed.email || "").toLowerCase();
    const phoneDigitsOut =
      parsed.type === "phone"
        ? normalizePhone(user.phone || parsed.phone || identifier) || parsed.phone
        : null;
    const phoneE164Out = phoneDigitsOut ? `+${phoneDigitsOut}` : null;

    // Guard targets
    if (result.channel === "EMAIL" && !targetEmail) {
      await consumeOtpNow(result.createdId);
      mark("done");
      return jsonNoStore({ error: "EMAIL_TARGET_MISSING", timingsMs }, 400);
    }
    if (result.channel === "SMS" && !phoneDigitsOut) {
      await consumeOtpNow(result.createdId);
      mark("done");
      return jsonNoStore({ error: "PHONE_TARGET_MISSING", timingsMs }, 400);
    }
    if (result.channel === "WHATSAPP" && !phoneE164Out) {
      await consumeOtpNow(result.createdId);
      mark("done");
      return jsonNoStore({ error: "WHATSAPP_TARGET_MISSING", timingsMs }, 400);
    }

    // Send (sync + bounded ack timeout) — same rule-set as customer OTP.
    const sendRes = await sendOtpAndConfirm({
      otpId: result.createdId,
      channel: result.channel,
      purpose,
      brand,
      code: result.code,
      ttlSeconds: result.ttlSeconds,
      email: result.channel === "EMAIL" ? targetEmail : null,
      phoneDigits: result.channel === "SMS" ? phoneDigitsOut : null,
      phoneE164: result.channel === "WHATSAPP" ? phoneE164Out : null,
      ip,
      ua,
      sendTimeoutMs: SEND_TIMEOUT_MS,
      attempts: result.channel === "EMAIL" ? 1 : SEND_ATTEMPTS,
    });
    mark("sendProvider");

    if (!sendRes.ok) {
      if (sendRes.reason === "SEND_TIMEOUT") {
        // Provider ack timed out => unknown outcome.
        // Do NOT consume OTP; user may still receive it. Let TTL handle expiry.
        await auditOtpEventAsync({
          scope: "admin",
          event: "send_pending",
          purpose,
          identifier: idKey,
          channel: result.channel,
          ip,
          ua,
          otpId: result.createdId,
          reason: `PROVIDER_ACK_TIMEOUT_${SEND_TIMEOUT_MS}ms`,
        });

        mark("done");
        return jsonNoStore(
          {
            ok: true,
            sent: true,
            delivery: "pending",
            pending: true,
            providerAckTimeoutMs: SEND_TIMEOUT_MS,
            ttlSeconds: ttlRemainingSeconds(result.expiresAt, new Date()),
            resendAfterSeconds: ttlRemainingSeconds(result.expiresAt, new Date()),
            channel: result.channel,
            purpose,
            timingsMs,
          },
          200
        );
      }

      // Explicit failure/error => consume immediately; never leave active OTP.
      await consumeOtpNow(result.createdId);

      await auditOtpEventAsync({
        scope: "admin",
        event: "send_failed",
        purpose,
        identifier: idKey,
        channel: result.channel,
        ip,
        ua,
        otpId: result.createdId,
        reason: String(sendRes.reason || "SEND_FAILED"),
      });

      mark("done");
      return jsonNoStore(
        { error: "OTP_DELIVERY_FAILED", reason: sendRes.reason, timingsMs },
        502
      );
    }

    mark("done");
    return jsonNoStore(
      {
        ok: true,
        sent: true,
        delivery: "sent",
        ttlSeconds: ttlRemainingSeconds(result.expiresAt, new Date()),
        resendAfterSeconds: ttlRemainingSeconds(result.expiresAt, new Date()),
        channel: result.channel,
        purpose,
        timingsMs,
      },
      200
    );
  } catch (err) {
    console.error("[admin/request-otp]", err);
    return jsonNoStore({ error: "REQUEST_OTP_FAILED" }, 500);
  }
}
