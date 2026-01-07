// app/api/logistics/track/[provider]/route.js
import { NextResponse } from "next/server";
import { providers, supported } from "@/lib/logistics/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req, { params }) {
  try {
    const { provider } = params;
    if (!supported.includes(provider)) return NextResponse.json({ error: "Unsupported provider" }, { status: 404 });

    const url = new URL(req.url);
    const q = Object.fromEntries(url.searchParams.entries());
    // each provider expects a specific key (documented in their helper)
    const data = await providers[provider].track(q);
    return NextResponse.json({ provider, data }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
