// app/api/customers/returns/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prismaClient from "@/lib/prisma";

// Keep the same singleton pattern, but use your project’s canonical prisma client
const prisma = globalThis.__prisma__ ?? prismaClient;
if (!globalThis.__prisma__) globalThis.__prisma__ = prisma;

const CURRENCY = "BDT"; // align with your config/policy

function to_num(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  if (v?.toNumber) return Number(v.toNumber());
  return Number(v);
}

export async function POST(req) {
  try {
    const form = await req.formData();
    const user_id = String(form.get("user_id") || "");
    const order_no = String(form.get("order_no") || "");
    const invoice_no = String(form.get("invoice_no") || "");
    const product_no = String(form.get("product_no") || "");
    const sku = String(form.get("sku") || "");
    const barcode = String(form.get("barcode") || "");
    const action_type = String(form.get("action_type") || ""); // return | exchange | refund
    const reason = String(form.get("reason") || "");
    const description = String(form.get("description") || "");
    const refund_method = String(form.get("refund_method") || "");
    const mfs_service = String(form.get("mfs_service") || "");
    const account_info = String(form.get("account_info") || "");

    const files = form.getAll("images").filter(Boolean);

    if (!action_type) return new NextResponse("missing action_type", { status: 400 });
    if (!description.trim()) return new NextResponse("missing description", { status: 400 });

    // find the order
    const order_filters = [];
    if (order_no) {
      const n = parseInt(order_no, 10);
      if (!Number.isNaN(n)) order_filters.push({ orderNumber: n });
      order_filters.push({ id: order_no });
    }
    const order = await prisma.order.findFirst({
      where: order_filters.length ? { OR: order_filters } : undefined,
      include: {
        items: {
          include: { variant: true },
        },
        payments: true,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!order) return new NextResponse("order not found", { status: 404 });

    // pick the target order item
    let item =
      order.items.find(
        (it) =>
          (sku && (it.sku === sku || it.variant?.sku === sku)) ||
          (product_no && (it.variantId === product_no || it.id === product_no))
      ) ||
      order.items.find((it) => barcode && it.variant?.barcode === barcode) ||
      order.items[0];

    if (!item) return new NextResponse("order item not found", { status: 404 });

    // compute a conservative refundable line amount
    const refundable = Math.max(
      0,
      to_num(item.total || item.subtotal) - to_num(item.discountTotal) + to_num(item.taxTotal)
    );

    // persist request based on action type
    let application_id = null;
    let timeline = [
      { step: "submitted", date: new Date().toISOString(), info: "application received." },
      { step: "pickup scheduled", date: null, info: "awaiting confirmation." },
    ];

    if (action_type === "return" || action_type === "refund") {
      const rr = await prisma.returnRequest.create({
        data: {
          orderId: order.id,
          userId: user_id || order.userId || null,
          status: "requested",
          reason,
          notes: description,
          totalRefund: action_type === "refund" ? refundable : 0,
          lines: {
            create: [
              {
                orderItemId: item.id,
                quantity: Math.max(1, item.quantity || 1),
                lineRefund: action_type === "refund" ? refundable : 0,
                reason,
                conditionNotes: files?.length
                  ? `images: ${files
                      .map((f) => (typeof f.name === "string" ? f.name : "file"))
                      .join(", ")}`
                  : null,
              },
            ],
          },
        },
        include: { lines: true },
      });
      application_id = rr.id;

      // create a notification
      await prisma.notification.create({
        data: {
          userId: rr.userId || user_id || order.userId,
          orderId: order.id,
          channel: "IN_APP",
          type: action_type === "refund" ? "REFUND_INITIATED" : "RETURN_REQUESTED",
          title: action_type === "refund" ? "refund requested" : "return requested",
          body: `order #${order.orderNumber} • item ${item.sku || item.id}`,
          data: {
            reason,
            refund_method: refund_method || null,
            mfs_service: mfs_service || null,
            account_info: refund_method !== "wallet" ? account_info || null : null,
            invoice_no: invoice_no || null,
            product_no: product_no || null,
            barcode: barcode || null,
          },
          queued: true,
        },
      });

      // optional: seed refund row on "refund"
      if (action_type === "refund") {
        const pay = order.payments?.[0] || null;
        await prisma.refund.create({
          data: {
            orderId: order.id,
            paymentId: pay?.id || null,
            returnId: rr.id,
            amount: refundable,
            currency: order.currency || CURRENCY,
            reason,
            status: "initiated",
          },
        });
        timeline.push({ step: "finance review", date: null, info: "verifying refund method & amount." });
      }
    } else if (action_type === "exchange") {
      const ex = await prisma.exchangeRequest.create({
        data: {
          orderId: order.id,
          userId: user_id || order.userId || null,
          status: "requested",
          reason,
          notes: description,
          lines: {
            create: [
              {
                fromOrderItemId: item.id,
                toVariantId: item.variantId || item.variant?.id, // default same variant; admin will adjust
                quantity: Math.max(1, item.quantity || 1),
                notes: files?.length
                  ? `images: ${files
                      .map((f) => (typeof f.name === "string" ? f.name : "file"))
                      .join(", ")}`
                  : null,
              },
            ],
          },
        },
        include: { lines: true },
      });
      application_id = ex.id;

      await prisma.notification.create({
        data: {
          userId: ex.userId || user_id || order.userId,
          orderId: order.id,
          channel: "IN_APP",
          type: "EXCHANGE_REQUESTED",
          title: "exchange requested",
          body: `order #${order.orderNumber} • item ${item.sku || item.id}`,
          data: { reason },
          queued: true,
        },
      });
      timeline.push({ step: "exchange options", date: null, info: "awaiting admin confirmation." });
    } else {
      return new NextResponse("invalid action_type", { status: 400 });
    }

    return NextResponse.json({ success: true, application_id, timeline });
  } catch (err) {
    return new NextResponse(err?.message || "submit error", { status: 500 });
  }
}

// optional: list recent requests for the current user via query ?user_id=...
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get("user_id") || "";

    if (!user_id) return NextResponse.json({ items: [] });

    const [returns, exchanges] = await Promise.all([
      prisma.returnRequest.findMany({
        where: { userId: user_id },
        include: { lines: true, order: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.exchangeRequest.findMany({
        where: { userId: user_id },
        include: { lines: true, order: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    return NextResponse.json({ returns, exchanges });
  } catch (err) {
    return new NextResponse(err?.message || "list error", { status: 500 });
  }
}
