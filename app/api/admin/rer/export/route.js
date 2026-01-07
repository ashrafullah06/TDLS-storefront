// PATH: app/api/admin/rer/export/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

/* ---------------- helpers ---------------- */
function noStoreJson(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function asMoney(v) {
  // Prisma Decimal often serializes as string; normalize to number for the UI.
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCounts(grouped, defaults) {
  const out = { ...defaults };
  for (const row of grouped || []) {
    const k = String(row?.status ?? "");
    out[k] = asInt(row?._count?._all);
  }
  out.total = Object.keys(out)
    .filter((k) => k !== "total")
    .reduce((sum, k) => sum + asInt(out[k]), 0);
  return out;
}

function buildCreatedAtWhere(searchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const days = searchParams.get("days");

  let gte = null;
  let lte = null;

  if (from) {
    const d = new Date(`${from}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) gte = d;
  }
  if (to) {
    const d = new Date(`${to}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) lte = d;
  }

  if (!gte && !lte && days) {
    const n = asInt(days);
    if (n > 0) {
      const now = new Date();
      const start = new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      gte = start;
      lte = now;
    }
  }

  if (!gte && !lte) return undefined;

  const createdAt = {};
  if (gte) createdAt.gte = gte;
  if (lte) createdAt.lte = lte;
  return { createdAt };
}

/* ---------------- route ---------------- */
export async function GET(req) {
  // auth gate (kept strict)
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return noStoreJson(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  try {
    const url = new URL(req.url);
    const sp = url.searchParams;

    // UI calls ?summary=1 (but we return summary regardless)
    const createdAtWhere = buildCreatedAtWhere(sp);

    const whereReturn = createdAtWhere;
    const whereExchange = createdAtWhere;
    const whereRefund = createdAtWhere;

    const [
      returnByStatus,
      exchangeByStatus,
      refundByStatus,
      returnSum,
      refundSum,
      returnLineSum,
      exchangeLineSum,
    ] = await Promise.all([
      prisma.returnRequest.groupBy({
        by: ["status"],
        where: whereReturn,
        _count: { _all: true },
      }),
      prisma.exchangeRequest.groupBy({
        by: ["status"],
        where: whereExchange,
        _count: { _all: true },
      }),
      prisma.refund.groupBy({
        by: ["status"],
        where: whereRefund,
        _count: { _all: true },
      }),
      prisma.returnRequest.aggregate({
        where: whereReturn,
        _sum: { totalRefund: true },
      }),
      prisma.refund.aggregate({
        where: whereRefund,
        _sum: { amount: true },
      }),

      // IMPORTANT: your schema uses `quantity` (not `qty`)
      prisma.returnLine.aggregate({
        where: createdAtWhere ? { returnRequest: createdAtWhere } : undefined,
        _sum: { quantity: true },
      }),
      prisma.exchangeLine.aggregate({
        where: createdAtWhere ? { exchangeRequest: createdAtWhere } : undefined,
        _sum: { quantity: true },
      }),
    ]);

    // Keys match what rer-panel expects in Overview
    const returnsCounts = normalizeCounts(returnByStatus, {
      REQUESTED: 0,
      APPROVED: 0,
      RECEIVED: 0,
      REFUNDED: 0,
      DENIED: 0,
      total: 0,
    });

    const exchangesCounts = normalizeCounts(exchangeByStatus, {
      REQUESTED: 0,
      APPROVED: 0,
      FULFILLED: 0,
      DENIED: 0,
      total: 0,
    });

    const refundsCounts = normalizeCounts(refundByStatus, {
      INITIATED: 0,
      PROCESSED: 0,
      FAILED: 0,
      total: 0,
    });

    const returnsQty = asInt(returnLineSum?._sum?.quantity);
    const exchangesQty = asInt(exchangeLineSum?._sum?.quantity);

    const returnsTaka = asMoney(returnSum?._sum?.totalRefund);
    const refundsTaka = asMoney(refundSum?._sum?.amount);

    const summary = {
      returns: {
        requested: asInt(returnsCounts.REQUESTED),
        approved: asInt(returnsCounts.APPROVED),
        received: asInt(returnsCounts.RECEIVED),
        refunded: asInt(returnsCounts.REFUNDED),
        denied: asInt(returnsCounts.DENIED),
        total: asInt(returnsCounts.total),
        qty: returnsQty,
        totalRefund: returnsTaka,
      },
      exchanges: {
        requested: asInt(exchangesCounts.REQUESTED),
        approved: asInt(exchangesCounts.APPROVED),
        fulfilled: asInt(exchangesCounts.FULFILLED),
        denied: asInt(exchangesCounts.DENIED),
        total: asInt(exchangesCounts.total),
        qty: exchangesQty,
      },
      refunds: {
        initiated: asInt(refundsCounts.INITIATED),
        processed: asInt(refundsCounts.PROCESSED),
        failed: asInt(refundsCounts.FAILED),
        total: asInt(refundsCounts.total),
        totalAmount: refundsTaka,
      },
      totals: {
        requests:
          asInt(returnsCounts.total) +
          asInt(exchangesCounts.total) +
          asInt(refundsCounts.total),
        items: returnsQty + exchangesQty,
        taka: returnsTaka + refundsTaka,
      },
      updatedAt: new Date().toISOString(),
    };

    return noStoreJson({ ok: true, summary }, 200);
  } catch (err) {
    return noStoreJson(
      { ok: false, error: "SERVER_ERROR", message: err?.message || "FAILED" },
      500
    );
  }
}
