// FILE: app/api/auth/session/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

function json(body, status = 200) {
  return new Response(body === undefined ? "null" : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // be extra-safe against any proxy/browser caching
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
      "surrogate-control": "no-store",
    },
  });
}

export async function GET() {
  try {
    // NextAuth expects /api/auth/session to return:
    // - the session object, OR
    // - null
    const session = await auth();

    if (!session?.user?.id) {
      return json(null, 200);
    }

    // Always refresh critical fields from DB so UI is up-to-date after OTP
    const fresh = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        phoneVerifiedAt: true,
        defaultAddressId: true,
        // add anything else your checkout/UI needs here (select only)
      },
    });

    // Safety: if user record disappeared, treat as signed out
    if (!fresh) return json(null, 200);

    // Merge fresh fields into session.user (do not mutate session object)
    const merged = {
      ...session,
      user: {
        ...session.user,
        id: fresh.id,
        name: fresh.name ?? session.user.name ?? null,
        email: fresh.email ?? session.user.email ?? null,
        phone: fresh.phone ?? session.user.phone ?? null,
        phoneVerifiedAt: fresh.phoneVerifiedAt ?? null,
        defaultAddressId: fresh.defaultAddressId ?? null,
        // Stable derived flag so the UI can reliably hide the “verify” prompt
        phoneVerified: Boolean(fresh.phoneVerifiedAt),
      },
    };

    // IMPORTANT: return the session object itself (NextAuth-compatible)
    return json(merged, 200);
  } catch {
    // IMPORTANT: return null (NextAuth-compatible)
    return json(null, 200);
  }
}
