// my-project/app/api/payments/sslcommerz/ipn/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const {
  SSLCZ_STORE_ID,
  SSLCZ_STORE_PASSWORD,
  SSLCZ_SANDBOX = "true",
  NEXT_PUBLIC_SITE_URL,
} = process.env;

function sslczBase() {
  return SSLCZ_SANDBOX === "true"
    ? "https://sandbox.sslcommerz.com"
    : "https://securepay.sslcommerz.com";
}

async function createSlipIfOrderUpdateFailed({ paymentId, providerRef, amount, currency, userId, orderId, rawPayload }) {
  try {
    await prisma.paymentSlip.create({
      data: {
        userId: userId || "",
        amount,
        currency,
        provider: "SSL_COMMERZ",
        providerRef,
        paymentId,
        orderId,
        status: "PAID_NEEDS_ORDER",
        cartSnapshot: rawPayload ? rawPayload : undefined,
        notes: "IPN: order update failed after successful payment",
      },
    });
  } catch (_) { /* swallow */ }
}

export async function POST(req) {
  try {
    // SSLCommerz sends form-encoded body
    const text = await req.text();
    const p = new URLSearchParams(text);
    const val_id = p.get("val_id");
    const tran_id = p.get("tran_id");
    const status = (p.get("status") || "").toUpperCase();

    if (!val_id || !tran_id) {
      return NextResponse.json({ ok: false, error: "missing_val_or_tran" }, { status: 400 });
    }

    const [, paymentId] = String(tran_id).split("-");
    const payment = paymentId
      ? await prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } })
      : null;

    if (!payment) return new NextResponse("ok", { status: 200 }); // ignore unknown

    // Early fail from IPN payload
    if (status === "FAILED" || status === "CANCELLED" || status === "CANCELED") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", rawPayload: Object.fromEntries(p.entries()), message: status.toLowerCase() },
      }).catch(() => {});
      // Mark order as failed too (if created)
      if (payment.orderId) {
        await prisma.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "FAILED", status: "CANCELLED" },
        }).catch(() => {});
      }
      return new NextResponse("ok", { status: 200 });
    }

    // Validator call (authoritative)
    const qs = new URLSearchParams({
      val_id,
      store_id: SSLCZ_STORE_ID,
      store_passwd: SSLCZ_STORE_PASSWORD,
      v: "1",
      format: "json",
    });
    const verifyRes = await fetch(`${sslczBase()}/validator/api/validationserverAPI.php?${qs.toString()}`);
    let verify = {};
    try { verify = await verifyRes.json(); } catch {}

    const valid = verifyRes.ok && ["VALID", "VALIDATED", "SUCCESS"].includes(String(verify.status || "").toUpperCase());

    if (!valid) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", rawPayload: verify, message: String(verify?.status || "invalid").toLowerCase() },
      }).catch(() => {});
      if (payment.orderId) {
        await prisma.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "FAILED", status: "CANCELLED" },
        }).catch(() => {});
      }
      return new NextResponse("ok", { status: 200 });
    }

    // Mark payment paid, then confirm order
    try {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            transactionId: verify?.val_id || val_id,
            rawPayload: verify,
            message: "sslcommerz_paid",
          },
        });
        if (payment.orderId) {
          await tx.order.update({
            where: { id: payment.orderId },
            data: { paymentStatus: "PAID", status: "CONFIRMED" },
          });
        } else {
          // No order to mark — produce a slip so customer can confirm later
          await createSlipIfOrderUpdateFailed({
            paymentId: payment.id,
            providerRef: verify?.val_id || val_id,
            amount: payment.amount,
            currency: payment.currency,
            userId: payment.order?.userId || "", // if order missing, this may be empty
            orderId: null,
            rawPayload: verify,
          });
        }
      });
    } catch (e) {
      // Payment marked but order update failed — create slip
      await createSlipIfOrderUpdateFailed({
        paymentId: payment.id,
        providerRef: verify?.val_id || val_id,
        amount: payment.amount,
        currency: payment.currency,
        userId: payment.order?.userId || "",
        orderId: payment.orderId || null,
        rawPayload: verify,
      });
    }

    return new NextResponse("ok", { status: 200 });
  } catch (err) {
    return new NextResponse(`ipn error: ${err.message}`, { status: 400 });
  }
}
