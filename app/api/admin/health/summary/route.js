// FILE: app/api/admin/health/summary/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

function json(body, status = 200) {
  return new NextResponse(
    body === undefined ? "null" : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

/**
 * Admin health check (used by dashboard tiles)
 * - db: "ok"/"fail"
 * - providers: distinct payment providers
 * - shipments: total shipment count
 */
export async function GET(req) {
  // Guard: only admins can see this
  try {
    await requireAdmin(req);
  } catch {
    return json(
      { ok: false, error: "UNAUTHORIZED", detail: "Admin access required" },
      401
    );
  }

  try {
    const dbCheck = await prisma.$queryRaw`SELECT 1 AS ok`;
    const providers = await prisma.gatewayFeeRate.findMany({
      distinct: ["provider"],
    });
    const shipments = await prisma.shipment.count();

    // dbCheck can be an array depending on driver
    const dbOk =
      Array.isArray(dbCheck) && dbCheck.length > 0
        ? dbCheck[0]?.ok === 1 || dbCheck[0]?.ok === "1"
        : !!dbCheck;

    return json(
      {
        ok: true,
        db: dbOk ? "ok" : "fail",
        providers: providers.map((p) => p.provider),
        shipments,
      },
      200
    );
  } catch (e) {
    return json(
      {
        ok: false,
        error: "health summary unavailable",
        detail: String(e),
      },
      503
    );
  }
}
