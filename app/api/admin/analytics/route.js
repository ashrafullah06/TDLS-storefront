// FILE: app/api/admin/analytics/route.js
import { NextResponse } from "next/server";
import { PrismaClient, Prisma } from "@/generated/prisma/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Prisma singleton (safe for Next dev/HMR)
const globalForPrisma = globalThis;
const prisma = globalForPrisma.__prismaAdminAnalytics || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__prismaAdminAnalytics = prisma;

function toInt(v, d) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}
function toBool(v, d = false) {
  if (v == null) return d;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return d;
}
function parseDate(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}
function startOfDayUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function addDaysUTC(d, days) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}
function safeJsonNumber(x) {
  // Prisma Decimal, string, number -> number (best effort)
  if (x == null) return 0;
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma.Decimal
  if (typeof x?.toNumber === "function") {
    const n = x.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof x?.toString === "function") {
    const n = Number(x.toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function buildRange(searchParams) {
  // Supported:
  // - preset=last7|last30|last45|last90|today|thisMonth|lastMonth
  // - from=YYYY-MM-DD (or ISO), to=YYYY-MM-DD (or ISO)
  // Default: last45 (matches your admin text “Last 45 days” usage)
  const preset = String(searchParams.get("preset") || "last45").trim();

  const now = new Date();
  const today0 = startOfDayUTC(now);

  let from = parseDate(searchParams.get("from"));
  let to = parseDate(searchParams.get("to"));

  if (from) from = startOfDayUTC(from);
  if (to) to = startOfDayUTC(to);

  if (!from || !to) {
    if (preset === "today") {
      from = today0;
      to = addDaysUTC(today0, 1);
    } else if (preset === "last7") {
      to = addDaysUTC(today0, 1);
      from = addDaysUTC(to, -7);
    } else if (preset === "last30") {
      to = addDaysUTC(today0, 1);
      from = addDaysUTC(to, -30);
    } else if (preset === "last90") {
      to = addDaysUTC(today0, 1);
      from = addDaysUTC(to, -90);
    } else if (preset === "thisMonth") {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      from = d;
      to = addDaysUTC(today0, 1);
    } else if (preset === "lastMonth") {
      const firstThis = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const firstLast = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      from = firstLast;
      to = firstThis;
    } else {
      // last45
      to = addDaysUTC(today0, 1);
      from = addDaysUTC(to, -45);
    }
  }

  // Guard: enforce sane ordering
  if (from.getTime() >= to.getTime()) {
    to = addDaysUTC(from, 1);
  }

  return { from, to, preset };
}

export async function GET(req) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  // Controls
  const includeDraft = toBool(sp.get("includeDraft"), false);
  const includeArchived = toBool(sp.get("includeArchived"), false);
  const lowStockThreshold = toInt(sp.get("lowStock"), 3);
  const topN = Math.min(50, Math.max(5, toInt(sp.get("topN"), 12)));

  const range = buildRange(sp);
  const from = range.from;
  const to = range.to;

  // IMPORTANT:
  // This is an admin-plane route. Add your admin auth guard here if you already have it.
  // Keeping this route self-contained avoids coupling with customer auth and prevents build-time missing imports.

  // Status sets (schema-based)
  const ORDER_STATUS_EXCLUDE = includeDraft ? [] : ["DRAFT"];
  const PAID_STATUSES = ["PAID", "CAPTURED", "SUCCEEDED", "SETTLED"];
  const ORDER_ACTIVE_STATUSES = ["PLACED", "CONFIRMED", "COMPLETED"];

  try {
    // ---- KPI summary (Orders/Revenue/Customers) ----
    const kpiRows = await prisma.$queryRaw`
      WITH orders_in_range AS (
        SELECT
          o."id",
          o."userId",
          o."status",
          o."paymentStatus",
          o."fulfillmentStatus",
          o."channel",
          o."source",
          o."subtotal",
          o."discountTotal",
          o."taxTotal",
          o."shippingTotal",
          o."grandTotal",
          o."createdAt",
          o."placedAt",
          o."paidAt",
          o."fulfilledAt"
        FROM "Order" o
        WHERE o."createdAt" >= ${from}
          AND o."createdAt" < ${to}
          ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND o."status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
      ),
      paid_orders AS (
        SELECT * FROM orders_in_range
        WHERE "paymentStatus" IN (${Prisma.join(PAID_STATUSES)})
      ),
      active_orders AS (
        SELECT * FROM orders_in_range
        WHERE "status" IN (${Prisma.join(ORDER_ACTIVE_STATUSES)})
      )
      SELECT
        (SELECT COUNT(*)::int FROM orders_in_range)                     AS "ordersTotal",
        (SELECT COUNT(*)::int FROM active_orders)                        AS "ordersActive",
        (SELECT COUNT(*)::int FROM paid_orders)                          AS "ordersPaid",
        COALESCE((SELECT SUM("grandTotal") FROM paid_orders), 0)         AS "revenuePaid",
        COALESCE((SELECT SUM("subtotal") FROM paid_orders), 0)           AS "subtotalPaid",
        COALESCE((SELECT SUM("discountTotal") FROM paid_orders), 0)      AS "discountPaid",
        COALESCE((SELECT SUM("taxTotal") FROM paid_orders), 0)           AS "taxPaid",
        COALESCE((SELECT SUM("shippingTotal") FROM paid_orders), 0)      AS "shippingPaid",
        (SELECT COUNT(DISTINCT "userId")::int FROM orders_in_range WHERE "userId" IS NOT NULL) AS "uniqueBuyers"
    `;
    const k = kpiRows?.[0] || {};

    const revenuePaid = safeJsonNumber(k.revenuePaid);
    const ordersPaid = toInt(k.ordersPaid, 0);
    const aovPaid = ordersPaid > 0 ? revenuePaid / ordersPaid : 0;

    // ---- New customers in range (createdAt) ----
    const newCustomersRow = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "newCustomers"
      FROM "User" u
      WHERE u."createdAt" >= ${from}
        AND u."createdAt" < ${to}
        AND u."isActive" = true
        AND (${includeArchived}::boolean OR u."isActive" = true)
    `;
    const newCustomers = toInt(newCustomersRow?.[0]?.newCustomers, 0);

    // ---- Returning customers (buyers with any earlier order) ----
    const returningRow = await prisma.$queryRaw`
      WITH buyers AS (
        SELECT DISTINCT o."userId"
        FROM "Order" o
        WHERE o."createdAt" >= ${from}
          AND o."createdAt" < ${to}
          AND o."userId" IS NOT NULL
          ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND o."status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
      )
      SELECT COUNT(*)::int AS "returningBuyers"
      FROM buyers b
      WHERE EXISTS (
        SELECT 1
        FROM "Order" o2
        WHERE o2."userId" = b."userId"
          AND o2."createdAt" < ${from}
          ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND o2."status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
      )
    `;
    const returningBuyers = toInt(returningRow?.[0]?.returningBuyers, 0);

    // ---- Refunds in range ----
    const refundsRow = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "refundCount",
        COALESCE(SUM(r."amount"), 0) AS "refundAmount"
      FROM "Refund" r
      WHERE r."createdAt" >= ${from}
        AND r."createdAt" < ${to}
    `;
    const refundCount = toInt(refundsRow?.[0]?.refundCount, 0);
    const refundAmount = safeJsonNumber(refundsRow?.[0]?.refundAmount);

    // ---- Returns/Exchanges in range ----
    const returnsRow = await prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*)::int FROM "ReturnRequest" rr WHERE rr."createdAt" >= ${from} AND rr."createdAt" < ${to}) AS "returnsCount",
        (SELECT COUNT(*)::int FROM "ExchangeRequest" er WHERE er."createdAt" >= ${from} AND er."createdAt" < ${to}) AS "exchangesCount"
    `;
    const returnsCount = toInt(returnsRow?.[0]?.returnsCount, 0);
    const exchangesCount = toInt(returnsRow?.[0]?.exchangesCount, 0);

    // ---- Time series (daily): revenue + orders ----
    const seriesRows = await prisma.$queryRaw`
      WITH days AS (
        SELECT generate_series(${from}::date, (${to}::date - interval '1 day')::date, interval '1 day') AS day
      ),
      o AS (
        SELECT
          date_trunc('day', "createdAt")::date AS day,
          COUNT(*)::int AS orders_total,
          SUM(CASE WHEN "paymentStatus" IN (${Prisma.join(PAID_STATUSES)}) THEN "grandTotal" ELSE 0 END) AS revenue_paid
        FROM "Order"
        WHERE "createdAt" >= ${from}
          AND "createdAt" < ${to}
          ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND "status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
        GROUP BY 1
      ),
      u AS (
        SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS new_customers
        FROM "User"
        WHERE "createdAt" >= ${from}
          AND "createdAt" < ${to}
          AND "isActive" = true
        GROUP BY 1
      )
      SELECT
        d.day::text AS day,
        COALESCE(o.orders_total, 0)::int AS "orders",
        COALESCE(o.revenue_paid, 0)      AS "revenue",
        COALESCE(u.new_customers, 0)::int AS "newCustomers"
      FROM days d
      LEFT JOIN o ON o.day = d.day
      LEFT JOIN u ON u.day = d.day
      ORDER BY d.day ASC
    `;

    const series = (seriesRows || []).map((r) => ({
      day: String(r.day),
      orders: toInt(r.orders, 0),
      revenue: safeJsonNumber(r.revenue),
      newCustomers: toInt(r.newCustomers, 0),
    }));

    // ---- Breakdown: channel + source ----
    const channelRows = await prisma.$queryRaw`
      SELECT
        o."channel"::text AS channel,
        COUNT(*)::int AS orders,
        SUM(CASE WHEN o."paymentStatus" IN (${Prisma.join(PAID_STATUSES)}) THEN o."grandTotal" ELSE 0 END) AS revenue
      FROM "Order" o
      WHERE o."createdAt" >= ${from}
        AND o."createdAt" < ${to}
        ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND o."status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
      GROUP BY 1
      ORDER BY revenue DESC NULLS LAST, orders DESC
    `;
    const sourceRows = await prisma.$queryRaw`
      SELECT
        o."source"::text AS source,
        COUNT(*)::int AS orders,
        SUM(CASE WHEN o."paymentStatus" IN (${Prisma.join(PAID_STATUSES)}) THEN o."grandTotal" ELSE 0 END) AS revenue
      FROM "Order" o
      WHERE o."createdAt" >= ${from}
        AND o."createdAt" < ${to}
        ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND o."status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
      GROUP BY 1
      ORDER BY revenue DESC NULLS LAST, orders DESC
    `;

    // ---- Payment provider/status breakdown ----
    const paymentRows = await prisma.$queryRaw`
      SELECT
        p."provider"::text AS provider,
        p."status"::text AS status,
        COUNT(*)::int AS count,
        COALESCE(SUM(p."amount"), 0) AS amount
      FROM "Payment" p
      WHERE p."createdAt" >= ${from}
        AND p."createdAt" < ${to}
      GROUP BY 1,2
      ORDER BY provider ASC, count DESC
    `;

    // ---- Top variants (by paid revenue / qty) ----
    const topVariantRows = await prisma.$queryRaw`
      SELECT
        v."id" AS "variantId",
        COALESCE(v."sku", '') AS sku,
        COALESCE(v."title", '') AS "variantTitle",
        COALESCE(p."title", '') AS "productTitle",
        COALESCE(p."slug", '') AS "productSlug",
        COALESCE(v."colorName", '') AS "colorName",
        COALESCE(v."sizeName", '') AS "sizeName",
        SUM(oi."quantity")::int AS qty,
        SUM(CASE WHEN o."paymentStatus" IN (${Prisma.join(PAID_STATUSES)}) THEN oi."total" ELSE 0 END) AS revenue
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      LEFT JOIN "ProductVariant" v ON v."id" = oi."variantId"
      LEFT JOIN "Product" p ON p."id" = v."productId"
      WHERE o."createdAt" >= ${from}
        AND o."createdAt" < ${to}
        ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND o."status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
      GROUP BY v."id", v."sku", v."title", p."title", p."slug", v."colorName", v."sizeName"
      ORDER BY revenue DESC NULLS LAST, qty DESC
      LIMIT ${topN}
    `;

    // ---- Inventory health (variants + inventory items) ----
    const lowStockVariantsRow = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "lowStockVariants"
      FROM "ProductVariant" v
      WHERE v."archivedAt" IS NULL
        AND v."stockAvailable" <= ${lowStockThreshold}
    `;
    const lowStockVariants = toInt(lowStockVariantsRow?.[0]?.lowStockVariants, 0);

    const lowStockInventoryItemsRow = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "lowStockInventoryItems"
      FROM "InventoryItem" ii
      WHERE (ii."onHand" - ii."reserved") <= ii."safetyStock"
    `;
    const lowStockInventoryItems = toInt(lowStockInventoryItemsRow?.[0]?.lowStockInventoryItems, 0);

    // ---- OTP signals (created vs consumed) ----
    const otpRows = await prisma.$queryRaw`
      SELECT
        oc."purpose"::text AS purpose,
        COUNT(*)::int AS sent,
        COUNT(oc."consumedAt")::int AS consumed
      FROM "OtpCode" oc
      WHERE oc."createdAt" >= ${from}
        AND oc."createdAt" < ${to}
      GROUP BY 1
      ORDER BY sent DESC
    `;

    // ---- Risk / fraud signal ----
    const fraudRows = await prisma.$queryRaw`
      SELECT
        o."fraudStatus"::text AS "fraudStatus",
        COUNT(*)::int AS count
      FROM "Order" o
      WHERE o."createdAt" >= ${from}
        AND o."createdAt" < ${to}
        ${ORDER_STATUS_EXCLUDE.length ? Prisma.sql`AND o."status" NOT IN (${Prisma.join(ORDER_STATUS_EXCLUDE)})` : Prisma.empty}
      GROUP BY 1
      ORDER BY count DESC
    `;

    const payload = {
      ok: true,
      range: {
        preset: range.preset,
        from: from.toISOString(),
        to: to.toISOString(),
        includeDraft,
        includeArchived,
      },
      kpis: {
        ordersTotal: toInt(k.ordersTotal, 0),
        ordersActive: toInt(k.ordersActive, 0),
        ordersPaid,
        revenuePaid,
        subtotalPaid: safeJsonNumber(k.subtotalPaid),
        discountPaid: safeJsonNumber(k.discountPaid),
        taxPaid: safeJsonNumber(k.taxPaid),
        shippingPaid: safeJsonNumber(k.shippingPaid),
        aovPaid,
        uniqueBuyers: toInt(k.uniqueBuyers, 0),
        newCustomers,
        returningBuyers,
        returnsCount,
        exchangesCount,
        refundCount,
        refundAmount,
        netRevenuePaid: revenuePaid - refundAmount,
        refundRateByPaidRevenue: revenuePaid > 0 ? refundAmount / revenuePaid : 0,
      },
      series, // daily series: orders, revenue, newCustomers
      breakdowns: {
        channel: (channelRows || []).map((r) => ({
          channel: String(r.channel || "UNKNOWN"),
          orders: toInt(r.orders, 0),
          revenue: safeJsonNumber(r.revenue),
        })),
        source: (sourceRows || []).map((r) => ({
          source: String(r.source || "UNKNOWN"),
          orders: toInt(r.orders, 0),
          revenue: safeJsonNumber(r.revenue),
        })),
        payments: (paymentRows || []).map((r) => ({
          provider: String(r.provider || "UNKNOWN"),
          status: String(r.status || "UNKNOWN"),
          count: toInt(r.count, 0),
          amount: safeJsonNumber(r.amount),
        })),
        otp: (otpRows || []).map((r) => {
          const sent = toInt(r.sent, 0);
          const consumed = toInt(r.consumed, 0);
          return {
            purpose: String(r.purpose || "unknown"),
            sent,
            consumed,
            successRate: sent > 0 ? consumed / sent : 0,
          };
        }),
        fraud: (fraudRows || []).map((r) => ({
          fraudStatus: String(r.fraudStatus || "UNKNOWN"),
          count: toInt(r.count, 0),
        })),
      },
      top: {
        variants: (topVariantRows || []).map((r) => ({
          variantId: String(r.variantId || ""),
          sku: String(r.sku || ""),
          variantTitle: String(r.variantTitle || ""),
          productTitle: String(r.productTitle || ""),
          productSlug: String(r.productSlug || ""),
          colorName: String(r.colorName || ""),
          sizeName: String(r.sizeName || ""),
          qty: toInt(r.qty, 0),
          revenue: safeJsonNumber(r.revenue),
        })),
      },
      operationalHealth: {
        lowStockThreshold,
        lowStockVariants,
        lowStockInventoryItems,
      },
      meta: {
        generatedAt: new Date().toISOString(),
        version: "admin-analytics.v1",
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "ADMIN_ANALYTICS_FAILED",
        message: err?.message || String(err),
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
