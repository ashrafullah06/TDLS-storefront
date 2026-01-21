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

// bwip-js is callback-first; wrap to guarantee Promise behavior across environments.
function bwipToPngBuffer(opts) {
  return new Promise((resolve, reject) => {
    try {
      bwipjs.toBuffer(opts, (err, png) => {
        if (err) reject(err);
        else resolve(png);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function normalizeBarcodeText(v) {
  // Keep it robust: trim + strip whitespace.
  // Order numbers are typically safe for CODE128.
  let s = String(v || "").trim();
  if (!s) return "";

  s = s.replace(/\s+/g, "");

  // Hard safety cap to avoid pathological inputs breaking bwip-js
  if (s.length > 128) s = s.slice(0, 128);

  return s;
}

// GET /api/orders/[id]/barcode.png?orderNumber=TDLS-....
export async function GET(req, ctx) {
  try {
    // Next.js 15: params may be async; awaiting works for both Promise + plain object
    const params = await ctx?.params;
    const id = String(params?.id || "").trim();
    if (!id) return textResponse("ID_REQUIRED", 400);

    // Prefer orderNumber from querystring (shorter), fallback to id (always available).
    let orderNumber = "";
    try {
      const url = new URL(req.url);
      orderNumber = url.searchParams.get("orderNumber") || "";
    } catch (_) {
      // ignore URL parse issues; fallback below
      orderNumber = "";
    }

    const preferred = normalizeBarcodeText(orderNumber);
    const fallback = normalizeBarcodeText(id);

    const text = preferred || fallback;
    if (!text) return textResponse("NO_BARCODE", 404);

    const png = await bwipToPngBuffer({
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
