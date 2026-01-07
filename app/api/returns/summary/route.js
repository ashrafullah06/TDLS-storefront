// PATH: app/api/returns/summary/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

export async function GET(req) {
  // Guard: only admins can see this analytics summary
  try {
    await requireAdmin(req, {
      permission: Permissions.VIEW_RETURNS,
    });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return NextResponse.json(
      {
        error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
        detail: "Admin access required",
      },
      { status }
    );
  }

  const url = new URL(req.url);
  const days = Math.max(
    1,
    Math.min(90, Number(url.searchParams.get("days") || 7))
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const total = await prisma.returnRequest.count({
      where: { createdAt: { gte: since } },
    });

    const byStatusKeys = [
      "pending",
      "approved",
      "denied",
      "exchanged",
      "refunded",
    ];

    const byStatusCounts = await Promise.all(
      byStatusKeys.map((s) =>
        prisma.returnRequest.count({
          where: { createdAt: { gte: since }, status: s },
        })
      )
    );

    const byStatus = Object.fromEntries(
      byStatusKeys.map((s, i) => [s, byStatusCounts[i] || 0])
    );

    // "Open" cases = anything not final (here: pending + approved + exchanged)
    const open =
      (byStatus.pending || 0) +
      (byStatus.approved || 0) +
      (byStatus.exchanged || 0);

    return NextResponse.json({
      since: since.toISOString(),
      total,
      byStatus,
      open,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "returns summary unavailable",
        detail: String(e),
      },
      { status: 503 }
    );
  }
}
