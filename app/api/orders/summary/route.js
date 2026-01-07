// FILE: app/api/orders/summary/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Orders summary KPIs:
 * - Counts by OrderStatus (last 30 days)
 * - Counts by PaymentStatus (last 30 days)
 * - Revenue (grandTotal) for paid-like orders
 * - Dashboard KPIs:
 *   - ordersToday (BD day boundary)
 *   - ordersLast7d
 *   - ordersLast30d
 *   - ordersAllTime
 *   - revenueToday (paid-like, BD day boundary)
 *   - revenueLast7d (paid-like)
 *   - revenueLast30d (paid-like)
 *   - revenueAllTime (paid-like)
 *   - pending (PLACED)
 *   - confirmedToday (CONFIRMED today)
 *   - deliveredToday (COMPLETED today)
 *   - deliveredLast7d (COMPLETED last 7d)
 */
export async function GET() {
  try {
    const now = new Date();
    const dayMs = 24 * 3600 * 1000;

    // Asia/Dhaka day boundary (UTC+6) for "today"
    const bdOffsetMs = 6 * 3600 * 1000;
    const nowBD = new Date(now.getTime() + bdOffsetMs);
    const startOfTodayBD = new Date(nowBD);
    startOfTodayBD.setHours(0, 0, 0, 0);
    const startOfToday = new Date(startOfTodayBD.getTime() - bdOffsetMs);

    const since30 = new Date(now.getTime() - 30 * dayMs);
    const since7 = new Date(now.getTime() - 7 * dayMs);

    const orderStatuses = [
      "DRAFT",
      "PLACED",
      "CONFIRMED",
      "CANCELLED",
      "COMPLETED",
      "ARCHIVED",
    ];

    const paymentStatuses = [
      "UNPAID",
      "PENDING",
      "AUTHORIZED",
      "PAID",
      "INITIATED",
      "SETTLED",
      "PARTIALLY_REFUNDED",
      "REFUNDED",
      "FAILED",
      "CANCELED",
    ];

    const PAIDLIKE = ["PAID", "SETTLED"];

    // ───────────────────────── last 30 days breakdowns ─────────────────────────
    const [groupedByStatus, groupedByPayment] = await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since30 } },
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ["paymentStatus"],
        where: { createdAt: { gte: since30 } },
        _count: { _all: true },
      }),
    ]);

    const byStatus = {};
    for (const s of orderStatuses) {
      const row = groupedByStatus.find((r) => r.status === s);
      byStatus[s] = row?._count?._all ?? 0;
    }

    const byPayment = {};
    for (const s of paymentStatuses) {
      const row = groupedByPayment.find((r) => r.paymentStatus === s);
      byPayment[s] = row?._count?._all ?? 0;
    }

    // ───────────────────────── revenue aggregates ─────────────────────────
    const [revenueAgg30, revenueAgg7, revenueAggAll] = await Promise.all([
      prisma.order.aggregate({
        where: { createdAt: { gte: since30 }, paymentStatus: { in: PAIDLIKE } },
        _sum: { grandTotal: true },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: since7 }, paymentStatus: { in: PAIDLIKE } },
        _sum: { grandTotal: true },
      }),
      prisma.order.aggregate({
        where: { paymentStatus: { in: PAIDLIKE } },
        _sum: { grandTotal: true },
      }),
    ]);

    // ───────────────────────── dashboard KPI counts ─────────────────────────
    const [
      ordersToday,
      ordersLast7d,
      ordersLast30d,
      ordersAllTime,
      revenueTodayAgg,

      pending,
      confirmedToday,
      deliveredToday,
      deliveredLast7d,
    ] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.order.count({ where: { createdAt: { gte: since7 } } }),
      prisma.order.count({ where: { createdAt: { gte: since30 } } }),
      prisma.order.count({}),
      prisma.order.aggregate({
        where: { createdAt: { gte: startOfToday }, paymentStatus: { in: PAIDLIKE } },
        _sum: { grandTotal: true },
      }),

      prisma.order.count({ where: { status: "PLACED" } }),
      prisma.order.count({ where: { createdAt: { gte: startOfToday }, status: "CONFIRMED" } }),
      prisma.order.count({ where: { createdAt: { gte: startOfToday }, status: "COMPLETED" } }),
      prisma.order.count({ where: { createdAt: { gte: since7 }, status: "COMPLETED" } }),
    ]);

    const revenueToday = Number(revenueTodayAgg?._sum?.grandTotal ?? 0);
    const revenueLast7d = Number(revenueAgg7?._sum?.grandTotal ?? 0);
    const revenueLast30d = Number(revenueAgg30?._sum?.grandTotal ?? 0);
    const revenueAllTime = Number(revenueAggAll?._sum?.grandTotal ?? 0);

    return NextResponse.json({
      ok: true,
      period: {
        since30: since30.toISOString(),
        since7: since7.toISOString(),
        startOfTodayBD: startOfToday.toISOString(),
      },

      byStatus,
      byPayment,

      // Revenue
      revenueToday,
      revenueLast7d,
      revenueLast30d,
      revenueAllTime,

      // Counts
      ordersToday,
      ordersLast7d,
      ordersLast30d,
      ordersAllTime,

      // Operational rollups
      pending,
      confirmedToday,
      deliveredToday,
      deliveredLast7d,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "orders summary unavailable", detail: String(e) },
      { status: 503 }
    );
  }
}
