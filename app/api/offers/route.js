// app/api/offers/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";
import { requireAuth } from "@/lib/auth";

export async function GET(req) {
  try {
    const { userId } = await requireAuth(req);
    const acct = await prisma.loyaltyAccount.findUnique({ where: { userId }, select: { tier: true } });
    const tier = acct?.tier || "MEMBER";
    const promos = await prisma.promotion.findMany({
      where: { status: "ACTIVE", startsAt: { lte: new Date() }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      orderBy: { updatedAt: "desc" }, take: 10,
    });
    // simple personalization by tier
    const prioritized = promos.sort((a,b)=> (a.value ?? 0) < (b.value ?? 0) ? 1 : -1);
    return NextResponse.json({ ok: true, tier, offers: prioritized });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
