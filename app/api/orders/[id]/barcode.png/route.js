// PATH: app/api/orders/[id]/barcode.png/route.js
export const runtime = "nodejs"; // bwip-js needs Node runtime
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import bwipjs from "bwip-js";

function textResponse(body, status = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// GET /api/orders/[id]/barcode.png
export async function GET(_req, ctx) {
  try {
    // Next.js 15: params may be async; awaiting works for both Promise + plain object
    const params = await ctx?.params;
    const id = String(params?.id || "").trim();

    if (!id) return textResponse("ID_REQUIRED", 400);

    // Use order id as the barcode payload (always available)
    const text = id.replace(/\s+/g, "");
    if (!text) return textResponse("NO_BARCODE", 404);

    const png = await bwipjs.toBuffer({
      bcid: "code128",
      text,
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: "center",
      textsize: 10,
      backgroundcolor: "FFFFFF",
    });

    return new NextResponse(png, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/orders/[id]/barcode.png] error:", err);
    return textResponse("BARCODE_ERROR", 500);
  }
}
