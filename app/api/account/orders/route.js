// PATH: app/api/account/orders/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET() {
  try {
    // Auth using Auth.js v5 single config
    const session = await auth();
    const userId = session?.user?.id || null;

    // If not signed in, return empty list but NOT an error
    if (!userId) {
      return json([], 200);
    }

    // Fetch all orders for this customer (newest first)
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
        payments: true,
      },
    });

    // Map to a compact customer-safe shape
    const data = orders.map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const payments = Array.isArray(o.payments) ? o.payments : [];

      // Count items
      const itemCount = items.reduce(
        (sum, it) => sum + Number(it.quantity || 0),
        0
      );

      // Sum paid (PAID-like statuses)
      const PAIDLIKE = new Set([
        "PAID",
        "SETTLED",
        "CAPTURED",
        "SUCCEEDED",
        "AUTHORIZED",
      ]);
      const paidAmount = payments.reduce((sum, p) => {
        const st = String(p?.status || "").toUpperCase();
        return PAIDLIKE.has(st) ? sum + Number(p.amount || 0) : sum;
      }, 0);

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        currency: o.currency,
        grandTotal: Number(o.grandTotal ?? 0),
        subtotal: Number(o.subtotal ?? 0),
        shippingTotal: Number(o.shippingTotal ?? 0),
        discountTotal: Number(o.discountTotal ?? 0),
        taxTotal: Number(o.taxTotal ?? 0),
        createdAt: o.createdAt,
        itemCount,
        paidAmount,
      };
    });

    return json(data, 200);
  } catch (err) {
    console.error("[api/account/orders GET] ", err);
    // For safety: don’t crash the dashboard – return empty array but with 500
    return json([], 500);
  }
}
