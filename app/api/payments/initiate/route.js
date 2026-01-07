// app/api/payments/initiate/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";
import { requireAuth } from "@/lib/auth";

export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    const { orderId, provider } = await req.json();

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return NextResponse.json({ ok: false, error: "order_not_found" }, { status: 404 });
    if (order.userId && order.userId !== userId) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const payment = await prisma.payment.create({
      data: {
        orderId,
        provider: provider || "SSL_COMMERZ",
        amount: order.grandTotal,
        currency: order.currency,
        status: "INITIATED",
        message: "initialized",
      },
    });

    // simulate a redirect URL from gateway (replace with real integration)
    const gatewayUrl = `/checkout/redirect?pid=${payment.id}`;

    return NextResponse.json({ ok: true, paymentId: payment.id, gatewayUrl });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
