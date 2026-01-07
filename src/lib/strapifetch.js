// FILE: src/lib/strapifetch.js
/**
 * SINGLE place to query Strapi from the Next.js app.
 * - Works in both Server and Client components.
 * - Accepts either absolute Strapi paths ("/products?populate=*") or full URLs.
 * - Adds Authorization header if a token is present (several env names supported).
 * - Survives common misconfig by trying fallbacks,
 *   including a server-side proxy at /api/strapi.
 */

function isProd() {
  return process.env.NODE_ENV === "production";
}

function normalizeBase(raw) {
  let b = (raw || "").trim();
  if (!b) return "";

  // Add scheme if missing
  if (!/^https?:\/\//i.test(b)) {
    b = `${isProd() ? "https" : "http"}://${b}`;
  }

  // Normalize localhost to ipv4 loopback for dev reliability
  b = b.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");

  // Strip trailing slash and an accidental trailing "/api"
  b = b.replace(/\/+$/, "").replace(/\/api$/, "");

  return b;
}

function isLocalHostBase(base) {
  try {
    const h = new URL(base).hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function getAppOrigin() {
  // Used only for server-side proxy fetch (absolute URL required in Node).
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.VERCEL_URL ||
    "";

  let origin = (raw || "").trim();

  // If VERCEL_URL is set, it is often just hostname
  if (origin && !/^https?:\/\//i.test(origin)) origin = `https://${origin}`;

  if (!origin) {
    // Safe dev fallback only
    origin = "http://127.0.0.1:3000";
  }

  origin = origin.replace(/\/+$/, "");
  origin = origin.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");

  // Guard: do not allow localhost origin in production (prevents silent misdeploy)
  if (isProd()) {
    try {
      const h = new URL(origin).hostname;
      const local =
        h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
      if (local) {
        throw new Error(
          `APP_ORIGIN is localhost in production: ${origin}. Set NEXT_PUBLIC_APP_URL to https://www.thednalabstore.com`
        );
      }
    } catch (e) {
      throw new Error(
        `APP_ORIGIN invalid in production: ${origin}. Set NEXT_PUBLIC_APP_URL to your live site origin.`
      );
    }
  }

  return origin;
}

export async function fetchStrapi(path, opts = {}) {
  // Build candidate bases (normalized), most-preferred first
  const rawCandidates = [
    // Preferred names (your site should standardize on one of these)
    process.env.NEXT_PUBLIC_STRAPI_URL,
    process.env.STRAPI_URL,

    // Your existing supported names (kept)
    process.env.NEXT_PUBLIC_STRAPI_API_URL,
    process.env.STRAPI_API_URL,
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN,

    // Dev fallback only (kept, but disabled in production)
    "http://localhost:1337",
  ].filter(Boolean);

  const candidates = Array.from(
    new Set(rawCandidates.map(normalizeBase).filter(Boolean))
  ).filter((base) => {
    // Never try localhost bases in production (prevents hidden production failures)
    if (isProd() && isLocalHostBase(base)) return false;
    return true;
  });

  // Token from any of the common env names (kept)
  const token =
    process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
    process.env.NEXT_PUBLIC_STRAPI_TOKEN ||
    process.env.STRAPI_API_TOKEN ||
    process.env.STRAPI_TOKEN ||
    "";

  // Helper to compose URL with a given base
  const makeUrl = (base) => {
    if (path.startsWith("http")) return path;
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${base}/api${p}`;
  };

  // Try each base synchronously until one succeeds
  for (const base of candidates) {
    const url = makeUrl(base);
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.headers || {}),
        },
        cache: opts.cache ?? "no-store",
        mode: typeof window !== "undefined" ? "cors" : undefined,
      });

      if (!res.ok) {
        if (!isProd()) {
          console.warn(`[fetchStrapi] ${res.status} ${res.statusText} -> ${url}`);
        }
        continue;
      }

      const text = await res.text();
      if (!text) return { data: null };

      try {
        return JSON.parse(text);
      } catch {
        return { data: null, error: "INVALID_JSON" };
      }
    } catch (err) {
      if (!isProd()) {
        console.warn(
          `[fetchStrapi] network error for ${url}:`,
          err?.message || err
        );
      }
      continue;
    }
  }

  // FINAL FALLBACK: proxy through Next server to bypass CORS / misconfig.
  // IMPORTANT: In Node/server runtime, fetch() needs an absolute URL.
  // This block now works in BOTH client + server.
  try {
    const proxyPath = path.startsWith("http")
      ? (() => {
          const u = new URL(path);
          return `${u.pathname}${u.search}`;
        })()
      : path;

    const q = `path=${encodeURIComponent(proxyPath)}`;

    const proxyUrl =
      typeof window !== "undefined"
        ? `/api/strapi?${q}`
        : new URL(`/api/strapi?${q}`, getAppOrigin()).href;

    const proxied = await fetch(proxyUrl, {
      ...opts,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
      cache: opts.cache ?? "no-store",
    });

    if (!proxied.ok) {
      if (!isProd()) {
        console.error(
          "[fetchStrapi] proxy failed:",
          proxied.status,
          proxied.statusText
        );
      }
      return { data: null, error: `HTTP_${proxied.status}` };
    }

    const text = await proxied.text();
    if (!text) return { data: null };

    try {
      return JSON.parse(text);
    } catch {
      return { data: null, error: "INVALID_JSON" };
    }
  } catch (err) {
    if (!isProd()) {
      console.error("[fetchStrapi] proxy error:", err);
    }
    return { data: null, error: err?.message || "FETCH_ERROR" };
  }
}

export default fetchStrapi;
