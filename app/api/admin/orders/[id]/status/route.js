// FILE: app/api/admin/orders/[id]/status/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminIndependent } from "@/lib/admin/requireAdminIndependent";
import { Permissions } from "@/lib/rbac";

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

async function unwrapParams(params) {
  try {
    if (params && typeof params.then === "function") return (await params) || {};
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

export async function POST(req, { params }) {
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
  } catch {}
  const to = String(payload?.to || "").toUpperCase().trim();
  if (!to) return json({ ok: false, error: "Target status (to) required" }, 400);

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, fulfillmentStatus: true },
  });
  if (!order) return json({ ok: false, error: "Not found" }, 404);

  const allowed = VALID_TRANSITIONS[order.status] || [];
  if (!allowed.includes(to)) {
    return json(
      { ok: false, error: `Invalid transition from ${order.status} -> ${to}` },
      400
    );
  }

  const actorId = admin.user?.id || admin.userId || null;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: to } });

    if (to === "COMPLETED") {
      const fresh = await tx.order.findUnique({
        where: { id },
        select: { fulfillmentStatus: true },
      });
      if (
        fresh &&
        (fresh.fulfillmentStatus === "UNFULFILLED" ||
          fresh.fulfillmentStatus === "PARTIAL")
      ) {
        await tx.order.update({
          where: { id },
          data: { fulfillmentStatus: "FULFILLED" },
        });
        await tx.orderEvent.create({
          data: {
            orderId: id,
            kind: "FULFILLMENT_STATUS",
            message: "fulfillmentStatus → FULFILLED",
            actorId,
            actorRole: "admin",
          },
        });
      }
    }

    await tx.orderEvent.create({
      data: {
        orderId: id,
        kind: "STATUS_CHANGED",
        message: `${order.status} → ${to}`,
        metadata: { from: order.status, to },
        actorId,
        actorRole: "admin",
      },
    });

    return tx.order.findUnique({
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
  });

  return json({ ok: true, order: updated }, 200);
}
