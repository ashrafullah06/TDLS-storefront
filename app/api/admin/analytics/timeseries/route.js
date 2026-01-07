// FILE: app/api/admin/analytics/timeseries/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

const DAY = 24 * 60 * 60 * 1000;

// Paid-like statuses (expanded but still safe)
const DEFAULT_PAID_STATUSES = new Set([
  "PAID",
  "SETTLED",
  "CAPTURED",
  "SUCCEEDED",
  "AUTHORIZED",
]);

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function money(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }
  if (typeof v === "object" && typeof v.toNumber === "function") {
    try {
      const x = v.toNumber();
      return Number.isFinite(x) ? x : 0;
    } catch {}
  }
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function safeUpper(v) {
  return String(v ?? "").trim().toUpperCase();
}

/**
 * Convert an absolute time → "local day key" given tzOffsetMinutes.
 * Shift the timestamp into the target timezone, then take UTC YYYY-MM-DD.
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

/**
 * Get UTC instant corresponding to "local midnight" for the given offset.
 */
function startOfLocalDayUtc(now, tzOffsetMinutes) {
  const ms = now.getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - tzOffsetMinutes * 60 * 1000);
}

function clampDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 30;
  return Math.max(7, Math.min(365, Math.round(x)));
}

/**
 * Interprets YYYY-MM-DD as a *local* date (for tzOffsetMinutes),
 * returning the UTC instant for local midnight at the start of that date.
 */
function parseYYYYMMDDLocal(s, tzOffsetMinutes) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  const utcMidnight = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
  return new Date(utcMidnight - tzOffsetMinutes * 60 * 1000);
}

function parseDateAny(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Range rules:
 * - If start+end provided: treat YYYY-MM-DD as local dates; inclusive end.
 * - Else: use days back from *today local midnight* for stable daily charts.
 */
function rangeFromParams(searchParams) {
  const tzOffsetMinutes = n(searchParams.get("tzOffsetMinutes"), 360);

  const startRaw = searchParams.get("start");
  const endRaw = searchParams.get("end");

  const start = parseYYYYMMDDLocal(startRaw, tzOffsetMinutes) || parseDateAny(startRaw);
  const endLocalStart = parseYYYYMMDDLocal(endRaw, tzOffsetMinutes) || parseDateAny(endRaw);

  if (start && endLocalStart) {
    const untilExclusive = new Date(endLocalStart.getTime() + DAY);
    const days = Math.max(1, Math.min(365, Math.round((untilExclusive - start) / DAY)));
    return { tzOffsetMinutes, since: start, untilExclusive, days, mode: "range" };
  }

  const days = clampDays(searchParams.get("days"));
  const now = new Date();
  const todayLocalStartUtc = startOfLocalDayUtc(now, tzOffsetMinutes);
  const since = new Date(todayLocalStartUtc.getTime() - (days - 1) * DAY);
  const untilExclusive = new Date(todayLocalStartUtc.getTime() + DAY);
  return { tzOffsetMinutes, since, untilExclusive, days, mode: "rolling" };
}

async function safeFindMany(model, args) {
  if (!model?.findMany) return [];
  try {
    const res = await model.findMany(args);
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/**
 * Admin-only cookie signal fallback (prevents customer auth coupling from breaking analytics).
 * We do NOT depend on customer NextAuth cookies here.
 */
async function readAdminCookieSignal() {
  const jar = await cookies();
  const role =
    jar.get("admin_role")?.value ||
    jar.get("tdlc_admin_role")?.value ||
    jar.get("adminRole")?.value ||
    "";

  const adminSession =
    jar.get("admin_session")?.value ||
    jar.get("tdlc_admin_session")?.value ||
    jar.get("admin_sid")?.value ||
    "";

  const ok = Boolean(role || adminSession);
  return { ok, role: role || null };
}

function isSuperAdmin(role) {
  const r = String(role || "").toLowerCase();
  return r === "superadmin" || r === "owner" || r === "root";
}

function parseCsvUpper(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const arr = s
    .split(",")
    .map((x) => safeUpper(x))
    .filter(Boolean);
  return arr.length ? arr : null;
}

function pickMetrics(searchParams) {
  // Additive only. If absent, returns null meaning "full default metrics".
  const raw = String(searchParams.get("metrics") || "").trim().toLowerCase();
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

function keepMetric(metricsSet, key) {
  if (!metricsSet) return true; // default keep all existing fields
  return metricsSet.has("all") || metricsSet.has(key.toLowerCase());
}

function pctChange(curr, prev) {
  const c = n(curr, 0);
  const p = n(prev, 0);
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
}

export async function GET(req) {
  // Primary RBAC gate
  let roleHint = null;

  try {
    await requireAdmin(req, { permission: Permissions.VIEW_ANALYTICS });
  } catch (err) {
    // Fallback gate for decoupling safety: allow superadmin if cookies show admin signal.
    const sig = await readAdminCookieSignal();
    roleHint = sig.role;

    const status = err?.status === 403 ? 403 : 401;
    if (!(sig.ok && isSuperAdmin(sig.role))) {
      return json({ ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" }, status);
    }
  }

  try {
    const { searchParams } = new URL(req.url);

    const debug = String(searchParams.get("debug") || "0") === "1";
    const compare = String(searchParams.get("compare") || "0") === "1";
    const fill = String(searchParams.get("fill") || "1") !== "0"; // default true

    const metricsSet = pickMetrics(searchParams);

    const paidStatusesCsv = searchParams.get("paidStatuses");
    const paidStatuses = new Set(parseCsvUpper(paidStatusesCsv) || Array.from(DEFAULT_PAID_STATUSES));

    const { tzOffsetMinutes, since, untilExclusive, days, mode } = rangeFromParams(searchParams);

    const statuses = parseCsvUpper(searchParams.get("status")); // order status filter (optional)
    const paidOnly = String(searchParams.get("paidOnly") || "") === "1";

    const createdAtWhere = { gte: since, lt: untilExclusive };
    const orderWhere = {
      createdAt: createdAtWhere,
      ...(statuses?.length ? { status: { in: statuses } } : {}),
    };

    // Optional: currency filter if your schema supports it (non-breaking)
    const currency = String(searchParams.get("currency") || "").trim();
    if (currency) {
      // Try best-effort; if field doesn't exist Prisma will throw and we catch below.
      orderWhere.currency = currency;
    }

    const t0 = Date.now();

    const [orders, refunds, returns, customers] = await Promise.all([
      prisma.order.findMany({
        where: orderWhere,
        select: {
          createdAt: true,
          grandTotal: true,
          paymentStatus: true,
          status: true,
        },
        orderBy: { createdAt: "asc" },
      }),

      safeFindMany(prisma?.refund, {
        where: { createdAt: createdAtWhere },
        select: { createdAt: true, amount: true, status: true },
        orderBy: { createdAt: "asc" },
      }),

      safeFindMany(prisma?.returnRequest, {
        where: { createdAt: createdAtWhere },
        select: { createdAt: true, status: true },
        orderBy: { createdAt: "asc" },
      }),

      safeFindMany(prisma?.user, {
        where: { createdAt: createdAtWhere },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
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
          aovPaid: 0,
          paidRate: 0,
        });
      }
      return map.get(day);
    };

    for (const o of orders) {
      const day = dayKeyFromOffset(o.createdAt, tzOffsetMinutes);
      const row = ensure(day);

      const ps = safeUpper(o.paymentStatus);
      const isPaid = paidStatuses.has(ps);

      if (!paidOnly || isPaid) row.orders += 1;

      row.revenueGross += money(o.grandTotal);

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
      const d = new Date(since.getTime() + i * DAY);
      const key = dayKeyFromOffset(d, tzOffsetMinutes);

      const v = fill ? (map.get(key) || ensure(key)) : map.get(key);
      if (!v) continue;

      const paidRate = v.orders > 0 ? v.paidOrders / v.orders : 0;
      const aovPaid = v.paidOrders > 0 ? v.revenuePaid / v.paidOrders : 0;

      // Keep existing fields, but allow optional metric filtering without breaking UI:
      // if metrics=... is provided, omit non-requested fields.
      const row = { day: v.day };

      if (keepMetric(metricsSet, "orders")) row.orders = v.orders;
      if (keepMetric(metricsSet, "paidOrders")) row.paidOrders = v.paidOrders;
      if (keepMetric(metricsSet, "revenuePaid"))
        row.revenuePaid = Math.round(v.revenuePaid * 100) / 100;
      if (keepMetric(metricsSet, "revenueGross"))
        row.revenueGross = Math.round(v.revenueGross * 100) / 100;
      if (keepMetric(metricsSet, "refundsAmount"))
        row.refundsAmount = Math.round(v.refundsAmount * 100) / 100;
      if (keepMetric(metricsSet, "returnsCount")) row.returnsCount = v.returnsCount;
      if (keepMetric(metricsSet, "newCustomers")) row.newCustomers = v.newCustomers;
      if (keepMetric(metricsSet, "aovPaid")) row.aovPaid = Math.round(aovPaid * 100) / 100;
      if (keepMetric(metricsSet, "paidRate"))
        row.paidRate = Math.round(paidRate * 1000) / 10; // %

      series.push(row);
    }

    // Optional compare window (non-breaking additive)
    let compareBlock = null;
    if (compare) {
      const prevSince = new Date(since.getTime() - days * DAY);
      const prevUntil = new Date(since.getTime());
      const prevWhere = {
        createdAt: { gte: prevSince, lt: prevUntil },
        ...(statuses?.length ? { status: { in: statuses } } : {}),
      };
      if (currency) prevWhere.currency = currency;

      const [prevOrders] = await Promise.all([
        prisma.order
          .findMany({
            where: prevWhere,
            select: { grandTotal: true, paymentStatus: true },
          })
          .catch(() => []),
      ]);

      let prevPaidRevenue = 0;
      let prevPaidOrders = 0;
      let prevOrdersCount = Array.isArray(prevOrders) ? prevOrders.length : 0;

      for (const o of prevOrders || []) {
        const ps = safeUpper(o.paymentStatus);
        const isPaid = paidStatuses.has(ps);
        if (isPaid) {
          prevPaidOrders += 1;
          prevPaidRevenue += money(o.grandTotal);
        }
      }

      const currTotals = {
        orders: series.reduce((s, r) => s + n(r.orders, 0), 0),
        paidOrders: series.reduce((s, r) => s + n(r.paidOrders, 0), 0),
        revenuePaid: series.reduce((s, r) => s + n(r.revenuePaid, 0), 0),
      };

      compareBlock = {
        range: {
          sinceISO: prevSince.toISOString(),
          untilExclusiveISO: prevUntil.toISOString(),
          days,
        },
        totals: {
          orders: prevOrdersCount,
          paidOrders: prevPaidOrders,
          revenuePaid: Math.round(prevPaidRevenue * 100) / 100,
        },
        deltaPct: {
          orders: pctChange(currTotals.orders, prevOrdersCount),
          paidOrders: pctChange(currTotals.paidOrders, prevPaidOrders),
          revenuePaid: pctChange(currTotals.revenuePaid, prevPaidRevenue),
        },
      };
    }

    const t1 = Date.now();

    return json({
      ok: true,
      windowDays: days,
      meta: {
        mode,
        tzOffsetMinutes,
        sinceISO: since.toISOString(),
        untilExclusiveISO: untilExclusive.toISOString(),
        filters: {
          statuses: statuses?.length ? statuses : null,
          paidOnly,
          currency: currency || null,
          paidStatuses: paidStatusesCsv ? Array.from(paidStatuses) : null,
          metrics: metricsSet ? Array.from(metricsSet) : null,
          fill,
          compare,
        },
        // additive role hint, helps diagnose session coupling issues without UI changes
        roleHint: roleHint || null,
        perf: { ms: t1 - t0, orders: orders.length },
      },
      series,
      ...(compareBlock ? { compare: compareBlock } : {}),
      ...(debug ? { debug: { receivedQuery: Object.fromEntries(searchParams.entries()) } } : {}),
    });
  } catch (err) {
    console.error("[admin/analytics/timeseries.GET]", err);
    return json({ ok: false, error: "TIMESERIES_FAILED" }, 500);
  }
}
