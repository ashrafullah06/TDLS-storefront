// FILE: app/api/admin/orders/[id]/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminIndependent } from "@/lib/admin/requireAdminIndependent";
import { Permissions } from "@/lib/rbac";

/* ---------------- helpers ---------------- */

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "cookie",
    },
  });
}

class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}

function getActorRole(admin) {
  return (
    admin?.user?.role ||
    admin?.role ||
    admin?.user?.roleName ||
    admin?.roleName ||
    "admin"
  );
}

async function unwrapParams(params) {
  try {
    if (params && typeof params.then === "function") {
      const resolved = await params;
      return resolved || {};
    }
  } catch {}
  return params || {};
}

const VALID_TRANSITIONS = {
  DRAFT: ["PLACED", "CANCELLED"],
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  ARCHIVED: [],
};

async function loadOrderFull(id) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      shippingAddress: true,
      billingAddress: true,
      items: true,
      payments: true,
      events: true,
    },
  });
}

/* ---------------- GET ---------------- */
export async function GET(req, { params }) {
  try {
    await requireAdminIndependent(req, { permission: Permissions.VIEW_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  const p = await unwrapParams(params);
  const id = String(p?.id || "").trim();
  if (!id) return json({ ok: false, error: "Order id required" }, 400);

  const order = await loadOrderFull(id);
  if (!order) return json({ ok: false, error: "Not found" }, 404);

  return json({ ok: true, order }, 200);
}

/* ---------------- PATCH ---------------- */
export async function PATCH(req, { params }) {
  let admin;
  try {
    admin = await requireAdminIndependent(req, {
      permission: Permissions.MANAGE_ORDERS,
    });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  const p = await unwrapParams(params);
  const id = String(p?.id || "").trim();
  if (!id) return json({ ok: false, error: "Order id required" }, 400);

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const action = String(payload?.action || "").toLowerCase().trim();
  const idemKey =
    req.headers.get("x-idempotency-key") ||
    req.headers.get("idempotency-key") ||
    null;

  let targetStatus = null;
  if (action === "place") targetStatus = "PLACED";
  else if (action === "confirm") targetStatus = "CONFIRMED";
  else if (action === "complete") targetStatus = "COMPLETED";
  else if (action === "cancel") targetStatus = "CANCELLED";
  else return json({ ok: false, error: "Unknown action" }, 400);

  const actorId = admin.user?.id || admin.userId || null;
  const actorRole = getActorRole(admin);

  let outcome = {
    idempotent: false,
    updated: false,
    fulfillmentAutoUpdated: false,
    fromStatus: null,
    toStatus: targetStatus,
  };

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          fulfillmentStatus: true,
          paymentStatus: true,
        },
      });

      if (!current) throw new ApiError(404, "Not found");

      if (current.status === targetStatus) {
        outcome.idempotent = true;
        outcome.updated = false;
        outcome.fromStatus = current.status;
        return;
      }

      const allowed = VALID_TRANSITIONS[current.status] || [];
      if (!allowed.includes(targetStatus)) {
        throw new ApiError(
          400,
          `Invalid transition from ${current.status} -> ${targetStatus}`
        );
      }

      await tx.order.update({
        where: { id },
        data: { status: targetStatus },
      });

      outcome.updated = true;
      outcome.fromStatus = current.status;

      if (targetStatus === "COMPLETED") {
        const upd = await tx.order.updateMany({
          where: {
            id,
            fulfillmentStatus: { in: ["UNFULFILLED", "PARTIAL"] },
          },
          data: { fulfillmentStatus: "FULFILLED" },
        });

        if (upd?.count === 1) {
          outcome.fulfillmentAutoUpdated = true;

          await tx.orderEvent.create({
            data: {
              orderId: id,
              kind: "FULFILLMENT_STATUS",
              message: "fulfillmentStatus → FULFILLED",
              actorId,
              actorRole,
            },
          });
        }
      }

      await tx.orderEvent.create({
        data: {
          orderId: id,
          kind: "STATUS_CHANGED",
          message: `${current.status} → ${targetStatus}`,
          metadata: {
            action,
            idempotencyKey: idemKey || undefined,
          },
          actorId,
          actorRole,
        },
      });
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return json(
        { ok: false, error: err.message, ...(err.extra || {}) },
        err.status
      );
    }
    return json({ ok: false, error: "Failed to update order" }, 500);
  }

  const updated = await loadOrderFull(id);
  if (!updated) return json({ ok: false, error: "Not found" }, 404);

  return json(
    {
      ok: true,
      order: updated,
      idempotent: outcome.idempotent,
      updated: outcome.updated,
      fulfillmentAutoUpdated: outcome.fulfillmentAutoUpdated,
    },
    200
  );
}
