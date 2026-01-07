// FILE: app/api/customers/notifications/mark-read/route.js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id || session?.user?.sub || null;
  if (!userId) return json({ error: "UNAUTHORIZED" }, 401);

  const body = await req.json().catch(() => ({}));
  const all = Boolean(body?.all);
  const idsRaw = body?.ids;

  if (!all && (!Array.isArray(idsRaw) || idsRaw.length === 0)) {
    return json({ error: "ids required or use all:true" }, 400);
  }

  let updated = 0;

  if (all) {
    const r = await prisma.notification.updateMany({
      where: { userId, channel: "IN_APP", readAt: null },
      data: { readAt: new Date() },
    });
    updated = r.count || 0;
  } else {
    const ids = idsRaw
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 500);

    const r = await prisma.notification.updateMany({
      where: { id: { in: ids }, userId, channel: "IN_APP", readAt: null },
      data: { readAt: new Date() },
    });
    updated = r.count || 0;
  }

  const unreadCount = await prisma.notification.count({
    where: { userId, channel: "IN_APP", readAt: null },
  });

  return json({ ok: true, updated, unreadCount });
}
