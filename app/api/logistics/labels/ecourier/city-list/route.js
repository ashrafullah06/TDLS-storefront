import { NextResponse } from "next/server";

const BASE = process.env.ECOURIER_BASE_URL;
const KEY = process.env.ECOURIER_API_KEY;
const SECRET = process.env.ECOURIER_API_SECRET;
const USER = process.env.ECOURIER_USER_ID;

function h() {
  if (!BASE || !KEY || !SECRET || !USER) throw new Error("Missing ECOURIER_* env");
  return { "API-KEY": KEY, "API-SECRET": SECRET, "USER-ID": USER, "Content-Type": "application/json" };
}

export async function GET() {
  try {
    const r = await fetch(`${BASE}/city-list`, { method: "POST", headers: h(), body: JSON.stringify({}) });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: "city-list failed", detail: data }, { status: r.status });
    return NextResponse.json({ cities: data });
  } catch (e) {
    return NextResponse.json({ error: "city-list error", detail: String(e) }, { status: 500 });
  }
}
