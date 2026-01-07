// FILE: app/api/loyalty/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Loyalty summary:
 * - members
 * - points issued, redeemed, net
 */
export async function GET(req) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") || 30)));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  try {
    const members = await prisma.loyaltyAccount.count();

    const issuedAgg = await prisma.loyaltyTransaction.aggregate({
      where: { at: { gte: since }, type: "EARN" },
      _sum: { points: true },
    });
    const redeemedAgg = await prisma.loyaltyTransaction.aggregate({
      where: { at: { gte: since }, type: "REDEEM" },
      _sum: { points: true },
    });

    return NextResponse.json({
      since: since.toISOString(),
      members,
      pointsIssued: Number(issuedAgg?._sum?.points ?? 0),
      pointsRedeemed: Number(redeemedAgg?._sum?.points ?? 0),
      pointsNet: Number((issuedAgg?._sum?.points ?? 0) - (redeemedAgg?._sum?.points ?? 0)),
    });
  } catch (e) {
    return NextResponse.json({ error: "loyalty summary unavailable", detail: String(e) }, { status: 503 });
  }
}
