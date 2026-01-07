// FILE: app/api/checkout/create-order/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/* --------------------------- helpers & constants --------------------------- */

function json(res, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: {
      "Content-Type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function bad(code, status = 400, extra = {}) {
  return json({ ok: false, code, ...extra }, status);
}

function ok(data) {
  return json({ ok: true, data }, 200);
}

// Same SID cookie as /api/cart/sync
const SID_COOKIE = "tdlc_sid";

function getCookie(req, name) {
  try {
    const raw = req.headers.get("cookie") || "";
    const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function normalizePhoneBD(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^\d+]/g, "");
  const digits = s.replace(/\+/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  if (!s.startsWith("+")) {
    if (s.startsWith("880")) s = "+" + s;
    else if (s.startsWith("0")) s = "+880" + s.slice(1);
    else s = "+880" + s;
  }
  return s;
}

function canon(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function n2(v, fallback = NaN) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function round2(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function eqInsensitiveOrNull(v) {
  const s = canon(v);
  if (!s) return { equals: null };
  return { equals: s, mode: "insensitive" };
}

/**
 * Guest intent detection:
 * - explicit guestCheckout/mode
 * - presence of guest object
 * - absence of addressBook IDs (common in guest flow)
 */
function detectGuestRequested(body) {
  const mode = String(body?.mode || "").toLowerCase();
  if (body?.guestCheckout === true) return true;
  if (mode === "guest") return true;
  if (body?.guest && typeof body.guest === "object") return true;

  // heuristic: if shipping is provided but address book IDs are not, it is likely guest
  const hasShippingObject = body?.shipping && typeof body?.shipping === "object";
  const hasAddressBookIds = !!body?.shippingAddressId || !!body?.billingAddressId;
  if (hasShippingObject && !hasAddressBookIds) return true;

  return false;
}

/**
 * Accepts checkout body shape and returns a canonical Address payload AND missing fields.
 * Required for your UI: street(line1), city/upazila(city), district(state), countryIso2.
 */
function normalizeAddressBodyWithMissing(b = {}, type = "SHIPPING") {
  const countryIso2 = (b.countryIso2 ?? b.country ?? "BD").toString().toUpperCase();

  // street/house/road aggregation (supports "streetNo" style fields too)
  const streetParts = [
    b.line1,
    b.address1,
    b.street,
    b.streetAddress,
    b.address,
    b.house,
    b.houseNo,
    b.houseNumber,
    b.road,
    b.roadNo,
    b.roadNumber,
    b.streetNo,
  ]
    .map((x) => canon(x))
    .filter(Boolean);

  const line1 = streetParts.join(" ").trim();

  const addr = {
    contactName: b.name ?? b.fullName ?? b.contactName ?? null,
    contactEmail: b.email ?? b.contactEmail ?? null,
    phone: b.phone ?? b.mobile ?? b.number ?? null,

    line1,
    line2: canon(b.line2 ?? b.address2 ?? b.area ?? b.landmark ?? "") || null,

    // ✅ BD mapping:
    // city = city/upazila/thana
    city: canon(b.city ?? b.cityOrUpazila ?? b.upazila ?? b.thana ?? ""),
    // state = district (fallback division)
    state: canon(b.district ?? b.state ?? b.zila ?? b.division ?? ""),

    postalCode: canon(b.postalCode ?? b.postcode ?? b.zip ?? "") || null,
    countryIso2,

    type: type === "BILLING" ? "BILLING" : "SHIPPING",
    label: b.label ?? null,
    source: b.source ?? "checkout",
  };

  const missingFields = [];
  if (!canon(addr.line1)) missingFields.push("line1");
  if (!canon(addr.city)) missingFields.push("city");
  if (!canon(addr.state)) missingFields.push("state");
  if (!canon(addr.countryIso2)) missingFields.push("countryIso2");

  return { addr, missingFields };
}

/**
 * Upsert address + add a version, using the transaction client `tx`.
 * IMPORTANT: Only allowed columns of Address model are sent to Prisma.
 */
async function upsertAddressAndVersion({ tx, userId, addr }) {
  const phoneNorm = addr.phone ? normalizePhoneBD(addr.phone) : null;

  const existing = await tx.address.findFirst({
    where: {
      userId,
      archivedAt: null,
      type: addr.type,
      countryIso2: canon(addr.countryIso2).toUpperCase(),
      phone: phoneNorm ? { equals: phoneNorm } : { equals: null },

      line1: eqInsensitiveOrNull(addr.line1),
      line2: addr.line2 ? eqInsensitiveOrNull(addr.line2) : { equals: null },
      city: eqInsensitiveOrNull(addr.city),
      state: addr.state ? eqInsensitiveOrNull(addr.state) : { equals: null },
      postalCode: addr.postalCode ? eqInsensitiveOrNull(addr.postalCode) : { equals: null },
    },
    orderBy: { createdAt: "desc" },
  });

  const row =
    existing ||
    (await tx.address.create({
      data: {
        userId,
        type: addr.type,
        line1: canon(addr.line1),
        line2: addr.line2 ? canon(addr.line2) : null,
        city: canon(addr.city),
        state: addr.state ? canon(addr.state) : null,
        postalCode: addr.postalCode ? canon(addr.postalCode) : null,
        countryIso2: canon(addr.countryIso2).toUpperCase(),
        phone: phoneNorm,
        label: addr.label ?? null,
        source: addr.source ?? "checkout",
      },
    }));

  await tx.addressVersion.create({
    data: {
      addressId: row.id,
      userId,
      payload: row,
      reason: "UPSERT",
    },
  });

  return row;
}

async function setDefaultForUser({ tx, userId, addressId, type }) {
  await tx.address.updateMany({
    where: { userId, type, isDefault: true },
    data: { isDefault: false },
  });

  await tx.address.update({
    where: { id: addressId },
    data: { isDefault: true },
  });

  if (type === "SHIPPING") {
    await tx.user.update({
      where: { id: userId },
      data: { defaultAddressId: addressId },
    });
  }

  await tx.addressVersion.create({
    data: {
      addressId,
      userId,
      payload: { setDefault: true, type },
      reason: "SET_DEFAULT",
    },
  });
}

function isCod(paymentMethod) {
  const s = String(paymentMethod || "").toUpperCase();
  return (
    s === "CASH_ON_DELIVERY" ||
    s === "COD" ||
    s === "CASH" ||
    s === "CASH-ON-DELIVERY"
  );
}

/* --------------------------- STOCK HELPERS (SHARED) --------------------------- */

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

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
  if (base === null) return null;

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

  const safetyCandidates = [inv.safetyStock, inv.buffer, inv.bufferStock, inv.minStock];
  let safety = 0;
  for (const v of safetyCandidates) {
    if (v != null && Number.isFinite(num(v, NaN))) {
      safety = num(v, 0);
      break;
    }
  }

  return base - reserved - safety;
}

function resolveVariantAvailableStock(variant) {
  if (!variant) return null;

  const candidates = [];

  if (variant.stockAvailable != null) candidates.push(num(variant.stockAvailable));
  if (variant.availableQty != null) candidates.push(num(variant.availableQty));
  if (variant.availableQuantity != null) candidates.push(num(variant.availableQuantity));
  if (variant.inventoryQty != null) candidates.push(num(variant.inventoryQty));

  if (variant.stockOnHand != null) {
    const onHand = num(variant.stockOnHand);
    const reserved = num(variant.stockReserved ?? variant.stockAllocated, 0);
    candidates.push(onHand - reserved);
  }

  if (Array.isArray(variant.inventoryItems) && variant.inventoryItems.length) {
    for (const inv of variant.inventoryItems) {
      const net = resolveInventoryNet(inv);
      if (net != null) candidates.push(net);
    }
  }

  const vals = candidates.map((v) => num(v, NaN)).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;

  return Math.max(...vals);
}

/* ---------------------- PRISMA → STRAPI INVENTORY SYNC ---------------------- */

async function triggerStrapiInventoryFullSync(req) {
  const secret = process.env.INTERNAL_CRON_TOKEN || process.env.CRON_SECRET || "";

  if (!secret) {
    console.warn(
      "[checkout/create-order] INTERNAL_CRON_TOKEN / CRON_SECRET missing – skipping Prisma→Strapi inventory sync"
    );
    return { ok: false, reason: "NO_CRON_SECRET" };
  }

  try {
    const h = req.headers;
    const proto = h.get("x-forwarded-proto") || "http";
    const host = h.get("x-forwarded-host") || h.get("host");
    const url = `${proto}://${host}/api/internal/cron/sync-strapi-inventory?secret=${encodeURIComponent(
      secret
    )}`;

    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        "user-agent": h.get("user-agent") || "",
        "x-forwarded-for": h.get("x-forwarded-for") || "",
        "x-real-ip": h.get("x-real-ip") || "",
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) {
      console.error("[checkout/create-order] Inventory sync endpoint returned non-ok:", res.status, data);
      return { ok: false, status: res.status, data };
    }

    return { ok: true, data };
  } catch (err) {
    console.error("[checkout/create-order] Error calling Prisma→Strapi inventory sync:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/* ---------------------------------- POST ---------------------------------- */

export async function POST(req) {
  const startedAt = Date.now();

  let body;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // ✅ Guest requested (explicit or heuristic)
  const guestRequested = detectGuestRequested(body);

  // ✅ Keep logged-in behavior intact, but do NOT block guest checkout because of stale cookies.
  let session = null;
  try {
    session = await requireAuth(req, { optional: true });
  } catch (err) {
    const code = String(err?.code || err?.message || "").toUpperCase();
    if (guestRequested && code.includes("USER_NOT_FOUND")) {
      session = null; // treat as guest; do not fail
    } else {
      // for non-guest flows, preserve strictness
      return bad(code || "UNAUTHORIZED", 401);
    }
  }

  const userId = session?.userId || null;

  const useBillingAsShipping = !!body?.useBillingAsShipping;
  const notes = body?.notes ? String(body.notes).slice(0, 1000) : null;
  const paymentMethod = String(body?.paymentMethod || "CASH_ON_DELIVERY").toUpperCase();

  // Normalize addresses + return field-specific missing list
  const shipN = normalizeAddressBodyWithMissing(body?.shipping || {}, "SHIPPING");
  if (shipN.missingFields.length) {
    return bad("ADDRESS_INCOMPLETE", 400, { fields: shipN.missingFields });
  }
  const shippingIn = shipN.addr;

  const phoneNorm = normalizePhoneBD(shippingIn.phone);
  if (!phoneNorm) return bad("MOBILE_REQUIRED", 400, { fields: ["phone"] });

  // Billing
  let billingIn = null;
  if (!useBillingAsShipping && body?.billing) {
    const billN = normalizeAddressBodyWithMissing(body.billing || {}, "BILLING");
    if (billN.missingFields.length) {
      return bad("ADDRESS_INCOMPLETE", 400, { fields: billN.missingFields });
    }
    billingIn = billN.addr;
  }

  try {
    // ───────────────────────── Resolve cart ─────────────────────────
    let cart = null;

    if (userId) {
      cart = await prisma.cart.findFirst({
        where: { userId, status: "ACTIVE" },
        include: { items: true },
        orderBy: { updatedAt: "desc" },
      });
    }

    if (!cart) {
      const sid = getCookie(req, SID_COOKIE);
      if (sid) {
        cart = await prisma.cart.findFirst({
          where: { sessionId: sid, status: "ACTIVE" },
          include: { items: true },
          orderBy: { updatedAt: "desc" },
        });
      }
    }

    if (!cart || !cart.items?.length) return bad("CART_EMPTY", 400);

    // ───────────────────────── Transaction ─────────────────────────
    // ✅ FIX: Add interactive transaction options to prevent P2028 "Transaction not found"
    // when the transaction crosses the default timeout under load.
    const order = await prisma.$transaction(
      async (tx) => {
        // 1) Variant snapshot + inventory rows (single source of "effectiveAvailable")
        const variantIds = Array.from(new Set(cart.items.map((ci) => ci.variantId)));

        const variants = await tx.productVariant.findMany({
          where: { id: { in: variantIds } },
          include: { prices: true, inventoryItems: true },
        });

        const stateById = new Map();

        for (const v of variants) {
          const invRows = v.inventoryItems || [];

          let effectiveAvailable = resolveVariantAvailableStock(v);

          if (effectiveAvailable == null) {
            const stockAvailable = num(v.stockAvailable, NaN);
            const stockReserved = num(v.stockReserved, 0);
            const initialStock = num(v.initialStock, NaN);
            const strapiStockRaw = num(v.strapiStockRaw, NaN);

            let fallback = null;
            if (Number.isFinite(stockAvailable) || Number.isFinite(stockReserved)) {
              fallback = num(stockAvailable, 0) - stockReserved;
            } else if (Number.isFinite(strapiStockRaw)) {
              fallback = strapiStockRaw - stockReserved;
            } else if (Number.isFinite(initialStock)) {
              fallback = initialStock - stockReserved;
            }

            effectiveAvailable = fallback != null ? fallback : 0;
          }

          effectiveAvailable = Math.max(0, num(effectiveAvailable, 0));

          let invAvailable = null;
          if (invRows.length) {
            invAvailable = invRows.reduce((sum, inv) => {
              const net = resolveInventoryNet(inv);
              return sum + Math.max(0, num(net, 0));
            }, 0);
          }

          stateById.set(v.id, { variant: v, invRows, invAvailable, effectiveAvailable });
        }

        // Requested qty per variant
        const qtyByVariant = new Map();
        for (const ci of cart.items) {
          const q = Number(ci.quantity || 0);
          if (!q || !Number.isFinite(q)) continue;
          qtyByVariant.set(ci.variantId, (qtyByVariant.get(ci.variantId) || 0) + q);
        }

        // 2) Stock check
        for (const [variantId, requestedQty] of qtyByVariant.entries()) {
          const state = stateById.get(variantId);
          if (!state) {
            const e = new Error("INSUFFICIENT_STOCK");
            e.code = "INSUFFICIENT_STOCK";
            throw e;
          }

          const { variant, effectiveAvailable } = state;
          const backorderAllowed = !!variant.backorderAllowed;

          if (!backorderAllowed && effectiveAvailable < requestedQty) {
            const e = new Error("INSUFFICIENT_STOCK");
            e.code = "INSUFFICIENT_STOCK";
            throw e;
          }
        }

        // 3) Build item rows (pricing) ✅ cart snapshot is source-of-truth
        const variantById = new Map(variants.map((v) => [v.id, v]));
        const itemRows = [];

        for (const ci of cart.items) {
          const variant = variantById.get(ci.variantId);
          if (!variant) {
            const e = new Error("INSUFFICIENT_STOCK");
            e.code = "INSUFFICIENT_STOCK";
            throw e;
          }

          const requestedQty = Number(ci.quantity || 0) || 0;

          const variantPriceLine =
            variant.prices.find((p) => p.currency === cart.currency) || null;

          const productPriceLine =
            (await tx.price.findFirst({
              where: { productId: variant.productId, currency: cart.currency },
            })) || null;

          const cartUnit = n2(ci.unitPrice, NaN);
          const variantUnit = n2(variantPriceLine?.amount, NaN);
          const productUnit = n2(productPriceLine?.amount, NaN);

          const unitPrice = round2(
            Number.isFinite(cartUnit) && cartUnit > 0
              ? cartUnit
              : Number.isFinite(variantUnit) && variantUnit > 0
              ? variantUnit
              : Number.isFinite(productUnit) && productUnit > 0
              ? productUnit
              : 0
          );

          const cartLine =
            Number.isFinite(n2(ci.total, NaN))
              ? n2(ci.total)
              : Number.isFinite(n2(ci.lineTotal, NaN))
              ? n2(ci.lineTotal)
              : Number.isFinite(n2(ci.subtotal, NaN))
              ? n2(ci.subtotal)
              : Number.isFinite(n2(ci.lineSubtotal, NaN))
              ? n2(ci.lineSubtotal)
              : NaN;

          const subtotal = round2(Number.isFinite(cartLine) ? cartLine : unitPrice * requestedQty);

          itemRows.push({ cartItem: ci, variant, unitPrice, subtotal });
        }

        // 4) Resolve / create user
        // ✅ Keep your existing behavior, but ensure guest flow never depends on auth session.
        // If userId exists (logged), use it. Otherwise create/attach minimal user by phone/email.
        let linkedUserId = userId || null;

        if (!linkedUserId) {
          const candidate =
            (shippingIn.contactEmail &&
              (await tx.user.findFirst({ where: { email: shippingIn.contactEmail.toLowerCase() } }))) ||
            (shippingIn.phone &&
              (await tx.user.findFirst({ where: { phone: normalizePhoneBD(shippingIn.phone) } })));

          if (candidate) linkedUserId = candidate.id;
        }

        if (!linkedUserId) {
          const newUser = await tx.user.create({
            data: {
              email: shippingIn.contactEmail?.toLowerCase() || null,
              phone: normalizePhoneBD(shippingIn.phone),
              name: shippingIn.contactName || null,
              isActive: true,
            },
          });
          linkedUserId = newUser.id;
        }

        // 5) Create addresses
        const shipping = await upsertAddressAndVersion({
          tx,
          userId: linkedUserId,
          addr: shippingIn,
        });

        let billing = null;
        if (billingIn) {
          billing = await upsertAddressAndVersion({
            tx,
            userId: linkedUserId,
            addr: billingIn,
          });
        }

        const shippingCount = await tx.address.count({
          where: { userId: linkedUserId, type: "SHIPPING", archivedAt: null },
        });
        if (shippingCount === 1) {
          await setDefaultForUser({
            tx,
            userId: linkedUserId,
            addressId: shipping.id,
            type: "SHIPPING",
          });
        }

        // 6) Totals (mirror cart snapshot; do not re-price)
        const computedSubtotal = round2(itemRows.reduce((a, r) => a + r.subtotal, 0));
        const subtotal = round2(
          Number.isFinite(n2(cart.subtotal, NaN)) ? n2(cart.subtotal) : computedSubtotal
        );

        const discountTotal = round2(Number(cart.discountTotal || 0));
        const taxTotal = round2(Number(cart.taxTotal || 0));
        const shippingTotal = round2(Number(cart.shippingTotal || 0));

        const computedGrand = round2(subtotal - discountTotal + taxTotal + shippingTotal);
        const grandTotal = round2(
          Number.isFinite(n2(cart.grandTotal, NaN)) ? n2(cart.grandTotal) : computedGrand
        );

        // 7) Create order
        const createdOrder = await tx.order.create({
          data: {
            userId: linkedUserId,
            currency: cart.currency,
            status: "PLACED",
            paymentStatus: "UNPAID",
            fulfillmentStatus: "UNFULFILLED",
            shippingAddressId: shipping.id,
            billingAddressId: useBillingAsShipping ? shipping.id : billing?.id || null,
            channel: "WEB",
            source: "DIRECT",
            placedAt: new Date(),
            subtotal,
            discountTotal,
            taxTotal,
            shippingTotal,
            grandTotal,
            shippingCustomerCharge: shippingTotal,
            notes,
            metadata: {
              paymentMethod,
              isCod: isCod(paymentMethod),

              // ✅ Important for downstream receipt rules
              guestCheckout: !userId,

              contactName: shippingIn.contactName,
              contactPhone: normalizePhoneBD(shippingIn.phone),
              contactEmail: shippingIn.contactEmail,

              cartSnapshot: {
                currency: cart.currency,
                totals: { subtotal, discountTotal, taxTotal, shippingTotal, grandTotal },
                items: itemRows.map((r) => ({
                  variantId: r.variant.id,
                  productId: r.variant.productId,
                  sku: r.variant.sku || null,
                  title: r.variant.title || r.variant.sku || null,
                  quantity: Number(r.cartItem.quantity || 0) || 0,
                  unitPrice: r.unitPrice,
                  lineTotal: r.subtotal,
                })),
              },
            },
          },
        });

        // 8) Create order items
        for (const r of itemRows) {
          await tx.orderItem.create({
            data: {
              orderId: createdOrder.id,
              variantId: r.variant.id,
              title: r.variant.title || r.variant.sku || null,
              sku: r.variant.sku || null,
              quantity: r.cartItem.quantity,
              unitPrice: r.unitPrice,
              subtotal: r.subtotal,
              taxTotal: 0,
              discountTotal: 0,
              total: r.subtotal,
            },
          });
        }

        // 9) Decrement stock
        for (const [variantId, requestedQty] of qtyByVariant.entries()) {
          const state = stateById.get(variantId);
          if (!state) continue;

          const { variant, invRows, effectiveAvailable } = state;
          const backorderAllowed = !!variant.backorderAllowed;

          if (invRows.length > 0) {
            const inv = invRows[0];
            const onHandBefore = num(inv.onHand, 0);
            const newOnHand = onHandBefore - num(requestedQty, 0);

            if (newOnHand < 0 && !backorderAllowed) {
              const e = new Error("INSUFFICIENT_STOCK");
              e.code = "INSUFFICIENT_STOCK";
              throw e;
            }

            await tx.inventoryItem.update({
              where: { id: inv.id },
              data: {
                onHand: newOnHand,
                reserved: Math.max(num(inv.reserved, 0) - num(requestedQty, 0), 0),
              },
            });

            const newEffectiveAvailable = Math.max(0, num(effectiveAvailable, 0) - num(requestedQty, 0));
            await tx.productVariant.update({
              where: { id: variantId },
              data: {
                stockAvailable: newEffectiveAvailable,
                ...(variant.initialStock === 0 && (variant.strapiStockRaw ?? 0) > 0
                  ? { initialStock: variant.strapiStockRaw }
                  : {}),
              },
            });
          } else {
            const baseAvailable = num(effectiveAvailable, 0);
            const newStockAvailable = Math.max(0, baseAvailable - num(requestedQty, 0));
            await tx.productVariant.update({
              where: { id: variantId },
              data: {
                stockAvailable: newStockAvailable,
                ...(variant.initialStock === 0 && (variant.strapiStockRaw ?? 0) > 0
                  ? { initialStock: variant.strapiStockRaw }
                  : {}),
              },
            });
          }
        }

        // 10) Convert cart
        await tx.cart.update({
          where: { id: cart.id },
          data: {
            status: "CONVERTED",
            shippingAddressId: shipping.id,
            billingAddressId: useBillingAsShipping ? shipping.id : billing?.id || null,
          },
        });

        await tx.orderEvent.create({
          data: {
            orderId: createdOrder.id,
            kind: "CREATED",
            message: "Order created from active cart",
            metadata: {
              items: cart.items.length,
              currency: cart.currency,
              paymentMethod,
              guestCheckout: !userId,
            },
            actorRole: userId ? "CUSTOMER" : "SYSTEM",
            actorId: userId || null,
          },
        });

        return createdOrder;
      },
      // ✅ FIX ONLY: keep logic identical, extend txn window to avoid P2028 expiry
      { maxWait: 20000, timeout: 20000 }
    );

    const ms = Date.now() - startedAt;

    // Prisma → Strapi inventory sync after success
    try {
      const syncResult = await triggerStrapiInventoryFullSync(req);
      if (!syncResult?.ok) {
        console.error("[checkout/create-order] Prisma→Strapi inventory sync failed (non-fatal):", syncResult);
      }
    } catch (syncErr) {
      console.error("[checkout/create-order] Unexpected inventory sync error (non-fatal):", syncErr);
    }

    console.log(JSON.stringify({ route: "checkout/create-order", orderId: order.id, ms }));
    return ok(order);
  } catch (err) {
    const ms = Date.now() - startedAt;

    console.error("create-order error", err?.code || err?.message || String(err));
    console.log(
      JSON.stringify({
        route: "checkout/create-order",
        error: err?.code || err?.message,
        ms,
      })
    );

    if (err?.code === "INSUFFICIENT_STOCK") return bad("INSUFFICIENT_STOCK", 409);
    return bad("UNKNOWN", 500);
  }
}
