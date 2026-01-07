//app/api/customers/rer/lookup/route.js
export const dynamic = 'force-dynamic';

// RIGHT
import prisma from "@/lib/prisma";


export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const orderNo = searchParams.get('order_no');
  const invoiceNo = searchParams.get('invoice_no'); // supported if you later add it
  const productNo = searchParams.get('product_no');
  const sku = searchParams.get('sku');
  const barcode = searchParams.get('barcode');

  const or = [];
  if (sku || productNo) or.push({ sku: sku || productNo });
  if (barcode) or.push({ variant: { barcode } });

  // filter by order number if provided
  const where =
    or.length > 0
      ? { OR: or, ...(orderNo ? { order: { orderNumber: Number(orderNo) } } : {}) }
      : orderNo
      ? { order: { orderNumber: Number(orderNo) } }
      : {};

  const items = await prisma.orderItem.findMany({
    where,
    include: {
      order: {
        include: {
          shipments: {
            where: { status: 'DELIVERED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      variant: true,
    },
    take: 50,
  });

  const rows = items.map((it) => ({
    product_no: it.sku || it.variant?.sku || null,
    sku: it.sku || it.variant?.sku || null,
    barcode: it.variant?.barcode || null,
    invoice_no: invoiceNo || null, // your prisma schema doesn’t keep invoice no; return null if unknown
    order_no: it.order?.orderNumber?.toString() || null,
    product_name: it.title || it.variant?.title || null,
    delivery_date: it.order?.shipments?.[0]?.createdAt || null,
  }));

  return new Response(JSON.stringify({ items: rows }), { status: 200 });
}
