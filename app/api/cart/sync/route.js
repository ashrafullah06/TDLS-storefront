// FILE: app/api/cart/sync/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import crypto from "crypto";

/* ───────────────── helpers: response & cookies ───────────────── */

const SID_COOKIE = "tdlc_sid";

const NO_STORE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  expires: "0",
  vary: "Cookie",
};

function j(body, status = 200) {
  return new NextResponse(body === undefined ? "null" : JSON.stringify(body), {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function getSidFromReq(req) {
  try {
    // NextRequest supports req.cookies
    const v = req.cookies?.get(SID_COOKIE)?.value;
    if (v && String(v).trim()) return String(v).trim();
  } catch {}
  try {
    const raw = req.headers.get("cookie") || "";
    const m = raw.match(new RegExp(`(?:^|; )${SID_COOKIE}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function makeSid() {
  // strong random, short, URL-safe-ish hex
  return crypto.randomBytes(12).toString("hex");
}

function setSidCookie(res, sid) {
  // Canonical: HttpOnly, SameSite=Lax, Secure in production
  res.cookies.set({
    name: SID_COOKIE,
    value: String(sid),
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90, // 90 days
  });
}

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

/* ───────────────── helpers: canonical subtotal (shared semantics) ───────────────── */

/**
 * Canonical subtotal helper:
 *   subtotal = Σ (quantity × unitPrice) for each line
 *
 * We **do not** trust any incoming `subtotal` or `total` fields here – they can be stale.
 */
function calcSubtotal(items = []) {
  return items.reduce((s, it) => {
    const qty = Math.max(0, Math.floor(N(it.quantity, 0)));
    const unit = N(it.unitPrice, 0);
    return s + qty * unit;
  }, 0);
}

/* ───────────────── helpers: stock resolution ───────────────── */

/**
 * Try to read "max available" quantity from the client payload
 * (Strapi-derived fields). This is a soft hint; DB is the authority.
 */
function resolveMaxAvailableFromPayload(raw = {}) {
  const cands = [
    raw.maxAvailable,
    raw.stock_available,
    raw.stockAvailable,
    raw.stock_quantity,
    raw.stockQuantity,
    raw.stock_total,
    raw.stockTotal,
    raw.size?.stock_quantity,
    raw.size?.stockQuantity,
    raw.size?.stock_total,
    raw.size?.stockTotal,
  ];

  for (const v of cands) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  return null;
}

/**
 * HARD server-side stock authority – batched for all variantIds.
 *
 * Expects **canonical Prisma ProductVariant.id** values.
 * Returns Map<string, number|null> where:
 *   - value is total available units (can be 0)
 *   - missing key => "unknown"
 *
 * IMPORTANT FIX:
 * - On DB read failures, we return an EMPTY map (unknown),
 *   NOT zeros (zeros would wipe carts unexpectedly).
 */
async function batchResolveServerStockForVariants(variantIds = []) {
  const ids = Array.from(
    new Set(
      variantIds
        .map((v) => (v != null ? String(v).trim() : ""))
        .filter(Boolean)
    )
  );

  if (!ids.length) return new Map();

  // If InventoryItem model is not in Prisma yet, skip DB lookup gracefully.
  if (!prisma.inventoryItem?.findMany) {
    return new Map();
  }

  try {
    const rows = await prisma.inventoryItem.findMany({
      where: { variantId: { in: ids } },
      select: {
        variantId: true,
        onHand: true,
        reserved: true,
        safetyStock: true,
      },
    });

    const map = new Map();

    for (const row of rows) {
      const vId = String(row.variantId);
      const onHand = Number(row.onHand ?? 0);
      const reserved = Number(row.reserved ?? 0);
      const safety = Number(row.safetyStock ?? 0);

      const available = onHand - reserved - safety;
      if (!Number.isFinite(available)) continue;

      if (available > 0) {
        const prev = map.get(vId) ?? 0;
        map.set(vId, prev + available);
      } else {
        if (!map.has(vId)) map.set(vId, 0);
      }
    }

    return map;
  } catch (e) {
    console.warn("[cart/sync] failed to read InventoryItem in batch:", e);
    // IMPORTANT: unknown, do not clamp to 0
    return new Map();
  }
}

/**
 * Clamp requested quantity against:
 *   - serverStock (InventoryItem-based)
 *   - payloadMax (Strapi hint)
 *
 * IMPORTANT:
 * - We **never increase** the quantity.
 * - If the client sends 0 or a negative number → we respect that as 0
 *   (so the line can be removed).
 */
function clampQuantity(requestedQty, serverStock, payloadMax) {
  const rq = Math.floor(N(requestedQty, 0));
  if (rq <= 0) return 0;

  let hardCap = null;

  const hasServer =
    serverStock != null && Number.isFinite(Number(serverStock));
  const hasPayload =
    payloadMax != null && Number.isFinite(Number(payloadMax));

  if (hasServer && hasPayload) {
    hardCap = Math.min(Number(serverStock), Number(payloadMax));
  } else if (hasServer) {
    hardCap = Number(serverStock);
  } else if (hasPayload) {
    hardCap = Number(payloadMax);
  }

  if (hardCap == null) {
    return rq;
  }

  return Math.max(0, Math.min(rq, Math.floor(hardCap)));
}

/* ───────────────── helpers: variant & cart ───────────────── */

/**
 * Normalize *client* variantId from payload.
 *
 * This may be:
 *   - a real Prisma ProductVariant.id (cuid string), OR
 *   - a Strapi size row id (27, 81, 140, 141, ...) → via strapiSizeId
 */
function getVariantId(rawItem = {}) {
  const sizeRow =
    rawItem.strapiSizeId ?? // preferred
    rawItem.strapi_size_id ??
    rawItem.sizeStockId ??
    rawItem.size_stock_id ??
    rawItem.sizeId ??
    rawItem.size_id ??
    rawItem.size?.id ??
    null;

  const cand =
    rawItem.variantId ??
    rawItem.variant_id ??
    rawItem.productVariantId ??
    rawItem.variant?.id ??
    sizeRow ??
    null;

  if (!cand) return null;

  const s = String(cand).trim();
  if (!s) return null;
  return s;
}

/**
 * Map client variant ids (Strapi size ids or real Prisma ids) to
 * **canonical Prisma ProductVariant.id** values.
 *
 * - If the client sends a real ProductVariant.id → maps to itself.
 * - If the client sends a Strapi size id (e.g. "27") → uses ProductVariant.strapiSizeId to resolve.
 */
async function mapClientVariantIdsToDbVariantIds(clientIds = []) {
  const keys = Array.from(
    new Set(
      clientIds
        .map((v) => (v != null ? String(v).trim() : ""))
        .filter(Boolean)
    )
  );

  if (!keys.length) {
    return { map: new Map(), missing: new Set() };
  }

  const numericIds = [];
  const nonNumericIds = [];

  for (const k of keys) {
    if (/^\d+$/.test(k)) {
      numericIds.push(Number(k));
    } else {
      nonNumericIds.push(k);
    }
  }

  const whereOr = [];
  if (nonNumericIds.length) {
    whereOr.push({ id: { in: nonNumericIds } });
  }
  if (numericIds.length) {
    whereOr.push({ strapiSizeId: { in: numericIds } });
  }

  if (!whereOr.length) {
    return { map: new Map(), missing: new Set(keys) };
  }

  const variants = await prisma.productVariant.findMany({
    where: { OR: whereOr },
    select: { id: true, strapiSizeId: true },
  });

  const map = new Map();

  for (const v of variants) {
    const dbId = String(v.id);
    map.set(dbId, dbId);
    if (v.strapiSizeId != null) {
      map.set(String(v.strapiSizeId), dbId);
    }
  }

  const missing = new Set(keys.filter((k) => !map.has(k)));

  if (missing.size) {
    console.warn(
      "[cart/sync] Some client variant ids could not be resolved to ProductVariant:",
      Array.from(missing)
    );
  }

  return { map, missing };
}

function extractUnitPrice(rawItem = {}) {
  const unit =
    rawItem.unitPrice ??
    rawItem.price ??
    rawItem.unit_price ??
    rawItem.unit ??
    0;
  return N(unit, 0);
}

function extractTitle(rawItem = {}) {
  return String(
    rawItem.title ??
      rawItem.name ??
      rawItem.variantTitle ??
      rawItem.productTitle ??
      "Item"
  );
}

function extractSku(rawItem = {}) {
  return rawItem.sku ?? rawItem.variant?.sku ?? null;
}

/**
 * Canonical line subtotal from qty × unitPrice OR explicit subtotal/total.
 * Used only when writing the DB row; canonical totals ignore stale values later.
 */
function calcLineSubtotal(qty, unitPrice, rawItem = {}) {
  const explicit =
    rawItem.subtotal != null ? N(rawItem.subtotal, NaN) : N(rawItem.total, NaN);

  if (Number.isFinite(explicit)) return explicit;

  const q = Math.max(0, Math.floor(N(qty, 0)));
  return q * N(unitPrice, 0);
}

/**
 * Ensure there's an ACTIVE cart for this user/session.
 *
 * IMPORTANT:
 * - If user is logged in → we *only* look by userId (not OR with sid),
 *   so /api/cart, /api/cart/sync and /api/checkout/create-order
 *   all "see" the same cart.
 * - If no user, we fall back to sessionId.
 */
async function getOrCreateCart(userId, sid) {
  let where;

  if (userId) {
    where = { status: "ACTIVE", userId };
  } else if (sid) {
    where = { status: "ACTIVE", sessionId: sid };
  } else {
    // should not happen because we always ensure a sid
    where = { status: "ACTIVE", sessionId: null, userId: null };
  }

  let existing = await prisma.cart.findFirst({
    where,
    include: {
      items: true,
      promotions: true,
      shippingAddress: true,
    },
    orderBy: { updatedAt: "desc" }, // pick newest
  });

  if (existing) return existing;

  const created = await prisma.cart.create({
    data: {
      userId: userId || null,
      sessionId: sid || null,
      currency: "BDT",
      status: "ACTIVE",
    },
    include: {
      items: true,
      promotions: true,
      shippingAddress: true,
    },
  });

  return created;
}

/* ───────────────── helpers: settings (shipping, VAT, promos) ───────────────── */

/* Shipping settings cache (5 min) */
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
    return promos.reduce((s, p) => s + N(p.amountApplied, 0), 0);
  } catch {
    return 0;
  }
}

async function computeTotalsCanonical({ items, shippingAddress, cartId }) {
  const subtotal = calcSubtotal(
    (items || []).map((x) => ({
      quantity: x.quantity,
      unitPrice: Number(x.unitPrice),
    }))
  );

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

/* ───────────────── route: POST /api/cart/sync ───────────────── */

export async function POST(req) {
  try {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id || null;

    const body = await req.json().catch(() => ({}));

    const hasPayloadItems =
      Array.isArray(body?.items) || Array.isArray(body?.cart?.items);

    const rawItems = hasPayloadItems
      ? Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.cart?.items)
        ? body.cart.items
        : []
      : [];

    // Ensure we have a session id for guests (customer-specific cart isolation)
    let sid = getSidFromReq(req);
    const mintedSid = !sid;
    if (!sid) sid = makeSid();

    const res = j({ ok: true }, 200); // placeholder response object to attach cookies later
    if (mintedSid) setSidCookie(res, sid);

    let cart = await getOrCreateCart(userId, sid);

    // If payload is explicitly empty => clear server cart (NO GHOSTING)
    if (hasPayloadItems && Array.isArray(rawItems) && rawItems.length === 0) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

      const canonicalTotals = await computeTotalsCanonical({
        items: [],
        shippingAddress: cart.shippingAddress || null,
        cartId: cart.id,
      });

      await prisma.cart.update({
        where: { id: cart.id },
        data: {
          subtotal: canonicalTotals.subtotal,
          discountTotal: canonicalTotals.discountTotal,
          taxTotal: canonicalTotals.taxTotal,
          shippingTotal: canonicalTotals.shippingTotal,
          grandTotal: canonicalTotals.grandTotal,
        },
      });

      const payload = {
        ok: true,
        sid,
        cartId: cart.id,
        userId: cart.userId,
        currency: cart.currency,
        status: cart.status,
        items: [],
        totals: canonicalTotals,
      };

      return new NextResponse(JSON.stringify(payload), {
        status: 200,
        headers: NO_STORE_HEADERS,
        cookies: res.cookies, // keep cookie if minted
      });
    }

    // map existing cart lines by variantId → array to detect duplicates
    const existingByVariant = new Map();
    for (const it of cart.items || []) {
      if (!it.variantId) continue;
      const key = String(it.variantId);
      if (!existingByVariant.has(key)) existingByVariant.set(key, []);
      existingByVariant.get(key).push(it);
    }

    // resolve client variant ids → canonical ProductVariant.id
    const clientVariantKeys = [];
    for (const raw of rawItems) {
      const clientKey = getVariantId(raw);
      if (!clientKey) continue;
      clientVariantKeys.push(String(clientKey));
    }

    const { map: clientToDbVariantMap } =
      await mapClientVariantIdsToDbVariantIds(clientVariantKeys);

    const dbVariantIdsForStock = Array.from(
      new Set(Array.from(clientToDbVariantMap.values()))
    );

    const stockMap = await batchResolveServerStockForVariants(dbVariantIdsForStock);

    // track which variantIds we keep/update from this payload
    const touchedVariants = new Set();
    // track duplicate cartItem ids to delete (same variantId, extra rows)
    const extraCartItemIdsToDelete = [];

    // upsert / delete lines based on payload
    for (const raw of rawItems) {
      const clientKey = getVariantId(raw);
      if (!clientKey) continue;

      const clientKeyStr = String(clientKey);
      const vKey = clientToDbVariantMap.get(clientKeyStr);

      if (!vKey) {
        console.warn(
          "[cart/sync] Skipping item; unknown variant from client:",
          clientKeyStr
        );
        continue;
      }

      const requestedQty =
        raw.quantity ?? raw.qty ?? raw.count ?? raw.amount ?? 1;

      const payloadMax = resolveMaxAvailableFromPayload(raw);
      const serverStock = stockMap.has(vKey) ? stockMap.get(vKey) : null;
      const finalQty = clampQuantity(requestedQty, serverStock, payloadMax);

      const existingArr = existingByVariant.get(vKey) || [];

      // explicit 0 / clamp-to-zero => delete line(s)
      if (finalQty <= 0) {
        if (existingArr.length) {
          await prisma.cartItem.deleteMany({
            where: { id: { in: existingArr.map((e) => e.id) } },
          });
          existingByVariant.delete(vKey);
        }
        continue;
      }

      const unitPrice = extractUnitPrice(raw);
      const title = extractTitle(raw);
      const sku = extractSku(raw);
      const subtotal = calcLineSubtotal(finalQty, unitPrice, raw);

      const incomingMeta =
        raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {};

      const primary = existingArr[0] || null;
      const extras = existingArr.slice(1);

      if (primary) {
        // delete duplicates of same variantId (keep primary)
        for (const extra of extras) extraCartItemIdsToDelete.push(extra.id);

        const mergedMeta = {
          ...(primary.metadata || {}),
          ...incomingMeta,
        };

        const data = {
          quantity: finalQty,
          unitPrice: D(unitPrice),
          subtotal: D(subtotal),
          total: D(subtotal),
          sku: sku ?? primary.sku ?? null,
          title: title || primary.title || null,
          metadata: mergedMeta,
        };

        // Safe update: if row vanished (P2025), recreate it
        try {
          await prisma.cartItem.update({
            where: { id: primary.id },
            data,
          });
        } catch (err) {
          if (err && err.code === "P2025") {
            await prisma.cartItem.create({
              data: {
                cartId: cart.id,
                variantId: vKey,
                ...data,
              },
            });
          } else {
            throw err;
          }
        }
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            variantId: vKey,
            quantity: finalQty,
            unitPrice: D(unitPrice),
            subtotal: D(subtotal),
            total: D(subtotal),
            sku: sku ?? null,
            title: title || null,
            metadata: incomingMeta,
          },
        });
      }

      touchedVariants.add(vKey);
    }

    if (extraCartItemIdsToDelete.length) {
      await prisma.cartItem.deleteMany({
        where: { id: { in: extraCartItemIdsToDelete } },
      });
    }

    /**
     * Treat payload as CANONICAL set of lines.
     * Any existing DB cartItem whose variantId is NOT in `touchedVariants`
     * is removed. This kills "ghost" lines that only live on the server.
     */
    if (hasPayloadItems) {
      const orphanVariantIds = [];
      for (const [vId] of existingByVariant.entries()) {
        if (!touchedVariants.has(vId)) orphanVariantIds.push(vId);
      }

      if (orphanVariantIds.length > 0) {
        await prisma.cartItem.deleteMany({
          where: {
            cartId: cart.id,
            variantId: { in: orphanVariantIds },
          },
        });
      }
    }

    cart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: {
            variant: {
              include: { product: true },
            },
          },
        },
        promotions: true,
        shippingAddress: true,
      },
    });

    if (!cart) {
      const out = j({ ok: false, error: "CART_NOT_FOUND" }, 404);
      if (mintedSid) setSidCookie(out, sid);
      return out;
    }

    const canonicalTotals = await computeTotalsCanonical({
      items: cart.items || [],
      shippingAddress: cart.shippingAddress || null,
      cartId: cart.id,
    });

    await prisma.cart.update({
      where: { id: cart.id },
      data: {
        subtotal: canonicalTotals.subtotal,
        discountTotal: canonicalTotals.discountTotal,
        taxTotal: canonicalTotals.taxTotal,
        shippingTotal: canonicalTotals.shippingTotal,
        grandTotal: canonicalTotals.grandTotal,
      },
    });

    const itemsPayload = (cart.items || []).map((it) => {
      const md = it.metadata || {};
      const variant = it.variant;
      const product = variant?.product;

      const thumbnail =
        md.thumbnail ||
        md.thumbnailUrl ||
        md.thumb ||
        md.image ||
        md.imageUrl ||
        (product &&
          product.thumbnail &&
          (product.thumbnail.url || product.thumbnail.src)) ||
        null;

      return {
        id: it.id,
        variantId: it.variantId,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        subtotal: Number(it.subtotal),
        total: Number(it.total ?? it.subtotal),
        sku: it.variant?.sku ?? it.sku ?? md.sku ?? null,
        title:
          it.title ||
          md.productName ||
          it.variant?.title ||
          it.variant?.product?.name ||
          "Item",
        product: product
          ? {
              id: product.id,
              slug: product.slug,
              name: product.title ?? product.slug ?? "Product",
              thumbnail,
            }
          : null,
        metadata: md,
        thumbnail,
      };
    });

    const responsePayload = {
      ok: true,
      sid,
      cartId: cart.id,
      userId: cart.userId,
      currency: cart.currency,
      status: cart.status,
      items: itemsPayload,
      totals: canonicalTotals,
    };

    const out = j(responsePayload, 200);
    if (mintedSid) setSidCookie(out, sid);
    return out;
  } catch (e) {
    console.error("[cart/sync] error:", e);
    return j({ ok: false, error: "SYNC_FAILED" }, 500);
  }
}
