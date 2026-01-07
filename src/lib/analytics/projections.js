// FILE: src/lib/analytics/projections.js
import prisma from "@/lib/prisma";
import { PAID_STATUSES, groupKey, money, round2, safeUpper } from "./_utils";

/**
 * Projections:
 * - monthly/quarterly/half-year/year forecasts using moving average + trend
 * - DB-only: does not depend on Strapi
 *
 * IMPORTANT:
 * - Do NOT filter paymentStatus in Prisma using a fixed IN list; schemas/enums/casing differ.
 *   Instead, fetch statuses and classify paid in JS via PAID_STATUSES + safeUpper.
 */
export async function computeProjections({ since, untilExclusive }) {
  const orders = await prisma.order
    .findMany({
      where: {
        createdAt: { gte: since, lt: untilExclusive },
      },
      select: { createdAt: true, grandTotal: true, paymentStatus: true },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => []);

  const m = new Map(); // month -> paid revenue
  for (const o of orders) {
    const ps = safeUpper(o.paymentStatus);
    if (!PAID_STATUSES.has(ps)) continue;

    const k = groupKey(o.createdAt, "month");
    m.set(k, (m.get(k) || 0) + money(o.grandTotal));
  }

  const months = Array.from(m.entries())
    .map(([month, revenue]) => ({ month, revenue: round2(revenue) }))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));

  const monthly = projectSeries(months.map((x) => x.revenue), { horizon: 12 });

  // Rollups:
  const quarterly = rollup(months, 3);
  const halfYearly = rollup(months, 6);
  const yearly = rollup(months, 12);

  return {
    monthly: { series: months, projection: monthly },
    quarterly: {
      series: quarterly,
      projection: projectSeries(quarterly.map((x) => x.revenue), { horizon: 4 }),
    },
    halfYearly: {
      series: halfYearly,
      projection: projectSeries(halfYearly.map((x) => x.revenue), { horizon: 2 }),
    },
    yearly: {
      series: yearly,
      projection: projectSeries(yearly.map((x) => x.revenue), { horizon: 1 }),
    },
  };
}

// Moving average + simple trend
function projectSeries(values, { horizon = 1 } = {}) {
  const v = (values || []).map(Number).filter((x) => Number.isFinite(x));
  if (!v.length) {
    return {
      method: "ma_trend",
      horizon,
      ma: 0,
      trend: 0,
      next: Array.from({ length: horizon }, () => 0),
    };
  }

  const tail = v.slice(-6);
  const ma = tail.reduce((s, x) => s + x, 0) / tail.length;

  // trend: last - first over tail
  const trend = tail.length >= 2 ? (tail[tail.length - 1] - tail[0]) / (tail.length - 1) : 0;

  const next = [];
  for (let i = 1; i <= horizon; i += 1) {
    next.push(round2(Math.max(0, ma + trend * i)));
  }

  return { method: "ma_trend", horizon, ma: round2(ma), trend: round2(trend), next };
}

function rollup(monthRows, span) {
  const out = [];
  let bucket = [];
  for (const r of monthRows) {
    bucket.push(r);
    if (bucket.length === span) {
      out.push({
        key: `${bucket[0].month}..${bucket[bucket.length - 1].month}`,
        revenue: round2(bucket.reduce((s, x) => s + x.revenue, 0)),
      });
      bucket = [];
    }
  }
  if (bucket.length) {
    out.push({
      key: `${bucket[0].month}..${bucket[bucket.length - 1].month}`,
      revenue: round2(bucket.reduce((s, x) => s + x.revenue, 0)),
    });
  }
  return out;
}
