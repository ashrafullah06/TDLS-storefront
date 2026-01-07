// FILE: app/api/wishlist/add/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

/**
 * Compatibility endpoint.
 *
 * Why redirect?
 * - Many setups scope customer auth cookies to Path=/api/auth
 * - In that case /api/wishlist/* will NEVER receive the cookie -> 401
 * - A 307 redirect replays the same request to /api/auth/wishlist where the cookie is sent.
 */

function redirectTarget(req) {
  const url = new URL(req.url);
  const target = new URL("/api/auth/wishlist", url.origin);
  target.search = url.search; // preserve query string
  return target;
}

export async function GET(req) {
  const res = NextResponse.redirect(redirectTarget(req), 307);
  res.headers.set("x-tdlc-alias", "/api/wishlist/add");
  return res;
}

export async function POST(req) {
  const res = NextResponse.redirect(redirectTarget(req), 307);
  res.headers.set("x-tdlc-alias", "/api/wishlist/add");
  return res;
}
