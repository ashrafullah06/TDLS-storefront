// /components/common/bottomfloatingbar.shell.jsx
// Server wrapper (“catcher”): fetch Strapi data once (globally cached) and pass to the client bar.
// - No client-side Strapi fetch here
// - Cache is admin-dependent via tag ("bfbar") which you’ll revalidate from a Strapi webhook later

import BottomFloatingBar from "./bottomfloatingbar.client";

function pickStrapiBaseUrl() {
  return (
    process.env.STRAPI_API_URL ||
    process.env.STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    ""
  );
}

function normalizeBaseUrl(u) {
  return (u || "").toString().trim().replace(/\/+$/, "");
}

function toAuthHeaders() {
  // Optional: supports whichever token name you use.
  const token =
    process.env.STRAPI_API_TOKEN ||
    process.env.STRAPI_TOKEN ||
    process.env.STRAPI_READ_TOKEN ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeStrapiPath(path) {
  const p = (path || "").toString().trim();
  if (!p) return "/";

  // Your client code calls "/products?populate=*" (without "/api").
  // Strapi v4 expects "/api/products?..."
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.startsWith("/api/") ? withSlash : `/api${withSlash}`;
}

function flattenStrapiCollection(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map((n) =>
    n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n
  );
}

async function fetchStrapiCached(path) {
  const base = normalizeBaseUrl(pickStrapiBaseUrl());
  if (!base) return null;

  const apiPath = normalizeStrapiPath(path);
  const url = `${base}${apiPath}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...toAuthHeaders(),
    },

    // “Catcher” cache:
    // - Cached globally by Next
    // - Admin updates will invalidate via revalidateTag("bfbar") (we’ll add route later)
    next: { revalidate: 60 * 60 * 24, tags: ["bfbar"] }, // 24h safety; webhook makes it instant
  });

  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export default async function BottomFloatingBarShell(props) {
  // NOTE: This shell is the global “magnet.”
  // The client bar must be updated to use `initialData` and not refetch on mount.
  // We’ll do that in the next files you paste.

  let initialData = {
    products: [],
    ageGroups: [],
    categories: [],
    audienceCategories: [],
    _source: "server-cache",
  };

  try {
    const [pRaw, agRaw, cRaw, aRaw] = await Promise.all([
      fetchStrapiCached("/products?populate=*"),
      fetchStrapiCached("/age-groups?populate=*"),
      fetchStrapiCached("/categories?populate=*"),
      fetchStrapiCached("/audience-categories?populate=*"),
    ]);

    if (pRaw) initialData.products = flattenStrapiCollection(pRaw);
    if (agRaw) initialData.ageGroups = flattenStrapiCollection(agRaw);
    if (cRaw) initialData.categories = flattenStrapiCollection(cRaw);
    if (aRaw) initialData.audienceCategories = flattenStrapiCollection(aRaw);
  } catch {
    // Non-fatal: keep empty defaults so build/runtime never crash
  }

  return <BottomFloatingBar {...props} initialData={initialData} />;
}
