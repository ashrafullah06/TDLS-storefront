// app/api/logistics/meta/ecourier/cities/route.js
import { NextResponse } from "next/server";
import { ecourier } from "@/lib/logistics/providers/ecourier";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET() { try { return NextResponse.json(await ecourier.cities()); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); } }
