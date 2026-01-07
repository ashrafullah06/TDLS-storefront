// FILE: app/api/customers/orders/route.js
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

const PAIDLIKE = new Set([
  "PAID",
  "SETTLED",
  "CAPTURED",
  "SUCCEEDED",
  "AUTHORIZED",
]);

export async function GET(req) {
  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    // not signed in → no orders (but not an error)
    if (!userId) {
      return json({ ok: true, items: [] }, 200);
    }

    const { searchParams } = new URL(req.url);
    const limitRaw = searchParams.get("limit");
    let limit = Number.parseInt(limitRaw || "100", 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 100;
    if (limit > 500) limit = 500;

    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        items: true,
        payments: true,
        shipments: true,
      },
    });

    const items = orders.map((o) => {
      const orderItems = Array.isArray(o.items) ? o.items : [];
      const payments = Array.isArray(o.payments) ? o.payments : [];
      const itemCount = orderItems.reduce(
        (sum, it) => sum + Number(it.quantity || 0),
        0
      );

      const paidAmount = payments.reduce((sum, p) => {
        const st = String(p?.status || "").toUpperCase();
        return PAIDLIKE.has(st) ? sum + Number(p.amount || 0) : sum;
      }, 0);

      // first shipment, if any – handy for tracking UI
      const firstShipment = (o.shipments && o.shipments[0]) || null;

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
        // minimal shipment info for future use
        shipments: firstShipment
          ? [
              {
                id: firstShipment.id,
                status: firstShipment.status,
                trackingNumber: firstShipment.trackingNumber,
              },
            ]
          : [],
      };
    });

    return json({ ok: true, items }, 200);
  } catch (err) {
    console.error("[api/customers/orders GET]", err);
    // fail soft for dashboard
    return json({ ok: true, items: [] }, 200);
  }
}
