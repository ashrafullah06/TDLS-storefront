// FILE: app/api/discounts/apply/route.js
// Apply a promo code to the active cart: upsert CartPromotion link, compute discount, update cart totals, and return the updated snapshot.

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

/* ───────── helpers ───────── */
const j = (body, status = 200) => NextResponse.json(body, { status });
const asMoney = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, v) : 0;
};
const clamp = (n, min = 0, max = Number.POSITIVE_INFINITY) =>
  Math.max(min, Math.min(max, n));
const now = () => new Date();

/** Load active cart with everything needed to compute and update totals. */
async function loadActiveCartForUpdate() {
  const session = cookies().get("cart_session_id")?.value || null;
  if (!session) return null;

  return prisma.cart.findFirst({
    where: { sessionId: session, status: "ACTIVE" },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: {
                include: {
                  collections: { select: { collectionId: true } },
                },
              },
            },
          },
        },
      },
      promotions: {
        include: {
          promotion: {
            include: {
              productScopes: { select: { productId: true } },
              collectionScopes: { select: { collectionId: true } },
            },
          },
        },
      },
    },
  });
}

async function resolvePromotionByCode(inputCode) {
  const code = String(inputCode || "").trim().toUpperCase();
  if (!code) return null;

  const p = await prisma.promotion.findFirst({
    where: { code, status: "ACTIVE" },
    include: {
      productScopes: { select: { productId: true } },
      collectionScopes: { select: { collectionId: true } },
    },
  });

  if (!p) return null;

  const t = now();
  if (p.startsAt && t < p.startsAt) return null;
  if (p.endsAt && t > p.endsAt) return null;

  return p;
}

function itemEligible(promo, item) {
  if (promo.appliesToAllProducts) return true;
  if (promo.appliesToAllCollections) return true;

  const productId = item?.variant?.productId || item?.variant?.product?.id || null;
  const productCollections =
    item?.variant?.product?.collections?.map((c) => c.collectionId) || [];

  if (promo.productScopes?.length) {
    const allowIds = new Set(promo.productScopes.map((x) => x.productId));
    if (productId && allowIds.has(productId)) return true;
  }

  if (promo.collectionScopes?.length) {
    const allow = new Set(promo.collectionScopes.map((x) => x.collectionId));
    if (productCollections.some((cid) => allow.has(cid))) return true;
  }

  return false;
}

function computeDiscount(promo, cart) {
  const type = promo.type;

  const eligibleLines = (cart.items || []).filter((it) => itemEligible(promo, it));
  const eligibleSubtotal = eligibleLines.reduce((s, it) => s + asMoney(it.subtotal), 0);

  let discount = 0;

  if (type === "PERCENTAGE") {
    const pct = clamp(asMoney(promo.value), 0, 100);
    discount = (eligibleSubtotal * pct) / 100;
  } else if (type === "FIXED") {
    discount = asMoney(promo.value);
  } else if (type === "FREE_SHIPPING") {
    discount = asMoney(cart.shippingTotal || 0);
  } else if (type === "BUY_X_GET_Y") {
    // For now, skip automated calc; implement separately if needed.
    discount = 0;
  }

  discount = clamp(discount, 0, Math.max(eligibleSubtotal, 0));
  return discount;
}

/* ───────── route ───────── */

export async function POST(req) {
  const { code } = await req.json().catch(() => ({}));
  if (!code) return j({ ok: false, reason: "Missing code" }, 400);

  const cart = await loadActiveCartForUpdate();
  if (!cart) return j({ ok: false, reason: "No active cart" }, 404);

  const promo = await resolvePromotionByCode(code);
  if (!promo) return j({ ok: false, reason: "Code not found or inactive" }, 404);

  // Compute amount for this promotion on current cart
  const thisDiscount = computeDiscount(promo, cart);
  if (thisDiscount <= 0) {
    return j({ ok: false, reason: "Code not applicable to items/subtotal" }, 400);
  }

  // Upsert the link in CartPromotion (requires amountApplied column; see schema change below)
  await prisma.cartPromotion.upsert({
    where: { cartId_promotionId: { cartId: cart.id, promotionId: promo.id } },
    create: {
      cartId: cart.id,
      promotionId: promo.id,
      amountApplied: thisDiscount,
    },
    update: { amountApplied: thisDiscount },
  });

  // Sum all applied promotions for this cart
  const links = await prisma.cartPromotion.findMany({
    where: { cartId: cart.id },
    select: { amountApplied: true },
  });

  const discountTotal = links.reduce((s, r) => s + asMoney(r.amountApplied), 0);
  const subtotal = asMoney(
    cart.subtotal ||
      cart.items.reduce((s, it) => s + asMoney(it.subtotal), 0)
  );
  const shipping = asMoney(cart.shippingTotal || 0);
  const tax = asMoney(cart.taxTotal || 0);

  // Cap so grandTotal never goes negative
  const cappedDiscount = clamp(discountTotal, 0, subtotal + shipping);
  const grandTotal = clamp(subtotal + shipping + tax - cappedDiscount, 0);

  const updated = await prisma.cart.update({
    where: { id: cart.id },
    data: {
      discountTotal: cappedDiscount,
      grandTotal,
    },
    include: {
      items: true,
      promotions: {
        include: { promotion: { select: { id: true, code: true, name: true, type: true } } },
      },
    },
  });

  return j({
    ok: true,
    cart: {
      id: updated.id,
      currency: updated.currency,
      subtotal: asMoney(updated.subtotal),
      shippingTotal: asMoney(updated.shippingTotal),
      taxTotal: asMoney(updated.taxTotal),
      discountTotal: asMoney(updated.discountTotal),
      grandTotal: asMoney(updated.grandTotal),
      appliedPromotions: (updated.promotions || []).map((p) => ({
        id: p.promotion?.id,
        code: p.promotion?.code,
        name: p.promotion?.name,
        type: p.promotion?.type,
      })),
      items: updated.items.map((it) => ({
        id: it.id,
        variantId: it.variantId,
        quantity: it.quantity,
        unitPrice: asMoney(it.unitPrice),
        subtotal: asMoney(it.subtotal),
      })),
    },
  });
}
