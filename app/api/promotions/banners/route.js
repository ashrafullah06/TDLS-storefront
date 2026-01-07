// FILE: app/api/promotions/banners/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

async function canManage() {
  try {
    const r = await fetch("/api/admin/session", { cache: "no-store" });
    const j = await r.json();
    return (j?.user?.permissions || []).some(p => ["MANAGE_COUPONS","MANAGE_SETTINGS"].includes(p));
  } catch { return false; }
}

export async function GET() {
  try {
    const items = await prisma.banner.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: "banners unavailable (model missing)", detail: String(e) }, { status: 503 });
  }
}

export async function POST(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { id, ...data } = body || {};
  try {
    if (id) {
      const x = await prisma.banner.update({ where: { id }, data });
      return NextResponse.json({ ok: true, item: x });
    }
    const x = await prisma.banner.create({ data });
    return NextResponse.json({ ok: true, item: x });
  } catch (e) {
    return NextResponse.json({ error: "banner write failed", detail: String(e) }, { status: 503 });
  }
}

export async function DELETE(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await prisma.banner.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "banner delete failed", detail: String(e) }, { status: 503 });
  }
}
