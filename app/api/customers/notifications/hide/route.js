// FILE: app/api/customers/notifications/hide/route.js
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

  const body = await req.json().catch(() => null);
  const id = String(body?.id || "").trim();
  if (!id) return json({ error: "ID_REQUIRED" }, 400);

  const n = await prisma.notification.findFirst({
    where: { id, userId, channel: "IN_APP" },
    select: { id: true, data: true },
  });
  if (!n) return json({ error: "NOT_FOUND" }, 404);

  const nextData = { ...(n.data && typeof n.data === "object" ? n.data : {}), hidden: true, hiddenAt: new Date().toISOString() };

  await prisma.notification.update({
    where: { id },
    data: { data: nextData },
  });

  return json({ ok: true });
}
