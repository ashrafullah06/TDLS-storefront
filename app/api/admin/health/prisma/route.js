// app/api/health/prisma/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Simple SELECT 1 (via Prisma) to confirm DB health */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, ms: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), ms: Date.now() - started }, { status: 500 });
  }
}
