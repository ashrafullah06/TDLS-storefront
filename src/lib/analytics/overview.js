// FILE: src/lib/analytics/overview.js
import prisma from "@/lib/prisma";
import {
  DAY,
  PAID_STATUSES,
  money,
  normalizeBreakdown,
  n,
  pct,
  round2,
  safeAggregate,
  safeGroupBy,
  safeUpper,
} from "./_utils";

export async function computeOverview({ since, untilExclusive, days, compare = false }) {
  const createdAtWhere = untilExclusive ? { gte: since, lt: untilExclusive } : { gte: since };

  const prevSince = new Date(since.getTime() - days * DAY);
  const prevUntilExclusive = new Date(since.getTime());
  const prevCreatedAtWhere = { gte: prevSince, lt: prevUntilExclusive };

  // Pull minimal paid fields to avoid enum/value mismatch inside Prisma filters.
  // This is still DB-only, and keeps UI shape unchanged.
  const paidOrdersRowsPromise = prisma.order
    .findMany({
      where: { createdAt: createdAtWhere },
      select: {
        paymentStatus: true,
        grandTotal: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        shippingTotal: true,
      },
    })
    .catch(() => []);

  const allOrdersRowsPromise = prisma.order
    .findMany({
      where: { createdAt: createdAtWhere },
      select: { grandTotal: true, subtotal: true, discountTotal: true, taxTotal: true, shippingTotal: true },
    })
    .catch(() => []);

  const [
    ordersCount,
    paidRows,
    allRows,
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
    prisma.order.count({ where: { createdAt: createdAtWhere } }),

    paidOrdersRowsPromise,

    allOrdersRowsPromise,

    prisma.user
      .count({ where: { kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } } })
      .catch(() => 0),

    prisma.user
      .count({
        where: { createdAt: createdAtWhere, kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } },
      })
      .catch(() => 0),

    prisma.returnRequest?.count?.({ where: { createdAt: createdAtWhere } }).catch(() => 0) ?? 0,

    prisma.exchangeRequest?.count?.({ where: { createdAt: createdAtWhere } }).catch(() => 0) ?? 0,

    safeAggregate(
      prisma.refund,
      { where: { createdAt: createdAtWhere, status: "PROCESSED" }, _sum: { amount: true } },
      { _sum: { amount: 0 } }
    ),

    prisma.refund?.count?.({ where: { createdAt: createdAtWhere, status: "PROCESSED" } }).catch(() => 0) ?? 0,

    prisma.shipment?.count?.({ where: { createdAt: createdAtWhere } }).catch(() => 0) ?? 0,

    prisma.cart?.count?.({ where: { status: "ACTIVE", createdAt: createdAtWhere } }).catch(() => 0) ?? 0,

    prisma.cart?.count?.({ where: { status: "ABANDONED", createdAt: createdAtWhere } }).catch(() => 0) ?? 0,

    prisma.productVariant?.count?.().catch(() => 0) ?? 0,

    prisma.productVariant
      ?.count?.({ where: { stockAvailable: { lte: 0 }, archivedAt: null } })
      .catch(() => 0) ?? 0,

    prisma.productVariant
      ?.count?.({ where: { stockAvailable: { gt: 0, lte: 5 }, archivedAt: null } })
      .catch(() => 0) ?? 0,
  ]);

  // Compute paid sums safely in JS (no enum mismatch).
  let paidOrdersCount = 0;
  let sumGrand = 0;
  let sumSub = 0;
  let sumDisc = 0;
  let sumTax = 0;
  let sumShip = 0;

  for (const r of paidRows || []) {
    const ps = safeUpper(r?.paymentStatus);
    if (!PAID_STATUSES.has(ps)) continue;
    paidOrdersCount += 1;
    sumGrand += money(r?.grandTotal);
    sumSub += money(r?.subtotal);
    sumDisc += money(r?.discountTotal);
    sumTax += money(r?.taxTotal);
    sumShip += money(r?.shippingTotal);
  }

  const revenuePaid = sumGrand;
  const subtotalPaid = sumSub;
  const discountPaid = sumDisc;
  const taxPaid = sumTax;
  const shippingPaid = sumShip;

  const refundAmountProcessed = money(refundsAggProcessed?._sum?.amount);
  const netRevenue = Math.max(0, revenuePaid - refundAmountProcessed);

  const aov = paidOrdersCount > 0 ? round2(revenuePaid / paidOrdersCount) : 0;
  const paidRate = ordersCount > 0 ? pct(paidOrdersCount, ordersCount) : 0;

  // totals across all orders (not only paid)
  let grossOrdersValueAll = 0;
  for (const r of allRows || []) grossOrdersValueAll += money(r?.grandTotal);

  const returnRate = paidOrdersCount > 0 ? pct(returnsCount, paidOrdersCount) : 0;
  const refundRate = paidOrdersCount > 0 ? pct(refundsCountProcessed, paidOrdersCount) : 0;

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

  const leaders = await computeLeaders({ createdAtWhere });

  const deltas = compare
    ? await computeDeltas({
        prevCreatedAtWhere,
        curr: { ordersCount, paidOrdersCount, revenuePaid, refundAmountProcessed, netRevenue },
      })
    : null;

  return {
    kpis: {
      revenuePaid: round2(revenuePaid),
      refundsProcessedAmount: round2(refundAmountProcessed),
      netRevenue: round2(netRevenue),

      paidOrdersCount,
      ordersCount,
      paidRate,

      aov,

      subtotalPaid: round2(subtotalPaid),
      discountPaid: round2(discountPaid),
      taxPaid: round2(taxPaid),
      shippingPaid: round2(shippingPaid),

      grossOrdersValueAll: round2(grossOrdersValueAll),

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

    breakdowns: {
      status: normalizeBreakdown(statusBreakdown, "status"),
      paymentStatus: normalizeBreakdown(paymentBreakdown, "paymentStatus"),
      fulfillmentStatus: normalizeBreakdown(fulfillmentBreakdown, "fulfillmentStatus"),
      channel: normalizeBreakdown(channelBreakdown, "channel"),
      source: normalizeBreakdown(sourceBreakdown, "source"),
      fraudStatus: normalizeBreakdown(fraudBreakdown, "fraudStatus"),
      paymentProvider: normalizeBreakdown(paymentProviderBreakdown, "provider"),
      shipmentStatus: normalizeBreakdown(shipmentStatusBreakdown, "status"),
    },

    leaders,
    deltas,
  };
}

async function computeLeaders({ createdAtWhere }) {
  // Pull orderIds in range and then filter "paid" in JS to avoid enum mismatch.
  const paidOrderIds = await prisma.order
    .findMany({
      where: { createdAt: createdAtWhere },
      select: { id: true, paymentStatus: true },
    })
    .then((rows) =>
      (rows || [])
        .filter((r) => PAID_STATUSES.has(safeUpper(r.paymentStatus)))
        .map((r) => r.id)
    )
    .catch(() => []);

  const rows =
    paidOrderIds.length > 0
      ? await prisma.orderItem
          .groupBy({
            by: ["variantId"],
            where: {
              createdAt: createdAtWhere,
              orderId: { in: paidOrderIds },
            },
            _sum: { total: true, quantity: true },
            orderBy: { _sum: { total: "desc" } },
            take: 8,
          })
          .catch(() => [])
      : [];

  const ids = rows.map((r) => r.variantId).filter(Boolean);
  const variants = ids.length
    ? await prisma.productVariant
        .findMany({
          where: { id: { in: ids } },
          select: { id: true, sku: true, title: true, sizeName: true, colorName: true, productId: true },
        })
        .catch(() => [])
    : [];

  const byId = new Map(variants.map((v) => [v.id, v]));

  const topVariants = rows.map((r) => {
    const v = byId.get(r.variantId) || {};
    return {
      variantId: r.variantId,
      sku: v.sku || null,
      title: v.title || null,
      colorName: v.colorName || null,
      sizeName: v.sizeName || null,
      qty: n(r?._sum?.quantity, 0),
      revenue: round2(money(r?._sum?.total)),
    };
  });

  const paidCustRows =
    paidOrderIds.length > 0
      ? await prisma.order
          .groupBy({
            by: ["userId"],
            where: {
              id: { in: paidOrderIds },
              userId: { not: null },
            },
            _sum: { grandTotal: true },
            _count: { _all: true },
            orderBy: { _sum: { grandTotal: "desc" } },
            take: 6,
          })
          .catch(() => [])
      : [];

  const userIds = paidCustRows.map((r) => r.userId).filter(Boolean);
  const users = userIds.length
    ? await prisma.user
        .findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, phone: true, customerCode: true },
        })
        .catch(() => [])
    : [];

  const uById = new Map(users.map((u) => [u.id, u]));
  const topCustomers = paidCustRows.map((r) => {
    const u = uById.get(r.userId) || {};
    return {
      userId: r.userId,
      name: u.name || null,
      phone: u.phone || null,
      email: u.email || null,
      customerCode: u.customerCode || null,
      orders: n(r?._count?._all, 0),
      revenue: round2(money(r?._sum?.grandTotal)),
    };
  });

  return { topVariants, topCustomers };
}

async function computeDeltas({ prevCreatedAtWhere, curr }) {
  const prevRows = await prisma.order
    .findMany({
      where: { createdAt: prevCreatedAtWhere },
      select: { paymentStatus: true, grandTotal: true },
    })
    .catch(() => []);

  const prevOrdersCount = prevRows.length;

  let prevPaidOrdersCount = 0;
  let prevRevenuePaid = 0;
  for (const r of prevRows) {
    if (!PAID_STATUSES.has(safeUpper(r.paymentStatus))) continue;
    prevPaidOrdersCount += 1;
    prevRevenuePaid += money(r.grandTotal);
  }

  const prevRefundAgg = await safeAggregate(
    prisma.refund,
    { where: { createdAt: prevCreatedAtWhere, status: "PROCESSED" }, _sum: { amount: true } },
    { _sum: { amount: 0 } }
  );

  const prevRefunds = money(prevRefundAgg?._sum?.amount);
  const prevNet = Math.max(0, prevRevenuePaid - prevRefunds);

  return {
    prev: {
      ordersCount: prevOrdersCount,
      paidOrdersCount: prevPaidOrdersCount,
      revenuePaid: round2(prevRevenuePaid),
      refundsProcessedAmount: round2(prevRefunds),
      netRevenue: round2(prevNet),
    },
    change: {
      ordersCount: curr.ordersCount - prevOrdersCount,
      paidOrdersCount: curr.paidOrdersCount - prevPaidOrdersCount,
      revenuePaid: round2(curr.revenuePaid - prevRevenuePaid),
      netRevenue: round2(curr.netRevenue - prevNet),
    },
  };
}
