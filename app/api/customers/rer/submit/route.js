export const dynamic = 'force-dynamic';

import prisma from '../../../../../lib/prisma';
import { NextResponse } from 'next/server';

async function readText(fd, key) {
  const v = fd.get(key);
  if (!v) return null;
  return typeof v === 'string' ? v : await v.text();
}

export async function POST(req) {
  const fd = await req.formData();

  // accept both user_id and userId to match various clients
  const userId = (await readText(fd, 'user_id')) || (await readText(fd, 'userId'));
  const orderNoStr = await readText(fd, 'order_no') || await readText(fd, 'orderNo');
  const sku = await readText(fd, 'sku');
  const barcode = await readText(fd, 'barcode');
  const reason = await readText(fd, 'reason');
  const notes = await readText(fd, 'description');
  const actionType = (await readText(fd, 'action_type')) || await readText(fd, 'actionType') || 'return';
  const qtyStr = await readText(fd, 'quantity');
  const restockStr = await readText(fd, 'restocking_fee') || '0';
  const toVariantId = await readText(fd, 'to_variant_id');

  if (!orderNoStr) return NextResponse.json({ error: 'order_no required' }, { status: 400 });
  const orderNo = Number(orderNoStr);

  const order = await prisma.order.findFirst({
    where: { orderNumber: orderNo },
    include: { items: { include: { variant: true } }, payments: true },
  });
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 });

  const target =
    order.items.find((it) => (sku && it.sku === sku) || (barcode && it.variant?.barcode === barcode)) ||
    order.items[0];
  if (!target) return NextResponse.json({ error: 'order line not found' }, { status: 404 });

  const qty = Math.max(1, Math.min(Number(qtyStr || '1'), target.quantity));
  const restock = Number(restockStr || '0');

  // EXCHANGE
  if (actionType === 'exchange') {
    if (!toVariantId) return NextResponse.json({ error: 'to_variant_id required' }, { status: 400 });

    const ex = await prisma.exchangeRequest.create({
      data: {
        orderId: order.id,
        userId: userId || null,
        status: 'requested',
        reason: reason || null,
        notes: notes || null,
        lines: {
          create: [{ fromOrderItemId: target.id, toVariantId, quantity: qty }],
        },
      },
      include: { lines: true },
    });

    await prisma.notification.create({
      data: {
        userId: order.userId || userId,
        orderId: order.id,
        channel: 'IN_APP',
        type: 'EXCHANGE_REQUESTED',
        title: 'exchange requested',
        body: `order #${order.orderNumber} — sku ${target.sku} → ${toVariantId} x${qty}`,
      },
    });

    return NextResponse.json({ success: true, applicationId: ex.id });
  }

  // RETURN / REFUND
  const unit = Number(target.unitPrice);
  const lineRefund = Math.max(0, unit * qty - restock);

  const rr = await prisma.returnRequest.create({
    data: {
      orderId: order.id,
      userId: userId || null,
      status: 'requested',
      reason: reason || null,
      notes: notes || null,
      totalRefund: lineRefund,
      lines: {
        create: [
          {
            orderItemId: target.id,
            quantity: qty,
            lineRefund: lineRefund,
            reason: reason || null,
            conditionNotes: notes || null,
          },
        ],
      },
    },
    include: { lines: true },
  });

  await prisma.notification.create({
    data: {
      userId: order.userId || userId,
      orderId: order.id,
      channel: 'IN_APP',
      type: 'RETURN_REQUESTED',
      title: 'return requested',
      body: `order #${order.orderNumber} — sku ${target.sku} x${qty}, refund ${lineRefund}`,
    },
  });

  return NextResponse.json({ success: true, applicationId: rr.id, refund: lineRefund });
}
