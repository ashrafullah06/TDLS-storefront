// PATH: app/api/admin/metrics/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET(req) {
  // Proxy to /api/admin/dashboard while preserving query params
  try {
    const url = new URL(req.url);
    const target = new URL("/api/admin/dashboard", url.origin);
    url.searchParams.forEach((v, k) => target.searchParams.set(k, v));

    const res = await fetch(target.toString(), {
      method: "GET",
      headers: {
        // forward cookies for auth
        cookie: req.headers.get("cookie") || "",
      },
      cache: "no-store",
    });

    const data = await res.json().catch(() => null);
    return json(data, res.status);
  } catch (err) {
    console.error("[admin/metrics.GET]", err);
    return json({ ok: false, error: "METRICS_FAILED" }, 500);
  }
}
