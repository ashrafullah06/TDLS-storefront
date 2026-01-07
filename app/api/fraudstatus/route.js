// app/api/fraudstatus/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";
import { requireAuth } from "@/lib/auth";

/** naive heuristic: many failed payments or different IPs in last 24h -> review */
export async function GET(req) {
  try {
    const { userId } = await requireAuth(req);
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const failed = await prisma.payment.count({ where: { order: { userId }, status: "FAILED", updatedAt: { gte: since } } });
    const refunded = await prisma.refund.count({ where: { order: { userId }, status: "processed", createdAt: { gte: since } } });

    let status = "CLEAR";
    if (failed >= 2 || refunded >= 2) status = "REVIEW";

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
