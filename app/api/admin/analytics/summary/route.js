// FILE: app/api/admin/analytics/summary/route.js
import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

// ---- helpers ----
function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function clampInt(v, min, max, d) {
  const x = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return d;
  return Math.max(min, Math.min(max, x));
}

function parseISODateOnly(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = n(m[1]);
  const mo = n(m[2]);
  const d = n(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function parseDateAny(s) {
  if (!s) return null;
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function iso(dt) {
  return dt instanceof Date && Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

function pctChange(curr, prev) {
  const c = n(curr, 0);
  const p = n(prev, 0);
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
}

async function safeCall(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function coerceMoney(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") return n(v, 0);
  if (typeof v === "object" && typeof v.toString === "function") return n(v.toString(), 0);
  return 0;
}

function jsonNoStore(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function parseCsvUpper(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const arr = s
    .split(",")
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);
  return arr.length ? arr : null;
}

function parseInclude(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const out = s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return out.length ? out : null;
}

/**
 * Safe “day key” bucketing using tzOffsetMinutes (no SQL timezone() injection).
 * Shift timestamp to target tz, then use UTC date of shifted time.
 */
function dayKeyFromOffset(dt, tzOffsetMinutes) {
  const ms = new Date(dt).getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function startOfLocalDayUtc(now, tzOffsetMinutes) {
  const ms = now.getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - tzOffsetMinutes * 60 * 1000);
}

// ---- admin-only guard (decoupled from customer) ----
async function requireAdminSignal() {
  const jar = await cookies();

  const adminRole =
    jar.get("admin_role")?.value ||
    jar.get("tdlc_admin_role")?.value ||
    jar.get("adminRole")?.value ||
    "";

  const adminSession =
    jar.get("admin_session")?.value ||
    jar.get("tdlc_admin_session")?.value ||
    jar.get("admin_sid")?.value ||
    "";

  const ok = Boolean(adminRole || adminSession);

  return {
    ok,
    role: adminRole || null,
    sessionId: adminSession || null,
  };
}

export async function GET(req) {
  const gate = await requireAdminSignal();
  if (!gate.ok) {
    return jsonNoStore(
      {
        ok: false,
        error: "admin_auth_required",
        message: "Admin session not detected. Please sign in to the admin panel.",
      },
      401
    );
  }

  const url = new URL(req.url);
  const qp = url.searchParams;

  const debug = qp.get("debug") === "1";
  const compare = qp.get("compare") === "1";
  const include = parseInclude(qp.get("include"));
  const tzOffsetMinutes = n(qp.get("tzOffsetMinutes"), 360); // Asia/Dhaka default

  // Range selection
  const startParam = qp.get("start");
  const endParam = qp.get("end");
  const daysParam = qp.get("days");

  let start = null;
  let endExclusive = null;

  // If start/end are YYYY-MM-DD, treat as local dates for tzOffsetMinutes
  // endExclusive = end + 1 day
  const sDay = parseISODateOnly(startParam);
  const eDay = parseISODateOnly(endParam);

  if (sDay && eDay && eDay >= sDay) {
    start = new Date(sDay.getTime() - tzOffsetMinutes * 60 * 1000);
    endExclusive = new Date(eDay.getTime() - tzOffsetMinutes * 60 * 1000 + DAY);
  } else {
    const days = clampInt(daysParam, 1, MAX_RANGE_DAYS, DEFAULT_RANGE_DAYS);
    const todayLocalStartUtc = startOfLocalDayUtc(new Date(), tzOffsetMinutes);
    start = new Date(todayLocalStartUtc.getTime() - (days - 1) * DAY);
    endExclusive = new Date(todayLocalStartUtc.getTime() + DAY);
  }

  const rangeMs = endExclusive.getTime() - start.getTime();
  const prevEndExclusive = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - rangeMs);

  const meta = {
    generatedAt: new Date().toISOString(),
    tzOffsetMinutes,
    start: iso(start),
    endExclusive: iso(endExclusive),
    previousStart: iso(prevStart),
    previousEndExclusive: iso(prevEndExclusive),
    rangeDays: Math.max(1, Math.round(rangeMs / DAY)),
    admin: { role: gate.role },
  };

  // Filters (additive; UI can ignore)
  const statusFilter = parseCsvUpper(qp.get("status")); // order status
  const paymentStatusFilter = parseCsvUpper(qp.get("paymentStatus")); // payment status
  const paidStatuses = new Set(
    parseCsvUpper(qp.get("paidStatuses")) || ["PAID", "SETTLED"]
  );

  const orderWhereBase = {
    createdAt: { gte: start, lt: endExclusive },
    ...(statusFilter?.length ? { status: { in: statusFilter } } : {}),
    ...(paymentStatusFilter?.length ? { paymentStatus: { in: paymentStatusFilter } } : {}),
  };

  const orderWherePrev = {
    createdAt: { gte: prevStart, lt: prevEndExclusive },
    ...(statusFilter?.length ? { status: { in: statusFilter } } : {}),
    ...(paymentStatusFilter?.length ? { paymentStatus: { in: paymentStatusFilter } } : {}),
  };

  const t0 = Date.now();

  try {
    // ---------------- KPI Counts ----------------
    const signupsCurrent = await safeCall(
      () => prisma.user.count({ where: { createdAt: { gte: start, lt: endExclusive } } }),
      0
    );
    const signupsPrev = compare
      ? await safeCall(
          () => prisma.user.count({ where: { createdAt: { gte: prevStart, lt: prevEndExclusive } } }),
          0
        )
      : 0;

    const ordersCurrent = await safeCall(
      () => prisma.order.count({ where: orderWhereBase }),
      0
    );
    const ordersPrev = compare
      ? await safeCall(() => prisma.order.count({ where: orderWherePrev }), 0)
      : 0;

    // Paid revenue / paid orders
    const revenuePaidAggCurrent = await safeCall(
      () =>
        prisma.order.aggregate({
          where: orderWhereBase,
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
      null
    );

    const revenuePaidAggCurrentAlt = revenuePaidAggCurrent
      ? revenuePaidAggCurrent
      : await safeCall(
          () =>
            prisma.order.aggregate({
              where: orderWhereBase,
              _sum: { totalAmount: true },
              _count: { _all: true },
            }),
          { _sum: { totalAmount: 0 }, _count: { _all: 0 } }
        );

    // We'll compute paid revenue precisely by scanning selected fields (safe & accurate with paidStatuses)
    const orderLite = await safeCall(
      () =>
        prisma.order.findMany({
          where: orderWhereBase,
          select: { createdAt: true, paymentStatus: true, grandTotal: true, totalAmount: true, userId: true },
          orderBy: { createdAt: "asc" },
        }),
      []
    );

    let paidOrdersCurrent = 0;
    let revenuePaidCurrent = 0;

    for (const o of orderLite) {
      if (paidStatuses.has(String(o.paymentStatus || "").toUpperCase())) {
        paidOrdersCurrent += 1;
        revenuePaidCurrent += coerceMoney(o.grandTotal ?? o.totalAmount);
      }
    }

    let paidOrdersPrev = 0;
    let revenuePaidPrev = 0;

    if (compare) {
      const orderLitePrev = await safeCall(
        () =>
          prisma.order.findMany({
            where: orderWherePrev,
            select: { paymentStatus: true, grandTotal: true, totalAmount: true },
          }),
        []
      );

      for (const o of orderLitePrev) {
        if (paidStatuses.has(String(o.paymentStatus || "").toUpperCase())) {
          paidOrdersPrev += 1;
          revenuePaidPrev += coerceMoney(o.grandTotal ?? o.totalAmount);
        }
      }
    }

    const aovPaidCurrent = paidOrdersCurrent > 0 ? revenuePaidCurrent / paidOrdersCurrent : 0;
    const aovPaidPrev = paidOrdersPrev > 0 ? revenuePaidPrev / paidOrdersPrev : 0;

    // Buyers metrics (from orderLite to avoid heavy SQL)
    const buyerCounts = (() => {
      const map = new Map();
      for (const o of orderLite) {
        if (!o.userId) continue;
        map.set(o.userId, (map.get(o.userId) || 0) + 1);
      }
      const unique = map.size;
      let repeat = 0;
      for (const c of map.values()) if (c > 1) repeat += 1;
      return { unique, repeat };
    })();

    let buyerCountsPrev = { unique: 0, repeat: 0 };
    if (compare) {
      buyerCountsPrev = await safeCall(async () => {
        const rows = await prisma.order.findMany({
          where: orderWherePrev,
          select: { userId: true },
        });
        const map = new Map();
        for (const o of rows) {
          if (!o.userId) continue;
          map.set(o.userId, (map.get(o.userId) || 0) + 1);
        }
        let repeat = 0;
        for (const c of map.values()) if (c > 1) repeat += 1;
        return { unique: map.size, repeat };
      }, buyerCountsPrev);
    }

    // First-time buyers (best-effort SQL; soft-fail)
    const firstTimeBuyersCurrent = await safeCall(async () => {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS c
        FROM (
          SELECT "userId", MIN("createdAt") AS first_at
          FROM "Order"
          WHERE "userId" IS NOT NULL
          GROUP BY "userId"
        ) u
        WHERE u.first_at >= ${start} AND u.first_at < ${endExclusive}
      `;
      return n(rows?.[0]?.c, 0);
    }, 0);

    const firstTimeBuyersPrev = compare
      ? await safeCall(async () => {
          const rows = await prisma.$queryRaw`
            SELECT COUNT(*)::int AS c
            FROM (
              SELECT "userId", MIN("createdAt") AS first_at
              FROM "Order"
              WHERE "userId" IS NOT NULL
              GROUP BY "userId"
            ) u
            WHERE u.first_at >= ${prevStart} AND u.first_at < ${prevEndExclusive}
          `;
          return n(rows?.[0]?.c, 0);
        }, 0)
      : 0;

    // ---------------- Breakdowns ----------------
    const orderStatusBreakdown = await safeCall(
      async () => {
        const rows = await prisma.order.groupBy({
          by: ["status"],
          where: { createdAt: { gte: start, lt: endExclusive } },
          _count: { _all: true },
        });
        return rows
          .map((r) => ({ key: r.status ?? "UNKNOWN", count: n(r?._count?._all, 0) }))
          .sort((a, b) => b.count - a.count);
      },
      []
    );

    const paymentStatusBreakdown = await safeCall(
      async () => {
        const rows = await prisma.order.groupBy({
          by: ["paymentStatus"],
          where: { createdAt: { gte: start, lt: endExclusive } },
          _count: { _all: true },
        });
        return rows
          .map((r) => ({ key: r.paymentStatus ?? "UNKNOWN", count: n(r?._count?._all, 0) }))
          .sort((a, b) => b.count - a.count);
      },
      []
    );

    // ---------------- Timeseries (safe, stable buckets) ----------------
    const by = new Map();

    for (const o of orderLite) {
      const day = dayKeyFromOffset(o.createdAt, tzOffsetMinutes);
      const row = by.get(day) || { date: day, orders: 0, revenueAll: 0, revenuePaid: 0 };
      row.orders += 1;

      const total = coerceMoney(o.grandTotal ?? o.totalAmount);
      row.revenueAll += total;

      if (paidStatuses.has(String(o.paymentStatus || "").toUpperCase())) {
        row.revenuePaid += total;
      }

      by.set(day, row);
    }

    // Fill missing days for consistent charting
    const daily = [];
    for (let i = 0; i < meta.rangeDays; i++) {
      const d = new Date(start.getTime() + i * DAY);
      const key = dayKeyFromOffset(d, tzOffsetMinutes);
      const row = by.get(key) || { date: key, orders: 0, revenueAll: 0, revenuePaid: 0 };
      daily.push({
        date: row.date,
        orders: row.orders,
        revenueAll: Math.round(row.revenueAll * 100) / 100,
        revenuePaid: Math.round(row.revenuePaid * 100) / 100,
      });
    }

    // ---------------- Optional add-ons (additive; UI can ignore) ----------------
    const addons = {};

    if (include?.includes("topproducts")) {
      // Basic top products by revenue (best-effort)
      addons.topProducts = await safeCall(async () => {
        // Prefer OrderItem join if exists; otherwise return []
        if (!prisma?.orderItem?.groupBy) return [];
        const rows = await prisma.orderItem.groupBy({
          by: ["productId"],
          where: { createdAt: { gte: start, lt: endExclusive } },
          _sum: { total: true, quantity: true },
          orderBy: { _sum: { total: "desc" } },
          take: 20,
        });
        return rows.map((r) => ({
          productId: r.productId,
          revenue: coerceMoney(r?._sum?.total),
          units: n(r?._sum?.quantity, 0),
        }));
      }, []);
    }

    if (include?.includes("refunds")) {
      addons.refunds = await safeCall(async () => {
        if (!prisma?.refund) return { count: 0, amount: 0 };
        const agg = await prisma.refund.aggregate({
          where: { createdAt: { gte: start, lt: endExclusive } },
          _count: { _all: true },
          _sum: { amount: true },
        });
        return { count: n(agg?._count?._all, 0), amount: coerceMoney(agg?._sum?.amount) };
      }, { count: 0, amount: 0 });
    }

    if (include?.includes("otp")) {
      addons.otp = await safeCall(async () => {
        if (!prisma?.otpCode) return { sent: 0, verified: 0 };
        const sent = await prisma.otpCode.count({ where: { createdAt: { gte: start, lt: endExclusive } } });
        const verified = await prisma.otpCode.count({
          where: { createdAt: { gte: start, lt: endExclusive }, verifiedAt: { not: null } },
        });
        return { sent, verified, successRate: sent > 0 ? (verified / sent) * 100 : 0 };
      }, { sent: 0, verified: 0, successRate: 0 });
    }

    const t1 = Date.now();

    const payload = {
      ok: true,
      meta,
      kpis: {
        signups: {
          current: signupsCurrent,
          previous: signupsPrev,
          deltaPct: compare ? pctChange(signupsCurrent, signupsPrev) : 0,
        },
        orders: {
          current: ordersCurrent,
          previous: ordersPrev,
          deltaPct: compare ? pctChange(ordersCurrent, ordersPrev) : 0,
        },
        paidOrders: {
          current: paidOrdersCurrent,
          previous: paidOrdersPrev,
          deltaPct: compare ? pctChange(paidOrdersCurrent, paidOrdersPrev) : 0,
        },
        revenuePaid: {
          current: Math.round(revenuePaidCurrent * 100) / 100,
          previous: Math.round(revenuePaidPrev * 100) / 100,
          deltaPct: compare ? pctChange(revenuePaidCurrent, revenuePaidPrev) : 0,
        },
        aovPaid: {
          current: Math.round(aovPaidCurrent * 100) / 100,
          previous: Math.round(aovPaidPrev * 100) / 100,
          deltaPct: compare ? pctChange(aovPaidCurrent, aovPaidPrev) : 0,
        },
        uniqueBuyers: {
          current: buyerCounts.unique,
          previous: buyerCountsPrev.unique,
          deltaPct: compare ? pctChange(buyerCounts.unique, buyerCountsPrev.unique) : 0,
        },
        repeatBuyers: {
          current: buyerCounts.repeat,
          previous: buyerCountsPrev.repeat,
          deltaPct: compare ? pctChange(buyerCounts.repeat, buyerCountsPrev.repeat) : 0,
        },
        firstTimeBuyers: {
          current: firstTimeBuyersCurrent,
          previous: firstTimeBuyersPrev,
          deltaPct: compare ? pctChange(firstTimeBuyersCurrent, firstTimeBuyersPrev) : 0,
        },
        repeatRate: {
          current: buyerCounts.unique > 0 ? (buyerCounts.repeat / buyerCounts.unique) * 100 : 0,
          previous: buyerCountsPrev.unique > 0 ? (buyerCountsPrev.repeat / buyerCountsPrev.unique) * 100 : 0,
          deltaPct: compare
            ? pctChange(
                buyerCounts.unique > 0 ? (buyerCounts.repeat / buyerCounts.unique) * 100 : 0,
                buyerCountsPrev.unique > 0 ? (buyerCountsPrev.repeat / buyerCountsPrev.unique) * 100 : 0
              )
            : 0,
        },
      },
      breakdowns: { orderStatus: orderStatusBreakdown, paymentStatus: paymentStatusBreakdown },
      timeseries: { daily },
      notes: {
        capabilities: {
          dailySeries: true,
          breakdowns: true,
          buyerMetrics: true,
          addons: ["topProducts", "refunds", "otp"],
        },
      },
      ...(Object.keys(addons).length ? { addons } : {}),
      ...(debug
        ? {
            debug: {
              perfMs: t1 - t0,
              query: Object.fromEntries(qp.entries()),
              filters: {
                statusFilter,
                paymentStatusFilter,
                paidStatuses: Array.from(paidStatuses),
              },
            },
          }
        : {}),
    };

    return jsonNoStore(payload, 200);
  } catch (e) {
    return jsonNoStore(
      { ok: false, meta, error: "analytics_summary_unavailable", detail: String(e?.message || e) },
      503
    );
  }
}
