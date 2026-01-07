export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";

export async function POST(req) {
  const form = await req.formData();
  const tranId = form.get("tran_id") || "";
  const [, paymentId] = String(tranId).split("-");
  try {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: "CANCELED", rawPayload: Object.fromEntries(form.entries()) },
    });
  } catch (_) {}
  return Response.redirect(new URL(`/account/orders`, process.env.NEXT_PUBLIC_SITE_URL), 302);
}
