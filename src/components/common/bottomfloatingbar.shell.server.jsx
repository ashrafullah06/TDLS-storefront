// FILE: src/components/common/bottomfloatingbar.shell.server.jsx
import BottomFloatingBar from "./bottomfloatingbar";

/**
 * SERVER SHELL.
 * IMPORTANT:
 * - Import this ONLY from Server Components (e.g. app/page.js).
 * - Do NOT re-export it from any client-imported barrel like `src/components/common/index.js`.
 *
 * This file intentionally does NOT import "server-only" because your codebase is currently
 * pulling `src/components/common` into client bundles, which would hard-fail compilation.
 * Instead we add a runtime guard.
 */
function assertServerOnly() {
  // If this ever runs on the client, something imported it incorrectly.
  if (typeof window !== "undefined") {
    throw new Error(
      "BottomFloatingBarShell is server-only but was imported into a client bundle. " +
        "Import it only from app/* Server Components and do not export it from src/components/common."
    );
  }
}

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
    next: { tags: ["bfbar"], revalidate: 60 * 60 * 6 }, // 6h
  }).catch(() => null);

  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

async function fetchAllProductsPaged(pageSize = 250, hardMaxPages = 40) {
  const all = [];
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount && page <= hardMaxPages) {
    const qs = new URLSearchParams();
    qs.set("pagination[page]", String(page));
    qs.set("pagination[pageSize]", String(pageSize));
    qs.set("populate", "*");

    const raw = await fetchStrapi(`/products?${qs.toString()}`);
    if (!raw) break;

    const chunk = flattenCollection(raw);
    if (chunk.length) all.push(...chunk);

    const meta = raw?.meta?.pagination;
    pageCount = typeof meta?.pageCount === "number" ? meta.pageCount : pageCount;
    page += 1;
  }

  return all;
}

export default async function BottomFloatingBarShell(props) {
  assertServerOnly();

  const [products, catsRaw, audRaw, agRaw] = await Promise.all([
    fetchAllProductsPaged(250),
    fetchStrapi("/categories?pagination[pageSize]=500&sort=order:asc&populate=*"),
    fetchStrapi("/audience-categories?pagination[pageSize]=500&sort=order:asc&populate=*"),
    fetchStrapi("/age-groups?pagination[pageSize]=200&sort=order:asc&populate=*"),
  ]);

  const initialData = {
    products: Array.isArray(products) ? products : [],
    categories: catsRaw ? flattenCollection(catsRaw) : [],
    audienceCategories: audRaw ? flattenCollection(audRaw) : [],
    ageGroups: agRaw ? flattenCollection(agRaw) : [],
  };

  return <BottomFloatingBar {...props} initialData={initialData} />;
}
