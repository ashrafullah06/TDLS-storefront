// app/api/cms/[...path]/route.js
import { NextResponse } from 'next/server';

const STRAPI_URL = process.env.STRAPI_URL;
const STRAPI_TOKEN = process.env.STRAPI_TOKEN;

// Only allow methods you need:
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export async function GET(req, { params }) {
  return forward(req, params);
}
export async function POST(req, { params }) {
  return forward(req, params);
}
export async function PUT(req, { params }) {
  return forward(req, params);
}
export async function PATCH(req, { params }) {
  return forward(req, params);
}
export async function DELETE(req, { params }) {
  return forward(req, params);
}

async function forward(req, { path = [] }) {
  if (!ALLOWED_METHODS.has(req.method)) {
    return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  if (!STRAPI_URL || !STRAPI_TOKEN) {
    return NextResponse.json({ error: 'strapi_not_configured' }, { status: 500 });
  }

  // Build target URL: /api/cms/… → {STRAPI_URL}/api/…
  // Example: /api/cms/products?populate=*
  // path[0] should start with the Strapi “api” segment or a content route under it.
  const search = req.nextUrl.search || '';
  const targetPath = path.join('/');
  const targetUrl = `${STRAPI_URL}/api/${targetPath}${search}`;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${STRAPI_TOKEN}`);

  // pass JSON bodies if present
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const contentType = req.headers.get('content-type') || '';
    headers.set('Content-Type', contentType || 'application/json');
    body = await req.arrayBuffer(); // forward raw body (handles JSON & form-data)
  }

  try {
    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      // Avoid caching CMS calls unless you intentionally tune it:
      cache: 'no-store',
    });

    // Stream back the response, preserving status
    const data = await res.arrayBuffer();
    const outHeaders = new Headers();
    // Copy content-type if present (json, images, etc)
    const ct = res.headers.get('content-type');
    if (ct) outHeaders.set('content-type', ct);

    return new NextResponse(data, { status: res.status, headers: outHeaders });
  } catch (e) {
    return NextResponse.json({ error: 'strapi_proxy_failed', detail: String(e) }, { status: 502 });
  }
}
