// FILE: app/api/cms/strapi/rebuild/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

async function canManage() {
  try {
    const j = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json());
    return (j?.user?.permissions || []).includes("MANAGE_CMS");
  } catch { return false; }
}

export async function POST() {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const hook = process.env.STRAPI_REBUILD_WEBHOOK; // e.g., your CI hook or Strapi admin plugin endpoint
  if (!hook) return NextResponse.json({ error: "STRAPI_REBUILD_WEBHOOK missing" }, { status: 503 });

  try {
    const r = await fetch(hook, { method: "POST" });
    return NextResponse.json({ ok: r.ok });
  } catch (e) {
    return NextResponse.json({ error: "rebuild failed", detail: String(e) }, { status: 503 });
  }
}
