// FILE: app/api/internal/notifications/dispatch-queued/route.js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req) {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET || "";
  const got = req.headers.get("x-cron-secret") || "";
  if (!secret || got !== secret) return json({ error: "FORBIDDEN" }, 403);

  const now = new Date();

  // Due = createdAt <= now (we set createdAt = sendAt at schedule time)
  const r = await prisma.notification.updateMany({
    where: {
      channel: "IN_APP",
      status: "QUEUED",
      queued: true,
      createdAt: { lte: now },
    },
    data: {
      status: "DELIVERED",
      queued: false,
    },
  });

  return json({ ok: true, dispatched: r.count || 0 });
}
