// app/sitemap-blog.xml/route.js
import { NextResponse } from 'next/server';
import { getBaseUrl, toXml } from '@/lib/site';

export const revalidate = 600;

export async function GET() {
  const baseUrl = getBaseUrl();
  const api = (process.env.STRAPI_URL || '').replace(/\/+$/, '');
  const token = process.env.STRAPI_API_TOKEN || '';

  if (!api) return new NextResponse('Missing STRAPI_URL', { status: 500 });

  try {
    const res = await fetch(`${api}/api/posts?populate=*&pagination[pageSize]=1000`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      next: { revalidate },
    });
    const json = await res.json().catch(() => ({}));
    const items = Array.isArray(json && json.data) ? json.data : [];

    const urls = items.map((a) => {
      const at = (a && a.attributes) || {};
      if (!at.slug) return null;
      const updatedAt = at.updatedAt || at.publishedAt || new Date().toISOString();
      return {
        loc: `${baseUrl}/blog/${at.slug}`,
        lastmod: new Date(updatedAt).toISOString(),
        changefreq: 'weekly',
        priority: 0.7,
      };
    }).filter(Boolean);

    const xml = toXml(urls);
    return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } });
  } catch (e) {
    return new NextResponse(`Error: ${e && e.message ? e.message : e}`, { status: 500 });
  }
}
