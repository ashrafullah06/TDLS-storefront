// FILE: app/api/reports/returns/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// helpers
const ONE_DAY = 86400000;
const parseDate = (s, f) => (s ? (isNaN(new Date(s)) ? f : new Date(s)) : f);
const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const start = parseDate(searchParams.get("start"), new Date(Date.now() - 30 * ONE_DAY));
  const end = parseDate(searchParams.get("end"), new Date());

  const range = { gte: new Date(start), lte: endOfDay(end) };
  const out = {
    start: toISO(start),
    end: toISO(end),
    totals: { returnsCount: 0, itemsReturned: 0, refundTotal: 0, returnRatePct: 0 },
    byProduct: [],
    byReason: [],
  };

  // 1) Gross revenue for same period (for return rate)
  let grossRevenue = 0;
  try {
    const statusFilter = { in: ["paid", "completed", "fulfilled"] };
    const agg = await prisma.order.aggregate({
      where: { createdAt: range, status: statusFilter },
      _sum: { totalAmount: true },
    });
    grossRevenue = Number(agg?._sum?.totalAmount || 0);
  } catch {}

  // 2) Returns via dedicated models, with fallbacks
  let returns = [];
  try {
    // Try common naming patterns
    returns = await prisma.orderReturn.findMany({
      where: { createdAt: range },
      select: {
        id: true,
        refundAmount: true,
        reason: true,
        createdAt: true,
        items: { select: { productId: true, sku: true, quantity: true, amount: true } },
      },
    });
  } catch {}
  if (!returns.length) {
    try {
      returns = await prisma.return.findMany({
        where: { createdAt: range },
        select: {
          id: true,
          refundAmount: true,
          reason: true,
          createdAt: true,
          returnItems: { select: { productId: true, sku: true, quantity: true, amount: true } },
        },
      });
    } catch {}
  }

  // 2b) Fallback: infer from orders with returned/refunded statuses
  if (!returns.length) {
    try {
      const orders = await prisma.order.findMany({
        where: {
          updatedAt: range,
          status: { in: ["returned", "refunded", "partially_refunded"] },
        },
        select: {
          id: true,
          refundTotal: true,
          updatedAt: true,
          items: { select: { productId: true, sku: true, quantity: true, total: true } },
        },
      });
      returns = orders.map((o) => ({
        id: o.id,
        refundAmount: o.refundTotal,
        reason: null,
        createdAt: o.updatedAt,
        items: (o.items || []).map((it) => ({
          productId: it.productId,
          sku: it.sku,
          quantity: Math.abs(Number(it.quantity || 0)), // treat as returned qty
          amount: Math.abs(Number(it.total || 0)),
        })),
      }));
    } catch {}
  }

  // 3) Aggregate
  const productMap = new Map();
  const reasonMap = new Map();
  for (const r of returns) {
    out.totals.returnsCount += 1;
    out.totals.refundTotal += Number(r.refundAmount || 0);
    const reason = (r.reason || "Unspecified").toString();
    reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);

    for (const it of r.items || []) {
      const pid = String(it.productId || it.sku || "unknown");
      const row = productMap.get(pid) || { id: pid, units: 0, refund: 0 };
      row.units += Number(it.quantity || 0);
      row.refund += Number(it.amount || 0);
      productMap.set(pid, row);
      out.totals.itemsReturned += Number(it.quantity || 0);
    }
  }

  // Return rate (by value) vs gross revenue
  out.totals.returnRatePct =
    grossRevenue > 0 ? round2((out.totals.refundTotal / grossRevenue) * 100) : 0;

  out.byProduct = Array.from(productMap.values())
    .map((r) => ({ id: r.id, units: r.units, refund: round2(r.refund) }))
    .sort((a, b) => b.refund - a.refund)
    .slice(0, 200);

  out.byReason = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json(out, { status: 200 });
}

function toISO(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
