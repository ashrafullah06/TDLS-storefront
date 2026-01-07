// FILE: src/lib/analytics/orders.js
import prisma from "@/lib/prisma";
import { PAID_STATUSES, groupKey, money, pct, round2, safeUpper } from "./_utils";

/**
 * Orders analytics:
 * - status pipeline
 * - fulfillment pipeline
 * - AOV
 * - cohort summaries (first-order month, repeat rate)
 * - SLA-ish timings (created -> fulfilled/completed) when timestamps exist
 */
export async function computeOrders({ since, untilExclusive, group = "day" }) {
  const where = { createdAt: { gte: since, lt: untilExclusive } };

  const orders = await prisma.order
    .findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        paidAt: true,
        fulfilledAt: true,
        completedAt: true,
        grandTotal: true,
        userId: true,
      },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => []);

  const pipeline = {
    status: {},
    paymentStatus: {},
    fulfillmentStatus: {},
  };

  const grouped = new Map(); // periodKey -> metrics
  const ensure = (k) => {
    if (!grouped.has(k)) {
      grouped.set(k, {
        period: k,
        orders: 0,
        paidOrders: 0,
        revenuePaid: 0,
        aovPaid: 0,
        fulfilled: 0,
        completed: 0,
        pending: 0,
        canceled: 0,
        avgFulfillmentHours: 0,
        avgCompletionHours: 0,
      });
    }
    return grouped.get(k);
  };

  const fulfillmentHours = new Map(); // period -> [hours...]
  const completionHours = new Map();

  for (const o of orders) {
    const st = safeUpper(o.status);
    const ps = safeUpper(o.paymentStatus);
    const fs = safeUpper(o.fulfillmentStatus);

    pipeline.status[st] = (pipeline.status[st] || 0) + 1;
    pipeline.paymentStatus[ps] = (pipeline.paymentStatus[ps] || 0) + 1;
    pipeline.fulfillmentStatus[fs] = (pipeline.fulfillmentStatus[fs] || 0) + 1;

    const key = groupKey(o.createdAt, group);
    const row = ensure(key);

    row.orders += 1;

    const isPaid = PAID_STATUSES.has(ps);
    if (isPaid) {
      row.paidOrders += 1;
      row.revenuePaid += money(o.grandTotal);
    }

    if (st === "FULFILLED") row.fulfilled += 1;
    if (st === "COMPLETED") row.completed += 1;
    if (st === "CANCELED") row.canceled += 1;
    if (st === "PENDING" || st === "PLACED" || st === "CONFIRMED") row.pending += 1;

    if (o.fulfilledAt) {
      const hrs =
        (new Date(o.fulfilledAt).getTime() - new Date(o.createdAt).getTime()) /
        (1000 * 60 * 60);
      if (Number.isFinite(hrs) && hrs >= 0) {
        if (!fulfillmentHours.has(key)) fulfillmentHours.set(key, []);
        fulfillmentHours.get(key).push(hrs);
      }
    }

    if (o.completedAt) {
      const hrs =
        (new Date(o.completedAt).getTime() - new Date(o.createdAt).getTime()) /
        (1000 * 60 * 60);
      if (Number.isFinite(hrs) && hrs >= 0) {
        if (!completionHours.has(key)) completionHours.set(key, []);
        completionHours.get(key).push(hrs);
      }
    }
  }

  const series = Array.from(grouped.values())
    .map((r) => {
      const aov = r.paidOrders > 0 ? r.revenuePaid / r.paidOrders : 0;

      const fh = fulfillmentHours.get(r.period) || [];
      const ch = completionHours.get(r.period) || [];
      const avg = (arr) =>
        arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

      return {
        ...r,
        revenuePaid: round2(r.revenuePaid),
        aovPaid: round2(aov),
        avgFulfillmentHours: round2(avg(fh)),
        avgCompletionHours: round2(avg(ch)),
      };
    })
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));

  // Cohorts: first-order month -> customers, repeat customers, revenue
  // IMPORTANT: do NOT rely on enum/value matching in DB filters; compute paid-ness in JS.
  const cohorts = await computeCohorts({ since, untilExclusive });

  const totals = {
    orders: orders.length,
    paidOrders: orders.reduce(
      (c, o) => (PAID_STATUSES.has(safeUpper(o.paymentStatus)) ? c + 1 : c),
      0
    ),
    revenuePaid: round2(
      orders.reduce(
        (s, o) =>
          PAID_STATUSES.has(safeUpper(o.paymentStatus))
            ? s + money(o.grandTotal)
            : s,
        0
      )
    ),
  };
  totals.aovPaid = totals.paidOrders > 0 ? round2(totals.revenuePaid / totals.paidOrders) : 0;

  return { totals, pipeline, series, cohorts };
}

async function computeCohorts({ since, untilExclusive }) {
  // Pull orders with userId, then classify "paid" in JS to avoid enum/value mismatch in Prisma filters.
  const rows = await prisma.order
    .findMany({
      where: {
        createdAt: { gte: since, lt: untilExclusive },
        userId: { not: null },
      },
      select: {
        userId: true,
        createdAt: true,
        grandTotal: true,
        paymentStatus: true,
      },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => []);

  // For each user: first order month, order count, revenue (paid only)
  const u = new Map();
  for (const r of rows) {
    const ps = safeUpper(r.paymentStatus);
    if (!PAID_STATUSES.has(ps)) continue;

    const uid = r.userId;
    const month = groupKey(r.createdAt, "month");
    if (!u.has(uid)) u.set(uid, { firstMonth: month, orders: 0, revenue: 0 });

    const x = u.get(uid);
    if (String(month) < String(x.firstMonth)) x.firstMonth = month;

    x.orders += 1;
    x.revenue += money(r.grandTotal);
  }

  const cohort = new Map();
  for (const [, v] of u.entries()) {
    if (!cohort.has(v.firstMonth)) {
      cohort.set(v.firstMonth, {
        month: v.firstMonth,
        customers: 0,
        repeatCustomers: 0,
        orders: 0,
        revenue: 0,
      });
    }
    const c = cohort.get(v.firstMonth);
    c.customers += 1;
    if (v.orders >= 2) c.repeatCustomers += 1;
    c.orders += v.orders;
    c.revenue += v.revenue;
  }

  return Array.from(cohort.values())
    .map((c) => ({
      ...c,
      revenue: round2(c.revenue),
      repeatRate: pct(c.repeatCustomers, c.customers),
    }))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
}
