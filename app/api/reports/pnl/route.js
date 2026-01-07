// app/api/reports/pnl/route.js
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";  // :contentReference[oaicite:20]{index=20}
import { pnl } from "@/lib/analytics";      // you uploaded analytics.js :contentReference[oaicite:21]{index=21}

export const dynamic = "force-dynamic";

export async function GET(req) {
  await requireAdmin(req);
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")) : undefined;
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")) : undefined;

  const data = await pnl({ from, to }); // uses your internal getPrisma/_mapping
  return NextResponse.json(data);
}
