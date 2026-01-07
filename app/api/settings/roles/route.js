// FILE: app/api/settings/roles/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

async function canManage() {
  try {
    const j = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json());
    return (j?.user?.permissions || []).includes("MANAGE_SETTINGS");
  } catch { return false; }
}

export async function GET() {
  try {
    const roles = await prisma.role.findMany({ include: { permissions: true }, orderBy: { name: "asc" } });
    return NextResponse.json({ roles });
  } catch (e) {
    return NextResponse.json({ error: "roles unavailable (model missing)", detail: String(e) }, { status: 503 });
  }
}

/** POST upsert role and its permissions; DELETE by id */
export async function POST(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { id, name, permissionKeys = [] } = body || {};
  try {
    if (id) {
      const role = await prisma.role.update({
        where: { id },
        data: {
          name,
          permissions: {
            set: [],
            connect: permissionKeys.map(k => ({ key: k }))
          }
        },
        include: { permissions: true }
      });
      return NextResponse.json({ ok: true, role });
    }
    const role = await prisma.role.create({
      data: {
        name,
        permissions: { connect: permissionKeys.map(k => ({ key: k })) }
      },
      include: { permissions: true }
    });
    return NextResponse.json({ ok: true, role });
  } catch (e) {
    return NextResponse.json({ error: "role write failed", detail: String(e) }, { status: 503 });
  }
}

export async function DELETE(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await prisma.role.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "role delete failed", detail: String(e) }, { status: 503 });
  }
}
