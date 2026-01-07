// my-project/app/api/payments/checkout/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Very small dispatcher that checks availability and returns a redirectUrl
 * to your provider init endpoints (you can swap these to your existing handlers).
 *
 * Body: { provider: "BKASH" | "NAGAD" | "SSL" | "STRIPE", shippingAddressId, billingAddressId, returnUrl? }
 */
function j(err, status = 400) { return NextResponse.json(err, { status }); }

export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    const { provider, shippingAddressId, billingAddressId, returnUrl } = await req.json().catch(() => ({}));

    if (!provider) return j({ ok: false, error: "PROVIDER_REQUIRED" });
    if (!shippingAddressId || !billingAddressId) return j({ ok: false, error: "ADDRESS_REQUIRED" });

    // Check provider availability via public env (client mirrors this)
    const env = {
      STRIPE: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      SSL: !!process.env.NEXT_PUBLIC_SSLC_STORE_ID,
      BKASH: !!process.env.NEXT_PUBLIC_BKASH_APP_KEY,
      NAGAD: !!process.env.NEXT_PUBLIC_NAGAD_MERCHANT_ID,
    };
    if (provider === "STRIPE" && !env.STRIPE) return j({ ok: false, error: "STRIPE_NOT_CONFIGURED" }, 503);
    if (provider === "SSL"    && !env.SSL)    return j({ ok: false, error: "SSL_NOT_CONFIGURED" }, 503);
    if (provider === "BKASH"  && !env.BKASH)  return j({ ok: false, error: "BKASH_NOT_CONFIGURED" }, 503);
    if (provider === "NAGAD"  && !env.NAGAD)  return j({ ok: false, error: "NAGAD_NOT_CONFIGURED" }, 503);

    // Minimal cart sanity (prevents empty checkout)
    const cart = await prisma.cart.findFirst({ where: { userId, status: "ACTIVE" }, include: { items: true } });
    if (!cart || !(cart.items?.length)) return j({ ok: false, error: "EMPTY_CART" });

    // Redirect endpoints (replace with your existing ones if different)
    const redirectMap = {
      STRIPE: "/api/payments/stripe/intent",
      SSL: "/api/payments/sslcommerz/initialize",
      BKASH: "/api/payments/bkash/create",
      NAGAD: "/api/payments/nagad/create",
    };

    return NextResponse.json({
      ok: true,
      redirectUrl: redirectMap[provider],
      returnUrl: returnUrl || null,
    });
  } catch (err) {
    console.error("[payments.checkout] ", err);
    return j({ ok: false, error: "PAYMENT_INIT_FAILED" }, 500);
  }
}
