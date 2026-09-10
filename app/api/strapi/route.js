// FILE: app/api/strapi/route.js

import { fetchStrapiProxy } from "@/lib/strapi-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  return fetchStrapiProxy(request);
}