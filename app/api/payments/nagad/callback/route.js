// app/api/payments/nagad/callback/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import crypto from "crypto";

const {
  NAGAD_MERCHANT_ID,
  NAGAD_PUBLIC_KEY_BASE64,
  NAGAD_PRIVATE_KEY_BASE64,
  NAGAD_SANDBOX = "true",
  NEXT_PUBLIC_SITE_URL,
} = process.env;

function base() {
  return NAGAD_SANDBOX === "true"
    ? "https://sandbox.nagad.com.bd"
    : "https://api.nagad.com.bd";
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const paymentRefId = searchParams.get("paymentRefId") || searchParams.get("payment_ref_id");
    const orderId = searchParams.get("orderId") || searchParams.get("order_id");

    if (!paymentRefId) throw new Error("paymentRefId_missing");

    // Find our Payment row by transactionId we saved during intent
    const payment = await prisma.payment.findFirst({
      where: { transactionId: paymentRefId, provider: "NAGAD" },
      include: { order: true },
    });
    if (!payment) throw new Error("payment_not_found");

    // Verify with Nagad
    const verifyRes = await fetch(`${base()}/api/dfs/verify/payment/${NAGAD_MERCHANT_ID}/${paymentRefId}`);
    const verifyData = await verifyRes.json();

    const success =
      verifyRes.ok &&
      (verifyData?.status === "Success" || verifyData?.status === "2000" || verifyData?.statusCode === "00");

    if (!success) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", rawPayload: verifyData, message: verifyData?.status || "nagad_failed" },
      });
      return Response.redirect(new URL(`/account/orders/${payment.orderId}`, NEXT_PUBLIC_SITE_URL), 302);
    }

    // Success — mark paid and confirm order
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "PAID",
          transactionId: verifyData?.issuerPaymentRefNo || paymentRefId,
          rawPayload: verifyData,
          message: "nagad_paid",
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: "PAID", status: "CONFIRMED" },
      });
    });

    return Response.redirect(new URL(`/account/orders/${payment.orderId}`, NEXT_PUBLIC_SITE_URL), 302);
  } catch (e) {
    return new Response("Nagad callback error", { status: 400 });
  }
}
