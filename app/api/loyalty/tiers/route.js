// FILE: app/api/loyalty/tiers/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/** RBAC from /api/admin/session */
async function can(permission) {
  try {
    const r = await fetch("/api/admin/session", { cache: "no-store" });
    const j = await r.json();
    return Array.isArray(j?.user?.permissions) && j.user.permissions.includes(permission);
  } catch { return false; }
}

export async function GET() {
  try {
    const rows = await prisma.loyaltyTier.findMany({
      orderBy: [{ threshold: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ tiers: rows });
  } catch (e) {
    return NextResponse.json({ error: "tiers unavailable", detail: String(e) }, { status: 503 });
  }
}

export async function POST(req) {
  if (!(await can("MANAGE_LOYALTY"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { name, threshold, multiplier = 1, perks = {} } = body || {};
  if (!name || typeof threshold !== "number")
    return NextResponse.json({ error: "name and numeric threshold required" }, { status: 400 });
  try {
    const row = await prisma.loyaltyTier.create({ data: { name, threshold, multiplier, perks } });
    return NextResponse.json({ ok: true, tier: row });
  } catch (e) {
    return NextResponse.json({ error: "create failed", detail: String(e) }, { status: 503 });
  }
}

export async function PATCH(req) {
  if (!(await can("MANAGE_LOYALTY"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { id, ...rest } = body || {};
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const tier = await prisma.loyaltyTier.update({ where: { id }, data: rest });
    return NextResponse.json({ ok: true, tier });
  } catch (e) {
    return NextResponse.json({ error: "update failed", detail: String(e) }, { status: 503 });
  }
}

export async function DELETE(req) {
  if (!(await can("MANAGE_LOYALTY"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await prisma.loyaltyTier.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "delete failed", detail: String(e) }, { status: 503 });
  }
}
