//app/api/admin/customers/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

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

function normalizeQuery(q) {
  const s = String(q ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return "";
  return s.slice(0, 64);
}

function isEmailLike(q) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);
}

function isPhoneLike(q) {
  const s = q.replace(/[\s-]/g, "");
  return /^\+?\d{8,16}$/.test(s);
}

function isCodeLike(q) {
  return /^[A-Z0-9][A-Z0-9_-]{3,}$/.test(String(q || "").toUpperCase());
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

export async function GET(req) {
  const requestId =
    (globalThis.crypto?.randomUUID?.() ? globalThis.crypto.randomUUID() : null) ||
    `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    await requireAdmin(req);

    const u = new URL(req.url);

    const qRaw = normalizeQuery(u.searchParams.get("q"));
    const scope = str(u.searchParams.get("scope")) || "all"; // all | customers | staff

    const take = clamp(int(u.searchParams.get("take"), 80), 1, 200);
    const cursorId = str(u.searchParams.get("cursor"));
    const skip = clamp(int(u.searchParams.get("skip"), 0), 0, 5000);

    const baseWhere = (() => {
      if (scope === "customers") {
        return {
          OR: [{ kind: "CUSTOMER_ONLY" }, { kind: "CUSTOMER_AND_STAFF" }, { customerCode: { not: null } }],
        };
      }
      if (scope === "staff") {
        return { OR: [{ kind: "CUSTOMER_AND_STAFF" }, { kind: "STAFF_ONLY" }] };
      }
      return {
        OR: [
          { kind: "CUSTOMER_ONLY" },
          { kind: "CUSTOMER_AND_STAFF" },
          { customerCode: { not: null } },
          { kind: "STAFF_ONLY" },
        ],
      };
    })();

    const searchWhere = (() => {
      if (!qRaw) return null;

      if (isEmailLike(qRaw)) {
        return {
          OR: [
            { email: { equals: qRaw, mode: "insensitive" } },
            { email: { contains: qRaw, mode: "insensitive" } },
            { name: { contains: qRaw, mode: "insensitive" } },
          ],
        };
      }

      if (isPhoneLike(qRaw)) {
        const compact = qRaw.replace(/[\s-]/g, "");
        return {
          OR: [
            { phone: { contains: compact, mode: "insensitive" } },
            { phone: { contains: qRaw, mode: "insensitive" } },
            { name: { contains: qRaw, mode: "insensitive" } },
          ],
        };
      }

      if (isCodeLike(qRaw)) {
        return {
          OR: [
            { customerCode: { equals: qRaw.toUpperCase(), mode: "insensitive" } },
            { customerCode: { contains: qRaw, mode: "insensitive" } },
            { name: { contains: qRaw, mode: "insensitive" } },
            { email: { contains: qRaw, mode: "insensitive" } },
            { phone: { contains: qRaw, mode: "insensitive" } },
          ],
        };
      }

      return {
        OR: [
          { name: { contains: qRaw, mode: "insensitive" } },
          { email: { contains: qRaw, mode: "insensitive" } },
          { phone: { contains: qRaw, mode: "insensitive" } },
          { customerCode: { contains: qRaw, mode: "insensitive" } },
        ],
      };
    })();

    const where = searchWhere ? { AND: [baseWhere, searchWhere] } : baseWhere;

    const [total, new7d, users] = await Promise.all([
      prisma.user.count({ where: baseWhere }),
      prisma.user.count({
        where: {
          AND: [baseWhere, { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }],
        },
      }),
      prisma.user.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : { skip }),
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
          _count: { select: { orders: true, addresses: true } },
          riskProfile: { select: { score: true, level: true, tags: true, notes: true, updatedAt: true } },
        },
      }),
    ]);

    if (!users.length) {
      return json({ ok: true, requestId, summary: { total, new7d }, items: [], nextCursor: null }, 200, { "x-request-id": requestId });
    }

    const ids = users.map((x) => x.id);
    const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // FIX: Directory count must match Address tab: count ACTIVE only (archivedAt IS NULL).
    const [ordersAgg, returnsAgg, fraudAgg, activeAddrAgg] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          o."userId" AS "userId",
          COUNT(*)::int AS "total",
          SUM(CASE WHEN o."status" = 'CANCELLED' THEN 1 ELSE 0 END)::int AS "cancelled",
          SUM(CASE WHEN o."status" = 'CANCELLED' AND o."paymentStatus" = 'UNPAID' THEN 1 ELSE 0 END)::int AS "unpaidCancelled",
          SUM(CASE WHEN o."fraudStatus" IS NOT NULL AND o."fraudStatus" <> 'CLEAR' THEN 1 ELSE 0 END)::int AS "fraudOrders",
          COUNT(DISTINCT o."shippingAddressId") FILTER (WHERE o."shippingAddressId" IS NOT NULL)::int AS "distinctShip",
          SUM(CASE WHEN o."createdAt" >= ${since30} THEN 1 ELSE 0 END)::int AS "recent30",
          MAX(o."createdAt") AS "lastOrderAt"
        FROM "Order" o
        WHERE o."userId" = ANY(${ids}) AND o."createdAt" >= ${since}
        GROUP BY o."userId"
      `,
      prisma.$queryRaw`
        SELECT
          o."userId" AS "userId",
          COUNT(rr.*)::int AS "returnsCount"
        FROM "ReturnRequest" rr
        JOIN "Order" o ON o."id" = rr."orderId"
        WHERE rr."createdAt" >= ${since} AND o."userId" = ANY(${ids})
        GROUP BY o."userId"
      `,
      prisma.$queryRaw`
        SELECT
          f."userId" AS "userId",
          SUM(CASE WHEN f."status" IS NOT NULL AND f."status" <> 'CLEAR' THEN 1 ELSE 0 END)::int AS "fraudChecks"
        FROM "FraudCheck" f
        WHERE f."createdAt" >= ${since} AND f."userId" = ANY(${ids})
        GROUP BY f."userId"
      `,
      prisma.$queryRaw`
        SELECT
          a."userId" AS "userId",
          COUNT(*)::int AS "activeAddresses"
        FROM "Address" a
        WHERE a."userId" = ANY(${ids}) AND a."archivedAt" IS NULL
        GROUP BY a."userId"
      `,
    ]);

    const ordersByUser = new Map();
    for (const r of ordersAgg || []) ordersByUser.set(r.userId, r);

    const returnsByUser = new Map();
    for (const r of returnsAgg || []) returnsByUser.set(r.userId, r);

    const fraudByUser = new Map();
    for (const r of fraudAgg || []) fraudByUser.set(r.userId, r);

    const activeAddrByUser = new Map();
    for (const r of activeAddrAgg || []) activeAddrByUser.set(r.userId, r);

    const items = users.map((u0) => {
      const oa = ordersByUser.get(u0.id) || {
        total: 0,
        cancelled: 0,
        unpaidCancelled: 0,
        fraudOrders: 0,
        distinctShip: 0,
        recent30: 0,
        lastOrderAt: null,
      };
      const ra = returnsByUser.get(u0.id) || { returnsCount: 0 };
      const fa = fraudByUser.get(u0.id) || { fraudChecks: 0 };

      const sys = computeSystemRiskFromAgg({
        total: oa.total,
        cancelled: oa.cancelled,
        unpaidCancelled: oa.unpaidCancelled,
        fraudOrders: oa.fraudOrders,
        distinctShip: oa.distinctShip,
        recent30: oa.recent30,
        returnsCount: ra.returnsCount,
        fraudChecks: fa.fraudChecks,
      });

      const activeAddresses = Number(activeAddrByUser.get(u0.id)?.activeAddresses || 0);
      const totalAddresses = Number(u0._count?.addresses ?? 0);

      return {
        id: u0.id,
        name: u0.name,
        email: u0.email,
        phone: u0.phone,
        customerCode: u0.customerCode,
        kind: u0.kind,
        isActive: u0.isActive,
        loginPreference: u0.loginPreference,
        createdAt: u0.createdAt,
        updatedAt: u0.updatedAt,
        counts: {
          orders: u0._count?.orders ?? 0,
          addresses: activeAddresses, // active only (matches Address tab)
          addressesTotal: totalAddresses, // all rows (including archived)
        },
        lastOrderAt: oa.lastOrderAt ? new Date(oa.lastOrderAt).toISOString() : null,
        risk: {
          system: sys,
          manual: u0.riskProfile
            ? {
                score: u0.riskProfile.score,
                level: u0.riskProfile.level,
                tags: u0.riskProfile.tags || [],
                notes: u0.riskProfile.notes || "",
                updatedAt: u0.riskProfile.updatedAt,
              }
            : { score: null, level: null, tags: [], notes: "" },
        },
      };
    });

    const nextCursor = items.length ? items[items.length - 1].id : null;

    return json({ ok: true, requestId, summary: { total, new7d }, items, nextCursor }, 200, { "x-request-id": requestId });
  } catch (e) {
    return json({ ok: false, requestId, error: String(e?.message || e || "SERVER_ERROR") }, 500, { "x-request-id": requestId });
  }
}
