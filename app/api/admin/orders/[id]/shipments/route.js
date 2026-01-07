// PATH: app/api/admin/orders/[id]/shipments/route.js
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

// "Book Shipment" policy (stub):
// - Ensure Courier & Service exist by code (auto-create placeholders if missing).
// - Create Shipment in LABEL_CREATED status.
// - Add OrderEvent.
// - No fulfillment status change here (that should happen on pickup/scan confirmation).
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

  let body = {};
  try {
    body = await req.json();
  } catch {}
  const courierCode = String(body?.courierCode || "").trim();
  const serviceCode = String(body?.serviceCode || "").trim();
  if (!courierCode || !serviceCode) {
    return json(
      { ok: false, error: "courierCode and serviceCode required" },
      400
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) return json({ ok: false, error: "Not found" }, 404);

  const shipment = await prisma.$transaction(async (tx) => {
    let courier = await tx.courier.findUnique({ where: { code: courierCode } });
    if (!courier) {
      courier = await tx.courier.create({
        data: { code: courierCode, name: courierCode.toUpperCase() },
      });
    }

    let service = await tx.courierService.findFirst({
      where: { courierId: courier.id, code: serviceCode },
    });
    if (!service) {
      service = await tx.courierService.create({
        data: {
          courierId: courier.id,
          code: serviceCode,
          name: serviceCode.toUpperCase(),
          baseFee: 0,
          isActive: true,
        },
      });
    }

    // TODO: integrate real courier API and set trackingNumber/labelUrl
    const shp = await tx.shipment.create({
      data: {
        orderId,
        courierId: courier.id,
        courierServiceId: service.id,
        status: "LABEL_CREATED",
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        kind: "SHIPMENT_BOOKED",
        message: `Shipment created with ${courier.code}/${service.code} → LABEL_CREATED`,
        metadata: { courierCode, serviceCode, shipmentId: shp.id },
        actorId,
        actorRole: "admin",
      },
    });

    return shp;
  });

  return json({ ok: true, shipment }, 200);
}
