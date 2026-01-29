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
      // strict anti-cache (production correctness)
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
      "surrogate-control": "no-store",
      vary: "cookie",
      "x-tdlc-session": "v2",
    },
  });
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function normalizePhone(p) {
  const s = String(p || "").trim();
  if (!s) return "";
  // keep it light: DB already stores normalized; this just avoids obvious whitespace issues
  return s.replace(/\s+/g, "");
}

export async function GET() {
  try {
    const session = await auth();

    const u = session?.user || null;
    if (!u) return json(null, 200);

    // Production may store identifier in sub/userId/etc.
    let userId = pickFirstNonEmpty(u.id, u.sub, u.userId, u.uid, u.customerId);
    const email = pickFirstNonEmpty(u.email);
    const phone = normalizePhone(pickFirstNonEmpty(u.phone, u.mobile, u.phoneNumber));

    // If we still don't have a usable id, fall back to DB lookup by email/phone
    let fresh = null;

    if (userId) {
      fresh = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          phoneVerifiedAt: true,
          defaultAddressId: true,
        },
      });
    }

    if (!fresh && email) {
      fresh = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          phoneVerifiedAt: true,
          defaultAddressId: true,
        },
      });
    }

    if (!fresh && phone) {
      fresh = await prisma.user.findUnique({
        where: { phone },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          phoneVerifiedAt: true,
          defaultAddressId: true,
        },
      });
    }

    // If user record is missing, treat as signed out
    if (!fresh?.id) return json(null, 200);

    // Ensure downstream features (Orders & History) always get a stable DB user id
    const merged = {
      ...session,
      user: {
        ...u,
        id: fresh.id,
        // keep sub if present (some clients rely on it), but id is canonical
        sub: u.sub ?? null,
        name: fresh.name ?? u.name ?? null,
        email: fresh.email ?? u.email ?? null,
        phone: fresh.phone ?? u.phone ?? null,
        phoneVerifiedAt: fresh.phoneVerifiedAt ?? null,
        defaultAddressId: fresh.defaultAddressId ?? null,
        phoneVerified: Boolean(fresh.phoneVerifiedAt),
      },
    };

    return json(merged, 200);
  } catch {
    // NextAuth-compatible: return null on error
    return json(null, 200);
  }
}
