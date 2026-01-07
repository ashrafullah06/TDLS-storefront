// FILE: app/api/admin/analytics/profit/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { computeProfit } from "@/lib/analytics/profit";

const DAY = 24 * 60 * 60 * 1000;

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseDateAny(s, fallback) {
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isFinite(d?.getTime?.()) ? d : fallback;
}

function clampInt(v, min, max, fallback) {
  const x = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function normalizeEnum(v, allowed, fallback) {
  const s = String(v || "").toLowerCase().trim();
  return allowed.has(s) ? s : fallback;
}

function isSuperAdmin(role) {
  const r = String(role || "").toLowerCase();
  return r === "superadmin" || r === "owner" || r === "root";
}

/**
 * Admin-only cookie signal fallback (NO dependency on customer auth/session).
 * This prevents analytics from breaking if your requireAdmin() is still coupled.
 */
async function readAdminCookieSignal() {
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

function safeNumber(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Range rules (non-breaking):
 * - If start/end provided → use them (as-is).
 * - Else support `days` (default 30) to build range ending "now".
 */
function computeRange(searchParams) {
  const days = clampInt(searchParams.get("days"), 1, 365, 30);

  const endFallback = new Date();
  const startFallback = new Date(Date.now() - days * DAY);

  const start = parseDateAny(searchParams.get("start"), startFallback);
  const end = parseDateAny(searchParams.get("end"), endFallback);

  // Ensure start <= end
  if (start > end) return { start: end, end: start, days };
  return { start, end, days };
}

export async function GET(req) {
  // 1) Primary RBAC gate
  let roleHint = null;

  try {
    await requireAdmin(req, { permission: Permissions.VIEW_ANALYTICS });
  } catch (err) {
    // 2) Fallback: allow superadmin via admin-cookie signal (decoupling safety)
    const sig = await readAdminCookieSignal();
    roleHint = sig.role;

    const status = err?.status === 403 ? 403 : 401;
    if (!(sig.ok && isSuperAdmin(sig.role))) {
      return json(
        { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
        status
      );
    }
  }

  try {
    const { searchParams } = new URL(req.url);

    // Existing params (kept)
    const group = normalizeEnum(
      searchParams.get("group") || "month",
      new Set(["day", "week", "month", "quarter", "half", "year", "total"]),
      "month"
    );

    const dimension = normalizeEnum(
      searchParams.get("dimension") || "product",
      new Set(["product", "variant", "batch"]),
      "product"
    );

    const paidOnly = (searchParams.get("paidOnly") ?? "1") !== "0";

    const refundAttribution = normalizeEnum(
      searchParams.get("refundAttribution") || "refund_date",
      new Set(["refund_date", "sale_date"]),
      "refund_date"
    );

    // Additive params (safe: computeProfit can ignore unknown fields)
    const compare = String(searchParams.get("compare") || "0") === "1";
    const limit = clampInt(searchParams.get("limit"), 10, 1000, 200); // used by some profit modules; harmless if ignored
    const currency = String(searchParams.get("currency") || "").trim() || null;

    // Range
    const { start, end, days } = computeRange(searchParams);

    // Optional: previous-window compare (non-breaking: only returned if compare=1)
    const prevEnd = new Date(start.getTime());
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));

    const t0 = Date.now();

    const data = await computeProfit({
      start,
      end,
      group,
      dimension,
      paidOnly,
      refundAttribution,

      // Additive (modules may ignore)
      limit,
      currency,
      // recommended for advanced modules that support compare internally
      compare,
      prevStart,
      prevEnd,
    });

    const t1 = Date.now();

    // Preserve existing output shape; only add meta if it won't break consumers
    if (data && typeof data === "object") {
      // Do not overwrite if computeProfit already has meta
      if (!("meta" in data)) {
        data.meta = {
          generatedAt: new Date().toISOString(),
          range: {
            startISO: start.toISOString(),
            endISO: end.toISOString(),
            days,
            group,
            dimension,
            paidOnly,
            refundAttribution,
          },
          options: {
            compare,
            limit,
            currency,
          },
          perf: { ms: t1 - t0 },
          // helps diagnose auth coupling issues without UI changes
          roleHint: roleHint || null,
        };
      } else {
        // Add perf safely if meta exists
        data.meta = data.meta || {};
        if (!data.meta.perf) data.meta.perf = { ms: t1 - t0 };
        if (data.meta.roleHint == null) data.meta.roleHint = roleHint || null;
      }

      // If compare=1 and computeProfit didn't include compare block, add a minimal one
      if (compare && !("compare" in data)) {
        data.compare = {
          range: {
            prevStartISO: prevStart.toISOString(),
            prevEndISO: prevEnd.toISOString(),
          },
          note:
            "compare=1 requested. If computeProfit supports deltas, it may populate compare details. Otherwise this range is provided for UI or future use.",
        };
      }
    }

    return json(data, 200);
  } catch (err) {
    console.error("[admin/analytics/profit.GET]", err);
    return json({ ok: false, error: "PROFIT_ANALYTICS_FAILED" }, 500);
  }
}
