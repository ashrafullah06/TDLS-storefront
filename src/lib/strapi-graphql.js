// FILE: src/lib/strapi-graphql.js
// Server-only GraphQL POST to Strapi

function isProd() {
  return process.env.NODE_ENV === "production";
}

function normalizeUrl(raw) {
  let u = (raw || "").trim();
  if (!u) return "";

  // Allow hostname-only inputs (rare but possible)
  if (!/^https?:\/\//i.test(u)) {
    u = `${isProd() ? "https" : "http"}://${u}`;
  }

  // Prefer IPv4 localhost in dev
  u = u.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");

  // Strip trailing slashes
  u = u.replace(/\/+$/, "");

  return u;
}

function assertNotLocalhost(url) {
  if (!isProd()) return;
  try {
    const h = new URL(url).hostname;
    const isLocal =
      h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
    if (isLocal) {
      throw new Error(
        `Invalid STRAPI_GRAPHQL_URL for production (localhost): ${url}. Set it to your real Strapi domain.`
      );
    }
  } catch {
    throw new Error(
      `Invalid STRAPI_GRAPHQL_URL for production: ${url}. Provide a valid URL like https://cms.yourdomain.com/graphql`
    );
  }
}

const ENDPOINT_RAW =
  process.env.STRAPI_GRAPHQL_URL ||
  process.env.NEXT_PUBLIC_STRAPI_GRAPHQL_URL ||
  "";

const ENDPOINT = normalizeUrl(ENDPOINT_RAW);
const TOKEN =
  process.env.STRAPI_TOKEN ||
  process.env.STRAPI_API_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
  "";

if (!ENDPOINT) {
  throw new Error("STRAPI_GRAPHQL_URL missing (set STRAPI_GRAPHQL_URL).");
}

assertNotLocalhost(ENDPOINT);

export async function strapiGql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(
      `Strapi GraphQL HTTP_${res.status} ${res.statusText}: ${text || "<no-body>"}`
    );
  }

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Strapi GraphQL returned non-JSON: ${text || "<empty>"}`);
  }

  if (!json) return null;

  if (json.errors) {
    throw new Error(`Strapi GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}
