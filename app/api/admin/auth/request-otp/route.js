// FILE: app/api/admin/auth/request-otp/route.js
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

function jsonNoStore(body, status = 200) {
  return NextResponse.json(body ?? null, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function getClientIp(req) {
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",")[0].trim();
  const xreal = req.headers.get("x-real-ip");
  if (xreal) return xreal.trim();
  return "0.0.0.0";
}

function isEmail(value) {
  const s = String(value || "").trim();
  return !!s && /\S+@\S+\.\S+/.test(s);
}

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
  const ms = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 1000));
}

async function advisoryLock(tx, key) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
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
  console.info("[otp-audit]", event);
}

/**
 * Guard any provider call so the request cannot hang too long.
 */
async function withTimeout(promise, ms, label) {
  const t = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}ms`)), ms)
  );
  return Promise.race([promise, t]);
}

function isTimeoutErrorMessage(msg) {
  const s = String(msg || "");
  return /_TIMEOUT_\d+ms$/.test(s);
}

/**
 * Provider send wrapper:
 * - SUCCESS if promise resolves (even if it resolves undefined)
 * - FAILURE only if it throws / times out / or returns explicit false
 * - retries without artificial delay (fast)
 */
async function safeProviderSend({
  label,
  timeoutMs,
  attempts = 2,
  fn, // () => Promise<any>
}) {
  let lastErr = null;

  for (let i = 1; i <= attempts; i++) {
    try {
      const val = await withTimeout(Promise.resolve().then(fn), timeoutMs, label);

      if (val === false) {
        lastErr = new Error(`${label}_RETURNED_FALSE`);
      } else {
        return { ok: true, attempt: i };
      }
    } catch (e) {
      lastErr = e;
    }
    // IMPORTANT: no backoff delay
  }

  return {
    ok: false,
    attempt: attempts,
    error: lastErr ? String(lastErr?.message || lastErr) : `${label}_FAILED`,
  };
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
    else if (r?.slug) names.push(r.slug);
    else if (r?.key) names.push(r.key);
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

/* ------------------------------ route ------------------------------ */
export async function POST(req) {
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") || "";

  const t0 = Date.now();
  const timingsMs = {};
  const mark = (k) => (timingsMs[k] = Date.now() - t0);

  // ✅ DEFAULT ASYNC for admin OTP (instant response). Opt-out only if explicitly false.
  const ASYNC_SEND_ENV = String(process.env.ADMIN_OTP_ASYNC_SEND || "").toLowerCase().trim();
  const ASYNC_SEND = ASYNC_SEND_ENV
    ? !(ASYNC_SEND_ENV === "0" || ASYNC_SEND_ENV === "false" || ASYNC_SEND_ENV === "no")
    : true;

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
    const ttl = Math.min(TTL_MAX, Math.max(TTL_MIN, ttlFromEnv));

    // schema-safe role select (no slug/key)
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

    if (!isAdminEligibleUser(user)) {
      const idKey = parsed.type === "email" ? parsed.email : parsed.phone;
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
        identifierKey: parsed.type === "email" ? parsed.email : parsed.phone,
      });
      mark("passwordVerify");
      if (!v.ok) {
        return jsonNoStore({ error: v.error, timingsMs }, v.status);
      }
    }

    const idKey = parsed.type === "email" ? parsed.email : parsed.phone;

    const rl = await rateLimitOrPass({
      namespace: "otp:admin",
      key: `${ip}:${idKey}`,
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
        429
      );
    }

    const now = new Date();

    // SINGLE-OTP RULE:
    // If an active OTP exists, do NOT send a new one. Return remaining seconds.
    const result = await prisma.$transaction(async (tx) => {
      const lockKey = `admin-otp:${user.id}:${purpose}`;
      await advisoryLock(tx, lockKey);

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
        };
      }

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

      const expiresAt = new Date(now.getTime() + ttl * 1000);

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
            v: 3,
            scope: "admin",
          }),
        },
        select: { id: true },
      });

      return {
        kind: "created",
        ttlSeconds: ttl,
        resendAfterSeconds: ttl,
        code,
        channel: resolvedChannel,
        createdId: created.id,
        expiresAt,
      };
    });

    mark("dbTransaction");

    if (result.kind === "alreadyActive") {
      await auditOtpEvent({
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

    await auditOtpEvent({
      scope: "admin",
      event: "requested",
      purpose,
      identifier: idKey,
      channel: result.channel,
      ip,
      ua,
      otpId: result.createdId,
    });

    const brand = process.env.BRAND_NAME || "TDLC";

    async function invalidateCreatedOtp(reason) {
      try {
        await prisma.otpCode.update({
          where: { id: result.createdId },
          data: { consumedAt: now, expiresAt: now },
        });
      } catch (e) {
        console.error("[admin/request-otp] invalidate failed", reason, e);
      }
      await auditOtpEvent({
        scope: "admin",
        event: "send_failed",
        purpose,
        identifier: idKey,
        channel: result.channel,
        ip,
        ua,
        otpId: result.createdId,
        reason,
      });
    }

    // ✅ For sync mode: email can take longer than 2000ms because SMTP/fallback happens under sendOtpEmail().
    // Keep it bounded, but not so low that it creates false failures.
    const SEND_TIMEOUT_MS = Number.parseInt(
      process.env.ADMIN_OTP_SEND_TIMEOUT_MS || "12000",
      10
    );

    // Keep attempts for SMS/WhatsApp. For email we let sendOtpEmail handle failover internally (single call).
    const SEND_ATTEMPTS = Number.parseInt(
      process.env.ADMIN_OTP_SEND_ATTEMPTS || "2",
      10
    );

    const runSend = async () => {
      if (result.channel === "EMAIL") {
        const targetEmail = String(user.email || parsed.email || "").toLowerCase();
        if (!targetEmail) {
          await invalidateCreatedOtp("EMAIL_TARGET_MISSING");
          return { ok: false, error: "EMAIL_TARGET_MISSING", channel: "EMAIL" };
        }

        // ✅ IMPORTANT:
        // - Do NOT wrap sendOtpEmail in the previous 2000ms safeProviderSend.
        // - sendOtpEmail already includes SMTP multi-provider + Resend failover.
        // - We pass meta.otpId to reduce duplicates across retries/fallback.
        try {
          await sendOtpEmail({
            to: targetEmail,
            code: result.code,
            ttlSeconds: result.ttlSeconds,
            purpose,
            brand,
            meta: { otpId: result.createdId, purpose, scope: "admin" },
          });

          await auditOtpEvent({
            scope: "admin",
            event: "sent",
            purpose,
            identifier: targetEmail,
            channel: "EMAIL",
            ip,
            ua,
            otpId: result.createdId,
          });

          return { ok: true, channel: "EMAIL" };
        } catch (e) {
          const msg = String(e?.message || e);
          console.error("[admin/request-otp] email send failed:", msg);

          // ✅ TIMEOUT SAFETY:
          // If a timeout happens at the HTTP/request layer, the email may still be delivered.
          // Never invalidate the OTP on timeout — this is the key fix for "OTP arrived but EMAIL_SEND_FAILED".
          if (isTimeoutErrorMessage(msg)) {
            await auditOtpEvent({
              scope: "admin",
              event: "send_pending",
              purpose,
              identifier: targetEmail,
              channel: "EMAIL",
              ip,
              ua,
              otpId: result.createdId,
              reason: `EMAIL_SEND_PENDING:${msg}`,
            });
            return { ok: true, channel: "EMAIL", pending: true };
          }

          await invalidateCreatedOtp(`EMAIL_SEND_FAILED:${msg}`);
          return { ok: false, error: "EMAIL_SEND_FAILED", channel: "EMAIL" };
        }
      }

      if (result.channel === "SMS") {
        const phoneDigitsOut = parsed.phone || user.phone || null;
        if (!phoneDigitsOut) {
          await invalidateCreatedOtp("PHONE_TARGET_MISSING");
          return { ok: false, error: "PHONE_TARGET_MISSING", channel: "SMS" };
        }

        const sent = await safeProviderSend({
          label: "SMS_SEND",
          timeoutMs: SEND_TIMEOUT_MS,
          attempts: Math.max(1, SEND_ATTEMPTS),
          fn: () =>
            sendOtpSms({
              to: phoneDigitsOut,
              code: result.code,
              ttlSeconds: result.ttlSeconds,
              purpose,
              brand,
            }),
        });

        if (!sent.ok) {
          console.error("[admin/request-otp] sms send failed:", sent.error);
          await invalidateCreatedOtp(`SMS_SEND_FAILED:${sent.error}`);
          return { ok: false, error: "SMS_SEND_FAILED", channel: "SMS" };
        }

        await auditOtpEvent({
          scope: "admin",
          event: "sent",
          purpose,
          identifier: phoneDigitsOut,
          channel: "SMS",
          ip,
          ua,
          otpId: result.createdId,
        });

        return { ok: true, channel: "SMS" };
      }

      if (result.channel === "WHATSAPP") {
        const phoneDigitsOut = parsed.phone || user.phone || null;
        const phoneE164Out = phoneDigitsOut ? `+${phoneDigitsOut}` : null;
        if (!phoneE164Out) {
          await invalidateCreatedOtp("WHATSAPP_TARGET_MISSING");
          return {
            ok: false,
            error: "WHATSAPP_TARGET_MISSING",
            channel: "WHATSAPP",
          };
        }

        const sent = await safeProviderSend({
          label: "WHATSAPP_SEND",
          timeoutMs: SEND_TIMEOUT_MS,
          attempts: Math.max(1, SEND_ATTEMPTS),
          fn: () =>
            sendOtpWhatsApp({
              to: phoneE164Out,
              code: result.code,
              ttlSeconds: result.ttlSeconds,
              purpose,
              brand,
            }),
        });

        if (!sent.ok) {
          console.error("[admin/request-otp] whatsapp send failed:", sent.error);
          await invalidateCreatedOtp(`WHATSAPP_SEND_FAILED:${sent.error}`);
          return { ok: false, error: "WHATSAPP_SEND_FAILED", channel: "WHATSAPP" };
        }

        await auditOtpEvent({
          scope: "admin",
          event: "sent",
          purpose,
          identifier: phoneE164Out,
          channel: "WHATSAPP",
          ip,
          ua,
          otpId: result.createdId,
        });

        return { ok: true, channel: "WHATSAPP" };
      }

      await invalidateCreatedOtp("CHANNEL_UNSUPPORTED");
      return { ok: false, error: "CHANNEL_UNSUPPORTED", channel: "UNKNOWN" };
    };

    if (ASYNC_SEND) {
      const enqueue = (fn) => {
        try {
          if (typeof setImmediate === "function") setImmediate(fn);
          else setTimeout(fn, 0);
        } catch {
          setTimeout(fn, 0);
        }
      };

      await auditOtpEvent({
        scope: "admin",
        event: "send_queued",
        purpose,
        identifier: idKey,
        channel: result.channel,
        ip,
        ua,
        otpId: result.createdId,
      });

      mark("sendQueued");
      mark("done");

      enqueue(() => {
        void (async () => {
          try {
            await runSend();
          } catch (e) {
            const msg = String(e?.message || e);
            console.error("[admin/request-otp] async send crash", msg);
            // async crash should invalidate because nothing was sent by this code path
            try {
              await invalidateCreatedOtp("ASYNC_SEND_CRASH");
            } catch {}
          }
        })();
      });

      // ✅ Always respond success instantly (admin UI should open OTP modal immediately)
      return jsonNoStore(
        {
          ok: true,
          sent: true,
          delivery: "async",
          ttlSeconds: result.ttlSeconds,
          resendAfterSeconds: result.resendAfterSeconds,
          channel: result.channel,
          purpose,
          timingsMs,
        },
        200
      );
    }

    // Sync path (only if ADMIN_OTP_ASYNC_SEND explicitly disabled)
    const sendRes = await withTimeout(runSend(), SEND_TIMEOUT_MS, "ADMIN_SEND");
    mark("sendProvider");

    if (!sendRes.ok) {
      mark("done");
      return jsonNoStore({ error: sendRes.error || "SEND_FAILED", timingsMs }, 502);
    }

    mark("done");
    return jsonNoStore(
      {
        ok: true,
        sent: true,
        delivery: sendRes.pending ? "pending" : "sync",
        ttlSeconds: result.ttlSeconds,
        resendAfterSeconds: result.resendAfterSeconds,
        channel: sendRes.channel,
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
