// PATH: app/api/admin/orders/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminIndependent } from "@/lib/admin/requireAdminIndependent";
import { Permissions } from "@/lib/rbac";

/**
 * Small JSON helper with no-store caching
 */
function json(body, status = 200, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "cookie",
      ...extraHeaders,
    },
  });
}

/**
 * Optional CSV export (no UI changes required): ?format=csv
 */
function csvResponse(csvText, filename = "orders.csv") {
  return new NextResponse(csvText, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      vary: "cookie",
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

/**
 * supports both:
 * - repeated params: ?status=PLACED&status=CONFIRMED
 * - CSV params: ?status=PLACED,CONFIRMED
 */
function parseMultiParam(searchParams, key) {
  const all = searchParams.getAll(key);
  if (!all || all.length === 0) return [];
  const expanded = [];
  for (const v of all) {
    const s = toStr(v);
    if (!s) continue;
    for (const part of s.split(",")) {
      const p = toStr(part);
      if (p) expanded.push(p);
    }
  }
  const seen = new Set();
  const out = [];
  for (const x of expanded) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

function safeSortKey(k) {
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

function parseDateFromMaybe(v) {
  const s = toStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dt = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt : null;
}
function parseDateToMaybe(v) {
  const s = toStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const dt = new Date(`${s}T23:59:59.999Z`);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function getOrderItemDelegate() {
  const candidates = [
    "orderItem",
    "orderItems",
    "orderLineItem",
    "orderLineItems",
    "order_item",
    "order_items",
  ];
  for (const k of candidates) {
    const d = prisma?.[k];
    if (d && typeof d.aggregate === "function") return d;
  }
  return null;
}

const PAID_LIKE = ["PAID", "CAPTURED", "SUCCEEDED", "SETTLED"];
const UNPAID_LIKE = ["UNPAID", "PENDING", "AUTHORIZED", "INITIATED"];

function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = [
    "id",
    "orderNumber",
    "status",
    "paymentStatus",
    "fulfillmentStatus",
    "currency",
    "grandTotal",
    "createdAt",
    "userName",
    "userEmail",
    "userPhone",
  ];

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.orderNumber,
        r.status,
        r.paymentStatus,
        r.fulfillmentStatus,
        r.currency,
        r.grandTotal,
        r.createdAt,
        r.userName,
        r.userEmail,
        r.userPhone,
      ]
        .map(esc)
        .join(",")
    );
  }
  return lines.join("\n");
}

export async function GET(req) {
  // ✅ Admin-only auth (decoupled)
  try {
    await requireAdminIndependent(req, { permission: Permissions.VIEW_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    // IMPORTANT: do not clear cookies here; just return status
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
    const currency = toStr(searchParams.get("currency"));

    const statuses = parseMultiParam(searchParams, "status");
    const payStatuses = parseMultiParam(searchParams, "paymentStatus");
    const fulfStatuses = parseMultiParam(searchParams, "fulfillmentStatus");

    const dateFrom = parseDateFromMaybe(searchParams.get("dateFrom"));
    const dateTo = parseDateToMaybe(searchParams.get("dateTo"));

    const minTotalRaw = searchParams.get("minTotal");
    const maxTotalRaw = searchParams.get("maxTotal");
    const minTotal =
      minTotalRaw != null && minTotalRaw !== "" ? Number(minTotalRaw) : null;
    const maxTotal =
      maxTotalRaw != null && maxTotalRaw !== "" ? Number(maxTotalRaw) : null;

    const sort = safeSortKey(searchParams.get("sort"));
    const dir = safeSortDir(searchParams.get("dir"));

    const includeCsv = parseCsvList(searchParams.get("include"));
    const includeSet = new Set(includeCsv);

    const wantSummary = toStr(searchParams.get("summary")) === "1";
    const wantDebug = toStr(searchParams.get("debug")) === "1";
    const format = toStr(searchParams.get("format")).toLowerCase(); // json|csv

    const where = {};

    if (statuses.length === 1) where.status = statuses[0];
    if (statuses.length > 1) where.status = { in: statuses };

    if (payStatuses.length === 1) where.paymentStatus = payStatuses[0];
    if (payStatuses.length > 1) where.paymentStatus = { in: payStatuses };

    if (fulfStatuses.length === 1) where.fulfillmentStatus = fulfStatuses[0];
    if (fulfStatuses.length > 1) where.fulfillmentStatus = { in: fulfStatuses };

    if (currency) where.currency = currency;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    if (Number.isFinite(minTotal) || Number.isFinite(maxTotal)) {
      where.grandTotal = {};
      if (Number.isFinite(minTotal)) where.grandTotal.gte = minTotal;
      if (Number.isFinite(maxTotal)) where.grandTotal.lte = maxTotal;
    }

    if (q) {
      const or = [
        { user: { name: { contains: q, mode: "insensitive" } } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { user: { phone: { contains: q } } },
        { id: q },
      ];

      const qNum = Number(q);
      if (Number.isFinite(qNum)) or.push({ orderNumber: qNum });

      where.OR = or;
    }

    const include = {
      // Always include user snapshot for admin list
      user: { select: { name: true, email: true, phone: true } },

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

    const rows = items.map((o) => {
      const itemsCount = Array.isArray(o.items) ? o.items.length : null;
      const itemsQty = Array.isArray(o.items)
        ? o.items.reduce((s, it) => s + Number(it.quantity || 0), 0)
        : null;

      const providers = Array.isArray(o.payments)
        ? Array.from(new Set(o.payments.map((p) => p?.provider).filter(Boolean)))
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

        items: o.items ?? undefined,
        payments: o.payments ?? undefined,
        events: o.events ?? undefined,
      };
    });

    // Optional CSV export (commonly requested for admin ops)
    if (format === "csv") {
      const csv = toCsv(rows);
      return csvResponse(csv, `orders_page_${page}.csv`);
    }

    let summary = null;
    if (wantSummary) {
      const itemDelegate = getOrderItemDelegate();

      const [countsByStatusRows, totals, byPaymentRows, byFulfillmentRows] =
        await Promise.all([
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
          prisma.order.groupBy({
            by: ["paymentStatus"],
            _count: { _all: true },
            where,
          }),
          prisma.order.groupBy({
            by: ["fulfillmentStatus"],
            _count: { _all: true },
            where,
          }),
        ]);

      const [paidAgg, unpaidAgg, itemAgg] = await Promise.all([
        prisma.order.aggregate({
          where: { ...where, paymentStatus: { in: PAID_LIKE } },
          _sum: { grandTotal: true },
        }),
        prisma.order.aggregate({
          where: { ...where, paymentStatus: { in: UNPAID_LIKE } },
          _sum: { grandTotal: true },
        }),
        itemDelegate
          ? itemDelegate.aggregate({
              where: { order: where },
              _count: { _all: true },
              _sum: { quantity: true },
            })
          : Promise.resolve(null),
      ]);

      const ordersCount = Number(totals?._count?._all ?? total);
      const sumGrandTotal = Number(totals?._sum?.grandTotal ?? 0);
      const avgGrandTotal = Number(totals?._avg?.grandTotal ?? 0);

      const countsByStatus = (countsByStatusRows || []).reduce((acc, row) => {
        acc[row.status] = row._count?._all ?? 0;
        return acc;
      }, {});

      const breakdowns = {
        byStatus: countsByStatus,
        byPaymentStatus: (byPaymentRows || []).reduce((acc, row) => {
          acc[row.paymentStatus] = row._count?._all ?? 0;
          return acc;
        }, {}),
        byFulfillmentStatus: (byFulfillmentRows || []).reduce((acc, row) => {
          acc[row.fulfillmentStatus] = row._count?._all ?? 0;
          return acc;
        }, {}),
      };

      summary = {
        countsByStatus,
        totalOrders: ordersCount,
        sumGrandTotal,
        avgGrandTotal,

        // KPI aliases
        orders: ordersCount,
        amount: sumGrandTotal,
        items: itemAgg ? Number(itemAgg?._count?._all ?? 0) : null,
        qty: itemAgg ? Number(itemAgg?._sum?.quantity ?? 0) : null,
        paidAmount: Number(paidAgg?._sum?.grandTotal ?? 0),
        unpaidAmount: Number(unpaidAgg?._sum?.grandTotal ?? 0),
        aov: ordersCount > 0 ? sumGrandTotal / ordersCount : 0,

        breakdowns,
      };
    }

    const payload = {
      ok: true,
      total,
      page,
      pageSize,
      totalPages,
      pageCount: totalPages,
      sort,
      dir,
      items: rows,
      summary,
    };

    if (wantDebug) {
      payload.debug = {
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
          format: format || "json",
        },
      };
    }

    return json(payload, 200, {
      "x-total-count": String(total),
      "x-page": String(page),
      "x-page-size": String(pageSize),
    });
  } catch (err) {
    console.error("[admin.orders.GET]", err);
    return json({ ok: false, error: "ORDERS_LIST_FAILED" }, 500);
  }
}
