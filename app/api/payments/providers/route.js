export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentProvider, PaymentStatus } from "@prisma/client";

/**
 * Human-readable labels per provider
 */
const LABELS = {
  [PaymentProvider.STRIPE]: "Stripe (Card)",
  [PaymentProvider.SSL_COMMERZ]: "SSLCommerz",
  [PaymentProvider.BKASH]: "bKash",
  [PaymentProvider.NAGAD]: "Nagad",
  [PaymentProvider.CASH_ON_DELIVERY]: "Cash on Delivery",
  [PaymentProvider.MANUAL]: "Manual Adjustment",
};

/**
 * Env keys that indicate a provider is configured.
 * (These can be adjusted to match your real env variable names.)
 */
const ENV_KEYS = {
  [PaymentProvider.STRIPE]: "STRIPE_SECRET_KEY",
  [PaymentProvider.SSL_COMMERZ]: "SSL_COMMERZ_STORE_ID",
  [PaymentProvider.BKASH]: "BKASH_API_USERNAME",
  [PaymentProvider.NAGAD]: "NAGAD_MERCHANT_ID",
  [PaymentProvider.CASH_ON_DELIVERY]: null,
  [PaymentProvider.MANUAL]: null,
};

export async function GET() {
  try {
    // 1) Providers that have fee configs
    const feeProviders = await prisma.gatewayFeeRate.groupBy({
      by: ["provider"],
      _max: { effectiveFrom: true },
    });

    // 2) Unsettled amounts per provider: payments with no payoutBatchId
    const unsettled = await prisma.payment.groupBy({
      by: ["provider"],
      where: {
        payoutBatchId: null,
        status: {
          in: [
            PaymentStatus.PAID,
            PaymentStatus.CAPTURED,
            PaymentStatus.SUCCEEDED,
            PaymentStatus.SETTLED,
          ],
        },
      },
      _sum: { amount: true },
    });

    const feeProviderSet = new Set(feeProviders.map((r) => r.provider));
    const unsettledMap = new Map(
      unsettled.map((r) => [r.provider, Number(r._sum.amount || 0)])
    );

    const providers = Object.values(PaymentProvider).map((code) => {
      const envKey = ENV_KEYS[code];
      const hasEnv = envKey ? !!process.env[envKey] : true;
      const hasFee = feeProviderSet.has(code);

      const enabled =
        hasEnv ||
        hasFee ||
        code === PaymentProvider.CASH_ON_DELIVERY ||
        code === PaymentProvider.MANUAL;

      return {
        code,
        label: LABELS[code] || code,
        enabled,
        mode: process.env.NODE_ENV === "production" ? "live" : "test",
        unsettledAmount: unsettledMap.get(code) || 0,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        providers,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "PAYMENT_PROVIDERS_UNAVAILABLE",
        detail: String(e),
      },
      { status: 503 }
    );
  }
}
