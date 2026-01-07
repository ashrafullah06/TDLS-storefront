// app/api/payments/nagad/create/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/payments/nagad/create
 * Body: { orderId }
 * Returns a redirect URL to continue Nagad payment (placeholder unless wired).
 */
function j(err, status = 400) {
  return NextResponse.json(err, { status });
}

export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    const configured =
      !!process.env.NAGAD_MERCHANT_ID &&
      !!process.env.NAGAD_MERCHANT_PRIVATE_KEY &&
      !!process.env.NAGAD_MERCHANT_PUBLIC_KEY;

    if (!configured) {
      return j({ ok: false, error: "NAGAD_NOT_CONFIGURED" }, 503);
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

    // TODO: integrate real Nagad session
    const redirectUrl = `/payments/nagad/redirect?orderId=${encodeURIComponent(
      order.id
    )}`;
    return NextResponse.json({ ok: true, mode: "redirect", url: redirectUrl });
  } catch (err) {
    console.error("[nagad.create.POST] ", err);
    const status = err?.status || 500;
    return j({ ok: false, error: "NAGAD_CREATE_FAILED" }, status);
  }
}
