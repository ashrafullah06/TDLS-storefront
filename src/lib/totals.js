// PATH: src/lib/totals.js
"use client";

/**
 * Cart/order totals calculator
 * - Pure, deterministic; pass concrete settings & tax rates from server or /api
 * - Mirrors your current "inside/outside Dhaka + free threshold" rule
 *
 * Inputs:
 *   lines: [{ quantity, unitPrice, discountEach? , taxClassId?, taxPct? , ... }]
 *   options: {
 *     currency: "BDT",
 *     shipping: {
 *       insideDhakaFee: 0,
 *       outsideDhakaFee: 0,
 *       remoteFee: 0,
 *       freeThreshold: 0
 *     },
 *     postalCode: "1212",
 *     tax: {
 *       // If you already resolve tax per line on server, you can pass taxPct on line
 *       defaultPct: 0, // as fraction (e.g., 0.075 = 7.5%)
 *     },
 *     promotions: [
 *       { type: "PERCENTAGE", value: 0.10 }, // 10% cart discount
 *       { type: "FIXED", value: 100 },       // ৳100 off
 *     ]
 *   }
 */

import { n, round2, sum } from "./money";

/** Decide shipping zone by postal code (compat with your Summary.jsx logic) */
export function inferZone(postalCode) {
  const pc = String(postalCode || "").trim();
  if (!pc) return "remote_zone";
  if (/^1\d{3}$/.test(pc)) return "inside_dhaka";
  if (/^\d{4}$/.test(pc)) return "outside_dhaka";
  return "remote_zone";
}

/** Compute base shipping by zone & threshold */
export function computeShipping({ subtotalAfterDiscount, postalCode, shipping }) {
  const zone = inferZone(postalCode);
  const {
    insideDhakaFee = 0,
    outsideDhakaFee = insideDhakaFee,
    remoteFee = outsideDhakaFee,
    freeThreshold = 0,
  } = shipping || {};

  const base =
    zone === "inside_dhaka"
      ? n(insideDhakaFee)
      : zone === "outside_dhaka"
      ? n(outsideDhakaFee)
      : n(remoteFee);

  if (freeThreshold > 0 && n(subtotalAfterDiscount) >= n(freeThreshold)) return 0;
  return round2(base);
}

/** Sum lines’ raw subtotal (unitPrice × qty) */
export function computeLinesSubtotal(lines = []) {
  return round2(
    (lines || []).reduce((acc, it) => acc + n(it.unitPrice) * Math.max(0, Math.floor(n(it.quantity))), 0)
  );
}

/** Line-level discounts (if any) */
export function computePerLineDiscount(lines = []) {
  return round2((lines || []).reduce((a, it) => a + n(it.discountEach) * Math.max(0, Math.floor(n(it.quantity))), 0));
}

/** Cart-wide promotions (percentage & fixed) */
export function applyCartPromotions(subtotal, promotions = []) {
  let discount = 0;
  for (const p of promotions || []) {
    if (!p || p.value == null) continue;
    if (p.type === "PERCENTAGE") discount += n(subtotal) * n(p.value);
    else if (p.type === "FIXED") discount += n(p.value);
    // FREE_SHIPPING handled by shipping policy, if you use it
  }
  // never exceed subtotal
  return round2(Math.min(discount, n(subtotal)));
}

/** Simple tax calculator (single rate or per-line override) */
export function computeTax({ lines = [], taxableBase = 0, defaultPct = 0 }) {
  // If any line has an explicit taxPct, tax it individually; otherwise use taxableBase × defaultPct
  const hasPerLine = (lines || []).some((l) => l.taxPct != null);
  if (hasPerLine) {
    const t = (lines || []).reduce((a, l) => {
      const qty = Math.max(0, Math.floor(n(l.quantity)));
      const base = n(l.unitPrice) * qty - n(l.discountEach || 0) * qty;
      const pct = n(l.taxPct ?? defaultPct);
      return a + base * pct;
    }, 0);
    return round2(t);
  }
  return round2(n(taxableBase) * n(defaultPct));
}

/**
 * Master calculator:
 * - Returns { subtotal, discountTotal, taxTotal, shippingTotal, grandTotal, breakdown }
 */
export function calculateTotals(lines = [], opts = {}) {
  const currency = opts.currency || "BDT";
  const promos = opts.promotions || [];
  const shippingCfg = opts.shipping || {};
  const postalCode = opts.postalCode || "";

  // 1) Subtotal from lines
  const rawSubtotal = computeLinesSubtotal(lines);

  // 2) Line-level discounts
  const lineDiscount = computePerLineDiscount(lines);

  // 3) Cart-wide promotions (percentage/fixed) applied on (subtotal - lineDiscount)
  const promoBase = Math.max(0, rawSubtotal - lineDiscount);
  const cartDiscount = applyCartPromotions(promoBase, promos);

  const discountTotal = round2(lineDiscount + cartDiscount);
  const subtotalAfterDiscount = Math.max(0, rawSubtotal - discountTotal);

  // 4) Shipping
  const shippingTotal = computeShipping({
    subtotalAfterDiscount,
    postalCode,
    shipping: shippingCfg,
  });

  // 5) Tax (use per-line taxPct if provided; else defaultPct on (subtotalAfterDiscount + shipping))
  const taxBase = subtotalAfterDiscount + shippingTotal;
  const taxTotal = computeTax({
    lines,
    taxableBase: taxBase,
    defaultPct: opts.tax?.defaultPct ?? 0,
  });

  // 6) Grand total
  const grandTotal = round2(subtotalAfterDiscount + shippingTotal + taxTotal);

  return {
    currency,
    subtotal: round2(rawSubtotal),
    discountTotal,
    taxTotal,
    shippingTotal,
    grandTotal,
    breakdown: {
      lineDiscount,
      cartDiscount,
      subtotalAfterDiscount,
      postalCode,
      shippingZone: inferZone(postalCode),
      promotionsApplied: promos,
    },
  };
}

/**
 * Optional helper to transform your Prisma Cart/Order items into calculator lines.
 * Use this when you don’t want to touch existing shapes.
 */
export function mapPrismaItemsToLines(items = []) {
  return (items || []).map((it) => ({
    quantity: Number(it.quantity ?? 1),
    unitPrice: Number(it.unitPrice ?? it.price ?? 0),
    // If you already store per-line discounts/tax, wire them here:
    discountEach: Number(it.discountEach ?? 0),
    taxPct: it.taxPct != null ? Number(it.taxPct) : undefined,
    sku: it.sku ?? undefined,
    title: it.title ?? undefined,
    variantId: it.variantId ?? undefined,
  }));
}
