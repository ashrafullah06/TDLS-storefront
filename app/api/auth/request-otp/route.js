// FILE: app/api/auth/request-otp/route.js
// PURPOSE: ultra-fast response. Do NOT await the SMS/Email/WhatsApp provider.
// - Responds immediately after DB writes (typically < 200–600ms once DB is warm).
// - Kicks off OTP delivery in the background (best-effort) with a hard timeout.
// - Keeps existing purpose normalization + Bangladesh phone normalization.
// - Concurrency-safe per user+purpose via pg advisory lock.
// - Multi-user ready: each request is isolated; locks are per user+purpose only.
//
// IMPORTANT PERF FIXES (2026-01-04):
// - Email user lookup uses findUnique (indexed equality) instead of ILIKE to avoid slow scans.
// - Client "expire/cancel" action is handled with a single UPDATE (no user lookup + no rate-limit) for instant close behavior.
// - Upstash rate-limit is guarded with a very small max-latency budget (default 150ms). If RL is slow/unavailable, we pass.
// - Lock contention polling is capped aggressively (<= 120ms) to keep click-and-fire responses.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { performance } from "perf_hooks";
import { sendOtpEmail } from "@/lib/email";
import { sendOtpSms } from "@/lib/sms";
import { sendOtpWhatsapp as sendOtpWhatsApp } from "@/lib/whatsapp";

/* ------------------------------------------------------------------ */
/* Allowed OTP purposes (must match your prisma enum OtpPurpose)       */
/* ------------------------------------------------------------------ */
const ALLOWED_PURPOSES = new Set([
  "signup",
  "login",

  "address_create",
  "address_update",
  "address_delete",

  "mobile_update",
  "email_update",

  "cod_confirm",
  "order_confirm",

  "payment_gateway_auth",
  "password_change",

  "wallet_transfer",
  "refund_destination_confirm",
  "reward_redeem_confirm",
  "privacy_request_confirm",

  "rbac_login",
  "rbac_elevate",
  "rbac_sensitive_action",
]);

/**
 * ✅ Guest-safe purposes:
 * Guest checkout must be able to request OTP without an existing user row.
 */
const GUEST_AUTO_CREATE_PURPOSES = new Set(["cod_confirm", "order_confirm"]);

/* ---------------------------- helpers ---------------------------- */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function getClientIp(req) {
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "0.0.0.0";
}

function getUserAgent(req) {
  return req.headers.get("user-agent") || "";
}

const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

/**
 * ✅ Bangladesh phone normalization (gateway-safe):
 * Accepts common BD input formats and returns canonical digits-only:
 * - 01XXXXXXXXX
 * - 1XXXXXXXXX
 * - +8801XXXXXXXXX / 8801XXXXXXXXX
 * - 008801XXXXXXXXX / 08801XXXXXXXXX
 * - Legacy/mistyped trunk-zero variants like 88001XXXXXXXXX / 880017... (removes the trunk 0)
 *
 * Returns: "8801XXXXXXXXX" (13 digits) or null.
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

  /**
   * Fix common legacy mistake:
   * country code + trunk "0" kept -> 8800 1XXXXXXXXX
   * example: 88001787091462 -> 8801787091462
   */
  const m8800 = digits.match(/^8800(1\d{9})$/);
  if (m8800) digits = "880" + m8800[1];

  // 08801XXXXXXXXX -> 8801XXXXXXXXX
  if (/^0880\d{10}$/.test(digits)) digits = "880" + digits.slice(4);

  // 008801XXXXXXXXX -> 8801XXXXXXXXX
  if (/^00880\d{10}$/.test(digits)) digits = "880" + digits.slice(5);

  // 01XXXXXXXXX -> 8801XXXXXXXXX
  if (/^0\d{10}$/.test(digits)) digits = "880" + digits.slice(1);

  // 1XXXXXXXXX (10 digits) -> 8801XXXXXXXXX
  if (/^1\d{9}$/.test(digits)) digits = "880" + digits;

  // strict BD mobile pattern
  if (!/^8801\d{9}$/.test(digits)) return null;

  // operator/prefix sanity (013–019; 011 legacy)
  const prefix = digits.slice(3, 5);
  const allowed = new Set(["13", "14", "15", "16", "17", "18", "19", "11"]);
  if (!allowed.has(prefix)) return null;

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
    return { type: "phone", email: null, phone: phoneDigits, e164: `+${phoneDigits}` };
  }

  return { type: null, email: null, phone: null, e164: null };
}

function normalizePurposeKey(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return s || "";
}

function heuristicPurpose(key) {
  const k = String(key || "");
  if (!k) return null;

  if (/(^|_)cod($|_)/.test(k) && /(confirm|place|order|checkout)/.test(k)) return "cod_confirm";
  if (/(^|_)order($|_)/.test(k) && /(confirm|place|checkout)/.test(k)) return "order_confirm";

  if (k.includes("address") && /(create|add|new)/.test(k)) return "address_create";
  if (k.includes("address") && /(update|edit|change)/.test(k)) return "address_update";
  if (k.includes("address") && /(delete|remove)/.test(k)) return "address_delete";

  if ((k.includes("phone") || k.includes("mobile")) && /(update|change|verify)/.test(k)) return "mobile_update";
  if (k.includes("email") && /(update|change|verify)/.test(k)) return "email_update";
  if ((k.includes("password") || k.includes("pass")) && /(change|update|reset)/.test(k)) return "password_change";

  if ((k.includes("payment") || k.includes("gateway") || k.startsWith("pg")) && /(auth|verify|otp)/.test(k)) {
    return "payment_gateway_auth";
  }

  if (k.startsWith("rbac") || k.startsWith("admin")) {
    if (k.includes("elevate") || k.includes("sudo")) return "rbac_elevate";
    if (k.includes("sensitive")) return "rbac_sensitive_action";
    return "rbac_login";
  }

  return null;
}

function normalizePurpose(purposeRaw) {
  const key = normalizePurposeKey(purposeRaw);
  if (!key) return null;
  if (ALLOWED_PURPOSES.has(key)) return key;

  const map = {
    cod: "cod_confirm",
    cod_confirm: "cod_confirm",
    codconfirmation: "cod_confirm",
    cod_confirmation: "cod_confirm",
    cash_on_delivery: "cod_confirm",
    cash_on_delivery_confirm: "cod_confirm",
    cashondelivery: "cod_confirm",
    cashondeliveryconfirm: "cod_confirm",
    place_order: "cod_confirm",
    placeorder: "cod_confirm",
    order_place_cod: "cod_confirm",
    order_place_cod_confirm: "cod_confirm",
    checkout_cod: "cod_confirm",
    checkout_cod_confirm: "cod_confirm",
    checkout_cod_confirmation: "cod_confirm",

    checkout_confirm: "order_confirm",
    checkout_confirmation: "order_confirm",
    order: "order_confirm",
    order_confirm: "order_confirm",
    orderconfirmation: "order_confirm",
    order_confirmation: "order_confirm",
    confirm_order: "order_confirm",
    confirmorder: "order_confirm",
    place_order_confirm: "order_confirm",
    place_order_confirmation: "order_confirm",

    address_add: "address_create",
    add_address: "address_create",
    addaddress: "address_create",
    address_create: "address_create",
    address_new: "address_create",
    new_address: "address_create",
    edit_address: "address_update",
    address_edit: "address_update",
    address_update: "address_update",
    update_address: "address_update",
    change_address: "address_update",
    delete_address: "address_delete",
    remove_address: "address_delete",
    address_delete: "address_delete",

    change_phone: "mobile_update",
    update_phone: "mobile_update",
    phone_update: "mobile_update",
    mobile_update: "mobile_update",
    change_mobile: "mobile_update",
    change_email: "email_update",
    update_email: "email_update",
    email_update: "email_update",
    change_password: "password_change",
    update_password: "password_change",
    password_change: "password_change",
    password_reset: "password_change",

    gateway_auth: "payment_gateway_auth",
    payment_gateway_auth: "payment_gateway_auth",
    pg_auth: "payment_gateway_auth",
    pg_otp: "payment_gateway_auth",

    admin_login: "rbac_login",
    rbac_login: "rbac_login",
    elevate: "rbac_elevate",
    rbac_elevate: "rbac_elevate",
    sudo_action: "rbac_sensitive_action",
    rbac_sensitive_action: "rbac_sensitive_action",
  };

  const mapped = map[key] || heuristicPurpose(key);
  if (mapped && ALLOWED_PURPOSES.has(mapped)) return mapped;
  return null;
}

/**
 * ✅ Phone lookup candidates for USER search:
 * - Includes canonical forms (8801..., +8801..., 01...)
 * - Includes legacy DB-stored trunk-zero variants for lookup ONLY (88001..., 08801..., 008801...)
 * This prevents duplicate users + OTP mismatch across guest vs logged-in.
 */
function phoneLookupCandidates(rawId, parsed) {
  const out = new Set();
  const raw = String(rawId || "").trim();

  if (raw) out.add(raw);

  const canon = parsed?.phone || normalizePhone(raw);
  if (canon) {
    out.add(canon); // "8801XXXXXXXXX"
    out.add(`+${canon}`); // "+8801XXXXXXXXX"

    if (canon.startsWith("880") && canon.length === 13) {
      const local = `0${canon.slice(3)}`; // "01XXXXXXXXX"
      out.add(local);

      // Legacy/mistyped storage variants (DB lookup only)
      out.add(`8800${canon.slice(3)}`); // "88001XXXXXXXXX"
      out.add(`0880${canon.slice(3)}`); // "08801XXXXXXXXX"
      out.add(`00880${canon.slice(3)}`); // "008801XXXXXXXXX"
    }
  }

  const stripped = raw.replace(/[^\d+]/g, "");
  if (stripped) out.add(stripped);

  const digitsOnly = stripped.replace(/\+/g, "");
  if (digitsOnly) out.add(digitsOnly);

  const canon2 = normalizePhone(raw);
  if (canon2) {
    out.add(canon2);
    out.add(`+${canon2}`);
    if (canon2.startsWith("880") && canon2.length === 13) {
      out.add(`0${canon2.slice(3)}`);
      out.add(`8800${canon2.slice(3)}`);
      out.add(`0880${canon2.slice(3)}`);
      out.add(`00880${canon2.slice(3)}`);
    }
  }

  return Array.from(out).filter(Boolean).slice(0, 30);
}

function buildPlainCandidates({ userId, identifier, purpose, code }) {
  return [
    `${userId}:${purpose}:${code}`,
    `${identifier}:${purpose}:${code}`,
    `${userId}:${code}`,
    `${identifier}:${code}`,
  ];
}

function computeHashes({ candidates, secret }) {
  const primaryHex = crypto.createHmac("sha256", secret).update(candidates[0]).digest("hex");
  const altBase64 = crypto.createHmac("sha256", secret).update(candidates[0]).digest("base64");
  const rawSha256Hex = crypto.createHash("sha256").update(candidates[0]).digest("hex");
  return { primaryHex, altBase64, rawSha256Hex };
}

async function advisoryTryLock(tx, key) {
  // Non-blocking advisory lock to avoid slow "wait" under concurrent clicks.
  // Returns true if lock acquired, else false.
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
  } catch {}

  try {
    console.info("[otp-audit]", { ...event, ts: new Date().toISOString() });
  } catch {}
}

function auditOtpEventAsync(event) {
  // Fire-and-forget audit to keep request latency near-zero.
  // Never blocks the OTP response path.
  try {
    setImmediate(() => {
      auditOtpEvent(event).catch(() => {});
    });
  } catch {}
}

async function getUpstashRl() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (globalThis.__otpUpstashRl) return globalThis.__otpUpstashRl;

  try {
    const [{ Ratelimit }, { Redis }] = await Promise.all([
      import("@upstash/ratelimit"),
      import("@upstash/redis"),
    ]);

    const redis = new Redis({ url, token });
    globalThis.__otpUpstashRl = { Ratelimit, redis };
    return globalThis.__otpUpstashRl;
  } catch {
    return null;
  }
}

async function rateLimitOrPass({ namespace, key, limit, windowSeconds }) {
  const cached = await getUpstashRl();
  if (!cached) return { ok: true };

  try {
    const { Ratelimit, redis } = cached;
    const rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      analytics: false,
      prefix: namespace,
    });

    const res = await rl.limit(key);
    if (!res.success) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(res.reset / 1000)) };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

function remainingTtlSeconds(expiresAt, now = new Date()) {
  try {
    const ms = new Date(expiresAt).getTime() - new Date(now).getTime();
    const s = Math.ceil(ms / 1000);
    return Math.max(0, s);
  } catch {
    return 0;
  }
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label = "OTP_TIMEOUT") {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

/**
 * Guard the *rate-limit* call with a small time budget to preserve "click and fire".
 * If the RL store is slow/unavailable, we pass (best-effort).
 */
async function rateLimitFastOrPass(args) {
  const budgetMs = Math.max(50, Number.parseInt(process.env.OTP_RL_MAX_LATENCY_MS || "150", 10));
  try {
    return await withTimeout(rateLimitOrPass(args), budgetMs, "RL_SLOW_BYPASS");
  } catch {
    return { ok: true };
  }
}

function backgroundSend({
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
}) {
  setImmediate(async () => {
    try {
      let ok = false;

      if (channel === "EMAIL") {
        ok = await withTimeout(
          sendOtpEmail({ to: email, code, ttlSeconds, purpose, brand }),
          sendTimeoutMs,
          "EMAIL_SEND_TIMEOUT"
        ).catch(() => false);
      } else if (channel === "SMS") {
        ok = await withTimeout(
          sendOtpSms({ to: phoneDigits, code, ttlSeconds, purpose, brand }),
          sendTimeoutMs,
          "SMS_SEND_TIMEOUT"
        ).catch(() => false);
      } else if (channel === "WHATSAPP") {
        ok = await withTimeout(
          sendOtpWhatsApp({ to: phoneE164, code, ttlSeconds, purpose, brand }),
          sendTimeoutMs,
          "WHATSAPP_SEND_TIMEOUT"
        ).catch(() => false);
      }

      if (!ok) {
        // IMPORTANT (email reliability): do NOT invalidate the OTP on delivery failure/timeout.
        // Providers can be slow; a late email should still contain a valid code.
        auditOtpEventAsync({
          scope: "global",
          event: "send_failed",
          purpose,
          identifier: email || phoneDigits || phoneE164 || "",
          channel,
          ip,
          ua,
          otpId,
        });
        return;
      }

      auditOtpEventAsync({
        scope: "global",
        event: "sent",
        purpose,
        identifier: email || phoneDigits || phoneE164 || "",
        channel,
        ip,
        ua,
        otpId,
      });
    } catch {
      // IMPORTANT (email reliability): do NOT invalidate the OTP on delivery exceptions.
      // A delayed provider response should not make a later-arriving code unusable.
      auditOtpEventAsync({
        scope: "global",
        event: "send_error",
        purpose,
        identifier: email || phoneDigits || phoneE164 || "",
        channel,
        ip,
        ua,
        otpId,
      });
    }
  });
}

/* ---------------------------- main handler ---------------------------- */

export async function POST(req) {
  let createdNewUser = false;
  let createdUserId = null;

  const t0 = performance.now();
  const marks = {};
  const mark = (k) => (marks[k] = Math.round(performance.now() - t0));

  try {
    const ip = getClientIp(req);
    const ua = getUserAgent(req);

    const body = await req.json().catch(() => ({}));
    mark("json");

    const rawPurpose = body?.purpose ?? "login";
    const purposeKey = normalizePurposeKey(rawPurpose);
    const purpose = normalizePurpose(rawPurpose);
    const { identifier, channel, allowNew, forceNew, idempotencyKey, action } = body || {};

    if (!purpose) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PURPOSE", purpose: String(rawPurpose || ""), normalized: purposeKey },
        { status: 400 }
      );
    }

    const parsed = detectIdentifier(identifier);
    if (!parsed.type) {
      return NextResponse.json({ ok: false, error: "IDENTIFIER_REQUIRED" }, { status: 400 });
    }
    mark("normalize");

    // ACTION: expire/cancel/invalidate (used by client when OTP timer ends, form closes, or verification finishes)
    // Must be instant: no ratelimit, no TTL/env reads, no user lookup transaction.
    const actionKey = String(action || "").trim().toLowerCase();
    const isExpireAction = actionKey === "expire" || actionKey === "cancel" || actionKey === "invalidate";
    if (isExpireAction) {
      const now = new Date();

      // Expire across ALL channels for this purpose (EMAIL/SMS/WHATSAPP) for the matched user.
      // Do it in a single UPDATE with relation filter (fast).
      let expiredCount = 0;

      if (parsed.type === "email") {
        const res = await prisma.otpCode.updateMany({
          where: {
            purpose,
            consumedAt: null,
            expiresAt: { gt: now },
            user: { email: parsed.email }, // emails are stored normalized (lowercase)
          },
          data: { consumedAt: now, expiresAt: now },
        });
        expiredCount = res?.count || 0;
      } else {
        const inList = phoneLookupCandidates(identifier, parsed);
        const res = await prisma.otpCode.updateMany({
          where: {
            purpose,
            consumedAt: null,
            expiresAt: { gt: now },
            user: { phone: { in: inList } },
          },
          data: { consumedAt: now, expiresAt: now },
        });
        expiredCount = res?.count || 0;
      }

      auditOtpEventAsync({
        scope: "global",
        event: "expired_client",
        purpose,
        identifier: parsed.type === "email" ? parsed.email : parsed.phone,
        channel: parsed.type === "email" ? "EMAIL" : String(channel || "SMS").toUpperCase(),
        ip,
        ua,
        meta: { action: actionKey, expiredCount },
      });

      mark("response_ready");
      return NextResponse.json({
        ok: true,
        purpose,
        channel: parsed.type === "email" ? "EMAIL" : String(channel || "SMS").toUpperCase(),
        expiredCount,
        timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
      });
    }

    const isCheckoutOtp = purpose === "cod_confirm" || purpose === "order_confirm";
    const limitPerMinDefault = Number.parseInt(process.env.OTP_RATELIMIT_PER_MIN || "24", 10);
    const limitPerMinCheckout = Number.parseInt(process.env.OTP_RATELIMIT_CHECKOUT_PER_MIN || "60", 10);
    const perMin = isCheckoutOtp ? limitPerMinCheckout : limitPerMinDefault;

    const rateKey = `${ip}:${parsed.type === "email" ? parsed.email : parsed.phone}:${purpose}`;

    const rl = await rateLimitFastOrPass({
      namespace: "otp:global",
      key: rateKey,
      limit: Number.isFinite(perMin) && perMin > 0 ? perMin : 24,
      windowSeconds: 60,
    });
    mark("ratelimit");

    if (!rl.ok) {
      auditOtpEventAsync({
        scope: "global",
        event: "rate_limited",
        purpose,
        identifier: parsed.type === "email" ? parsed.email : parsed.phone,
        channel: parsed.type === "email" ? "EMAIL" : String(channel || "SMS").toUpperCase(),
        ip,
        ua,
      });

      return NextResponse.json(
        { ok: false, error: "RATE_LIMITED", retryAfterSeconds: rl.retryAfterSeconds },
        { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } }
      );
    }

    const otpSecret = requireEnv("OTP_SECRET");
    const ttl = Number.parseInt(requireEnv("OTP_TTL_SECONDS"), 10);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return NextResponse.json({ ok: false, error: "INVALID_TTL" }, { status: 400 });
    }

    const resendCooldownSeconds = Math.max(0, Number.parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || "0", 10));
    const SEND_TIMEOUT_MS = Math.max(800, Number.parseInt(process.env.OTP_SEND_TIMEOUT_MS || "8000", 10));
    const now = new Date();

    let user = null;

    // ✅ Robust identifier lookup (prevents logged-in users stored as +880/01/legacy from being treated as new)
    // PERF: email uses indexed findUnique (no ILIKE).
    if (parsed.type === "email") {
      user = await prisma.user.findUnique({
        where: { email: parsed.email },
        select: { id: true, email: true, phone: true },
      });
    } else {
      const inList = phoneLookupCandidates(identifier, parsed);
      user = await prisma.user.findFirst({
        where: { phone: { in: inList } },
        select: { id: true, email: true, phone: true },
      });
    }
    mark("user_lookup");

    const canAutoCreateForThisPurpose = purpose === "signup" ? !!allowNew : GUEST_AUTO_CREATE_PURPOSES.has(purpose);

    if (!user) {
      if (!canAutoCreateForThisPurpose) {
        return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
      }

      if (parsed.type === "email") {
        const u = await prisma.user.upsert({
          where: { email: parsed.email },
          update: {},
          create: { email: parsed.email, isActive: true },
          select: { id: true, email: true, phone: true },
        });
        createdNewUser = true;
        createdUserId = u.id;
        user = u;
      } else {
        const u = await prisma.user.upsert({
          where: { phone: parsed.phone }, // parsed.phone is canonical "8801XXXXXXXXX"
          update: {},
          create: { phone: parsed.phone, isActive: true },
          select: { id: true, email: true, phone: true },
        });
        createdNewUser = true;
        createdUserId = u.id;
        user = u;
      }
      mark("user_upsert");
    }

    let resolvedChannel = "EMAIL";
    if (parsed.type === "phone") {
      const upper = String(channel || "SMS").toUpperCase();
      resolvedChannel = upper === "WHATSAPP" ? "WHATSAPP" : "SMS";
    }

    // ✅ For hashing/identity use canonical digits (prevents user/otp mismatch)
    const canonicalIdentifier =
      parsed.type === "email"
        ? (user.email || parsed.email || "").toLowerCase()
        : normalizePhone(user.phone || parsed.phone || identifier) || (user.phone || parsed.phone || "");

    const brand = process.env.BRAND_NAME || "The DNA Lab";
    const otpCode = String(Math.floor(100000 + Math.random() * 900000));

    const candidates = buildPlainCandidates({
      userId: user.id,
      identifier: canonicalIdentifier,
      purpose,
      code: otpCode,
    });

    const { primaryHex, altBase64, rawSha256Hex } = computeHashes({
      candidates,
      secret: otpSecret,
    });

    // ✅ For sending: ALWAYS canonical BD MSISDN digits (gateway-safe)
    const phoneDigitsOut =
      parsed.type === "phone" ? normalizePhone(user.phone || parsed.phone || identifier) : null;
    const phoneE164Out = parsed.type === "phone" && phoneDigitsOut ? `+${phoneDigitsOut}` : null;

    // ✅ EARLY reuse check (no waiting): if an active OTP exists, return immediately.
    // This keeps server response time near-zero for repeat clicks while an OTP is still valid.
    if (!forceNew) {
      const preActive = await prisma.otpCode.findFirst({
        where: {
          userId: user.id,
          purpose,
          channel: resolvedChannel,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, expiresAt: true },
      });

      if (preActive) {
        auditOtpEventAsync({
          scope: "global",
          event: "requested",
          purpose,
          identifier: parsed.type === "email" ? parsed.email : parsed.phone,
          channel: resolvedChannel,
          ip,
          ua,
          otpId: preActive.id,
        });

        mark("response_ready");
        const normalizedIdentifierOut =
          resolvedChannel === "EMAIL"
            ? (user.email || parsed.email || "").toLowerCase()
            : resolvedChannel === "WHATSAPP"
              ? phoneE164Out
              : parsed.type === "phone" && phoneDigitsOut
                ? `+${phoneDigitsOut}`
                : "";

        return NextResponse.json({
          ok: true,
          purpose,
          channel: resolvedChannel,
          otpId: preActive.id,
          ttlSeconds: remainingTtlSeconds(preActive.expiresAt, now),
          expiresAt: preActive.expiresAt,
          serverNow: now.toISOString(),
          resendCooldownSeconds,
          normalizedIdentifier: normalizedIdentifierOut,
          delivery: "reused",
          timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
        });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const lockKey = `auth-request-otp:${user.id}:${purpose}`;
      const locked = await advisoryTryLock(tx, lockKey);

      if (!locked) {
        // Another request is currently creating/refreshing OTP.
        // Poll very briefly for the active OTP row instead of waiting on the lock.
        for (let i = 0; i < 8; i++) {
          const active2 = await tx.otpCode.findFirst({
            where: {
              userId: user.id,
              purpose,
              channel: resolvedChannel,
              consumedAt: null,
              expiresAt: { gt: now },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, expiresAt: true },
          });
          if (active2) return { id: active2.id, expiresAt: active2.expiresAt, reused: true, locked: false };
          await sleepMs(15);
        }
        // If still not visible, report busy (prevents duplicate OTP creation under contention).
        return { busy: true, id: null, expiresAt: null, reused: true, locked: false };
      }

      // Reuse existing active OTP to prevent accidental double-send (no cooldown; one OTP active per TTL)
      // If the client explicitly requests a new OTP (forceNew === true), we will consume the active one and create a new code.
      const active = await tx.otpCode.findFirst({
        where: {
          userId: user.id,
          purpose,
          channel: resolvedChannel,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, expiresAt: true },
      });

      if (active && !forceNew) {
        return { id: active.id, expiresAt: active.expiresAt, reused: true };
      }

      await tx.otpCode.updateMany({
        where: { userId: user.id, purpose, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now, expiresAt: now },
      });

      const expiresAt = new Date(now.getTime() + ttl * 1000);

      const row = await tx.otpCode.create({
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
            v: 5,
            scope: "global",
            mode: "async_send",
            idem: idempotencyKey ? String(idempotencyKey).slice(0, 180) : undefined,
            forceNew: !!forceNew,
          }),
        },
        select: { id: true, expiresAt: true },
      });

      return { id: row.id, expiresAt: row.expiresAt, reused: false };
    });

    if (created?.busy) {
      mark("response_ready");
      return NextResponse.json({ ok: false, error: "OTP_BUSY_RETRY" }, { status: 409 });
    }

    mark("otp_db");

    auditOtpEventAsync({
      scope: "global",
      event: "requested",
      purpose,
      identifier: parsed.type === "email" ? parsed.email : parsed.phone,
      channel: resolvedChannel,
      ip,
      ua,
      otpId: created.id,
    });
    mark("audit");

    if (resolvedChannel === "EMAIL") {
      const targetEmail = (user.email || parsed.email || "").toLowerCase();
      if (!targetEmail) {
        await prisma.otpCode
          .update({ where: { id: created.id }, data: { expiresAt: now, consumedAt: now } })
          .catch(() => {});
        if (createdNewUser && createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
        return NextResponse.json({ ok: false, error: "EMAIL_TARGET_MISSING" }, { status: 400 });
      }

      // If we reused an active OTP, do NOT re-send via provider (prevents duplicate emails/SMS).
      if (created.reused) {
        mark("response_ready");
        return NextResponse.json({
          ok: true,
          purpose,
          channel: "EMAIL",
          otpId: created.id,
          ttlSeconds: remainingTtlSeconds(created.expiresAt, now),
          expiresAt: created.expiresAt,
          serverNow: now.toISOString(),
          resendCooldownSeconds,
          normalizedIdentifier: targetEmail,
          delivery: "reused",
          timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
        });
      }

      backgroundSend({
        otpId: created.id,
        channel: "EMAIL",
        purpose,
        brand,
        code: otpCode,
        ttlSeconds: ttl,
        email: targetEmail,
        phoneDigits: null,
        phoneE164: null,
        ip,
        ua,
        sendTimeoutMs: SEND_TIMEOUT_MS,
      });

      mark("response_ready");
      return NextResponse.json({
        ok: true,
        purpose,
        channel: "EMAIL",
        otpId: created.id,
        ttlSeconds: ttl,
        expiresAt: created.expiresAt,
        serverNow: now.toISOString(),
        resendCooldownSeconds,
        normalizedIdentifier: targetEmail,
        delivery: "queued",
        timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
      });
    }

    if (resolvedChannel === "SMS") {
      if (!phoneDigitsOut) {
        await prisma.otpCode
          .update({ where: { id: created.id }, data: { expiresAt: now, consumedAt: now } })
          .catch(() => {});
        if (createdNewUser && createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
        return NextResponse.json({ ok: false, error: "PHONE_TARGET_MISSING" }, { status: 400 });
      }

      // If we reused an active OTP, do NOT re-send via provider (prevents duplicate emails/SMS).
      if (created.reused) {
        mark("response_ready");
        return NextResponse.json({
          ok: true,
          purpose,
          channel: "SMS",
          otpId: created.id,
          ttlSeconds: remainingTtlSeconds(created.expiresAt, now),
          expiresAt: created.expiresAt,
          serverNow: now.toISOString(),
          resendCooldownSeconds,
          normalizedIdentifier: `+${phoneDigitsOut}`,
          delivery: "reused",
          timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
        });
      }

      backgroundSend({
        otpId: created.id,
        channel: "SMS",
        purpose,
        brand,
        code: otpCode,
        ttlSeconds: ttl,
        email: null,
        phoneDigits: phoneDigitsOut, // canonical "8801XXXXXXXXX"
        phoneE164: null,
        ip,
        ua,
        sendTimeoutMs: SEND_TIMEOUT_MS,
      });

      mark("response_ready");
      return NextResponse.json({
        ok: true,
        purpose,
        channel: "SMS",
        otpId: created.id,
        ttlSeconds: ttl,
        expiresAt: created.expiresAt,
        serverNow: now.toISOString(),
        resendCooldownSeconds,
        normalizedIdentifier: `+${phoneDigitsOut}`,
        delivery: "queued",
        timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
      });
    }

    if (resolvedChannel === "WHATSAPP") {
      if (!phoneE164Out) {
        await prisma.otpCode
          .update({ where: { id: created.id }, data: { expiresAt: now, consumedAt: now } })
          .catch(() => {});
        if (createdNewUser && createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
        return NextResponse.json({ ok: false, error: "WHATSAPP_TARGET_MISSING" }, { status: 400 });
      }

      // If we reused an active OTP, do NOT re-send via provider (prevents duplicate emails/SMS).
      if (created.reused) {
        mark("response_ready");
        return NextResponse.json({
          ok: true,
          purpose,
          channel: "WHATSAPP",
          otpId: created.id,
          ttlSeconds: remainingTtlSeconds(created.expiresAt, now),
          expiresAt: created.expiresAt,
          serverNow: now.toISOString(),
          resendCooldownSeconds,
          normalizedIdentifier: phoneE164Out,
          delivery: "reused",
          timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
        });
      }

      backgroundSend({
        otpId: created.id,
        channel: "WHATSAPP",
        purpose,
        brand,
        code: otpCode,
        ttlSeconds: ttl,
        email: null,
        phoneDigits: null,
        phoneE164: phoneE164Out, // "+8801XXXXXXXXX"
        ip,
        ua,
        sendTimeoutMs: SEND_TIMEOUT_MS,
      });

      mark("response_ready");
      return NextResponse.json({
        ok: true,
        purpose,
        channel: "WHATSAPP",
        otpId: created.id,
        ttlSeconds: ttl,
        expiresAt: created.expiresAt,
        serverNow: now.toISOString(),
        resendCooldownSeconds,
        normalizedIdentifier: phoneE164Out,
        delivery: "queued",
        timings: process.env.OTP_DEBUG === "1" ? marks : undefined,
      });
    }

    await prisma.otpCode
      .update({ where: { id: created.id }, data: { expiresAt: now, consumedAt: now } })
      .catch(() => {});
    return NextResponse.json({ ok: false, error: "CHANNEL_UNSUPPORTED" }, { status: 400 });
  } catch (err) {
    console.error("[request-otp]", err);

    if (createdNewUser && createdUserId) {
      try {
        await prisma.user.delete({ where: { id: createdUserId } });
      } catch {}
    }

    return NextResponse.json({ ok: false, error: "REQUEST_OTP_FAILED" }, { status: 500 });
  }
}
