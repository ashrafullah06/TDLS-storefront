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

function s(v) {
  return String(v ?? "").trim();
}
function bool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function toInt(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : d;
}
function normalizeEmail(v) {
  const x = s(v).toLowerCase();
  return x ? x : null;
}
function normalizePhone(v) {
  const x = s(v);
  if (!x) return null;
  const cleaned = x.replace(/[^\d+]/g, "");
  return cleaned || null;
}
function normalizeCountryIso2(v) {
  const x = s(v).toUpperCase();
  if (!x) return null;
  if (x.length !== 2) return null;
  return x;
}
function normalizeAddressType(v) {
  const x = s(v).toUpperCase();
  return x === "BILLING" ? "BILLING" : "SHIPPING";
}
function dec2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return new Prisma.Decimal("0.00");
  return new Prisma.Decimal(x.toFixed(2));
}
function makeRequestId() {
  return (
    (globalThis.crypto?.randomUUID?.() ? globalThis.crypto.randomUUID() : null) ||
    `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}
async function getId(ctx) {
  const p = await (ctx?.params ?? {});
  return s(p?.id);
}
async function bestEffortAudit(tx, data) {
  try {
    if (tx?.auditLog?.create) await tx.auditLog.create({ data });
  } catch {
    // never break writes
  }
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

async function addAddressTx(tx, userId, payload) {
  const type = normalizeAddressType(payload?.type);
  const line1 = s(payload?.line1);
  const line2 = payload?.line2 == null ? null : s(payload?.line2) || null;
  const city = s(payload?.city);
  const state = payload?.state == null ? null : s(payload?.state) || null;
  const postalCode = payload?.postalCode == null ? null : s(payload?.postalCode) || null;
  const countryIso2 = normalizeCountryIso2(payload?.countryIso2) || "BD";
  const phone = normalizePhone(payload?.phone);
  const label = payload?.label == null ? null : s(payload?.label) || null;
  const source = payload?.source == null ? null : s(payload?.source) || null;
  const wantDefault = bool(payload?.isDefault);

  if (!line1 && !line2) return { ok: false, status: 400, error: "address_line_required" };
  if (!city) return { ok: false, status: 400, error: "address_city_required" };

  const addr = await tx.address.create({
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

  if (wantDefault || !user?.defaultAddressId) {
    await setDefaultAddressTx(tx, userId, addr.id);
  }

  return { ok: true, address: addr };
}

async function updateAddressTx(tx, userId, payload) {
  const addressId = s(payload?.addressId);
  if (!addressId) return { ok: false, status: 400, error: "address_id_required" };

  const current = await tx.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true, phone: true, archivedAt: true },
  });
  if (!current) return { ok: false, status: 404, error: "address_not_found" };

  const data = {};
  if ("type" in payload) data.type = normalizeAddressType(payload.type);
  if ("line1" in payload) data.line1 = s(payload.line1);
  if ("line2" in payload) data.line2 = payload.line2 == null ? null : s(payload.line2) || null;
  if ("city" in payload) data.city = s(payload.city);
  if ("state" in payload) data.state = payload.state == null ? null : s(payload.state) || null;
  if ("postalCode" in payload) data.postalCode = payload.postalCode == null ? null : s(payload.postalCode) || null;
  if ("countryIso2" in payload) data.countryIso2 = normalizeCountryIso2(payload.countryIso2) || "BD";
  if ("label" in payload) data.label = payload.label == null ? null : s(payload.label) || null;
  if ("source" in payload) data.source = payload.source == null ? null : s(payload.source) || null;

  if ("phone" in payload) {
    const p = normalizePhone(payload.phone);
    data.phone = p;
    if (p !== (current.phone || null)) data.phoneVerifiedAt = null;
  }

  if (("line1" in data || "line2" in data) && !data.line1 && !data.line2) {
    return { ok: false, status: 400, error: "address_line_required" };
  }
  if ("city" in data && !data.city) return { ok: false, status: 400, error: "address_city_required" };

  const updated = await tx.address.update({ where: { id: addressId }, data });

  if (bool(payload?.isDefault)) {
    if (current.archivedAt) return { ok: false, status: 409, error: "cannot_default_archived_address" };
    await setDefaultAddressTx(tx, userId, addressId);
  }

  return { ok: true, address: updated };
}

async function archiveAddressTx(tx, userId, payload) {
  const addressId = s(payload?.addressId);
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
  const addressId = s(payload?.addressId);
  if (!addressId) return { ok: false, status: 400, error: "address_id_required" };

  const addr = await tx.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true },
  });
  if (!addr) return { ok: false, status: 404, error: "address_not_found" };

  const restored = await tx.address.update({ where: { id: addressId }, data: { archivedAt: null } });

  const user = await tx.user.findUnique({ where: { id: userId }, select: { defaultAddressId: true } });
  if (!user?.defaultAddressId) await setDefaultAddressTx(tx, userId, addressId);

  return { ok: true, address: restored };
}

/**
 * CRITICAL FIX:
 * Use LATERAL to aggregate items per order without GROUP BY selecting o.*.
 * This removes the exact 42803 error shown in your server log. :contentReference[oaicite:1]{index=1}
 */
async function loadOrdersFull(userId, ordersTake) {
  const take = clamp(toInt(ordersTake, 50), 1, 20000);

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
      const order = r?.order || {};
      const items = Array.isArray(r?.items) ? r.items : (r?.items ?? []);
      const itemCount = Array.isArray(items) ? items.length : 0;
      return { ...order, items, itemCount };
    });
  } catch (e) {
    // Hard fallback: never break the page if raw SQL fails for any reason
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
      // strip the included items array to match your UI shape
      const { items, ...rest } = o;
      return { ...rest, items: bundles, itemCount: bundles.length };
    });
  }
}

/* ------------------------------------ GET ------------------------------------ */

export async function GET(req, ctx) {
  const requestId = makeRequestId();

  try {
    await requireAdmin(req);

    const id = await getId(ctx);
    if (!id) return json({ ok: false, requestId, error: "customer_id_required" }, 400);

    const url = new URL(req.url);
    const ordersTake = clamp(toInt(url.searchParams.get("ordersTake"), 5000), 1, 20000);
    const addressesTake = clamp(toInt(url.searchParams.get("addressesTake"), 20000), 1, 20000);

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
            txns: { orderBy: { at: "desc" }, take: 25, select: { id: true, delta: true, reason: true, reference: true, at: true } },
          },
        },

        loyaltyAccount: {
          select: {
            tier: true,
            currentPoints: true,
            lifetimeEarned: true,
            lifetimeRedeemed: true,
            transactions: { orderBy: { at: "desc" }, take: 25, select: { id: true, type: true, points: true, reason: true, reference: true, at: true } },
          },
        },

        riskProfile: { select: { score: true, level: true, tags: true, notes: true, updatedAt: true } },
      },
    });

    if (!user) return json({ ok: false, requestId, error: "customer_not_found" }, 404);

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

    const orders = await loadOrdersFull(id, ordersTake);

    return json(
      {
        ok: true,
        requestId,
        customer: {
          ...user,
          addressesArchived,
          orders,
        },
      },
      200,
      { "x-request-id": requestId }
    );
  } catch (e) {
    return json({ ok: false, requestId, error: String(e?.message || e || "SERVER_ERROR") }, 500, {
      "x-request-id": requestId,
    });
  }
}

/* ----------------------------------- PATCH ----------------------------------- */

export async function PATCH(req, ctx) {
  const requestId = makeRequestId();

  try {
    const admin = await requireAdmin(req); // keep your existing admin auth gate
    const actorId = admin?.user?.id || admin?.id || null;

    const id = await getId(ctx);
    if (!id) return json({ ok: false, requestId, error: "customer_id_required" }, 400);

    const body = await req.json().catch(() => ({}));
    const identity = body?.identity || null;
    const setActive = body?.setActive;
    const action = body?.action || {};
    const risk = body?.risk || {};

    const did =
      typeof setActive === "boolean" ||
      (identity && typeof identity === "object") ||
      !!action?.walletAdjust ||
      !!action?.addAddress ||
      !!action?.updateAddress ||
      !!action?.archiveAddress ||
      !!action?.restoreAddress ||
      !!action?.setDefaultAddress ||
      Object.prototype.hasOwnProperty.call(risk, "notes") ||
      Object.prototype.hasOwnProperty.call(risk, "score") ||
      Object.prototype.hasOwnProperty.call(risk, "level") ||
      !!action?.toggleTag ||
      !!action?.clearManualTags;

    if (!did) return json({ ok: false, requestId, error: "empty_patch" }, 400);

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id },
        select: { id: true, email: true, phone: true },
      });
      if (!current) return { ok: false, status: 404, error: "customer_not_found" };

      const updatedKeys = [];

      if (typeof setActive === "boolean") {
        await tx.user.update({ where: { id }, data: { isActive: setActive } });
        updatedKeys.push("isActive");
      }

      if (identity && typeof identity === "object") {
        const data = {};
        if ("name" in identity) data.name = identity.name == null ? null : s(identity.name) || null;
        if ("email" in identity) data.email = identity.email == null ? null : normalizeEmail(identity.email);
        if ("phone" in identity) data.phone = identity.phone == null ? null : normalizePhone(identity.phone);

        if ("phone" in data && data.phone !== (current.phone || null)) data.phoneVerifiedAt = null;
        if ("email" in data && data.email !== (current.email || null)) data.emailVerifiedAt = null;

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
        const addressId = s(action.setDefaultAddress?.addressId);
        if (!addressId) return { ok: false, status: 400, error: "address_id_required" };
        const r = await setDefaultAddressTx(tx, id, addressId);
        if (!r.ok) return r;
        updatedKeys.push("address:setDefault");
      }

      if (action?.walletAdjust) {
        const delta = dec2(action.walletAdjust?.delta);
        if (delta.equals("0")) return { ok: false, status: 400, error: "wallet_delta_required" };

        const reason = action.walletAdjust?.reason == null ? null : s(action.walletAdjust.reason) || null;
        const reference = action.walletAdjust?.reference == null ? null : s(action.walletAdjust.reference) || null;

        const wallet = await tx.wallet.upsert({
          where: { userId: id },
          create: { userId: id, balance: new Prisma.Decimal("0.00") },
          update: {},
          select: { id: true },
        });

        await tx.walletTransaction.create({
          data: { walletId: wallet.id, delta, reason, reference, metadata: { source: "admin_panel", actorId } },
        });

        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: delta } } });
        updatedKeys.push("wallet");
      }

      // risk (kept compatible with your existing schema)
      const doRisk =
        action?.toggleTag ||
        action?.clearManualTags ||
        Object.prototype.hasOwnProperty.call(risk, "notes") ||
        Object.prototype.hasOwnProperty.call(risk, "score") ||
        Object.prototype.hasOwnProperty.call(risk, "level");

      if (doRisk) {
        const cur = await tx.userRiskProfile.findUnique({
          where: { userId: id },
          select: { tags: true, notes: true, score: true, level: true },
        });
        let tags = Array.isArray(cur?.tags) ? [...cur.tags] : [];
        if (action?.clearManualTags) tags = [];
        if (action?.toggleTag) {
          const t = s(action.toggleTag).toUpperCase().slice(0, 64);
          if (t) tags = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
        }
        tags = Array.from(new Set(tags)).slice(0, 64);

        const notes = Object.prototype.hasOwnProperty.call(risk, "notes") ? String(risk.notes ?? "") : (cur?.notes ?? "");
        const score = Object.prototype.hasOwnProperty.call(risk, "score")
          ? clamp(toInt(risk.score, 0), 0, 100)
          : (cur?.score ?? 0);
        let level = cur?.level ?? "LOW";
        if (Object.prototype.hasOwnProperty.call(risk, "level")) {
          const lv = s(risk.level).toUpperCase();
          if (lv === "LOW" || lv === "MEDIUM" || lv === "HIGH") level = lv;
        }

        await tx.userRiskProfile.upsert({
          where: { userId: id },
          create: { userId: id, tags, notes, score, level, updatedById: actorId },
          update: { tags, notes, score, level, updatedById: actorId },
        });

        updatedKeys.push("riskProfile");
      }

      await bestEffortAudit(tx, {
        userId: actorId,
        category: "ADMIN",
        action: "CUSTOMER_UPDATED",
        message: "Admin updated customer",
        resourceType: "USER",
        resourceId: id,
        subject: id,
        subjectType: "USER",
        metadata: { updatedKeys },
        context: "admin_panel",
      });

      return { ok: true, status: 200, updatedKeys };
    });

    if (!result?.ok) {
      return json(
        { ok: false, requestId, error: result?.error || "update_failed", target: result?.target || null },
        result?.status || 500,
        { "x-request-id": requestId }
      );
    }

    return json({ ok: true, requestId, updatedKeys: result.updatedKeys || [], message: "Saved." }, 200, {
      "x-request-id": requestId,
    });
  } catch (e) {
    return json({ ok: false, requestId, error: String(e?.message || e || "SERVER_ERROR") }, 500, {
      "x-request-id": requestId,
    });
  }
}

export async function PUT(req, ctx) {
  return PATCH(req, ctx);
}
