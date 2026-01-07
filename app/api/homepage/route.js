export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE =
  (process.env.STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    "http://127.0.0.1:1337").replace(/\/+$/, "");

const TOKEN =
  process.env.STRAPI_API_TOKEN || process.env.STRAPI_GRAPHQL_TOKEN || "";

const HEADERS = {
  Accept: "application/json",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

function buildPopulate(max = 40) {
  const p = [];
  p.push("populate[hero_slides][populate]=*");
  p.push("populate[hero_slide][populate]=*");
  for (let i = 1; i <= max; i++) {
    p.push(`populate[hero_slides_${i}][populate]=*`);
    p.push(`populate[hero_slide_${i}][populate]=*`);
  }
  return p.join("&");
}

async function safeJson(url) {
  try {
    const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function GET() {
  const urlExact = `${BASE}/api/homepage?${buildPopulate(40)}&publicationState=live`;
  let json = await safeJson(urlExact);
  if (!json?.data) {
    json = await safeJson(`${BASE}/api/homepage?populate=deep&publicationState=live`);
  }
  if (!json?.data) {
    return new Response(JSON.stringify({ data: { attributes: {} } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=10, stale-while-revalidate=120",
    },
  });
}
