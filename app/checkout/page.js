// FILE: app/checkout/page.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { cookies } from "next/headers";
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

export default async function Checkout() {
  // 1) read session (if signed in)
  const session = await auth().catch(() => null);
  const userId = session?.user?.id || null;

  // 2) read guest cookie (if it exists)
  const sid = await readGuestCookie();

  // 3) Best-effort resolve ACTIVE cart (don’t redirect if missing)
  const cart = await getActiveCart({ userId, sid }).catch(() => null);

  // 4) Render your existing client UI. We pass serverCartId for future use.
  return <CheckoutPage serverCartId={cart?.id || null} />;
}
