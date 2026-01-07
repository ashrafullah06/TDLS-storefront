// FILE: app/api/settings/users/route.js
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
    const users = await prisma.adminUser.findMany({ include: { roles: true }, orderBy: { email: "asc" } });
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json({ error: "admin users unavailable (model missing)", detail: String(e) }, { status: 503 });
  }
}

/** POST assign roles: { userId, roleIds: [] } */
export async function POST(req) {
  if (!(await canManage())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { userId, roleIds = [] } = body || {};
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  try {
    const user = await prisma.adminUser.update({
      where: { id: userId },
      data: { roles: { set: roleIds.map(id => ({ id })) } },
      include: { roles: true }
    });
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    return NextResponse.json({ error: "assign roles failed", detail: String(e) }, { status: 503 });
  }
}
