// FILE: app/api/collections/segment/route.js
// Segment-aware proxy to Strapi /api/products for collections pages.
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

// Small helper so we can test whether caller already provided a filter
function hasParamStartingWith(searchParams, prefix) {
  for (const key of searchParams.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
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

    const segmentsParam = incoming.searchParams.get("segments") || "";

    // Copy all query params EXCEPT "segments" itself
    incoming.searchParams.forEach((value, key) => {
      if (key !== "segments") {
        upstream.searchParams.append(key, value);
      }
    });

    // Default: only show front-end enabled, non-archived products,
    // unless the caller already set explicit filters.
    if (!hasParamStartingWith(upstream.searchParams, "filters[disable_frontend]")) {
      upstream.searchParams.set("filters[disable_frontend][$ne]", "true");
    }
    if (!hasParamStartingWith(upstream.searchParams, "filters[is_archived]")) {
      upstream.searchParams.set("filters[is_archived][$ne]", "true");
    }

    // Optional automatic mapping from a "segments" string:
    //
    // Example:
    //   segments = "eid-winter/mens-tops/oversized"
    //   → events_products_collections.slug = "eid-winter"
    //   → categories.slug = "mens-tops"
    //   → sub_categories.slug = "oversized"
    //
    // You can adjust this mapping later if your taxonomy differs.
    if (segmentsParam) {
      const parts = segmentsParam
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);

      if (parts[0] && !hasParamStartingWith(upstream.searchParams, "filters[events_products_collections]")) {
        upstream.searchParams.set(
          "filters[events_products_collections][slug][$eq]",
          parts[0]
        );
      }

      if (parts[1] && !hasParamStartingWith(upstream.searchParams, "filters[categories]")) {
        upstream.searchParams.set(
          "filters[categories][slug][$eq]",
          parts[1]
        );
      }

      if (parts[2] && !hasParamStartingWith(upstream.searchParams, "filters[sub_categories]")) {
        upstream.searchParams.set(
          "filters[sub_categories][slug][$eq]",
          parts[2]
        );
      }
    }

    // If caller did not specify populate, make collections pages rich by default
    if (!upstream.searchParams.has("populate")) {
      upstream.searchParams.set("populate", "deep");
    }

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
      {
        error: "API error while proxying collection segment to Strapi.",
        detail: String(err?.message || err),
      },
      500
    );
  }
}
