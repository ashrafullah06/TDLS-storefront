// FILE: app/api/checkout/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Checkout funnel (last 7d).
 * Since schema has no CheckoutEvent, approximate:
 * - shipping = carts created
 * - payment = orders placed
 * - confirmed = orders confirmed/completed
 */
export async function GET() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const shipping = await prisma.cart.count({ where: { createdAt: { gte: since } } });
    const payment = await prisma.order.count({ where: { createdAt: { gte: since } } });
    const confirmed = await prisma.order.count({
      where: { createdAt: { gte: since }, status: { in: ["CONFIRMED","COMPLETED"] } },
    });

    const conversion = shipping > 0 ? Number(((confirmed / shipping) * 100).toFixed(2)) : 0;

    return NextResponse.json({ steps: { shipping, payment, confirmed }, conversion });
  } catch (e) {
    return NextResponse.json({ error: "checkout summary unavailable", detail: String(e) }, { status: 503 });
  }
}
