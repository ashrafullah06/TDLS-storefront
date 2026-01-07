//FILE: app/api/customers/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Customers summary:
 * - total users
 * - recent signups (last 30d)
 */
export async function GET() {
  try {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const total = await prisma.user.count();
    const recent = await prisma.user.count({
      where: { createdAt: { gte: since } },
    });

    return NextResponse.json({
      total,
      recent,
      new7d: recent, // alias for dashboard tile ("New 7d")
      since: since.toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "customers summary unavailable",
        detail: String(e),
      },
      { status: 503 }
    );
  }
}
