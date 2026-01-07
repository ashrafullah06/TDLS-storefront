// PATH: app/api/admin/rer/refunds/[id]/route.js
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function str(v) {
  return String(v ?? "").trim();
}

function prismaErrShape(err) {
  const code = err?.code || err?.name || err?.meta?.cause || null;
  const message = err?.message ? String(err.message).slice(0, 600) : "Unknown error";
  return { code, message };
}

function shapeRefund(row) {
  const payload = row?.payload ?? null;
  const note =
    payload && typeof payload === "object" && payload !== null
      ? (payload.note ?? null)
      : null;

  // Refund schema has no updatedAt in your prisma (it has createdAt only).
  // We provide updatedAt as createdAt for backward compatibility in clients.
  return {
    ...row,
    note,
    updatedAt: row?.createdAt ?? null,
  };
}

const REFUND_TRANSITIONS = {
  process: { from: ["INITIATED"], to: "PROCESSED" },
  fail: { from: ["INITIATED"], to: "FAILED" },
};

export async function GET(req, { params }) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  try {
    const id = str(params?.id);

    const item = await prisma.refund.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        paymentId: true,
        returnId: true,
        amount: true,
        currency: true,
        reason: true,
        status: true,
        gatewayRef: true,
        payload: true,
        createdAt: true,
        order: { select: { orderNumber: true, invoiceNo: true } },
      },
    });

    if (!item) return json({ ok: false, error: "NOT_FOUND" }, 404);
    return json({ ok: true, item: shapeRefund(item) }, 200);
  } catch (err) {
    const { code, message } = prismaErrShape(err);
    return json(
      { ok: false, error: "SERVER_ERROR", code: code || "HTTP_500", detail: message },
      500
    );
  }
}

export async function PATCH(req, { params }) {
  let admin;
  try {
    admin = await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }
  const actorId = admin.user?.id || admin.userId || null;

  try {
    const id = str(params?.id);
    const body = await req.json().catch(() => ({}));
    const action = str(body?.action).toLowerCase();

    const rule = REFUND_TRANSITIONS[action];
    if (!rule) return json({ ok: false, error: "BAD_ACTION" }, 400);

    const existing = await prisma.refund.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        orderId: true,
        amount: true,
        currency: true,
      },
    });
    if (!existing) return json({ ok: false, error: "NOT_FOUND" }, 404);

    if (existing.status === rule.to) {
      return json({ ok: true, item: existing, deduped: true }, 200);
    }
    if (!rule.from.includes(existing.status)) {
      return json(
        { ok: false, error: "INVALID_TRANSITION", status: existing.status },
        409
      );
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.refund.update({
        where: { id },
        data: { status: rule.to },
        select: {
          id: true,
          orderId: true,
          paymentId: true,
          returnId: true,
          amount: true,
          currency: true,
          reason: true,
          status: true,
          gatewayRef: true,
          payload: true,
          createdAt: true,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: existing.orderId,
          kind: "RER_REFUND_STATUS",
          message: `RER_REFUND_STATUS:${rule.to}`,
          metadata: {
            refundId: id,
            status: rule.to,
            action,
            amount: existing.amount,
            currency: existing.currency,
          },
          actorId: actorId,
          actorRole: "admin",
        },
      });

      return updated;
    });

    return json({ ok: true, item: shapeRefund(item) }, 200);
  } catch (err) {
    const { code, message } = prismaErrShape(err);
    return json(
      { ok: false, error: "SERVER_ERROR", code: code || "HTTP_500", detail: message },
      500
    );
  }
}
