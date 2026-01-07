// FILE: app/api/health/queue/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * RBAC-gated health/queue actions
 * - POST { action: "rerun" | "drain" | "retry", queue?: "default" | string }
 * - Uses optional "@/lib/queue" helpers if present; returns 503 if queue not configured.
 * - IMPORTANT: Do RBAC in your middleware or in this handler (example included).
 */

async function getPermissions() {
  // Pull from /api/admin/session to avoid duplicating auth logic
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/admin/session`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) return [];
    return j?.user?.permissions || [];
  } catch {
    return [];
  }
}

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { action, queue = "default" } = body || {};
  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  // RBAC: MANAGE_SETTINGS required
  const perms = await getPermissions();
  if (!Array.isArray(perms) || !perms.includes("MANAGE_SETTINGS")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let q;
  try {
    const mod = await import("@/lib/queue");
    q = mod.default || mod;
  } catch (e) {
    return NextResponse.json({ error: "queue not configured", detail: String(e) }, { status: 503 });
  }

  try {
    if (action === "rerun") {
      const res = (await q?.rerunHealth?.()) || { ok: true };
      return NextResponse.json(res);
    }
    if (action === "drain") {
      const res = (await q?.drain?.(queue)) || { ok: true };
      return NextResponse.json(res);
    }
    if (action === "retry") {
      const res = (await q?.retry?.(queue)) || { ok: true };
      return NextResponse.json(res);
    }
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "queue action failed", detail: String(e) }, { status: 500 });
  }
}
