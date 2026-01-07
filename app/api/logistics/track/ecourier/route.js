import { NextResponse } from "next/server";
const BASE = process.env.ECOURIER_BASE_URL;
const KEY = process.env.ECOURIER_API_KEY;
const SECRET = process.env.ECOURIER_API_SECRET;
const USER = process.env.ECOURIER_USER_ID;

function h() {
  if (!BASE || !KEY || !SECRET || !USER) throw new Error("Missing ECOURIER_* env");
  return { "API-KEY": KEY, "API-SECRET": SECRET, "USER-ID": USER, "Content-Type": "application/json" };
}

export async function POST(req) {
  try {
    const { ecr, product_id } = await req.json();
    if (!ecr && !product_id) return NextResponse.json({ error: "ecr or product_id required" }, { status: 400 });
    const payload = ecr ? { ecr } : { product_id };
    const r = await fetch(`${BASE}/track`, { method: "POST", headers: h(), body: JSON.stringify(payload) });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: "track failed", detail: data }, { status: r.status });
    return NextResponse.json({ tracking: data });
  } catch (e) {
    return NextResponse.json({ error: "track error", detail: String(e) }, { status: 500 });
  }
}
