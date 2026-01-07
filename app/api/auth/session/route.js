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
    // 1) get the current session (JWT may be stale)
    const session = await auth();

    if (!session?.user?.id) {
      return json({ ok: true, user: null, session: null }, 200);
    }

    // 2) always refresh critical fields from DB so UI is up-to-date after OTP
    const fresh = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        phoneVerifiedAt: true,
        defaultAddressId: true,
        // add anything else your checkout/UI needs
      },
    });

    // safety: if user record disappeared, treat as signed out
    if (!fresh) return json({ ok: true, user: null, session: null }, 200);

    // 3) merge fresh fields into session.user (without mutating original object structure)
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
        // stable derived flag so the UI can reliably hide the “verify” prompt
        phoneVerified: Boolean(fresh.phoneVerifiedAt),
      },
    };

    return json({ ok: true, user: merged.user, session: merged }, 200);
  } catch {
    // Never return empty body; always return JSON so callers don't crash
    return json({ ok: true, user: null, session: null }, 200);
  }
}
