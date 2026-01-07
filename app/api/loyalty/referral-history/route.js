// FILE: app/api/loyalty/referral-history/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/** GET ?userId=xxx&page=1&pageSize=20 */
export async function GET(req) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const skip = (page - 1) * pageSize;

  try {
    const [items, total] = await Promise.all([
      prisma.referral.findMany({ where: { referrerId: userId }, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      prisma.referral.count({ where: { referrerId: userId } }),
    ]);
    return NextResponse.json({ items, total, page, pageSize });
  } catch (e) {
    return NextResponse.json({ error: "referral history unavailable", detail: String(e) }, { status: 503 });
  }
}
