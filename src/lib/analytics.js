//my-project\src\lib\analytics.js
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

// P&L computation (order + payments + item costs)
export async function pnl({ from, to } = {}) {
  const prisma = await getPrisma();
  const ORD = M("Order");
  const OI = M("OrderItem");
  const PAY = M("Payment");

  const whereCreated = {};
  if (from) whereCreated[ORD.createdAt] = { gte: from };
  if (to) whereCreated[ORD.createdAt] = { ...(whereCreated[ORD.createdAt]||{}), lte: to };

  const orders = await prisma[ORD.model].findMany({
    where: whereCreated,
    include: { items: true }
  });

  let revenue = 0, cogs = 0;

  for (const o of orders) {
    // Prefer captured/paid payments, fallback to order total
    if (prisma[PAY.model]) {
      const pays = await prisma[PAY.model].findMany({
        where: { [PAY.orderId]: o.id, [PAY.status]: { in: ["captured", "paid", "succeeded"] } }
      });
      revenue += pays.reduce((sum, p) => sum + Number(p[PAY.amount] || 0), 0);
    } else {
      revenue += Number(o[ORD.total] || 0);
    }

    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) {
      const qty = Number(it[OI.qty] || it.quantity || 0);
      const cost = Number(it[OI.cost] ?? 0);
      cogs += cost * qty;
    }
  }

  const gross = revenue - cogs;
  const expenses = 0; // wire to provider fees model in a later pass if you keep fees in DB
  const net = gross - expenses;

  return { revenue, cogs, gross_profit: gross, expenses, net_profit: net };
}
