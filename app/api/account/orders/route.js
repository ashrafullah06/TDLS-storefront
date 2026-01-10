// PATH: app/api/account/orders/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isBuildPhase() {
  const nextPhase = String(process.env.NEXT_PHASE || "");
  const npmEvent = String(process.env.npm_lifecycle_event || "");
  const npmScript = String(process.env.npm_lifecycle_script || "");
  return (
    nextPhase === "phase-production-build" ||
    nextPhase.includes("phase-production-build") ||
    npmEvent === "build" ||
    npmScript.includes("next build")
  );
}

export async function GET() {
  try {
    // Build-safety: during `next build`/Vercel "Collecting page data"
    if (isBuildPhase()) {
      return json([], 200);
    }

    // Lazy-load to avoid module evaluation failures during build
    let prisma, auth;
    try {
      const modPrisma = await import("@/lib/prisma");
      const modAuth = await import("@/lib/auth");
      prisma = modPrisma?.default;
      auth = modAuth?.auth;
    } catch (e) {
      console.error("[api/account/orders init] ", e);
      return json([], 200); // keep behavior safe for dashboards
    }

    // Auth using Auth.js v5 single config
    const session = await auth();
    const userId = session?.user?.id || null;

    // If not signed in, return empty list but NOT an error
    if (!userId) {
      return json([], 200);
    }

    // Fetch all orders for this customer (newest first)
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
        payments: true,
      },
    });

    // Map to a compact customer-safe shape
    const data = orders.map((o) => {
      const items = Array.isArray(o.items) ? o.items : [];
      const payments = Array.isArray(o.payments) ? o.payments : [];

      // Count items
      const itemCount = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);

      // Sum paid (PAID-like statuses)
      const PAIDLIKE = new Set(["PAID", "SETTLED", "CAPTURED", "SUCCEEDED", "AUTHORIZED"]);
      const paidAmount = payments.reduce((sum, p) => {
        const st = String(p?.status || "").toUpperCase();
        return PAIDLIKE.has(st) ? sum + Number(p.amount || 0) : sum;
      }, 0);

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        currency: o.currency,
        grandTotal: Number(o.grandTotal ?? 0),
        subtotal: Number(o.subtotal ?? 0),
        shippingTotal: Number(o.shippingTotal ?? 0),
        discountTotal: Number(o.discountTotal ?? 0),
        taxTotal: Number(o.taxTotal ?? 0),
        createdAt: o.createdAt,
        itemCount,
        paidAmount,
      };
    });

    return json(data, 200);
  } catch (err) {
    console.error("[api/account/orders GET] ", err);
    // For safety: don’t crash the dashboard – return empty array but with 500
    return json([], 500);
  }
}
