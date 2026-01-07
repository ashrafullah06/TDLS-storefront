// ✅ PATH: app/api/strapi/webhook/route.js
import { NextResponse } from "next/server";
import { doRevalidate } from "@/lib/revalidate";
import crypto from "crypto";

function safeEqual(a = "", b = "") {
  // Constant-time compare when lengths match; otherwise fail.
  const aa = String(a);
  const bb = String(b);
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(Buffer.from(aa), Buffer.from(bb));
}

export async function POST(req) {
  try {
    const secret = (process.env.STRAPI_WEBHOOK_SECRET || "").trim();

    // Strapi header names vary by setup; support both.
    const provided =
      (req.headers.get("x-strapi-signature-v1") || "").trim() ||
      (req.headers.get("x-strapi-signature") || "").trim();

    // If secret is set, enforce it. If not set, allow (but you should set it in prod).
    if (secret) {
      if (!provided || !safeEqual(provided, secret)) {
        return NextResponse.json(
          { ok: false, error: "unauthorized" },
          { status: 401 }
        );
      }
    }

    // Parse body (optional). Even if you don't use it now, this avoids edge cases
    // and lets you evolve to content-type based revalidation later.
    let payload = null;
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      payload = await req.json().catch(() => null);
    } else {
      // Fallback for non-json webhook bodies
      const txt = await req.text().catch(() => "");
      payload = txt || null;
    }

    // Current behavior preserved: one known revalidate call
    await doRevalidate({ tag: "catalog", path: "/collections" });

    return NextResponse.json({ ok: true, received: !!payload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "webhook_failed" },
      { status: 500 }
    );
  }
}
