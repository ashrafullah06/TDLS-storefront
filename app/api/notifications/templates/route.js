// FILE: app/api/notifications/templates/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

async function canManage() {
  try {
    const r = await fetch("/api/admin/session", { cache: "no-store" });
    const j = await r.json();
    return (j?.user?.permissions || []).includes("MANAGE_NOTIFICATIONS");
  } catch { return false; }
}

export async function GET(req) {
  const u = new URL(req.url);
  const channel = u.searchParams.get("channel");
  try {
    const templates = await prisma.notificationTemplate.findMany({
      where: channel ? { channel } : undefined,
      orderBy: [{ channel: "asc" }, { key: "asc" }],
    });
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: "templates unavailable (model missing)", detail: String(e) }, { status: 503 });
  }
}

export async function POST(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { id, ...data } = body || {};

  try {
    if (id) {
      const tpl = await prisma.notificationTemplate.update({ where: { id }, data });
      return NextResponse.json({ ok: true, template: tpl });
    }
    const created = await prisma.notificationTemplate.create({ data });
    return NextResponse.json({ ok: true, template: created });
  } catch (e) {
    return NextResponse.json({ error: "template write failed", detail: String(e) }, { status: 503 });
  }
}

export async function DELETE(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await prisma.notificationTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "template delete failed", detail: String(e) }, { status: 503 });
  }
}
