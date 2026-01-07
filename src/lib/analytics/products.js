// FILE: lib/analytics/products.js
import {
  resolveTable,
  getColumns,
  pickCol,
  qIdent,
  qTable,
  n,
  isPaidSQL,
} from "./_sql";

function safeKey(v) {
  if (v == null) return "UNKNOWN";
  const s = String(v);
  return s.length ? s : "UNKNOWN";
}

function daySpan(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  // treat [start,end) window like your SQL, so days = ceil(ms / day)
  return Math.max(1, Math.ceil((b - a) / (24 * 60 * 60 * 1000)));
}

/**
 * Products analytics
 * - Best sellers (paid orders only)
 * - Trending (delta vs compare window)
 * - Velocity deltas (units/day + delta vs compare)
 *
 * Important: do NOT strip identifier quotes. Prisma Postgres columns may be camelCase
 * and require quoting to work (e.g. "createdAt", "paymentStatus").
 * Also: use $queryRawUnsafe for dynamic identifier SQL, but keep values parameterized.
 */
export async function computeProductsAnalytics(
  prisma,
  { start, end, compareStart, compareEnd }
) {
  const orderTable = await resolveTable(prisma, ["Order", "orders", "order"]);
  const itemTable = await resolveTable(prisma, ["OrderItem", "order_items", "orderItem"]);

  if (!orderTable || !itemTable) {
    return { ok: true, bestSellers: [], trending: [], velocity: null, meta: { orderTable, itemTable } };
  }

  const tOrder = qTable(orderTable);
  const tItem = qTable(itemTable);

  const oCols = await getColumns(prisma, orderTable);
  const iCols = await getColumns(prisma, itemTable);

  const oId = pickCol(oCols, ["id"]);
  const oCreated = pickCol(oCols, ["createdAt", "created_at"]);
  const oPay = pickCol(oCols, ["paymentStatus", "payment_status"]);

  const iOrderId = pickCol(iCols, ["orderId", "order_id"]);
  const iName = pickCol(iCols, ["productName", "name", "title"]);
  const iSku = pickCol(iCols, ["sku", "productSku", "variantSku"]);
  const iQty = pickCol(iCols, ["quantity", "qty"]);
  const iLineTotal = pickCol(iCols, ["lineTotal", "total", "amount", "priceTotal"]);

  const qOId = qIdent(oId);
  const qOCreated = qIdent(oCreated);
  const qOPay = qIdent(oPay);

  const qIOrderId = qIdent(iOrderId);
  const qIName = qIdent(iName);
  const qISku = qIdent(iSku);
  const qIQty = qIdent(iQty);
  const qILineTotal = qIdent(iLineTotal);

  if (!qOId || !qOCreated || !qIOrderId) {
    return {
      ok: true,
      bestSellers: [],
      trending: [],
      velocity: null,
      warning: "Missing join columns.",
      meta: { orderTable, itemTable, oId, oCreated, iOrderId },
    };
  }

  // Build paid predicate (identifier included as-is; may be quoted)
  const paidPredicate = qOPay ? isPaidSQL(`o.${qOPay}`) : "TRUE";

  // ---------------- Best sellers (paid orders only) ----------------
  const bestSql = `
    SELECT
      ${qISku || "NULL"} AS sku,
      ${qIName || "NULL"} AS name,
      SUM(COALESCE(${qIQty || "1"}, 1))::int AS units,
      SUM(COALESCE(${qILineTotal || "0"}, 0))::numeric AS revenue
    FROM ${tItem} i
    JOIN ${tOrder} o ON o.${qOId} = i.${qIOrderId}
    WHERE o.${qOCreated} >= $1 AND o.${qOCreated} < $2
      AND ${paidPredicate}
    GROUP BY ${qISku || "NULL"}, ${qIName || "NULL"}
    ORDER BY revenue DESC NULLS LAST, units DESC
    LIMIT 30
  `;

  const bestRows = await prisma.$queryRawUnsafe(bestSql, start, end);

  const bestSellers = (bestRows || []).map((r) => ({
    sku: safeKey(r?.sku),
    name: safeKey(r?.name),
    units: n(r?.units, 0),
    revenue: Math.round(n(r?.revenue, 0) * 100) / 100,
  }));

  // ---------------- Trending + Velocity deltas (compare window) ----------------
  let trending = [];
  let velocity = null;

  if (compareStart && compareEnd) {
    const trendSql = `
      WITH cur AS (
        SELECT
          ${qISku || "NULL"} AS sku,
          ${qIName || "NULL"} AS name,
          SUM(COALESCE(${qIQty || "1"}, 1))::int AS units,
          SUM(COALESCE(${qILineTotal || "0"}, 0))::numeric AS revenue
        FROM ${tItem} i
        JOIN ${tOrder} o ON o.${qOId} = i.${qIOrderId}
        WHERE o.${qOCreated} >= $1 AND o.${qOCreated} < $2
          AND ${paidPredicate}
        GROUP BY ${qISku || "NULL"}, ${qIName || "NULL"}
      ),
      prev AS (
        SELECT
          ${qISku || "NULL"} AS sku,
          ${qIName || "NULL"} AS name,
          SUM(COALESCE(${qIQty || "1"}, 1))::int AS units,
          SUM(COALESCE(${qILineTotal || "0"}, 0))::numeric AS revenue
        FROM ${tItem} i
        JOIN ${tOrder} o ON o.${qOId} = i.${qIOrderId}
        WHERE o.${qOCreated} >= $3 AND o.${qOCreated} < $4
          AND ${paidPredicate}
        GROUP BY ${qISku || "NULL"}, ${qIName || "NULL"}
      )
      SELECT
        COALESCE(cur.sku, prev.sku) AS sku,
        COALESCE(cur.name, prev.name) AS name,
        COALESCE(cur.units, 0)::int AS cur_units,
        COALESCE(prev.units, 0)::int AS prev_units,
        (COALESCE(cur.units, 0) - COALESCE(prev.units, 0))::int AS delta_units,
        COALESCE(cur.revenue, 0)::numeric AS cur_revenue,
        COALESCE(prev.revenue, 0)::numeric AS prev_revenue,
        (COALESCE(cur.revenue, 0) - COALESCE(prev.revenue, 0))::numeric AS delta_revenue
      FROM cur
      FULL OUTER JOIN prev USING (sku, name)
      ORDER BY delta_units DESC, delta_revenue DESC
      LIMIT 60
    `;

    const trendRows = await prisma.$queryRawUnsafe(
      trendSql,
      start,
      end,
      compareStart,
      compareEnd
    );

    const curDays = daySpan(start, end);
    const prevDays = daySpan(compareStart, compareEnd);

    const rows = (trendRows || []).map((r) => {
      const curUnits = n(r?.cur_units ?? r?.curUnits, 0);
      const prevUnits = n(r?.prev_units ?? r?.prevUnits, 0);
      const curRevenue = n(r?.cur_revenue ?? r?.curRevenue, 0);
      const prevRevenue = n(r?.prev_revenue ?? r?.prevRevenue, 0);

      const curVelocity = curDays ? curUnits / curDays : 0;
      const prevVelocity = prevDays ? prevUnits / prevDays : 0;
      const deltaVelocity = curVelocity - prevVelocity;

      return {
        sku: safeKey(r?.sku),
        name: safeKey(r?.name),
        curUnits,
        prevUnits,
        deltaUnits: n(r?.delta_units ?? r?.deltaUnits, 0),
        curRevenue: Math.round(curRevenue * 100) / 100,
        prevRevenue: Math.round(prevRevenue * 100) / 100,
        deltaRevenue: Math.round((curRevenue - prevRevenue) * 100) / 100,
        // NEW (plan): velocity
        curUnitsPerDay: Math.round(curVelocity * 100) / 100,
        prevUnitsPerDay: Math.round(prevVelocity * 100) / 100,
        deltaUnitsPerDay: Math.round(deltaVelocity * 100) / 100,
      };
    });

    // Keep your original “trending” semantics, but cap back to 30
    trending = rows.slice(0, 30);

    // Velocity leaders (top 30 by current units/day)
    velocity = {
      curDays,
      prevDays,
      leaders: rows
        .slice()
        .sort((a, b) => (b.curUnitsPerDay || 0) - (a.curUnitsPerDay || 0))
        .slice(0, 30),
    };
  }

  return { ok: true, bestSellers, trending, velocity };
}
