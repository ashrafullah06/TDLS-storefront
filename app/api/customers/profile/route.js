// FILE: app/api/customers/profile/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import crypto from "crypto";

const OTP_SECRET = process.env.OTP_SECRET;
if (!OTP_SECRET) throw new Error("OTP_SECRET is required");

function hmac(userId, purpose, code) {
  return crypto
    .createHmac("sha256", OTP_SECRET)
    .update(`${userId}:${purpose}:${code}`)
    .digest("hex");
}

export async function POST(req) {
  try {
    // ───────────── AUTH ─────────────
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    // ───────────── INPUT ─────────────
    const body = await req.json().catch(() => ({}));
    const name =
      typeof body.name === "string" && body.name.trim() !== ""
        ? body.name.trim()
        : undefined;
    const email =
      typeof body.email === "string" && body.email.trim() !== ""
        ? body.email.trim().toLowerCase()
        : undefined;
    const phone =
      typeof body.phone === "string" && body.phone.trim() !== ""
        ? body.phone.trim()
        : undefined;
    const otpCode =
      typeof body.otp === "string" && /^\d{6}$/.test(body.otp.trim())
        ? body.otp.trim()
        : null;
    const address = body.address || {};

    if (!name && !email && !phone && !address) {
      return NextResponse.json({ ok: false, error: "NO_FIELDS" }, { status: 400 });
    }

    // ───────────── PHONE & OTP VALIDATION ─────────────
    let verifiedPhone = null;
    if (phone) {
      // Check duplicate phone
      const duplicate = await prisma.user.findFirst({
        where: { phone, NOT: { id: userId } },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json(
          {
            ok: false,
            code: "PHONE_ALREADY_IN_USE",
            message:
              "You have another account with this mobile number. One number cannot be used in two different profiles. Please use a different number.",
          },
          { status: 409 }
        );
      }

      // Validate OTP if provided
      if (!otpCode) {
        return NextResponse.json(
          {
            ok: false,
            code: "OTP_REQUIRED",
            message: "Please enter the 6-digit OTP sent to your phone.",
          },
          { status: 400 }
        );
      }

      const otp = await prisma.otpCode.findFirst({
        where: {
          userId,
          purpose: "login",
          consumedAt: null,
          expiresAt: { gte: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!otp) {
        return NextResponse.json(
          {
            ok: false,
            code: "OTP_NOT_FOUND",
            message: "OTP not found or expired. Please request a new one.",
          },
          { status: 400 }
        );
      }

      const expected = hmac(userId, "login", otpCode);
      if (expected !== otp.codeHash) {
        await prisma.otpCode.update({
          where: { id: otp.id },
          data: { attemptCount: { increment: 1 } },
        });
        return NextResponse.json(
          { ok: false, code: "OTP_INVALID", message: "Invalid OTP. Please input the correct code." },
          { status: 400 }
        );
      }

      // Consume OTP and mark phone verified
      verifiedPhone = phone;
      await prisma.$transaction([
        prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } }),
        prisma.user.update({
          where: { id: userId },
          data: { phone, phoneVerifiedAt: new Date() },
        }),
      ]);
    }

    // ───────────── ADDRESS VALIDATION ─────────────
    if (address) {
      const { line1, city, state, countryIso2 } = address;
      if (!line1 || !city || !state || !countryIso2) {
        return NextResponse.json(
          {
            ok: false,
            code: "ADDRESS_FIELDS_REQUIRED",
            message:
              "Your default address needs street, city, district and country fields filled.",
          },
          { status: 400 }
        );
      }
    }

    // ───────────── SAVE NAME / EMAIL / ADDRESS ─────────────
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(verifiedPhone ? { phone: verifiedPhone } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true },
    });

    let savedAddress = null;
    if (address && verifiedPhone) {
      savedAddress = await prisma.address.upsert({
        where: { userId_isDefault: { userId, isDefault: true } },
        update: {
          ...address,
          phone: verifiedPhone,
          isDefault: true,
          updatedAt: new Date(),
        },
        create: {
          userId,
          ...address,
          phone: verifiedPhone,
          isDefault: true,
        },
      });
    }

    // ───────────── RESPONSE ─────────────
    return NextResponse.json({
      ok: true,
      message: "Profile and address saved successfully.",
      user: {
        ...updatedUser,
        phoneVerified: !!updatedUser.phoneVerifiedAt,
      },
      address: savedAddress,
    });
  } catch (err) {
    console.error("POST /api/customers/profile failed:", err);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
