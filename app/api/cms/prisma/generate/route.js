// FILE: app/api/cms/prisma/generate/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/** Triggers prisma generate via webhook/worker. */
export async function POST() {
  try {
    const j = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json());
    const perms = j?.user?.permissions || [];
    if (!perms.includes("MANAGE_CMS")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } catch { return NextResponse.json({ error: "forbidden" }, { status: 403 }); }

  const hook = process.env.PRISMA_GENERATE_WEBHOOK;
  if (!hook) return NextResponse.json({ error: "PRISMA_GENERATE_WEBHOOK missing" }, { status: 503 });

  try {
    const r = await fetch(hook, { method: "POST" });
    return NextResponse.json({ ok: r.ok });
  } catch (e) {
    return NextResponse.json({ error: "generate trigger failed", detail: String(e) }, { status: 503 });
  }
}
