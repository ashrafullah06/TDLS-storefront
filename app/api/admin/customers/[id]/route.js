// FILE: app/api/admin/customers/[id]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Prisma } from "@prisma/client";

function json(body, status = 200, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function str(v) {
  return String(v ?? "").trim();
}
function int(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : d;
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function bool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function normalizeEmail(v) {
  const s = str(v).toLowerCase();
  return s ? s : null;
}
function normalizePhone(v) {
  const s = str(v);
  if (!s) return null;
  const cleaned = s.replace(/[^\d+]/g, "");
  return cleaned ? cleaned : null;
}
function normalizeCountryIso2(v) {
  const s = str(v).toUpperCase();
  if (!s) return null;
  if (s.length !== 2) return null;
  return s;
}
function normalizeAddressType(v) {
  const s = str(v).toUpperCase();
  return s === "BILLING" ? "BILLING" : "SHIPPING";
}
function dec2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return new Prisma.Decimal("0.00");
  return new Prisma.Decimal(x.toFixed(2));
}
function actorIdFromRequireAdminResult(actor) {
  return (
    actor?.id ||
    actor?.user?.id ||
    actor?.admin?.id ||
    actor?.actor?.id ||
    actor?.session?.user?.id ||
    null
  );
}

function computeSystemRiskFromAgg(agg) {
  const flags = [];

  const total = Number(agg.total || 0);
  const cancelled = Number(agg.cancelled || 0);
  const unpaidCancelled = Number(agg.unpaidCancelled || 0);
  const returnsCount = Number(agg.returnsCount || 0);
  const fraudOrders = Number(agg.fraudOrders || 0);
  const fraudChecks = Number(agg.fraudChecks || 0);
  const distinctShip = Number(agg.distinctShip || 0);
  const recent30 = Number(agg.recent30 || 0);

  const fraudTouches = fraudOrders + fraudChecks;

  const cancelRate = total ? cancelled / total : 0;
  const codNonPayRate = total ? unpaidCancelled / total : 0;
  const returnRate = total ? returnsCount / total : 0;

  if (fraudTouches > 0) flags.push("FRAUD_SUSPECT");
  if (cancelled >= 3 && cancelRate >= 0.25) flags.push("FREQUENT_CANCELLER");
  if (unpaidCancelled >= 2 && codNonPayRate >= 0.15) flags.push("COD_NON_PAYER");
  if (returnsCount >= 2 && returnRate >= 0.15) flags.push("RETURN_ABUSE");
  if (distinctShip >= 3 && total >= 3) flags.push("ADDRESS_MISMATCH");
  if (recent30 >= 4 && total >= 5) flags.push("SUSPICIOUS_ORDERING");

  let score = 0;
  if (flags.includes("FRAUD_SUSPECT")) score += 40;
  if (flags.includes("COD_NON_PAYER")) score += 25;
  if (flags.includes("FREQUENT_CANCELLER")) score += 20;
  if (flags.includes("RETURN_ABUSE")) score += 15;
  if (flags.includes("ADDRESS_MISMATCH")) score += 10;
  if (flags.includes("SUSPICIOUS_ORDERING")) score += 10;

  score = clamp(score, 0, 100);
  const level = score >= 60 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";

  return {
    score,
    level,
    flags,
    cancelRatePct: Math.round(cancelRate * 100),
    codNonPayRatePct: Math.round(codNonPayRate * 100),
    multiAddressCount: distinctShip,
    fraudTouches,
  };
}

async function getId(ctx) {
  const p = await (ctx?.params ?? {});
  return str(p?.id);
}

function makeRequestId() {
  return (
    (globalThis.crypto?.randomUUID?.() ? globalThis.crypto.randomUUID() : null) ||
    `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

async function bestEffortAudit(tx, data) {
  try {
    if (tx?.auditLog?.create) {
      await tx.auditLog.create({ data });
    }
  } catch {
    // never break writes
  }
}

/**
 * ✅ CRITICAL FIX (server “breaking”):
 * Old code used: to_jsonb(o) + GROUP BY o.id,o.createdAt (invalid in Postgres) :contentReference[oaicite:1]{index=1}
 * New code uses LEFT JOIN LATERAL to aggregate items per-order with no GROUP BY.
 */
async function loadOrdersFullSafe(userId, ordersTake) {
  const take = clamp(int(ordersTake, 5000), 1, 20000);

  try {
    const rows = await prisma.$queryRaw`
      WITH ord AS (
        SELECT o.*
        FROM "Order" o
        WHERE o."userId" = ${userId}
        ORDER BY o."createdAt" DESC
        LIMIT ${take}
      )
      SELECT
        o."id" AS "id",
        o."createdAt" AS "createdAt",
        to_jsonb(o) AS "order",
        COALESCE(items.items, '[]'::jsonb) AS "items"
      FROM ord o
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'item', to_jsonb(oi),
            'variant', CASE WHEN v."id" IS NULL THEN NULL ELSE to_jsonb(v) END,
            'product', CASE WHEN p."id" IS NULL THEN NULL ELSE to_jsonb(p) END
          )
          ORDER BY oi."id"
        ) FILTER (WHERE oi."id" IS NOT NULL) AS items
        FROM "OrderItem" oi
        LEFT JOIN "ProductVariant" v ON v."id" = oi."variantId"
        LEFT JOIN "Product" p ON p."id" = v."productId"
        WHERE oi."orderId" = o."id"
      ) items ON TRUE
      ORDER BY o."createdAt" DESC;
    `;

    const arr = Array.isArray(rows) ? rows : [];
    return arr.map((r) => {
      const o = r?.order || {};
      const items = Array.isArray(r?.items) ? r.items : [];
      return { ...o, items, itemCount: items.length };
    });
  } catch {
    // Hard fallback: do not break customer details even if raw SQL fails.
    const orders = await prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        items: {
          include: {
            variant: { include: { product: true } },
          },
        },
      },
    });

    return (orders || []).map((o) => {
      const bundles =
        (o.items || []).map((it) => ({
          item: it,
          variant: it.variant || null,
          product: it.variant?.product || null,
        })) || [];
      const { items, ...rest } = o;
      return { ...rest, items: bundles, itemCount: bundles.length };
    });
  }
}

async function promoteAnotherDefaultAddress(tx, userId) {
  const next = await tx.address.findFirst({
    where: { userId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!next?.id) {
    await tx.user.update({ where: { id: userId }, data: { defaultAddressId: null } });
    return null;
  }

  await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
  await tx.address.update({ where: { id: next.id }, data: { isDefault: true, archivedAt: null } });
  await tx.user.update({ where: { id: userId }, data: { defaultAddressId: next.id } });
  return next.id;
}

async function setDefaultAddressTx(tx, userId, addressId) {
  const addr = await tx.address.findFirst({
    where: { id: addressId, userId, archivedAt: null },
    select: { id: true },
  });
  if (!addr) return { ok: false, status: 404, error: "address_not_found" };

  await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
  await tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
  await tx.user.update({ where: { id: userId }, data: { defaultAddressId: addressId } });

  return { ok: true };
}

async function addAddressTx(tx, userId, payload) {
  const type = normalizeAddressType(payload?.type);
  const line1 = str(payload?.line1);
  const line2 = payload?.line2 == null ? null : str(payload?.line2) || null;
  const city = str(payload?.city);
  const state = payload?.state == null ? null : str(payload?.state) || null;
  const postalCode = payload?.postalCode == null ? null : str(payload?.postalCode) || null;
  const countryIso2 = normalizeCountryIso2(payload?.countryIso2) || "BD";
  const phone = normalizePhone(payload?.phone);
  const label = payload?.label == null ? null : str(payload?.label) || null;
  const source = payload?.source == null ? null : str(payload?.source) || null;

  if (!line1 && !line2) return { ok: false, status: 400, error: "address_line_required" };
  if (!city) return { ok: false, status: 400, error: "address_city_required" };
  if (!countryIso2) return { ok: false, status: 400, error: "address_country_required" };

  const isDefaultWanted = bool(payload?.isDefault);

  const created = await tx.address.create({
    data: {
      userId,
      type,
      line1: line1 || (line2 || "-"),
      line2,
      city,
      state,
      postalCode,
      countryIso2,
      phone,
      label,
      source,
      isDefault: false,
      archivedAt: null,
      phoneVerifiedAt: null,
    },
  });

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { defaultAddressId: true },
  });

  const shouldSetDefault = isDefaultWanted || !user?.defaultAddressId;
  if (shouldSetDefault) {
    await setDefaultAddressTx(tx, userId, created.id);
  }

  return { ok: true, address: created };
}

async function updateAddressTx(tx, userId, payload) {
  const addressId = str(payload?.addressId);
  if (!addressId) return { ok: false, status: 400, error: "address_id_required" };

  const current = await tx.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true, phone: true, archivedAt: true },
  });
  if (!current) return { ok: false, status: 404, error: "address_not_found" };

  const next = {};
  if ("type" in payload) next.type = normalizeAddressType(payload.type);
  if ("line1" in payload) next.line1 = str(payload.line1);
  if ("line2" in payload) next.line2 = payload.line2 == null ? null : str(payload.line2) || null;
  if ("city" in payload) next.city = str(payload.city);
  if ("state" in payload) next.state = payload.state == null ? null : str(payload.state) || null;
  if ("postalCode" in payload) next.postalCode = payload.postalCode == null ? null : str(payload.postalCode) || null;
  if ("countryIso2" in payload) next.countryIso2 = normalizeCountryIso2(payload.countryIso2) || "BD";
  if ("label" in payload) next.label = payload.label == null ? null : str(payload.label) || null;
  if ("source" in payload) next.source = payload.source == null ? null : str(payload.source) || null;

  if ("phone" in payload) {
    const p = normalizePhone(payload.phone);
    next.phone = p;
    if (p !== (current.phone || null)) {
      next.phoneVerifiedAt = null;
    }
  }

  if (("line1" in next || "line2" in next) && !next.line1 && !next.line2) {
    return { ok: false, status: 400, error: "address_line_required" };
  }
  if ("city" in next && !next.city) return { ok: false, status: 400, error: "address_city_required" };

  const updated = await tx.address.update({
    where: { id: addressId },
    data: next,
  });

  if (bool(payload?.isDefault)) {
    if (current.archivedAt) {
      return { ok: false, status: 409, error: "cannot_default_archived_address" };
    }
    await setDefaultAddressTx(tx, userId, addressId);
  }

  return { ok: true, address: updated };
}

async function archiveAddressTx(tx, userId, payload) {
  const addressId = str(payload?.addressId);
  if (!addressId) return { ok: false, status: 400, error: "address_id_required" };

  const addr = await tx.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true, isDefault: true },
  });
  if (!addr) return { ok: false, status: 404, error: "address_not_found" };

  await tx.address.update({
    where: { id: addressId },
    data: { archivedAt: new Date(), isDefault: false },
  });

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { defaultAddressId: true },
  });

  if (user?.defaultAddressId === addressId || addr.isDefault) {
    await promoteAnotherDefaultAddress(tx, userId);
  }

  return { ok: true };
}

async function restoreAddressTx(tx, userId, payload) {
  const addressId = str(payload?.addressId);
  if (!addressId) return { ok: false, status: 400, error: "address_id_required" };

  const addr = await tx.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true },
  });
  if (!addr) return { ok: false, status: 404, error: "address_not_found" };

  const restored = await tx.address.update({
    where: { id: addressId },
    data: { archivedAt: null },
  });

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { defaultAddressId: true },
  });
  if (!user?.defaultAddressId) {
    await setDefaultAddressTx(tx, userId, addressId);
  }

  return { ok: true, address: restored };
}

/* ------------------------------------ GET ------------------------------------ */

export async function GET(req, ctx) {
  const requestId = makeRequestId();

  try {
    await requireAdmin(req);

    const id = await getId(ctx);
    if (!id) return json({ ok: false, requestId, error: "Customer id required" }, 400);

    const url = new URL(req.url);
    const ordersTake = clamp(int(url.searchParams.get("ordersTake"), 5000), 1, 20000);
    const addressesTake = clamp(int(url.searchParams.get("addressesTake"), 2000), 1, 20000);

    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        customerCode: true,
        kind: true,
        isActive: true,
        loginPreference: true,
        createdAt: true,
        updatedAt: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        lastLoginAt: true,

        addresses: {
          where: { archivedAt: null },
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
          take: addressesTake,
          select: {
            id: true,
            type: true,
            line1: true,
            line2: true,
            city: true,
            state: true,
            postalCode: true,
            countryIso2: true,
            phone: true,
            phoneVerifiedAt: true,
            isDefault: true,
            archivedAt: true,
            createdAt: true,
          },
        },

        wallet: {
          select: {
            balance: true,
            txns: {
              orderBy: { at: "desc" },
              take: 25,
              select: { id: true, delta: true, reason: true, reference: true, at: true },
            },
          },
        },

        loyaltyAccount: {
          select: {
            tier: true,
            currentPoints: true,
            lifetimeEarned: true,
            lifetimeRedeemed: true,
            transactions: {
              orderBy: { at: "desc" },
              take: 25,
              select: { id: true, type: true, points: true, reason: true, reference: true, at: true },
            },
          },
        },

        riskProfile: {
          select: { score: true, level: true, tags: true, notes: true, updatedAt: true },
        },
      },
    });

    if (!user) return json({ ok: false, requestId, error: "Customer not found" }, 404);

    const addressesArchived = await prisma.address.findMany({
      where: { userId: id, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      take: addressesTake,
      select: {
        id: true,
        type: true,
        line1: true,
        line2: true,
        city: true,
        state: true,
        postalCode: true,
        countryIso2: true,
        phone: true,
        phoneVerifiedAt: true,
        isDefault: true,
        archivedAt: true,
        createdAt: true,
      },
    });

    const paidStatuses = ["PAID", "CAPTURED", "SUCCEEDED", "SETTLED", "AUTHORIZED"];

    const [
      ordersFull,
      fraudChecksLatest,
      auditLogs,
      lifetimeOrderCount,
      orderAggRows,
      returnsAggRows,
      fraudAggRows,
    ] = await Promise.all([
      loadOrdersFullSafe(id, ordersTake),

      prisma.fraudCheck.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, status: true, score: true, provider: true, reason: true, createdAt: true },
      }),

      prisma.auditLog.findMany({
        where: { OR: [{ userId: id }, { resourceType: "USER", resourceId: id }, { subject: id }] },
        orderBy: { at: "desc" },
        take: 40,
        select: { id: true, category: true, action: true, message: true, at: true },
      }),

      prisma.order.count({ where: { userId: id } }),

      prisma.$queryRaw`
        SELECT
          COUNT(*)::int AS "total",
          SUM(CASE WHEN o."status" = 'CANCELLED' THEN 1 ELSE 0 END)::int AS "cancelled",
          SUM(CASE WHEN o."status" = 'CANCELLED' AND o."paymentStatus" = 'UNPAID' THEN 1 ELSE 0 END)::int AS "unpaidCancelled",
          SUM(CASE WHEN o."fraudStatus" IS NOT NULL AND o."fraudStatus" <> 'CLEAR' THEN 1 ELSE 0 END)::int AS "fraudOrders",
          COUNT(DISTINCT o."shippingAddressId") FILTER (WHERE o."shippingAddressId" IS NOT NULL)::int AS "distinctShip",
          SUM(CASE WHEN o."createdAt" >= ${since30} THEN 1 ELSE 0 END)::int AS "recent30",
          MAX(o."createdAt") AS "lastOrderAt",
          COALESCE(
            SUM(
              CASE
                WHEN UPPER(COALESCE(o."paymentStatus"::text, '')) = ANY(${paidStatuses})
                THEN COALESCE(o."grandTotal",0)
                ELSE 0
              END
            ),
            0
          )::float8 AS "paidSpend12m"
        FROM "Order" o
        WHERE o."userId" = ${id} AND o."createdAt" >= ${since}
      `,

      prisma.$queryRaw`
        SELECT COUNT(rr.*)::int AS "returnsCount"
        FROM "ReturnRequest" rr
        JOIN "Order" o ON o."id" = rr."orderId"
        WHERE rr."createdAt" >= ${since} AND o."userId" = ${id}
      `,

      prisma.$queryRaw`
        SELECT SUM(CASE WHEN f."status" IS NOT NULL AND f."status" <> 'CLEAR' THEN 1 ELSE 0 END)::int AS "fraudChecks"
        FROM "FraudCheck" f
        WHERE f."createdAt" >= ${since} AND f."userId" = ${id}
      `,
    ]);

    const orderAgg =
      (orderAggRows && orderAggRows[0]) || {
        total: 0,
        cancelled: 0,
        unpaidCancelled: 0,
        fraudOrders: 0,
        distinctShip: 0,
        recent30: 0,
        lastOrderAt: null,
        paidSpend12m: 0,
      };

    const returnsAgg = (returnsAggRows && returnsAggRows[0]) || { returnsCount: 0 };
    const fraudAgg = (fraudAggRows && fraudAggRows[0]) || { fraudChecks: 0 };

    const sys = computeSystemRiskFromAgg({
      total: orderAgg.total,
      cancelled: orderAgg.cancelled,
      unpaidCancelled: orderAgg.unpaidCancelled,
      fraudOrders: orderAgg.fraudOrders,
      distinctShip: orderAgg.distinctShip,
      recent30: orderAgg.recent30,
      returnsCount: returnsAgg.returnsCount,
      fraudChecks: fraudAgg.fraudChecks,
    });

    const total12m = Number(orderAgg.total || 0);
    const cancelled12m = Number(orderAgg.cancelled || 0);
    const paidSpend12m = Number(orderAgg.paidSpend12m || 0);

    const activeCount = Array.isArray(user.addresses) ? user.addresses.length : 0;
    const archivedCount = Array.isArray(addressesArchived) ? addressesArchived.length : 0;

    const out = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      customerCode: user.customerCode,
      kind: user.kind,
      isActive: user.isActive,
      loginPreference: user.loginPreference,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,

      trust: {
        emailVerified: !!user.emailVerifiedAt,
        phoneVerified: !!user.phoneVerifiedAt,
        lastLoginAt: user.lastLoginAt,
      },

      addresses: user.addresses || [],
      addressesArchived: addressesArchived || [],

      wallet: user.wallet
        ? { balance: user.wallet.balance, txns: user.wallet.txns || [] }
        : { balance: 0, txns: [] },

      loyalty: user.loyaltyAccount
        ? {
            tier: user.loyaltyAccount.tier,
            currentPoints: user.loyaltyAccount.currentPoints,
            lifetimeEarned: user.loyaltyAccount.lifetimeEarned,
            lifetimeRedeemed: user.loyaltyAccount.lifetimeRedeemed,
            txns: user.loyaltyAccount.transactions || [],
          }
        : { tier: "MEMBER", currentPoints: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, txns: [] },

      orders: ordersFull || [],

      risk: {
        manual: user.riskProfile
          ? {
              score: user.riskProfile.score,
              level: user.riskProfile.level,
              tags: user.riskProfile.tags || [],
              notes: user.riskProfile.notes || "",
              updatedAt: user.riskProfile.updatedAt,
            }
          : { score: null, level: null, tags: [], notes: "" },
      },

      metrics: {
        addresses: { active: activeCount, archived: archivedCount, total: activeCount + archivedCount },
        orders: {
          total: lifetimeOrderCount,
          total12m,
          cancelled12m,
          cancelRatePct: total12m ? Math.round((cancelled12m / total12m) * 100) : 0,
          paidSpend12m,
          lastOrderAt: orderAgg.lastOrderAt ? new Date(orderAgg.lastOrderAt).toISOString() : null,
          loaded: Array.isArray(ordersFull) ? ordersFull.length : 0,
          take: ordersTake,
        },
        returns: { count: Number(returnsAgg.returnsCount || 0) },
        risk: {
          system: sys,
          codNonPayRatePct: sys.codNonPayRatePct,
          multiAddressCount: sys.multiAddressCount,
          fraudTouches: sys.fraudTouches,
        },
      },

      auditLogs: auditLogs || [],
      fraudChecks: fraudChecksLatest || [],
    };

    return json({ ok: true, requestId, customer: out }, 200, { "x-request-id": requestId });
  } catch (e) {
    return json(
      { ok: false, requestId, error: String(e?.message || e || "SERVER_ERROR") },
      500,
      { "x-request-id": requestId }
    );
  }
}

/* ----------------------------------- PATCH ----------------------------------- */

export async function PATCH(req, ctx) {
  const requestId = makeRequestId();

  try {
    const actor = await requireAdmin(req);
    const actorId = actorIdFromRequireAdminResult(actor);

    const id = await getId(ctx);
    if (!id) return json({ ok: false, requestId, error: "Customer id required" }, 400);

    const body = await req.json().catch(() => ({}));

    const setActive = body?.setActive;
    const identity = body?.identity || null;
    const action = body?.action || {};
    const risk = body?.risk || {};

    const did =
      typeof setActive === "boolean" ||
      !!identity ||
      !!action?.walletAdjust ||
      !!action?.addAddress ||
      !!action?.updateAddress ||
      !!action?.archiveAddress ||
      !!action?.restoreAddress ||
      !!action?.setDefaultAddress ||
      !!action?.toggleTag ||
      !!action?.clearManualTags ||
      Object.prototype.hasOwnProperty.call(risk, "notes") ||
      Object.prototype.hasOwnProperty.call(risk, "score") ||
      Object.prototype.hasOwnProperty.call(risk, "level");

    if (!did) {
      return json({ ok: false, requestId, error: "empty_patch" }, 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const exists = await tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, phone: true },
      });
      if (!exists) return { ok: false, status: 404, error: "Customer not found" };

      const updatedKeys = [];

      if (typeof setActive === "boolean") {
        await tx.user.update({ where: { id }, data: { isActive: setActive } });
        updatedKeys.push("isActive");
        await bestEffortAudit(tx, {
          userId: actorId,
          category: "ADMIN",
          action: "CUSTOMER_SET_ACTIVE",
          message: `Set customer isActive=${setActive}`,
          resourceType: "USER",
          resourceId: id,
          subject: id,
          subjectType: "USER",
          context: "admin_panel",
        });
      }

      if (identity && typeof identity === "object") {
        const data = {};

        if ("name" in identity) data.name = identity.name == null ? null : str(identity.name) || null;
        if ("email" in identity) data.email = identity.email == null ? null : normalizeEmail(identity.email);
        if ("phone" in identity) data.phone = identity.phone == null ? null : normalizePhone(identity.phone);

        if ("phone" in data) {
          const newPhone = data.phone;
          if (newPhone !== (exists.phone || null)) data.phoneVerifiedAt = null;
        }

        if ("email" in data) {
          const newEmail = data.email;
          if (newEmail !== (exists.email || null)) data.emailVerifiedAt = null;
        }

        try {
          await tx.user.update({ where: { id }, data });
        } catch (e) {
          if (e?.code === "P2002") {
            const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(",") : String(e?.meta?.target || "");
            return { ok: false, status: 409, error: "unique_conflict", target };
          }
          throw e;
        }

        updatedKeys.push(...Object.keys(data));
        await bestEffortAudit(tx, {
          userId: actorId,
          category: "ADMIN",
          action: "CUSTOMER_IDENTITY_UPDATED",
          message: "Updated customer identity fields",
          resourceType: "USER",
          resourceId: id,
          subject: id,
          subjectType: "USER",
          metadata: { updatedKeys: Object.keys(data) },
          context: "admin_panel",
        });
      }

      if (action?.addAddress) {
        const r = await addAddressTx(tx, id, action.addAddress);
        if (!r.ok) return r;
        updatedKeys.push("address:add");
      }

      if (action?.updateAddress) {
        const r = await updateAddressTx(tx, id, action.updateAddress);
        if (!r.ok) return r;
        updatedKeys.push("address:update");
      }

      if (action?.archiveAddress) {
        const r = await archiveAddressTx(tx, id, action.archiveAddress);
        if (!r.ok) return r;
        updatedKeys.push("address:archive");
      }

      if (action?.restoreAddress) {
        const r = await restoreAddressTx(tx, id, action.restoreAddress);
        if (!r.ok) return r;
        updatedKeys.push("address:restore");
      }

      if (action?.setDefaultAddress) {
        const addressId = str(action.setDefaultAddress?.addressId);
        if (!addressId) return { ok: false, status: 400, error: "address_id_required" };
        const r = await setDefaultAddressTx(tx, id, addressId);
        if (!r.ok) return r;
        updatedKeys.push("address:setDefault");
      }

      if (action?.walletAdjust) {
        const delta = dec2(action.walletAdjust?.delta);
        if (delta.equals("0")) return { ok: false, status: 400, error: "wallet_delta_required" };

        const reason = action.walletAdjust?.reason == null ? null : str(action.walletAdjust.reason) || null;
        const reference =
          action.walletAdjust?.reference == null ? null : str(action.walletAdjust.reference) || null;

        const wallet = await tx.wallet.upsert({
          where: { userId: id },
          create: { userId: id, balance: new Prisma.Decimal("0.00") },
          update: {},
          select: { id: true },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            delta,
            reason,
            reference,
            metadata: { source: "admin_panel", actorId },
          },
        });

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: delta } },
        });

        updatedKeys.push("wallet");
      }

      const doRisk =
        action?.toggleTag ||
        action?.clearManualTags ||
        Object.prototype.hasOwnProperty.call(risk, "notes") ||
        Object.prototype.hasOwnProperty.call(risk, "score") ||
        Object.prototype.hasOwnProperty.call(risk, "level");

      if (doRisk) {
        const current = await tx.userRiskProfile.findUnique({
          where: { userId: id },
          select: { userId: true, score: true, level: true, tags: true, notes: true },
        });

        let tags = Array.isArray(current?.tags) ? [...current.tags] : [];
        if (action?.clearManualTags) tags = [];
        if (action?.toggleTag) {
          const t = str(action.toggleTag).toUpperCase().slice(0, 64);
          if (t) tags = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
        }
        tags = Array.from(new Set(tags)).slice(0, 64);

        let nextNotes = current?.notes ?? "";
        if (Object.prototype.hasOwnProperty.call(risk, "notes")) nextNotes = String(risk.notes ?? "");

        let nextScore = current?.score ?? 0;
        if (Object.prototype.hasOwnProperty.call(risk, "score")) {
          nextScore = risk.score == null ? 0 : clamp(int(risk.score, 0), 0, 100);
        }

        let nextLevel = current?.level ?? "LOW";
        if (Object.prototype.hasOwnProperty.call(risk, "level")) {
          const lv = str(risk.level).toUpperCase();
          if (lv === "LOW" || lv === "MEDIUM" || lv === "HIGH") nextLevel = lv;
        }

        await tx.userRiskProfile.upsert({
          where: { userId: id },
          create: { userId: id, score: nextScore, level: nextLevel, tags, notes: nextNotes, updatedById: actorId },
          update: { userId: id, score: nextScore, level: nextLevel, tags, notes: nextNotes, updatedById: actorId },
        });

        updatedKeys.push("riskProfile");
      }

      return { ok: true, status: 200, updatedKeys };
    });

    if (!result?.ok) {
      return json(
        { ok: false, requestId, error: result?.error || "update_failed", target: result?.target || null },
        result?.status || 500,
        { "x-request-id": requestId }
      );
    }

    return json(
      { ok: true, requestId, message: "Customer updated.", updatedKeys: result.updatedKeys || [] },
      200,
      { "x-request-id": requestId }
    );
  } catch (e) {
    return json(
      { ok: false, requestId, error: String(e?.message || e || "SERVER_ERROR") },
      500,
      { "x-request-id": requestId }
    );
  }
}

export async function PUT(req, ctx) {
  return PATCH(req, ctx);
}
