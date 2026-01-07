// PATH: app/api/cart/items/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

const DEFAULT_CURRENCY = "BDT";
const SID_COOKIE = "tdlc_sid";

/* ───────────────────────── helpers: numbers & safe values ───────────────────────── */

/** Safe decimal → number */
function num(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

const safeVal = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
};

const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    const sv = safeVal(v);
    if (sv !== null) return sv;
  }
  return null;
};

/* ───────────────────────── helpers: session & user ───────────────────────── */

/**
 * Create or read a stable anonymous cart-session id in cookie.
 * Unified on SID_COOKIE = "tdlc_sid", but still honours legacy "cart_session".
 */
function getOrSetSessionId() {
  const jar = cookies();

  let sid =
    jar.get(SID_COOKIE)?.value ||
    jar.get("cart_session")?.value || // legacy
    null;

  if (!sid) {
    sid = `cs_${Math.random().toString(36).slice(2)}_${Date.now().toString(
      36
    )}`;
  }

  // Set unified cookie
  jar.set(SID_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90 days
  });

  return sid;
}

/** Get user from session (if signed in) */
async function getUserId() {
  try {
    const s = await auth();
    return s?.user?.id || null;
  } catch {
    return null;
  }
}

/* ───────────────────────── helpers: variant metadata & stock ───────────────────────── */

/**
 * Derive size & color from variant.optionValues when metadata is empty.
 * Uses ProductOption.name ("Size", "Color", "Colour", etc.).
 */
function deriveSizeColorFromVariantOptions(variant) {
  const out = { size: null, color: null };
  if (!variant || !Array.isArray(variant.optionValues)) return out;

  for (const link of variant.optionValues) {
    const ov = link?.optionValue;
    const opt = ov?.option;
    if (!ov || !opt) continue;

    const name = String(opt.name || "").toLowerCase();
    const value = ov.value;
    if (!value) continue;

    if (!out.size && name.includes("size")) {
      out.size = value;
    }
    if (
      !out.color &&
      (name.includes("color") ||
        name.includes("colour") ||
        name.includes("colorway"))
    ) {
      out.color = value;
    }
  }

  return out;
}

/**
 * Get first image URL from variant/product media (via MediaAsset).
 */
function resolveImageFromVariantAndProduct(variant, product) {
  // Variant-level media first
  if (Array.isArray(variant?.media) && variant.media.length) {
    const m = variant.media[0];
    const url = m?.media?.url || m?.url;
    if (url) return url;
  }

  // Product-level media next
  if (Array.isArray(product?.media) && product.media.length) {
    const m = product.media[0];
    const url = m?.media?.url || m?.url;
    if (url) return url;
  }

  return undefined;
}

/**
 * Read net available quantity from a single InventoryItem row.
 * This is deliberately tolerant to multiple naming schemes:
 * - available / availableQty / availableQuantity
 * - stockAvailable / stockQuantity
 * - onHand / reserved / safetyStock
 * - reservedQuantity / reservedQty / allocated
 */
function resolveInventoryNet(inv) {
  if (!inv) return null;

  const baseCandidates = [
    inv.available,
    inv.availableQty,
    inv.availableQuantity,
    inv.stockAvailable,
    inv.stockAvailableQty,
    inv.stockQuantity,
    inv.quantityOnHand,
    inv.onHand,
  ];

  let base = null;
  for (const v of baseCandidates) {
    if (v != null && Number.isFinite(num(v, NaN))) {
      base = num(v, 0);
      break;
    }
  }

  if (base === null) {
    // No signal at all → treat as "no data"
    return null;
  }

  const reservedCandidates = [
    inv.reserved,
    inv.reservedQty,
    inv.reservedQuantity,
    inv.allocated,
    inv.stockReserved,
  ];
  let reserved = 0;
  for (const v of reservedCandidates) {
    if (v != null && Number.isFinite(num(v, NaN))) {
      reserved = num(v, 0);
      break;
    }
  }

  const safetyCandidates = [
    inv.safetyStock,
    inv.buffer,
    inv.bufferStock,
    inv.minStock,
  ];
  let safety = 0;
  for (const v of safetyCandidates) {
    if (v != null && Number.isFinite(num(v, NaN))) {
      safety = num(v, 0);
      break;
    }
  }

  const net = base - reserved - safety;
  return net;
}

/**
 * Read available stock for a variant (server truth-ish for add-to-cart)
 * IMPORTANT: 0 is treated as **real stock (sold out)**, not as "no data".
 *
 * It looks at:
 * - productVariant.stockAvailable / availableQty / inventoryQty / stockOnHand
 * - InventoryItem rows: available / stockQuantity / onHand - reserved - safety
 */
function resolveVariantAvailableStock(variant) {
  if (!variant) return null;

  const candidates = [];

  // direct numeric hints on variant
  if (variant.stockAvailable != null)
    candidates.push(num(variant.stockAvailable));
  if (variant.availableQty != null) candidates.push(num(variant.availableQty));
  if (variant.availableQuantity != null)
    candidates.push(num(variant.availableQuantity));
  if (variant.inventoryQty != null) candidates.push(num(variant.inventoryQty));

  if (variant.stockOnHand != null) {
    const onHand = num(variant.stockOnHand);
    const reserved = num(variant.stockReserved ?? variant.stockAllocated, 0);
    candidates.push(onHand - reserved);
  }

  // also derive from InventoryItem rows if present
  if (Array.isArray(variant.inventoryItems) && variant.inventoryItems.length) {
    for (const inv of variant.inventoryItems) {
      const net = resolveInventoryNet(inv);
      if (net != null) {
        candidates.push(net);
      }
    }
  }

  // 0 is a valid value (sold out) – we only discard NaN / non-finite
  const vals = candidates
    .map((v) => num(v, NaN))
    .filter((v) => Number.isFinite(v));

  if (!vals.length) {
    // truly no stock information from any source
    return null;
  }

  // We take the max net quantity; if this is 0 or negative → OUT OF STOCK.
  const max = Math.max(...vals);
  return max;
}

/* ───────────────────────── helpers: cart & totals ───────────────────────── */

/** Find or create the active cart for a user/session */
async function getActiveCart({ userId, sessionId, currency = DEFAULT_CURRENCY }) {
  // Prefer user cart, fall back to session cart
  let cart = null;

  if (userId) {
    cart = await prisma.cart.findFirst({
      where: { userId, status: "ACTIVE" },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!cart) {
    cart = await prisma.cart.findFirst({
      where: { sessionId, status: "ACTIVE" },
      include: { items: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!cart) {
    cart = await prisma.cart.create({
      data: {
        userId: userId || null,
        sessionId,
        status: "ACTIVE",
        currency,
      },
      include: { items: true },
    });
  } else if (userId && !cart.userId) {
    // attach anonymous cart to user once logged in
    try {
      cart = await prisma.cart.update({
        where: { id: cart.id },
        data: { userId },
        include: { items: true },
      });
    } catch {
      // ignore race
    }
  }
  return cart;
}

/** Choose a base price from Price[] in given currency; prefer variant prices, then product prices */
function pickBasePrice({
  variantPrices = [],
  productPrices = [],
  currency = DEFAULT_CURRENCY,
}) {
  const filterByCurrency = (rows) =>
    (rows || []).filter((p) => String(p.currency) === currency);
  const v = filterByCurrency(variantPrices);
  const p = filterByCurrency(productPrices);

  const list = v.length ? v : p;
  if (!list.length) return null;

  const retail = list.find((r) => r.minQty === 1) || list[0];
  return list.reduce(
    (best, r) => (num(r.amount) < num(best.amount) ? r : best),
    retail
  );
}

/** Resolve the frozen unit price using Strapi-synced discount fields */
function resolveUnitPrice({ discountAllowed, discountPrice, baseAmount }) {
  const base = num(baseAmount);
  const dAllowed = !!discountAllowed;
  const dPrice = num(discountPrice, 0);
  if (dAllowed && dPrice > 0 && (base === 0 || dPrice < base)) return dPrice;
  return base;
}

/**
 * Recalculate cart monetary totals (line prices already include per-product discount).
 * Also **hard-cleans** any 0 / negative quantity cart items so they can never ghost.
 *
 * Full canonical VAT + shipping logic lives in /api/cart & /api/orders/place.
 */
async function recalcCartTotals(cartId) {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    select: { id: true, quantity: true, unitPrice: true },
  });

  // ── HARD GHOST CLEANUP: delete any 0 or negative quantity lines ──
  const badIds = items
    .filter((it) => num(it.quantity, 0) <= 0)
    .map((it) => it.id);

  if (badIds.length) {
    await prisma.cartItem.deleteMany({
      where: { id: { in: badIds } },
    });
  }

  const cleaned = badIds.length
    ? items.filter((it) => !badIds.includes(it.id))
    : items;

  const subtotal = cleaned.reduce(
    (s, it) => s + num(it.unitPrice) * Math.max(1, num(it.quantity, 1)),
    0
  );

  const cart = await prisma.cart.findUnique({ where: { id: cartId } });
  const discountTotal = num(cart?.discountTotal, 0);
  const taxTotal = num(cart?.taxTotal, 0);
  const shippingTotal = num(cart?.shippingTotal, 0);
  const grandTotal = subtotal - discountTotal + taxTotal + shippingTotal;

  return prisma.cart.update({
    where: { id: cartId },
    data: {
      subtotal,
      grandTotal,
    },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: {
                include: {
                  media: {
                    include: { media: true },
                  },
                  prices: true,
                },
              },
              media: {
                include: { media: true },
              },
              optionValues: {
                include: {
                  optionValue: {
                    include: { option: true },
                  },
                },
              },
              prices: true,
              inventoryItems: true,
            },
          },
        },
      },
    },
  });
}

/* ───────────────────────── shape helper ───────────────────────── */

function shapeCartItems(items) {
  return items
    .filter((it) => num(it.quantity, 0) > 0) // extra safety: never shape 0-qty ghosts
    .map((it) => {
      const v = it.variant || {};
      const p = v.product || {};
      const md = it.metadata || {};

      const { size: derivedSize, color: derivedColor } =
        deriveSizeColorFromVariantOptions(v);

      const size = firstNonEmpty(
        md.size,
        md.size_name,
        md.sizeName,
        md.selectedSize,
        v.sizeLabel,
        v.sizeName,
        v.size_name,
        v.size,
        p.sizeLabel,
        p.sizeName,
        p.size_name,
        p.size,
        derivedSize
      );

      const color = firstNonEmpty(
        md.color,
        md.colour,
        md.color_name,
        md.colorName,
        v.colorLabel,
        v.colorName,
        v.color_name,
        v.color,
        p.colorLabel,
        p.colorName,
        p.color_name,
        p.color,
        derivedColor
      );

      const fabric = firstNonEmpty(
        md.fabric,
        md.fabricName,
        v.fabric,
        v.fabricName,
        p.fabric,
        p.fabricName,
        p.material
      );

      const gsm = firstNonEmpty(
        md.gsm,
        md.gsmValue,
        v.gsm,
        v.gsmValue,
        p.gsm,
        p.gsmValue
      );

      const fit = firstNonEmpty(
        md.fit,
        md.fitName,
        v.fit,
        v.fitName,
        p.fit,
        p.fitName
      );

      const sku = firstNonEmpty(
        it.sku,
        md.sku,
        md.skuCode,
        v.sku,
        v.skuCode,
        v.sku_code,
        p.sku,
        p.skuCode,
        p.sku_code
      );

      const barcode = firstNonEmpty(
        md.barcode,
        md.barCode,
        md.ean,
        md.ean13,
        md.barcode_ean13,
        it.barcode,
        it.barCode,
        v.barcode,
        v.barCode,
        v.ean13,
        v.ean,
        v.barcodeEan13,
        v.barcode_ean13,
        p.barcode,
        p.barCode,
        p.ean13,
        p.ean,
        p.barcodeEan13,
        p.barcode_ean13
      );

      const pid = firstNonEmpty(
        md.productId,
        md.pid,
        p.id != null ? String(p.id) : null,
        p.slug
      );

      const vidRaw = firstNonEmpty(
        md.variantId,
        md.vid,
        v.id != null ? String(v.id) : null
      );

      const vid = pid && vidRaw && vidRaw === pid ? null : vidRaw;

      const metaImage = firstNonEmpty(
        md.thumbnail,
        md.thumbnailUrl,
        md.thumb,
        md.image,
        md.imageUrl
      );
      const dbImage = resolveImageFromVariantAndProduct(v, p);
      const image = firstNonEmpty(it.image, metaImage, dbImage);

      const quantity = num(it.quantity, 0);
      const unitPrice = num(it.unitPrice, 0);
      const lineTotal = quantity * unitPrice;
      const maxAvailable = resolveVariantAvailableStock(v);

      return {
        id: it.id,
        lineId: it.id,

        variantId: v.id || it.variantId || null,
        variant_id: v.id || it.variantId || null,
        productId: p.id || null,
        product_id: p.id || null,
        pid: pid || null,
        vid: vid || (v.id != null ? String(v.id) : null),

        title: it.title || v.title || p.title || p.name || "",

        sku,
        barcode,
        size,
        color,
        fabric,
        gsm,
        fit,

        quantity,
        price: unitPrice,
        unitPrice,
        unit_price: unitPrice,
        lineTotal,
        line_total: lineTotal,
        subtotal: lineTotal,

        image,
        thumbnail: image,

        maxAvailable,
        stockAvailable: maxAvailable,
        stock_available: maxAvailable,

        variant: v,
        product: p,
        metadata: md,
      };
    });
}

/* ───────────────────────── handlers ───────────────────────── */

/**
 * POST /api/cart/items
 * Body: { variantId: string, quantity?: number, currency?: Currency, metadata?: any }
 *
 * STOCK RULE:
 *  - Never allow total quantity in the cart to exceed available stock for that variant.
 *  - If availableStock = 0 → OUT_OF_STOCK, hard blocked.
 */
export async function POST(req) {
  try {
    const ip =
      headers().get("x-real-ip") ||
      headers().get("x-forwarded-for") ||
      "";
    const ua = headers().get("user-agent") || "";
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "INVALID_PAYLOAD" }, { status: 400 });
    }

    const variantId = String(body.variantId || "").trim();
    const requestedQty = Math.max(1, Math.floor(Number(body.quantity) || 1));
    const currency = String(body.currency || DEFAULT_CURRENCY).toUpperCase();

    if (!variantId) {
      return NextResponse.json(
        { error: "MISSING_VARIANT" },
        { status: 400 }
      );
    }

    // Load variant, product, prices, options & inventory hints
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        prices: true, // variant-level prices
        product: {
          include: {
            prices: true,
            media: { include: { media: true } },
          },
        },
        media: { include: { media: true } },
        optionValues: {
          include: {
            optionValue: {
              include: { option: true },
            },
          },
        },
        inventoryItems: true,
      },
    });

    if (!variant) {
      return NextResponse.json(
        { error: "VARIANT_NOT_FOUND" },
        { status: 404 }
      );
    }

    const basePriceRow = pickBasePrice({
      variantPrices: variant.prices,
      productPrices: variant.product?.prices || [],
      currency,
    });
    const baseAmount = basePriceRow ? num(basePriceRow.amount, 0) : 0;

    // Strapi-synced fields on variant (add to schema if not present yet)
    const discountAllowed = !!variant.discountAllowed;
    const discountPrice = num(variant.discountPrice, 0);

    const frozenUnitPrice = resolveUnitPrice({
      discountAllowed,
      discountPrice,
      baseAmount,
    });

    if (!Number.isFinite(frozenUnitPrice) || frozenUnitPrice <= 0) {
      return NextResponse.json(
        { error: "PRICE_NOT_AVAILABLE" },
        { status: 409 }
      );
    }

    const userId = await getUserId();
    const sessionId = getOrSetSessionId();
    const cart = await getActiveCart({ userId, sessionId, currency });

    const existing = await prisma.cartItem.findFirst({
      where: { cartId: cart.id, variantId },
    });

    const availableStock = resolveVariantAvailableStock(variant);
    const currentQty = existing ? num(existing.quantity, 0) : 0;

    // If we do have stock tracked on variant/inventory, hard-enforce the max here
    let finalQty;
    let limited = false;

    if (availableStock != null) {
      if (availableStock <= 0) {
        // Known: out of stock (0 or negative net)
        return NextResponse.json(
          {
            error: "OUT_OF_STOCK",
            available: 0,
          },
          { status: 409 }
        );
      }

      const desiredTotal = currentQty + requestedQty;
      finalQty = Math.min(desiredTotal, availableStock);

      if (finalQty <= currentQty) {
        // Already at or above stock cap in cart
        return NextResponse.json(
          {
            error: "LIMIT_EXCEEDED",
            message:
              "You already have the maximum available quantity in your bag.",
            available: availableStock,
          },
          { status: 409 }
        );
      }

      if (finalQty < desiredTotal) {
        limited = true;
      }
    } else {
      // No stock info yet → do not limit here (final clamp is at order time)
      finalQty = currentQty + requestedQty;
    }

    let line;
    if (existing) {
      // keep original frozen price; only bump quantity within allowed range
      const lineUnit = num(existing.unitPrice, frozenUnitPrice);
      line = await prisma.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: finalQty,
          subtotal: finalQty * lineUnit,
        },
      });
    } else {
      line = await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          variantId,
          quantity: finalQty,
          unitPrice: frozenUnitPrice,
          subtotal: frozenUnitPrice * finalQty,
          metadata: {
            currency,
            baseAmount,
            discountApplied:
              discountAllowed &&
              discountPrice > 0 &&
              discountPrice < baseAmount,
            compareAt: baseAmount > frozenUnitPrice ? baseAmount : null,
            ip,
            ua,
            addedAt: new Date().toISOString(),
            ...(body.metadata || {}),
          },
        },
      });
    }

    const updated = await recalcCartTotals(cart.id);
    const shapedItems = shapeCartItems(updated.items);

    return NextResponse.json({
      ok: true,
      limited,
      cartId: updated.id,
      currency: updated.currency,
      totals: {
        subtotal: updated.subtotal,
        discountTotal: updated.discountTotal,
        taxTotal: updated.taxTotal,
        shippingTotal: updated.shippingTotal,
        grandTotal: updated.grandTotal,
      },
      items: shapedItems,
    });
  } catch (e) {
    console.error("[api/cart/items][POST] error", e);
    return NextResponse.json(
      { error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cart/items
 * Body: { itemId?: string, variantId?: string }
 * Removes a line from the active cart.
 * Any 0-qty leftovers are cleaned by recalcCartTotals, so no ghost lines remain.
 */
export async function DELETE(req) {
  try {
    const body = await req.json().catch(() => null);
    const itemId = body?.itemId ? String(body.itemId) : null;
    const variantId = body?.variantId ? String(body.variantId) : null;

    if (!itemId && !variantId) {
      return NextResponse.json(
        { error: "MISSING_IDENTIFIER" },
        { status: 400 }
      );
    }

    const userId = await getUserId();
    const sessionId = getOrSetSessionId();
    const cart = await getActiveCart({ userId, sessionId });

    const where = itemId
      ? { id: itemId, cartId: cart.id }
      : { cartId: cart.id, variantId };
    const found = await prisma.cartItem.findFirst({ where });

    if (!found) {
      return NextResponse.json(
        { error: "LINE_NOT_FOUND" },
        { status: 404 }
      );
    }

    await prisma.cartItem.delete({ where: { id: found.id } });
    const updated = await recalcCartTotals(cart.id);
    const shapedItems = shapeCartItems(updated.items);

    return NextResponse.json({
      ok: true,
      cartId: updated.id,
      currency: updated.currency,
      totals: {
        subtotal: updated.subtotal,
        discountTotal: updated.discountTotal,
        taxTotal: updated.taxTotal,
        shippingTotal: updated.shippingTotal,
        grandTotal: updated.grandTotal,
      },
      items: shapedItems,
    });
  } catch (e) {
    console.error("[api/cart/items][DELETE] error", e);
    return NextResponse.json(
      { error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
