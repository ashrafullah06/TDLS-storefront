// FILE: app/api/cms/strapi/publish/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

async function canManage() {
  try {
    const j = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json());
    return (j?.user?.permissions || []).includes("MANAGE_CMS");
  } catch { return false; }
}

/** POST { contentType, ids?: string[] } */
export async function POST(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { contentType, ids } = body || {};
  const base = (process.env.NEXT_PUBLIC_STRAPI_API_URL || process.env.STRAPI_URL || "").replace(/\/+$/, "");
  const token = process.env.STRAPI_ADMIN_TOKEN;
  if (!base || !token || !contentType) return NextResponse.json({ error: "config missing" }, { status: 503 });

  try {
    // Requires Strapi content-manager permissions
    const path = `${base}/content-manager/collection-types/${encodeURIComponent(contentType)}/actions/publish`;
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ids }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ error: "publish failed", detail: j }, { status: 500 });
    return NextResponse.json({ ok: true, result: j });
  } catch (e) {
    return NextResponse.json({ error: "publish error", detail: String(e) }, { status: 503 });
  }
}
