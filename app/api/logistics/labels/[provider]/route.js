// app/api/logistics/labels/[provider]/route.js
import { NextResponse } from "next/server";
import { providers, supported } from "@/lib/logistics/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req, { params }) {
  try {
    const { provider } = params;
    if (!supported.includes(provider)) return NextResponse.json({ error: "Unsupported provider" }, { status: 404 });
    const payload = await req.json();
    const data = await providers[provider].createLabel(payload);
    return NextResponse.json({ provider, data }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
