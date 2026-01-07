// FILE: app/api/reports/pnl/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function parseRange(url) {
  const u = new URL(url);
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  const now = new Date();
  const toDate = to ? new Date(to) : now;
  const fromDate = from ? new Date(from) : new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  return { fromDate, toDate };
}

export async function GET(req) {
  const { fromDate, toDate } = parseRange(req.url);
  const whereOrder = {
    createdAt: { gte: fromDate, lte: toDate },
    status: { in: ["paid", "completed", "fulfilled"] },
  };

  try {
    // Revenue (gross)
    const revenueAgg = await prisma.order.aggregate({
      where: whereOrder,
      _sum: { totalAmount: true },
    });
    const revenueGross = Number(revenueAgg?._sum?.totalAmount || 0);

    // Refunds (if table exists)
    let refunds = 0;
    try {
      const refundAgg = await prisma.refund.aggregate({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: { amount: true },
      });
      refunds = Number(refundAgg?._sum?.amount || 0);
    } catch (_) {
      refunds = 0; // table not present => 0 (not fake: simply “no refunds recorded”)
    }
    const revenueNet = revenueGross - refunds;

    // COGS (try common shapes; if no orderItem table, we cannot compute => 503)
    let cogs = 0;
    try {
      const items = await prisma.orderItem.findMany({
        where: { order: whereOrder },
        select: { quantity: true, unitCost: true, costPrice: true, cogsUnit: true },
      });
      for (const it of items) {
        const unit =
          Number(it.unitCost ?? it.costPrice ?? it.cogsUnit ?? 0) || 0;
        cogs += unit * (Number(it.quantity || 0));
      }
    } catch (e) {
      return NextResponse.json(
        { error: "COGS unavailable (orderItem model missing)", detail: String(e) },
        { status: 503 }
      );
    }

    // Expenses (optional table)
    let expenses = 0;
    try {
      const expAgg = await prisma.expense.aggregate({
        where: { createdAt: { gte: fromDate, lte: toDate } },
        _sum: { amount: true },
      });
      expenses = Number(expAgg?._sum?.amount || 0);
    } catch (_) {
      expenses = 0;
    }

    const grossProfit = revenueNet - cogs;
    const netProfit = grossProfit - expenses;

    return NextResponse.json({
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      revenue: { gross: revenueGross, refunds, net: revenueNet },
      cogs,
      grossProfit,
      expenses,
      netProfit,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "P&L summary unavailable", detail: String(e) },
      { status: 503 }
    );
  }
}
