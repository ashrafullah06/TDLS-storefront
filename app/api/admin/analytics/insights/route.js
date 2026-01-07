// FILE: app/api/admin/analytics/insights/route.js
import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;

const clampInt = (v, min, max, fallback) => {
  const x = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
};

const clampOffset = (v, fallback = 360) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  // UTC-12..UTC+14
  return Math.max(-720, Math.min(840, Math.round(x)));
};

const hasModel = (name) => prisma && typeof prisma?.[name]?.findMany === "function";

function jsonNoStore(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

// Admin-only guard (NO dependency on customer session)
async function requireAdminSignal() {
  const jar = await cookies();

  const adminRole =
    jar.get("admin_role")?.value ||
    jar.get("tdlc_admin_role")?.value ||
    jar.get("adminRole")?.value ||
    "";

  const adminSession =
    jar.get("admin_session")?.value ||
    jar.get("tdlc_admin_session")?.value ||
    jar.get("admin_sid")?.value ||
    "";

  // Strict decoupling: explicit admin cookie signal must exist.
  const ok = Boolean(adminRole || adminSession);

  return { ok, role: adminRole || null };
}

function isDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

/**
 * Deterministic date parsing with tzOffsetMinutes:
 * - If YYYY-MM-DD: treat as "local day" at tzOffsetMinutes and convert to UTC.
 * - Else: treat as ISO/Date parse.
 */
function parseDateFlex(s, fallback, tzOffsetMinutes, { isEnd = false } = {}) {
  if (!s) return fallback;
  const raw = String(s).trim();
  if (!raw) return fallback;

  if (isDateOnly(raw)) {
    // "local midnight" in the target timezone
    const baseUtc = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(baseUtc.getTime())) return fallback;

    const localMidnightUtc = new Date(baseUtc.getTime() - tzOffsetMinutes * 60 * 1000);
    if (!isEnd) return localMidnightUtc;
    return new Date(localMidnightUtc.getTime() + DAY - 1);
  }

  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

function toISODateWithOffset(d, tzOffsetMinutes) {
  const ms = new Date(d).getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const x = new Date(shifted);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  const da = String(x.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function GET(req) {
  const gate = await requireAdminSignal();
  if (!gate.ok) {
    return jsonNoStore(
      {
        ok: false,
        error: "admin_auth_required",
        message: "Admin session not detected. Please sign in to the admin panel.",
      },
      401
    );
  }

  const { searchParams } = new URL(req.url);

  // Optional knobs (additive; UI can ignore)
  const debug = searchParams.get("debug") === "1";
  const tzOffsetMinutes = clampOffset(searchParams.get("tzOffsetMinutes"), 360);

  const includeRaw = String(searchParams.get("include") || "").trim();
  const include =
    includeRaw.length > 0
      ? new Set(includeRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
      : null;

  const want = (k) => !include || include.has(k);

  const topN = clampInt(searchParams.get("topN"), 1, 100, 20);
  const topRepeatN = clampInt(searchParams.get("topRepeatN"), 1, 200, 50);

  // Support both (start,end) and days
  const days = clampInt(searchParams.get("days"), 1, MAX_RANGE_DAYS, DEFAULT_RANGE_DAYS);
  const endFallback = new Date();
  const startFallback = new Date(Date.now() - (days - 1) * DAY);

  const start = parseDateFlex(searchParams.get("start"), startFallback, tzOffsetMinutes, { isEnd: false });
  const end = parseDateFlex(searchParams.get("end"), endFallback, tzOffsetMinutes, { isEnd: true });

  // Ensure sane ordering and clamp span
  let startFinal = start;
  let endFinal = end;
  if (startFinal > endFinal) {
    const tmp = startFinal;
    startFinal = endFinal;
    endFinal = tmp;
  }
  const spanDays = Math.max(1, Math.ceil((endFinal.getTime() - startFinal.getTime() + 1) / DAY));
  if (spanDays > MAX_RANGE_DAYS) {
    endFinal = new Date(startFinal.getTime() + MAX_RANGE_DAYS * DAY - 1);
  }

  const range = {
    gte: startFinal,
    lte: endFinal,
  };

  const out = {
    ok: true,
    start: toISODateWithOffset(startFinal, tzOffsetMinutes),
    end: toISODateWithOffset(endFinal, tzOffsetMinutes),
    days: Math.max(1, Math.ceil((endFinal.getTime() - startFinal.getTime() + 1) / DAY)),
    tzOffsetMinutes,
    source: "prisma",
    adminRole: gate.role,

    // Keep existing keys (UI-safe)
    topProductsByUnits: [],
    topProductsByRevenue: [],
    popularAddsToCart: [],
    mostViewedProducts: [],
    abandonedCartProducts: [],
    repeatCustomers: [],
    topSearchTerms: [],
  };

  const t0 = Date.now();

  // ------- ORDERS + ITEMS → product performance -------
  if (want("orders")) {
    await safe(async () => {
      // More reliable semantics: paymentStatus first, then status fallback.
      const paymentFilterUpper = { in: ["PAID", "SETTLED", "CAPTURED", "SUCCEEDED"] };
      const statusFilterUpper = { in: ["PAID", "COMPLETED", "FULFILLED", "DELIVERED"] };

      const orders =
        (await prisma.order
          .findMany({
            where: { createdAt: range, paymentStatus: paymentFilterUpper },
            select: {
              id: true,
              userId: true,
              items: {
                select: {
                  productId: true,
                  variantId: true,
                  quantity: true,
                  price: true,
                  total: true,
                  createdAt: true,
                },
              },
            },
          })
          .catch(async () => {
            // fallback: status
            return prisma.order.findMany({
              where: { createdAt: range, status: statusFilterUpper },
              select: {
                id: true,
                userId: true,
                items: {
                  select: {
                    productId: true,
                    variantId: true,
                    quantity: true,
                    price: true,
                    total: true,
                    createdAt: true,
                  },
                },
              },
            });
          })
          .catch(async () => {
            // fallback: orderItems relation
            return prisma.order.findMany({
              where: { createdAt: range, paymentStatus: paymentFilterUpper },
              select: {
                id: true,
                userId: true,
                orderItems: {
                  select: {
                    productId: true,
                    variantId: true,
                    quantity: true,
                    price: true,
                    total: true,
                    createdAt: true,
                  },
                },
              },
            });
          })
          .catch(async () => {
            // last: anything
            return prisma.order.findMany({
              where: { createdAt: range },
              select: {
                id: true,
                userId: true,
                orderItems: {
                  select: {
                    productId: true,
                    variantId: true,
                    quantity: true,
                    price: true,
                    total: true,
                    createdAt: true,
                  },
                },
              },
            });
          })) || [];

      const itemsKey = orders.length && orders[0]?.items ? "items" : "orderItems";
      const items = [];
      for (const o of orders) for (const it of o?.[itemsKey] || []) items.push(it);

      const prodMap = new Map();
      for (const it of items) {
        const key = it.productId ?? (it.variantId ? `variant:${it.variantId}` : null);
        if (!key) continue;

        const curr = prodMap.get(key) || { key, units: 0, revenue: 0 };
        curr.units += Number(it.quantity || 0);
        const lineTotal =
          it.total != null ? Number(it.total) : Number(it.price || 0) * Number(it.quantity || 0);
        curr.revenue += Number.isFinite(lineTotal) ? lineTotal : 0;
        prodMap.set(key, curr);
      }

      // Resolve labels
      let labelMap = {};
      const productIds = Array.from(prodMap.keys()).filter((k) => !String(k).startsWith("variant:"));
      if (productIds.length && hasModel("product")) {
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, slug: true, sku: true },
        });
        labelMap = Object.fromEntries(
          products.map((p) => [String(p.id), p.name || p.slug || p.sku || String(p.id)])
        );
      }

      const all = Array.from(prodMap.values()).map((r) => ({
        id: r.key,
        label: labelMap[String(r.key)] || String(r.key),
        units: r.units,
        revenue: Number(Number(r.revenue).toFixed(2)),
      }));

      out.topProductsByUnits = all.slice().sort((a, b) => b.units - a.units).slice(0, topN);
      out.topProductsByRevenue = all.slice().sort((a, b) => b.revenue - a.revenue).slice(0, topN);

      // Repeat customers
      const perUser = new Map();
      for (const o of orders) {
        if (!o.userId) continue;
        perUser.set(o.userId, (perUser.get(o.userId) || 0) + 1);
      }

      const repeatIds = Array.from(perUser.entries())
        .filter(([, c]) => c >= 2)
        .map(([id]) => id);

      if (repeatIds.length && hasModel("user")) {
        const users = await prisma.user.findMany({
          where: { id: { in: repeatIds } },
          select: { id: true, email: true, name: true, phone: true },
        });

        out.repeatCustomers = users
          .map((u) => ({
            id: u.id,
            name: u.name || u.email || u.phone || u.id,
            orders: perUser.get(u.id) || 0,
          }))
          .sort((a, b) => b.orders - a.orders)
          .slice(0, topRepeatN);
      } else {
        out.repeatCustomers = repeatIds
          .map((id) => ({ id, name: String(id), orders: perUser.get(id) || 0 }))
          .sort((a, b) => b.orders - a.orders)
          .slice(0, topRepeatN);
      }
    }, null);
  }

  // ------- Audit log → views, add-to-cart, search terms -------
  if (want("audit")) {
    await safe(async () => {
      if (!hasModel("auditLog")) return;

      const logs = await prisma.auditLog.findMany({
        where: { createdAt: range },
        select: { type: true, meta: true, productId: true, term: true },
      });

      const adds = new Map();
      const views = new Map();
      const terms = new Map();

      for (const l of logs) {
        const t = String(l.type || "").toLowerCase();
        const meta = l.meta || {};
        const pid =
          l.productId ??
          meta.productId ??
          meta.product_id ??
          meta.pid ??
          meta.product ??
          null;

        if (t.includes("add_to_cart") || t.includes("added_to_cart")) {
          if (!pid) continue;
          adds.set(pid, (adds.get(pid) || 0) + 1);
        } else if (t.includes("product_view") || t === "view_product" || t === "view") {
          if (!pid) continue;
          views.set(pid, (views.get(pid) || 0) + 1);
        } else if (t === "search" || t === "site_search") {
          const q = String(l.term || meta.q || meta.term || "").trim();
          if (q) terms.set(q.toLowerCase(), (terms.get(q.toLowerCase()) || 0) + 1);
        }
      }

      out.popularAddsToCart = Array.from(adds.entries())
        .map(([id, count]) => ({ id, label: String(id), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);

      out.mostViewedProducts = Array.from(views.entries())
        .map(([id, count]) => ({ id, label: String(id), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);

      out.topSearchTerms = Array.from(terms.entries())
        .map(([term, count]) => ({ term, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);
    }, null);
  }

  // ------- Abandoned cart products -------
  if (want("carts")) {
    await safe(async () => {
      if (!hasModel("cart")) return;

      const openCarts =
        (await prisma.cart
          .findMany({
            where: {
              updatedAt: range,
              OR: [{ status: "open" }, { status: "active" }, { status: null }],
            },
            select: {
              id: true,
              items: { select: { productId: true, variantId: true, quantity: true } },
            },
          })
          .catch(async () => {
            return prisma.cart.findMany({
              where: { updatedAt: range },
              select: {
                id: true,
                cartItems: { select: { productId: true, variantId: true, quantity: true } },
              },
            });
          })) || [];

      const itemsKey = openCarts.length && openCarts[0]?.items ? "items" : "cartItems";
      const counts = new Map();

      for (const c of openCarts) {
        for (const it of c?.[itemsKey] || []) {
          const k = it.productId ?? (it.variantId ? `variant:${it.variantId}` : null);
          if (!k) continue;
          counts.set(k, (counts.get(k) || 0) + Number(it.quantity || 1));
        }
      }

      out.abandonedCartProducts = Array.from(counts.entries())
        .map(([id, count]) => ({ id, label: String(id), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);
    }, null);
  }

  const t1 = Date.now();

  if (debug) {
    out.debug = {
      perfMs: t1 - t0,
      query: Object.fromEntries(searchParams.entries()),
      include: include ? Array.from(include) : null,
    };
  }

  return jsonNoStore(out, 200);
}
