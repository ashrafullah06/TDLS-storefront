// FILE: app/api/admin/analytics/funnel/route.js
// Prisma + Strapi + graceful fallback (keeps your current logic/shape)
// Admin-only mount: /api/admin/analytics/funnel
import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma"; // default import avoids named-export issues

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 365;

// ---------- helpers ----------
const clampInt = (v, min, max, fallback) => {
  const x = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
};

const clampOffsetMinutes = (v, fallback = 360) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  // UTC-12..UTC+14
  return Math.max(-720, Math.min(840, Math.round(x)));
};

const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());

/**
 * Deterministic date parsing with tzOffsetMinutes (Dhaka default 360):
 * - If YYYY-MM-DD: interpret as local day boundary at tzOffsetMinutes.
 * - Else: Date.parse() normal.
 */
const parseDateFlex = (s, fallback, tzOffsetMinutes, { isEnd = false } = {}) => {
  if (!s) return fallback;
  const raw = String(s).trim();
  if (!raw) return fallback;

  if (isDateOnly(raw)) {
    // base midnight UTC
    const base = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(base.getTime())) return fallback;

    // convert "local midnight" to UTC by subtracting offset
    const localMidnightUtc = new Date(base.getTime() - tzOffsetMinutes * 60 * 1000);
    if (!isEnd) return localMidnightUtc;
    return new Date(localMidnightUtc.getTime() + DAY - 1);
  }

  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : fallback;
};

const toISODateWithOffset = (d, tzOffsetMinutes) => {
  const ms = new Date(d).getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const x = new Date(shifted);
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  const da = String(x.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

function jsonNoStore(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

// Admin-only guard (NO dependency on customer auth)
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

  const ok = Boolean(adminRole || adminSession);
  return { ok, role: adminRole || null };
}

const safeCount = async (model, args, fallback = 0) => {
  try {
    if (!model?.count) return fallback;
    return await model.count(args);
  } catch {
    return fallback;
  }
};

const safeAggregate = async (model, args, fallback = null) => {
  try {
    if (!model?.aggregate) return fallback;
    return await model.aggregate(args);
  } catch {
    return fallback;
  }
};

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
  const tzOffsetMinutes = clampOffsetMinutes(searchParams.get("tzOffsetMinutes"), 360);

  // Support: start/end OR days
  const days = clampInt(searchParams.get("days"), 1, MAX_DAYS, 7);

  const endFallback = new Date();
  const startFallback = new Date(Date.now() - (days - 1) * DAY);

  const start = parseDateFlex(searchParams.get("start"), startFallback, tzOffsetMinutes, { isEnd: false });
  const end = parseDateFlex(searchParams.get("end"), endFallback, tzOffsetMinutes, { isEnd: true });

  // Ensure ordering + clamp span
  let startFinal = start;
  let endFinal = end;
  if (startFinal > endFinal) {
    const tmp = startFinal;
    startFinal = endFinal;
    endFinal = tmp;
  }
  const spanDays = Math.max(1, Math.ceil((endFinal.getTime() - startFinal.getTime() + 1) / DAY));
  if (spanDays > MAX_DAYS) {
    endFinal = new Date(startFinal.getTime() + MAX_DAYS * DAY - 1);
  }

  const prismaWindow = { gte: startFinal, lte: endFinal };

  // Base payload (preserved)
  const result = {
    source: "fallback",
    start: toISODateWithOffset(startFinal, tzOffsetMinutes),
    end: toISODateWithOffset(endFinal, tzOffsetMinutes),
    days: Math.max(1, Math.ceil((endFinal.getTime() - startFinal.getTime() + 1) / DAY)),
    totals: {
      visitors: 0,
      signups: 0,
      carts: 0,
      orders: 0,
      revenue: 0,
      conversionRate: 0,
      avgOrderValue: 0,
      otpSent: 0,
      otpVerified: 0,
      accounts: 0,
    },
    funnel: [],
    series: [],
    breakdown: { byChannel: [], byDevice: [], byLocation: [] },
    adminRole: gate.role,
  };

  const t0 = Date.now();

  /* 1) PRISMA — site DB */
  try {
    // Visits / signup clicks (best-effort)
    const visits = await safeCount(
      prisma.auditLog,
      {
        where: {
          createdAt: prismaWindow,
          type: { in: ["visit_signup_page", "signup_page_view"] },
        },
      },
      0
    );

    const pressedSignup = await safeCount(
      prisma.auditLog,
      {
        where: {
          createdAt: prismaWindow,
          type: { in: ["click_signup", "pressed_signup"] },
        },
      },
      0
    );

    // OTP sent / verified
    const otpSent = await safeCount(prisma.otpCode, { where: { createdAt: prismaWindow } }, 0);

    const otpVerified = await safeCount(
      prisma.otpCode,
      { where: { createdAt: prismaWindow, verifiedAt: { not: null } } },
      0
    );

    // Accounts
    const accountsFromUsers = await safeCount(prisma.user, { where: { createdAt: prismaWindow } }, 0);

    const accountsFromLog = await safeCount(
      prisma.auditLog,
      {
        where: {
          createdAt: prismaWindow,
          type: { in: ["account_created", "signup_completed"] },
        },
      },
      0
    );

    // Orders + revenue (schema-safe: try multiple field patterns)
    let orders = 0;
    let revenue = 0;

    // Prefer paymentStatus + grandTotal (matches your other admin analytics routes)
    // Fallback to status + totalAmount for older schemas
    // All wrapped so it never breaks.
    try {
      orders = await prisma.order.count({
        where: {
          createdAt: prismaWindow,
          paymentStatus: { in: ["PAID", "SETTLED", "CAPTURED", "SUCCEEDED"] },
        },
      });

      const sum = await prisma.order.aggregate({
        where: {
          createdAt: prismaWindow,
          paymentStatus: { in: ["PAID", "SETTLED", "CAPTURED", "SUCCEEDED"] },
        },
        _sum: { grandTotal: true },
      });

      revenue = Number(sum?._sum?.grandTotal || 0);
    } catch {
      try {
        orders = await prisma.order.count({
          where: {
            createdAt: prismaWindow,
            status: { in: ["paid", "completed", "fulfilled"] },
          },
        });

        const sum = await prisma.order.aggregate({
          where: {
            createdAt: prismaWindow,
            status: { in: ["paid", "completed", "fulfilled"] },
          },
          _sum: { totalAmount: true },
        });

        revenue = Number(sum?._sum?.totalAmount || 0);
      } catch {
        // leave 0
      }
    }

    // Carts
    let carts = 0;
    carts = await safeCount(prisma.cart, { where: { createdAt: prismaWindow } }, 0);

    const signups = Math.max(pressedSignup, accountsFromUsers, accountsFromLog);
    const visitors = Math.max(visits, signups);

    const accounts = Math.max(accountsFromUsers, accountsFromLog, otpVerified);
    if (!carts) carts = Math.max(Math.round((orders || accounts) * 1.2), accounts);

    Object.assign(result.totals, {
      visitors,
      signups,
      carts,
      orders: orders || accounts,
      revenue,
      otpSent,
      otpVerified,
      accounts,
    });

    result.source = "prisma";
  } catch {
    // proceed to Strapi gracefully
  }

  /* 2) STRAPI — merge if configured */
  const base = process.env.STRAPI_URL;
  const token = process.env.STRAPI_TOKEN;

  if (base && token) {
    try {
      const headers = { Authorization: `Bearer ${token}` };

      const startISO = toISODateWithOffset(startFinal, tzOffsetMinutes);
      const endISO = toISODateWithOffset(endFinal, tzOffsetMinutes);

      const ordersUrl = `${base}/api/orders?filters[$and][0][createdAt][$gte]=${startISO}&filters[$and][1][createdAt][$lte]=${endISO}&pagination[page]=1&pagination[pageSize]=1`;
      const customersUrl = `${base}/api/customers?filters[$and][0][createdAt][$gte]=${startISO}&filters[$and][1][createdAt][$lte]=${endISO}&pagination[page]=1&pagination[pageSize]=1`;

      const [ordersRes, customersRes] = await Promise.all([
        fetch(ordersUrl, { headers, cache: "no-store" }),
        fetch(customersUrl, { headers, cache: "no-store" }),
      ]);

      const ordersJson = await ordersRes.json().catch(() => ({}));
      const customersJson = await customersRes.json().catch(() => ({}));

      const strapiOrders =
        ordersJson?.meta?.pagination?.total ??
        (Array.isArray(ordersJson) ? ordersJson.length : 0);

      const strapiCustomers = Array.isArray(customersJson)
        ? customersJson.length
        : customersJson?.meta?.pagination?.total ?? 0;

      if (!result.totals.orders && strapiOrders) result.totals.orders = strapiOrders;
      if (!result.totals.signups && strapiCustomers) result.totals.signups = strapiCustomers;
      if (!result.totals.visitors && strapiCustomers) result.totals.visitors = strapiCustomers;

      result.source = result.source === "prisma" ? "prisma+strapi" : "strapi";
    } catch {
      // ignore
    }
  }

  /* 3) Fallback demo (preserved) */
  if (
    !result.totals.visitors &&
    !result.totals.signups &&
    !result.totals.orders &&
    !result.totals.accounts
  ) {
    Object.assign(result.totals, {
      visitors: 120,
      signups: 95,
      otpSent: 90,
      otpVerified: 78,
      accounts: 70,
      carts: 84,
      orders: 70,
      revenue: 0,
    });
    result.source = "fallback";
  }

  /* 4) Derived KPIs + funnel array (preserved) */
  const { visitors, signups, orders, revenue } = result.totals;

  result.totals.conversionRate = signups > 0 ? Number(((orders / signups) * 100).toFixed(2)) : 0;
  result.totals.avgOrderValue = orders > 0 ? Number((revenue / orders).toFixed(2)) : 0;

  result.funnel = [
    { step: "Visited", value: result.totals.visitors },
    { step: "Pressed Signup", value: result.totals.signups },
    { step: "OTP Sent", value: result.totals.otpSent || Math.max(result.totals.signups - 5, 0) },
    {
      step: "OTP Verified",
      value:
        result.totals.otpVerified ||
        Math.max(
          result.totals.orders +
            Math.round((result.totals.signups - result.totals.orders) * 0.2),
          0
        ),
    },
    { step: "Account Created", value: result.totals.accounts || result.totals.orders },
  ];

  // Back-compat
  result.series = result.funnel.map((r) => ({ name: r.step, value: r.value }));

  const t1 = Date.now();
  if (debug) {
    result.debug = {
      perfMs: t1 - t0,
      query: Object.fromEntries(searchParams.entries()),
    };
  }

  return jsonNoStore(result, 200);
}
