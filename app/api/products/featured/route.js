// FILE: app/api/products/featured/route.js
// Runtime: Node.js (so we can use env + standard fetch)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRAPI_URL = (process.env.STRAPI_URL || "").replace(/\/+$/, ""); // e.g., https://cms.example.com
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || "";

const HEADERS = {
  Accept: "application/json",
  ...(STRAPI_API_TOKEN ? { Authorization: `Bearer ${STRAPI_API_TOKEN}` } : {}),
};

function json(res, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function strapiImageUrl(urlOrPath) {
  if (!urlOrPath) return null;
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (!STRAPI_URL) return urlOrPath; // fallback raw path if STRAPI_URL not set
  return `${STRAPI_URL}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

export async function GET(req) {
  try {
    if (!STRAPI_URL) {
      return json(
        { ok: false, error: "STRAPI_URL is not configured on the server." },
        500
      );
    }

    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") || 12);

    // Strapi v4 query: products marked as featured
    const qs = new URLSearchParams({
      "filters[featured][$eq]": "true",
      "pagination[pageSize]": String(Math.max(1, Math.min(limit, 100))),
      "sort": "publishedAt:desc",
      "populate[cover][populate]": "*,formats",
      "populate[images][populate]": "*,formats",
      "populate[variants]": "*",
    });

    const url = `${STRAPI_URL}/api/products?${qs.toString()}`;

    const res = await fetch(url, {
      headers: HEADERS,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(
        {
          ok: false,
          error: `Upstream Strapi error ${res.status}`,
          detail: text.slice(0, 1000),
        },
        502
      );
    }

    const data = await res.json();

    // Normalize to a skinny array your grid can consume
    const items = (data?.data || []).map((node) => {
      const id = node.id;
      const a = node.attributes || {};

      // Prefer a "cover" image, then first of "images"
      const cover =
        a.cover?.data?.attributes ||
        a.images?.data?.[0]?.attributes ||
        null;

      const coverUrl =
        strapiImageUrl(cover?.url) ||
        strapiImageUrl(cover?.formats?.medium?.url) ||
        strapiImageUrl(cover?.formats?.small?.url) ||
        strapiImageUrl(cover?.formats?.thumbnail?.url) ||
        null;

      return {
        id,
        title: a.title || a.name || "Untitled",
        slug: a.slug || String(id),
        price: a.price ?? null,
        currency: a.currency || "BDT",
        coverUrl,
        // keep more fields if you already use them:
        sku: a.sku || null,
        badges: a.badges || [],
      };
    });

    return json({ ok: true, items });
  } catch (err) {
    return json(
      { ok: false, error: "API error", detail: String(err?.message || err) },
      500
    );
  }
}
