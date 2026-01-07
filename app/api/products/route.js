// FILE: app/api/products/route.js
// Generic proxy to Strapi /api/products
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRAPI_URL =
  [
    process.env.STRAPI_API_URL,
    process.env.STRAPI_URL,
    process.env.NEXT_PUBLIC_STRAPI_API_URL,
  ]
    .find((v) => typeof v === "string" && v.trim().length > 0)
    ?.replace(/\/+$/, "") || "";

const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
  "";

const BASE_HEADERS = {
  Accept: "application/json",
  ...(STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {}),
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(req) {
  try {
    if (!STRAPI_URL) {
      return json(
        { error: "STRAPI_URL / STRAPI_API_URL is not configured on the server." },
        500
      );
    }

    const incoming = new URL(req.url);
    const upstream = new URL(`${STRAPI_URL}/api/products`);

    // Forward all query params 1:1 to Strapi
    incoming.searchParams.forEach((value, key) => {
      upstream.searchParams.append(key, value);
    });

    const res = await fetch(upstream.toString(), {
      headers: BASE_HEADERS,
      cache: "no-store",
    });

    const body = await res.text();

    return new Response(body, {
      status: res.status,
      headers: {
        "content-type":
          res.headers.get("content-type") ||
          "application/json; charset=utf-8",
      },
    });
  } catch (err) {
    return json(
      { error: "API error while proxying to Strapi products.", detail: String(err?.message || err) },
      500
    );
  }
}
