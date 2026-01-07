// PATH: src/lib/price.js
"use client";

/**
 * Price selection utilities
 * - Choose a unit price for a variant given currency and quantity breaks
 * - Works with your Prisma Price model shape
 *
 * Expected variant / price shape (minimal):
 * variant = {
 *   id: "var_...",
 *   prices: [{ currency: "BDT", amount: "1290.00", minQty: 1, maxQty: null }, ...]
 * }
 */

import { n, round2 } from "./money";

/** Pick the most appropriate price row for a given qty & currency */
export function selectPriceRow(prices = [], { currency = "BDT", qty = 1 } = {}) {
  const q = Math.max(1, Math.floor(n(qty)));
  const rows = (prices || []).filter((p) => p?.currency === currency);

  if (!rows.length) return null;

  // Prefer rows where minQty <= qty and (maxQty is null or >= qty)
  // If multiple match, pick the one with highest minQty (closest breakpoint)
  const eligible = rows
    .filter((p) => n(p.minQty ?? 1) <= q && (p.maxQty == null || q <= n(p.maxQty)))
    .sort((a, b) => n(b.minQty ?? 1) - n(a.minQty ?? 1));

  if (eligible.length) return eligible[0];

  // Fallback: pick lowest minQty row
  return rows.sort((a, b) => n(a.minQty ?? 1) - n(b.minQty ?? 1))[0];
}

/** Compute unit price from variant + qty (+currency) */
export function unitPriceForVariant(variant, { currency = "BDT", qty = 1 } = {}) {
  const row = selectPriceRow(variant?.prices || [], { currency, qty });
  return row ? round2(row.amount) : 0;
}

/** Derive a line subtotal for a variant row */
export function lineSubtotalForVariant(variant, qty, { currency = "BDT" } = {}) {
  const unit = unitPriceForVariant(variant, { currency, qty });
  return round2(unit * Math.max(1, Math.floor(n(qty))));
}
