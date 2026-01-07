import { NextResponse } from "next/server";
import { ecourier } from "@/lib/logistics/providers/ecourier";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city");
    if (!city) return NextResponse.json({ error: "city required" }, { status: 400 });
    return NextResponse.json(await ecourier.thanas(city));
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
