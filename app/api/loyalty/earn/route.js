// app/api/loyalty/earn/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";        // :contentReference[oaicite:11]{index=11}
import { requireAdmin } from "@/lib/auth"; // :contentReference[oaicite:12]{index=12}
import { applyPoints } from "@/lib/loyalty"; // :contentReference[oaicite:13]{index=13}

export const dynamic = "force-dynamic";

export async function POST(req) {
  await requireAdmin(req);
  const { userId, points, reason, reference, metadata } = await req.json().catch(() => ({}));
  if (!userId || !Number.isInteger(points) || points <= 0) {
    return NextResponse.json({ error: "userId and positive integer points required" }, { status: 400 });
  }
  const res = await applyPoints(userId, points, reason || "ADMIN_EARN", reference || "manual", metadata || {}, prisma);
  return NextResponse.json({ ok: true, ...res });
}
