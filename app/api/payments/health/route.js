// app/api/payments/health/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * GET /api/payments/health
 * Reports which gateways are configured. COD always true.
 */
export async function GET() {
  try {
    const STRIPE = !!process.env.STRIPE_SECRET_KEY;
    const SSL =
      !!process.env.SSLCZ_STORE_ID && !!process.env.SSLCZ_STORE_PASSWD;
    const BKASH =
      !!process.env.BKASH_APP_KEY &&
      !!process.env.BKASH_APP_SECRET &&
      !!process.env.BKASH_USERNAME &&
      !!process.env.BKASH_PASSWORD;
    const NAGAD =
      !!process.env.NAGAD_MERCHANT_ID &&
      !!process.env.NAGAD_MERCHANT_PRIVATE_KEY &&
      !!process.env.NAGAD_MERCHANT_PUBLIC_KEY;

    return NextResponse.json({
      ok: true,
      gateways: {
        CASH_ON_DELIVERY: true,
        STRIPE,
        SSL_COMMERZ: SSL,
        BKASH,
        NAGAD,
      },
    });
  } catch (err) {
    console.error("[payments.health.GET] ", err);
    return NextResponse.json(
      { ok: false, error: "PAYMENT_HEALTH_FAILED" },
      { status: 500 }
    );
  }
}
