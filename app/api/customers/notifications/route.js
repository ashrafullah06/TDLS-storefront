// FILE: app/api/customers/notifications/route.js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
function clampInt(v, def, min, max) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id || session?.user?.sub || null;
  if (!userId) return json({ error: "UNAUTHORIZED" }, 401);

  const u = new URL(req.url);
  const page = clampInt(u.searchParams.get("page"), 1, 1, 50000);
  const pageSize = clampInt(u.searchParams.get("pageSize"), 30, 1, 100);
  const unreadOnly = u.searchParams.get("unreadOnly") === "1";

  const whereBase = { userId, channel: "IN_APP" };
  const where = unreadOnly ? { ...whereBase, readAt: null } : whereBase;

  const [total, unreadCount, items] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...whereBase, readAt: null } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        status: true,
        createdAt: true,
        readAt: true,
        orderId: true,
      },
    }),
  ]);

  // Hide feature: stored in data.hidden (no schema change)
  const filtered = items.filter((x) => !(x?.data && x.data.hidden === true));

  return json({ page, pageSize, total, unreadCount, items: filtered });
}
