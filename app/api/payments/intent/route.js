// app/api/payments/intent/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import Stripe from "stripe";
import prisma from "@/lib/prisma";

export async function POST(req) {
  try {
    const { orderId, provider } = await req.json();

    if (!orderId) {
      return NextResponse.json({ ok: false, error: "ORDER_ID_REQUIRED" }, { status: 400 });
    }

    // Lookup order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, grandTotal: true, currency: true, orderNumber: true, userId: true },
    });

    if (!order) {
      return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
    }

    // Stripe (all major cards supported under 'card' when enabled in Dashboard)
    if (provider === "STRIPE") {
      if (!process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, { status: 500 });
      }

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2024-06-20",
      });

      // Amount in the smallest currency unit
      const amount = Math.round(Number(order.grandTotal) * 100);
      const currency = (order.currency || "BDT").toLowerCase();

      // Automatic payment methods allow Stripe to choose the right flow.
      // 'card' covers Visa, Mastercard, Amex, Discover, JCB, Diners, UnionPay, RuPay (when enabled).
      const pi = await stripe.paymentIntents.create({
        amount,
        currency,
        metadata: {
          order_id: order.id,
          order_number: String(order.orderNumber || ""),
        },
        automatic_payment_methods: { enabled: true, allow_redirects: "always" },
        payment_method_types: ["card"], // explicit card; automatic PMM still on
        payment_method_options: {
          card: {
            request_three_d_secure: "automatic", // protects high-risk; minimizes friction
          },
        },
        capture_method: "automatic",
      });

      return NextResponse.json({ ok: true, mode: "client_secret", client_secret: pi.client_secret });
    }

    // Redirect-type providers (if you support them from the backend)
    if (provider === "SSL_COMMERZ" || provider === "BKASH" || provider === "NAGAD") {
      // You likely already create a session with those providers here.
      // Return a redirect URL for the frontend to send the customer to.
      const session = await createRedirectSessionFor(provider, order); // <-- implement in your codebase
      return NextResponse.json({ ok: true, mode: "redirect", url: session.redirectUrl });
    }

    return NextResponse.json({ ok: false, error: "UNSUPPORTED_PROVIDER" }, { status: 400 });
  } catch (err) {
    console.error("[payments/intent] error", err);
    return NextResponse.json({ ok: false, error: "PAYMENT_INTENT_FAILED" }, { status: 500 });
  }
}

// Stub — implement your SSLCommerz/bKash/Nagad session logic here:
async function createRedirectSessionFor(provider, order) {
  throw new Error(`Redirect session not implemented for ${provider}`);
}
