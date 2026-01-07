// app/api/orders/[id]/confirm/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/** tiny helper */
function j(body, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/orders/:id/confirm
 * Idempotently confirms an order (e.g., post-OTP for COD, or after gateway success).
 * Returns { ok, orderId, status, paymentStatus }.
 */
export async function POST(req, { params }) {
  try {
    const { userId } = await requireAuth(req);

    const id = String(params?.id || "").trim();
    if (!id) return j({ ok: false, error: "ORDER_ID_REQUIRED" }, 422);

    // Load minimal but enough to reason about ownership & payment state
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        payments: {
          select: { id: true, provider: true, status: true, amount: true, currency: true },
        },
      },
    });

    if (!order || order.userId !== userId) {
      return j({ ok: false, error: "ORDER_NOT_FOUND" }, 404);
    }

    // Idempotency: if already confirmed, just echo current state
    if (order.status === "CONFIRMED") {
      return j({
        ok: true,
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
      });
    }

    // Derive the desired paymentStatus transition safely:
    // - If any payment is already "SUCCEEDED"/"PAID", lock order to PAID.
    // - Otherwise keep existing paymentStatus (often PENDING for COD).
    const hasPaid =
      Array.isArray(order.payments) &&
      order.payments.some((p) =>
        ["SUCCEEDED", "PAID", "CAPTURED"].includes(String(p.status || "").toUpperCase())
      );

    const nextPaymentStatus = hasPaid ? "PAID" : order.paymentStatus || "PENDING";

    const updated = await prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "CONFIRMED",
          paymentStatus: nextPaymentStatus,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: o.id,
          kind: "ORDER_CONFIRMED",
          message: "Order confirmed by user action",
        },
      });

      return o;
    });

    return j({
      ok: true,
      orderId: updated.id,
      status: updated.status,
      paymentStatus: updated.paymentStatus,
    });
  } catch (err) {
    console.error("[orders.confirm.POST] ", err);
    return j({ ok: false, error: "ORDER_CONFIRM_FAILED" }, 500);
  }
}
