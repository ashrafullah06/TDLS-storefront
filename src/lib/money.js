// PATH: src/lib/money.js
"use client";

/**
 * Tiny money helpers (currency-agnostic, defaults to BDT)
 * Safe in client or server. No i18n side-effects.
 */

const DEFAULT_CURRENCY = "BDT";

/** Coerce to finite number */
export function n(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/** Round to 2 decimals (banker’s rounding not required here) */
export function round2(v) {
  return Math.round(n(v) * 100) / 100;
}

/** Parse a money string like "৳ 1,230.50" or "1230.5" → 1230.5 */
export function parseMoney(input) {
  if (typeof input !== "string") return n(input);
  // Strip common currency symbols and grouping
  const cleaned = input.replace(/[৳$,]/g, "").trim();
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : 0;
}

/** Format a number as currency (thin, fast) */
export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const v = round2(amount);
  switch (currency) {
    case "BDT":
      // Keep your brand look: “৳ 1,234.00”
      return `৳ ${v.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    default:
      return `${currency} ${v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

/** Multiply price × qty with safety */
export function lineTotal(unitPrice, qty) {
  return round2(n(unitPrice) * Math.max(0, Math.floor(n(qty))));
}

/** Sum helper for arrays of numbers */
export function sum(arr) {
  return round2((arr || []).reduce((a, x) => a + n(x), 0));
}

/** Clamp within [min, max] */
export function clamp(v, min = 0, max = Number.POSITIVE_INFINITY) {
  const x = n(v);
  return Math.min(max, Math.max(min, x));
}

/** Simple percent calc: pct = 0.1 → 10% */
export function pctOf(base, pct) {
  return round2(n(base) * n(pct));
}
