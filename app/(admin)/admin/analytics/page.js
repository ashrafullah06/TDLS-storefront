// FILE: app/(admin)/admin/analytics/page.jsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import AnalyticsClient from "./client";
import { cookies, headers } from "next/headers";
import { hasPermission, Permissions } from "@/lib/rbac";

export const metadata = { title: "Admin • Analytics" };

const DAY = 24 * 60 * 60 * 1000;

// Server → Client: must be serializable (NO functions)
const DEFAULT_MONEY_FORMAT = Object.freeze({
  locale: "en-BD",
  currency: "BDT",
  maximumFractionDigits: 2,
});

function clampDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 30;
  return Math.max(7, Math.min(365, Math.round(x)));
}

function clampTzOffsetMinutes(v, fallback = 360) {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  // sanity clamp between UTC-12 and UTC+14
  return Math.max(-720, Math.min(840, Math.round(x)));
}

function dayKeyFromOffset(dt, tzOffsetMinutes) {
  const ms = new Date(dt).getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function startOfLocalDayUtc(now, tzOffsetMinutes) {
  const ms = now.getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - tzOffsetMinutes * 60 * 1000);
}

/**
 * Interpret YYYY-MM-DD as "local date" (based on tzOffsetMinutes)
 * and return the UTC instant for local midnight.
 */
function parseYYYYMMDDLocal(v, tzOffsetMinutes) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [yy, mm, dd] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;

  // UTC midnight of that date, then shift back by offset to get local midnight in UTC
  const utcMidnight = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
  return new Date(utcMidnight - tzOffsetMinutes * 60 * 1000);
}

function computeWindow({ days, start, end, tzOffsetMinutes }) {
  const startLocal = parseYYYYMMDDLocal(start, tzOffsetMinutes);
  const endLocal = parseYYYYMMDDLocal(end, tzOffsetMinutes);

  // Range mode: inclusive end date, but return an exclusive upper bound for safe querying
  if (startLocal && endLocal) {
    const untilExclusive = new Date(endLocal.getTime() + DAY); // next local midnight
    const windowDays = clampDays(Math.round((untilExclusive - startLocal) / DAY));
    return {
      mode: "range",
      from: startLocal,
      untilExclusive,
      windowDays,
      startISO: startLocal.toISOString(),
      endISO: new Date(untilExclusive.getTime() - 1).toISOString(), // inclusive display
    };
  }

  // Rolling mode anchored to local day boundaries (Dhaka-correct)
  const safeDays = clampDays(days);
  const now = new Date();
  const todayLocalStartUtc = startOfLocalDayUtc(now, tzOffsetMinutes);
  const from = new Date(todayLocalStartUtc.getTime() - (safeDays - 1) * DAY);
  const untilExclusive = new Date(todayLocalStartUtc.getTime() + DAY); // include today
  return {
    mode: "days",
    from,
    untilExclusive,
    windowDays: safeDays,
    startISO: from.toISOString(),
    endISO: new Date(untilExclusive.getTime() - 1).toISOString(),
  };
}

async function safeGroupByCount({ model, by, where }) {
  try {
    if (!model?.groupBy) return [];
    const rows = await model.groupBy({
      by: [by],
      where,
      _count: { _all: true },
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function normalizeBreakdown(rows, keyName) {
  const out = {};
  for (const r of rows || []) {
    const k = String(r?.[keyName] ?? "UNKNOWN");
    out[k] = Number(r?._count?._all ?? 0);
  }
  return out;
}

function isPaidLike(paymentStatus) {
  const ps = String(paymentStatus || "").toUpperCase();
  return ps === "PAID" || ps === "SETTLED" || ps === "CAPTURED" || ps === "SUCCEEDED";
}

/* ───────────────────────── RBAC (Admin-decoupled) ───────────────────────── */

function normKey(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeRoleNames(names) {
  const out = [];
  const seen = new Set();
  for (const n of names || []) {
    const v = String(n || "").trim();
    if (!v) continue;
    const k = normKey(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function normalizePerms(perms) {
  const out = [];
  const seen = new Set();
  for (const p of perms || []) {
    const v = String(p || "").trim();
    if (!v) continue;
    const k = normKey(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function toPermArray(maybe) {
  if (!maybe) return [];
  if (Array.isArray(maybe)) return maybe.map(String);
  if (typeof maybe === "string") {
    return maybe
      .split(/[, \n\r\t]+/)
      .map((x) => String(x).trim())
      .filter(Boolean);
  }
  return [];
}

function pickFirstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * STRICT ADMIN DECOUPLING:
 * - Accept ONLY admin-plane cookies (tdlc_a_*, __Secure-tdlc_a_*, __Host-tdlc_a_*) OR explicit legacy admin cookies.
 * - Do NOT import shared auth modules here (prevents customer-auth side effects).
 * - Optionally fetch admin session from /api/admin/session (admin-only route).
 */

function hasAdminPlaneCookie(all) {
  return (all || []).some((c) => {
    const n = String(c?.name || "");
    return (
      n.startsWith("tdlc_a_") ||
      n.startsWith("__Secure-tdlc_a_") ||
      n.startsWith("__Host-tdlc_a_")
    );
  });
}

function pickAdminRoleCookie(jar) {
  return (
    jar.get("admin_role")?.value ||
    jar.get("tdlc_admin_role")?.value ||
    jar.get("adminRole")?.value ||
    jar.get("tdlc_a_role")?.value ||
    jar.get("__Secure-tdlc_a_role")?.value ||
    jar.get("__Host-tdlc_a_role")?.value ||
    ""
  );
}

function pickAdminSessionCookie(jar) {
  return (
    jar.get("admin_session")?.value ||
    jar.get("tdlc_admin_session")?.value ||
    jar.get("admin_sid")?.value ||
    jar.get("tdlc_a_session")?.value ||
    jar.get("__Secure-tdlc_a_session")?.value ||
    jar.get("__Host-tdlc_a_session")?.value ||
    jar.get("tdlc_a_sid")?.value ||
    jar.get("__Secure-tdlc_a_sid")?.value ||
    jar.get("__Host-tdlc_a_sid")?.value ||
    ""
  );
}

function buildCookieHeaderFromJar(jar) {
  try {
    const all = typeof jar.getAll === "function" ? jar.getAll() : [];
    const pairs = [];
    for (const c of all) {
      if (!c?.name) continue;
      pairs.push(`${c.name}=${c.value ?? ""}`);
    }
    return pairs.join("; ");
  } catch {
    return "";
  }
}

function getBaseUrlFromHeaders(h) {
  const proto =
    h.get("x-forwarded-proto") || (process.env.VERCEL_URL ? "https" : "http") || "http";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  if (!host) return "";
  return `${proto}://${host}`;
}

/**
 * Normalize /api/admin/session responses.
 * Supports:
 *  A) Envelope: { session, user, roles, permissions, ... }
 *  B) Session-only: { scope, user, roles, permissions, ... } or { session: { user, ... } }
 */
function normalizeAdminSessionPayload(data) {
  if (!data || typeof data !== "object") return null;

  const envelope = data;
  const innerSession = (data && typeof data.session === "object" && data.session) || null;

  if (data.authenticated === false) return null;

  const user =
    envelope.user ||
    innerSession?.user ||
    envelope.sessionUser ||
    envelope.admin?.user ||
    null;

  const roles =
    envelope.roles ||
    innerSession?.roles ||
    user?.roles ||
    envelope.roleAssignments?.map?.((r) => r?.role?.name || r?.roleName).filter(Boolean) ||
    [];

  const permissions =
    envelope.permissions ||
    innerSession?.permissions ||
    user?.permissions ||
    envelope.permissionKeys ||
    innerSession?.permissionKeys ||
    [];

  const scope =
    innerSession?.scope ||
    envelope.scope ||
    envelope.plane ||
    envelope.sessionScope ||
    user?.scope ||
    user?.plane ||
    "";

  return {
    ...(innerSession || {}),
    ...(envelope || {}),
    scope,
    user,
    roles: Array.isArray(roles) ? roles : toPermArray(roles),
    permissions: Array.isArray(permissions) ? permissions : toPermArray(permissions),
  };
}

async function tryFetchAdminSession({ jar, debug }) {
  try {
    const h = await headers();
    const base = getBaseUrlFromHeaders(h);
    if (!base) return null;

    const cookieHeader = buildCookieHeaderFromJar(jar);
    const res = await fetch(`${base}/api/admin/session`, {
      method: "GET",
      cache: "no-store",
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });

    if (!res.ok) {
      if (debug) console.log("[admin/analytics] /api/admin/session not ok:", res.status);
      return null;
    }

    const data = await res.json().catch(() => null);
    const session = normalizeAdminSessionPayload(data);
    if (!session) return null;

    // Enforce admin scope to avoid accidental coupling.
    const scopeRaw =
      session?.scope ||
      session?.user?.scope ||
      session?.plane ||
      session?.user?.plane ||
      "";
    const scope = String(scopeRaw || "").toLowerCase();

    const isAdminScoped =
      scope === "admin" ||
      session?.isAdmin === true ||
      session?.admin === true ||
      session?.capabilities?.isAdmin === true ||
      session?.capabilities?.isSuperadmin === true;

    if (!isAdminScoped) {
      if (debug) console.log("[admin/analytics] session present but not admin-scoped");
      return null;
    }

    return session;
  } catch (e) {
    if (debug) console.log("[admin/analytics] session fetch error:", String(e?.message || e));
    return null;
  }
}

async function resolveAdminUserFromCookies(jar) {
  const directId =
    jar.get("admin_user_id")?.value ||
    jar.get("tdlc_admin_user_id")?.value ||
    jar.get("adminUserId")?.value ||
    jar.get("tdlc_a_uid")?.value ||
    jar.get("__Secure-tdlc_a_uid")?.value ||
    jar.get("__Host-tdlc_a_uid")?.value ||
    "";

  if (directId) {
    const u = await prisma.user
      .findUnique({
        where: { id: String(directId) },
        select: { id: true, email: true, phone: true, name: true },
      })
      .catch(() => null);
    if (u?.id) return u;
  }

  const email =
    (jar.get("admin_email")?.value ||
      jar.get("tdlc_admin_email")?.value ||
      jar.get("adminEmail")?.value ||
      jar.get("tdlc_a_email")?.value ||
      jar.get("__Secure-tdlc_a_email")?.value ||
      jar.get("__Host-tdlc_a_email")?.value ||
      "")
      .trim()
      .toLowerCase();

  const phone =
    (jar.get("admin_phone")?.value ||
      jar.get("tdlc_admin_phone")?.value ||
      jar.get("adminPhone")?.value ||
      jar.get("tdlc_a_phone")?.value ||
      jar.get("__Secure-tdlc_a_phone")?.value ||
      jar.get("__Host-tdlc_a_phone")?.value ||
      "").trim();

  if (email || phone) {
    const u = await prisma.user
      .findFirst({
        where: {
          OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean),
        },
        select: { id: true, email: true, phone: true, name: true },
      })
      .catch(() => null);
    if (u?.id) return u;
  }

  return null;
}

async function resolveAdminUserFromSessionOrCookies({ jar, adminSession, debug }) {
  const sessionUser = adminSession?.user || null;

  const sid = String(sessionUser?.id || "").trim();
  const semail = String(sessionUser?.email || "").trim().toLowerCase();
  const sphone = String(sessionUser?.phone || sessionUser?.mobile || "").trim();

  if (sid) {
    const u = await prisma.user
      .findUnique({
        where: { id: sid },
        select: { id: true, email: true, phone: true, name: true },
      })
      .catch(() => null);
    if (u?.id) return u;

    if (debug) console.log("[admin/analytics] session user id not found in prisma.user:", sid);
    return {
      id: sid,
      email: semail || "",
      phone: sphone || "",
      name: String(sessionUser?.name || "").trim(),
    };
  }

  if (semail || sphone) {
    const u = await prisma.user
      .findFirst({
        where: {
          OR: [semail ? { email: semail } : undefined, sphone ? { phone: sphone } : undefined].filter(
            Boolean
          ),
        },
        select: { id: true, email: true, phone: true, name: true },
      })
      .catch(() => null);
    if (u?.id) return u;

    if (debug)
      console.log("[admin/analytics] session email/phone not found in prisma.user:", semail || sphone);
    return {
      id: "",
      email: semail || "",
      phone: sphone || "",
      name: String(sessionUser?.name || "").trim(),
    };
  }

  return await resolveAdminUserFromCookies(jar).catch(() => null);
}

function pickUserRoleModel() {
  return (
    prisma.userRole ||
    prisma.rbacUserRole ||
    prisma.adminUserRole ||
    prisma.user_role ||
    prisma.userRoles ||
    prisma.rbacUserRoles ||
    prisma.adminUserRoles ||
    null
  );
}

async function loadRolesAndPermsFromDbByUserId(userId) {
  if (!userId) return { roles: [], permissions: [] };

  const ur = pickUserRoleModel();
  if (!ur?.findMany) return { roles: [], permissions: [] };

  const roleRelCandidates = ["role", "adminRole", "rbacRole", "Role", "AdminRole", "RbacRole"];

  for (const rel of roleRelCandidates) {
    try {
      const rows = await ur.findMany({
        where: { userId: String(userId) },
        include: { [rel]: true },
      });

      const roles = [];
      const permissions = [];

      for (const r of rows || []) {
        const roleObj = r?.[rel] || null;
        if (!roleObj) continue;

        const roleName =
          pickFirstString(roleObj, ["name", "code", "slug", "key"]) ||
          String(roleObj?.id || "").trim();

        if (roleName) roles.push(roleName);

        const permsRaw =
          roleObj?.permissions ??
          roleObj?.permission ??
          roleObj?.permissionKeys ??
          roleObj?.permissionList;

        for (const p of toPermArray(permsRaw)) permissions.push(p);
      }

      return {
        roles: normalizeRoleNames(roles),
        permissions: normalizePerms(permissions),
      };
    } catch {
      // try next relation name
    }
  }

  return { roles: [], permissions: [] };
}

function extractRolesFromSession(session) {
  const roles = [];

  if (Array.isArray(session?.roles)) roles.push(...session.roles);
  if (Array.isArray(session?.user?.roles)) roles.push(...session.user.roles);

  const single =
    session?.role ||
    session?.user?.role ||
    session?.adminRole ||
    session?.user?.adminRole ||
    session?.rbacRole ||
    session?.user?.rbacRole;

  if (single) roles.push(String(single));

  return normalizeRoleNames(roles);
}

function extractPermsFromSession(session) {
  const perms = [];
  if (Array.isArray(session?.permissions)) perms.push(...session.permissions);
  if (Array.isArray(session?.user?.permissions)) perms.push(...session.user.permissions);

  const maybe =
    session?.permissionKeys ||
    session?.user?.permissionKeys ||
    session?.permissionList ||
    session?.user?.permissionList;

  perms.push(...toPermArray(maybe));
  return normalizePerms(perms);
}

function isSuperRole(role) {
  const k = normKey(role);
  return (
    k === "superadmin" ||
    k === "owner" ||
    k === "root" ||
    k.includes("superadmin") ||
    k.includes("owner") ||
    k.includes("root")
  );
}

function canViewAnalyticsDBAware({ user, roles, permissions }) {
  const rolesLower = new Set((roles || []).map((r) => normKey(r)));
  const permsLower = new Set((permissions || []).map((p) => normKey(p)));

  for (const r of rolesLower) {
    if (r === "superadmin" || r === "owner" || r === "root") return true;
    if (r.includes("superadmin") || r.includes("owner") || r.includes("root")) return true;
  }

  if (permsLower.has(normKey(Permissions.VIEW_ANALYTICS)) || permsLower.has("viewanalytics"))
    return true;

  try {
    const enriched = { ...(user || {}), roles, permissions };
    if (hasPermission(enriched, Permissions.VIEW_ANALYTICS)) return true;
  } catch {
    // ignore
  }

  const allow = new Set(["admin", "manager", "finance", "analyst"]);
  for (const r of rolesLower) {
    if (allow.has(r)) return true;
    if (r.includes("admin") && !r.includes("customer")) return true;
    if (r.includes("manager")) return true;
    if (r.includes("finance")) return true;
    if (r.includes("analyst")) return true;
  }

  return false;
}

function denyView({ debugInfo }) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
      <p className="mt-2 text-sm text-red-600">
        You do not have permission to view analytics (VIEW_ANALYTICS required).
      </p>

      {debugInfo ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">Debug</div>
          <pre className="mt-2 whitespace-pre-wrap break-words">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

async function loadOverview({ from, untilExclusive }) {
  const whereWindow = { createdAt: { gte: from, lt: untilExclusive } };

  const [
    ordersInWindow,
    paidAgg,
    totalCustomers,
    newCustomers,
    returnsCount,
    statusBreakdown,
    paymentBreakdown,
    fulfillmentBreakdown,
  ] = await Promise.all([
    prisma.order.count({ where: whereWindow }).catch(() => 0),
    prisma.order
      .aggregate({
        where: {
          ...whereWindow,
          paymentStatus: { in: ["PAID", "SETTLED", "CAPTURED", "SUCCEEDED"] },
        },
        _sum: { grandTotal: true },
        _count: { _all: true },
      })
      .catch(() => ({ _sum: { grandTotal: 0 }, _count: { _all: 0 } })),
    prisma.user.count().catch(() => 0),
    prisma.user.count({ where: whereWindow }).catch(() => 0),
    prisma.returnRequest?.count?.({ where: whereWindow }).catch(() => 0),
    safeGroupByCount({ model: prisma.order, by: "status", where: whereWindow }),
    safeGroupByCount({ model: prisma.order, by: "paymentStatus", where: whereWindow }),
    safeGroupByCount({ model: prisma.order, by: "fulfillmentStatus", where: whereWindow }),
  ]);

  const revenuePaid = Number(paidAgg?._sum?.grandTotal ?? 0);
  const paidOrdersCount = Number(paidAgg?._count?._all ?? 0);

  const aov = paidOrdersCount > 0 ? Math.round((revenuePaid / paidOrdersCount) * 100) / 100 : 0;
  const paidRate =
    ordersInWindow > 0 ? Math.round((paidOrdersCount / ordersInWindow) * 1000) / 10 : 0;

  const [channelBreakdown, sourceBreakdown, currencyBreakdown, fraudBreakdown] = await Promise.all([
    safeGroupByCount({ model: prisma.order, by: "channel", where: whereWindow }),
    safeGroupByCount({ model: prisma.order, by: "source", where: whereWindow }),
    safeGroupByCount({ model: prisma.order, by: "currency", where: whereWindow }),
    safeGroupByCount({ model: prisma.order, by: "fraudStatus", where: whereWindow }),
  ]);

  const refundsCount = await prisma.refund?.count?.({ where: whereWindow }).catch(() => 0);

  return {
    windowDays: null, // set by caller
    sinceISO: from.toISOString(),
    untilISO: new Date(untilExclusive.getTime() - 1).toISOString(),
    kpis: {
      revenuePaid,
      paidOrdersCount,
      ordersCount: ordersInWindow,
      paidRate,
      aov,
      totalCustomers,
      newCustomers,
      returnsCount: Number(returnsCount ?? 0),
      refundsCount: Number(refundsCount ?? 0),
    },
    breakdowns: {
      status: normalizeBreakdown(statusBreakdown, "status"),
      payment: normalizeBreakdown(paymentBreakdown, "paymentStatus"),
      fulfillment: normalizeBreakdown(fulfillmentBreakdown, "fulfillmentStatus"),
      channel: normalizeBreakdown(channelBreakdown, "channel"),
      source: normalizeBreakdown(sourceBreakdown, "source"),
      currency: normalizeBreakdown(currencyBreakdown, "currency"),
      fraud: normalizeBreakdown(fraudBreakdown, "fraudStatus"),
    },
    meta: {
      hasOptionalBreakdowns:
        (channelBreakdown?.length || 0) +
          (sourceBreakdown?.length || 0) +
          (currencyBreakdown?.length || 0) +
          (fraudBreakdown?.length || 0) >
        0,
    },
  };
}

async function loadTimeseries({ from, untilExclusive, windowDays, tzOffsetMinutes }) {
  const dayKeys = [];
  for (let i = 0; i < windowDays; i += 1) {
    dayKeys.push(dayKeyFromOffset(from.getTime() + i * DAY, tzOffsetMinutes));
  }

  const whereWindow = { createdAt: { gte: from, lt: untilExclusive } };

  const orders = await prisma.order.findMany({
    where: whereWindow,
    select: {
      createdAt: true,
      grandTotal: true,
      paymentStatus: true,
      status: true,
      fulfillmentStatus: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const map = new Map();
  for (const o of orders) {
    const k = dayKeyFromOffset(o.createdAt, tzOffsetMinutes);
    if (!map.has(k)) {
      map.set(k, {
        day: k,
        orders: 0,
        revenuePaid: 0,
        revenueGross: 0,
        paidOrders: 0,
        failedPayments: 0,
        cancelled: 0,
        fulfilled: 0,
      });
    }
    const row = map.get(k);
    row.orders += 1;
    row.revenueGross += Number(o.grandTotal ?? 0);

    if (isPaidLike(o.paymentStatus)) {
      row.revenuePaid += Number(o.grandTotal ?? 0);
      row.paidOrders += 1;
    } else if (String(o.paymentStatus || "").toUpperCase() === "FAILED") {
      row.failedPayments += 1;
    }

    if (String(o.status || "").toUpperCase() === "CANCELLED") row.cancelled += 1;
    if (String(o.fulfillmentStatus || "").toUpperCase() === "FULFILLED") row.fulfilled += 1;
  }

  return dayKeys.map((day) => {
    const v =
      map.get(day) || {
        day,
        orders: 0,
        revenuePaid: 0,
        revenueGross: 0,
        paidOrders: 0,
        failedPayments: 0,
        cancelled: 0,
        fulfilled: 0,
      };

    const paidRate = v.orders > 0 ? Math.round((v.paidOrders / v.orders) * 1000) / 10 : 0;
    const aovPaid = v.paidOrders > 0 ? Math.round((v.revenuePaid / v.paidOrders) * 100) / 100 : 0;

    return {
      day: v.day,
      orders: v.orders,
      revenuePaid: Math.round(v.revenuePaid * 100) / 100,
      revenueGross: Math.round(v.revenueGross * 100) / 100,
      paidOrders: v.paidOrders,
      failedPayments: v.failedPayments,
      cancelled: v.cancelled,
      fulfilled: v.fulfilled,
      paidRate,
      aovPaid,
    };
  });
}

async function unwrapSearchParams(searchParams) {
  try {
    if (searchParams && typeof searchParams.then === "function") {
      const resolved = await searchParams;
      return resolved || {};
    }
  } catch {
    // ignore and fall through
  }
  return searchParams || {};
}

function parseSuperadminEmailsEnv() {
  const raw = String(process.env.SUPERADMIN_EMAILS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
}

function buildClientActivationDefaults() {
  // These are SAFE defaults; the client can ignore them if it has different shapes.
  return {
    initialInclude: "all",
    initialTabsMode: "all",
    initialStrict: false,
    initialParallel: true,
    initialModulePrefs: [
      "overview",
      "timeseries",
      "orders",
      "products",
      "customers",
      "otp",
      "returns",
      "staff",
      "inventory",
      "profit",
      "pnl",
      "projections",
      "report",
    ],
  };
}

export default async function AnalyticsPage({ searchParams }) {
  const jar = await cookies();
  const debug = String(jar.get("admin_debug")?.value || "") === "1";

  const allCookies = typeof jar.getAll === "function" ? jar.getAll() : [];
  const hasAdminPlane = hasAdminPlaneCookie(allCookies);

  // Legacy explicit admin cookies (keep compatible)
  const adminRoleCookie = String(pickAdminRoleCookie(jar) || "").trim();
  const adminSessionCookie = String(pickAdminSessionCookie(jar) || "").trim();

  // Admin-only session (NO shared auth import here)
  const adminSession = await tryFetchAdminSession({ jar, debug });

  // Hard gate: must have admin-plane signal OR explicit admin cookies OR a valid admin session
  if (!adminSession && !hasAdminPlane && !adminRoleCookie && !adminSessionCookie) {
    return denyView({
      debugInfo: debug
        ? {
            reason: "no_admin_plane_signal",
            hasAdminPlane,
            adminRoleCookie: adminRoleCookie || null,
            adminSessionCookie: adminSessionCookie ? "present" : null,
          }
        : null,
    });
  }

  const adminUser = await resolveAdminUserFromSessionOrCookies({ jar, adminSession, debug });

  // Roles/perms: prefer session, else DB lookup
  const sessionRoles = extractRolesFromSession(adminSession);
  const sessionPerms = extractPermsFromSession(adminSession);

  const db = await loadRolesAndPermsFromDbByUserId(String(adminUser?.id || ""));

  const mergedRoles = normalizeRoleNames([
    ...(db.roles || []),
    ...(sessionRoles || []),
    ...(adminRoleCookie ? [adminRoleCookie] : []),
  ]);

  const mergedPerms = normalizePerms([...(db.permissions || []), ...(sessionPerms || [])]);

  const superadminEmails = parseSuperadminEmailsEnv();
  const emailLower = String(adminUser?.email || "").trim().toLowerCase();
  const isEnvSuperadmin = emailLower && superadminEmails.includes(emailLower);

  const isCookieSuperadmin = adminRoleCookie ? isSuperRole(adminRoleCookie) : false;
  const isSessionSuperadmin =
    mergedRoles.some((r) => isSuperRole(r)) ||
    adminSession?.capabilities?.isSuperadmin === true ||
    adminSession?.capabilities?.superadmin === true;

  const canView =
    isEnvSuperadmin ||
    isCookieSuperadmin ||
    isSessionSuperadmin ||
    canViewAnalyticsDBAware({
      user: adminUser || { id: "", email: "", name: "" },
      roles: mergedRoles,
      permissions: mergedPerms,
    }) === true;

  if (!canView) {
    return denyView({
      debugInfo: debug
        ? {
            reason: "rbac_denied",
            hasAdminPlane,
            adminRoleCookie: adminRoleCookie || null,
            adminSessionCookie: adminSessionCookie ? "present" : null,
            sessionScope: adminSession?.scope || adminSession?.plane || null,
            sessionUser: adminSession?.user?.id || adminSession?.user?.email || null,
            resolvedUserId: adminUser?.id || null,
            roles: mergedRoles,
            permissions: mergedPerms,
            isEnvSuperadmin,
            isCookieSuperadmin,
            isSessionSuperadmin,
          }
        : null,
    });
  }

  const sp = await unwrapSearchParams(searchParams);
  const tzOffsetMinutes = clampTzOffsetMinutes(sp?.tzOffsetMinutes, 360);

  const window = computeWindow({
    days: sp?.days ?? 30,
    start: sp?.start,
    end: sp?.end,
    tzOffsetMinutes,
  });

  const days = window.windowDays;

  const [overviewRaw, series] = await Promise.all([
    loadOverview({ from: window.from, untilExclusive: window.untilExclusive }),
    loadTimeseries({
      from: window.from,
      untilExclusive: window.untilExclusive,
      windowDays: days,
      tzOffsetMinutes,
    }),
  ]);

  const overview = {
    ...overviewRaw,
    windowDays: days,
    range: {
      mode: window.mode,
      from: window.startISO,
      to: window.endISO,
      days,
      tzOffsetMinutes,
    },
    admin: {
      role: mergedRoles?.[0] || adminRoleCookie || null,
      roles: mergedRoles,
      permissions: mergedPerms,
      userId: adminUser?.id || null,
      name: adminUser?.name || null,
      email: adminUser?.email || null,
    },
    flags: {
      includeAllSuggested: true,
      adminPlane: true,
    },
  };

  const activationDefaults = buildClientActivationDefaults();

  return (
    <AnalyticsClient
      initialDays={days}
      initialOverview={overview}
      initialSeries={series}
      moneyFormat={DEFAULT_MONEY_FORMAT}
      {...activationDefaults}
    />
  );
}
