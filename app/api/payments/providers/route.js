//app/api/payments/providers/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * IMPORTANT:
 * - Keep STRIPE in the provider list for compatibility with other Stripe-related files.
 * - Force STRIPE to be DISABLED always.
 * - Avoid importing enums from "@prisma/client" to prevent Vercel build-time crashes.
 */

/** Providers we want to show by default (STRIPE included but will be disabled) */
const DEFAULT_PROVIDERS = [
  "STRIPE",
  "SSL_COMMERZ",
  "BKASH",
  "NAGAD",
  "CASH_ON_DELIVERY",
  "MANUAL",
];

/** Human-readable labels per provider code */
const LABELS = {
  STRIPE: "Stripe (Disabled)",
  SSL_COMMERZ: "SSLCommerz",
  BKASH: "bKash",
  NAGAD: "Nagad",
  CASH_ON_DELIVERY: "Cash on Delivery",
  MANUAL: "Manual Adjustment",
};

/**
 * Env keys that indicate a provider is configured.
 * STRIPE intentionally has no env key because it's forced disabled.
 */
const ENV_KEYS = {
  STRIPE: null,
  SSL_COMMERZ: "SSL_COMMERZ_STORE_ID",
  BKASH: "BKASH_API_USERNAME",
  NAGAD: "NAGAD_MERCHANT_ID",
  CASH_ON_DELIVERY: null,
  MANUAL: null,
};

/** Payment statuses that count toward unsettled amounts (string-based, no enums) */
const SETTLED_LIKE_STATUSES = ["PAID", "CAPTURED", "SUCCEEDED", "SETTLED"];

/** Force-disable codes (keep list extensible) */
const FORCE_DISABLED = new Set(["STRIPE"]);

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
        status: { in: SETTLED_LIKE_STATUSES },
      },
      _sum: { amount: true },
    });

    const feeProviderSet = new Set(feeProviders.map((r) => r.provider));
    const unsettledMap = new Map(
      unsettled.map((r) => [r.provider, Number(r._sum.amount || 0)])
    );

    // Merge default list with any providers found in DB (keeps future-proof)
    const allCodesSet = new Set(DEFAULT_PROVIDERS);
    for (const r of feeProviders) allCodesSet.add(r.provider);
    for (const r of unsettled) allCodesSet.add(r.provider);

    const providers = Array.from(allCodesSet).map((code) => {
      const envKey = Object.prototype.hasOwnProperty.call(ENV_KEYS, code)
        ? ENV_KEYS[code]
        : null;

      const hasEnv = envKey ? !!process.env[envKey] : true;
      const hasFee = feeProviderSet.has(code);

      // Forced-disable takes priority over everything
      const enabled = FORCE_DISABLED.has(code)
        ? false
        : hasEnv ||
          hasFee ||
          code === "CASH_ON_DELIVERY" ||
          code === "MANUAL";

      return {
        code,
        label: LABELS[code] || code,
        enabled,
        mode: process.env.NODE_ENV === "production" ? "live" : "test",
        unsettledAmount: unsettledMap.get(code) || 0,
      };
    });

    return NextResponse.json(
      { ok: true, providers },
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
