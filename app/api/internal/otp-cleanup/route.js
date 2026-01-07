//my-project/app/api/internal/otp-cleanup/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = globalThis.__prisma || new PrismaClient();
if (!globalThis.__prisma) globalThis.__prisma = prisma;

// Protect this route with a simple bearer token
const CRON_TOKEN = process.env.INTERNAL_CRON_TOKEN || "";

export async function GET(req) {
  try {
    const auth = req.headers.get("authorization") || "";
    const ok = CRON_TOKEN && auth === `Bearer ${CRON_TOKEN}`;
    if (!ok) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const now = new Date();
    // 1) purge expired codes
    const delExpired = await prisma.otpCode.deleteMany({
      where: { expiresAt: { lt: now } },
    });

    // 2) hard-retention: drop anything older than N days (default 7)
    const days = Number(process.env.OTP_RETENTION_DAYS || 7);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const delOld = await prisma.otpCode.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return NextResponse.json({
      ok: true,
      deletedExpired: delExpired.count,
      deletedOld: delOld.count,
      retentionDays: days,
    });
  } catch (e) {
    console.error("[otp-cleanup]", e);
    return NextResponse.json({ error: "CLEANUP_FAILED" }, { status: 500 });
  }
}

// Optional: POST behaves the same (some cron providers prefer POST)
export const POST = GET;
