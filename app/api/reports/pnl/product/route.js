// FILE: app/api/reports/pnl/product/route.js
// Exposes computeProductPnl — returns only real DB-backed numbers (or 4xx/5xx)

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { computeProductPnl } from "@/lib/analytics/pnl";

function bad(msg) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

export async function GET(req) {
  const url = new URL(req.url);
  const productId = url.searchParams.get("productId") || null;
  const variantId = url.searchParams.get("variantId") || null;
  const sku = url.searchParams.get("sku") || null;
  const startISO = url.searchParams.get("start") || null; // yyyy-mm-dd
  const endISO = url.searchParams.get("end") || null;     // yyyy-mm-dd
  const group = url.searchParams.get("group") || "month";

  if (!productId && !variantId && !sku) return bad("Missing productId | variantId | sku");
  if (!startISO || !endISO) return bad("Missing start or end (yyyy-mm-dd)");

  try {
    const data = await computeProductPnl({ productId, variantId, sku, startISO, endISO, group });
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: "Product P&L failed", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
