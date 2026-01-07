// FILE: app/api/discounts/validate/route.js
// Validate a promo code against your Promotion tables and preview its discount on the active cart.
// No DB mutations here.

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

/** Load the currently active cart by session cookie. */
async function loadActiveCart() {
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
                  // Needed to check PromotionCollection eligibility
                  collections: { select: { collectionId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

/** Resolve a code to an active Promotion row (schema uses Promotion.code). */
async function resolvePromotionByCode(inputCode) {
  const code = String(inputCode || "").trim().toUpperCase();
  if (!code) return null;

  const p = await prisma.promotion.findFirst({
    where: {
      code,
      status: "ACTIVE",
    },
    include: {
      productScopes: { select: { productId: true } },        // PromotionProduct[]
      collectionScopes: { select: { collectionId: true } },  // PromotionCollection[]
    },
  });

  if (!p) return null;

  // date window
  const t = now();
  if (p.startsAt && t < p.startsAt) return null;
  if (p.endsAt && t > p.endsAt) return null;

  return p;
}

/** Check whether a cart item is eligible against a Promotion (using your schema). */
function itemEligible(promo, item) {
  // Fast paths
  if (promo.appliesToAllProducts) return true;
  if (promo.appliesToAllCollections) return true;

  const productId = item?.variant?.productId || item?.variant?.product?.id || null;
  const productCollections =
    item?.variant?.product?.collections?.map((c) => c.collectionId) || [];

  // Product scope
  if (promo.productScopes?.length) {
    const allowIds = new Set(promo.productScopes.map((x) => x.productId));
    if (productId && allowIds.has(productId)) return true;
  }

  // Collection scope
  if (promo.collectionScopes?.length) {
    const allowColl = new Set(promo.collectionScopes.map((x) => x.collectionId));
    if (productCollections.some((cid) => allowColl.has(cid))) return true;
  }

  return false;
}

function previewDiscount(promo, cart) {
  const type = promo.type; // PromotionType: PERCENTAGE | FIXED | FREE_SHIPPING | BUY_X_GET_Y
  const currency = cart.currency || "BDT";

  // Eligible subtotal
  const eligibleLines = (cart.items || []).filter((it) => itemEligible(promo, it));
  const eligibleSubtotal = eligibleLines.reduce((s, it) => s + asMoney(it.subtotal), 0);

  // Basic minimum subtotal handling if you use value for min. (This schema does not expose minSubtotal; skip.)
  // You can implement minSubtotal via AppSetting or future field if needed.

  let discount = 0;

  if (type === "PERCENTAGE") {
    // promo.value holds percent per schema when PERCENTAGE
    const pct = clamp(asMoney(promo.value), 0, 100);
    discount = (eligibleSubtotal * pct) / 100;
  } else if (type === "FIXED") {
    discount = asMoney(promo.value);
  } else if (type === "FREE_SHIPPING") {
    // Assume discount equals shipping on the cart (preview)
    discount = asMoney(cart.shippingTotal || 0);
  } else if (type === "BUY_X_GET_Y") {
    // Not implemented here; preview as 0 to avoid misleading UI.
    discount = 0;
  }

  // Do not exceed the eligible base
  discount = clamp(discount, 0, Math.max(eligibleSubtotal, 0));

  return { currency, discount };
}

/* ───────── route ───────── */

export async function POST(req) {
  const { code } = await req.json().catch(() => ({}));
  if (!code) return j({ ok: false, reason: "Missing code" }, 400);

  const cart = await loadActiveCart();
  if (!cart) return j({ ok: false, reason: "No active cart" }, 404);

  const promo = await resolvePromotionByCode(code);
  if (!promo) return j({ ok: false, reason: "Code not found or inactive" }, 404);

  const preview = previewDiscount(promo, cart);

  return j({
    ok: true,
    code: promo.code,
    name: promo.name,
    type: promo.type,
    currency: preview.currency,
    previewDiscount: preview.discount,
    startsAt: promo.startsAt,
    endsAt: promo.endsAt,
    appliesToAllProducts: promo.appliesToAllProducts,
    appliesToAllCollections: promo.appliesToAllCollections,
    productIds: (promo.productScopes || []).map((x) => x.productId),
    collectionIds: (promo.collectionScopes || []).map((x) => x.collectionId),
  });
}
