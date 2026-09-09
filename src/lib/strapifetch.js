// FILE: src/lib/strapifetch.js

import { normalizeProductPath } from "./product-query";

function normalizeBase(raw) {
  let base = String(raw || "").trim();

  if (!base) {
    return "";
  }

  if (!/^https?:\/\//i.test(base)) {
    const protocol =
      process.env.NODE_ENV === "production"
        ? "https"
        : "http";

    base = `${protocol}://${base}`;
  }

  return base
    .replace(
      /^http:\/\/localhost(?=[/:]|$)/i,
      "http://127.0.0.1"
    )
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

function serverBase() {
  const base = normalizeBase(
    process.env.STRAPI_API_ORIGIN ||
      process.env.STRAPI_URL ||
      process.env.STRAPI_API_URL ||
      process.env.NEXT_PUBLIC_STRAPI_URL ||
      process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
      process.env.NEXT_PUBLIC_STRAPI_API_URL ||
      process.env.NEXT_PUBLIC_STRAPI_API_ORIGIN ||
      (
        process.env.NODE_ENV !== "production"
          ? "http://127.0.0.1:1337"
          : ""
      )
  );

  if (!base) {
    throw new Error(
      "Strapi server URL is not configured."
    );
  }

  return base;
}

export async function fetchStrapi(
  path,
  opts = {}
) {
  const browser =
    typeof window !== "undefined";

  const {
    timeoutMs = 10000,
    signal,
    ...init
  } = opts;

  const numericTimeout = Number(timeoutMs);

  const deadline =
    Number.isFinite(numericTimeout) &&
    numericTimeout > 0
      ? Math.min(30000, numericTimeout)
      : 10000;

  const absolute = /^https?:\/\//i.test(
    String(path)
  );

  const requested = absolute
    ? new URL(path)
    : null;

  let apiPath = requested
    ? `${requested.pathname}${requested.search}`
    : String(path || "");

  apiPath =
    "/" +
    apiPath
      .replace(/^\/+/, "")
      .replace(/^api\//i, "");

  const method = String(
    init.method || "GET"
  ).toUpperCase();

  if (method === "GET") {
    apiPath = normalizeProductPath(apiPath);
  }

  const headers = new Headers(
    init.headers || {}
  );

  if (!headers.has("Accept")) {
    headers.set(
      "Accept",
      "application/json"
    );
  }

  let url;

  if (browser && method === "GET") {
    // Browsers use the same-origin proxy.
    // Never ship a CMS token to a browser.
    headers.delete("Authorization");

    const query = new URLSearchParams({
      path: apiPath,
    });

    if (init.cache === "no-store") {
      query.set("noCache", "1");
    }

    url = `/api/strapi?${query}`;
  } else {
    const base = serverBase();

    if (
      requested &&
      requested.origin !==
        new URL(base).origin
    ) {
      throw new Error(
        "Strapi URL does not match the configured server origin."
      );
    }

    url = `${base}/api${apiPath}`;

    const token = browser
      ? ""
      : (
          process.env.STRAPI_API_TOKEN ||
          process.env.STRAPI_TOKEN ||
          process.env.STRAPI_GRAPHQL_TOKEN ||
          ""
        );

    if (
      token &&
      !headers.has("Authorization")
    ) {
      headers.set(
        "Authorization",
        `Bearer ${token.trim()}`
      );
    }
  }

  const controller = new AbortController();

  const abort = () => {
    controller.abort();
  };

  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener(
      "abort",
      abort,
      { once: true }
    );
  }

  const timer = setTimeout(
    abort,
    deadline
  );

  try {
    const options = {
      ...init,
      method,
      headers,
      signal: controller.signal,
    };

    if (
      options.cache == null &&
      !options.next
    ) {
      options.cache = "no-store";
    }

    const response = await fetch(
      url,
      options
    );

    // The deadline covers body consumption
    // as well as response headers.
    const text = await response.text();

    if (!response.ok) {
      const error = new Error(
        `Strapi request failed (HTTP ${response.status}).`
      );

      error.status = response.status;

      throw error;
    }

    if (response.status === 204) {
      return { data: null };
    }

    let json;

    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        "Strapi returned an invalid JSON response."
      );
    }

    if (
      json?.ok === false ||
      json?.error
    ) {
      throw new Error(
        "Strapi returned an API error."
      );
    }

    // The proxy returns:
    // { ok: true, data: { data: [], meta: {...} } }
    //
    // Direct Strapi requests already return:
    // { data: [], meta: {...} }
    return json?.ok === true
      ? json.data
      : json;
  } finally {
    clearTimeout(timer);

    signal?.removeEventListener(
      "abort",
      abort
    );
  }
}

export default fetchStrapi;