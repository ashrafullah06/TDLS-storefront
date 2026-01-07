// app/api/returns/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";

import { requireAuth } from "@/lib/auth";

/**
 * Single endpoint for both "return" and "exchange" (UI combined).
 * Body:
 * {
 *   action: "return" | "exchange",
 *   orderId: "string",
 *   reason?: "string",
 *   notes?: "string",
 *   lines: [{ orderItemId, quantity, toVariantId? }]
 * }
 */
export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { action, orderId, reason, notes, lines = [] } = body || {};

    if (!orderId || !Array.isArray(lines) || lines.length === 0)
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order) return NextResponse.json({ ok: false, error: "order_not_found" }, { status: 404 });
    if (order.userId && order.userId !== userId)
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    if (action === "return") {
      const result = await prisma.$transaction(async (tx) => {
        const rr = await tx.returnRequest.create({
          data: { orderId, userId, status: "requested", reason: reason || null, notes: notes || null },
        });
        // compute refundable totals from order items:
        let totalRefund = 0;
        for (const l of lines) {
          const item = await tx.orderItem.findUnique({ where: { id: l.orderItemId } });
          if (!item) continue;
          const qty = Math.max(1, Math.min(l.quantity || 1, item.quantity));
          const unit = Number(item.total) / item.quantity;
          const lineRefund = Number((unit * qty).toFixed(2));
          totalRefund += lineRefund;
          await tx.returnLine.create({
            data: { returnId: rr.id, orderItemId: item.id, quantity: qty, lineRefund, reason: l.reason || null, conditionNotes: l.conditionNotes || null },
          });
        }
        const updated = await tx.returnRequest.update({ where: { id: rr.id }, data: { totalRefund } });
        return updated;
      });
      return NextResponse.json({ ok: true, type: "return", return_request: result });
    }

    if (action === "exchange") {
      const ex = await prisma.$transaction(async (tx) => {
        const er = await tx.exchangeRequest.create({
          data: { orderId, userId, status: "requested", reason: reason || null, notes: notes || null },
        });
        for (const l of lines) {
          if (!l.toVariantId) continue;
          const item = await tx.orderItem.findUnique({ where: { id: l.orderItemId } });
          if (!item) continue;
          const qty = Math.max(1, Math.min(l.quantity || 1, item.quantity));
          await tx.exchangeLine.create({
            data: { exchangeId: er.id, fromOrderItemId: item.id, toVariantId: l.toVariantId, quantity: qty, notes: l.notes || null },
          });
          // soft-reserve target inventory if available
          const inv = await tx.inventoryItem.findFirst({ where: { variantId: l.toVariantId }, orderBy: { onHand: "desc" } });
          if (inv) {
            await tx.stockReservation.create({
              data: { inventoryItemId: inv.id, orderItemId: item.id, quantity: qty, warehouseId: inv.warehouseId },
            });
          }
        }
        return er;
      });
      return NextResponse.json({ ok: true, type: "exchange", exchange_request: ex });
    }

    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
