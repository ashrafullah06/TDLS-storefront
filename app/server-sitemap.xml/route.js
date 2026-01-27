// app/server-sitemap.xml/route.js
import { NextResponse } from "next/server";
import { getBaseUrl, toXml } from "@/lib/site";

export const revalidate = 300;

function normalizeStrapiBaseUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  // Allow STRAPI_URL to be configured with trailing "/api" without breaking
  s = s.replace(/\/api$/i, "");
  return s;
}

async function fetchJson(url, { headers, revalidateSeconds }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      headers,
      next: { revalidate: revalidateSeconds },
      signal: controller.signal,
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();

    // If Strapi URL is wrong, you often get 200 HTML. Do NOT silently accept.
    if (!ct.includes("application/json")) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        json: null,
        error: `Expected JSON but got "${ct || "unknown"}"`,
        hint: text ? text.slice(0, 240) : "",
      };
    }

    const json = await res.json().catch(() => null);
    if (!json) {
      return { ok: false, status: res.status, json: null, error: "Failed to parse JSON response" };
    }

    if (!Array.isArray(json.data)) {
      return {
        ok: false,
        status: res.status,
        json: null,
        error: "Unexpected Strapi JSON shape: missing data[]",
        hint: JSON.stringify(json).slice(0, 240),
      };
    }

    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  const baseUrl = getBaseUrl();
  const api = normalizeStrapiBaseUrl(process.env.STRAPI_URL || "");
  const token = process.env.STRAPI_API_TOKEN || "";

  if (!api) return new NextResponse("Missing STRAPI_URL", { status: 500 });

  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const endpoints = [
    // pages: /{slug}
    { endpoint: "pages", prefix: "" },
    // lookbooks: /lookbook/{slug}
    { endpoint: "lookbooks", prefix: "lookbook" },
  ];

  try {
    const all = [];
    const seen = new Set();

    for (const ep of endpoints) {
      // minimal fields only (no populate=*)
      const url = new URL(`${api}/api/${ep.endpoint}`);
      url.searchParams.set("pagination[pageSize]", "1000");
      url.searchParams.append("fields[0]", "slug");
      url.searchParams.append("fields[1]", "updatedAt");
      url.searchParams.append("fields[2]", "publishedAt");
      url.searchParams.set("publicationState", "live");
      url.searchParams.set("filters[publishedAt][$notNull]", "true");
      url.searchParams.set("sort[0]", "updatedAt:desc");

      try {
        const r = await fetchJson(url.toString(), { headers, revalidateSeconds: revalidate });

        if (!r.ok) {
          // keep “best effort” behavior (don’t fail the whole sitemap because one endpoint failed)
          continue;
        }

        const items = Array.isArray(r.json?.data) ? r.json.data : [];

        for (const it of items) {
          const a = (it && it.attributes) || {};
          const slug = a.slug;
          if (!slug) continue;

          const updatedAt = a.updatedAt || a.publishedAt || null;
          const lastmod = updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString();

          const loc = `${baseUrl}/${ep.prefix ? `${ep.prefix}/` : ""}${encodeURIComponent(String(slug))}`;
          if (seen.has(loc)) continue;
          seen.add(loc);

          all.push({
            loc,
            lastmod,
            changefreq: "weekly",
            priority: 0.6,
          });
        }
      } catch {
        // continue (best effort)
      }
    }

    const xml = toXml(all);

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
      },
    });
  } catch (e) {
    return new NextResponse(`Error: ${e && e.message ? e.message : e}`, { status: 500 });
  }
}
