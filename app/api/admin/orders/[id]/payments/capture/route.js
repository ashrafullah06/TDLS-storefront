// PATH: app/api/admin/orders/[id]/payments/capture/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Statuses that are fully “paid/settled” (used for summing paid amounts)
const PAID_SUM_STATUSES = new Set(["PAID", "SETTLED", "CAPTURED", "SUCCEEDED"]);

// Non-paidlike statuses (candidates to capture)
const NOT_YET_CAPTURED = new Set([
  "UNPAID",
  "PENDING",
  "AUTHORIZED",
  "INITIATED",
  "FAILED",
  "CANCELED",
]);

export async function POST(req, { params }) {
  let admin;
  try {
    admin = await requireAdmin(req, {
      permission: Permissions.MANAGE_ORDERS,
    });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  const actorId = admin.user?.id || admin.userId;

  const orderId = String(params?.id || "");
  if (!orderId) return json({ ok: false, error: "Order id required" }, 400);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true },
  });
  if (!order) return json({ ok: false, error: "Not found" }, 404);

  const payments = order.payments || [];

  // Pick a sensible target to capture: AUTHORIZED > PENDING/INITIATED > any not-yet-captured
  const candidates = payments.filter((p) =>
    NOT_YET_CAPTURED.has(String(p.status || ""))
  );
  const target =
    candidates.find((p) => p.status === "AUTHORIZED") ||
    candidates.find((p) => p.status === "PENDING" || p.status === "INITIATED") ||
    candidates[0];

  if (!target) {
    return json({ ok: false, error: "No capturable payment found" }, 400);
  }

  // Gateways -> CAPTURED; COD/MANUAL -> PAID
  const isCodOrManual =
    target.provider === "CASH_ON_DELIVERY" || target.provider === "MANUAL";
  const newStatus = isCodOrManual ? "PAID" : "CAPTURED";

  await prisma.$transaction(async (tx) => {
    // TODO: integrate real gateway capture flow here (SSLCommerz/bKash/Nagad/Stripe)
    await tx.payment.update({
      where: { id: target.id },
      data: { status: newStatus, message: "Admin capture" },
    });

    await tx.paymentEvent.create({
      data: {
        paymentId: target.id,
        type: "CAPTURED",
        payload: { by: "admin", userId: actorId },
      },
    });

    // Recompute order.paymentStatus from “settled” payments only
    const fresh = await tx.payment.findMany({ where: { orderId } });
    const paidSum = fresh.reduce((sum, p) => {
      return PAID_SUM_STATUSES.has(String(p.status || ""))
        ? sum + Number(p.amount || 0)
        : sum;
    }, 0);
    const grand = Number(order.grandTotal || 0);

    const nextPaymentStatus =
      grand > 0 && paidSum >= grand ? "PAID" : "PENDING";

    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: nextPaymentStatus },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        kind: "PAYMENT_CAPTURED",
        message: `Payment ${target.id} → ${newStatus}`,
        metadata: { provider: target.provider },
        actorId,
        actorRole: "admin",
      },
    });
  });

  return json({ ok: true }, 200);
}
