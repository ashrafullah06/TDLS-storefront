// app/api/payments/sslcommerz/success/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";

export async function POST(req) {
  const form = await req.formData();
  const tranId = form.get("tran_id") || "";
  const [orderNumber, paymentId] = String(tranId).split("-");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: "PAID", transactionId: form.get("val_id") || null, rawPayload: Object.fromEntries(form.entries()) },
      });
      const pay = await tx.payment.findUnique({ where: { id: paymentId } });
      await tx.order.update({ where: { id: pay.orderId }, data: { paymentStatus: "PAID", status: "CONFIRMED" } });
    });
  } catch (_) {}
  // redirect to order detail
  return Response.redirect(new URL(`/account/orders/by-number/${orderNumber}`, process.env.NEXT_PUBLIC_SITE_URL), 302);
}
