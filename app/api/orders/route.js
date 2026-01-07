// PATH: app/api/admin/orders/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

/**
 * Small JSON helper with no-store caching
 */
function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clampInt(v, minV, maxV, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}

function toStr(v) {
  return String(v ?? "").trim();
}

function parseCsvList(v) {
  const s = toStr(v);
  if (!s) return [];
  return s
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function safeSortKey(k) {
  // Allow only fields that exist on Order model (common set)
  const key = toStr(k) || "createdAt";
  const allowed = new Set([
    "createdAt",
    "updatedAt",
    "grandTotal",
    "subtotal",
    "orderNumber",
    "paymentStatus",
    "fulfillmentStatus",
    "status",
  ]);
  return allowed.has(key) ? key : "createdAt";
}

function safeSortDir(d) {
  const dir = toStr(d).toLowerCase();
  return dir === "asc" ? "asc" : "desc";
}

function parseDateMaybe(v) {
  const s = toStr(v);
  if (!s) return null;
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/**
 * Admin / Staff orders list API
 *
 * Permissions:
 * - Requires any role that has VIEW_ORDERS.
 *
 * Query params:
 * - page:         1-based page number (default 1)
 * - pageSize:     page size (default 20, max 100)
 * - q:            search term (name/email/phone/orderNumber/id)
 * - status:       filter by Order.status (exact match OR CSV list)
 * - paymentStatus: filter by Order.paymentStatus (exact match OR CSV list)
 * - fulfillmentStatus: filter by Order.fulfillmentStatus (exact match OR CSV list)
 * - currency:     filter by Order.currency
 * - dateFrom/dateTo: createdAt range filter (ISO date/time)
 * - minTotal/maxTotal: grandTotal numeric range
 * - sort:         createdAt|grandTotal|orderNumber|... (whitelisted)
 * - dir:          asc|desc
 * - include:      CSV of extra relations: user,items,payments,addresses,events
 * - summary:      "1" to include countsByStatus + totals (for dashboard tiles)
 * - debug:        "1" to include resolved filters (admins only)
 */
export async function GET(req) {
  let admin;
  try {
    admin = await requireAdmin(req, { permission: Permissions.VIEW_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  try {
    const { searchParams } = new URL(req.url);

    const page = clampInt(searchParams.get("page"), 1, 1_000_000, 1);
    const pageSize = clampInt(searchParams.get("pageSize"), 1, 100, 20);

    const q = toStr(searchParams.get("q"));
    const status = toStr(searchParams.get("status"));
    const paymentStatus = toStr(searchParams.get("paymentStatus"));
    const fulfillmentStatus = toStr(searchParams.get("fulfillmentStatus"));
    const currency = toStr(searchParams.get("currency"));

    const dateFrom = parseDateMaybe(searchParams.get("dateFrom"));
    const dateTo = parseDateMaybe(searchParams.get("dateTo"));

    const minTotalRaw = searchParams.get("minTotal");
    const maxTotalRaw = searchParams.get("maxTotal");
    const minTotal = minTotalRaw != null && minTotalRaw !== "" ? Number(minTotalRaw) : null;
    const maxTotal = maxTotalRaw != null && maxTotalRaw !== "" ? Number(maxTotalRaw) : null;

    const sort = safeSortKey(searchParams.get("sort"));
    const dir = safeSortDir(searchParams.get("dir"));

    const includeCsv = parseCsvList(searchParams.get("include"));
    const includeSet = new Set(includeCsv);

    const wantSummary = toStr(searchParams.get("summary")) === "1";
    const wantDebug = toStr(searchParams.get("debug")) === "1";

    const where = {};

    // status filters (single or CSV)
    const statuses = parseCsvList(status || "");
    if (statuses.length === 1) where.status = statuses[0];
    if (statuses.length > 1) where.status = { in: statuses };

    const payStatuses = parseCsvList(paymentStatus || "");
    if (payStatuses.length === 1) where.paymentStatus = payStatuses[0];
    if (payStatuses.length > 1) where.paymentStatus = { in: payStatuses };

    const fulfStatuses = parseCsvList(fulfillmentStatus || "");
    if (fulfStatuses.length === 1) where.fulfillmentStatus = fulfStatuses[0];
    if (fulfStatuses.length > 1) where.fulfillmentStatus = { in: fulfStatuses };

    if (currency) where.currency = currency;

    // createdAt range
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    // grandTotal range
    if (Number.isFinite(minTotal) || Number.isFinite(maxTotal)) {
      where.grandTotal = {};
      if (Number.isFinite(minTotal)) where.grandTotal.gte = minTotal;
      if (Number.isFinite(maxTotal)) where.grandTotal.lte = maxTotal;
    }

    // Search by customer name/email/phone/orderNumber/id
    if (q) {
      const or = [
        { user: { name: { contains: q, mode: "insensitive" } } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { user: { phone: { contains: q } } },
        { id: q },
      ];

      const qNum = Number(q);
      if (Number.isFinite(qNum)) {
        or.push({ orderNumber: qNum });
      }

      where.OR = or;
    }

    const include = {
      user: includeSet.has("user")
        ? { select: { name: true, email: true, phone: true } }
        : undefined,

      items: includeSet.has("items")
        ? {
            select: {
              id: true,
              title: true,
              sku: true,
              variantId: true,
              quantity: true,
              unitPrice: true,
              total: true,
            },
          }
        : undefined,

      payments: includeSet.has("payments")
        ? {
            select: {
              id: true,
              provider: true,
              status: true,
              amount: true,
              currency: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          }
        : undefined,

      shippingAddress: includeSet.has("addresses")
        ? { select: { id: true, name: true, phone: true, city: true, area: true } }
        : undefined,

      billingAddress: includeSet.has("addresses")
        ? { select: { id: true, name: true, phone: true, city: true, area: true } }
        : undefined,

      events: includeSet.has("events")
        ? {
            select: { id: true, kind: true, message: true, createdAt: true },
            orderBy: { createdAt: "desc" },
            take: 20,
          }
        : undefined,
    };

    // clean undefined includes (Prisma tolerates but keep tidy)
    Object.keys(include).forEach((k) => include[k] === undefined && delete include[k]);

    const skip = (page - 1) * pageSize;

    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { [sort]: dir },
        skip,
        take: pageSize,
        include,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Flatten rows for tables (keep previous fields)
    const rows = items.map((o) => {
      const itemsCount = Array.isArray(o.items) ? o.items.length : null;
      const itemsQty = Array.isArray(o.items)
        ? o.items.reduce((s, it) => s + Number(it.quantity || 0), 0)
        : null;

      const providers = Array.isArray(o.payments)
        ? Array.from(
            new Set(
              o.payments
                .map((p) => p?.provider)
                .filter(Boolean)
                .map((x) => String(x))
            )
          )
        : null;

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        currency: o.currency ?? null,
        subtotal: o.subtotal ?? null,
        taxTotal: o.taxTotal ?? null,
        shippingTotal: o.shippingTotal ?? null,
        discountTotal: o.discountTotal ?? null,
        grandTotal: o.grandTotal,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt ?? null,

        userName: o.user?.name || null,
        userEmail: o.user?.email || null,
        userPhone: o.user?.phone || null,

        // optional enrichments when include=items/payments/addresses/events
        itemsCount,
        itemsQty,
        paymentProviders: providers,

        shipping: o.shippingAddress
          ? {
              id: o.shippingAddress.id,
              name: o.shippingAddress.name ?? null,
              phone: o.shippingAddress.phone ?? null,
              city: o.shippingAddress.city ?? null,
              area: o.shippingAddress.area ?? null,
            }
          : null,

        billing: o.billingAddress
          ? {
              id: o.billingAddress.id,
              name: o.billingAddress.name ?? null,
              phone: o.billingAddress.phone ?? null,
              city: o.billingAddress.city ?? null,
              area: o.billingAddress.area ?? null,
            }
          : null,

        // Keep raw relations available if requested (UI can use them)
        items: o.items ?? undefined,
        payments: o.payments ?? undefined,
        events: o.events ?? undefined,
      };
    });

    let summary = null;
    if (wantSummary) {
      // counts by status for tiles and quick dashboards
      const [counts, totals] = await Promise.all([
        prisma.order.groupBy({
          by: ["status"],
          _count: { _all: true },
          where,
        }),
        prisma.order.aggregate({
          where,
          _sum: { grandTotal: true },
          _avg: { grandTotal: true },
          _count: { _all: true },
        }),
      ]);

      summary = {
        countsByStatus: (counts || []).reduce((acc, row) => {
          acc[row.status] = row._count?._all ?? 0;
          return acc;
        }, {}),
        totalOrders: totals?._count?._all ?? total,
        sumGrandTotal: totals?._sum?.grandTotal ?? 0,
        avgGrandTotal: totals?._avg?.grandTotal ?? 0,
      };
    }

    const payload = {
      ok: true,
      total,
      page,
      pageSize,
      totalPages,
      sort,
      dir,
      items: rows,
      summary,
    };

    if (wantDebug) {
      payload.debug = {
        adminId: admin?.userId || admin?.id || null,
        filters: {
          q,
          statuses,
          payStatuses,
          fulfStatuses,
          currency,
          dateFrom: dateFrom ? dateFrom.toISOString() : null,
          dateTo: dateTo ? dateTo.toISOString() : null,
          minTotal: Number.isFinite(minTotal) ? minTotal : null,
          maxTotal: Number.isFinite(maxTotal) ? maxTotal : null,
          include: includeCsv,
        },
      };
    }

    return json(payload, 200);
  } catch (err) {
    console.error("[admin.orders.GET]", err);
    return json({ ok: false, error: "ORDERS_LIST_FAILED" }, 500);
  }
}
