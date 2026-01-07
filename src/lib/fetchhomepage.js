// src/lib/fetchhomepage.js

function baseUrl() {
  return (
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    "http://127.0.0.1:1337"
  ).replace(/\/+$/, "");
}

async function fetchJson(url, init) {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Build a query that explicitly populates each hero field
function heroPopulateQuery() {
  // ✅ Extended to include 12..20 and singular fields,
  // preserving all your existing keys and logic.
  const keys = [
    "hero_slides",
    "hero_slides_1",
    "hero_slides_2",
    "hero_slides_3",
    "hero_slides_4",
    "hero_slides_5",
    "hero_slides_6",
    "hero_slides_7",
    "hero_slides_8",
    "hero_slides_9",
    "hero_slides_10",
    "hero_slides_11",
    // new:
    "hero_slides_12",
    "hero_slides_13",
    "hero_slides_14",
    "hero_slides_15",
    "hero_slides_16",
    "hero_slides_17",
    "hero_slides_18",
    "hero_slides_19",
    "hero_slides_20",
    // also support singular variants if present in your model
    "hero_slide",
    "hero_slide_1",
    "hero_slide_2",
    "hero_slide_3",
    "hero_slide_4",
    "hero_slide_5",
    "hero_slide_6",
    "hero_slide_7",
    "hero_slide_8",
    "hero_slide_9",
    "hero_slide_10",
    "hero_slide_11",
    "hero_slide_12",
    "hero_slide_13",
    "hero_slide_14",
    "hero_slide_15",
    "hero_slide_16",
    "hero_slide_17",
    "hero_slide_18",
    "hero_slide_19",
    "hero_slide_20",
  ];
  return keys.map(k => `populate[${k}][populate]=*`).join("&");
}

/**
 * Fetch the Homepage single-type with explicit populate for all hero arrays.
 * Falls back to `?populate=deep` if needed, and always returns a .data-like shape.
 */
export async function fetchHomepage() {
  const base = baseUrl();

  // Try explicit populate first
  const urlExact = `${base}/api/homepage?${heroPopulateQuery()}`;
  let json = await fetchJson(urlExact);

  // If that failed or returned no data, try deep as a fallback
  if (!json?.data) {
    json = await fetchJson(`${base}/api/homepage?populate=deep`);
  }

  // If public fetch failed but we're on the server with a token, retry with auth
  if (!json?.data && typeof window === "undefined" && process.env.STRAPI_API_TOKEN) {
    const headers = { Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}` };
    json =
      (await fetchJson(urlExact, { headers })) ||
      (await fetchJson(`${base}/api/homepage?populate=deep`, { headers }));
  }

  return json?.data || { attributes: {} };
}
