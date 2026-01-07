// ✅ PATH: lib/strapi-client.js

function normalizeOrigin(raw) {
  let origin = (raw || "").trim();

  // If someone passes just a hostname (common with Vercel), normalize it.
  if (origin && !/^https?:\/\//i.test(origin)) {
    origin = `https://${origin}`;
  }

  // Remove trailing slashes for consistent URL building
  origin = origin.replace(/\/+$/, "");

  // Prefer IPv4 localhost in dev if used
  origin = origin.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");

  return origin;
}

const IS_PROD = process.env.NODE_ENV === "production";

// Order of precedence:
// - NEXT_PUBLIC_APP_URL (your canonical app URL)
// - AUTH_URL / NEXTAUTH_URL (auth system URL)
// - VERCEL_URL (hostname only on Vercel; we normalize to https://...)
// - dev fallback
const RAW_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.AUTH_URL ||
  process.env.NEXTAUTH_URL ||
  process.env.VERCEL_URL ||
  "http://127.0.0.1:3000";

const APP_ORIGIN = normalizeOrigin(RAW_ORIGIN);

// Guard: never allow localhost in production (common misdeploy)
if (IS_PROD) {
  try {
    const h = new URL(APP_ORIGIN).hostname;
    const isLocal =
      h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
    if (isLocal) {
      throw new Error(
        `APP_ORIGIN resolves to a localhost URL in production: ${APP_ORIGIN}. Set NEXT_PUBLIC_APP_URL (recommended) to https://www.thednalabstore.com`
      );
    }
  } catch {
    throw new Error(
      `APP_ORIGIN is invalid in production: ${APP_ORIGIN}. Set NEXT_PUBLIC_APP_URL to your live site URL.`
    );
  }
}

/**
 * Use this from SERVER code (RSC, route handlers, cron) to call your own
 * `/api/strapi` proxy without "Failed to parse URL" errors.
 *
 * Example:
 *   const { data } = await fetchStrapiJson("/products?populate=*");
 */
export async function fetchStrapiJson(path) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  const url = new URL(
    `/api/strapi?path=${encodeURIComponent(cleanPath)}`,
    APP_ORIGIN
  );

  const res = await fetch(url.href, { cache: "no-store" });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[fetchStrapiJson] error", res.status, body || "<no-body>");
    throw new Error(`Strapi proxy failed with status ${res.status}`);
  }

  return res.json();
}
