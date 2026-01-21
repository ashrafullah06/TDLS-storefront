// FILE: app/api/customers/orders/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

const PAIDLIKE = new Set([
  "PAID",
  "SETTLED",
  "CAPTURED",
  "SUCCEEDED",
  "AUTHORIZED",
]);

function toNum(x) {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseLimit(limitRaw) {
  let limit = Number.parseInt(String(limitRaw || "100"), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;
  return limit;
}

export async function GET(req) {
  try {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id ? String(session.user.id) : null;

    // not signed in → no orders (but not an error)
    if (!userId) {
      return json({ ok: true, items: [] }, 200);
    }

    const { searchParams } = new URL(req.url);
    const limit = parseLimit(searchParams.get("limit"));

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

    const items = (Array.isArray(orders) ? orders : []).map((o) => {
      const orderItems = Array.isArray(o?.items) ? o.items : [];
      const payments = Array.isArray(o?.payments) ? o.payments : [];
      const shipments = Array.isArray(o?.shipments) ? o.shipments : [];

      const itemCount = orderItems.reduce(
        (sum, it) => sum + toNum(it?.quantity),
        0
      );

      const paidAmount = payments.reduce((sum, p) => {
        const st = String(p?.status || "").toUpperCase();
        return PAIDLIKE.has(st) ? sum + toNum(p?.amount) : sum;
      }, 0);

      // first shipment, if any – handy for tracking UI
      const firstShipment = shipments[0] || null;

      return {
        id: String(o?.id || ""),
        orderNumber: o?.orderNumber ?? null,
        status: o?.status ?? null,
        paymentStatus: o?.paymentStatus ?? null,
        fulfillmentStatus: o?.fulfillmentStatus ?? null,
        currency: o?.currency ?? null,

        grandTotal: toNum(o?.grandTotal),
        subtotal: toNum(o?.subtotal),
        shippingTotal: toNum(o?.shippingTotal),
        discountTotal: toNum(o?.discountTotal),
        taxTotal: toNum(o?.taxTotal),

        createdAt: o?.createdAt ?? null,
        // present in most schemas; harmless if undefined (it will be omitted by JSON)
        updatedAt: o?.updatedAt ?? null,

        itemCount,
        paidAmount,

        // minimal shipment info for future use
        shipments: firstShipment
          ? [
              {
                id: String(firstShipment?.id || ""),
                status: firstShipment?.status ?? null,
                trackingNumber:
                  firstShipment?.trackingNumber != null
                    ? String(firstShipment.trackingNumber)
                    : null,
                // optional fields (safe if not present in schema)
                trackingUrl:
                  firstShipment?.trackingUrl != null
                    ? String(firstShipment.trackingUrl)
                    : null,
                carrier: firstShipment?.carrier ?? null,
                updatedAt: firstShipment?.updatedAt ?? null,
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
