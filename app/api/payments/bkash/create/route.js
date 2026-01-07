// app/api/payments/bkash/create/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/payments/bkash/create
 * Body: { orderId }
 * Returns a redirect URL to continue bKash payment (placeholder unless wired).
 */
function j(err, status = 400) {
  return NextResponse.json(err, { status });
}

export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    const configured =
      !!process.env.BKASH_APP_KEY &&
      !!process.env.BKASH_APP_SECRET &&
      !!process.env.BKASH_USERNAME &&
      !!process.env.BKASH_PASSWORD;

    if (!configured) {
      return j({ ok: false, error: "BKASH_NOT_CONFIGURED" }, 503);
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

    // TODO: integrate real bKash session
    const redirectUrl = `/payments/bkash/redirect?orderId=${encodeURIComponent(
      order.id
    )}`;
    return NextResponse.json({ ok: true, mode: "redirect", url: redirectUrl });
  } catch (err) {
    console.error("[bkash.create.POST] ", err);
    const status = err?.status || 500;
    return j({ ok: false, error: "BKASH_CREATE_FAILED" }, status);
  }
}
