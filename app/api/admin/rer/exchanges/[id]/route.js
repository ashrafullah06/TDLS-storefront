// PATH: app/api/admin/rer/exchanges/[id]/route.js
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function str(v) {
  return String(v ?? "").trim();
}

// Schema enum: REQUESTED -> APPROVED -> FULFILLED/DENIED :contentReference[oaicite:5]{index=5}
const EXCHANGE_TRANSITIONS = {
  approve: { from: ["REQUESTED"], to: "APPROVED" },
  deny: { from: ["REQUESTED"], to: "DENIED" },
  fulfilled: { from: ["APPROVED"], to: "FULFILLED" },
};

export async function GET(req, { params }) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  const id = str(params?.id);
  const item = await prisma.exchangeRequest.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!item) return json({ ok: false, error: "NOT_FOUND" }, 404);
  return json({ ok: true, item }, 200);
}

export async function PATCH(req, { params }) {
  let admin;
  try {
    admin = await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }
  const actorId = admin.user?.id || admin.userId;

  const id = str(params?.id);
  const body = await req.json().catch(() => ({}));
  const action = str(body?.action).toLowerCase();

  const rule = EXCHANGE_TRANSITIONS[action];
  if (!rule) return json({ ok: false, error: "BAD_ACTION" }, 400);

  const existing = await prisma.exchangeRequest.findUnique({
    where: { id },
    select: { id: true, status: true, orderId: true },
  });
  if (!existing) return json({ ok: false, error: "NOT_FOUND" }, 404);

  if (existing.status === rule.to) {
    return json({ ok: true, item: existing, deduped: true }, 200);
  }
  if (!rule.from.includes(existing.status)) {
    return json(
      { ok: false, error: "INVALID_TRANSITION", status: existing.status },
      409
    );
  }

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.exchangeRequest.update({
      where: { id },
      data: { status: rule.to },
    });

    await tx.orderEvent.create({
      data: {
        orderId: existing.orderId,
        kind: "RER_EXCHANGE_STATUS",
        message: `RER_EXCHANGE_STATUS:${rule.to}`,
        metadata: { exchangeId: id, status: rule.to, action },
        actorId: actorId || null,
        actorRole: "admin",
      },
    });

    return updated;
  });

  return json({ ok: true, item }, 200);
}
