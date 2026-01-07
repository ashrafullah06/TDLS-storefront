// FILE: src/lib/strapi/strapi-write.js
import "server-only";

/**
 * Strapi WRITE client (server-only)
 * - Uses a WRITE token (separate from read-only strapiDb)
 * - REST only (Strapi v4)
 * - Strong errors (includes status + Strapi error payload when available)
 *
 * Required env (at least ONE):
 *   - STRAPI_WRITE_TOKEN   (recommended)
 *   - STRAPI_ADMIN_TOKEN
 *   - STRAPI_WRITE_API_TOKEN
 *
 * Base URL env (same as your existing Strapi server config):
 *   - STRAPI_URL (recommended)
 *   - NEXT_PUBLIC_STRAPI_URL
 *   - NEXT_PUBLIC_STRAPI_API_URL
 */

const IS_PROD = process.env.NODE_ENV === "production";
const FETCH_TIMEOUT_MS = Number(process.env.STRAPI_WRITE_TIMEOUT_MS || 15000);

function normalizeBaseUrl(raw) {
  let u = String(raw ?? "").trim();

  if (!u) {
    if (IS_PROD) {
      throw new Error(
        "STRAPI_URL is not set for production. Define STRAPI_URL (recommended) for the Strapi WRITE client."
      );
    }
    u = "http://127.0.0.1:1337"; // dev-safe fallback
  }

  if (!/^https?:\/\//i.test(u)) {
    u = `${IS_PROD ? "https" : "http"}://${u}`;
  }

  u = u.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");
  u = u.replace(/\/+$/, "");

  if (IS_PROD) {
    try {
      const h = new URL(u).hostname;
      const local =
        h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
      if (local) {
        throw new Error(
          `Invalid STRAPI_URL for production: ${u}. Set it to your real Strapi domain (https://...).`
        );
      }
    } catch {
      throw new Error(
        `Invalid STRAPI_URL for production: ${u}. Ensure it is a valid URL like https://cms.yourdomain.com`
      );
    }
  }

  return u;
}

function ensureLeadingSlash(p) {
  const s = String(p ?? "").trim();
  if (!s) return "/";
  return s.startsWith("/") ? s : `/${s}`;
}

/**
 * Strapi REST endpoints are served under /api in v4.
 * Accepts:
 *  - "products" -> "/api/products"
 *  - "/products" -> "/api/products"
 *  - "/api/products" -> "/api/products"
 *  - "/upload" -> "/api/upload" (common Strapi endpoint)
 */
function ensureApiPrefix(path) {
  const p = ensureLeadingSlash(path);
  if (p === "/api" || p.startsWith("/api/")) return p;
  return `/api${p}`;
}

function getWriteToken() {
  const t =
    process.env.STRAPI_WRITE_TOKEN ||
    process.env.STRAPI_ADMIN_TOKEN ||
    process.env.STRAPI_WRITE_API_TOKEN ||
    "";

  const token = String(t ?? "").trim();
  if (!token) {
    throw new Error(
      "Missing Strapi WRITE token. Set STRAPI_WRITE_TOKEN (recommended) or STRAPI_ADMIN_TOKEN or STRAPI_WRITE_API_TOKEN."
    );
  }
  return token;
}

const RAW_STRAPI_URL =
  process.env.STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  "";

export const STRAPI_WRITE_URL = normalizeBaseUrl(RAW_STRAPI_URL);

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new Error("Timeout")), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    const code = err?.cause?.code || err?.code || "";
    const msg = err?.message || "fetch failed";
    throw new Error(`STRAPI_WRITE_FETCH_FAILED: ${code || msg} @ ${url}`);
  } finally {
    clearTimeout(t);
  }
}

async function readResponseBody(res) {
  const ct = String(res.headers.get("content-type") || "");
  const text = await res.text().catch(() => "");

  if (!text) return { json: null, text: "" };

  if (ct.includes("application/json")) {
    try {
      return { json: JSON.parse(text), text };
    } catch {
      return { json: null, text };
    }
  }

  // Some Strapi errors can still be JSON-ish without correct header
  try {
    const j = JSON.parse(text);
    return { json: j, text };
  } catch {
    return { json: null, text };
  }
}

function buildQuery(query) {
  if (!query || typeof query !== "object") return "";
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    const key = String(k);
    const val = Array.isArray(v) ? v.map((x) => String(x)) : [String(v)];
    for (const one of val) usp.append(key, one);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Low-level request.
 * - If body is a plain object and json=true (default), it will be JSON.stringified.
 * - If body is FormData, headers won't force content-type.
 */
export async function strapiWriteRequest(path, opts = {}) {
  const {
    method = "GET",
    headers = {},
    query,
    body,
    json = true,
    token, // optional override
  } = opts || {};

  const p = ensureApiPrefix(path);
  const qs = buildQuery(query);
  const url = `${STRAPI_WRITE_URL}${p}${qs}`;

  const bearer = String(token ?? "").trim() || getWriteToken();

  const isForm =
    typeof FormData !== "undefined" && body instanceof FormData;

  const h = {
    Accept: "application/json",
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    Authorization: `Bearer ${bearer}`,
    ...(headers || {}),
  };

  const init = {
    method: String(method || "GET").toUpperCase(),
    headers: h,
  };

  if (body !== undefined) {
    if (isForm) {
      init.body = body;
      // Do NOT set content-type for FormData; fetch will set boundary
      if (init.headers && init.headers["Content-Type"]) delete init.headers["Content-Type"];
      if (init.headers && init.headers["content-type"]) delete init.headers["content-type"];
    } else if (typeof body === "string" || body instanceof Uint8Array) {
      init.body = body;
    } else if (json) {
      init.body = JSON.stringify(body);
    } else {
      init.body = body;
    }
  }

  const res = await fetchWithTimeout(url, init);
  const { json: parsed, text } = await readResponseBody(res);

  if (!res.ok) {
    // Strapi v4 error format: { error: { status, name, message, details } }
    const msg =
      parsed?.error?.message ||
      parsed?.message ||
      text ||
      res.statusText ||
      "Strapi write failed";

    const err = new Error(`STRAPI_WRITE_${res.status}: ${msg} @ ${url}`);
    err.status = res.status;
    err.url = url;
    err.payload = parsed ?? null;
    throw err;
  }

  return parsed ?? (text ? { data: text } : { data: null });
}

/**
 * Convenience: create entry in a collection-type.
 * POST /api/<collection>
 * Body: { data: {...} }
 */
export async function strapiCreate(collection, data, opts = {}) {
  const c = String(collection ?? "").trim();
  if (!c) throw new Error("strapiCreate: collection is required");

  return strapiWriteRequest(`/${c}`, {
    ...opts,
    method: "POST",
    body: { data: data ?? {} },
    json: true,
  });
}

/**
 * Convenience: update entry by id.
 * PUT /api/<collection>/:id
 * Body: { data: {...} }
 */
export async function strapiUpdate(collection, id, data, opts = {}) {
  const c = String(collection ?? "").trim();
  const i = String(id ?? "").trim();
  if (!c) throw new Error("strapiUpdate: collection is required");
  if (!i) throw new Error("strapiUpdate: id is required");

  return strapiWriteRequest(`/${c}/${encodeURIComponent(i)}`, {
    ...opts,
    method: "PUT",
    body: { data: data ?? {} },
    json: true,
  });
}

/**
 * Convenience: delete entry by id.
 * DELETE /api/<collection>/:id
 */
export async function strapiDelete(collection, id, opts = {}) {
  const c = String(collection ?? "").trim();
  const i = String(id ?? "").trim();
  if (!c) throw new Error("strapiDelete: collection is required");
  if (!i) throw new Error("strapiDelete: id is required");

  return strapiWriteRequest(`/${c}/${encodeURIComponent(i)}`, {
    ...opts,
    method: "DELETE",
  });
}

/**
 * Publish/unpublish (Strapi v4):
 * - publish: set publishedAt to now ISO string
 * - unpublish: set publishedAt to null
 */
export async function strapiSetPublished(collection, id, published, opts = {}) {
  const pub = Boolean(published);
  return strapiUpdate(
    collection,
    id,
    { publishedAt: pub ? new Date().toISOString() : null },
    opts
  );
}

/**
 * Upload files to Strapi
 * POST /api/upload
 *
 * Accepts Web File(s) (from Request.formData()) or Blob.
 *
 * Options:
 *  - ref: content-type UID e.g. "api::product.product"
 *  - refId: numeric/string entry id
 *  - field: media field name e.g. "gallery"
 */
export async function strapiUpload(files, { ref, refId, field, ...meta } = {}, opts = {}) {
  const arr = Array.isArray(files) ? files : [files];
  const list = arr.filter(Boolean);
  if (!list.length) throw new Error("strapiUpload: at least one file is required");

  const fd = new FormData();
  for (const f of list) {
    // f can be File/Blob; Strapi expects field name "files"
    fd.append("files", f);
  }

  if (ref) fd.append("ref", String(ref));
  if (refId != null) fd.append("refId", String(refId));
  if (field) fd.append("field", String(field));

  // Any extra metadata (optional)
  for (const [k, v] of Object.entries(meta || {})) {
    if (v == null) continue;
    fd.append(String(k), String(v));
  }

  return strapiWriteRequest("/upload", {
    ...opts,
    method: "POST",
    body: fd,
    json: false,
  });
}

export default {
  STRAPI_WRITE_URL,
  strapiWriteRequest,
  strapiCreate,
  strapiUpdate,
  strapiDelete,
  strapiSetPublished,
  strapiUpload,
};
