// FILE: app/api/orders/place/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * Guest + Logged-in Place Order (COD OTP) – hardened.
 *
 * Fixes:
 * 1) Build errors:
 *    - Removed next-auth imports (getServerSession/authOptions) that don't exist in your setup.
 * 2) Prisma P2003 CartItem_variantId_fkey:
 *    - When hydrating guest cart from snapshot, we ONLY write real ProductVariant.id.
 *    - Snapshot variant references may be:
 *        - Prisma ProductVariant.id (cuid-like)
 *        - Strapi size row id (digits-only) => ProductVariant.strapiSizeId
 *        - SKU => ProductVariant.sku
 *    - Any line that cannot be resolved is dropped (so we never FK-crash).
 *
 * NEW (minimal, targeted):
 * 3) MOBILE_REQUIRED on logged-in COD:
 *    - If Address.phone is empty for logged-in customers, create-order fails.
 *    - We now backfill shipping/billing phone from:
 *        (a) Address.phone
 *        (b) Verified OTP identifier (if phone)
 *        (c) User.phone from DB
 *    - Phone is normalized to BD local "01XXXXXXXXX" (safe for common validators).
 *
 * NEW (compatibility fix only):
 * 4) After OTP success, UI stuck "loading" (no redirect):
 *    - Some client flows expect success payload under `data.*` (e.g. data.redirectUrl).
 *    - We now include the SAME payload both at top-level AND inside `data` (no behavior change).
 *
 * NEW (actual root-cause fix):
 * 5) Logged-in flow stuck loading because create-order didn't receive otp_session:
 *    - We were forwarding the entire Set-Cookie string in a Cookie header (invalid).
 *    - Now we forward only the cookie pair "otp_session=VALUE".
 *    - We still return the full Set-Cookie to the browser unchanged.
 */

const OTP_DEBUG =
  process.env.OTP_DEBUG === "1" || process.env.NEXT_PUBLIC_OTP_DEBUG === "1";

// same SID cookie used across guest cart flows
const SID_COOKIE = "tdlc_sid";

// ------------------------------- small utils -------------------------------

function j(payload, status = 200, headers = {}) {
  return NextResponse.json(payload, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function canon(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function nint(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function nnum(v, fallback = NaN) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function isDigitsOnly(s) {
  return /^[0-9]+$/.test(String(s ?? ""));
}

function looksLikePrismaId(s) {
  // cuid/cuid2 are typically long, non-digit strings
  const str = String(s ?? "").trim();
  if (!str) return false;
  if (isDigitsOnly(str)) return false;
  return str.length >= 18;
}

function getCookie(req, name) {
  try {
    const raw = req.headers.get("cookie") || "";
    const m = raw.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function makeSid() {
  return "sid_" + crypto.randomBytes(16).toString("hex");
}

function preserveCartSidCookie(res, sid) {
  if (!sid) return;
  try {
    res.cookies.set({
      name: SID_COOKIE,
      value: String(sid),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 60, // 60 days
    });
  } catch {
    // ignore
  }
}

function pickAddress(body, which) {
  const direct =
    body?.[which] ||
    body?.[`${which}Address`] ||
    (which === "shipping" ? body?.shippingAddress : body?.billingAddress);

  if (!direct || typeof direct !== "object") return null;
  return direct;
}

function normalizeAddressInput(a) {
  if (!a || typeof a !== "object") return null;

  const countryIso2 = (a.countryIso2 || a.country || "BD")
    .toString()
    .toUpperCase();

  const line1 =
    a.line1 ||
    a.addressLine1 ||
    a.address1 ||
    a.streetAddress ||
    a.address ||
    "";

  const line2 = a.line2 || a.addressLine2 || a.address2 || "";

  const city = a.city || a.cityOrUpazila || a.upazila || "";
  const state = a.state || a.district || a.division || "";
  const postalCode = a.postalCode || a.postcode || a.zip || "";

  return {
    name: canon(a.name ?? ""),
    phone: canon(a.phone ?? ""),
    email: canon(a.email ?? "").toLowerCase(),
    line1: canon(line1),
    line2: canon(line2),
    city: canon(city),
    state: canon(state),
    postalCode: canon(postalCode),
    countryIso2,
  };
}

function isAddressComplete(a) {
  if (!a) return false;
  if (!canon(a.line1)) return false;
  if (!canon(a.city)) return false;
  if (!canon(a.countryIso2)) return false;
  return true;
}

function sameAddress(a, b) {
  if (!a || !b) return false;
  return (
    canon(a.line1).toLowerCase() === canon(a.line1).toLowerCase() &&
    canon(a.line2).toLowerCase() === canon(b.line2).toLowerCase() &&
    canon(a.city).toLowerCase() === canon(b.city).toLowerCase() &&
    canon(a.state).toLowerCase() === canon(b.state).toLowerCase() &&
    canon(a.postalCode).toLowerCase() === canon(b.postalCode).toLowerCase() &&
    canon(a.countryIso2).toUpperCase() === canon(b.countryIso2).toUpperCase()
  );
}

function guestReceiptUrlFor(orderId) {
  return `/orders/${encodeURIComponent(orderId)}/receipt`;
}
function customerReceiptUrlFor(orderId) {
  return `/customer/orders/${encodeURIComponent(orderId)}/receipt`;
}
function pickReceiptUrl(orderId, isGuest) {
  return isGuest ? guestReceiptUrlFor(orderId) : customerReceiptUrlFor(orderId);
}

// ---------------------- BD mobile normalization (targeted) ----------------------

const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

function normalizeBdPhoneDigits(raw) {
  if (!raw) return null;

  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+0")) s = s.slice(1);

  let digits = s.startsWith("+") ? s.slice(1) : s;

  const m8800 = digits.match(/^8800(1\d{9})$/);
  if (m8800) digits = "880" + m8800[1];

  if (/^0880\d{10}$/.test(digits)) digits = "880" + digits.slice(4);
  if (/^00880\d{10}$/.test(digits)) digits = "880" + digits.slice(5);

  if (/^0\d{10}$/.test(digits)) digits = "880" + digits.slice(1);
  if (/^1\d{9}$/.test(digits)) digits = "880" + digits;

  if (!/^8801\d{9}$/.test(digits)) return null;

  const prefix = digits.slice(3, 5);
  const allowed = new Set(["13", "14", "15", "16", "17", "18", "19", "11"]);
  if (!allowed.has(prefix)) return null;

  return digits;
}

function bdDigitsToLocal(digits) {
  const d = String(digits || "");
  if (/^8801\d{9}$/.test(d)) return "0" + d.slice(3);
  return null;
}

function bestBdPhoneLocal(...candidates) {
  for (const c of candidates) {
    const d = normalizeBdPhoneDigits(c);
    if (d) return bdDigitsToLocal(d);
  }
  return null;
}

// ---------------------- customer-plane cookie forwarding ----------------------

function splitSetCookieHeader(setCookie) {
  if (!setCookie) return [];
  if (Array.isArray(setCookie)) return setCookie.map(String).filter(Boolean);
  const s = String(setCookie);
  if (/expires=/i.test(s)) return [s];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Convert a Set-Cookie string into a cookie-pair suitable for the Cookie header.
 * Example: "otp_session=abc; Path=/; HttpOnly" -> "otp_session=abc"
 */
function cookiePairFromSetCookie(setCookieStr) {
  const s = String(setCookieStr || "").trim();
  if (!s) return "";
  const pair = s.split(";")[0]?.trim() || "";
  return pair.includes("=") ? pair : "";
}

function buildForwardCookieHeader(req, extraCookiePair) {
  const base = String(req.headers.get("cookie") || "").trim();
  const add = String(extraCookiePair || "").trim();
  if (!add) return base;
  return base ? `${base}; ${add}` : add;
}

// ------------------------------ OTP verification ------------------------------

async function verifyOtpWithForwardedSession(req, identifierRaw, codeRaw, purposeRaw) {
  const identifier = canon(identifierRaw);
  const code = canon(codeRaw);
  const purpose = canon(purposeRaw || "cod_confirm") || "cod_confirm";

  if (!identifier || !code) {
    return { ok: false, status: 422, error: "OTP_REQUIRED" };
  }

  const url = new URL(req.url);
  url.pathname = "/api/auth/verify-otp";

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      cookie: String(req.headers.get("cookie") || ""),
    },
    body: JSON.stringify({ identifier, code, purpose }),
  });

  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }

  const setCookie = r.headers.get("set-cookie") || "";
  const cookies = splitSetCookieHeader(setCookie);

  const otpSessionCookieFull =
    cookies.find((c) => /^otp_session=/.test(String(c).trim())) || null;

  const otpSessionCookiePair = cookiePairFromSetCookie(otpSessionCookieFull);

  const ok = r.ok && (data?.ok === true || data?.verified === true);
  return {
    ok,
    status: r.status,
    data,
    error: ok ? null : data?.error || data?.code || "OTP_INVALID",
    otpSessionCookieFull,
    otpSessionCookiePair,
    phoneVerified: Boolean(data?.phoneVerified || data?.verified),
  };
}

// -------------------------- snapshot extraction helpers --------------------------

function extractCartSnapshot(body) {
  const snap =
    body?.cartSnapshot ||
    body?.snapshot ||
    body?.cart ||
    body?.cartState ||
    null;

  if (!snap || typeof snap !== "object") return null;

  const currency = canon(snap.currency || snap.curr || snap.ccy || "BDT").toUpperCase();

  const rawItems =
    snap.items ||
    snap.lines ||
    snap.cartItems ||
    snap.products ||
    body?.items ||
    null;

  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;

  const items = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue;

    const variantId =
      it.variantId ??
      it.variant ??
      it.variant_id ??
      it.productVariantId ??
      it.strapiSizeId ??
      it.sizeId ??
      it.sku ??
      null;

    const qty = Math.max(1, nint(it.quantity ?? it.qty ?? it.count ?? 1, 1));
    const unitPrice = nnum(it.unitPrice ?? it.price ?? it.unit ?? NaN);

    const ref = canon(variantId);
    if (!ref) continue;

    items.push({
      variantRef: ref,
      quantity: qty,
      ...(Number.isFinite(unitPrice) && unitPrice > 0 ? { unitPrice } : {}),
    });
  }

  if (!items.length) return null;
  return { currency, items };
}

// ---------------------- snapshot -> real ProductVariant.id ----------------------

async function resolveSnapshotVariantIds(items) {
  const refs = items.map((x) => canon(x.variantRef)).filter(Boolean);

  const idRefs = refs.filter((r) => looksLikePrismaId(r));
  const strapiRefs = refs.filter((r) => isDigitsOnly(r)).map((r) => Number(r));
  const skuRefs = refs.filter((r) => !looksLikePrismaId(r) && !isDigitsOnly(r));

  const OR = [];
  if (idRefs.length) OR.push({ id: { in: idRefs } });
  if (strapiRefs.length) OR.push({ strapiSizeId: { in: strapiRefs } });
  if (skuRefs.length) OR.push({ sku: { in: skuRefs } });

  if (!OR.length) {
    return {
      resolved: items.map((x) => ({ ...x, variantId: null })),
      report: { total: items.length, resolved: 0, dropped: items.length },
    };
  }

  const variants = await prisma.productVariant.findMany({
    where: { OR },
    select: { id: true, sku: true, strapiSizeId: true },
  });

  const byId = new Map();
  const bySku = new Map();
  const byStrapi = new Map();

  for (const v of variants) {
    if (v?.id) byId.set(String(v.id), String(v.id));
    if (v?.sku) bySku.set(String(v.sku), String(v.id));
    if (v?.strapiSizeId != null) byStrapi.set(String(v.strapiSizeId), String(v.id));
  }

  const resolved = items.map((x) => {
    const ref = canon(x.variantRef);
    let vid = null;
    if (looksLikePrismaId(ref)) vid = byId.get(ref) || null;
    else if (isDigitsOnly(ref)) vid = byStrapi.get(ref) || null;
    else vid = bySku.get(ref) || null;

    return { ...x, variantId: vid };
  });

  const okCount = resolved.filter((x) => x.variantId).length;
  const dropped = resolved.length - okCount;

  return {
    resolved,
    report: { total: resolved.length, resolved: okCount, dropped },
  };
}

async function upsertGuestPrismaCartFromSnapshot(sessionId, snapshot) {
  const sid = canon(sessionId);
  if (!sid) return { ok: false, reason: "SID_REQUIRED" };
  if (!snapshot?.items?.length) return { ok: false, reason: "SNAPSHOT_EMPTY" };

  try {
    const currency = canon(snapshot.currency || "BDT").toUpperCase();

    const { resolved, report } = await resolveSnapshotVariantIds(snapshot.items);
    const valid = resolved.filter((x) => x.variantId);

    if (!valid.length) {
      return {
        ok: false,
        reason: "NO_VALID_VARIANTS_IN_SNAPSHOT",
        report,
      };
    }

    const itemsData = valid.map((x) => ({
      variantId: x.variantId,
      quantity: x.quantity,
      ...(x.unitPrice ? { unitPrice: x.unitPrice } : {}),
    }));

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.cart.findFirst({
        where: { sessionId: sid, status: "ACTIVE" },
        select: { id: true },
        orderBy: { updatedAt: "desc" },
      });

      if (!existing) {
        const created = await tx.cart.create({
          data: {
            sessionId: sid,
            status: "ACTIVE",
            currency,
            items: { createMany: { data: itemsData } },
          },
          select: { id: true },
        });
        return { mode: "created", cartId: created.id, hydrate: report };
      }

      await tx.cart.update({
        where: { id: existing.id },
        data: {
          currency,
          items: {
            deleteMany: {},
            createMany: { data: itemsData },
          },
        },
      });

      return { mode: "updated", cartId: existing.id, hydrate: report };
    });

    return { ok: true, ...result };
  } catch (e) {
    console.error("[api/orders/place] cart hydrate failed:", e);
    return { ok: false, reason: "UPSERT_FAILED" };
  }
}

// ------------------------------ create-order call ------------------------------

function extractOrderFromCreateData(data) {
  /**
   * create-order responses in this codebase have historically varied between:
   *  - { ok:true, order:{ id, orderNumber, ... } }
   *  - { ok:true, data:{ order:{...} } }
   *  - { ok:true, orderId, orderNumber, receiptUrl, ... }   (minimal)
   *  - { ok:true, data:{ orderId, orderNumber, ... } }      (minimal)
   *
   * To prevent "ORDER_CREATE_INVALID_RESPONSE" after the order is actually created
   * (which leaves the UI stuck loading), we normalize these shapes into an object
   * that always contains `id` (string) and optionally `orderNumber`.
   */
  const root =
    data && typeof data === "object"
      ? data?.data && typeof data.data === "object"
        ? data.data
        : data
      : null;

  // Prefer a real order object if present
  const candidate =
    root?.order ||
    root?.data?.order ||
    data?.order ||
    data?.data?.order ||
    null;

  if (candidate && typeof candidate === "object") {
    const id =
      candidate.id ??
      candidate.orderId ??
      candidate.order_id ??
      root?.orderId ??
      root?.order_id ??
      root?.id ??
      null;

    if (!id) return null;

    return {
      ...candidate,
      id: String(id),
      orderNumber:
        candidate.orderNumber ??
        candidate.orderNo ??
        candidate.order_number ??
        root?.orderNumber ??
        root?.orderNo ??
        root?.order_number ??
        null,
    };
  }

  // Fall back to minimal shape
  const id = root?.orderId ?? root?.order_id ?? root?.id ?? data?.orderId ?? data?.order_id ?? data?.id ?? null;
  if (!id) return null;

  return {
    id: String(id),
    orderNumber:
      root?.orderNumber ??
      root?.orderNo ??
      root?.order_number ??
      data?.orderNumber ??
      data?.orderNo ??
      data?.order_number ??
      null,
  };
}

async function callCreateOrderOnce(req, body, ctx) {
  const url = new URL(req.url);
  url.pathname = "/api/checkout/create-order";

  const cookieHeader = buildForwardCookieHeader(req, ctx?.extraCookiePair);

  const r = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      cookie: cookieHeader,
    },
    body: JSON.stringify({
      ...body,
      paymentMethod: ctx?.method || body?.paymentMethod || body?.paymentProvider || "CASH_ON_DELIVERY",
      shipping: ctx?.shippingPayload || body?.shipping || body?.shippingAddress || null,
      billing: ctx?.billingPayload || body?.billing || body?.billingAddress || null,
      useBillingAsShipping: true,
      guestCheckout: Boolean(ctx?.isGuest),
      mode: ctx?.isGuest ? "guest" : body?.mode,
    }),
  });

  let data = null;
  try {
    data = await r.json();
  } catch {
    data = null;
  }

  return { ok: r.ok && data?.ok === true, status: r.status, data };
}

async function callCreateOrderWithGuestRecovery(req, body, ctx) {
  const a1 = await callCreateOrderOnce(req, body, ctx);
  if (a1.ok) return a1;

  const code = a1.data?.code || a1.data?.error || null;
  const cartEmpty =
    code === "CART_EMPTY" ||
    a1.data?.error === "CART_EMPTY" ||
    a1.data?.code === "CART_EMPTY";

  if (!ctx?.isGuest || !cartEmpty) {
    return { ok: false, status: a1.status, code: code || "ORDER_CREATE_FAILED", data: a1.data };
  }

  const snapshot = extractCartSnapshot(body);
  if (!snapshot?.items?.length) {
    return { ok: false, status: 400, code: "CART_EMPTY", data: a1.data };
  }

  const hydrate = await upsertGuestPrismaCartFromSnapshot(ctx.sid, snapshot);
  if (!hydrate.ok) {
    return {
      ok: false,
      status: 400,
      code: "CART_EMPTY",
      data: { ...a1.data, hydrate },
    };
  }

  const a2 = await callCreateOrderOnce(req, body, ctx);
  if (a2.ok) return a2;

  const code2 = a2.data?.code || a2.data?.error || "ORDER_CREATE_FAILED";
  return { ok: false, status: a2.status, code: code2, data: a2.data };
}

// ------------------------- success payload (compat) -------------------------

function buildSuccessPayload(order, isGuest) {
  const redirectUrl = pickReceiptUrl(order.id, isGuest);
  const payload = {
    ok: true,
    success: true, // harmless compatibility
    orderId: order.id,
    orderNumber: order.orderNumber,
    order: { ...order, receiptUrl: redirectUrl },
    receiptUrl: redirectUrl,
    redirectUrl,
    redirect: redirectUrl, // harmless compatibility

    guestReceiptUrl: guestReceiptUrlFor(order.id),
    customerReceiptUrl: customerReceiptUrlFor(order.id),
  };

  // Compatibility: also provide under data.*
  return { ...payload, data: payload };
}

// --------------------------------- main POST ---------------------------------

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return j({ ok: false, success: false, error: "INVALID_BODY" }, 400);

    const sid =
      canon(getCookie(req, SID_COOKIE) || body?.sid || body?.sessionId || "") ||
      makeSid();

    const isGuest =
      body?.guestCheckout === true ||
      String(body?.mode || "").toLowerCase() === "guest" ||
      (body?.guest && typeof body.guest === "object" && !body?.shippingAddressId);

    const method = canon(body?.paymentMethod || body?.paymentProvider || body?.method || "CASH_ON_DELIVERY");

    const needsOtp =
      method === "CASH_ON_DELIVERY" || method === "COD" || method === "MANUAL";

    if (needsOtp) {
      const otp = body?.otp || null;
      if (!otp?.identifier || !otp?.code) return j({ ok: false, success: false, error: "OTP_REQUIRED" }, 422);

      const otpResult = await verifyOtpWithForwardedSession(
        req,
        otp.identifier,
        otp.code,
        otp.purpose || "cod_confirm"
      );

      if (!otpResult.ok) {
        return j(
          OTP_DEBUG
            ? { ok: false, success: false, error: "OTP_INVALID", detail: { status: otpResult.status, reason: otpResult.error } }
            : { ok: false, success: false, error: "OTP_INVALID" },
          400
        );
      }

      // ✅ forward only cookie-pair to create-order
      const otpSessionCookiePair = otpResult.otpSessionCookiePair;
      // ✅ return full set-cookie to browser
      const otpSessionCookieFull = otpResult.otpSessionCookieFull;

      // --------------------------- logged-in flow ---------------------------
      if (!isGuest) {
        const auth = await requireAuth(req).catch(() => null);
        const userId = auth?.userId || auth?.session?.user?.id || null;

        const shippingAddressId = body?.shippingAddressId ? String(body.shippingAddressId) : null;
        const billingAddressId = body?.billingAddressId ? String(body.billingAddressId) : null;

        if (!userId) return j({ ok: false, success: false, error: "UNAUTHORIZED" }, 401);
        if (!shippingAddressId || !billingAddressId) return j({ ok: false, success: false, error: "ADDRESS_REQUIRED" }, 422);

        const [shipping, billing] = await Promise.all([
          prisma.address?.findUnique ? prisma.address.findUnique({ where: { id: shippingAddressId } }) : null,
          prisma.address?.findUnique ? prisma.address.findUnique({ where: { id: billingAddressId } }) : null,
        ]);

        if (!shipping || shipping.userId !== userId) return j({ ok: false, success: false, error: "INVALID_SHIPPING_ADDRESS" }, 403);
        if (!billing || billing.userId !== userId) return j({ ok: false, success: false, error: "INVALID_BILLING_ADDRESS" }, 403);

        if (String(billing.id) !== String(shipping.id)) {
          return j({ ok: false, success: false, error: "COD_REQUIRES_SAME_ADDRESSES" }, 422);
        }

        let userPhoneDb = null;
        try {
          const u = await prisma.user.findUnique({
            where: { id: String(userId) },
            select: { phone: true },
          });
          userPhoneDb = u?.phone || null;
        } catch {
          userPhoneDb = null;
        }

        const otpIdentifier = canon(otp?.identifier || "");
        const otpLooksPhone = otpIdentifier && !isEmail(otpIdentifier);

        const resolvedPhoneLocal = bestBdPhoneLocal(
          shipping.phone,
          billing.phone,
          otpLooksPhone ? otpIdentifier : null,
          userPhoneDb
        );

        if (!resolvedPhoneLocal) {
          return j({ ok: false, success: false, error: "MOBILE_REQUIRED" }, 422);
        }

        const shippingPayload = {
          name: shipping.name || null,
          phone: resolvedPhoneLocal,
          email: shipping.email || null,
          line1: shipping.line1,
          line2: shipping.line2,
          city: shipping.city,
          state: shipping.state,
          postalCode: shipping.postalCode,
          countryIso2: shipping.countryIso2,
        };

        const billingPayload = { ...shippingPayload };

        const attempt = await callCreateOrderWithGuestRecovery(req, body, {
          method,
          shippingPayload,
          billingPayload,
          isGuest: false,
          extraCookiePair: otpSessionCookiePair,
          sid,
        });

        if (!attempt.ok) {
          return j(
            OTP_DEBUG
              ? { ok: false, success: false, error: attempt.code, detail: { status: attempt.status } }
              : { ok: false, success: false, error: attempt.code },
            attempt.status || 400
          );
        }

        const order = extractOrderFromCreateData(attempt.data);
        if (!order?.id) return j({ ok: false, success: false, error: "ORDER_CREATE_INVALID_RESPONSE" }, 502);

        const payload = buildSuccessPayload(order, false);

        const res = NextResponse.json(payload, {
          headers: { "cache-control": "no-store" },
        });

        preserveCartSidCookie(res, sid);

        if (otpSessionCookieFull && String(otpSessionCookieFull).startsWith("otp_session=")) {
          try {
            res.headers.append("Set-Cookie", String(otpSessionCookieFull));
          } catch {}
        }

        return res;
      }

      // --------------------------- guest COD flow ---------------------------
      const guest = body?.guest && typeof body.guest === "object" ? body.guest : {};

      const shipRaw = pickAddress(body, "shipping");
      const billRaw = pickAddress(body, "billing") || shipRaw;

      const shippingPayload = normalizeAddressInput({
        ...shipRaw,
        name: shipRaw?.name ?? guest?.fullName ?? guest?.name ?? shipRaw?.name,
        phone: shipRaw?.phone ?? guest?.phone ?? shipRaw?.phone,
        email: shipRaw?.email ?? guest?.email ?? shipRaw?.email,
      });

      const billingPayload = normalizeAddressInput({
        ...billRaw,
        name: billRaw?.name ?? guest?.fullName ?? guest?.name ?? billRaw?.name,
        phone: billRaw?.phone ?? guest?.phone ?? billRaw?.phone,
        email: billRaw?.email ?? guest?.email ?? billRaw?.email,
      });

      if (!shippingPayload || !isAddressComplete(shippingPayload)) {
        const res = j({ ok: false, success: false, error: "SHIPPING_ADDRESS_REQUIRED" }, 422);
        preserveCartSidCookie(res, sid);
        return res;
      }
      if (!billingPayload || !isAddressComplete(billingPayload)) {
        const res = j({ ok: false, success: false, error: "BILLING_ADDRESS_REQUIRED" }, 422);
        preserveCartSidCookie(res, sid);
        return res;
      }
      if (!sameAddress(shippingPayload, billingPayload)) {
        const res = j({ ok: false, success: false, error: "COD_REQUIRES_SAME_ADDRESSES" }, 422);
        preserveCartSidCookie(res, sid);
        return res;
      }

      const snapshot = extractCartSnapshot(body);
      if (snapshot?.items?.length) {
        await upsertGuestPrismaCartFromSnapshot(sid, snapshot);
      }

      const attempt = await callCreateOrderWithGuestRecovery(req, body, {
        method,
        shippingPayload,
        billingPayload,
        isGuest: true,
        extraCookiePair: otpSessionCookiePair,
        sid,
      });

      if (!attempt.ok) {
        const res = j(
          OTP_DEBUG ? { ok: false, success: false, error: attempt.code, detail: attempt.data } : { ok: false, success: false, error: attempt.code },
          attempt.status || 400
        );
        preserveCartSidCookie(res, sid);
        if (otpSessionCookieFull && String(otpSessionCookieFull).startsWith("otp_session=")) {
          try {
            res.headers.append("Set-Cookie", String(otpSessionCookieFull));
          } catch {}
        }
        return res;
      }

      const order = extractOrderFromCreateData(attempt.data);
      if (!order?.id) {
        const res = j({ ok: false, success: false, error: "ORDER_CREATE_INVALID_RESPONSE" }, 502);
        preserveCartSidCookie(res, sid);
        return res;
      }

      const payload = buildSuccessPayload(order, true);

      const res = NextResponse.json(payload, {
        headers: { "cache-control": "no-store" },
      });

      preserveCartSidCookie(res, sid);

      if (otpSessionCookieFull && String(otpSessionCookieFull).startsWith("otp_session=")) {
        try {
          res.headers.append("Set-Cookie", String(otpSessionCookieFull));
        } catch {}
      }

      return res;
    }

    // Non-OTP payment methods: still place order (no OTP gate)
    const snapshot = extractCartSnapshot(body);
    if (isGuest && snapshot?.items?.length) {
      await upsertGuestPrismaCartFromSnapshot(sid, snapshot);
    }

    const attempt = await callCreateOrderWithGuestRecovery(req, body, {
      method,
      isGuest,
      sid,
    });

    if (!attempt.ok) {
      const res = j({ ok: false, success: false, error: attempt.code }, attempt.status || 400);
      preserveCartSidCookie(res, sid);
      return res;
    }

    const order = extractOrderFromCreateData(attempt.data);
    if (!order?.id) {
      const res = j({ ok: false, success: false, error: "ORDER_CREATE_INVALID_RESPONSE" }, 502);
      preserveCartSidCookie(res, sid);
      return res;
    }

    const res = j(buildSuccessPayload(order, isGuest), 200);
    preserveCartSidCookie(res, sid);
    return res;
  } catch (e) {
    console.error("[api/orders/place] fatal:", e);
    return j({ ok: false, success: false, error: "INTERNAL_ERROR" }, 500);
  }
}
