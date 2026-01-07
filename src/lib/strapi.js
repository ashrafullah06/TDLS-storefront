// FILE: src/lib/strapi.js

// --- URL normalization -------------------------------------------------------
function normalizeBaseUrl(raw, { isProd } = {}) {
  let u = (raw || "").trim();

  // In production, never guess a localhost default.
  if (!u) {
    if (isProd) {
      throw new Error(
        "STRAPI_URL is not set for production. Define STRAPI_URL or NEXT_PUBLIC_STRAPI_URL."
      );
    }
    u = "http://127.0.0.1:1337"; // safer than 'localhost' on Windows (dev only)
  }

  // Allow host:port shortcuts
  if (!/^https?:\/\//i.test(u)) {
    // Prefer https in production (most deployments)
    u = `${isProd ? "https" : "http"}://${u}`;
  }

  // Prefer IPv4 loopback to avoid IPv6 (::1) pitfalls on Windows
  u = u.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");

  // trim trailing slashes
  u = u.replace(/\/+$/, "");

  // Guard: never allow localhost-ish targets in production
  if (isProd) {
    try {
      const h = new URL(u).hostname;
      const local =
        h === "localhost" ||
        h === "127.0.0.1" ||
        h === "::1" ||
        h.endsWith(".local");
      if (local) {
        throw new Error(
          `Invalid STRAPI_URL for production: ${u}. Set it to your real Strapi domain (https://...).`
        );
      }
    } catch (e) {
      // If URL parsing fails, treat as invalid in production
      throw new Error(
        `Invalid STRAPI_URL for production: ${u}. Ensure it is a valid URL like https://cms.yourdomain.com`
      );
    }
  }

  return u;
}

function ensureLeadingSlash(p) {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

const IS_PROD = process.env.NODE_ENV === "production";

const RAW_STRAPI_URL =
  process.env.STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  "";

export const STRAPI_URL = normalizeBaseUrl(RAW_STRAPI_URL, { isProd: IS_PROD });

const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || "";
const FETCH_TIMEOUT = Number(process.env.STRAPI_FETCH_TIMEOUT_MS || 10000);

// --- Fetch with timeout + rich error ----------------------------------------
async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(
    () => controller.abort(new Error("Timeout")),
    FETCH_TIMEOUT
  );
  try {
    return await fetch(url, {
      cache: "no-store",
      ...(init || {}),
      signal: controller.signal,
    });
  } catch (err) {
    const code = err?.cause?.code || err?.code || "";
    const msg = err?.message || "fetch failed";
    throw new Error(`STRAPI_FETCH_FAILED: ${code || msg} @ ${url}`);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Server-side Strapi API helper
 * @param {string} path - e.g. "/api/articles?populate=*"
 * @param {{ jwt?: string, token?: string, headers?: any }} options
 */
export async function api(path, { jwt, token, ...init } = {}) {
  const url = `${STRAPI_URL}${ensureLeadingSlash(path)}`;

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };

  const bearer = jwt || token || STRAPI_API_TOKEN;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetchWithTimeout(url, { ...init, headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`STRAPI_${res.status}: ${text || res.statusText} @ ${url}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();

  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** Health ping: 200 or 204 is OK on Strapi v4 */
export async function strapiHealth() {
  const url = `${STRAPI_URL}/_health`;
  try {
    const res = await fetchWithTimeout(url, { method: "GET" });
    const ok = res.status === 200 || res.status === 204;
    return { ok, status: res.status, url };
  } catch (e) {
    return { ok: false, error: String(e), url };
  }
}

/** Best-effort social profile sync (no-throw) */
export async function syncStrapiProfile({ user, account, profile }) {
  try {
    await api("/api/tdlc/sync-social", {
      method: "POST",
      body: JSON.stringify({
        provider: account?.provider,
        providerAccountId: account?.providerAccountId,
        email: user?.email || profile?.email,
        name: user?.name || profile?.name,
        phone: user?.phone,
      }),
    });
  } catch {}
}
