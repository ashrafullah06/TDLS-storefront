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
 * MUST MATCH your canonical phone handling used in auth:
 * - digits only (no '+')
 * - Bangladesh:
 *    "01XXXXXXXXX"    -> "8801XXXXXXXXX"
 *    "+8801XXXXXXXXX" -> "8801XXXXXXXXX"
 *    "8801XXXXXXXXX"  -> "8801XXXXXXXXX"
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
 * Hash password:
 * - prefer bcrypt if available
 * - else PBKDF2: pbkdf2$ITER$SALT_B64$HASH_B64
 */
async function hashPassword(password) {
  if (bcryptjs) {
    const salt = await bcryptjs.genSalt(BCRYPT_ROUNDS);
    return await bcryptjs.hash(password, salt);
  }

  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PWD_ITER, PWD_KEYLEN, PWD_DIGEST);
  return `pbkdf2$${PWD_ITER}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Find user(s) robustly by identifier.
 * - Email: canonical
 * - Phone: search across common legacy formats and columns; return ALL matches (deduped)
 *   so we can update them all and eliminate “old password still works”.
 */
async function findUsersByIdentifier(parsed) {
  if (!parsed?.type || !parsed?.value) return [];

  if (parsed.type === "email") {
    const u = await prisma.user.findFirst({ where: { email: parsed.value } });
    return u ? [u] : [];
  }

  // phone
  const digits = parsed.value;

  // Generate variants for backward compatibility
  const variants = new Set([digits]);

  // Some legacy stores might have "+digits"
  variants.add(`+${digits}`);

  // Bangladesh local "01XXXXXXXXX" possibility derived from canonical "8801XXXXXXXXX"
  if (digits.startsWith("880") && digits.length === 13) {
    variants.add(`0${digits.slice(3)}`); // "8801..." -> "01..."
    variants.add(`+${digits}`); // "+8801..."
  }

  const inList = Array.from(variants);

  const keys = ["phone", "phoneNumber", "mobile", "phone_number"];
  const found = new Map();

  for (const k of keys) {
    try {
      const users = await prisma.user.findMany({
        where: { [k]: { in: inList } },
        select: { id: true, email: true, phone: true },
      });
      for (const u of users || []) found.set(u.id, u);
    } catch {
      // Field may not exist in Prisma schema — skip safely
    }
  }

  return Array.from(found.values());
}

/**
 * Verify OTP through universal endpoint with safe fallbacks.
 * Keeps compatibility with variations in "purpose" naming.
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

  // Try password_reset → default → login
  const a = await call({ ...payloadBase, purpose: "password_reset" });
  if (a.r.ok && (a.j?.ok || a.j?.verified)) return { ok: true, via: a.j?.via };

  const b = await call({ ...payloadBase });
  if (b.r.ok && (b.j?.ok || b.j?.verified)) return { ok: true, via: b.j?.via };

  const c = await call({ ...payloadBase, purpose: "login" });
  if (c.r.ok && (c.j?.ok || c.j?.verified)) return { ok: true, via: c.j?.via };

  const err = a.j?.error || b.j?.error || c.j?.error || "OTP_INVALID_OR_EXPIRED";
  const status = a.r.status || b.r.status || c.r.status || 400;
  return { ok: false, error: err, status };
}

/**
 * Best-effort: invalidate DB sessions after password reset (if Session model exists)
 */
async function bestEffortInvalidateSessions(userIds) {
  try {
    await prisma.session.deleteMany({
      where: { userId: { in: userIds } },
    });
  } catch {
    // ignore if Session model doesn't exist / JWT sessions / different schema
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));

    const parsed = detectIdentifier(body?.identifier);
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

    // IMPORTANT: verify OTP using the same canonical identifier format that OTP was requested with.
    const verified = await verifyOtpWithFallback(req.url, {
      identifier: parsed.value,
      code,
    });

    if (!verified.ok) {
      return NextResponse.json({ ok: false, error: verified.error }, { status: verified.status });
    }

    // Find ALL matching users (prevents "old password still works" due to format duplicates)
    const users = await findUsersByIdentifier(parsed);
    if (!users.length) {
      return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // FIX: must await the async hash (bcrypt) and keep pbkdf2 compatible
    const passwordHash = await hashPassword(newPassword);
    const ids = users.map((u) => u.id);

    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { passwordHash },
    });

    // Best-effort: invalidate sessions
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
