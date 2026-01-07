// FILE: app/api/diag/strapi/route.js
import { NextResponse } from "next/server";
import { STRAPI_URL, strapiHealth } from "@/lib/strapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = {
    STRAPI_URL_ENV: process.env.STRAPI_URL || null,
    NEXT_PUBLIC_STRAPI_URL: process.env.NEXT_PUBLIC_STRAPI_URL || null,
    NEXT_PUBLIC_STRAPI_API_URL: process.env.NEXT_PUBLIC_STRAPI_API_URL || null,
    STRAPI_API_TOKEN_PRESENT: Boolean(process.env.STRAPI_API_TOKEN || "").toString(),
    STRAPI_FETCH_TIMEOUT_MS: process.env.STRAPI_FETCH_TIMEOUT_MS || "default(10000)",
    NODE_VERSION: process.version,
  };

  const health = await strapiHealth();

  return NextResponse.json(
    {
      resolvedBaseUrl: STRAPI_URL,
      health,
      env,
      tips: [
        "Paths passed to api() must start with a leading slash, e.g. '/api/promobar?populate=*'.",
        "Use 127.0.0.1 instead of localhost on Windows.",
        "Restart `next dev` after changing any .env* file.",
      ],
    },
    { status: 200 }
  );
}
