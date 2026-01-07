// FILE: app/api/admin/analytics/overview/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

const DAY = 24 * 60 * 60 * 1000;

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

function clampDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 30;
  return Math.max(7, Math.min(365, Math.round(x)));
}

function clampTzOffsetMinutes(v, fallback = 360) {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  // sanity: UTC-12..UTC+14
  return Math.max(-720, Math.min(840, Math.round(x)));
}

function parseYYYYMMDD(s) {
  if (!s || typeof s !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00.000Z`);
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function rangeFromParams(searchParams) {
  const start = parseYYYYMMDD(searchParams.get("start"));
  const end = parseYYYYMMDD(searchParams.get("end"));

  if (start && end) {
    const endExclusive = new Date(end.getTime() + DAY);
    const days = Math.max(
      1,
      Math.min(365, Math.round((endExclusive - start) / DAY))
    );
    return { mode: "range", since: start, untilExclusive: endExclusive, days };
  }

  const days = clampDays(searchParams.get("days"));
  // IMPORTANT FIX: bound end for "days" mode (no unbounded queries)
  const untilExclusive = new Date(Date.now() + DAY);
  const since = new Date(untilExclusive.getTime() - days * DAY);
  return { mode: "days", since, untilExclusive, days };
}

function normalizeBreakdown(rows, keyName) {
  const out = {};
  for (const r of rows || []) {
    const k = String(r?.[keyName] ?? "UNKNOWN");
    out[k] = n(r?._count?._all, 0);
  }
  return out;
}

function decToNumber(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

async function safeGroupBy(model, args, fallback = []) {
  try {
    if (!model?.groupBy) return fallback;
    return await model.groupBy(args);
  } catch {
    return fallback;
  }
}

async function safeAggregate(model, args, fallback = null) {
  try {
    if (!model?.aggregate) return fallback;
    return await model.aggregate(args);
  } catch {
    return fallback;
  }
}

async function safeCount(model, args, fallback = 0) {
  try {
    if (!model?.count) return fallback;
    return await model.count(args);
  } catch {
    return fallback;
  }
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
  const arr = s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return arr.length ? new Set(arr) : null;
}

// Admin-only guard (NO dependency on customer session)
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
  return { ok, role: adminRole || null };
}

export async function GET(req) {
  // Decoupled admin gate (no requireAdmin dependency)
  const gate = await requireAdminSignal();
  if (!gate.ok) {
    return json(
      {
        ok: false,
        error: "admin_auth_required",
        message: "Admin session not detected. Please sign in to the admin panel.",
      },
      401
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const t0 = Date.now();

    const debug = String(searchParams.get("debug") || "0") === "1";
    const include = parseInclude(searchParams.get("include")); // leaders,breakdowns,inventory,funnel
    const want = (k) => !include || include.has(k);

    const tzOffsetMinutes = clampTzOffsetMinutes(
      searchParams.get("tzOffsetMinutes"),
      360
    );

    const { mode, since, untilExclusive, days } = rangeFromParams(searchParams);

    const createdAtWhere = { gte: since, lt: untilExclusive };

    // Optional: period-over-period comparison
    const compare = String(searchParams.get("compare") || "0") === "1";
    const prevSince = new Date(since.getTime() - days * DAY);
    const prevUntilExclusive = new Date(since.getTime());
    const prevCreatedAtWhere = { gte: prevSince, lt: prevUntilExclusive };

    // Payment status semantics (override-able)
    const PAID_STATUSES =
      parseCsvUpper(searchParams.get("paidStatuses")) || [
        "PAID",
        "SETTLED",
        "CAPTURED",
        "SUCCEEDED",
        "PARTIALLY_REFUNDED",
        "REFUNDED",
      ];

    const FAILED_STATUSES =
      parseCsvUpper(searchParams.get("failedStatuses")) || ["FAILED", "CANCELED"];

    const topNVariants = Math.max(1, Math.min(50, n(searchParams.get("topNVariants"), 8)));
    const topNCustomers = Math.max(1, Math.min(50, n(searchParams.get("topNCustomers"), 6)));

    // ─────────────────────────────────────────────────────────────
    // CORE KPI QUERIES (FAST + STABLE)
    // ─────────────────────────────────────────────────────────────
    const [
      ordersCount,
      paidAgg,
      orderTotalsAgg,
      totalCustomers,
      newCustomers,
      returnsCount,
      exchangesCount,
      refundsAggProcessed,
      refundsCountProcessed,
      shipmentsCount,
      activeCartsCount,
      abandonedCartsCount,
      totalVariants,
      outOfStockVariants,
      lowStockVariants,
    ] = await Promise.all([
      safeCount(prisma.order, { where: { createdAt: createdAtWhere } }, 0),

      safeAggregate(
        prisma.order,
        {
          where: {
            createdAt: createdAtWhere,
            paymentStatus: { in: PAID_STATUSES },
          },
          _sum: {
            grandTotal: true,
            subtotal: true,
            discountTotal: true,
            taxTotal: true,
            shippingTotal: true,
          },
          _count: { _all: true },
        },
        { _sum: {}, _count: { _all: 0 } }
      ),

      safeAggregate(
        prisma.order,
        {
          where: { createdAt: createdAtWhere },
          _sum: {
            grandTotal: true,
            subtotal: true,
            discountTotal: true,
            taxTotal: true,
            shippingTotal: true,
          },
        },
        { _sum: {} }
      ),

      // customers only (exclude staff-only) — best-effort
      safeCount(
        prisma.user,
        { where: { kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } } },
        0
      ),

      safeCount(
        prisma.user,
        {
          where: {
            createdAt: createdAtWhere,
            kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] },
          },
        },
        0
      ),

      prisma.returnRequest?.count
        ? safeCount(prisma.returnRequest, { where: { createdAt: createdAtWhere } }, 0)
        : 0,

      prisma.exchangeRequest?.count
        ? safeCount(prisma.exchangeRequest, { where: { createdAt: createdAtWhere } }, 0)
        : 0,

      safeAggregate(
        prisma.refund,
        { where: { createdAt: createdAtWhere, status: "PROCESSED" }, _sum: { amount: true } },
        { _sum: { amount: 0 } }
      ),

      prisma.refund?.count
        ? safeCount(prisma.refund, { where: { createdAt: createdAtWhere, status: "PROCESSED" } }, 0)
        : 0,

      prisma.shipment?.count
        ? safeCount(prisma.shipment, { where: { createdAt: createdAtWhere } }, 0)
        : 0,

      prisma.cart?.count
        ? safeCount(prisma.cart, { where: { status: "ACTIVE", createdAt: createdAtWhere } }, 0)
        : 0,

      prisma.cart?.count
        ? safeCount(prisma.cart, { where: { status: "ABANDONED", createdAt: createdAtWhere } }, 0)
        : 0,

      prisma.productVariant?.count ? safeCount(prisma.productVariant, {}, 0) : 0,

      prisma.productVariant?.count
        ? safeCount(prisma.productVariant, { where: { stockAvailable: { lte: 0 }, archivedAt: null } }, 0)
        : 0,

      prisma.productVariant?.count
        ? safeCount(prisma.productVariant, { where: { stockAvailable: { gt: 0, lte: 5 }, archivedAt: null } }, 0)
        : 0,
    ]);

    const paidOrdersCount = n(paidAgg?._count?._all, 0);
    const revenuePaid = decToNumber(paidAgg?._sum?.grandTotal);
    const refundAmountProcessed = decToNumber(refundsAggProcessed?._sum?.amount);
    const netRevenue = Math.max(0, revenuePaid - refundAmountProcessed);

    const aov =
      paidOrdersCount > 0 ? Math.round((revenuePaid / paidOrdersCount) * 100) / 100 : 0;
    const paidRate = ordersCount > 0 ? Math.round((paidOrdersCount / ordersCount) * 1000) / 10 : 0;

    const grossOrdersValueAll = decToNumber(orderTotalsAgg?._sum?.grandTotal);
    const subtotalPaid = decToNumber(paidAgg?._sum?.subtotal);
    const discountPaid = decToNumber(paidAgg?._sum?.discountTotal);
    const taxPaid = decToNumber(paidAgg?._sum?.taxTotal);
    const shippingPaid = decToNumber(paidAgg?._sum?.shippingTotal);

    const returnRate =
      paidOrdersCount > 0 ? Math.round((n(returnsCount, 0) / paidOrdersCount) * 1000) / 10 : 0;
    const refundRate =
      paidOrdersCount > 0
        ? Math.round((n(refundsCountProcessed, 0) / paidOrdersCount) * 1000) / 10
        : 0;

    // ─────────────────────────────────────────────────────────────
    // BREAKDOWNS (OPTIONAL)
    // ─────────────────────────────────────────────────────────────
    const breakdowns = want("breakdowns")
      ? await (async () => {
          const [
            statusBreakdown,
            paymentBreakdown,
            fulfillmentBreakdown,
            channelBreakdown,
            sourceBreakdown,
            fraudBreakdown,
            paymentProviderBreakdown,
            shipmentStatusBreakdown,
          ] = await Promise.all([
            safeGroupBy(prisma.order, { by: ["status"], where: { createdAt: createdAtWhere }, _count: { _all: true } }),
            safeGroupBy(prisma.order, {
              by: ["paymentStatus"],
              where: { createdAt: createdAtWhere },
              _count: { _all: true },
            }),
            safeGroupBy(prisma.order, {
              by: ["fulfillmentStatus"],
              where: { createdAt: createdAtWhere },
              _count: { _all: true },
            }),
            safeGroupBy(prisma.order, { by: ["channel"], where: { createdAt: createdAtWhere }, _count: { _all: true } }),
            safeGroupBy(prisma.order, { by: ["source"], where: { createdAt: createdAtWhere }, _count: { _all: true } }),
            safeGroupBy(prisma.order, { by: ["fraudStatus"], where: { createdAt: createdAtWhere }, _count: { _all: true } }),
            safeGroupBy(prisma.payment, { by: ["provider"], where: { createdAt: createdAtWhere }, _count: { _all: true } }),
            safeGroupBy(prisma.shipment, { by: ["status"], where: { createdAt: createdAtWhere }, _count: { _all: true } }),
          ]);

          return {
            status: normalizeBreakdown(statusBreakdown, "status"),
            paymentStatus: normalizeBreakdown(paymentBreakdown, "paymentStatus"),
            fulfillmentStatus: normalizeBreakdown(fulfillmentBreakdown, "fulfillmentStatus"),
            channel: normalizeBreakdown(channelBreakdown, "channel"),
            source: normalizeBreakdown(sourceBreakdown, "source"),
            fraudStatus: normalizeBreakdown(fraudBreakdown, "fraudStatus"),
            paymentProvider: normalizeBreakdown(paymentProviderBreakdown, "provider"),
            shipmentStatus: normalizeBreakdown(shipmentStatusBreakdown, "status"),
          };
        })()
      : null;

    // ─────────────────────────────────────────────────────────────
    // LEADERS (OPTIONAL)
    // ─────────────────────────────────────────────────────────────
    const leaders = want("leaders")
      ? await (async () => {
          const [topVariants, topCustomers] = await Promise.all([
            (async () => {
              try {
                if (!prisma?.orderItem?.groupBy || !prisma?.productVariant?.findMany) return [];
                const rows = await prisma.orderItem.groupBy({
                  by: ["variantId"],
                  where: {
                    createdAt: createdAtWhere,
                    order: { paymentStatus: { in: PAID_STATUSES }, createdAt: createdAtWhere },
                  },
                  _sum: { total: true, quantity: true },
                  orderBy: { _sum: { total: "desc" } },
                  take: topNVariants,
                });

                const ids = rows.map((r) => r.variantId).filter(Boolean);
                if (!ids.length) return [];

                const variants = await prisma.productVariant.findMany({
                  where: { id: { in: ids } },
                  select: { id: true, sku: true, title: true, sizeName: true, colorName: true, productId: true },
                });

                const byId = new Map(variants.map((v) => [v.id, v]));
                return rows.map((r) => {
                  const v = byId.get(r.variantId) || {};
                  return {
                    variantId: r.variantId,
                    sku: v.sku || null,
                    title: v.title || null,
                    colorName: v.colorName || null,
                    sizeName: v.sizeName || null,
                    qty: n(r?._sum?.quantity, 0),
                    revenue: decToNumber(r?._sum?.total),
                  };
                });
              } catch {
                return [];
              }
            })(),

            (async () => {
              try {
                if (!prisma?.order?.groupBy) return [];
                const rows = await prisma.order.groupBy({
                  by: ["userId"],
                  where: { createdAt: createdAtWhere, paymentStatus: { in: PAID_STATUSES }, userId: { not: null } },
                  _sum: { grandTotal: true },
                  _count: { _all: true },
                  orderBy: { _sum: { grandTotal: "desc" } },
                  take: topNCustomers,
                });

                const ids = rows.map((r) => r.userId).filter(Boolean);
                if (!ids.length) return [];

                const users = await prisma.user.findMany({
                  where: { id: { in: ids } },
                  select: { id: true, name: true, email: true, phone: true, customerCode: true },
                });

                const byId = new Map(users.map((u) => [u.id, u]));
                return rows.map((r) => {
                  const u = byId.get(r.userId) || {};
                  return {
                    userId: r.userId,
                    name: u.name || null,
                    phone: u.phone || null,
                    email: u.email || null,
                    customerCode: u.customerCode || null,
                    orders: n(r?._count?._all, 0),
                    revenue: decToNumber(r?._sum?.grandTotal),
                  };
                });
              } catch {
                return [];
              }
            })(),
          ]);

          return { topVariants, topCustomers };
        })()
      : null;

    // ─────────────────────────────────────────────────────────────
    // OPTIONAL: Period-over-period deltas
    // ─────────────────────────────────────────────────────────────
    const deltas = compare
      ? await (async () => {
          try {
            const [prevPaidAgg, prevOrdersCount, prevRefundsAgg] = await Promise.all([
              prisma.order.aggregate({
                where: { createdAt: prevCreatedAtWhere, paymentStatus: { in: PAID_STATUSES } },
                _sum: { grandTotal: true },
                _count: { _all: true },
              }),
              prisma.order.count({ where: { createdAt: prevCreatedAtWhere } }),
              safeAggregate(
                prisma.refund,
                { where: { createdAt: prevCreatedAtWhere, status: "PROCESSED" }, _sum: { amount: true } },
                { _sum: { amount: 0 } }
              ),
            ]);

            const prevPaidOrders = n(prevPaidAgg?._count?._all, 0);
            const prevRevenuePaid = decToNumber(prevPaidAgg?._sum?.grandTotal);
            const prevRefundAmount = decToNumber(prevRefundsAgg?._sum?.amount);
            const prevNet = Math.max(0, prevRevenuePaid - prevRefundAmount);

            return {
              prev: {
                ordersCount: prevOrdersCount,
                paidOrdersCount: prevPaidOrders,
                revenuePaid: prevRevenuePaid,
                refundsProcessedAmount: prevRefundAmount,
                netRevenue: prevNet,
              },
              change: {
                ordersCount: ordersCount - prevOrdersCount,
                paidOrdersCount: paidOrdersCount - prevPaidOrders,
                revenuePaid: revenuePaid - prevRevenuePaid,
                netRevenue: netRevenue - prevNet,
              },
            };
          } catch {
            return null;
          }
        })()
      : null;

    const t1 = Date.now();

    return json({
      ok: true,

      range: {
        mode,
        windowDays: days,
        tzOffsetMinutes,
        sinceISO: since.toISOString(),
        untilExclusiveISO: untilExclusive.toISOString(),
      },

      kpis: {
        revenuePaid,
        refundsProcessedAmount: refundAmountProcessed,
        netRevenue,

        paidOrdersCount,
        ordersCount,
        paidRate,

        aov,

        subtotalPaid,
        discountPaid,
        taxPaid,
        shippingPaid,

        grossOrdersValueAll,

        totalCustomers: n(totalCustomers, 0),
        newCustomers: n(newCustomers, 0),

        returnsCount: n(returnsCount, 0),
        exchangesCount: n(exchangesCount, 0),
        refundsProcessedCount: n(refundsCountProcessed, 0),

        returnRate,
        refundRate,

        shipmentsCount: n(shipmentsCount, 0),

        activeCartsCount: n(activeCartsCount, 0),
        abandonedCartsCount: n(abandonedCartsCount, 0),

        totalVariants: n(totalVariants, 0),
        outOfStockVariants: n(outOfStockVariants, 0),
        lowStockVariants: n(lowStockVariants, 0),
      },

      breakdowns: breakdowns || {
        status: {},
        paymentStatus: {},
        fulfillmentStatus: {},
        channel: {},
        source: {},
        fraudStatus: {},
        paymentProvider: {},
        shipmentStatus: {},
      },

      leaders: leaders || { topVariants: [], topCustomers: [] },

      deltas,

      ...(debug
        ? {
            debug: {
              adminRole: gate.role,
              paidStatuses: PAID_STATUSES,
              failedStatuses: FAILED_STATUSES,
              include: include ? Array.from(include) : null,
              perfMs: t1 - t0,
              query: Object.fromEntries(searchParams.entries()),
            },
          }
        : {}),
    });
  } catch (err) {
    console.error("[admin/analytics/overview.GET]", err);
    return json({ ok: false, error: "OVERVIEW_FAILED" }, 500);
  }
}
