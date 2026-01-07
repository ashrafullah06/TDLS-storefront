// FILE: app/api/logistics/labels/redx/route.js
export const dynamic = "force-dynamic";

/**
 * Thin alias to generic /api/logistics/labels/[provider]
 * Keeps UI simple while centralizing provider logic.
 */
export async function POST(req) {
  const origin = new URL(req.url).origin;
  const body = await req.text(); // pass-through
  const r = await fetch(`${origin}/api/logistics/labels/redx`, { method: "POST", headers: { "Content-Type": req.headers.get("content-type") || "application/json" }, body });
  return new Response(await r.arrayBuffer(), { status: r.status, headers: r.headers });
}
