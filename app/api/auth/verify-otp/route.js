// FILE: app/api/auth/verify-otp/route.js
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

// Align short-lived otp_session to OTP’s own TTL (env-driven, min 1s)
const OTP_TTL_SECONDS = Math.max(1, Number.parseInt(process.env.OTP_TTL_SECONDS || "90", 10));

// If a code was already verified very recently, treat repeated submits as OK
const IDEMPOTENT_MS = 3 * 60 * 1000;

// Short-lived session (for sensitive one-shot actions) = OTP TTL (capped)
const OTP_SESSION_MAX_SECONDS = OTP_TTL_SECONDS;

/* ───────────────── identifier helpers ───────────────── */
const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

/**
 * ✅ MUST MATCH request-otp normalization (Bangladesh mobile, gateway-safe):
 * Accepts:
 *  - +8801XXXXXXXXX, 8801XXXXXXXXX
 *  - 01XXXXXXXXX
 *  - 08801XXXXXXXXX
 *  - 008801XXXXXXXXX
 *  - 1XXXXXXXXX (10 digits)
 *  - legacy/mistyped 88001XXXXXXXXX or 880017... (country code + trunk 0 kept)
 *
 * Returns canonical digits-only: "8801XXXXXXXXX" (13 digits) or null.
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

  // defensive: 00880... (if not caught)
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

/**
 * Identifier candidates for matching OTP hashes across older/newer formats.
 * Includes:
 * - canonical digits (8801...)
 * - +canonical
 * - local 01...
 * - DB legacy trunk-zero forms (88001..., 08801..., 008801...) for lookup+matching safety
 * - raw stripped digits
 */
function identifierCandidates(rawId, parsed, user) {
  const out = new Set();

  const raw = String(rawId || "").trim();
  if (raw) out.add(raw);

  // include stored values (legacy DB)
  if (user?.email) out.add(String(user.email).trim());
  if (user?.phone) out.add(String(user.phone).trim());

  if (parsed?.type === "email") {
    const e = (user?.email || parsed?.email || raw || "").trim();
    if (e) {
      out.add(e);
      out.add(e.toLowerCase());
    }
    return Array.from(out).filter(Boolean);
  }

  // phone
  const canon = normalizePhone(user?.phone || parsed?.phone || raw);
  if (canon) {
    out.add(canon); // "8801..."
    out.add(`+${canon}`); // "+8801..."
    if (canon.startsWith("880") && canon.length === 13) {
      out.add(`0${canon.slice(3)}`); // "01..."

      // legacy/mistyped storage variants (for match only; never send these to providers)
      out.add(`8800${canon.slice(3)}`); // "88001..."
      out.add(`0880${canon.slice(3)}`); // "08801..."
      out.add(`00880${canon.slice(3)}`); // "008801..."
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

  return Array.from(out).filter(Boolean);
}

/**
 * ✅ User lookup candidates for phone (MUST include "+880..." and "01..." and legacy trunk-zero to avoid misses).
 */
function phoneLookupCandidates(rawId, parsed) {
  const out = new Set();
  const raw = String(rawId || "").trim();
  if (raw) out.add(raw);

  const canon = normalizePhone(parsed?.phone || raw);
  if (canon) {
    out.add(canon);
    out.add(`+${canon}`);
    if (canon.startsWith("880") && canon.length === 13) {
      out.add(`0${canon.slice(3)}`);

      // legacy DB variants (lookup only)
      out.add(`8800${canon.slice(3)}`);
      out.add(`0880${canon.slice(3)}`);
      out.add(`00880${canon.slice(3)}`);
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

/* ───────────────── hash helpers ───────────────── */
function base64urlToBase64(s) {
  const str = String(s || "");
  let b = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4;
  if (pad === 2) b += "==";
  else if (pad === 3) b += "=";
  else if (pad === 1) b += "===";
  return b;
}

function asBuf(any) {
  if (any == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(any)) return any;
  if (any instanceof Uint8Array) return Buffer.from(any);

  const str = String(any);

  // hex sha256 (64 chars)
  if (/^[0-9a-f]{64}$/i.test(str)) {
    try {
      return Buffer.from(str, "hex");
    } catch {}
  }

  // base64 / base64url
  if (/^[A-Za-z0-9+/_=-]+$/.test(str)) {
    try {
      const b = Buffer.from(str, "base64");
      if (b.length) return b;
    } catch {}
    try {
      const b = Buffer.from(base64urlToBase64(str), "base64");
      if (b.length) return b;
    } catch {}
  }

  return Buffer.from(str, "utf8");
}

function timingEq(a, b) {
  const A = asBuf(a);
  const B = asBuf(b);
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

function hmacDigests(secret, input) {
  const h = crypto.createHmac("sha256", secret).update(input);
  const hex = h.digest("hex");
  const b64 = crypto.createHmac("sha256", secret).update(input).digest("base64");
  const b64url = crypto.createHmac("sha256", secret).update(input).digest("base64url");
  return { hex, b64, b64url };
}

/**
 * ✅ MUST INCLUDE request-otp exact formats:
 * - `${userId}:${purpose}:${code}`
 * - `${identifier}:${purpose}:${code}`
 * - `${userId}:${code}`
 * - `${identifier}:${code}`
 *
 * Keep extra variants for legacy safety.
 */
function buildInputCandidates({ userId, identifiers, purposes, code }) {
  const out = new Set();
  const uid = String(userId || "");
  const otp = String(code || "");

  const idfs = Array.isArray(identifiers) ? identifiers : [];
  const purs = Array.isArray(purposes) ? purposes : [];

  // purpose-less (legacy)
  out.add(`${uid}:${otp}`);
  for (const idf of idfs) out.add(`${idf}:${otp}`);

  for (const p of purs) {
    if (!p) continue;

    // request-otp primary (exact)
    out.add(`${uid}:${p}:${otp}`);
    for (const idf of idfs) out.add(`${idf}:${p}:${otp}`);

    // swapped (legacy)
    out.add(`${p}:${uid}:${otp}`);
    out.add(`${uid}|${p}|${otp}`);
    out.add(`${p}|${uid}|${otp}`);

    for (const idf of idfs) {
      out.add(`${p}:${idf}:${otp}`);
      out.add(`${idf}|${p}|${otp}`);
      out.add(`${p}|${idf}|${otp}`);
    }
  }

  return Array.from(out);
}

async function rowMatches(row, inputs, secret) {
  for (const input of inputs) {
    if (looksLikeBcrypt(row.codeHash)) {
      const ok = await bcrypt.compare(input, row.codeHash).catch(() => false);
      if (ok) return `bcrypt:${input.slice(0, 6)}…`;
      continue;
    }

    const { hex, b64, b64url } = hmacDigests(secret, input);

    // request-otp stores hex string (primary path)
    if (timingEq(row.codeHash, hex)) return "hmac:hex";
    if (timingEq(row.codeHash, b64)) return "hmac:b64";
    if (timingEq(row.codeHash, b64url)) return "hmac:b64url";

    // raw equality (dev/historical)
    if (timingEq(row.codeHash, input)) return "raw";
  }
  return null;
}

/* ───────────────── purpose normalization (MUST MATCH request-otp) ───────────────── */
const ALLOWED_PURPOSES = new Set([
  "signup",
  "login",
  "address_create",
  "address_update",
  "address_delete",
  "mobile_update",
  "email_update",
  "password_change",

  "cod_confirm",
  "order_confirm",
  "payment_gateway_auth",

  "wallet_transfer",
  "refund_destination_confirm",
  "reward_redeem_confirm",
  "privacy_request_confirm",

  "rbac_login",
  "rbac_elevate",
  "rbac_sensitive_action",
]);

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
    cash_on_delivery: "cod_confirm",
    cashondelivery: "cod_confirm",
    place_order: "cod_confirm",
    placeorder: "cod_confirm",
    checkout_cod: "cod_confirm",
    checkout_cod_confirm: "cod_confirm",
    checkout_cod_confirmation: "cod_confirm",

    checkout_confirm: "order_confirm",
    checkout_confirmation: "order_confirm",
    confirm_order: "order_confirm",
    confirmorder: "order_confirm",
    order: "order_confirm",
    order_confirm: "order_confirm",
    order_confirmation: "order_confirm",

    address_add: "address_create",
    add_address: "address_create",
    address_create: "address_create",
    edit_address: "address_update",
    update_address: "address_update",
    address_update: "address_update",
    delete_address: "address_delete",
    remove_address: "address_delete",
    address_delete: "address_delete",

    change_phone: "mobile_update",
    update_phone: "mobile_update",
    phone_update: "mobile_update",
    mobile_update: "mobile_update",
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

function purposeCandidates(rowPurpose, requestPurposeRaw) {
  const out = new Set();

  const reqKey = normalizePurposeKey(requestPurposeRaw);
  const reqNorm = normalizePurpose(requestPurposeRaw);

  if (reqNorm) out.add(reqNorm);
  if (reqKey) out.add(reqKey);

  const rpKey = normalizePurposeKey(rowPurpose);
  const rpNorm = normalizePurpose(rowPurpose);
  if (rpNorm) out.add(rpNorm);
  if (rpKey) out.add(rpKey);

  // If DB row has no purpose (older data), try safe set
  if (!rowPurpose) {
    ["login", "signup", "cod_confirm", "order_confirm", "address_update", "address_create", "mobile_update"].forEach(
      (p) => out.add(p)
    );
  }

  return Array.from(out).filter(Boolean);
}

/* ───────────────── otp-session (short-lived) ───────────────── */
function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
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
  };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", OTP_SECRET).update(`${h}.${p}`).digest("base64url");
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

function pickAttemptTarget(activeRows, purposeRaw) {
  const norm = normalizePurpose(purposeRaw) || normalizePurposeKey(purposeRaw);
  const match = (norm ? activeRows.find((r) => normalizePurpose(r.purpose) === norm) : null) || activeRows[0];
  return match || null;
}

/* ───────────────── concurrency lock (same pattern as request-otp) ───────────────── */
async function advisoryLock(tx, key) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/* ───────────────── handler ───────────────── */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));

    const rawId = String(body?.identifier || body?.to || "").trim();
    const code = String(body?.code || body?.otp || "").trim();

    // Keep both: raw and normalized
    const purposeRaw = String(body?.purpose || "");
    const purposeNorm = normalizePurpose(purposeRaw);

    if (!rawId) return NextResponse.json({ ok: false, error: "MISSING_IDENTIFIER", clearResendTimer: true }, { status: 400 });
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ ok: false, error: "INVALID_CODE", clearResendTimer: true }, { status: 400 });

    const parsed = detectIdentifier(rawId);
    if (!parsed.type) return NextResponse.json({ ok: false, error: "INVALID_IDENTIFIER", clearResendTimer: true }, { status: 400 });

    // ✅ Robust user lookup: allow multiple matches and pick the one that owns the OTP
    let users = [];
    if (parsed.type === "email") {
      const u = await prisma.user.findMany({
        where: { email: { equals: parsed.email, mode: "insensitive" } },
        select: { id: true, email: true, phone: true },
        take: 5,
      });
      users = Array.isArray(u) ? u : [];
    } else {
      const inList = phoneLookupCandidates(rawId, parsed);
      const u = await prisma.user.findMany({
        where: { phone: { in: inList } },
        select: { id: true, email: true, phone: true },
        take: 10,
      });
      users = Array.isArray(u) ? u : [];
    }

    if (!users.length) {
      return NextResponse.json({ ok: false, error: "USER_NOT_FOUND", clearResendTimer: true }, { status: 404 });
    }

    const now = new Date();
    const userIds = users.map((u) => String(u.id)).filter(Boolean);

    // Pull active + recently consumed across all matched users (handles historical duplicates safely)
    const [activeAll, recentConsumedAll] = await Promise.all([
      prisma.otpCode.findMany({
        where: {
          userId: { in: userIds },
          consumedAt: null,
          expiresAt: { gte: now },
        },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          userId: true,
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
          userId: { in: userIds },
          consumedAt: { gte: new Date(now.getTime() - IDEMPOTENT_MS) },
        },
        orderBy: { consumedAt: "desc" },
        take: 30,
        select: {
          id: true,
          userId: true,
          codeHash: true,
          expiresAt: true,
          purpose: true,
          createdAt: true,
          consumedAt: true,
        },
      }),
    ]);

    if (!activeAll.length && !recentConsumedAll.length) {
      return NextResponse.json({ ok: false, error: "OTP_NOT_FOUND_OR_EXPIRED", clearResendTimer: true }, { status: 410 });
    }

    const userById = new Map(users.map((u) => [String(u.id), u]));
    const activeByUser = new Map();
    for (const r of activeAll) {
      const k = String(r.userId);
      if (!activeByUser.has(k)) activeByUser.set(k, []);
      activeByUser.get(k).push(r);
    }
    const recentByUser = new Map();
    for (const r of recentConsumedAll) {
      const k = String(r.userId);
      if (!recentByUser.has(k)) recentByUser.set(k, []);
      recentByUser.get(k).push(r);
    }

    // Determine which purposes to try — prioritize request purpose
    const requestedPurposeList = purposeNorm ? [purposeNorm] : [];
    const fallbackPurposeKey = normalizePurposeKey(purposeRaw);

    let matchedRow = null;
    let matchedWhy = null;
    let matchedPurpose = null;
    let matchedUser = null;

    // ── 1) Try active rows first (per user) ──────────────────────────────
    for (const uid of userIds) {
      const user = userById.get(String(uid));
      if (!user) continue;

      const identifierCanonical =
        parsed.type === "email"
          ? (user.email || parsed.email || "").toLowerCase()
          : normalizePhone(user.phone || parsed.phone || rawId) || (user.phone || parsed.phone || "");

      const idCandidates = identifierCandidates(rawId, parsed, user);
      const activeRows = activeByUser.get(String(uid)) || [];

      for (const row of activeRows) {
        const attempts = Number(row.attemptCount || 0);
        const max = Number(row.maxAttempts || 5);
        if (attempts >= max) continue;

        // Prefer exact purpose match if request gave a purpose
        if (requestedPurposeList.length) {
          const rowNorm = normalizePurpose(row.purpose);
          if (rowNorm && rowNorm !== requestedPurposeList[0]) continue;
        }

        const pList = purposeCandidates(row.purpose, purposeRaw);
        if (!pList.length && fallbackPurposeKey) pList.push(fallbackPurposeKey);

        const inputs = buildInputCandidates({
          userId: uid,
          identifiers: [identifierCanonical, ...idCandidates],
          purposes: pList,
          code,
        });

        const why = await rowMatches(row, inputs, OTP_SECRET);
        if (why) {
          matchedRow = row;
          matchedUser = user;
          matchedWhy = `active:${why}`;
          matchedPurpose =
            normalizePurpose(row.purpose) ||
            normalizePurpose(purposeRaw) ||
            normalizePurposeKey(row.purpose) ||
            null;
          break;
        }
      }

      if (matchedRow) break;
    }

    // ── 2) Idempotent re-submit (recently consumed) ─────────────────────────
    if (!matchedRow) {
      for (const uid of userIds) {
        const user = userById.get(String(uid));
        if (!user) continue;

        const identifierCanonical =
          parsed.type === "email"
            ? (user.email || parsed.email || "").toLowerCase()
            : normalizePhone(user.phone || parsed.phone || rawId) || (user.phone || parsed.phone || "");

        const idCandidates = identifierCandidates(rawId, parsed, user);
        const recentRows = recentByUser.get(String(uid)) || [];

        for (const row of recentRows) {
          const pList = purposeCandidates(row.purpose, purposeRaw);

          const inputs = buildInputCandidates({
            userId: uid,
            identifiers: [identifierCanonical, ...idCandidates],
            purposes: pList,
            code,
          });

          const why = await rowMatches(row, inputs, OTP_SECRET);
          if (!why) continue;

          const ttlSecondsRaw = Math.max(0, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000));
          const ttlSeconds = Math.min(ttlSecondsRaw, OTP_SESSION_MAX_SECONDS);

          const effectivePurpose = normalizePurpose(row.purpose) || normalizePurpose(purposeRaw) || "login";

          const { token, exp } = signOtpSession({
            uid,
            identifier: identifierCanonical,
            purpose: effectivePurpose,
            ttlSeconds,
          });

          const res = NextResponse.json({
            ok: true,
            ttlSeconds,
            userId: uid,
            phoneVerified: parsed.type === "phone" ? true : undefined,
            emailVerified: parsed.type === "email" ? true : undefined,
            idempotent: true,
            matched: OTP_DEBUG ? `recent-consumed:${why}` : undefined,
            otpSession: token,
            otpSessionExp: exp,
            purpose: effectivePurpose,

            clearResendTimer: true,
            resendAllowedNow: true,
          });

          res.headers.append(
            "Set-Cookie",
            cookieSerialize("otp_session", token, {
              maxAge: ttlSeconds,
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "Lax",
              path: "/",
            })
          );

          return res;
        }
      }
    }

    // ── 3) No match -> increment attempt count (most relevant active OTP across all matched users) ─────────────────
    if (!matchedRow) {
      if (activeAll.length) {
        const target = pickAttemptTarget(activeAll, purposeRaw);

        const attempts = Number(target?.attemptCount || 0);
        const max = Number(target?.maxAttempts || 5);
        if (attempts >= max) {
          return NextResponse.json(
            { ok: false, error: "OTP_MAX_ATTEMPTS", attemptsLeft: 0, clearResendTimer: true, resendAllowedNow: true },
            { status: 429 }
          );
        }

        const updated = await prisma.otpCode.update({
          where: { id: target.id },
          data: { attemptCount: { increment: 1 } },
          select: { attemptCount: true, maxAttempts: true, purpose: true, userId: true },
        });

        const attemptsLeft = Math.max(0, (updated.maxAttempts ?? 5) - (updated.attemptCount ?? 0));

        console.warn("[auth/verify-otp] mismatch", {
          userId: updated.userId,
          purposeInput: purposeNorm || fallbackPurposeKey || null,
          otpPurpose: updated.purpose,
          attemptsLeft,
        });

        return NextResponse.json(
          OTP_DEBUG
            ? {
                ok: false,
                error: "OTP_MISMATCH",
                attemptsLeft,
                clearResendTimer: true,
                resendAllowedNow: true,
                debug: { activeCount: activeAll.length, recentConsumed: recentConsumedAll.length, usersMatched: users.length },
              }
            : { ok: false, error: "OTP_MISMATCH", attemptsLeft, clearResendTimer: true, resendAllowedNow: true },
          { status: 401 }
        );
      }

      return NextResponse.json({ ok: false, error: "OTP_MISMATCH", clearResendTimer: true, resendAllowedNow: true }, { status: 401 });
    }

    // ── 4) Consume + verify user (transaction + advisory lock) ───────────────────────────────
    const consumedAt = new Date();

    const verifyData = parsed.type === "email" ? { emailVerifiedAt: consumedAt } : { phoneVerifiedAt: consumedAt };

    const effectivePurpose =
      (matchedPurpose && ALLOWED_PURPOSES.has(matchedPurpose) ? matchedPurpose : normalizePurpose(purposeRaw)) || "login";

    const userId = String(matchedUser.id);
    const identifierCanonical =
      parsed.type === "email"
        ? (matchedUser.email || parsed.email || "").toLowerCase()
        : normalizePhone(matchedUser.phone || parsed.phone || rawId) || (matchedUser.phone || parsed.phone || "");

    // lock for verify to avoid races with concurrent resend/verify for same purpose
    await prisma.$transaction(async (tx) => {
      const lockKey = `auth-verify-otp:${userId}:${effectivePurpose}`;
      await advisoryLock(tx, lockKey);

      // consume the matched OTP
      await tx.otpCode.update({
        where: { id: matchedRow.id },
        data: { consumedAt },
      });

      // hygiene: invalidate any other active OTPs for same purpose for this user
      await tx.otpCode.updateMany({
        where: {
          userId,
          purpose: effectivePurpose,
          consumedAt: null,
          expiresAt: { gte: now },
        },
        data: { consumedAt, expiresAt: consumedAt },
      });

      // update user verification flag
      await tx.user.update({
        where: { id: userId },
        data: verifyData,
      });
    });

    const remainingTtlRaw = Math.max(0, Math.ceil((matchedRow.expiresAt.getTime() - Date.now()) / 1000));
    const ttlSeconds = Math.min(remainingTtlRaw, OTP_SESSION_MAX_SECONDS);

    const { token, exp } = signOtpSession({
      uid: userId,
      identifier: identifierCanonical,
      purpose: effectivePurpose,
      ttlSeconds,
    });

    const res = NextResponse.json({
      ok: true,
      ttlSeconds,
      userId,
      phoneVerified: parsed.type === "phone" ? true : undefined,
      emailVerified: parsed.type === "email" ? true : undefined,
      matched: OTP_DEBUG ? matchedWhy : undefined,
      otpSession: token,
      otpSessionExp: exp,
      purpose: effectivePurpose,

      clearResendTimer: true,
      resendAllowedNow: true,
    });

    res.headers.append(
      "Set-Cookie",
      cookieSerialize("otp_session", token, {
        maxAge: ttlSeconds,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        path: "/",
      })
    );

    return res;
  } catch (e) {
    console.error("[auth/verify-otp] error", e);
    // even on server error, UI should be able to request a fresh OTP instantly
    return NextResponse.json({ ok: false, error: "OTP_VERIFY_FAILED", clearResendTimer: true, resendAllowedNow: true }, { status: 500 });
  }
}
