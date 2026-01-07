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
    const { city, thana } = await req.json();
    if (!city || !thana) return NextResponse.json({ error: "city and thana required" }, { status: 400 });

    const r = await fetch(`${BASE}/area-list`, { method: "POST", headers: h(), body: JSON.stringify({ city, thana }) });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: "area-list failed", detail: data }, { status: r.status });

    // eCourier returns [{ name: "8210(Babuganj Bondor)", value: "8217" }, ...]
    // Normalize to { zip, label, area }
    const areas = (data?.message || data || []).map((it) => {
      const label = it?.name || "";
      const zip = it?.value || "";
      const area = label.replace(/^\d+\s*\(|\)$/g, "").replace(/^\d+\s*\((.*?)\)$/, "$1"); // best-effort strip code
      return { zip, label, area };
    });
    return NextResponse.json({ areas });
  } catch (e) {
    return NextResponse.json({ error: "area-list error", detail: String(e) }, { status: 500 });
  }
}
