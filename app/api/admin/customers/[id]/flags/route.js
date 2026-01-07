// FILE: app/api/admin/customers/[id]/flags/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function str(v) {
  return String(v ?? "").trim();
}
function int(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : d;
}

export async function POST(req, ctx) {
  try {
    const perms = [Permissions?.MANAGE_CUSTOMERS].filter(Boolean);
    const admin = await requireAdmin(req, perms);

    const params = await ctx.params;
    const id = String(params?.id || "");
    if (!id) return json({ ok: false, error: "Customer id required" }, 400);

    const FLAG = prisma["customerFlagEvent"];
    if (!FLAG) return json({ ok: false, error: "CustomerFlagEvent table/model not available" }, 400);

    const body = await req.json().catch(() => ({}));
    const type = str(body.type) || "NOTE";
    const message = str(body.message);
    const severity = Math.max(0, Math.min(100, int(body.severity, 20)));

    if (!message) return json({ ok: false, error: "Message required" }, 400);

    const row = await FLAG.create({
      data: {
        customerId: id,
        type,
        message,
        severity,
        createdById: admin?.user?.id || null,
      },
    });

    return json({ ok: true, flagEvent: row });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
