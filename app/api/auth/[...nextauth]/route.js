// FILE: my-project/app/api/auth/[...nextauth]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Extra hardening against caching of /api/auth/* responses
export const fetchCache = "force-no-store";

/**
 * Customer Auth Router (NextAuth/Auth.js)
 *
 * IMPORTANT:
 * - We intentionally avoid a static named import like:
 *     import { handlers } from "@/lib/auth";
 *   because you are moving toward FULL SEPARATION (customer vs admin),
 *   and we want this route to automatically pick the customer-only handlers
 *   once we add them in "@/lib/auth" (without breaking builds right now).
 *
 * Resolution priority:
 *  1) mod.customerHandlers / mod.handlersCustomer / mod.customerAuthHandlers
 *  2) fallback to mod.handlers (current shared config)
 */

function jsonError(message, status = 500, extra = {}) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: message,
      ...extra,
    }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0, must-revalidate",
        pragma: "no-cache",
        expires: "0",
        vary: "origin, cookie",
        "x-tdls-auth-router": "customer-router-v3",
      },
    }
  );
}

function withNoStoreHeaders(res) {
  // Preserve Set-Cookie and all existing headers; only normalize cache headers.
  const h = new Headers(res.headers);

  h.set("cache-control", "no-store, max-age=0, must-revalidate");
  h.set("pragma", "no-cache");
  h.set("expires", "0");

  // Ensure auth responses vary properly across cookies/origin
  const vary = (h.get("vary") || "").toLowerCase();
  if (!vary.includes("cookie")) {
    h.set("vary", vary ? `${h.get("vary")}, cookie` : "cookie");
  }
  if (!vary.includes("origin")) {
    h.set("vary", h.get("vary") ? `${h.get("vary")}, origin` : "origin");
  }

  h.set("x-tdls-auth-router", "customer-router-v3");

  // Return a new Response that streams the original body while keeping Set-Cookie.
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: h,
  });
}

/**
 * Cache the resolved handlers in-process (node runtime) to reduce import churn.
 * This does NOT affect cookie/session behavior; it only increases stability/perf.
 */
let cachedHandlersPromise = null;

async function resolveHandlers() {
  if (!cachedHandlersPromise) {
    cachedHandlersPromise = (async () => {
      let mod;
      try {
        mod = await import("@/lib/auth");
      } catch (e) {
        return { __error: e };
      }

      const customer =
        mod.customerHandlers ||
        mod.handlersCustomer ||
        mod.customerAuthHandlers ||
        mod.customer_auth_handlers ||
        null;

      const handlers = customer || mod.handlers;

      if (!handlers?.GET || !handlers?.POST) {
        return {
          __missing: true,
          availableExports: Object.keys(mod || {}).sort(),
        };
      }

      return { handlers };
    })();
  }

  return cachedHandlersPromise;
}

export async function GET(req) {
  const resolved = await resolveHandlers();

  if (resolved.__error) {
    // reset cache so a transient load failure can recover after redeploy
    cachedHandlersPromise = null;
    return jsonError("AUTH_IMPORT_FAILED", 500, {
      hint:
        "Failed to import '@/lib/auth'. Paste your my-project/src/lib/auth.js (or lib/auth.js).",
    });
  }

  if (resolved.__missing) {
    cachedHandlersPromise = null;
    return jsonError("AUTH_HANDLERS_NOT_FOUND", 500, {
      hint:
        "Expected exports in '@/lib/auth' to contain either customer handlers " +
        "(customerHandlers/handlersCustomer/customerAuthHandlers/customer_auth_handlers) " +
        "or fallback handlers.",
      availableExports: resolved.availableExports,
    });
  }

  const res = await resolved.handlers.GET(req);
  return withNoStoreHeaders(res);
}

export async function POST(req) {
  const resolved = await resolveHandlers();

  if (resolved.__error) {
    cachedHandlersPromise = null;
    return jsonError("AUTH_IMPORT_FAILED", 500, {
      hint:
        "Failed to import '@/lib/auth'. Paste your my-project/src/lib/auth.js (or lib/auth.js).",
    });
  }

  if (resolved.__missing) {
    cachedHandlersPromise = null;
    return jsonError("AUTH_HANDLERS_NOT_FOUND", 500, {
      hint:
        "Expected exports in '@/lib/auth' to contain either customer handlers " +
        "(customerHandlers/handlersCustomer/customerAuthHandlers/customer_auth_handlers) " +
        "or fallback handlers.",
      availableExports: resolved.availableExports,
    });
  }

  const res = await resolved.handlers.POST(req);
  return withNoStoreHeaders(res);
}
