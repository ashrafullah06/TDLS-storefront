import { NextResponse } from "next/server";
import { pathao } from "@/lib/logistics/providers/pathao";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
export async function GET() { try { return NextResponse.json(await pathao.cities()); } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); } }
