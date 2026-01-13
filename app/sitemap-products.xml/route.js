// FILE: app/sitemap-products.xml/route.js
import { NextResponse } from "next/server";
import { getBaseUrl, toXml } from "@/lib/site";

export const revalidate = 60; // seconds

// Keep this route reliable + fast for large catalogs
const DEFAULT_PAGE_SIZE = 500; // safe, Strapi may clamp internally
const MAX_PAGE_SIZE = 1000;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 12000;

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

async function fetchJson(url, { headers, revalidateSeconds, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      // Let Next cache on the server/CDN edge according to revalidate
      next: { revalidate: revalidateSeconds },
      signal: controller.signal,
    });

    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function fetchAllProducts({ apiBase, headers, pageSize }) {
  // IMPORTANT performance win:
  // Do NOT use populate=* for sitemap; we only need slug + timestamps.
  // This reduces Strapi payload size dramatically.
  const makeUrl = (page) => {
    const u = new URL(`${apiBase}/api/products`);
    u.searchParams.set("pagination[page]", String(page));
    u.searchParams.set("pagination[pageSize]", String(pageSize));

    // Minimal fields only (fast)
    u.searchParams.append("fields[0]", "slug");
    u.searchParams.append("fields[1]", "updatedAt");
    u.searchParams.append("fields[2]", "publishedAt");

    // Keep order stable (optional but helps consistency)
    u.searchParams.set("sort[0]", "updatedAt:desc");

    return u.toString();
  };

  // First page to discover pageCount
  const first = await fetchJson(makeUrl(1), {
    headers,
    revalidateSeconds: revalidate,
    timeoutMs: FETCH_TIMEOUT_MS,
  });

  if (!first.ok) {
    const msg =
      first?.json?.error?.message ||
      `Strapi products fetch failed (${first.status || "?"})`;
    throw new Error(msg);
  }

  const firstItems = Array.isArray(first.json?.data) ? first.json.data : [];
  const meta = first.json?.meta?.pagination || {};
  const pageCount = clampInt(meta.pageCount, 1, 100000) || 1;

  // If only one page, done.
  if (pageCount <= 1) {
    return firstItems;
  }

  // Fetch remaining pages with bounded concurrency (fast without overloading Strapi)
  const results = [firstItems];
  let nextPage = 2;

  const workers = Array.from({ length: Math.min(CONCURRENCY, pageCount - 1) }).map(async () => {
    while (nextPage <= pageCount) {
      const page = nextPage++;
      const r = await fetchJson(makeUrl(page), {
        headers,
        revalidateSeconds: revalidate,
        timeoutMs: FETCH_TIMEOUT_MS,
      });

      if (!r.ok) {
        const msg =
          r?.json?.error?.message ||
          `Strapi products fetch failed on page ${page} (${r.status || "?"})`;
        throw new Error(msg);
      }

      const items = Array.isArray(r.json?.data) ? r.json.data : [];
      results.push(items);
    }
  });

  await Promise.all(workers);

  // Flatten
  return results.flat();
}

export async function GET() {
  const baseUrl = getBaseUrl();
  const api = (process.env.STRAPI_URL || "").replace(/\/+$/, "");
  const token = process.env.STRAPI_API_TOKEN || "";

  if (!api) {
    return new NextResponse("Missing STRAPI_URL", { status: 500 });
  }

  // Optional tuning via env (safe defaults)
  const envPageSize = clampInt(process.env.SITEMAP_PRODUCTS_PAGE_SIZE, 50, MAX_PAGE_SIZE);
  const pageSize = envPageSize || DEFAULT_PAGE_SIZE;

  const headers = {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const items = await fetchAllProducts({ apiBase: api, headers, pageSize });

    const urls = [];
    for (const p of items) {
      const a = (p && p.attributes) || {};
      const slug = a.slug;
      if (!slug) continue;

      const updatedAt = a.updatedAt || a.publishedAt || null;
      const lastmod = updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString();

      urls.push({
        loc: `${baseUrl}/products/${slug}`,
        lastmod,
        changefreq: "daily",
        priority: 0.9,
      });
    }

    const xml = toXml(urls);

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // Helps edge/CDN serve it instantly; Next will still revalidate via export const revalidate
        "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=600`,
      },
    });
  } catch (e) {
    return new NextResponse(`Error: ${e && e.message ? e.message : e}`, { status: 500 });
  }
}
