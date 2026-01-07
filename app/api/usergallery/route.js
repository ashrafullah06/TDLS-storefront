// app/api/usergallery/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("product");
    if (!productId) return NextResponse.json({ ok: false, error: "missing_product" }, { status: 400 });

    // using MediaAsset.source === "user" to distinguish UGC; adjust if you store differently
    const rows = await prisma.productMedia.findMany({
      where: { productId, media: { source: "user" } },
      include: { media: true },
      orderBy: { position: "asc" },
      take: 32,
    });
    const images = rows.map(r => ({ url: r.media.url, alt: r.media.alt, width: r.media.width, height: r.media.height }));
    return NextResponse.json({ ok: true, images });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
