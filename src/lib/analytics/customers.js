// FILE: lib/analytics/customers.js
import {
  resolveTable,
  getColumns,
  pickCol,
  qIdent,
  qTable,
  n,
  isPaidSQL,
  buildOrderWhereSQL,
} from "./_sql";

function norm(v) {
  if (v == null) return "UNKNOWN";
  const s = String(v);
  return s.length ? s : "UNKNOWN";
}

export async function computeCustomersAnalytics(prisma, { start, end, filters = {} }) {
  const orderTable = await resolveTable(prisma, ["Order", "orders", "order"]);
  if (!orderTable) return { ok: true, leaders: [], cart: null, wishlist: null };

  const tOrder = qTable(orderTable);
  const cols = await getColumns(prisma, orderTable);

  const createdCol = pickCol(cols, ["createdAt", "created_at"]);
  const payCol = pickCol(cols, ["paymentStatus", "payment_status"]);
  const totalCol = pickCol(cols, ["grandTotal", "grand_total", "total", "amount"]);

  // Customer identifier candidates
  const custCol = pickCol(cols, [
    "customerId",
    "customer_id",
    "userId",
    "user_id",
    "customerEmail",
    "email",
    "phone",
  ]);

  const qCreated = qIdent(createdCol);
  const qPay = qIdent(payCol);
  const qTotal = qIdent(totalCol);
  const qCust = qIdent(custCol);

  if (!qCreated || !qCust) {
    return {
      ok: true,
      leaders: [],
      warning: "Customer identifier column not found on Order table.",
    };
  }

  const { whereSQL, params } = buildOrderWhereSQL({ cols, filters });

  // NOTE: We intentionally use $queryRawUnsafe here because:
  // - identifiers are dynamic (table/column names)
  // - values are still parameterized with $1, $2, ... and passed separately
  const leadersSql = `
    SELECT
      ${qCust} AS customer,
      COUNT(*)::int AS orders,
      SUM(
        CASE WHEN ${qPay ? isPaidSQL(qPay) : "FALSE"}
        THEN COALESCE(${qTotal || "0"},0)
        ELSE 0 END
      )::numeric AS spend_paid
    FROM ${tOrder}
    WHERE ${qCreated} >= $1 AND ${qCreated} < $2
    ${whereSQL}
    GROUP BY ${qCust}
    ORDER BY spend_paid DESC NULLS LAST, orders DESC
    LIMIT 50
  `;

  const rows = await prisma.$queryRawUnsafe(leadersSql, start, end, ...params);

  const leaders = (rows || []).map((r) => ({
    customer: norm(r?.customer),
    orders: n(r?.orders, 0),
    spendPaid: Math.round(n(r?.spend_paid ?? r?.spendPaid, 0) * 100) / 100,
  }));

  // Optional: cart + wishlist tables (best-effort)
  const cartTable = await resolveTable(prisma, ["CartItem", "cart_items", "Cart"]);
  const wishTable = await resolveTable(prisma, ["WishlistItem", "wishlist_items", "Wishlist"]);

  let cart = null;
  if (cartTable) {
    const tCart = qTable(cartTable);
    const cCols = await getColumns(prisma, cartTable);
    const cCust = pickCol(cCols, ["customerId", "customer_id", "userId", "user_id", "email", "phone"]);
    const cQty = pickCol(cCols, ["quantity", "qty"]);
    const cPrice = pickCol(cCols, ["price", "unitPrice", "unit_price"]);
    const qCCust = qIdent(cCust);
    const qCQty = qIdent(cQty);
    const qCPrice = qIdent(cPrice);

    if (qCCust) {
      const cartSql = `
        SELECT
          ${qCCust} AS customer,
          COUNT(*)::int AS lines,
          SUM(COALESCE(${qCQty || "1"},1))::int AS items,
          SUM(COALESCE(${qCQty || "1"},1) * COALESCE(${qCPrice || "0"},0))::numeric AS value
        FROM ${tCart}
        GROUP BY ${qCCust}
        ORDER BY value DESC NULLS LAST
        LIMIT 50
      `;
      const cRows = await prisma.$queryRawUnsafe(cartSql);

      cart = (cRows || []).map((r) => ({
        customer: norm(r?.customer),
        lines: n(r?.lines, 0),
        items: n(r?.items, 0),
        value: Math.round(n(r?.value, 0) * 100) / 100,
      }));
    }
  }

  let wishlist = null;
  if (wishTable) {
    const tWish = qTable(wishTable);
    const wCols = await getColumns(prisma, wishTable);
    const wCust = pickCol(wCols, ["customerId", "customer_id", "userId", "user_id", "email", "phone"]);
    const qWCust = qIdent(wCust);

    if (qWCust) {
      const wishSql = `
        SELECT
          ${qWCust} AS customer,
          COUNT(*)::int AS saved
        FROM ${tWish}
        GROUP BY ${qWCust}
        ORDER BY saved DESC
        LIMIT 50
      `;
      const wRows = await prisma.$queryRawUnsafe(wishSql);

      wishlist = (wRows || []).map((r) => ({
        customer: norm(r?.customer),
        saved: n(r?.saved, 0),
      }));
    }
  }

  return { ok: true, leaders, cart, wishlist };
}
