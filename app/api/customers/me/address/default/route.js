// app/api/customers/me/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import authOptions from "@/lib/auth";

/**
 * Minimal, safe unification:
 * - If caller is ADMIN and provides ?user_id=... or header x-user-id, read that user.
 * - Otherwise, return the current session user's summary (no override).
 * - Shape preserved: { id, email, phone, tier, points, referral_id }
 */

function getRequestedUserId(req) {
  const url = new URL(req.url);
  return url.searchParams.get("user_id") || req.headers.get("x-user-id") || null;
}

function isAdmin(session) {
  if (!session?.user) return false;
  const role = session.user.role || (Array.isArray(session.user.roles) ? session.user.roles[0] : null);
  return role === "admin" || role === "superadmin";
}

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);

    // Decide target user
    let targetUserId = null;

    const requested = getRequestedUserId(req);
    if (requested && isAdmin(session)) {
      // Admin may inspect any user via user_id/x-user-id
      targetUserId = requested;
    } else {
      // Otherwise, must be signed-in and we use session user only
      if (!session?.user?.id) {
        // Preserve old behavior: previously 401 when missing user_id;
        // now we standardize to not exposing anything without a session.
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      targetUserId = session.user.id;
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { loyaltyAccount: true },
    });

    if (!user) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Preserve original payload keys (no placeholders)
    const payload = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      tier: user.loyaltyAccount?.tier || null,
      points: user.loyaltyAccount?.currentPoints ?? 0,
      referral_id: null, // keep as-is; wire real value when available
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    console.error("[GET /api/customers/me] ", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
