// FILE: app/api/buy-now/route.js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import crypto from "crypto";
import { Prisma } from "@prisma/client";

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

/* ---------------- session id helpers (guest isolation) ---------------- */

function isValidSid(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  if (s.length < 8 || s.length > 128) return false;
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return false;
  return true;
}

function newSid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(18).toString("base64url");
}

function getExistingSid(jar) {
  const candidates = [
    jar.get("tdlc_sid")?.value,
    jar.get("cart_sid")?.value,
    jar.get("guest_sid")?.value,
  ].filter(Boolean);

  for (const c of candidates) {
    if (isValidSid(c)) return c.trim();
  }
  return null;
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  const i = Math.floor(x);
  return Math.max(min, Math.min(max, i));
}

function asNumber(v) {
  if (v == null) return null;
  const n =
    typeof v === "object" && typeof v.toString === "function"
      ? Number(v.toString())
      : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickCurrency(input) {
  const c = String(input || "BDT").toUpperCase();
  // Keep aligned with your Currency enum; add more if your schema supports it.
  if (["BDT", "USD", "EUR", "GBP"].includes(c)) return c;
  return "BDT";
}

function readMaxAvailableFromPayload(body) {
  const md =
    body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const candidates = [
    body?.maxAvailable,
    body?.stock,
    md?.maxAvailable,
    md?.stock,
    md?.availableQty,
    md?.available_qty,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

async function getOrCreateActiveCart({ userId, sid, currency }) {
  if (userId) {
    const existing = await prisma.cart.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return existing;

    return prisma.cart.create({
      data: {
        userId,
        sessionId: null,
        status: "ACTIVE",
        currency,
        subtotal: new Prisma.Decimal("0"),
        discountTotal: new Prisma.Decimal("0"),
        taxTotal: new Prisma.Decimal("0"),
        shippingTotal: new Prisma.Decimal("0"),
        grandTotal: new Prisma.Decimal("0"),
      },
    });
  }

  // Guest: MUST have sid (prevents cross-guest bleed)
  if (!sid) throw new Error("missing_guest_sid");

  const existing = await prisma.cart.findFirst({
    where: { sessionId: sid, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
  });
  if (existing) return existing;

  return prisma.cart.create({
    data: {
      userId: null,
      sessionId: sid,
      status: "ACTIVE",
      currency,
      subtotal: new Prisma.Decimal("0"),
      discountTotal: new Prisma.Decimal("0"),
      taxTotal: new Prisma.Decimal("0"),
      shippingTotal: new Prisma.Decimal("0"),
      grandTotal: new Prisma.Decimal("0"),
    },
  });
}

async function resolveVariantFromPayload(body) {
  const md =
    body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

  const variantPrismaIdRaw =
    body?.variantPrismaId || md?.variantPrismaId || body?.variant_pid || null;

  const variantPrismaId =
    typeof variantPrismaIdRaw === "string" && variantPrismaIdRaw.trim()
      ? variantPrismaIdRaw.trim()
      : null;

  const sizeIdRaw =
    body?.sizeStockId ??
    body?.rawVariantId ??
    body?.strapiSizeId ??
    body?.variantId ??
    md?.sizeStockId ??
    md?.strapiSizeId ??
    null;

  const sizeIdNum = (() => {
    if (sizeIdRaw == null) return null;
    const n = Number(sizeIdRaw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  })();

  // 1) Try Prisma variant id
  if (variantPrismaId) {
    const v = await prisma.productVariant.findUnique({
      where: { id: variantPrismaId },
      include: { product: true },
    });
    if (v) return v;
  }

  // 2) Try Strapi size row id mapped into productVariant.strapiSizeId
  if (sizeIdNum != null) {
    const v = await prisma.productVariant.findFirst({
      where: { strapiSizeId: sizeIdNum },
      include: { product: true },
    });
    if (v) return v;
  }

  return null;
}

async function recalcCartTotals(cartId) {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    select: { quantity: true, unitPrice: true },
  });

  let subtotal = 0;
  let itemCount = 0;

  for (const it of items) {
    const q = Number(it.quantity || 0) || 0;
    const p = asNumber(it.unitPrice) || 0;
    if (q <= 0 || p < 0) continue;
    itemCount += q;
    subtotal += p * q;
  }

  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    select: {
      discountTotal: true,
      taxTotal: true,
      shippingTotal: true,
    },
  });

  const discountTotal = asNumber(cart?.discountTotal) || 0;
  const taxTotal = asNumber(cart?.taxTotal) || 0;
  const shippingTotal = asNumber(cart?.shippingTotal) || 0;

  const grandTotal = subtotal - discountTotal + taxTotal + shippingTotal;

  await prisma.cart.update({
    where: { id: cartId },
    data: {
      subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
      grandTotal: new Prisma.Decimal(grandTotal.toFixed(2)),
    },
  });

  return { itemCount, subtotal, grandTotal };
}

/* ---------------- handler ---------------- */

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "INVALID_BODY" }, 400);
    }

    const session = await auth().catch(() => null);
    const userId = session?.user?.id || null;

    // FIX: Next.js sync dynamic API -> cookies() must be awaited before .get()
    const jar = await cookies();

    // Ensure guest sid exists (server-side hard isolation)
    let sid = getExistingSid(jar);
    let createdSid = false;

    if (!userId) {
      if (!sid) {
        sid = newSid();
        createdSid = true;
      }
    }

    const currency = pickCurrency(body.currency);

    const quantityRequested = clampInt(body.quantity, 1, 999);

    const variant = await resolveVariantFromPayload(body);
    if (!variant?.id) {
      return json({ ok: false, error: "VARIANT_NOT_FOUND" }, 400);
    }

    // Stock cap (prefer payload cap if provided; also tolerate variant fields if present)
    const capFromPayload = readMaxAvailableFromPayload(body);

    const capFromVariant =
      (() => {
        const candidates = [
          variant?.stockQuantity,
          variant?.stockQty,
          variant?.inventoryQty,
          variant?.availableQty,
          variant?.available_qty,
        ];
        for (const v of candidates) {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) return Math.floor(n);
        }
        return null;
      })() ?? null;

    const maxAllowed =
      capFromPayload != null && capFromVariant != null
        ? Math.min(capFromPayload, capFromVariant)
        : capFromPayload != null
        ? capFromPayload
        : capFromVariant != null
        ? capFromVariant
        : null;

    let quantity = quantityRequested;
    if (maxAllowed != null)
      quantity = Math.max(1, Math.min(quantity, maxAllowed));

    // Resolve unit price: prefer DB if present, else use payload.unitPrice (already shown to customer)
    const unitPriceFromDb =
      asNumber(variant?.unitPrice) ??
      asNumber(variant?.price) ??
      asNumber(variant?.salePrice) ??
      asNumber(variant?.product?.price) ??
      null;

    const unitPriceFromPayload = asNumber(body.unitPrice);

    const unitPrice =
      unitPriceFromDb != null ? unitPriceFromDb : unitPriceFromPayload;

    if (unitPrice == null || unitPrice < 0) {
      return json({ ok: false, error: "PRICE_UNAVAILABLE" }, 400);
    }

    const cart = await getOrCreateActiveCart({ userId, sid, currency });

    // Add like "Add to Cart" (increment if already exists)
    await prisma.$transaction(async (tx) => {
      const existing = await tx.cartItem.findFirst({
        where: { cartId: cart.id, variantId: variant.id },
      });

      const nextQty = existing
        ? clampInt(Number(existing.quantity || 0) + quantity, 1, 9999)
        : quantity;

      const nextSubtotal = (unitPrice * nextQty).toFixed(2);

      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: {
            quantity: nextQty,
            unitPrice: new Prisma.Decimal(unitPrice.toFixed(2)),
            subtotal: new Prisma.Decimal(nextSubtotal),
          },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            variantId: variant.id,
            quantity: nextQty,
            unitPrice: new Prisma.Decimal(unitPrice.toFixed(2)),
            subtotal: new Prisma.Decimal(nextSubtotal),
          },
        });
      }

      // Touch cart for ordering
      await tx.cart.update({
        where: { id: cart.id },
        data: { updatedAt: new Date() },
      });
    });

    const totals = await recalcCartTotals(cart.id);

    const res = json({
      ok: true,
      cartId: cart.id,
      itemCount: totals.itemCount,
    });

    // Set guest sid cookie if created (SESSION cookie)
    if (createdSid && sid) {
      res.cookies.set({
        name: "tdlc_sid",
        value: sid,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });

      // Clear legacy aliases to avoid ambiguity
      res.cookies.set({
        name: "cart_sid",
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      res.cookies.set({
        name: "guest_sid",
        value: "",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
    }

    // Buy-now no longer drives checkout flows; clear any old buy-now marker cookies (if any exist)
    res.cookies.set({
      name: "buy_now",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    res.cookies.set({
      name: "tdlc_buy_now",
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

    return res;
  } catch (err) {
    console.error("buy-now route error:", err);
    return json({ ok: false, error: "BUY_NOW_FAILED" }, 500);
  }
}
