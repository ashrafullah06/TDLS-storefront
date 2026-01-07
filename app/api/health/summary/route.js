// FILE: app/api/health/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Advanced health summary:
 * - Global status: ok | degraded | error
 * - version: app, commit, region, node, runtime
 * - checks: db, providers, shipments, orders_30d, inventory
 *
 * Backward-compatible fields kept:
 * - db: "ok" | "fail"
 * - providers: string[] of provider keys
 * - shipments: number
 */
export async function GET() {
  const startedAt = Date.now();

  async function timed(fn) {
    const start = Date.now();
    try {
      const data = await fn();
      const ms = Date.now() - start;
      return { ok: true, status: "ok", ms, ...data };
    } catch (e) {
      const ms = Date.now() - start;
      return {
        ok: false,
        status: "error",
        ms,
        error: String(e?.message || e),
      };
    }
  }

  try {
    // DB connectivity
    const dbCheck = await timed(async () => {
      // Minimal round-trip
      await prisma.$queryRaw`SELECT 1 as ok`;
      return { desc: "Database reachable" };
    });

    // Gateway providers
    const providersCheck = await timed(async () => {
      const providers = await prisma.gatewayFeeRate.findMany({
        distinct: ["provider"],
        select: { provider: true },
      });
      const codes = providers.map((p) => p.provider);
      return {
        desc: `Found ${codes.length} providers`,
        providers: codes,
        count: codes.length,
      };
    });

    // Shipments
    const shipmentsCheck = await timed(async () => {
      const shipments = await prisma.shipment.count();
      return {
        desc: `${shipments} shipments in system`,
        total: shipments,
      };
    });

    // Orders (last 30 days)
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const ordersCheck = await timed(async () => {
      const [count, agg] = await Promise.all([
        prisma.order.count({
          where: { createdAt: { gte: since } },
        }),
        prisma.order.aggregate({
          where: {
            createdAt: { gte: since },
            paymentStatus: { in: ["PAID", "SETTLED"] },
          },
          _sum: { grandTotal: true },
        }),
      ]);
      const revenue = Number(agg?._sum?.grandTotal ?? 0);
      return {
        desc: `${count} orders, ${revenue.toFixed(2)} total revenue in last 30d`,
        count,
        revenue,
        since: since.toISOString(),
      };
    });

    // Inventory
    const inventoryCheck = await timed(async () => {
      const items = await prisma.inventoryItem.findMany({
        select: {
          onHand: true,
          reserved: true,
          safetyStock: true,
        },
        take: 5000,
      });

      let onHand = 0;
      let reserved = 0;
      let safety = 0;
      let lowCount = 0;

      for (const it of items) {
        onHand += it.onHand || 0;
        reserved += it.reserved || 0;
        safety += it.safetyStock || 0;
        if ((it.onHand || 0) < (it.safetyStock || 0)) {
          lowCount += 1;
        }
      }

      return {
        desc: `${onHand} on-hand, ${reserved} reserved; ${lowCount} variants below safety stock`,
        onHand,
        reserved,
        safety,
        lowCount,
      };
    });

    const checks = {
      db: dbCheck,
      providers: providersCheck,
      shipments: shipmentsCheck,
      orders_30d: ordersCheck,
      inventory: inventoryCheck,
    };

    // Compute global status
    let overall = "ok";
    const allChecks = Object.values(checks);

    if (allChecks.some((c) => c.status === "error" || c.ok === false)) {
      overall = "error";
    } else if (
      allChecks.some(
        (c) =>
          c.status === "degraded" ||
          c.status === "warn" ||
          c.status === "unavailable"
      )
    ) {
      overall = "degraded";
    }

    // Version / environment
    const version = {
      app: process.env.APP_NAME || "tdlc",
      commit:
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GIT_COMMIT ||
        "local-dev",
      region:
        process.env.VERCEL_REGION ||
        process.env.FLY_REGION ||
        process.env.AWS_REGION ||
        "local",
      node: process.version,
      runtime: process.env.NEXT_RUNTIME || "nodejs",
    };

    const finishedAt = Date.now();

    return NextResponse.json({
      status: overall,
      timestamp: new Date().toISOString(),
      elapsedMs: finishedAt - startedAt,
      version,
      checks,

      // Backward-compatible fields (old shape)
      db: dbCheck.ok ? "ok" : "fail",
      providers: providersCheck.providers || [],
      shipments: shipmentsCheck.total ?? 0,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "health summary unavailable",
        detail: String(e),
      },
      { status: 503 }
    );
  }
}
