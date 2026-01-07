// my-project/app/api/payments/sslcommerz/return/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";

const { NEXT_PUBLIC_SITE_URL } = process.env;

export async function POST(req) {
  const form = await req.formData();
  const tranId = form.get("tran_id") || "";
  const status = (form.get("status") || "").toUpperCase(); // VALIDATED, FAILED, CANCELLED, etc.
  const valId = form.get("val_id") || null;

  // Our tran_id format recommended: `${orderNumber}-${paymentId}`
  const [orderNumber, paymentId] = String(tranId).split("-");

  try {
    // If status is FAILED/CANCELLED from the return page itself, mark Payment as FAILED and send to failure page.
    if (status === "FAILED" || status === "CANCELLED" || status === "CANCELED") {
      if (paymentId) {
        await prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: "FAILED",
            rawPayload: Object.fromEntries(form.entries()),
            message: status.toLowerCase(),
          },
        }).catch(() => {});
      }
      return Response.redirect(new URL(`/checkout/payment-failed?reason=${encodeURIComponent(status)}`, NEXT_PUBLIC_SITE_URL), 302);
    }

    // Otherwise, let IPN/validator do the authoritative update.
    // We still give a nice redirect: if we know the order, send to detail; else to orders list.
    if (paymentId) {
      const pay = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, orderId: true, status: true },
      });
      if (pay?.orderId) {
        // If already processed by IPN, go to order detail; else a neutral "processing" page.
        if (pay.status === "PAID") {
          return Response.redirect(new URL(`/account/orders/${pay.orderId}`, NEXT_PUBLIC_SITE_URL), 302);
        }
        return Response.redirect(new URL(`/account/orders/by-number/${orderNumber}`, NEXT_PUBLIC_SITE_URL), 302);
      }
    }
  } catch (_) {}

  // Fallback
  return Response.redirect(new URL(`/account/orders`, NEXT_PUBLIC_SITE_URL), 302);
}
