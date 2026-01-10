// FILE: app/api/customers/me/address/default/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/**
 * Returns the user's default address.
 * - Admin can inspect another user via ?user_id= or x-user-id header (same rule as /api/customers/me).
 * - Otherwise returns the signed-in user's own default address.
 */

function getRequestedUserId(req) {
  const url = new URL(req.url);
  return url.searchParams.get("user_id") || req.headers.get("x-user-id") || null;
}

function isAdmin(session) {
  if (!session?.user) return false;
  const role =
    session.user.role ||
    (Array.isArray(session.user.roles) ? session.user.roles[0] : null);
  return role === "admin" || role === "superadmin";
}

const DEFAULT_ADDRESS_SELECT = {
  id: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  countryIso2: true,
  phone: true,
  label: true,
};

export async function GET(req) {
  try {
    const session = await auth();

    // Decide target user (aligned with /api/customers/me)
    let targetUserId = null;
    const requested = getRequestedUserId(req);

    if (requested && isAdmin(session)) {
      targetUserId = requested;
    } else {
      const selfId =
        session?.user?.id || session?.user?.uid || session?.user?.sub || null;

      if (!selfId) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      targetUserId = selfId;
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        defaultAddress: { select: DEFAULT_ADDRESS_SELECT },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json(
      { defaultAddress: user.defaultAddress || null },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/customers/me/address/default] ", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
