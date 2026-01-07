// app/api/payments/sslcommerz/initialize/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/payments/sslcommerz/initialize
 * Body: { orderId }
 * Returns a redirect URL to continue payment (placeholder unless you wire SSLCommerz SDK).
 */
function j(err, status = 400) {
  return NextResponse.json(err, { status });
}

export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    if (!process.env.SSLCZ_STORE_ID || !process.env.SSLCZ_STORE_PASSWD) {
      return j({ ok: false, error: "SSL_NOT_CONFIGURED" }, 503);
    }

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return j({ ok: false, error: "ORDER_ID_REQUIRED" });

    const order = await prisma.order.findUnique({
      where: { id: String(orderId) },
      include: { payments: true },
    });
    if (!order || order.userId !== userId) {
      return j({ ok: false, error: "ORDER_NOT_FOUND" }, 404);
    }

    // TODO: integrate SSLCommerz session creation
    const redirectUrl = `/payments/sslcommerz/redirect?orderId=${encodeURIComponent(
      order.id
    )}`;
    return NextResponse.json({ ok: true, mode: "redirect", url: redirectUrl });
  } catch (err) {
    console.error("[sslcommerz.initialize.POST] ", err);
    const status = err?.status || 500;
    return j({ ok: false, error: "SSL_INIT_FAILED" }, status);
  }
}
