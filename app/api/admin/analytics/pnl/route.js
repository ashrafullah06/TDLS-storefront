// FILE: app/api/admin/analytics/pnl/route.js
import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { computePnl } from "@/lib/analytics/pnl";

const DAY = 24 * 60 * 60 * 1000;

const clampGroup = (g) => {
  const v = String(g || "month").toLowerCase().trim();
  // week|month|quarter|half|year|total
  const allowed = new Set(["week", "month", "quarter", "half", "year", "total"]);
  return allowed.has(v) ? v : "month";
};

const clampDays = (v, fallback = 30) => {
  const x = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(1, Math.min(365, x));
};

const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());

/**
 * If "YYYY-MM-DD": interpret as UTC date boundary
 * - start => 00:00:00.000Z
 * - end   => 23:59:59.999Z (inclusive end-of-day)
 *
 * Otherwise: Date(s) normal parse.
 */
function parseDateFlex(s, fallback, { isEnd = false } = {}) {
  if (!s) return fallback;
  const raw = String(s).trim();
  if (!raw) return fallback;

  if (isDateOnly(raw)) {
    const base = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(base.getTime())) return fallback;
    if (!isEnd) return base;
    return new Date(base.getTime() + DAY - 1);
  }

  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

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

  // Strict decoupling: require explicit admin cookie signal.
  const ok = Boolean(adminRole || adminSession);

  return { ok, role: adminRole || null, hasSession: Boolean(adminSession) };
}

function pctChange(curr, prev) {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
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

  const debug = searchParams.get("debug") === "1";
  const compare = searchParams.get("compare") === "1";

  const group = clampGroup(searchParams.get("group"));

  // Range selection:
  // - If start/end provided => use them
  // - Else use days (default 30)
  const days = clampDays(searchParams.get("days"), 30);

  const endFallback = new Date();
  const startFallback = new Date(Date.now() - (days - 1) * DAY);

  const start = parseDateFlex(searchParams.get("start"), startFallback, { isEnd: false });
  const end = parseDateFlex(searchParams.get("end"), endFallback, { isEnd: true });

  // Ensure sane ordering and clamp max span to 365 days
  let startFinal = start;
  let endFinal = end;
  if (startFinal > endFinal) {
    const tmp = startFinal;
    startFinal = endFinal;
    endFinal = tmp;
  }
  const spanDays = Math.max(1, Math.ceil((endFinal.getTime() - startFinal.getTime() + 1) / DAY));
  if (spanDays > 365) {
    // clamp end to start + 365 days - 1ms
    endFinal = new Date(startFinal.getTime() + 365 * DAY - 1);
  }

  try {
    const t0 = Date.now();

    const data = await computePnl({ start: startFinal, end: endFinal, group });

    const t1 = Date.now();

    // Optional compare window (additive; does not change existing UI)
    let compareBlock = null;
    if (compare) {
      const windowMs = endFinal.getTime() - startFinal.getTime() + 1;
      const prevEnd = new Date(startFinal.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - windowMs + 1);

      const prev = await computePnl({ start: prevStart, end: prevEnd, group });

      const currTotals = data?.totals || {};
      const prevTotals = prev?.totals || {};

      compareBlock = {
        range: {
          start: prevStart.toISOString(),
          end: prevEnd.toISOString(),
        },
        totals: prevTotals,
        deltaPct: {
          revenue: pctChange(currTotals?.revenue, prevTotals?.revenue),
          cogs: pctChange(currTotals?.cogs, prevTotals?.cogs),
          profit: pctChange(currTotals?.profit, prevTotals?.profit),
          margin: pctChange(currTotals?.margin, prevTotals?.margin),
        },
      };
    }

    return jsonNoStore(
      {
        ok: true,
        source: "prisma+strapi",
        adminRole: gate.role,
        group,
        start: startFinal.toISOString(),
        end: endFinal.toISOString(),
        ...data,
        ...(compareBlock ? { compare: compareBlock } : {}),
        ...(debug
          ? {
              debug: {
                role: gate.role,
                hasSession: gate.hasSession,
                spanDays: Math.max(1, Math.ceil((endFinal - startFinal + 1) / DAY)),
                perfMs: t1 - t0,
                query: Object.fromEntries(searchParams.entries()),
              },
            }
          : {}),
      },
      200
    );
  } catch (e) {
    return jsonNoStore(
      {
        ok: false,
        source: "prisma+strapi",
        adminRole: gate.role,
        group,
        start: startFinal.toISOString(),
        end: endFinal.toISOString(),
        error: "pnl_failed",
        detail: String(e?.message || e),
        ...(debug ? { stack: String(e?.stack || "") } : {}),
      },
      503
    );
  }
}
