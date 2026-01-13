// FILE: src/app/api/revalidate/route.js
import { NextResponse } from "next/server";
import { doRevalidate } from "@/lib/revalidate";

function toStr(v) {
  return (v ?? "").toString().trim();
}

async function handle(req) {
  const token = toStr(process.env.REVALIDATE_TOKEN);
  const { searchParams } = new URL(req.url);
  const provided = toStr(searchParams.get("token"));

  if (!token || provided !== token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tag = toStr(body?.tag) || "bfbar"; // default
  const path = toStr(body?.path) || undefined;

  const out = await doRevalidate({ path, tag });
  return NextResponse.json({ ok: true, ...out });
}

export async function POST(req) {
  try {
    return await handle(req);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "server_error" },
      { status: 500 }
    );
  }
}

// Optional (helps quick testing in browser without needing a POST client)
export async function GET(req) {
  try {
    return await handle(req);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "server_error" },
      { status: 500 }
    );
  }
}
