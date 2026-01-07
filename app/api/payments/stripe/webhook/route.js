// my-project/app/api/payments/stripe/webhook/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";

const { STRIPE_WEBHOOK_SECRET } = process.env;

function toJson(s) { try { return JSON.parse(s); } catch { return null; } }

async function createSlipIfOrderUpdateFailed({ paymentId, providerRef, amount, currency, userId, orderId, rawPayload }) {
  try {
    await prisma.paymentSlip.create({
      data: {
        userId: userId || "",
        amount,
        currency,
        provider: "STRIPE",
        providerRef,
        paymentId,
        orderId,
        status: "PAID_NEEDS_ORDER",
        cartSnapshot: rawPayload ? rawPayload : undefined,
        notes: "stripe webhook: order update failed after successful payment",
      },
    });
  } catch (_) {}
}

export async function POST(req) {
  // Read raw body first (Stripe signature requirement)
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "stripe_endpoint_secret_missing" }, { status: 500 });
  }

  // Verify signature (HMAC over `${t}.${raw}`)
  const parts = Object.fromEntries(
    sig.split(",").map(kv => {
      const [k, v] = kv.split("=", 2);
      return [k.trim(), v];
    })
  );
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return NextResponse.json({ ok: false, error: "stripe_sig_header_invalid" }, { status: 400 });

  const expected = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(`${ts}.${raw}`, "utf8")
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
    return NextResponse.json({ ok: false, error: "stripe_sig_mismatch" }, { status: 400 });
  }

  const event = toJson(raw);
  if (!event) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });

  // Handle success & failure types
  if (event.type === "payment_intent.succeeded" || event.type === "charge.succeeded") {
    const obj = event.data.object;
    const pi = obj.payment_intent ? obj.payment_intent : obj.id;
    const paymentIntentId = String(pi);

    // Try match by transactionId, else by metadata.orderId
    let payment = await prisma.payment.findFirst({
      where: { provider: "STRIPE", transactionId: paymentIntentId },
      include: { order: true },
    });
    if (!payment) {
      const meta = obj.metadata || {};
      if (meta.orderId) {
        payment = await prisma.payment.findFirst({
          where: { provider: "STRIPE", orderId: meta.orderId },
          include: { order: true },
        });
      }
    }
    if (!payment) return new NextResponse("ok", { status: 200 });

    try {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            transactionId: paymentIntentId,
            rawPayload: event,
            message: "stripe_paid",
          },
        });
        if (payment.orderId) {
          await tx.order.update({
            where: { id: payment.orderId },
            data: { paymentStatus: "PAID", status: "CONFIRMED" },
          });
        } else {
          await createSlipIfOrderUpdateFailed({
            paymentId: payment.id,
            providerRef: paymentIntentId,
            amount: payment.amount,
            currency: payment.currency,
            userId: payment.order?.userId || "",
            orderId: null,
            rawPayload: event,
          });
        }
      });
    } catch (e) {
      await createSlipIfOrderUpdateFailed({
        paymentId: payment.id,
        providerRef: paymentIntentId,
        amount: payment.amount,
        currency: payment.currency,
        userId: payment.order?.userId || "",
        orderId: payment.orderId || null,
        rawPayload: event,
      });
    }
    return new NextResponse("ok", { status: 200 });
  }

  if (event.type === "payment_intent.payment_failed" || event.type === "charge.failed") {
    const obj = event.data.object;
    const pi = obj.payment_intent ? obj.payment_intent : obj.id;
    const paymentIntentId = String(pi);

    const payment = await prisma.payment.findFirst({
      where: { provider: "STRIPE", OR: [{ transactionId: paymentIntentId }, { message: { contains: "stripe" } }] },
      include: { order: true },
    });
    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", rawPayload: event, message: "stripe_failed" },
      }).catch(() => {});
      if (payment.orderId) {
        await prisma.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "FAILED", status: "CANCELLED" },
        }).catch(() => {});
      }
    }
    return new NextResponse("ok", { status: 200 });
  }

  // Ack all else
  return new NextResponse("ok", { status: 200 });
}
