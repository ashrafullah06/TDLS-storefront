// FILE: app/api/wishlist/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

/**
 * CENTRALIZED CUSTOMER AUTH:
 * - Canonical wishlist API lives at /api/auth/wishlist.
 * - This route exists only as a backward-compatible alias.
 * - 307 preserves method + body for POST.
 */

function redirectTarget(req) {
  const url = new URL(req.url);
  const target = new URL("/api/auth/wishlist", url.origin);
  target.search = url.search; // preserve query string
  return target;
}

function withAliasHeaders(res) {
  // Additive headers only (no behavior change)
  res.headers.set("x-tdlc-alias", "/api/wishlist");
  res.headers.set("x-tdlc-canonical", "/api/auth/wishlist");

  // Prevent caching issues across CDNs/proxies/browsers
  res.headers.set("cache-control", "no-store, max-age=0");
  res.headers.set("pragma", "no-cache");
  res.headers.set("vary", "Cookie, Authorization");

  return res;
}

export async function GET(req) {
  const res = NextResponse.redirect(redirectTarget(req), 307);
  return withAliasHeaders(res);
}

export async function POST(req) {
  const res = NextResponse.redirect(redirectTarget(req), 307);
  return withAliasHeaders(res);
}
