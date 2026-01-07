// FILE: my-project/app/api/auth/[...nextauth]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
 *
 * Next file you should paste: my-project/src/lib/auth.js (or my-project/lib/auth.js)
 * so I can split it into customer + admin handlers and stop coupling permanently.
 */

async function resolveHandlers() {
  const mod = await import("@/lib/auth");

  // Future separated exports (safe even if missing)
  const customer =
    mod.customerHandlers ||
    mod.handlersCustomer ||
    mod.customerAuthHandlers ||
    mod.customer_auth_handlers ||
    null;

  const handlers = customer || mod.handlers;

  if (!handlers?.GET || !handlers?.POST) {
    throw new Error(
      "Auth handlers not found. Expected { GET, POST } in '@/lib/auth' exports."
    );
  }

  return handlers;
}

export async function GET(req) {
  const handlers = await resolveHandlers();
  return handlers.GET(req);
}

export async function POST(req) {
  const handlers = await resolveHandlers();
  return handlers.POST(req);
}
