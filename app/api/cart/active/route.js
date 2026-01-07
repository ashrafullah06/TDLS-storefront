// FILE: app/api/cart/active/route.js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import crypto from "crypto";

function j(body, status = 200) {
  return new NextResponse(body === undefined ? "null" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isValidSid(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  if (s.length < 8 || s.length > 128) return false;
  // allow uuid / base64url-ish / random tokens
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return false;
  return true;
}

function newSid() {
  // Prefer UUID; fall back to random bytes
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(18).toString("base64url");
}

function getExistingSid(jar) {
  // tolerate older names, but we will normalize to tdlc_sid
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

export async function GET() {
  try {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id || null;

    const jar = cookies();

    // Ensure every guest has a stable, unique session id cookie.
    // If missing/invalid, create it NOW to prevent cross-user cart leakage.
    let sid = getExistingSid(jar);
    let createdSid = false;

    if (!userId) {
      if (!sid) {
        sid = newSid();
        createdSid = true;
      }
    }

    // IMPORTANT: Never query "ACTIVE cart" without an identity.
    // This prevents returning someone else's cart for guests.
    let cart = null;

    if (userId) {
      cart = await prisma.cart.findFirst({
        where: { userId, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                  optionValues: {
                    include: { optionValue: { include: { option: true } } },
                  },
                },
              },
            },
          },
          promotions: { include: { promotion: true } },
        },
      });
    } else if (sid) {
      cart = await prisma.cart.findFirst({
        where: { sessionId: sid, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: true,
                  optionValues: {
                    include: { optionValue: { include: { option: true } } },
                  },
                },
              },
            },
          },
          promotions: { include: { promotion: true } },
        },
      });
    } else {
      // This should not happen because we create sid for guests above,
      // but keep it as a hard safety net.
      cart = null;
    }

    // Build response
    let res;
    if (!cart) {
      res = j({ ok: true, cart: null, itemCount: 0 });
    } else {
      // Filter out ghost / legacy rows: only positive-qty items with real variantId
      const validItems = cart.items.filter(
        (it) => Number(it.quantity || 0) > 0 && it.variantId
      );

      const itemCount = validItems.reduce(
        (s, it) => s + Number(it.quantity || 0),
        0
      );

      res = j({
        ok: true,
        cart: {
          id: cart.id,
          currency: cart.currency,
          subtotal: Number(cart.subtotal),
          discountTotal: Number(cart.discountTotal),
          taxTotal: Number(cart.taxTotal),
          shippingTotal: Number(cart.shippingTotal),
          grandTotal: Number(cart.grandTotal),
          items: validItems.map((it) => ({
            id: it.id,
            variantId: it.variantId,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            subtotal: Number(it.subtotal),
            productTitle: it.variant?.product?.title || null,
            sku: it.variant?.sku || null,
            options:
              it.variant?.optionValues?.map((ov) => ({
                option: ov.optionValue?.option?.name,
                value: ov.optionValue?.value,
              })) || [],
          })),
          promotions: cart.promotions.map((cp) => ({
            id: cp.promotionId,
            code: cp.promotion?.code || null,
            type: cp.promotion?.type || null,
            value:
              cp.promotion?.value != null ? Number(cp.promotion.value) : null,
          })),
        },
        itemCount,
      });
    }

    // If we had to create a guest sid, set it as a SESSION cookie (no maxAge)
    // so guest carts are isolated per browser session and do not become "global".
    if (createdSid && sid) {
      res.cookies.set({
        name: "tdlc_sid",
        value: sid,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        // no maxAge/expires => session cookie
      });

      // Optional hardening: clear old legacy cookie names if they existed
      // (prevents ambiguity if other routes still read them)
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

    return res;
  } catch (err) {
    console.error("cart/active error:", err);
    return j({ ok: false, error: "ACTIVE_CART_FAILED" }, 500);
  }
}
