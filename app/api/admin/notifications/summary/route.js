// FILE: app/api/admin/notifications/summary/route.js
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
  const perms = session?.user?.permissions || [];
  if (!session?.user?.id) return json({ error: "UNAUTHORIZED" }, 401);
  if (!perms.includes("VIEW_NOTIFICATIONS")) return json({ error: "FORBIDDEN" }, 403);

  const u = new URL(req.url);
  const channel = String(u.searchParams.get("channel") || "all");
  const status = String(u.searchParams.get("status") || "all");
  const type = String(u.searchParams.get("type") || "all");
  const q = String(u.searchParams.get("q") || "").trim().slice(0, 200);

  const windowHours = clampInt(u.searchParams.get("windowHours"), 24, 1, 168);
  const limit = clampInt(u.searchParams.get("limit"), 50, 1, 200);

  const since = new Date(Date.now() - windowHours * 3600 * 1000);

  const where = {};
  if (channel !== "all") where.channel = channel;
  if (status !== "all") where.status = status;
  if (type !== "all") where.type = type;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { body: { contains: q, mode: "insensitive" } },
      { to: { contains: q, mode: "insensitive" } },
      { userId: { contains: q } },
    ];
  }

  const where24h = { ...where, createdAt: { gte: since } };

  const [deliveries24h, failed24h, queued, recent] = await Promise.all([
    prisma.notification.count({ where: { ...where24h, status: "DELIVERED" } }),
    prisma.notification.count({ where: { ...where24h, status: "FAILED" } }),
    prisma.notification.count({ where: { ...where, status: "QUEUED" } }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        channel: true,
        type: true,
        status: true,
        to: true,
        userId: true,
        title: true,
      },
    }),
  ]);

  return json({ deliveries24h, failed24h, queued, recent, windowHours });
}
