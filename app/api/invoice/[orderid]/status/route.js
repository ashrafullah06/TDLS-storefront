// PATH: app/api/invoice/[orderid]/status/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

// Parse the dynamic path param to support:
// - cuid `id`
// - plain numeric orderNumber (e.g. "123456")
// - prefixed order number like "ORD123456"
function buildWhereFromParam(param) {
  const s = String(param || "").trim();
  const ordMatch = /^ORD(\d+)$/i.exec(s);
  if (ordMatch) return { orderNumber: parseInt(ordMatch[1], 10) };
  if (/^\d+$/.test(s)) return { orderNumber: parseInt(s, 10) };
  return { id: s };
}

const toNum = (d) => {
  if (d == null) return 0;
  // Prisma Decimal can be Decimal.js-like; prefer toString() when available
  try {
    if (typeof d === "object" && typeof d.toString === "function") {
      const n = Number(d.toString());
      return Number.isFinite(n) ? n : 0;
    }
  } catch {}
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
};

function json(body, status = 200, extraHeaders = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Vary: "Cookie, Authorization",
      ...extraHeaders,
    },
  });
}

export async function GET(req, ctx) {
  try {
    // FIX: Use central auth(req) in Route Handlers (prevents false-guest 401s)
    const session = await auth(req).catch(() => null);
    const userId =
      session?.user?.id ??
      session?.userId ??
      session?.user?.sub ??
      null;

    // In Next 14/15, params can be a promise in route handlers
    const params = ctx?.params;
    const resolvedParams =
      params && typeof params?.then === "function" ? await params : params;

    const orderid = resolvedParams?.orderid;
    const where = buildWhereFromParam(decodeURIComponent(String(orderid || "")));

    // Pull only columns that exist in your DB to avoid schema mismatch
    const order = await prisma.order.findFirst({
      where,
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        currency: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        grandTotal: true,
        createdAt: true,
        updatedAt: true,
        payments: {
          select: {
            id: true,
            provider: true,
            status: true,
            transactionId: true,
            message: true,
            currency: true,
            amount: true,
            createdAt: true,
            updatedAt: true,
            refunds: {
              select: {
                id: true,
                status: true,
                amount: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        refunds: {
          select: { id: true, status: true, amount: true, createdAt: true },
        },
      },
    });

    if (!order) {
      return json({ ok: false, error: "Order not found" }, 404);
    }

    // ENFORCEMENT RULE (kept):
    // - If the order is tied to a userId, you MUST be logged in as that user.
    // - If the order has no userId (guest order), allow status read without auth.
    if (order.userId) {
      if (!userId) {
        return json(
          { ok: false, error: "unauthorized", message: "Login required for this invoice." },
          401
        );
      }
      if (String(order.userId) !== String(userId)) {
        // hide existence
        return json({ ok: false, error: "Order not found" }, 404);
      }
    }

    // Totals derived from real DB values
    const grandTotal = toNum(order.grandTotal);

    // Treat PAID/SETTLED as captured funds
    const capturedPaid = (order.payments || [])
      .filter((p) => ["PAID", "SETTLED"].includes(p.status))
      .reduce((sum, p) => sum + toNum(p.amount), 0);

    // Track authorized (not captured) separately
    const authorized = (order.payments || [])
      .filter((p) => p.status === "AUTHORIZED")
      .reduce((sum, p) => sum + toNum(p.amount), 0);

    // Sum refunds at payment-level + order-level, excluding failed
    const refundFromPayments = (order.payments || []).reduce((sum, p) => {
      const r = (p.refunds || []).filter(
        (x) => String(x.status || "").toLowerCase() !== "failed"
      );
      return sum + r.reduce((s, x) => s + toNum(x.amount), 0);
    }, 0);

    const refundFromOrder = (order.refunds || [])
      .filter((x) => String(x.status || "").toLowerCase() !== "failed")
      .reduce((s, x) => s + toNum(x.amount), 0);

    const refunded = refundFromPayments + refundFromOrder;

    const netPaid = Math.max(capturedPaid - refunded, 0);
    const balanceDue = Math.max(grandTotal - netPaid, 0);

    return json(
      {
        ok: true,
        invoice: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          currency: order.currency,
          status: order.status,
          paymentStatus: order.paymentStatus,
          fulfillmentStatus: order.fulfillmentStatus,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
          totals: {
            grandTotal,
            capturedPaid: netPaid, // paid minus refunds
            authorized,
            refunded,
            balanceDue,
          },
        },
        payments: order.payments || [],
        // safe debug info (does not change invoice fields)
        auth: { userId: userId ? String(userId) : null, hasSession: !!session },
      },
      200
    );
  } catch (err) {
    console.error("GET /api/invoice/[orderid]/status error:", err);

    // Keep auth errors as 401 (not 500)
    if (err?.status === 401 || String(err?.message || "").toLowerCase() === "unauthorized") {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    return json({ ok: false, error: "Internal server error" }, 500);
  }
}
