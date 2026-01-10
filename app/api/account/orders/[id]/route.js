// PATH: app/api/admin/orders/[id]/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isAdmin(roles) {
  const arr = Array.isArray(roles) ? roles : roles ? [roles] : [];
  const set = new Set(arr.map((r) => String(r || "").toLowerCase()));
  return set.has("admin") || set.has("superadmin");
}

export async function GET(req, { params }) {
  try {
    const session = await auth();
    const roles = session?.user?.roles ?? session?.user?.role ?? null;
    if (!isAdmin(roles)) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const id = String(params?.id || "").trim();
    if (!id) return json({ ok: false, error: "ID_REQUIRED" }, 400);

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        shippingAddress: true,
        billingAddress: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        events: prisma.orderEvent ? { orderBy: { createdAt: "asc" } } : false,
      },
    });

    if (!order) return json({ ok: false, error: "NOT_FOUND" }, 404);

    // If events relation is false, Prisma ignores it, but to be extra safe:
    if (!prisma.orderEvent) {
      // remove potential unsupported include effect
      delete order.events;
    }

    return json({ ok: true, order }, 200);
  } catch (err) {
    console.error("[api/admin/orders/[id] GET] ", err);
    return json({ ok: false, error: "FAILED" }, 500);
  }
}

export async function PATCH(req, { params }) {
  try {
    const session = await auth();
    const roles = session?.user?.roles ?? session?.user?.role ?? null;
    if (!isAdmin(roles)) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const id = String(params?.id || "").trim();
    if (!id) return json({ ok: false, error: "ID_REQUIRED" }, 400);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").toLowerCase();

    const order = await prisma.order.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!order) return json({ ok: false, error: "NOT_FOUND" }, 404);

    let data = {};
    let eventKind = "";
    let eventMessage = "";

    const current = String(order.status || "").toUpperCase();

    if (action === "place") {
      if (current !== "DRAFT") {
        return json({ ok: false, error: "INVALID_TRANSITION" }, 400);
      }
      data.status = "PLACED";
      eventKind = "ORDER_PLACED_ADMIN";
      eventMessage = "Order moved from DRAFT to PLACED by admin.";
    } else if (action === "confirm") {
      if (current !== "PLACED") {
        return json({ ok: false, error: "INVALID_TRANSITION" }, 400);
      }
      data.status = "CONFIRMED";
      eventKind = "ORDER_CONFIRMED";
      eventMessage = "Order confirmed by admin.";
    } else if (action === "complete") {
      if (current !== "PLACED" && current !== "CONFIRMED") {
        return json({ ok: false, error: "INVALID_TRANSITION" }, 400);
      }
      data.status = "COMPLETED";
      data.fulfillmentStatus = "FULFILLED";

      // If payments show at least one PAID-like, mark as PAID
      const PAIDLIKE = new Set([
        "PAID",
        "SETTLED",
        "SUCCEEDED",
        "CAPTURED",
        "AUTHORIZED",
      ]);
      const hasPaid = (order.payments || []).some((p) =>
        PAIDLIKE.has(String(p.status || "").toUpperCase())
      );
      if (hasPaid) data.paymentStatus = "PAID";

      eventKind = "ORDER_COMPLETED";
      eventMessage = "Order marked completed by admin.";
    } else if (action === "cancel") {
      if (current === "COMPLETED" || current === "CANCELLED" || current === "ARCHIVED") {
        return json({ ok: false, error: "INVALID_TRANSITION" }, 400);
      }
      data.status = "CANCELLED";
      data.fulfillmentStatus = "CANCELLED";
      eventKind = "ORDER_CANCELLED";
      eventMessage = "Order cancelled by admin.";
    } else if (action === "archive") {
      data.status = "ARCHIVED";
      eventKind = "ORDER_ARCHIVED";
      eventMessage = "Order archived by admin.";
    } else {
      return json({ ok: false, error: "UNKNOWN_ACTION" }, 400);
    }

    const updated = await prisma.order.update({
      where: { id },
      data,
    });

    if (prisma.orderEvent?.create) {
      await prisma.orderEvent.create({
        data: {
          orderId: id,
          kind: eventKind || "ADMIN_ACTION",
          message: eventMessage || `Admin performed action: ${action}`,
          metadata: { action },
        },
      });
    }

    return json({ ok: true, order: updated }, 200);
  } catch (err) {
    console.error("[api/admin/orders/[id] PATCH] ", err);
    return json({ ok: false, error: "FAILED" }, 500);
  }
}
