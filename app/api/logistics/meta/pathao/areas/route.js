import { NextResponse } from "next/server";
import { pathao } from "@/lib/logistics/providers/pathao";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(req) {
  try {
    const zone_id = new URL(req.url).searchParams.get("zone_id");
    if (!zone_id) return NextResponse.json({ error: "zone_id required" }, { status: 400 });
    return NextResponse.json(await pathao.areas(zone_id));
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
