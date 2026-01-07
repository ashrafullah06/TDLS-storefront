import { NextResponse } from "next/server";
import { ecourier } from "@/lib/logistics/providers/ecourier";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city");
    const thana = searchParams.get("thana");
    if (!city || !thana) return NextResponse.json({ error: "city & thana required" }, { status: 400 });
    return NextResponse.json(await ecourier.areas(city, thana));
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
