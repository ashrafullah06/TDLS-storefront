// FILE: src/lib/analytics/returns.js
import prisma from "@/lib/prisma";
import { n, pct, safeUpper } from "./_utils";

/**
 * Returns / Exchanges / Refunds:
 * - counts by status, reason
 * - rates (returns per paid order)
 * - top returned variants (derived from ReturnLine -> OrderItem.variantId when available)
 */
export async function computeReturns({ since, untilExclusive, paidOrdersCount = null }) {
  const createdAtWhere = { gte: since, lt: untilExclusive };

  const safeFindMany = async (model, args) => {
    try {
      if (!model?.findMany) return [];
      return await model.findMany(args);
    } catch {
      return [];
    }
  };

  // 1) High-level requests (counts by status/reason)
  const [returns, exchanges, refunds] = await Promise.all([
    safeFindMany(prisma.returnRequest, {
      where: { createdAt: createdAtWhere },
      select: { id: true, createdAt: true, status: true, reason: true, orderId: true },
    }),
    safeFindMany(prisma.exchangeRequest, {
      where: { createdAt: createdAtWhere },
      select: { id: true, createdAt: true, status: true, reason: true, orderId: true },
    }),
    safeFindMany(prisma.refund, {
      where: { createdAt: createdAtWhere },
      select: { id: true, createdAt: true, status: true, amount: true, reason: true, orderId: true },
    }),
  ]);

  const byReturnStatus = {};
  const byReturnReason = {};
  const byExchangeStatus = {};
  const byExchangeReason = {};
  const byRefundStatus = {};
  const byRefundReason = {};

  for (const r of returns) {
    const st = safeUpper(r?.status) || "UNKNOWN";
    const rs = safeUpper(r?.reason) || "UNKNOWN";
    byReturnStatus[st] = (byReturnStatus[st] || 0) + 1;
    byReturnReason[rs] = (byReturnReason[rs] || 0) + 1;
  }

  for (const r of exchanges) {
    const st = safeUpper(r?.status) || "UNKNOWN";
    const rs = safeUpper(r?.reason) || "UNKNOWN";
    byExchangeStatus[st] = (byExchangeStatus[st] || 0) + 1;
    byExchangeReason[rs] = (byExchangeReason[rs] || 0) + 1;
  }

  for (const r of refunds) {
    const st = safeUpper(r?.status) || "UNKNOWN";
    const rs = safeUpper(r?.reason) || "UNKNOWN";
    byRefundStatus[st] = (byRefundStatus[st] || 0) + 1;
    byRefundReason[rs] = (byRefundReason[rs] || 0) + 1;
  }

  // 2) Variant-level return quantity: ReturnLine -> OrderItem.variantId (schema-safe)
  const variantReturnQty = new Map();

  const returnLines = await safeFindMany(prisma.returnLine, {
    where: { returnRequest: { createdAt: createdAtWhere } },
    select: {
      quantity: true,
      orderItem: { select: { variantId: true } },
    },
  });

  for (const rl of returnLines) {
    const vid = rl?.orderItem?.variantId;
    if (!vid) continue;
    const q = n(rl?.quantity, 0);
    if (q <= 0) continue;
    variantReturnQty.set(vid, (variantReturnQty.get(vid) || 0) + q);
  }

  const topVariantIds = Array.from(variantReturnQty.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  const variants = topVariantIds.length
    ? await safeFindMany(prisma.productVariant, {
        where: { id: { in: topVariantIds } },
        select: { id: true, sku: true, title: true, colorName: true, sizeName: true },
      })
    : [];

  const vById = new Map((variants || []).map((v) => [v.id, v]));
  const topReturnedVariants = topVariantIds.map((id) => {
    const v = vById.get(id) || {};
    return {
      variantId: id,
      sku: v.sku || null,
      title: v.title || null,
      colorName: v.colorName || null,
      sizeName: v.sizeName || null,
      qtyReturned: variantReturnQty.get(id) || 0,
    };
  });

  const returnRate = paidOrdersCount != null ? pct(returns.length, paidOrdersCount) : null;

  return {
    totals: {
      returns: returns.length,
      exchanges: exchanges.length,
      refunds: refunds.length,
      returnRate,
    },
    breakdowns: {
      returnStatus: byReturnStatus,
      returnReason: byReturnReason,
      exchangeStatus: byExchangeStatus,
      exchangeReason: byExchangeReason,
      refundStatus: byRefundStatus,
      refundReason: byRefundReason,
    },
    topReturnedVariants,
  };
}
