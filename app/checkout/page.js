// FILE: app/checkout/page.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies, headers } from "next/headers";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

// Client UI
import CheckoutPage from "@/components/checkout/checkout-page";

// Must match the cookie name used in /api/cart/sync and other cart APIs
const SID_COOKIE = "tdlc_sid";

/**
 * Read the guest session cookie (if any).
 * Next.js 15: cookies() must be awaited.
 */
async function readGuestCookie() {
  const jar = await cookies();
  return jar.get(SID_COOKIE)?.value || null;
}

/**
 * Best-effort resolve ACTIVE cart for either:
 * - Logged-in user (userId)
 * - Guest session (sid)
 */
async function getActiveCart({ userId, sid }) {
  const orClauses = [];
  if (userId) orClauses.push({ userId });
  if (sid) orClauses.push({ sessionId: sid });

  if (!orClauses.length) return null;

  return prisma.cart.findFirst({
    where: {
      status: "ACTIVE",
      OR: orClauses,
    },
    orderBy: { updatedAt: "desc" },
    include: {
      items: true,
      promotions: { include: { promotion: true } },
      shippingAddress: true,
      billingAddress: true,
    },
  });
}

/**
 * Build a same-origin base URL (works in prod + local).
 * Next.js 15: headers() must be awaited.
 */
async function getBaseUrl() {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || "http";
  const host = h.get("x-forwarded-host") || h.get("host");

  // Dev fallback (host can be missing in some edge test contexts)
  if (!host) return "http://localhost:3000";

  return `${proto}://${host}`;
}

/**
 * SSR preload address-book meta so the checkout page can render addresses immediately.
 * Uses your canonical API: /api/customers/address-book
 *
 * Returns null on any failure (client can still re-fetch as fallback).
 */
async function preloadAddressBookMeta() {
  const h = await headers();
  const cookieHeader = h.get("cookie") || "";
  const baseUrl = await getBaseUrl();

  const res = await fetch(`${baseUrl}/api/customers/address-book`, {
    method: "GET",
    cache: "no-store",
    headers: {
      // forward auth cookies to the API route
      cookie: cookieHeader,
    },
  }).catch(() => null);

  if (!res || !res.ok) return null;

  const json = await res.json().catch(() => null);
  if (!json || !Array.isArray(json.addresses)) return null;

  return {
    ok: !!json.ok,
    addresses: json.addresses,
    defaultAddress: json.defaultAddress ?? null,
    defaultId: json.defaultId ?? null,
  };
}

export default async function Checkout() {
  // 1) read session (if signed in)
  const session = await auth().catch(() => null);
  const userId = session?.user?.id || null;

  // Provide client enough session info to avoid waiting for /api/auth/session
  const initialSessionUser = userId
    ? {
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        phone: session.user.phone || "",
        phoneVerified: !!(session.user.phoneVerified || session.user.phoneVerifiedAt),
      }
    : null;

  // 2) read guest cookie (if it exists)
  const sid = await readGuestCookie();

  // 3) Preload cart + address-book in parallel (address-book only for logged-in user)
  const [cart, initialAddressMeta] = await Promise.all([
    getActiveCart({ userId, sid }).catch(() => null),
    userId ? preloadAddressBookMeta().catch(() => null) : Promise.resolve(null),
  ]);

  // 4) Render client UI with serverCartId + preloaded addresses
  return (
    <CheckoutPage
      serverCartId={cart?.id || null}
      initialAddressMeta={initialAddressMeta}
      initialSessionUser={initialSessionUser}
    />
  );
}