// FILE: app/api/admin/orders/summary/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminIndependent } from "@/lib/admin/requireAdminIndependent";
import { Permissions } from "@/lib/rbac";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "cookie",
    },
  });
}

function safeNum(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function normalizeGroupBy(rows, key) {
  const out = {};
  for (const r of rows || []) {
    const k = String(r?.[key] ?? "UNKNOWN");
    out[k] = safeNum(r?._count?._all ?? 0);
  }
  return out;
}

export async function GET(req) {
  const perm =
    Permissions?.MANAGE_ORDERS ||
    Permissions?.VIEW_ORDERS ||
    Permissions?.VIEW_ANALYTICS;

  try {
    await requireAdminIndependent(req, perm ? { permission: perm } : undefined);
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  try {
    const [total, byStatusRows, byPaymentRows, byFulfillmentRows] =
      await Promise.all([
        prisma.order.count().catch(() => 0),
        prisma.order
          .groupBy({ by: ["status"], _count: { _all: true } })
          .catch(() => []),
        prisma.order
          .groupBy({ by: ["paymentStatus"], _count: { _all: true } })
          .catch(() => []),
        prisma.order
          .groupBy({ by: ["fulfillmentStatus"], _count: { _all: true } })
          .catch(() => []),
      ]);

    return json(
      {
        ok: true,
        total,
        byStatus: normalizeGroupBy(byStatusRows, "status"),
        byPaymentStatus: normalizeGroupBy(byPaymentRows, "paymentStatus"),
        byFulfillmentStatus: normalizeGroupBy(
          byFulfillmentRows,
          "fulfillmentStatus"
        ),
        generatedAt: new Date().toISOString(),
      },
      200
    );
  } catch (e) {
    return json({ ok: false, error: "SERVER_ERROR", detail: String(e) }, 503);
  }
}
