// FILE: app/api/auth/reset-password/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";

// Optional bcrypt (preferred if installed)
let bcryptjs = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  bcryptjs = require("bcryptjs");
} catch {}

/* ───────────────── config ───────────────── */
const PWD_ITER = Number(process.env.PBKDF2_ITER || 120_000);
const PWD_KEYLEN = 32;
const PWD_DIGEST = "sha256";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

const isEmailish = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

/**
 * Canonical phone normalization (digits only).
 * Bangladesh-friendly:
 * - "01XXXXXXXXX"    -> "8801XXXXXXXXX"
 * - "+8801XXXXXXXXX" -> "8801XXXXXXXXX"
 * - "8801XXXXXXXXX"  -> "8801XXXXXXXXX"
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
    // already canonical
  }

  const digits = s.replace(/\+/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function detectIdentifier(raw) {
  const val = String(raw || "").trim();
  if (!val) return { type: null, value: null };
  if (isEmailish(val)) return { type: "email", value: val.toLowerCase() };

  const phone = normalizePhone(val);
  if (phone) return { type: "phone", value: phone };

  return { type: null, value: null };
}

/**
 * Build phone candidates to handle legacy duplicates in DB.
 * We always *verify OTP* using canonical digits-only, but we update password for
 * all matching rows (digits, +digits, 0XXXXXXXXXX where applicable).
 */
function phoneCandidates(rawOrCanonical) {
  const canonical = normalizePhone(rawOrCanonical);
  if (!canonical) return [];

  const set = new Set();
  set.add(canonical);

  // +digits variant
  set.add(`+${canonical}`);

  // Bangladesh: if starts with 880 and has 13 digits total (880 + 10)
  if (/^880\d{10}$/.test(canonical)) {
    set.add(`0${canonical.slice(3)}`); // 01XXXXXXXXX
    set.add(`+${canonical}`); // +880...
  }

  // Raw digits-only fallback
  const rawDigits = String(rawOrCanonical || "").replace(/[^\d]/g, "");
  if (rawDigits) {
    set.add(rawDigits);
    if (!rawDigits.startsWith("+")) set.add(`+${rawDigits}`);
  }

  return Array.from(set);
}

/**
 * Hash password for storage:
 * - prefer bcrypt if available
 * - else PBKDF2 in your pbkdf2$ITER$SALT$HASH format
 */
async function hashPassword(password) {
  const pwd = String(password ?? "");
  if (!pwd) throw new Error("password_required");

  if (bcryptjs) {
    const salt = await bcryptjs.genSalt(BCRYPT_ROUNDS);
    return await bcryptjs.hash(pwd, salt);
  }

  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pwd, salt, PWD_ITER, PWD_KEYLEN, PWD_DIGEST);
  return `pbkdf2$${PWD_ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Find ALL user rows that can represent this identifier.
 * This eliminates “old password still works” when duplicates exist by phone formatting.
 */
async function findUsersByIdentifier(parsed, rawIdentifierForCandidates) {
  if (!parsed?.type || !parsed?.value) return [];

  if (parsed.type === "email") {
    const u = await prisma.user.findFirst({ where: { email: parsed.value } });
    return u ? [u] : [];
  }

  // phone
  const cands = phoneCandidates(rawIdentifierForCandidates || parsed.value);
  if (!cands.length) return [];

  // Your Prisma schema uses User.phone
  const users = await prisma.user.findMany({
    where: { phone: { in: cands } },
  });

  // Dedup by id
  const byId = new Map(users.map((u) => [u.id, u]));
  return Array.from(byId.values());
}

/**
 * Verify OTP via your existing universal endpoint.
 * We try purpose variants to remain compatible with older clients.
 */
async function verifyOtpWithFallback(reqUrl, payloadBase) {
  async function call(payload) {
    const r = await fetch(new URL("/api/auth/verify-otp", reqUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  }

  // Prefer your current naming first (matches forgot-password route usage)
  const purposes = ["password_change", "password_reset", "login", null];

  let last = null;
  for (const p of purposes) {
    const payload = p ? { ...payloadBase, purpose: p } : { ...payloadBase };
    const out = await call(payload);
    last = out;

    if (out.r.ok && (out.j?.ok || out.j?.verified)) {
      return { ok: true, via: out.j?.via || null };
    }

    // If endpoint responds clearly about invalid purpose, continue trying.
    // Otherwise keep looping; final error will be returned.
  }

  const err = last?.j?.error || "OTP_INVALID_OR_EXPIRED";
  const status = last?.r?.status || 400;
  return { ok: false, error: err, status };
}

/**
 * Best-effort: invalidate DB sessions after password reset (if Session model exists).
 * If you use JWT sessions, this won't remove them (that requires a “passwordChangedAt” gate).
 */
async function bestEffortInvalidateSessions(userIds) {
  try {
    await prisma.session.deleteMany({
      where: { userId: { in: userIds } },
    });
  } catch {
    // ignore if Session model doesn't exist / different schema
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));

    const rawIdentifier = body?.identifier;
    const parsed = detectIdentifier(rawIdentifier);
    const code = String(body?.code || "").trim();
    const newPassword = String(body?.newPassword || "");

    if (!parsed.type) {
      return NextResponse.json({ ok: false, error: "IDENTIFIER_REQUIRED" }, { status: 400 });
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ ok: false, error: "CODE_REQUIRED" }, { status: 400 });
    }
    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json({ ok: false, error: "WEAK_PASSWORD" }, { status: 400 });
    }

    // IMPORTANT: verify OTP using canonical identifier (digits-only for phone)
    const verified = await verifyOtpWithFallback(req.url, {
      identifier: parsed.value,
      code,
    });

    if (!verified.ok) {
      return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });
    }

    // Update password for ALL matching rows (prevents duplicates keeping old password alive)
    const users = await findUsersByIdentifier(parsed, rawIdentifier);
    if (!users.length) {
      return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    const passwordHash = await hashPassword(newPassword); // ✅ MUST await
    const ids = users.map((u) => u.id);

    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { passwordHash },
    });

    await bestEffortInvalidateSessions(ids);

    return NextResponse.json({
      ok: true,
      updatedUsers: ids.length,
    });
  } catch (e) {
    console.error("[reset-password]", e);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
