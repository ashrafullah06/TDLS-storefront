// FILE: app/api/cms/strapi/clear-cache/route.js
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
  const url = (process.env.NEXT_PUBLIC_STRAPI_API_URL || process.env.STRAPI_URL || "").replace(/\/+$/, "");
  const token = process.env.STRAPI_ADMIN_TOKEN;
  if (!url || !token) return NextResponse.json({ error: "config missing" }, { status: 503 });

  try {
    const r = await fetch(`${url}/admin/cache/clear`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return NextResponse.json({ ok: r.ok });
  } catch (e) {
    return NextResponse.json({ error: "clear cache failed", detail: String(e) }, { status: 503 });
  }
}
