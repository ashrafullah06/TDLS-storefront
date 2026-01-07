import { NextResponse } from "next/server";
import { pathao } from "@/lib/logistics/providers/pathao";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(req) {
  try {
    const city_id = new URL(req.url).searchParams.get("city_id");
    if (!city_id) return NextResponse.json({ error: "city_id required" }, { status: 400 });
    return NextResponse.json(await pathao.zones(city_id));
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
