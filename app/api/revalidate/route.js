import { NextResponse } from "next/server";
import { doRevalidate } from "@/lib/revalidate";

export async function POST(req) {
  try {
    const token = process.env.REVALIDATE_TOKEN;
    const { searchParams } = new URL(req.url);
    const provided = searchParams.get("token");
    if (!token || provided !== token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const out = await doRevalidate({ path: body.path, tag: body.tag });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
