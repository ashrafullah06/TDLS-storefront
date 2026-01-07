// FILE: app/api/tax/apply/route.js
/**
 * Purpose
 * -------
 * Single global VAT (%) input → automatically applied to carts/orders.
 * - Admin sets VAT once in Settings (AppSetting.key="settings", value.tax.vat.pct).
 * - This endpoint reads that single number and applies it to a Cart or an Order.
 * - No duplication: you don’t need per-product tax flags or UI changes.
 *
 * How to use (no UI change needed)
 * --------------------------------
 * Apply to a Cart:
 *   POST /api/tax/apply  { "entity": "cart", "id": "<cartId>" }
 *
 * Apply to an Order:
 *   POST /api/tax/apply  { "entity": "order", "id": "<orderId>" }
 *
 * It will:
 *   1) Load global VAT % (defaults to 15 if not set yet).
 *   2) Compute tax from the monetary subtotal using standard formulas:
 *        - INCLUSIVE pricing (default BD): tax = subtotal * (vat / (100 + vat))
 *        - EXCLUSIVE pricing:             tax = subtotal * (vat / 100)
 *   3) Update taxTotal and grandTotal on the Cart/Order.
 *   4) Return the updated record (safe fields only).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/auth";

// ───────────────────────────────── helpers ─────────────────────────────────

const money = (n) => Number(n ?? 0);
const round = (n, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round(Number(n) * f) / f;
};

async function getGlobalVat() {
  // Read the unified settings blob you already have at key="settings".
  // Fallbacks keep things working on first run.
  const rec = await prisma.appSetting.findUnique({ where: { key: "settings" } });
  const val = rec?.value || {};
  const vatPct = money(val?.tax?.vat?.pct ?? 15); // single number is all we need
  const mode =
    (val?.tax?.vat?.pricing_mode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE") || "INCLUSIVE";
  return { vatPct, mode };
}

function computeTax({ subtotal, discountTotal, shippingTotal, vatPct, mode }) {
  const sub = money(subtotal);
  const disc = money(discountTotal);
  const ship = money(shippingTotal);

  // Monetary base before tax (exclusive of discounts)
  const effectiveSubtotal = Math.max(0, sub - disc);

  let tax = 0;

  if (mode === "EXCLUSIVE") {
    // All prices are net; add VAT on top of effective subtotal
    tax = effectiveSubtotal * (vatPct / 100);
  } else {
    // INCLUSIVE (default BD). Subtotal includes VAT already.
    // Standard extraction formula: tax = inclusive * vat/(100+vat)
    tax = effectiveSubtotal * (vatPct / (100 + vatPct));
  }

  tax = round(tax, 2);

  // Grand total composition:
  // - EXCLUSIVE: grand = effectiveSubtotal + tax + shipping
  // - INCLUSIVE: grand = effectiveSubtotal + shipping (tax is part of inclusive subtotal)
  const grand =
    mode === "EXCLUSIVE"
      ? round(effectiveSubtotal + tax + ship, 2)
      : round(effectiveSubtotal + ship, 2);

  return { taxTotal: tax, grandTotal: grand, effectiveSubtotal: round(effectiveSubtotal, 2) };
}

function safeCartResponse(c) {
  return {
    id: c.id,
    currency: c.currency,
    subtotal: c.subtotal,
    discountTotal: c.discountTotal,
    shippingTotal: c.shippingTotal,
    taxTotal: c.taxTotal,
    grandTotal: c.grandTotal,
    updatedAt: c.updatedAt,
  };
}

function safeOrderResponse(o) {
  return {
    id: o.id,
    currency: o.currency,
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    shippingTotal: o.shippingTotal,
    taxTotal: o.taxTotal,
    grandTotal: o.grandTotal,
    updatedAt: o.updatedAt,
  };
}

// ────────────────────────────────── POST ──────────────────────────────────

export async function POST(req) {
  // Auth not strictly required to *calculate*, but updating DB should require a user.
  // Allow both: signed-in customer (cart) or admin (order/backoffice).
  const session = await auth().catch(() => null);

  const body = await req.json().catch(() => null);
  const entity = String(body?.entity || "").toLowerCase(); // "cart" | "order"
  const id = String(body?.id || "");

  if (!entity || !id) {
    return NextResponse.json({ error: "entity and id are required" }, { status: 400 });
  }

  // Lightweight ACL:
  // - Cart: allow if owner or anonymous (session not strictly enforced here; your upstream can gate).
  // - Order: require admin; customers shouldn’t be rewriting order totals directly.
  const isAdmin =
    session && (session.user?.role === "admin" || session.user?.role === "superadmin");

  if (entity === "order" && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { vatPct, mode } = await getGlobalVat();

  if (entity === "cart") {
    const cart = await prisma.cart.findUnique({
      where: { id },
      select: {
        id: true,
        currency: true,
        userId: true,
        subtotal: true,
        discountTotal: true,
        shippingTotal: true,
        taxTotal: true,
        grandTotal: true,
        updatedAt: true,
      },
    });

    if (!cart) return NextResponse.json({ error: "cart_not_found" }, { status: 404 });

    // Optional: if session exists, verify ownership
    if (session?.user?.id && cart.userId && session.user.id !== cart.userId && !isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const { taxTotal, grandTotal } = computeTax({
      subtotal: cart.subtotal,
      discountTotal: cart.discountTotal,
      shippingTotal: cart.shippingTotal,
      vatPct,
      mode,
    });

    const updated = await prisma.cart.update({
      where: { id: cart.id },
      data: { taxTotal, grandTotal },
      select: {
        id: true,
        currency: true,
        subtotal: true,
        discountTotal: true,
        shippingTotal: true,
        taxTotal: true,
        grandTotal: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      entity: "cart",
      vat_pct: vatPct,
      pricing_mode: mode,
      value: safeCartResponse(updated),
    });
  }

  if (entity === "order") {
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        currency: true,
        subtotal: true,
        discountTotal: true,
        shippingTotal: true,
        taxTotal: true,
        grandTotal: true,
        updatedAt: true,
      },
    });

    if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

    const { taxTotal, grandTotal } = computeTax({
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      shippingTotal: order.shippingTotal,
      vatPct,
      mode,
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { taxTotal, grandTotal },
      select: {
        id: true,
        currency: true,
        subtotal: true,
        discountTotal: true,
        shippingTotal: true,
        taxTotal: true,
        grandTotal: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ok: true,
      entity: "order",
      vat_pct: vatPct,
      pricing_mode: mode,
      value: safeOrderResponse(updated),
    });
  }

  return NextResponse.json({ error: "unsupported_entity" }, { status: 400 });
}

// ─────────────────────────────────── GET ───────────────────────────────────
// Convenience read: expose current single VAT % and pricing mode for the UI
// (e.g., checkout summary or receipt can read and display).
export async function GET() {
  const { vatPct, mode } = await getGlobalVat();
  return NextResponse.json({ ok: true, vat_pct: vatPct, pricing_mode: mode });
}
