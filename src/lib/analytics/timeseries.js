// FILE: src/lib/analytics/timeseries.js
import prisma from "@/lib/prisma";
import { PAID_STATUSES, dayKeyFromOffset, money, round2, safeUpper } from "./_utils";

/**
 * Timeseries used by old /api/admin/analytics payloads.
 * Returns continuous series for the range.
 *
 * NOTE:
 * - If paidOnly=true, "orders" and "revenueGross" reflect ONLY paid-ish orders.
 * - "paidOrders" and "revenuePaid" always reflect paid-ish orders.
 */
export async function computeTimeseries({
  since,
  untilExclusive,
  tzOffsetMinutes = 360,
  days,
  statuses = null,
  paidOnly = false,
}) {
  const createdAtWhere = { gte: since, lt: untilExclusive };

  const orderWhere = {
    createdAt: createdAtWhere,
    ...(statuses?.length ? { status: { in: statuses } } : {}),
  };

  const [orders, refunds, returns, customers] = await Promise.all([
    prisma.order
      .findMany({
        where: orderWhere,
        select: {
          createdAt: true,
          grandTotal: true,
          paymentStatus: true,
          status: true,
        },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => []),

    prisma.refund
      ?.findMany({
        where: { createdAt: createdAtWhere },
        select: { createdAt: true, amount: true, status: true },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => []),

    prisma.returnRequest
      ?.findMany({
        where: { createdAt: createdAtWhere },
        select: { createdAt: true, status: true, reason: true },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => []),

    prisma.user
      .findMany({
        where: { createdAt: createdAtWhere },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      })
      .catch(() => []),
  ]);

  const map = new Map();
  const ensure = (day) => {
    if (!map.has(day)) {
      map.set(day, {
        day,
        orders: 0,
        paidOrders: 0,
        revenuePaid: 0,
        revenueGross: 0,
        refundsAmount: 0,
        returnsCount: 0,
        newCustomers: 0,
      });
    }
    return map.get(day);
  };

  for (const o of orders) {
    const day = dayKeyFromOffset(o.createdAt, tzOffsetMinutes);
    const row = ensure(day);

    const ps = safeUpper(o.paymentStatus);
    const isPaid = PAID_STATUSES.has(ps);

    // If paidOnly=true, count ONLY paid-ish orders in the "orders" counter
    // and keep revenueGross aligned to that same set.
    if (!paidOnly || isPaid) {
      row.orders += 1;
      row.revenueGross += money(o.grandTotal);
    }

    // Paid metrics always track paid-ish orders.
    if (isPaid) {
      row.paidOrders += 1;
      row.revenuePaid += money(o.grandTotal);
    }
  }

  for (const r of refunds || []) {
    const day = dayKeyFromOffset(r.createdAt, tzOffsetMinutes);
    const row = ensure(day);
    row.refundsAmount += money(r.amount);
  }

  for (const rr of returns || []) {
    const day = dayKeyFromOffset(rr.createdAt, tzOffsetMinutes);
    const row = ensure(day);
    row.returnsCount += 1;
  }

  for (const u of customers || []) {
    const day = dayKeyFromOffset(u.createdAt, tzOffsetMinutes);
    const row = ensure(day);
    row.newCustomers += 1;
  }

  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dayKeyFromOffset(d, tzOffsetMinutes);
    const v = map.get(key) || ensure(key);

    const paidRate = v.orders > 0 ? v.paidOrders / v.orders : 0;
    const aovPaid = v.paidOrders > 0 ? v.revenuePaid / v.paidOrders : 0;

    series.push({
      day: v.day,
      orders: v.orders,
      paidOrders: v.paidOrders,
      revenuePaid: round2(v.revenuePaid),
      revenueGross: round2(v.revenueGross),
      refundsAmount: round2(v.refundsAmount),
      returnsCount: v.returnsCount,
      newCustomers: v.newCustomers,
      aovPaid: round2(aovPaid),
      paidRate: Math.round(paidRate * 1000) / 10,
    });
  }

  const totals = {
    orders: series.reduce((s, r) => s + (r.orders || 0), 0),
    paidOrders: series.reduce((s, r) => s + (r.paidOrders || 0), 0),
    revenuePaid: round2(series.reduce((s, r) => s + (r.revenuePaid || 0), 0)),
    revenueGross: round2(series.reduce((s, r) => s + (r.revenueGross || 0), 0)),
    refundsAmount: round2(series.reduce((s, r) => s + (r.refundsAmount || 0), 0)),
    returnsCount: series.reduce((s, r) => s + (r.returnsCount || 0), 0),
    newCustomers: series.reduce((s, r) => s + (r.newCustomers || 0), 0),
  };

  return { series, totals };
}
