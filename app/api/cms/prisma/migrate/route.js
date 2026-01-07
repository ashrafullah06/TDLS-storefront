// FILE: app/api/cms/prisma/migrate/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

async function canManage() {
  try {
    const j = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json());
    return (j?.user?.permissions || []).includes("MANAGE_CMS");
  } catch { return false; }
}

/**
 * Triggers migration via a webhook/worker (cannot run prisma cli in-edge reliably).
 * Requires PRISMA_MIGRATE_WEBHOOK env.
 */
export async function POST() {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const hook = process.env.PRISMA_MIGRATE_WEBHOOK;
  if (!hook) return NextResponse.json({ error: "PRISMA_MIGRATE_WEBHOOK missing" }, { status: 503 });

  try {
    const r = await fetch(hook, { method: "POST" });
    return NextResponse.json({ ok: r.ok });
  } catch (e) {
    return NextResponse.json({ error: "migrate trigger failed", detail: String(e) }, { status: 503 });
  }
}
