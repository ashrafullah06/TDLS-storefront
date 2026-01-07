// FILE: app/api/auth/complete-signup/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";

// Same canonicalizer used everywhere else
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^\d+]/g, "");

  const bdLocal = /^01[3-9]\d{8}$/;
  const bdIntl  = /^8801[3-9]\d{8}$/;
  const bdPlus  = /^\+8801[3-9]\d{8}$/;

  if (bdPlus.test(s)) return s;
  if (bdIntl.test(s)) return `+${s}`;
  if (bdLocal.test(s)) return `+88${s}`;

  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.indexOf("+") > 0) s = s.replace(/\+/g, "");

  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    return null;
  }
  if (s.length >= 8 && s.length <= 15) return `+${s}`;
  return null;
}

export async function POST(req) {
  try {
    const raw = await req.text();
    const body = raw ? JSON.parse(raw) : {};

    const { userId, name, gender, dob, email, phone, password, terms } = body;

    if (!userId) return NextResponse.json({ error: "NOT_VERIFIED" }, { status: 400 });
    if (!name?.trim() || !gender) return NextResponse.json({ error: "BASICS_REQUIRED" }, { status: 400 });

    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    if (!user.phoneVerifiedAt && !user.emailVerifiedAt)
      return NextResponse.json({ error: "NOT_VERIFIED" }, { status: 400 });

    const updates = { name: name.trim(), gender };

    if (dob) updates.dob = new Date(dob);

    if (email) {
      const lower = String(email).toLowerCase().trim();
      const exists = await prisma.user.findFirst({ where: { email: lower } });
      if (exists && exists.id !== userId) {
        return NextResponse.json({ error: "EMAIL_TAKEN" }, { status: 409 });
      }
      updates.email = lower;
      if (!user.emailVerifiedAt && user.email === lower) {
        updates.emailVerifiedAt = new Date();
      }
    }

    if (phone) {
      const normalized = normalizePhone(phone);
      if (!normalized) {
        return NextResponse.json({ error: "BAD_PHONE" }, { status: 400 });
      }
      // Enforce uniqueness on canonical phone
      const existsPhone = await prisma.user.findFirst({ where: { phone: normalized } });
      if (existsPhone && existsPhone.id !== userId) {
        return NextResponse.json({ error: "PHONE_TAKEN" }, { status: 409 });
      }
      updates.phone = normalized;
      // phoneVerifiedAt is set by the phone OTP flow, not here.
    }

    if (password) {
      updates.passwordHash = await bcrypt.hash(String(password), 10);
    }

    if (terms) updates.termsAcceptedAt = new Date();

    user = await prisma.user.update({ where: { id: userId }, data: updates, select: { id: true } });

    const res = NextResponse.json({ ok: true, userId: user.id });
    res.cookies.set("tdlc_uid", String(user.id), {
      httpOnly: true,
      path: "/",
      sameSite: "Lax",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    console.error("[complete-signup]", e);
    return NextResponse.json({ error: "COMPLETE_FAILED" }, { status: 500 });
  }
}
