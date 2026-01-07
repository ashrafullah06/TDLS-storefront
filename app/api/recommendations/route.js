// app/api/recommendations/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";


/** naive co-purchase recommendations */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const product = searchParams.get("product");
    if (!product) return NextResponse.json({ ok: false, error: "missing_product" }, { status: 400 });

    // find variants of the product
    const variants = await prisma.productVariant.findMany({ where: { productId: product } });
    const vIds = variants.map(v => v.id);
    if (!vIds.length) return NextResponse.json({ ok: true, items: [] });

    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const co = await prisma.$queryRaw`
      SELECT oi2."variantId" as "variantId", SUM(oi2.quantity) as qty
      FROM "OrderItem" oi1
      JOIN "OrderItem" oi2 ON oi1."orderId" = oi2."orderId" AND oi2."variantId" <> oi1."variantId"
      JOIN "Order" o ON o.id = oi1."orderId"
      WHERE oi1."variantId" IN (${prisma.join(vIds)}) AND o."createdAt" >= ${since}
      GROUP BY oi2."variantId"
      ORDER BY qty DESC
      LIMIT 12;
    `;
    const recVariantIds = co.map(r => r.variantId);
    const recs = await prisma.productVariant.findMany({
      where: { id: { in: recVariantIds } },
      include: { product: true, media: { include: { media: true }, take: 1 } },
    });

    return NextResponse.json({ ok: true, items: recs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
