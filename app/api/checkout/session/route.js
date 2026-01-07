//app/api/checkout/session/route.js
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import prisma from "@/lib/prisma";
import authOptions from "@/lib/authoptions";

function normalizeBdPhone(phone) {
  if (!phone) return null;
  const p = phone.replace(/\D/g, "");
  if (p.startsWith("880")) return "0" + p.slice(3);
  if (p.startsWith("01") && p.length === 11) return p;
  return null;
}

async function sendOtp({ identifier, channel }) {
  // wire to your SMS/Email provider; store only hashed codes in OtpCode elsewhere if you reuse
  return { sent: true, channel };
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();

    const {
      cartId, createAccount = false,
      name, phone, email,
      line1, line2, city, state, postalCode, countryIso2 = "BD",
      otpChannel = "SMS"
    } = body || {};

    const normPhone = normalizeBdPhone(phone);
    if (!normPhone) return NextResponse.json({ error: "PHONE_REQUIRED" }, { status: 400 });
    if (!line1 || !city) return NextResponse.json({ error: "ADDRESS_INCOMPLETE" }, { status: 400 });

    const cs = await prisma.checkoutSession.create({
      data: {
        userId: session?.user?.id || null,
        cartId: cartId || null,
        status: "PENDING",
        intent: "checkout",
        createAccount: Boolean(createAccount),
        name: name || null,
        phone: normPhone,
        email: email || null,
        line1, line2: line2 || null, city, state: state || null, postalCode: postalCode || null, countryIso2,
        otpIdentifier: normPhone,
        otpPurpose: session?.user?.id ? "login" : "signup",
        otpChannel,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 min
      }
    });

    await sendOtp({ identifier: normPhone, channel: otpChannel });

    return NextResponse.json({ sessionId: cs.id, next: "/signup?sessionId=" + cs.id }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/checkout/session] ", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
