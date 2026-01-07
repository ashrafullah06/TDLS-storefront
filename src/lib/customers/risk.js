// FILE: lib/customers/risk.js

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function ratio(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  if (!y) return 0;
  return x / y;
}

/**
 * Compute an automatic risk profile from real metrics.
 * No guessing: input metrics must come from DB aggregation.
 */
export function computeCustomerRisk(metrics) {
  const m = metrics || {};
  const total = Number(m.totalOrders || 0);
  const cancelled = Number(m.cancelledOrders || 0);
  const rejected = Number(m.rejectedOrders || 0);
  const delivered = Number(m.deliveredOrders || 0);

  const codTotal = Number(m.codOrders || 0);
  const codUnpaid = Number(m.codDeliveredUnpaid || 0);

  const returns = Number(m.returnRequests || 0);
  const refunds = Number(m.refundRequests || 0);

  const recent7d = Number(m.orders7d || 0);
  const recent24h = Number(m.orders24h || 0);

  const addrCount = Number(m.addressCount || 0);
  const distinctAddr7d = Number(m.distinctAddresses7d || 0);

  const cancelRate = ratio(cancelled + rejected, total);
  const returnRate = ratio(returns, total);
  const refundRate = ratio(refunds, total);
  const codNonPayRate = ratio(codUnpaid, Math.max(1, codTotal));
  const deliveryRate = ratio(delivered, total);

  // Score build: 0 (safe) -> 100 (highest risk)
  let score = 0;

  // High-impact signals
  score += clamp(Math.round(codNonPayRate * 80), 0, 45); // COD non-pay is severe
  score += clamp(Math.round(cancelRate * 70), 0, 35);   // excessive cancellations/rejections
  score += clamp(Math.round((returnRate + refundRate) * 50), 0, 25);

  // Velocity / churn signals
  if (recent24h >= 3) score += 10;
  else if (recent7d >= 6) score += 7;

  if (distinctAddr7d >= 2) score += 8;
  if (addrCount >= 10) score += 6;

  // Positive credit
  if (total >= 5 && deliveryRate >= 0.8 && cancelRate <= 0.15 && codNonPayRate === 0) score -= 10;
  if (total >= 12 && deliveryRate >= 0.85 && cancelRate <= 0.12 && (returnRate + refundRate) <= 0.15) score -= 10;

  score = clamp(score, 0, 100);

  const tags = [];

  if (codUnpaid > 0) tags.push("COD_NON_PAYER");
  if (cancelRate >= 0.35 && total >= 3) tags.push("FREQUENT_CANCELLER");
  if (recent24h >= 3) tags.push("SUSPICIOUS_ORDERING");
  if ((returnRate + refundRate) >= 0.35 && total >= 3) tags.push("RETURN_ABUSE");
  if (distinctAddr7d >= 2) tags.push("ADDRESS_MISMATCH");

  // Level
  let level = "SAFE";
  if (score >= 70) level = "FRAUD_SUSPECT";
  else if (score >= 50) level = "RISKY";
  else if (score >= 30) level = "WATCHLIST";

  return {
    score,
    level,
    tags,
    metrics: {
      total,
      delivered,
      cancelled,
      rejected,
      cancelRate,
      codTotal,
      codUnpaid,
      codNonPayRate,
      returns,
      refunds,
      returnRate,
      refundRate,
      recent7d,
      recent24h,
      addrCount,
      distinctAddr7d,
    },
  };
}
