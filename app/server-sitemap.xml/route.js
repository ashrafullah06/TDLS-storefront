// app/server-sitemap.xml/route.js
import { NextResponse } from 'next/server';
import { getBaseUrl, toXml } from '@/lib/site';

export const revalidate = 300;

export async function GET() {
  const baseUrl = getBaseUrl();
  const api = (process.env.STRAPI_URL || '').replace(/\/+$/, '');
  const token = process.env.STRAPI_API_TOKEN || '';

  if (!api) return new NextResponse('Missing STRAPI_URL', { status: 500 });

  const endpoints = [
    { url: `${api}/api/pages?pagination[pageSize]=1000`, prefix: '' },
    { url: `${api}/api/lookbooks?pagination[pageSize]=1000`, prefix: 'lookbook' },
  ];

  try {
    const all = [];

    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          next: { revalidate },
        });
        const json = await res.json();
        const items = Array.isArray(json && json.data) ? json.data : [];
        for (const it of items) {
          const a = (it && it.attributes) || {};
          if (!a.slug) continue;
          const updatedAt = a.updatedAt || a.publishedAt || new Date().toISOString();
          all.push({
            loc: `${baseUrl}/${ep.prefix ? `${ep.prefix}/` : ''}${a.slug}`,
            lastmod: new Date(updatedAt).toISOString(),
            changefreq: 'weekly',
            priority: 0.6,
          });
        }
      } catch {
        // continue
      }
    }

    const xml = toXml(all);
    return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } });
  } catch (e) {
    return new NextResponse(`Error: ${e && e.message ? e.message : e}`, { status: 500 });
  }
}
