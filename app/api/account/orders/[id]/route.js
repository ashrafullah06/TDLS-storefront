// PATH: app/api/account/orders/[id]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/**
 * JSON helper (always no-store)
 */
function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const isNumeric = (s) => /^[0-9]+$/.test(String(s || "").trim());

function toNumberSafe(v) {
  if (v == null) return 0;

  // Prisma Decimal often has .toNumber()
  if (typeof v === "object" && typeof v.toNumber === "function") {
    try {
      return v.toNumber();
    } catch {
      // fall through
    }
  }

  if (typeof v === "bigint") {
    // This is safe as long as you’re not storing amounts beyond Number range
    return Number(v);
  }

  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeDecode(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  try {
    return decodeURIComponent(s);
  } catch {
    // If it’s malformed, keep raw instead of crashing
    return s;
  }
}

/**
 * GET /api/account/orders/:id
 * Customer-only: returns the order if it belongs to the logged-in user.
 */
export async function GET(_req, { params }) {
  try {
    const session = await auth();
    const userId = session?.user?.id || null;

    if (!userId) {
      return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }

    const rawKey = safeDecode(params?.id);
    if (!rawKey) {
      return json({ ok: false, error: "ORDER_ID_REQUIRED" }, 422);
    }

    // Allow lookup by cuid `id` or numeric `orderNumber`, but ALWAYS scoped to this user
    const where = isNumeric(rawKey)
      ? { userId, orderNumber: Number(rawKey) }
      : { userId, id: rawKey };

    const order = await prisma.order.findFirst({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        shippingAddress: true,
        billingAddress: true,
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, title: true, slug: true } },
                media: { include: { media: true } },
                optionValues: {
                  include: { optionValue: { include: { option: true } } },
                },
              },
            },
          },
        },
        payments: true,
      },
    });

    if (!order) {
      // Do not reveal whether an order exists for other users
      return json({ ok: false, error: "ORDER_NOT_FOUND" }, 404);
    }

    // Events are optional (and schema may differ: "at" vs "createdAt"), so fetch resiliently.
    let events = [];
    try {
      events = await prisma.orderEvent.findMany({
        where: { orderId: order.id },
        orderBy: { at: "desc" },
        take: 50,
      });
    } catch {
      try {
        events = await prisma.orderEvent.findMany({
          where: { orderId: order.id },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
      } catch {
        events = [];
      }
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const payments = Array.isArray(order.payments) ? order.payments : [];

    const out = {
      id: order.id,
      orderNumber: order.orderNumber ?? null,

      status: order.status ?? null,
      paymentStatus: order.paymentStatus ?? null,
      fulfillmentStatus: order.fulfillmentStatus ?? null,
      currency: order.currency ?? null,

      subtotal: toNumberSafe(order.subtotal),
      shippingTotal: toNumberSafe(order.shippingTotal),
      discountTotal: toNumberSafe(order.discountTotal),
      taxTotal: toNumberSafe(order.taxTotal),
      grandTotal: toNumberSafe(order.grandTotal),

      createdAt: order.createdAt ?? null,
      updatedAt: order.updatedAt ?? null,

      customer: order.user || null,
      shippingAddress: order.shippingAddress || null,
      billingAddress: order.billingAddress || null,

      items: items.map((it) => ({
        id: it.id,
        title: it.title ?? null,
        sku: it.sku ?? null,
        quantity: Number(it.quantity ?? 0),
        unitPrice: toNumberSafe(it.unitPrice),
        total: toNumberSafe(it.total),
        variantId: it.variantId ?? null,
        variant: it.variant
          ? {
              id: it.variant.id,
              sku: it.variant.sku ?? null,
              barcode: it.variant.barcode ?? null,
              title: it.variant.title ?? null,
              product: it.variant.product ?? null,
              media: Array.isArray(it.variant.media) ? it.variant.media : [],
              optionValues: Array.isArray(it.variant.optionValues)
                ? it.variant.optionValues
                : [],
            }
          : null,
      })),

      payments: payments.map((p) => ({
        id: p.id,
        provider: p.provider ?? null,
        status: p.status ?? null,
        currency: p.currency ?? null,
        amount: toNumberSafe(p.amount),
        createdAt: p.createdAt ?? null,
      })),

      events,
    };

    return json({ ok: true, order: out }, 200);
  } catch (err) {
    console.error("[api/account/orders/[id] GET] ", err);
    return json({ ok: false, error: "ORDER_FETCH_FAILED" }, 500);
  }
}
