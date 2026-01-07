// PATH: app/api/admin/rer/returns/[id]/route.js
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
  const code = err?.code || err?.meta?.cause || null;
  const message = err?.message ? String(err.message).slice(0, 600) : "Unknown error";
  return { code, message };
}

const RETURN_TRANSITIONS = {
  approve: { from: ["REQUESTED"], to: "APPROVED" },
  deny: { from: ["REQUESTED"], to: "DENIED" },
  received: { from: ["APPROVED"], to: "RECEIVED" },
  refunded: { from: ["RECEIVED", "APPROVED"], to: "REFUNDED" },
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

    const item = await prisma.returnRequest.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        status: true,
        reason: true,
        // Prisma schema uses `notes` (plural). We also return `note` for backward compatibility.
        notes: true,
        createdAt: true,
        updatedAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            invoiceNo: true,
            status: true,
            fulfillmentStatus: true,
            paymentStatus: true,
            deliveredAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!item) return json({ ok: false, error: "NOT_FOUND" }, 404);

    return json({ ok: true, item: { ...item, note: item?.notes ?? null } }, 200);
  } catch (err) {
    const { code, message } = prismaErrShape(err);
    return json(
      { ok: false, error: "SERVER_ERROR", code: code || "HTTP_500", detail: message },
      500
    );
  }
}

/**
 * PATCH /api/admin/rer/returns/:id
 * Body: { action: "approve"|"deny"|"received"|"refunded" }
 * Double-click safe:
 * - If already in target status, returns ok without duplicating events.
 * - If status doesn't allow transition, returns 409 with current status.
 */
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

  const actorId = admin.user?.id || admin.userId;

  try {
    const id = str(params?.id);
    const body = await req.json().catch(() => ({}));
    const action = str(body?.action).toLowerCase();

    const rule = RETURN_TRANSITIONS[action];
    if (!rule) return json({ ok: false, error: "BAD_ACTION" }, 400);

    const existing = await prisma.returnRequest.findUnique({
      where: { id },
      select: { id: true, status: true, orderId: true },
    });
    if (!existing) return json({ ok: false, error: "NOT_FOUND" }, 404);

    // Double-click safe: already at target status
    if (existing.status === rule.to) {
      return json({ ok: true, item: existing, deduped: true }, 200);
    }

    // Invalid transition
    if (!rule.from.includes(existing.status)) {
      return json(
        { ok: false, error: "INVALID_TRANSITION", status: existing.status },
        409
      );
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.returnRequest.update({
        where: { id },
        data: { status: rule.to },
        select: {
          id: true,
          orderId: true,
          status: true,
          reason: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: existing.orderId,
          kind: "RER_RETURN_STATUS",
          message: `RER_RETURN_STATUS:${rule.to}`,
          metadata: { returnId: id, status: rule.to, action },
          actorId: actorId || null,
          actorRole: "admin",
        },
      });

      return updated;
    });

    return json({ ok: true, item: { ...item, note: item?.notes ?? null } }, 200);
  } catch (err) {
    const { code, message } = prismaErrShape(err);
    return json(
      { ok: false, error: "SERVER_ERROR", code: code || "HTTP_500", detail: message },
      500
    );
  }
}
