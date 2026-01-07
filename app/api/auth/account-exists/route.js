// FILE: app/api/auth/account-exists/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Canonicalize to E.164-like form (BD local -> +880…; intl 00 -> +)
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^\d+]/g, "");

  const bdLocal = /^01[3-9]\d{8}$/;       // 11 digits
  const bdIntl  = /^8801[3-9]\d{8}$/;     // 13 digits
  const bdPlus  = /^\+8801[3-9]\d{8}$/;   // +880 format

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

function isEmail(v) {
  return /\S+@\S+\.\S+/.test(String(v || "").trim());
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // Accept identifier OR explicit email/phone
    const identifier = url.searchParams.get("identifier");
    const emailRaw = url.searchParams.get("email");
    const phoneRaw =
      url.searchParams.get("phone") ||
      url.searchParams.get("mobile") ||
      url.searchParams.get("phoneNumber");

    let email = null;
    let phone = null;

    if (identifier) {
      if (isEmail(identifier)) {
        email = String(identifier).toLowerCase().trim();
      } else {
        phone = normalizePhone(identifier);
      }
    } else {
      if (emailRaw) email = String(emailRaw).toLowerCase().trim();
      if (phoneRaw) phone = normalizePhone(phoneRaw);
    }

    if (!email && !phone) {
      return NextResponse.json(
        { error: "Provide ?identifier= or ?email= or ?phone=" },
        { status: 400 }
      );
    }

    const or = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });

    const user = await prisma.user.findFirst({
      where: { OR: or },
      select: { id: true, email: true, phone: true },
    });

    if (user) {
      return NextResponse.json({
        exists: true,
        field:
          email && user.email === email ? "email" :
          phone && user.phone === phone ? "phone" : null,
        userId: user.id,
      });
    }

    return NextResponse.json({ exists: false });
  } catch (err) {
    console.error("account-exists error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
