// FILE: app/api/reports/returns/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") || 30)));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  try {
    const total = await prisma.returnRequest.count({ where: { createdAt: { gte: since } } });
    const keys = ["pending", "approved", "denied", "exchanged", "refunded"];
    const counts = await Promise.all(
      keys.map((s) =>
        prisma.returnRequest.count({ where: { createdAt: { gte: since }, status: s } })
      )
    );
    return NextResponse.json({
      since: since.toISOString(),
      total,
      byStatus: Object.fromEntries(keys.map((k, i) => [k, counts[i] || 0])),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "returns report unavailable (returnRequest model missing)", detail: String(e) },
      { status: 503 }
    );
  }
}
