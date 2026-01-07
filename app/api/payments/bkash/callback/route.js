// app/api/payments/bkash/callback/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";

const {
  BKASH_USERNAME,
  BKASH_PASSWORD,
  BKASH_APP_KEY,
  BKASH_APP_SECRET,
  BKASH_SANDBOX = "true",
  NEXT_PUBLIC_SITE_URL,
} = process.env;

function base() {
  return BKASH_SANDBOX === "true"
    ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta"
    : "https://tokenized.pay.bka.sh/v1.2.0-beta";
}
async function authToken() {
  const res = await fetch(`${base()}/tokenized/checkout/token/grant`, {
    method: "POST",
    headers: {
      username: BKASH_USERNAME,
      password: BKASH_PASSWORD,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ app_key: BKASH_APP_KEY, app_secret: BKASH_APP_SECRET }),
  });
  const data = await res.json();
  if (!res.ok || !data?.id_token) throw new Error("bkash_auth_failed");
  return data.id_token;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const paymentID = searchParams.get("paymentID");
    if (!paymentID) throw new Error("paymentID_missing");

    // Find our Payment by the saved gateway paymentID
    const payment = await prisma.payment.findFirst({
      where: { transactionId: paymentID, provider: "BKASH" },
      include: { order: true },
    });
    if (!payment) throw new Error("payment_not_found");

    // Execute payment
    const token = await authToken();
    const execRes = await fetch(`${base()}/tokenized/checkout/execute`, {
      method: "POST",
      headers: {
        authorization: token,
        "x-app-key": BKASH_APP_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentID }),
    });
    const execData = await execRes.json();

    if (!execRes.ok || execData?.transactionStatus !== "Completed") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", rawPayload: execData, message: execData?.statusMessage || "bkash_failed" },
      });
      return Response.redirect(new URL(`/account/orders/${payment.orderId}`, NEXT_PUBLIC_SITE_URL), 302);
    }

    // Success — mark Payment & Order
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "PAID",
          transactionId: execData?.trxID || payment.transactionId, // replace gateway id with trxID
          rawPayload: execData,
          message: "bkash_paid",
        },
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: "PAID", status: "CONFIRMED" },
      });
    });

    return Response.redirect(new URL(`/account/orders/${payment.orderId}`, NEXT_PUBLIC_SITE_URL), 302);
  } catch (e) {
    // best effort redirect
    return new Response("bKash callback error", { status: 400 });
  }
}
