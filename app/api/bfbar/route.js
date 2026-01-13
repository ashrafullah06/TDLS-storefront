// FILE: app/api/bfbar/route.js
import { NextResponse } from "next/server";

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

function toAuthHeaders() {
  const token =
    toStr(process.env.STRAPI_API_TOKEN) ||
    toStr(process.env.STRAPI_TOKEN) ||
    toStr(process.env.STRAPI_READ_TOKEN) ||
    "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeStrapiPath(path) {
  const p = toStr(path);
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.startsWith("/api/") ? withSlash : `/api${withSlash}`;
}

function flattenCollection(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map((n) =>
    n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n
  );
}

async function fetchStrapiCached(path) {
  const base = normalizeBaseUrl(pickStrapiBaseUrl());
  if (!base) return null;

  const url = `${base}${normalizeStrapiPath(path)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...toAuthHeaders(),
    },
    // server “catcher” cache: purged by revalidateTag("bfbar")
    next: { tags: ["bfbar"], revalidate: 60 * 60 * 24 }, // 24h safety; webhook makes it instant
  }).catch(() => null);

  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

export async function GET() {
  try {
    const [pRaw, agRaw, cRaw, aRaw] = await Promise.all([
      fetchStrapiCached("/products?populate=*"),
      fetchStrapiCached("/age-groups?populate=*"),
      fetchStrapiCached("/categories?populate=*"),
      fetchStrapiCached("/audience-categories?populate=*"),
    ]);

    const data = {
      products: pRaw ? flattenCollection(pRaw) : [],
      ageGroups: agRaw ? flattenCollection(agRaw) : [],
      categories: cRaw ? flattenCollection(cRaw) : [],
      audienceCategories: aRaw ? flattenCollection(aRaw) : [],
      _source: "api-cache",
    };

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "server_error" },
      { status: 500 }
    );
  }
}
