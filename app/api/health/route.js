// FILE: app/api/health/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { runHealthChecks } from "@/lib/health/checks";

function json(data, status = 200) {
  return NextResponse.json(data ?? null, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      // extra hardening
      "x-robots-tag": "noindex, nofollow, noarchive",
      vary: "cookie",
    },
  });
}

export async function GET(req) {
  // Admin-only (hide existence from customers)
  try {
    await requireAdmin(req, { permission: Permissions.VIEW_HEALTH });
  } catch {
    // IMPORTANT: return 404 so customers cannot confirm endpoint exists
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }

  const origin = new URL(req.url).origin;

  try {
    const data = await runHealthChecks({ origin, includeAll: false });
    return json({ ok: true, ...data });
  } catch (e) {
    return json(
      { ok: false, error: "HEALTH_UNAVAILABLE", detail: String(e?.message || e) },
      503
    );
  }
}
