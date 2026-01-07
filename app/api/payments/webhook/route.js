// app/api/payments/webhook/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";

// —— ENV ————————————————————————————————————————————————————————
const {
  // Stripe
  STRIPE_WEBHOOK_SECRET,

  // SSLCommerz
  SSLCZ_STORE_ID,
  SSLCZ_STORE_PASSWORD,
  SSLCZ_SANDBOX = "true",

  // Site
  NEXT_PUBLIC_SITE_URL,
} = process.env;

// —— HELPERS ————————————————————————————————————————————————————
function sslczBase() {
  return SSLCZ_SANDBOX === "true"
    ? "https://sandbox.sslcommerz.com"
    : "https://securepay.sslcommerz.com";
}

async function updatePaid({ paymentId, provider, transactionId, rawPayload }) {
  await prisma.$transaction(async (tx) => {
    const pay = await tx.payment.update({
      where: { id: paymentId },
      data: { status: "PAID", transactionId, rawPayload, message: `${provider.toLowerCase()}_paid` },
      select: { id: true, orderId: true },
    });
    await tx.order.update({
      where: { id: pay.orderId },
      data: { paymentStatus: "PAID", status: "CONFIRMED" },
    });
  });
}

async function updateFailed({ paymentId, provider, rawPayload, message = "failed" }) {
  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "FAILED", rawPayload, message: `${provider.toLowerCase()}_${message}` },
  });
}

// Safe JSON parse
function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// —— PROVIDER HANDLERS ———————————————————————————————————————————

// 1) Stripe: verify signature and update payments
async function handleStripe(req, raw) {
  const sig = req.headers.get("stripe-signature") || "";
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "stripe_endpoint_secret_missing" }, { status: 500 });
  }

  // Stripe scheme: header like "t=timestamp,v1=signature"
  // Compute HMAC-SHA256 over: `${t}.${raw}`
  const parts = Object.fromEntries(
    sig.split(",").map(kv => {
      const [k, v] = kv.split("=", 2);
      return [k.trim(), v];
    })
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) {
    return NextResponse.json({ ok: false, error: "stripe_sig_header_invalid" }, { status: 400 });
  }
  const signedPayload = `${timestamp}.${raw}`;
  const expected = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(signedPayload, "utf8")
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) {
    return NextResponse.json({ ok: false, error: "stripe_sig_mismatch" }, { status: 400 });
  }

  const event = tryJson(raw);
  if (!event) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });

  // We care about payment_intent.succeeded / payment_intent.payment_failed.
  if (event.type === "payment_intent.succeeded" || event.type === "charge.succeeded") {
    const pi = event.data.object.payment_intent ? event.data.object.payment_intent : event.data.object.id;
    const paymentIntentId = typeof pi === "string" ? pi : event.data.object.id;

    // We try to match by transactionId first; if not found, try metadata.orderId/orderNumber.
    let payment = await prisma.payment.findFirst({
      where: { provider: "STRIPE", transactionId: paymentIntentId },
      select: { id: true },
    });

    if (!payment) {
      const meta = event.data.object.metadata || {};
      const orderId = meta.orderId || null;
      if (orderId) {
        payment = await prisma.payment.findFirst({
          where: { provider: "STRIPE", orderId },
          select: { id: true },
        });
      }
    }

    if (!payment) {
      // No matching payment row; nothing to update (but ACK so Stripe doesn't retry forever)
      return new NextResponse("ok", { status: 200 });
    }

    await updatePaid({
      paymentId: payment.id,
      provider: "STRIPE",
      transactionId: paymentIntentId,
      rawPayload: event,
    });
    return new NextResponse("ok", { status: 200 });
  }

  if (event.type === "payment_intent.payment_failed" || event.type === "charge.failed") {
    const paymentIntentId =
      event.data.object.payment_intent || event.data.object.id || "unknown";
    const payment = await prisma.payment.findFirst({
      where: {
        provider: "STRIPE",
        OR: [{ transactionId: String(paymentIntentId) }, { message: { contains: "stripe" } }],
      },
      select: { id: true },
    });
    if (payment) {
      await updateFailed({
        paymentId: payment.id,
        provider: "STRIPE",
        rawPayload: event,
        message: "failed",
      });
    }
    return new NextResponse("ok", { status: 200 });
  }

  // Unhandled but acknowledged to avoid retries
  return new NextResponse("ok", { status: 200 });
}

// 2) SSLCommerz IPN: validate with validator API, then update
async function handleSSLCommerz(req) {
  // They usually post x-www-form-urlencoded
  const ct = req.headers.get("content-type") || "";
  let val_id, tran_id, status;
  if (ct.includes("application/json")) {
    const body = await req.json();
    val_id = body?.val_id;
    tran_id = body?.tran_id;
    status = body?.status;
  } else {
    const text = await req.text();
    const p = new URLSearchParams(text);
    val_id = p.get("val_id");
    tran_id = p.get("tran_id");
    status = p.get("status");
  }

  if (!val_id || !tran_id) {
    return NextResponse.json({ ok: false, error: "missing_val_or_tran" }, { status: 400 });
  }

  // Our tran_id format: `${orderNumber}-${paymentId}` from the intent route.
  const [, paymentId] = String(tran_id).split("-");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true },
  });
  if (!payment) return new NextResponse("ok", { status: 200 }); // ignore unknown

  // If already paid, exit idempotently
  if (payment.status === "PAID") return new NextResponse("ok", { status: 200 });

  // Validate with SSLCommerz validator
  const qs = new URLSearchParams({
    val_id,
    store_id: SSLCZ_STORE_ID,
    store_passwd: SSLCZ_STORE_PASSWORD,
    v: "1",
    format: "json",
  });
  const verifyRes = await fetch(`${sslczBase()}/validator/api/validationserverAPI.php?${qs.toString()}`);
  const verify = await verifyRes.json();

  const valid =
    verifyRes.ok &&
    (verify.status === "VALID" || verify.status === "VALIDATED" || verify.status === "SUCCESS");

  if (!valid) {
    await updateFailed({ paymentId, provider: "SSL_COMMERZ", rawPayload: verify, message: verify?.status || "invalid" });
    return new NextResponse("ok", { status: 200 });
  }

  await updatePaid({
    paymentId,
    provider: "SSL_COMMERZ",
    transactionId: verify?.val_id || val_id,
    rawPayload: verify,
  });
  return new NextResponse("ok", { status: 200 });
}

// 3) bKash/Nagad: your app uses **server callbacks** we already built,
// so the webhook can simply log + ack to avoid retries.
// If you later receive official webhook specs with signatures, we can extend.

// —— ROUTER ——————————————————————————————————————————————————————
export async function POST(req) {
  try {
    const url = new URL(req.url);
    const provider = (url.searchParams.get("provider") || "").toUpperCase();

    // Stripe requires raw body for signature — grab it now
    const raw = await req.text();

    if (provider === "STRIPE") {
      return await handleStripe(req, raw);
    }

    if (provider === "SSL_COMMERZ") {
      // Reconstruct a request with the body we already read
      const proxyReq = new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: raw,
      });
      return await handleSSLCommerz(proxyReq);
    }

    if (provider === "BKASH" || provider === "NAGAD") {
      // Currently handled by callback routes:
      // - /api/payments/bkash/callback
      // - /api/payments/nagad/callback
      // We ACK to avoid gateway retries.
      return new NextResponse("ok", { status: 200 });
    }

    // Unknown provider; ACK to be safe
    return new NextResponse("ok", { status: 200 });
  } catch (err) {
    return new NextResponse(`webhook error: ${err.message}`, { status: 400 });
  }
}
