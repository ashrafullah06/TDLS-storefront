// FILE: app/api/health/summary/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

function json(body, status = 200) {
  return NextResponse.json(body ?? null, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "x-robots-tag": "noindex, nofollow, noarchive",
      vary: "cookie, authorization",
    },
  });
}

export async function GET(req) {
  // ✅ Admin-only. Hide existence from customers/guests.
  try {
    await requireAdmin(req, { permission: Permissions.VIEW_HEALTH });
  } catch {
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }

  // Proxy to the real admin SSoT summary to avoid duplicate logic
  const origin = new URL(req.url).origin;
  const cookie = req.headers.get("cookie") || "";
  const authorization = req.headers.get("authorization") || "";

  const upstream = await fetch(`${origin}/api/admin/health/summary`, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie,
      ...(authorization ? { authorization } : {}),
      "x-tdlc-scope": "admin",
      "x-tdlc-internal": "1",
    },
  });

  const text = await upstream.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // If upstream returns non-JSON for any reason, do not leak it.
    return json({ ok: false, error: "HEALTH_UNAVAILABLE" }, 503);
  }

  return json(data, upstream.ok ? 200 : upstream.status);
}
