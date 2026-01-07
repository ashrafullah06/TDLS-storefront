// FILE: app/api/cart/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import prisma from "@/lib/prisma";
import { cookies as cookiesFn, headers as headersFn } from "next/headers";
import { auth } from "@/lib/auth";
// NOTE: leaving import here for other callers, but we no longer rely on it in this route
import { computeTotalsCanonical as _unusedComputeTotalsCanonical } from "@/lib/cart-totals";
import { randomUUID } from "crypto";

/* ───────────────────────── helpers ───────────────────────── */

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
  vary: "Cookie",
};

const n = (v) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const nOr = (v, fallback) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};
const nz = (v) => {
  const x = n(v);
  return x > 0 && Number.isFinite(x) ? x : 0;
};
const round = (v, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round(n(v) * f) / f;
};

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

/**
 * Common include for all Cart → CartItem → Variant → Product/Media/Options
 * so the cart & checkout can show size, color, image, etc.
 * Also includes shippingAddress so totals can use admin/Strapi shipping rules.
 */
const CART_INCLUDE = {
  items: {
    include: {
      variant: {
        include: {
          // Product + its media
          product: {
            include: {
              media: {
                include: {
                  media: true,
                },
              },
            },
          },
          // Variant-level ProductMedia → MediaAsset
          media: {
            include: {
              media: true,
            },
          },
          // Variant options (Size, Color, etc.)
          optionValues: {
            include: {
              optionValue: {
                include: {
                  option: true,
                },
              },
            },
          },
          // Inventory rows for accurate stockAvailable
          inventoryItems: true,
        },
      },
    },
  },
  shippingAddress: true,
  promotions: true,
};

/** STOCK helper – same idea as in /api/cart/items */
function resolveVariantAvailableStock(variant) {
  if (!variant) return null;

  const candidates = [];

  // direct numeric hints (if you ever add them to ProductVariant)
  if (variant.stockAvailable != null) candidates.push(n(variant.stockAvailable));
  if (variant.availableQty != null) candidates.push(n(variant.availableQty));
  if (variant.inventoryQty != null) candidates.push(n(variant.inventoryQty));

  if (variant.stockOnHand != null) {
    const onHand = n(variant.stockOnHand);
    const reserved = n(variant.stockReserved ?? variant.stockAllocated, 0);
    candidates.push(onHand - reserved);
  }

  // also derive from InventoryItem rows if present
  if (Array.isArray(variant.inventoryItems) && variant.inventoryItems.length) {
    for (const inv of variant.inventoryItems) {
      const onHand = n(inv.onHand);
      const reserved = n(inv.reserved);
      const net = onHand - reserved;
      if (net > 0) candidates.push(net);
    }
  }

  const positives = candidates.filter((v) => Number.isFinite(v) && v > 0);
  if (!positives.length) return null;
  return Math.max(...positives);
}

/**
 * Compute per-line discount purely for UI / display.
 * Totals (discount, shipping, tax) come from computeTotalsFromCart.
 */
function computeLineDiscount(line) {
  const qty = Math.max(0, n(line.quantity));
  const unit = n(line.unitPrice ?? line.price);

  const md = line.metadata || {};
  const originalCandidate =
    n(md.originalUnitPrice) || n(md.mrp) || n(md.compareAt) || unit;

  const byOriginalGap = Math.max(0, originalCandidate - unit);
  const byFlat = nz(md.discountFlat) || nz(md.strapiDiscount) || 0;
  const rawPct = n(md.discountPct);
  const pctNorm = rawPct > 1 ? rawPct / 100 : rawPct; // tolerate 10 vs 0.10
  const byPct =
    Math.max(0, pctNorm) > 0 ? Math.max(0, originalCandidate * pctNorm) : 0;

  const perUnitDiscount = Math.max(byOriginalGap, byFlat, byPct);

  return {
    originalUnitPrice: originalCandidate,
    discountPerUnit: perUnitDiscount,
    lineDiscountTotal: Math.max(0, perUnitDiscount * qty),
    promotionId: typeof md.promotionId === "string" ? md.promotionId : null,
  };
}

function parseCookies(raw = "") {
  const out = {};
  (raw || "").split(";").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > -1) {
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

/** Next.js 15+: headers()/cookies() must be awaited */
async function getCookieStore() {
  return await cookiesFn();
}
async function getHeaders() {
  return await headersFn();
}

/**
 * Read ONLY the session ids we actually use for carts now.
 *
 * Primary (and ONLY): tdlc_sid
 *
 * We intentionally ignore legacy cookies like `cart_session_id` / `cart_session`
 * to avoid old ghost carts leaking into the active checkout.
 */
async function readAllPossibleSessionIds() {
  const store = await getCookieStore();
  const h = await getHeaders();
  const parsed = parseCookies(h.get("cookie") || "");

  const names = ["tdlc_sid"]; // 🔴 legacy names removed
  const candidates = [];

  for (const name of names) {
    const v1 = (store.get(name)?.value || "").trim();
    const v2 = (parsed[name] || "").trim();
    if (v1) candidates.push(v1);
    if (v2) candidates.push(v2);
  }

  const seen = new Set();
  return candidates.filter((x) => {
    if (!x) return false;
    if (seen.has(x)) return false;
    seen.add(x);
    return true;
  });
}

/**
 * Ensure a guest has a unique cart session id cookie.
 * This prevents “anonymous/shared guest cart” behavior.
 */
async function ensureGuestSid() {
  const store = await getCookieStore();
  const existing = (store.get("tdlc_sid")?.value || "").trim();
  if (existing) return existing;

  const sid = `gs_${randomUUID()}`;
  store.set("tdlc_sid", sid, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90, // 90 days
  });

  return sid;
}

/** Clear all cart-related cookies ... */
async function clearAllCartCookies() {
  const store = await getCookieStore();
  const names = [
    "cart_session_id",
    "cart_session",
    "cartSession",
    "cartId",
    "cart",
    "sid",
    "sessionId",
    "next-cart",
    "__cart",
    "__cartSession",
    "tdlc_sid", // primary
  ];
  for (const name of names) {
    store.set(name, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: new Date(0),
    });
  }
}

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

    if (!out.size && name.includes("size")) out.size = value;

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

/* ───────────────────────── shipping / VAT / promo helpers ───────────────────────── */

let _shippingCache = { value: null, fetchedAt: 0 };

async function getShippingSettings() {
  const now = Date.now();
  const TTL = 5 * 60 * 1000;

  if (_shippingCache.value && now - _shippingCache.fetchedAt < TTL) {
    return _shippingCache.value;
  }

  let value;
  try {
    if (!prisma.appSetting?.findUnique) {
      value = {
        inside: [],
        rateInside: 0,
        rateOutside: 0,
        thrInside: Infinity,
        thrOutside: Infinity,
      };
    } else {
      const s = await prisma.appSetting
        .findUnique({ where: { key: "shipping" } })
        .catch(() => null);
      const v = s?.value ?? {};
      value = {
        inside: Array.isArray(v?.inside_dhaka_localities)
          ? v.inside_dhaka_localities
              .map((x) => String(x || "").trim().toLowerCase())
              .filter(Boolean)
          : [],
        rateInside: nOr(v?.rate_inside, 0),
        rateOutside: nOr(v?.rate_outside, 0),
        thrInside: nOr(v?.free_threshold_inside, Infinity),
        thrOutside: nOr(v?.free_threshold_outside, Infinity),
      };
    }
  } catch {
    value = {
      inside: [],
      rateInside: 0,
      rateOutside: 0,
      thrInside: Infinity,
      thrOutside: Infinity,
    };
  }

  _shippingCache = { value, fetchedAt: now };
  return value;
}

function isInsideDhaka(address, insideList) {
  const norm = (x) => String(x || "").trim().toLowerCase();

  const fields = [
    address?.city,
    address?.state,
    address?.adminLevel1,
    address?.adminLevel2,
    address?.adminLevel3,
    address?.adminLevel4,
    address?.locality,
    address?.sublocality,
  ].map(norm);

  if (fields.some((f) => f && f.includes("dhaka"))) return true;

  const overrideSet = new Set((insideList || []).map(norm));
  if (overrideSet.size && fields.some((f) => f && overrideSet.has(f)))
    return true;

  return false;
}

/* VAT settings cache (5 min) */
let _vatSettingsCache = { value: null, fetchedAt: 0 };

async function getVatSettings() {
  const now = Date.now();
  const TTL = 5 * 60 * 1000;

  if (_vatSettingsCache.value && now - _vatSettingsCache.fetchedAt < TTL) {
    return _vatSettingsCache.value;
  }

  let value;
  try {
    if (prisma.appSetting?.findUnique) {
      const vatSetting = await prisma.appSetting
        .findUnique({ where: { key: "vat" } })
        .catch(() => null);
      if (vatSetting?.value) {
        const v = vatSetting.value || {};
        value = {
          ratePct: nOr(v.rate_pct, 0),
          inclusive: Boolean(v.inclusive),
          applyOn: String(v.apply_on || "SUBTOTAL").toUpperCase(),
        };
      }
    }

    if (!value && prisma.financeConfig?.findMany) {
      const fc = await prisma.financeConfig
        .findMany({
          where: { key: "VAT_DEFAULT" },
          orderBy: [{ effectiveFrom: "desc" }],
          take: 1,
        })
        .catch(() => []);
      if (fc?.[0]?.valueJson) {
        const v = fc[0].valueJson || {};
        value = {
          ratePct: nOr(v.rate_pct, 0),
          inclusive: Boolean(v.inclusive),
          applyOn: String(v.apply_on || "SUBTOTAL").toUpperCase(),
        };
      }
    }

    if (!value) value = { ratePct: 0, inclusive: false, applyOn: "SUBTOTAL" };
  } catch {
    value = { ratePct: 0, inclusive: false, applyOn: "SUBTOTAL" };
  }

  _vatSettingsCache = { value, fetchedAt: now };
  return value;
}

async function getPromotionTotal(cartId) {
  if (!cartId) return 0;
  try {
    if (!prisma.cartPromotion?.findMany) return 0;
    const promos = await prisma.cartPromotion
      .findMany({ where: { cartId } })
      .catch(() => []);
    return promos.reduce((s, p) => s + n(p.amountApplied), 0);
  } catch {
    return 0;
  }
}

/**
 * Canonical totals for this route – recomputed from DB cart lines.
 * We DO NOT trust any stale cart.subtotal – this uses quantity × unitPrice.
 */
async function computeTotalsFromCart({ items, shippingAddress, cartId }) {
  // Filter out legacy / ghost lines: only positive-qty items with a real variantId
  const lineItems = (Array.isArray(items) ? items : []).filter(
    (it) => n(it.quantity) > 0 && it.variantId
  );

  const subtotal = lineItems.reduce((sum, it) => {
    const qty = Math.max(0, n(it.quantity));
    const unit = n(it.unitPrice ?? it.price);
    return sum + qty * unit;
  }, 0);

  const promoTotal = Math.abs(await getPromotionTotal(cartId));
  const discountTotal = Math.min(subtotal, promoTotal);

  const shipCfg = await getShippingSettings();
  const insideDhaka = isInsideDhaka(shippingAddress || {}, shipCfg.inside);
  const rate = insideDhaka ? shipCfg.rateInside : shipCfg.rateOutside;
  const freeThr = insideDhaka ? shipCfg.thrInside : shipCfg.thrOutside;
  const afterDiscount = Math.max(0, subtotal - discountTotal);
  const shippingTotal = afterDiscount >= freeThr ? 0 : rate;

  const vatCfg = await getVatSettings();
  const base =
    vatCfg.applyOn === "SUBTOTAL_PLUS_SHIPPING"
      ? afterDiscount + shippingTotal
      : afterDiscount;

  let taxTotal = 0;
  if (vatCfg.ratePct > 0) {
    if (vatCfg.inclusive) {
      const pct = vatCfg.ratePct / 100;
      taxTotal = base > 0 ? (base * pct) / (1 + pct) : 0;
    } else {
      taxTotal = base * (vatCfg.ratePct / 100);
    }
  }

  const grandTotal =
    (vatCfg.inclusive ? afterDiscount : afterDiscount + taxTotal) +
    shippingTotal;

  const D = (x) => {
    const v = Number(x);
    return Number.isFinite(v) ? v.toFixed(2) : "0.00";
  };

  return {
    subtotal: D(subtotal),
    discountTotal: D(discountTotal),
    taxTotal: D(taxTotal),
    shippingTotal: D(shippingTotal),
    grandTotal: D(grandTotal),
  };
}

/** Shape response for the frontend. Also echo per-line discount. */
function respondCartObject(cart) {
  if (!cart) {
    const totals = {
      subtotal: 0,
      discount: 0,
      discountTotal: 0,
      tax: 0,
      taxTotal: 0,
      shipping: 0,
      shippingTotal: 0,
      grandTotal: 0,
      total: 0,
      currency: "BDT",
      itemCount: 0,
      totalQty: 0,
    };

    return {
      ok: true,
      id: null,
      cartId: null,
      currency: totals.currency,
      items: [],
      itemCount: 0,
      totalQty: 0,
      subtotal: totals.subtotal,
      discount: totals.discount,
      discountTotal: totals.discountTotal,
      tax: totals.tax,
      taxTotal: totals.taxTotal,
      shipping: totals.shipping,
      shippingTotal: totals.shippingTotal,
      grandTotal: totals.grandTotal,
      total: totals.total,
      totals,
    };
  }

  const sourceItems = (cart.items ?? []).filter(
    (l) => n(l.quantity) > 0 && l.variantId
  );

  const items = sourceItems.map((l) => {
    const d = computeLineDiscount(l);
    const variant = l.variant || {};
    const product = variant.product || {};
    const md = l.metadata || {};

    const { size: derivedSize, color: derivedColor } =
      deriveSizeColorFromVariantOptions(variant);

    const size = firstNonEmpty(
      md.size,
      md.size_name,
      md.sizeName,
      md.selectedSize,
      variant.sizeLabel,
      variant.sizeName,
      variant.size_name,
      variant.size,
      product.sizeLabel,
      product.sizeName,
      product.size_name,
      product.size,
      derivedSize
    );

    const color = firstNonEmpty(
      md.color,
      md.colour,
      md.color_name,
      md.colorName,
      variant.colorLabel,
      variant.colorName,
      variant.color_name,
      variant.color,
      product.colorLabel,
      product.colorName,
      product.color_name,
      product.color,
      derivedColor
    );

    const fabric = firstNonEmpty(
      md.fabric,
      md.fabricName,
      variant.fabric,
      variant.fabricName,
      product.fabric,
      product.fabricName,
      product.material
    );

    const gsm = firstNonEmpty(
      md.gsm,
      md.gsmValue,
      variant.gsm,
      variant.gsmValue,
      product.gsm,
      product.gsmValue
    );

    const fit = firstNonEmpty(
      md.fit,
      md.fitName,
      variant.fit,
      variant.fitName,
      product.fit,
      product.fitName
    );

    const sku = firstNonEmpty(
      l.sku,
      md.sku,
      md.skuCode,
      variant.sku,
      variant.skuCode,
      variant.sku_code,
      product.sku,
      product.skuCode,
      product.sku_code
    );

    const barcode = firstNonEmpty(
      md.barcode,
      md.barCode,
      md.ean,
      md.ean13,
      md.barcode_ean13,
      l.barcode,
      l.barCode,
      variant.barcode,
      variant.barCode,
      variant.ean13,
      variant.ean,
      variant.barcodeEan13,
      variant.barcode_ean13,
      product.barcode,
      product.barCode,
      product.ean13,
      product.ean,
      product.barcodeEan13,
      product.barcode_ean13
    );

    const pid = firstNonEmpty(
      md.productId,
      md.pid,
      product.id != null ? String(product.id) : null,
      product.slug
    );

    const vidRaw = firstNonEmpty(
      md.variantId,
      md.vid,
      variant.id != null ? String(variant.id) : null
    );

    const vid = pid && vidRaw && vidRaw === pid ? null : vidRaw;

    const maxAvailable = resolveVariantAvailableStock(variant);

    const metaImage = firstNonEmpty(
      md.thumbnail,
      md.thumbnailUrl,
      md.thumb,
      md.image,
      md.imageUrl
    );

    const dbImage = resolveImageFromVariantAndProduct(variant, product);

    const image = firstNonEmpty(l.image, metaImage, dbImage);

    const quantity = n(l.quantity);
    const unitPrice = n(l.unitPrice ?? l.price);
    const lineTotal = round(quantity * unitPrice, 2);

    return {
      id: l.id,
      lineId: l.id,

      variantId: variant.id || l.variantId || null,
      variant_id: variant.id || l.variantId || null,
      productId: product.id || null,
      product_id: product.id || null,
      pid: pid || null,
      vid: vid || (variant.id != null ? String(variant.id) : null),

      title: l.title || variant.title || product.title || product.name || undefined,
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

      discount: round(d.lineDiscountTotal, 2),
      discountPerUnit: round(d.discountPerUnit, 2),
      originalUnitPrice: round(d.originalUnitPrice, 2),
      compareAtPrice: round(d.originalUnitPrice, 2),
      lineDiscountTotal: round(d.lineDiscountTotal, 2),
      promotionId: d.promotionId,

      variant,
      product,
      metadata: md,
    };
  });

  const itemCount = items.length;
  const totalQty = items.reduce((sum, it) => sum + n(it.quantity), 0);

  const totals = {
    subtotal: n(cart.subtotal),
    discount: n(cart.discountTotal),
    discountTotal: n(cart.discountTotal),
    tax: n(cart.taxTotal),
    taxTotal: n(cart.taxTotal),
    shipping: n(cart.shippingTotal),
    shippingTotal: n(cart.shippingTotal),
    grandTotal: n(cart.grandTotal),
    total: n(cart.grandTotal),
    currency: cart.currency || "BDT",
    itemCount,
    totalQty,
  };

  return {
    ok: true,
    id: cart.id,
    cartId: cart.id,
    currency: totals.currency,
    items,
    itemCount,
    totalQty,
    subtotal: totals.subtotal,
    discount: totals.discount,
    discountTotal: totals.discountTotal,
    tax: totals.tax,
    taxTotal: totals.taxTotal,
    shipping: totals.shipping,
    shippingTotal: totals.shippingTotal,
    grandTotal: totals.grandTotal,
    total: totals.total,
    totals,
  };
}

/* ───────────────────────── core resolver ───────────────────────── */

const TERMINAL_STATUSES = ["CONVERTED", "ABANDONED"];

function pickNewest(carts = []) {
  if (!Array.isArray(carts) || carts.length === 0) return null;
  if (carts.length === 1) return carts[0];
  return carts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
}

/**
 * Ensure totals reflect lines; normalize status only if invalid/null.
 * SHIPPING + VAT are computed centrally via computeTotalsFromCart.
 */
async function ensureTotals(cart) {
  if (!cart) return null;

  const canonicalTotals = await computeTotalsFromCart({
    items: cart.items || [],
    shippingAddress: cart.shippingAddress || null,
    cartId: cart.id,
  });

  const nextStatus =
    cart.status && TERMINAL_STATUSES.includes(cart.status)
      ? cart.status
      : cart.status || "ACTIVE";

  const needsUpdate =
    String(cart.subtotal ?? "") !== String(canonicalTotals.subtotal ?? "") ||
    String(cart.discountTotal ?? "") !== String(canonicalTotals.discountTotal ?? "") ||
    String(cart.taxTotal ?? "") !== String(canonicalTotals.taxTotal ?? "") ||
    String(cart.shippingTotal ?? "") !== String(canonicalTotals.shippingTotal ?? "") ||
    String(cart.grandTotal ?? "") !== String(canonicalTotals.grandTotal ?? "") ||
    nextStatus !== cart.status;

  if (!needsUpdate) return cart;

  return prisma.cart.update({
    where: { id: cart.id },
    data: {
      subtotal: canonicalTotals.subtotal,
      discountTotal: canonicalTotals.discountTotal,
      taxTotal: canonicalTotals.taxTotal,
      shippingTotal: canonicalTotals.shippingTotal,
      grandTotal: canonicalTotals.grandTotal,
      status: nextStatus,
    },
    include: CART_INCLUDE,
  });
}

async function resolveCartWithMerge() {
  // Logged-in user?
  let userId = null;
  try {
    const session = await auth();
    userId = session?.user?.id || null;
  } catch {
    userId = null;
  }

  // If guest and no sid exists, mint one now.
  let cookieSessionIds = await readAllPossibleSessionIds();
  if (!userId && cookieSessionIds.length === 0) {
    const sid = await ensureGuestSid();
    cookieSessionIds = sid ? [sid] : [];
  }

  // 1) Try user non-terminal + guest non-terminal
  const [userNonTerminal, guestCandidates] = await Promise.all([
    userId
      ? prisma.cart.findFirst({
          where: { userId, NOT: { status: { in: TERMINAL_STATUSES } } },
          include: CART_INCLUDE,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve(null),
    cookieSessionIds.length
      ? prisma.cart.findMany({
          where: {
            sessionId: { in: cookieSessionIds },
            NOT: { status: { in: TERMINAL_STATUSES } },
          },
          include: CART_INCLUDE,
        })
      : Promise.resolve([]),
  ]);

  const guestNonTerminal = pickNewest(guestCandidates);

  if (userNonTerminal && guestNonTerminal && userNonTerminal.id === guestNonTerminal.id) {
    return ensureTotals(userNonTerminal);
  }

  // A) Only user cart
  if (userNonTerminal && !guestNonTerminal) {
    return ensureTotals(userNonTerminal);
  }

  // B) No user cart, guest cart exists, and user logged in => claim guest to user
  if (!userNonTerminal && guestNonTerminal && userId) {
    const canonicalTotals = await computeTotalsFromCart({
      items: guestNonTerminal.items || [],
      shippingAddress: guestNonTerminal.shippingAddress || null,
      cartId: guestNonTerminal.id,
    });

    const claimed = await prisma.cart.update({
      where: { id: guestNonTerminal.id },
      data: { userId, ...canonicalTotals, status: "ACTIVE" },
      include: CART_INCLUDE,
    });
    await clearAllCartCookies();
    return claimed;
  }

  // C) Both exist and user logged in => merge guest into user WITH STOCK CAP
  if (userNonTerminal && guestNonTerminal && userId && userNonTerminal.id !== guestNonTerminal.id) {
    await prisma.$transaction(async (tx) => {
      const qtyByVariant = new Map();
      for (const it of userNonTerminal.items) {
        qtyByVariant.set(it.variantId, n(it.quantity));
      }

      for (const g of guestNonTerminal.items) {
        const currentQty = qtyByVariant.get(g.variantId) ?? 0;
        const desired = currentQty + n(g.quantity);
        const max = resolveVariantAvailableStock(g.variant);
        const finalQty = max != null ? Math.min(max, desired) : desired;

        if (max != null && finalQty <= 0) continue;

        const existing = await tx.cartItem.findFirst({
          where: { cartId: userNonTerminal.id, variantId: g.variantId },
        });

        const unit = n(existing?.unitPrice ?? g.unitPrice ?? g.price);

        if (existing) {
          await tx.cartItem.update({
            where: { id: existing.id },
            data: {
              quantity: finalQty,
              unitPrice: unit,
              subtotal: round(unit * finalQty, 2),
            },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: userNonTerminal.id,
              variantId: g.variantId,
              quantity: finalQty,
              unitPrice: unit,
              subtotal: round(unit * finalQty, 2),
              metadata: g.metadata ?? null,
            },
          });
        }

        qtyByVariant.set(g.variantId, finalQty);
      }

      await tx.cartItem.deleteMany({ where: { cartId: guestNonTerminal.id } });
      await tx.cart.delete({ where: { id: guestNonTerminal.id } });
    });

    const merged = await prisma.cart.findUnique({
      where: { id: userNonTerminal.id },
      include: CART_INCLUDE,
    });

    const ensured = await ensureTotals(merged);
    await clearAllCartCookies();
    return ensured;
  }

  // D) Only guest cart, not logged in
  if (guestNonTerminal && !userId) {
    return ensureTotals(guestNonTerminal);
  }

  // 2) Pragmatic fallbacks ...
  if (userId) {
    const mostRecentForUser = await prisma.cart.findFirst({
      where: { userId },
      include: CART_INCLUDE,
      orderBy: { updatedAt: "desc" },
    });
    if (mostRecentForUser) return ensureTotals(mostRecentForUser);
  } else {
    const ids = cookieSessionIds;
    if (ids.length) {
      const mostRecentGuest = await prisma.cart.findFirst({
        where: { sessionId: { in: ids } },
        include: CART_INCLUDE,
        orderBy: { updatedAt: "desc" },
      });
      if (mostRecentGuest) return ensureTotals(mostRecentGuest);
    }
  }

  // 3) Nothing at all.
  return null;
}

/* ───────────────────────── routes ───────────────────────── */

export async function GET() {
  try {
    const cart = await resolveCartWithMerge();
    const payload = respondCartObject(cart);
    return Response.json(payload, { status: 200, headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error("[cart][GET] error", e);

    const totals = {
      subtotal: 0,
      discount: 0,
      discountTotal: 0,
      tax: 0,
      taxTotal: 0,
      shipping: 0,
      shippingTotal: 0,
      grandTotal: 0,
      total: 0,
      currency: "BDT",
      itemCount: 0,
      totalQty: 0,
    };

    return Response.json(
      {
        ok: false,
        id: null,
        cartId: null,
        currency: totals.currency,
        items: [],
        itemCount: 0,
        totalQty: 0,
        subtotal: totals.subtotal,
        discount: totals.discount,
        discountTotal: totals.discountTotal,
        tax: totals.tax,
        taxTotal: totals.taxTotal,
        shipping: totals.shipping,
        shippingTotal: totals.shippingTotal,
        grandTotal: totals.grandTotal,
        total: totals.total,
        totals,
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "remove") {
      const id = String(body?.id || "");
      if (!id)
        return Response.json(
          { ok: false, error: "MISSING_ID" },
          { status: 400, headers: NO_STORE_HEADERS }
        );

      const cart = await resolveCartWithMerge();
      if (!cart) {
        return Response.json(
          { ok: false, error: "CART_NOT_FOUND" },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }

      const line = await prisma.cartItem.findUnique({ where: { id } });
      if (!line || line.cartId !== cart.id) {
        return Response.json(
          { ok: false, error: "LINE_NOT_FOUND" },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }

      await prisma.cartItem.delete({ where: { id } });

      const fresh = await prisma.cart.findUnique({
        where: { id: cart.id },
        include: CART_INCLUDE,
      });

      if (!fresh) {
        return Response.json(
          { ok: false, error: "CART_NOT_FOUND_AFTER_DELETE" },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }

      const canonicalTotals = await computeTotalsFromCart({
        items: fresh.items || [],
        shippingAddress: fresh.shippingAddress || null,
        cartId: fresh.id,
      });

      const updated = await prisma.cart.update({
        where: { id: fresh.id },
        data: {
          subtotal: canonicalTotals.subtotal,
          discountTotal: canonicalTotals.discountTotal,
          taxTotal: canonicalTotals.taxTotal,
          shippingTotal: canonicalTotals.shippingTotal,
          grandTotal: canonicalTotals.grandTotal,
        },
        include: { items: true },
      });

      return Response.json(
        {
          ok: true,
          itemCount: updated.items.length,
          subtotal: n(updated.subtotal),
          discount: n(updated.discountTotal),
          tax: n(updated.taxTotal),
          shipping: n(updated.shippingTotal),
          grandTotal: n(updated.grandTotal),
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // Compatibility echo for old callers (doesn't touch DB/cart at all)
    const items = Array.isArray(body?.items) ? body.items : [];
    const subtotal = items.reduce(
      (sum, it) =>
        sum + Math.max(0, n(it?.quantity)) * Math.max(0, n(it?.price)),
      0
    );
    return Response.json(
      { ok: true, subtotal, itemCount: items.length },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (e) {
    console.error("[cart][POST] error", e);
    return Response.json(
      { ok: false, error: "CART_ERROR" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE() {
  try {
    const cart = await resolveCartWithMerge();

    if (cart) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
          await tx.cart.update({
            where: { id: cart.id },
            data: {
              status: "CONVERTED",
              subtotal: 0,
              discountTotal: 0,
              taxTotal: 0,
              shippingTotal: 0,
              grandTotal: 0,
            },
          });
        });
      } catch (err) {
        console.warn("[cart][DELETE] best-effort clear failed:", err);
      }
    }

    await clearAllCartCookies();
    return Response.json({ ok: true }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (e) {
    console.error("[cart][DELETE] error", e);
    try {
      await clearAllCartCookies();
    } catch {}
    return Response.json(
      { ok: false, error: "CART_DELETE_ERROR" },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
}

/* ───────────────────────── END ───────────────────────── */
