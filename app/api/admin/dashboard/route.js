export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Permissions } from "@/lib/rbac";
import { requireAdmin } from "@/lib/auth"; // ✅ single source of truth for admin auth
import crypto from "crypto";

/* ───────────────────────── response helper ───────────────────────── */

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

const n = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

/**
 * Dhaka day boundary support (avoids server running UTC and showing wrong "today").
 * tz can be: dhaka, utc, UTC+6, UTC+6:00, UTC-5, etc.
 */
function parseTzOffsetMinutes(tzRaw) {
  const tz = String(tzRaw || "").trim().toLowerCase();
  if (!tz) return 360;
  if (tz === "dhaka") return 360;
  if (tz === "utc") return 0;

  const m = tz.match(/utc\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i);
  if (!m) return 360;

  const sign = m[1] === "-" ? -1 : 1;
  const hh = n(m[2], 0);
  const mm = n(m[3], 0);
  return sign * (hh * 60 + mm);
}

function startOfDayUtcFromOffset(now, offsetMinutes) {
  const shifted = now.getTime() + offsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - offsetMinutes * 60 * 1000);
}

/** Safe Prisma delegate getter (avoids runtime if model not in schema) */
function model(prismaClient, name) {
  const m = prismaClient?.[name];
  if (!m) return null;
  if (typeof m.count !== "function") return null;
  return m;
}

/** Get enum values actually present in DB for Order.status (safe vs hardcoding). */
async function getKnownOrderStatuses(Order, db) {
  if (!Order) return [];
  try {
    const rows = await db(() =>
      Order.findMany({
        distinct: ["status"],
        select: { status: true },
        take: 1000,
      })
    );
    return (rows || []).map((r) => r.status).filter(Boolean);
  } catch {
    return [];
  }
}

async function sumOrderField(Order, where, fieldName, db) {
  if (!Order) return null;
  try {
    const agg = await db(() =>
      Order.aggregate({
        where,
        _sum: { [fieldName]: true },
      })
    );
    const v = agg?._sum?.[fieldName];
    return v == null ? 0 : v;
  } catch {
    return null;
  }
}

function normalizePermsFromList(list) {
  const raw = Array.isArray(list) ? list : [];
  return new Set(raw.map((p) => String(p || "").toLowerCase()));
}

function canAny(permSet, perms = []) {
  // Keep your previous behavior: if permission set isn't available, don't hard-break the UI.
  if (!permSet || permSet.size === 0) return true;
  for (const p of perms) {
    if (permSet.has(String(p || "").toLowerCase())) return true;
  }
  return false;
}

/* ───────────────────────── DB concurrency limiter ─────────────────────────
   Prevents P2024 / churn on tiny poolers.
   Default: 1
*/
function createDbLimiter(concurrency = 1) {
  const c = Math.max(1, Math.min(8, Number(concurrency) || 1));
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < c && queue.length) {
      const job = queue.shift();
      if (!job) return;
      active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return function db(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}

/* ───────────────────────── misc helpers ───────────────────────── */

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function clampInt(v, minV, maxV, fallback) {
  const x = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(minV, Math.min(maxV, x));
}

function toStr(v) {
  return String(v ?? "").trim();
}

async function summarizeOrdersByUser(Order, userIds, db) {
  if (!Order || !userIds?.length) return new Map();

  try {
    const rows = await db(() =>
      Order.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds } },
        _count: { _all: true },
        _sum: { grandTotal: true },
        _max: { createdAt: true },
      })
    );

    const m = new Map();
    for (const r of rows || []) {
      m.set(String(r.userId), {
        ordersCount: Number(r?._count?._all ?? 0),
        lifetimeSpend: Number(r?._sum?.grandTotal ?? 0),
        lastOrderAt: r?._max?.createdAt
          ? new Date(r._max.createdAt).toISOString()
          : null,
      });
    }
    return m;
  } catch {
    try {
      const rows = await db(() =>
        Order.groupBy({
          by: ["userId"],
          where: { userId: { in: userIds } },
          _count: { _all: true },
          _sum: { total: true },
          _max: { createdAt: true },
        })
      );

      const m = new Map();
      for (const r of rows || []) {
        m.set(String(r.userId), {
          ordersCount: Number(r?._count?._all ?? 0),
          lifetimeSpend: Number(r?._sum?.total ?? 0),
          lastOrderAt: r?._max?.createdAt
            ? new Date(r._max.createdAt).toISOString()
            : null,
        });
      }
      return m;
    } catch {
      return new Map();
    }
  }
}

/* ───────────────────────── route ───────────────────────── */

export async function GET(req) {
  const requestId = newRequestId();

  // DB limiter for this request
  const db = createDbLimiter(process.env.ADMIN_DASHBOARD_DB_CONCURRENCY || 1);

  // ✅ Admin-only auth using single source of truth (admin plane only, no customer fallback)
  let session;
  try {
    // strict first (keeps your previous behavior)
    session = await requireAdmin(req, { permission: Permissions.VIEW_ANALYTICS });
  } catch (e) {
    try {
      // fallback: any admin session (helps while perms wiring is being finalized)
      session = await requireAdmin(req);
    } catch (e2) {
      const status = Number(e2?.status) || 401;
      return json(
        {
          ok: false,
          requestId,
          error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
        },
        status,
        { "x-request-id": requestId }
      );
    }
  }

  try {
    const { searchParams } = new URL(req.url);

    const tzOffsetMinutes = parseTzOffsetMinutes(searchParams.get("tz"));
    const now = new Date();
    const todayStart = startOfDayUtcFromOffset(now, tzOffsetMinutes);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const permSet = normalizePermsFromList(session?.permissions);

    const Order = model(prisma, "order");
    const User = model(prisma, "user");
    const Product = model(prisma, "product");
    const ProductVariant = model(prisma, "productVariant");
    const InventoryItem = model(prisma, "inventoryItem");
    const AuditLog = model(prisma, "auditLog");
    const NotificationJob = model(prisma, "notificationJob");
    const Cart = model(prisma, "cart");
    const PaymentProvider = model(prisma, "paymentProvider");

    const knownStatuses = await getKnownOrderStatuses(Order, db);
    const preferredSold = ["PLACED", "CONFIRMED", "COMPLETED"];
    const soldStatuses = knownStatuses.filter((s) =>
      preferredSold.includes(String(s))
    );
    const statusFilter = soldStatuses.length
      ? { status: { in: soldStatuses } }
      : knownStatuses.length
      ? { status: { in: knownStatuses } }
      : {};

    const allowOrders = canAny(permSet, [
      Permissions.VIEW_ORDERS,
      Permissions.MANAGE_ORDERS,
      Permissions.VIEW_ANALYTICS,
      Permissions.VIEW_REPORTS,
      Permissions.VIEW_FINANCIALS,
    ]);

    const allowCustomers = canAny(permSet, [
      Permissions.VIEW_CUSTOMERS,
      Permissions.MANAGE_CUSTOMERS,
      Permissions.VIEW_ANALYTICS,
      Permissions.VIEW_REPORTS,
      Permissions.MANAGE_ORDERS,
    ]);

    const allowInventory = canAny(permSet, [
      Permissions.VIEW_INVENTORY,
      Permissions.MANAGE_INVENTORY,
      Permissions.MANAGE_CATALOG,
      Permissions.MANAGE_PRODUCTS,
      Permissions.VIEW_ANALYTICS,
    ]);

    const allowNotifs = canAny(permSet, [
      Permissions.MANAGE_AUTOMATIONS,
      Permissions.VIEW_ANALYTICS,
      Permissions.VIEW_REPORTS,
    ]);

    const allowAudit = canAny(permSet, [Permissions.VIEW_AUDIT_LOGS]);

    const ordersPromise = (async () => {
      if (!Order || !allowOrders) return null;

      const whereToday = { ...statusFilter, createdAt: { gte: todayStart } };
      const where7d = { ...statusFilter, createdAt: { gte: sevenDaysAgo } };

      const ordersToday = await db(() => Order.count({ where: whereToday }));
      const ordersLast7d = await db(() => Order.count({ where: where7d }));

      const revTodayGrand = await sumOrderField(
        Order,
        whereToday,
        "grandTotal",
        db
      );
      const rev7dGrand = await sumOrderField(
        Order,
        where7d,
        "grandTotal",
        db
      );

      let revenueToday = revTodayGrand;
      let revenue7d = rev7dGrand;

      if (revenueToday == null || revenue7d == null) {
        const revTodayTotal = await sumOrderField(
          Order,
          whereToday,
          "total",
          db
        );
        const rev7dTotal = await sumOrderField(Order, where7d, "total", db);
        revenueToday = revenueToday == null ? revTodayTotal : revenueToday;
        revenue7d = revenue7d == null ? rev7dTotal : revenue7d;
      }

      return {
        ordersToday,
        ordersLast7d,
        revenueToday: revenueToday ?? 0,
        revenue7d: revenue7d ?? 0,
        statusMode: soldStatuses.length ? "SOLD_ONLY" : "ALL_STATUSES",
        statusesUsed: soldStatuses.length ? soldStatuses : knownStatuses,
      };
    })();

    const customersPromise = (async () => {
      if (!User || !allowCustomers) return null;

      const total = await db(() => User.count());
      const new7d = await db(() =>
        User.count({ where: { createdAt: { gte: sevenDaysAgo } } })
      );
      return { total, new7d };
    })();

    const inventoryPromise = (async () => {
      if (!allowInventory) return null;

      const products = Product ? await db(() => Product.count()) : null;
      const variants = ProductVariant
        ? await db(() => ProductVariant.count())
        : null;

      let lowStock = null;
      if (InventoryItem) {
        try {
          lowStock = await db(() =>
            InventoryItem.count({ where: { onHand: { lte: 0 } } })
          );
        } catch {
          lowStock = null;
        }
      }

      return { products, variants, lowStock };
    })();

    const cartPromise = (async () => {
      if (!Cart) return null;
      try {
        const activeCarts = await db(() => Cart.count());
        return { activeCarts };
      } catch {
        return null;
      }
    })();

    const paymentsPromise = (async () => {
      if (!PaymentProvider) return null;
      try {
        const providersCount = await db(() =>
          PaymentProvider.count({ where: { enabled: true } })
        );
        return { providersCount };
      } catch {
        try {
          const providersCount = await db(() => PaymentProvider.count());
          return { providersCount };
        } catch {
          return null;
        }
      }
    })();

    const notifsPromise = (async () => {
      if (!allowNotifs || !NotificationJob) return null;

      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      try {
        const queued = await db(() =>
          NotificationJob.count({
            where: { status: { in: ["QUEUED", "PENDING"] } },
          })
        );
        const deliveries24h = await db(() =>
          NotificationJob.count({
            where: { status: "DELIVERED", deliveredAt: { gte: last24h } },
          })
        );
        return { queued, deliveries24h };
      } catch {
        return null;
      }
    })();

    const auditPromise = (async () => {
      if (!allowAudit || !AuditLog) return null;

      try {
        const total7d = await db(() =>
          AuditLog.count({ where: { at: { gte: sevenDaysAgo } } })
        );
        return { total7d };
      } catch {
        try {
          const total7d = await db(() =>
            AuditLog.count({ where: { createdAt: { gte: sevenDaysAgo } } })
          );
          return { total7d };
        } catch {
          return null;
        }
      }
    })();

    // Enable via: ?customers=1&customerQ=...&customersLimit=50
    const customersDirectoryPromise = (async () => {
      const want = String(searchParams.get("customers") || "") === "1";
      if (!want || !User || !allowCustomers) return null;

      const limit = clampInt(searchParams.get("customersLimit"), 1, 100, 50);
      const q = toStr(searchParams.get("customerQ"));

      const where = q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {};

      const users = await db(() =>
        User.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true,
            isActive: true,
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        })
      );

      const ids = (users || []).map((u) => u.id).filter(Boolean);
      const stats = await summarizeOrdersByUser(Order, ids, db);

      const rows = (users || []).map((u) => {
        const s = stats.get(String(u.id)) || {
          ordersCount: 0,
          lifetimeSpend: 0,
          lastOrderAt: null,
        };
        return {
          id: u.id,
          name: u.name || null,
          email: u.email || null,
          phone: u.phone || null,
          isActive: u.isActive !== false,
          createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
          ordersCount: s.ordersCount,
          lifetimeSpend: s.lifetimeSpend,
          lastOrderAt: s.lastOrderAt,
        };
      });

      return { q, limit, rows };
    })();

    const health = { status: "ok", queueDepth: null };

    const [
      orders,
      customers,
      inventory,
      cart,
      payments,
      notifications,
      audit,
      customersDirectory,
    ] = await Promise.all([
      ordersPromise,
      customersPromise,
      inventoryPromise,
      cartPromise,
      paymentsPromise,
      notifsPromise,
      auditPromise,
      customersDirectoryPromise,
    ]);

    return json(
      {
        ok: true,
        requestId,
        generatedAt: now.toISOString(),
        tzOffsetMinutes,
        viewer: {
          roles: session?.roles || [],
          permissions: session?.permissions || [],
        },
        snapshot: {
          orders,
          returns: null,
          customers,
          customersDirectory,
          inventory,
          logistics: null,
          tax: null,
          cart,
          checkout: null,
          wallet: null,
          loyalty: null,
          notifications,
          payments,
          cms: null,
          audit,
          health,
        },
      },
      200,
      { "x-request-id": requestId }
    );
  } catch (err) {
    console.error("[api/admin/dashboard] error:", err);
    return json(
      { ok: false, requestId, error: "DASHBOARD_FAILED" },
      500,
      { "x-request-id": requestId }
    );
  }
}
