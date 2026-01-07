// app/api/payments/stripe/intent/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import Stripe from "stripe";

/**
 * POST /api/payments/stripe/intent
 * Body: { orderId, currency? } — default currency can be "usd" or "bdt" per your Stripe setup.
 * Returns a client_secret for Stripe PaymentIntent.
 */
function j(err, status = 400) {
  return NextResponse.json(err, { status });
}
function cents(n) {
  return Math.round(Number(n || 0) * 100);
}

export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    if (!process.env.STRIPE_SECRET_KEY) {
      return j({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, 503);
    }

    const { orderId, currency = "usd" } = await req.json().catch(() => ({}));
    if (!orderId) return j({ ok: false, error: "ORDER_ID_REQUIRED" });

    const order = await prisma.order.findUnique({
      where: { id: String(orderId) },
      include: { items: true },
    });
    if (!order || order.userId !== userId) {
      return j({ ok: false, error: "ORDER_NOT_FOUND" }, 404);
    }

    const amount =
      (order.items || []).reduce(
        (s, it) => s + Number(it.unitPrice || 0) * Number(it.quantity || 0),
        0
      ) +
      Number(order.shippingTotal || 0) +
      Number(order.taxTotal || 0) -
      Number(order.discountTotal || 0);

    if (!(amount > 0)) return j({ ok: false, error: "INVALID_AMOUNT" });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const pi = await stripe.paymentIntents.create({
      amount: cents(amount),
      currency,
      metadata: {
        orderId: order.id,
        userId: userId,
      },
      automatic_payment_methods: { enabled: true },
    });

    return NextResponse.json({
      ok: true,
      client_secret: pi.client_secret,
      payment_intent_id: pi.id,
    });
  } catch (err) {
    console.error("[stripe.intent.POST] ", err);
    const status = err?.status || 500;
    return j({ ok: false, error: "STRIPE_INTENT_FAILED" }, status);
  }
}
