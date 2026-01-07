// FILE: src/lib/cart-totals.js
// Shared canonical totals helper used by /api/cart, /api/cart/sync, etc.
// Always recomputes subtotal from quantity × unitPrice and applies:
// - Promotions
// - Shipping rules (inside vs outside Dhaka)
// - VAT rules (inclusive / exclusive, base selection)

import prisma from "@/lib/prisma";

/* ---------------- basic numeric helpers ---------------- */

function N(x, dflt = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

// money as string with 2dp (safe for Prisma Decimal)
function D(x) {
  const n = Number(x);
  const v = Number.isFinite(n) ? n : 0;
  return v.toFixed(2);
}

/* ---------------- shipping settings (cached) ---------------- */

let _shippingCache = {
  value: null,
  fetchedAt: 0,
};

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
        rateInside: N(v?.rate_inside, 0),
        rateOutside: N(v?.rate_outside, 0),
        thrInside: N(v?.free_threshold_inside, Infinity),
        thrOutside: N(v?.free_threshold_outside, Infinity),
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
  if (overrideSet.size && fields.some((f) => f && overrideSet.has(f))) {
    return true;
  }

  return false;
}

/* ---------------- VAT settings (cached) ---------------- */

let _vatSettingsCache = {
  value: null,
  fetchedAt: 0,
};

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
          ratePct: N(v.rate_pct, 0),
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
          ratePct: N(v.rate_pct, 0),
          inclusive: Boolean(v.inclusive),
          applyOn: String(v.apply_on || "SUBTOTAL").toUpperCase(),
        };
      }
    }

    if (!value) {
      value = { ratePct: 0, inclusive: false, applyOn: "SUBTOTAL" };
    }
  } catch {
    value = { ratePct: 0, inclusive: false, applyOn: "SUBTOTAL" };
  }

  _vatSettingsCache = { value, fetchedAt: now };
  return value;
}

/* ---------------- promotions ---------------- */

async function getPromotionTotal(cartId) {
  if (!cartId) return 0;
  try {
    if (!prisma.cartPromotion?.findMany) return 0;
    const promos = await prisma.cartPromotion
      .findMany({ where: { cartId } })
      .catch(() => []);
    return promos.reduce((s, p) => s + N(p.amountApplied, 0), 0);
  } catch {
    return 0;
  }
}

/* ---------------- main: computeTotalsCanonical ---------------- */

/**
 * Canonical totals calculator.
 * IMPORTANT:
 * - Ignores any existing "subtotal"/"total" stored on lines.
 * - Always recomputes subtotal from quantity × unit price.
 */
export async function computeTotalsCanonical({
  items,
  shippingAddress,
  cartId,
}) {
  const rows = Array.isArray(items) ? items : [];

  const subtotal = rows.reduce((sum, it) => {
    const qty =
      N(it.quantity, 0) ||
      N(it.qty, 0) ||
      N(it.count, 0) ||
      N(it.amount, 0) ||
      0;

    const unit =
      N(it.unitPrice, NaN) ||
      N(it.price, NaN) ||
      N(it.unit_price, NaN) ||
      N(it.unit, NaN) ||
      0;

    const q = Math.max(0, Math.floor(qty));
    return sum + q * unit;
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

  return {
    subtotal: D(subtotal),
    discountTotal: D(discountTotal),
    taxTotal: D(taxTotal),
    shippingTotal: D(shippingTotal),
    grandTotal: D(grandTotal),
  };
}

// Optional exports if you ever need raw helpers elsewhere
export { N, D };
