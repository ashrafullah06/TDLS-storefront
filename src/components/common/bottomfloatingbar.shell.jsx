// FILE: src/components/common/bottomfloatingbar.shell.jsx
import BottomFloatingBar from "./bottomfloatingbar";

function toStr(v) {
  return (v ?? "").toString().trim();
}

function pickStrapiBaseUrl() {
  return (
    toStr(process.env.STRAPI_API_URL) ||
    toStr(process.env.STRAPI_URL) ||
    toStr(process.env.NEXT_PUBLIC_STRAPI_API_URL) ||
    toStr(process.env.NEXT_PUBLIC_STRAPI_URL) ||
    ""
  );
}

function normalizeBaseUrl(u) {
  return toStr(u).replace(/\/+$/, "");
}

function normalizeStrapiPath(path) {
  const p = toStr(path);
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.startsWith("/api/") ? withSlash : `/api${withSlash}`;
}

function toAuthHeaders() {
  const token =
    toStr(process.env.STRAPI_API_TOKEN) ||
    toStr(process.env.STRAPI_TOKEN) ||
    toStr(process.env.STRAPI_READ_TOKEN) ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function flattenCollection(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map((n) => (n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n))
    .filter(Boolean);
}

async function fetchStrapi(path) {
  const base = normalizeBaseUrl(pickStrapiBaseUrl());
  if (!base) return null;

  const url = `${base}${normalizeStrapiPath(path)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...toAuthHeaders(),
    },
    // Cached on the server to keep it fast & stable.
    // If you already use webhook revalidateTag("bfbar"), keep the same tag here.
    next: { tags: ["bfbar"], revalidate: 60 * 60 * 6 }, // 6h
  }).catch(() => null);

  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

export default async function BottomFloatingBarShell(props) {
  // Fetch ONLY small taxonomy lists (fast). No product payload here.
  const [catsRaw, audRaw, agRaw] = await Promise.all([
    fetchStrapi("/categories?pagination[pageSize]=500&sort=order:asc&populate=*"),
    fetchStrapi("/audience-categories?pagination[pageSize]=500&sort=order:asc&populate=*"),
    fetchStrapi("/age-groups?pagination[pageSize]=200&sort=order:asc&populate=*"),
  ]);

  const initialData = {
    categories: catsRaw ? flattenCollection(catsRaw) : [],
    audienceCategories: audRaw ? flattenCollection(audRaw) : [],
    ageGroups: agRaw ? flattenCollection(agRaw) : [],
  };

  return <BottomFloatingBar {...props} initialData={initialData} />;
}
