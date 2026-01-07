// app/api/products/trending/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";


export async function GET() {
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const rows = await prisma.orderItem.groupBy({
      by: ["variantId"],
      where: { order: { createdAt: { gte: since }, status: { in: ["PLACED","CONFIRMED","COMPLETED"] } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 12,
    });

    const variantIds = rows.map(r => r.variantId).filter(Boolean);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: { select: { id: true, title: true, slug: true } }, media: { include: { media: true }, take: 1 } },
    });

    return NextResponse.json({ ok: true, trending: variants });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
