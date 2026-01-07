// FILE: app/api/cms/strapi/status/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

/**
 * Pings Strapi health; returns status/version. Requires STRAPI_URL (and token for admin endpoints if needed).
 */
export async function GET() {
  const url = (process.env.NEXT_PUBLIC_STRAPI_API_URL || process.env.STRAPI_URL || "").replace(/\/+$/, "");
  if (!url) return NextResponse.json({ error: "STRAPI_URL missing" }, { status: 503 });

  try {
    const r = await fetch(`${url}/_health`, { cache: "no-store" });
    const ok = r.ok;
    return NextResponse.json({ status: ok ? "ok" : "degraded", version: r.headers.get("x-powered-by") || "" });
  } catch (e) {
    return NextResponse.json({ error: "strapi unreachable", detail: String(e) }, { status: 503 });
  }
}
