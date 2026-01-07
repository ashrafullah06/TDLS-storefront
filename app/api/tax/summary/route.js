// FILE: app/api/tax/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Tax summary (last 30d unless query overrides).
 */
export async function GET(req) {
  const u = new URL(req.url);
  const now = new Date();
  const to = u.searchParams.get("to") ? new Date(u.searchParams.get("to")) : now;
  const from = u.searchParams.get("from")
    ? new Date(u.searchParams.get("from"))
    : new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  try {
    const taxAgg = await prisma.order.aggregate({
      where: { createdAt: { gte: from, lte: to }, taxTotal: { gt: 0 } },
      _sum: { taxTotal: true, grandTotal: true },
    });
    const taxedCount = await prisma.order.count({
      where: { createdAt: { gte: from, lte: to }, taxTotal: { gt: 0 } },
    });

    const collected = Number(taxAgg?._sum?.taxTotal ?? 0);
    const revenue = Number(taxAgg?._sum?.grandTotal ?? 0);
    const effectiveRate = revenue > 0 ? Number(((collected / revenue) * 100).toFixed(2)) : 0;

    return NextResponse.json({
      period: { from: from.toISOString(), to: to.toISOString() },
      collected,
      taxable_orders: taxedCount,
      effective_rate: effectiveRate,
    });
  } catch (e) {
    return NextResponse.json({ error: "tax summary unavailable", detail: String(e) }, { status: 503 });
  }
}
