// FILE: app/api/loyalty/reward-products/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const rows = await prisma.rewardProduct.findMany({
      select: { id: true, name: true, image: true, pointsRequired: true, active: true },
      orderBy: [{ active: "desc" }, { pointsRequired: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ items: rows });
  } catch (e) {
    return NextResponse.json({ error: "reward products unavailable", detail: String(e) }, { status: 503 });
  }
}
