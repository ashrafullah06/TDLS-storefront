export const dynamic = 'force-dynamic';

import prisma from '../../../../../lib/prisma';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });

  const rr = await prisma.returnRequest.findUnique({
    where: { id },
    include: { lines: true, order: true },
  });
  if (rr) {
    return new Response(
      JSON.stringify({
        kind: 'return',
        id: rr.id,
        status: rr.status,
        order_no: rr.order?.orderNumber || null,
        lines: rr.lines.map((l) => ({
          order_item_id: l.orderItemId,
          qty: l.quantity,
          refund: l.lineRefund,
        })),
      }),
      { status: 200 }
    );
  }

  const ex = await prisma.exchangeRequest.findUnique({
    where: { id },
    include: { lines: true, order: true },
  });
  if (ex) {
    return new Response(
      JSON.stringify({
        kind: 'exchange',
        id: ex.id,
        status: ex.status,
        order_no: ex.order?.orderNumber || null,
        lines: ex.lines.map((l) => ({
          from: l.fromOrderItemId,
          to_variant_id: l.toVariantId,
          qty: l.quantity,
        })),
      }),
      { status: 200 }
    );
  }

  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
}
