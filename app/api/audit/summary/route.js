// FILE: app/api/audit/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Audit summary:
 * - recent logs count (last 7d)
 * - top actions
 */
export async function GET() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const total = await prisma.auditLog.count({ where: { at: { gte: since } } });
    const top = await prisma.auditLog.groupBy({
      by: ["action"],
      where: { at: { gte: since } },
      _count: { action: true },
      orderBy: { _count: { action: "desc" } },
      take: 5,
    });

    return NextResponse.json({ total, top });
  } catch (e) {
    return NextResponse.json({ error: "audit summary unavailable", detail: String(e) }, { status: 503 });
  }
}
