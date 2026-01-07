// FILE: app/api/admin/customers/[id]/crm/route.js
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
function bool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

export async function PUT(req, ctx) {
  try {
    const perms = [Permissions?.MANAGE_CUSTOMERS].filter(Boolean);
    const admin = await requireAdmin(req, perms);

    const params = await ctx.params;
    const id = String(params?.id || "");
    if (!id) return json({ ok: false, error: "Customer id required" }, 400);

    const CRM = prisma["customerCRMProfile"];
    if (!CRM) return json({ ok: false, error: "CustomerCRMProfile table/model not available" }, 400);

    const body = await req.json().catch(() => ({}));

    const safetyLabel = str(body.safetyLabel) || null;
    const isVerified = bool(body.isVerified);
    const codBlocked = bool(body.codBlocked);
    const codBlockReason = str(body.codBlockReason) || null;
    const internalNote = str(body.internalNote) || null;

    // Upsert against customerId = userId (id). This is DB-backed; if your schema maps differently,
    // adjust the where/create keys to match your actual FK.
    const row = await CRM.upsert({
      where: { customerId: id },
      create: {
        customerId: id,
        safetyLabel,
        isVerified,
        verifiedAt: isVerified ? new Date() : null,
        verifiedById: isVerified ? admin?.user?.id || null : null,
        codBlocked,
        codBlockReason,
        internalNote,
      },
      update: {
        safetyLabel,
        isVerified,
        verifiedAt: isVerified ? new Date() : null,
        verifiedById: isVerified ? admin?.user?.id || null : null,
        codBlocked,
        codBlockReason,
        internalNote,
      },
    });

    return json({ ok: true, crmProfile: row });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
