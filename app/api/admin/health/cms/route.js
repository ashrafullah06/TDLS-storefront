// app/api/health/cms/route.js
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Checks Strapi read-only DB connectivity and basic endpoints.
 * Requires: STRAPI_API_URL_RO
 */
export async function GET() {
  const base = process.env.STRAPI_API_URL_RO;
  if (!base) {
    return NextResponse.json({ ok: false, error: "STRAPI_API_URL_RO not configured" }, { status: 500 });
  }

  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/global-settings`, { cache: "no-store" });
    const ms = Date.now() - started;
    if (!res.ok) {
      return NextResponse.json({ ok: false, source: "strapi", status: res.status, ms }, { status: 500 });
    }
    return NextResponse.json({ ok: true, source: "strapi", status: res.status, ms });
  } catch (e) {
    return NextResponse.json({ ok: false, source: "strapi", error: String(e), ms: Date.now() - started }, { status: 500 });
  }
}
