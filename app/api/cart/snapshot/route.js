//FILE: app/api/cart/snapshot/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/* ───────── helpers ───────── */
function json(body, status = 200) {
  return NextResponse.json(body, { status });
}

function bool(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

function safeCartSnapshot(cart) {
  if (!cart) {
    return {
      ok: true,
      buyNowActive: false,
      cart: null,
      items: [],
      itemCount: 0,
      currency: "BDT",
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      shippingTotal: 0,
      grandTotal: 0,
    };
  }
  const items = (cart.items || []).map((it) => ({
    id: it.id,
    variantId: it.variantId,
    quantity: Number(it.quantity || 0),
    unitPrice: Number(it.unitPrice || 0),
    subtotal: Number(it.subtotal || 0),
  }));
  const itemCount = items.reduce((s, it) => s + (it.quantity || 0), 0);

  return {
    ok: true,
    buyNowActive: false, // caller may overwrite below when we know it
    cart: { id: cart.id, status: cart.status, sessionId: cart.sessionId ?? null },
    items,
    itemCount,
    currency: cart.currency || "BDT",
    subtotal: Number(cart.subtotal || 0),
    discountTotal: Number(cart.discountTotal || 0),
    taxTotal: Number(cart.taxTotal || 0),
    shippingTotal: Number(cart.shippingTotal || 0),
    grandTotal: Number(cart.grandTotal || 0),
  };
}

/* ───────── core resolver ───────── */
async function findActiveCart({ userId, sessionId, preferSession = false }) {
  // If a session cart is explicitly preferred (buy-now mode), try that first
  if (preferSession && sessionId) {
    const bySession = await prisma.cart.findFirst({
      where: { status: "ACTIVE", sessionId },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
    });
    if (bySession) return bySession;
  }

  // Then try user-bound active cart (most common for logged-in users)
  if (userId) {
    const byUser = await prisma.cart.findFirst({
      where: { status: "ACTIVE", userId },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
    });
    if (byUser) return byUser;
  }

  // Finally, fall back to session cart (guest flows)
  if (sessionId) {
    const bySession = await prisma.cart.findFirst({
      where: { status: "ACTIVE", sessionId },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
    });
    if (bySession) return bySession;
  }

  return null;
}

/* ───────── GET /api/cart/snapshot ───────── */
export async function GET() {
  try {
    // Session (best-effort)
    let session = null;
    try {
      session = await auth();
    } catch {}

    const c = cookies();
    const sessionId = c.get("cart_session_id")?.value || null;
    const buyNowActive = bool(c.get("buy_now")?.value);

    // Resolve the active cart according to flow:
    // - If buy-now is active, prefer the cart tied to cart_session_id
    // - Else use the logged-in user's active cart; else fall back to session cart
    const cart = await findActiveCart({
      userId: session?.user?.id || null,
      sessionId,
      preferSession: buyNowActive,
    });

    const snap = safeCartSnapshot(cart);
    snap.buyNowActive = buyNowActive;

    // If buy-now cookie is set but the cart is missing/empty, we still return 200 with empty snapshot.
    // The client can react (e.g., redirect to /cart) without a crash.
    return json(snap, 200);
  } catch (err) {
    // Never leak internals—return a harmless empty snapshot
    return json(
      {
        ok: true,
        buyNowActive: false,
        cart: null,
        items: [],
        itemCount: 0,
        currency: "BDT",
        subtotal: 0,
        discountTotal: 0,
        taxTotal: 0,
        shippingTotal: 0,
        grandTotal: 0,
        note: "Snapshot fallback due to server error",
      },
      200
    );
  }
}
