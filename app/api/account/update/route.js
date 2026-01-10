// FILE: app/api/account/update/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

const STRAPI_URL = process.env.STRAPI_URL || "http://localhost:1337";
const STRAPI_SYNC_SECRET = process.env.STRAPI_SYNC_SECRET || "";

function ok(val) {
  return typeof val === "string" && val.trim().length > 0;
}

function isBuildPhase() {
  const nextPhase = String(process.env.NEXT_PHASE || "");
  const npmEvent = String(process.env.npm_lifecycle_event || "");
  const npmScript = String(process.env.npm_lifecycle_script || "");
  return (
    nextPhase === "phase-production-build" ||
    nextPhase.includes("phase-production-build") ||
    npmEvent === "build" ||
    npmScript.includes("next build")
  );
}

export async function POST(req) {
  try {
    // Build-safety: during `next build`/Vercel "Collecting page data"
    if (isBuildPhase()) {
      return NextResponse.json({ ok: true, build: true }, { status: 200 });
    }

    // Lazy-load auth to avoid module evaluation crashes during build
    let auth;
    try {
      const modAuth = await import("@/lib/auth");
      auth = modAuth?.auth;
    } catch (e) {
      console.error("[api/account/update init] ", e);
      return NextResponse.json({ ok: false, error: "SERVER_INIT_FAILED" }, { status: 500 });
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    // Allow only these fields from client
    const payload = {
      // identifiers
      email: session.user.email || "", // from NextAuth
      phone_number: ok(body.phone_number) ? body.phone_number : session.user.phone || "",

      // updatable fields
      name: ok(body.name) ? body.name : undefined,
      date_of_birth: ok(body.date_of_birth) ? body.date_of_birth : undefined, // ISO: YYYY-MM-DD
      gender: ok(body.gender) ? body.gender : undefined, // align with your enum
    };

    const r = await fetch(`${STRAPI_URL}/api/user-update/me`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-app-secret": STRAPI_SYNC_SECRET, // shared secret
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const out = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(out || { ok: false }, { status: r.status });
    }
    return NextResponse.json(out);
  } catch (e) {
    console.error("[api/account/update POST] ", e);
    return NextResponse.json({ ok: false, error: "network_error" }, { status: 502 });
  }
}
