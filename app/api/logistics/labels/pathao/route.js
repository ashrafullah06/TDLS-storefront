// FILE: app/api/logistics/labels/pathao/route.js
export const dynamic = "force-dynamic";

export async function POST(req) {
  const origin = new URL(req.url).origin;
  const body = await req.text();
  const r = await fetch(`${origin}/api/logistics/labels/pathao`, { method: "POST", headers: { "Content-Type": req.headers.get("content-type") || "application/json" }, body });
  return new Response(await r.arrayBuffer(), { status: r.status, headers: r.headers });
}
