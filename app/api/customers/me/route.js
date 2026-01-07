// FILE: app/api/customers/me/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/** Allow admins to inspect another user via ?user_id= or x-user-id header */
function getRequestedUserId(req) {
  const url = new URL(req.url);
  return (
    url.searchParams.get("user_id") ||
    req.headers.get("x-user-id") ||
    null
  );
}

function isAdmin(session) {
  if (!session?.user) return false;

  // support both single "role" and "roles" array
  const role =
    session.user.role ||
    (Array.isArray(session.user.roles) ? session.user.roles[0] : null);

  return role === "admin" || role === "superadmin";
}

// Common include shape so both findUnique + update stay in sync
const USER_INCLUDE = {
  loyaltyAccount: {
    select: {
      tier: true,
      currentPoints: true,
      lifetimeEarned: true,
      lifetimeRedeemed: true,
    },
  },
  // default customer-side address (mirrors auth.js selection)
  defaultAddress: {
    select: {
      id: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      countryIso2: true,
      phone: true,
      label: true,
    },
  },
  // wallet snapshot (mirrors auth.js)
  wallet: {
    select: {
      balance: true,
    },
  },
};

export async function GET(req) {
  try {
    const session = await auth();

    // ───────────────── resolve target user id ─────────────────
    let targetUserId = null;
    const requested = getRequestedUserId(req);

    if (requested && isAdmin(session)) {
      // admin can inspect arbitrary user
      targetUserId = requested;
    } else {
      // normal customers → always themselves
      const selfId =
        session?.user?.id ||
        session?.user?.uid ||
        session?.user?.sub ||
        null;
      if (!selfId) {
        return NextResponse.json(
          { error: "unauthorized" },
          { status: 401 }
        );
      }
      targetUserId = selfId;
    }

    // ───────────────── load user (real DB) ─────────────────
    let user = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: USER_INCLUDE,
    });

    if (!user) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404 }
      );
    }

    // ───────────────── ensure referral/customerCode exists ─────────────────
    // Uses simple incremental CUST-000001, CUST-000002, ...
    if (!user.customerCode) {
      try {
        const last = await prisma.user.findFirst({
          where: {
            customerCode: {
              startsWith: "CUST-",
            },
          },
          orderBy: {
            customerCode: "desc",
          },
          select: {
            customerCode: true,
          },
        });

        let nextNum = 1;
        if (last?.customerCode) {
          const m = last.customerCode.match(/CUST-(\d+)/);
          if (m) {
            const current = parseInt(m[1], 10);
            if (Number.isFinite(current) && current > 0) {
              nextNum = current + 1;
            }
          }
        }

        const code = `CUST-${String(nextNum).padStart(6, "0")}`;

        // update this user with the new code and re-load
        user = await prisma.user.update({
          where: { id: targetUserId },
          data: { customerCode: code },
          include: USER_INCLUDE,
        });
      } catch (err) {
        console.error(
          "[GET /api/customers/me] failed to set customerCode",
          err
        );
        // in case of unique conflict or other error, just reload
        user = await prisma.user.findUnique({
          where: { id: targetUserId },
          include: USER_INCLUDE,
        });
      }
    }

    // ───────────────── build stable payload used across checkout/account ─────────────────
    const loyalty = user.loyaltyAccount || null;
    const tier = loyalty?.tier ?? null;
    const points =
      typeof loyalty?.currentPoints === "number"
        ? loyalty.currentPoints
        : 0;

    const wallet = user.wallet || null;
    const defaultAddress = user.defaultAddress || null;

    const payload = {
      // core identity
      id: user.id,
      name: user.name, // so dashboard can override stale session name
      email: user.email,
      phone: user.phone,
      phoneVerified: !!user.phoneVerifiedAt,

      // extra profile info (already in DB / session)
      gender: user.gender ?? null,
      dob: user.dob ?? null,
      createdAt: user.createdAt
        ? user.createdAt.toISOString()
        : null,
      loginPreference: user.loginPreference ?? null,

      // customer type + RBAC hint (for UI)
      kind: user.kind || null, // e.g. "CUSTOMER_ONLY" | "CUSTOMER_AND_STAFF"
      isAdmin: isAdmin(session),

      // loyalty snapshot
      tier,
      points,
      loyalty: loyalty
        ? {
            tier: loyalty.tier,
            currentPoints: loyalty.currentPoints ?? 0,
            lifetimeEarned: loyalty.lifetimeEarned ?? 0,
            lifetimeRedeemed: loyalty.lifetimeRedeemed ?? 0,
          }
        : null,

      // wallet snapshot (for wallet UI / checkout)
      wallet: wallet
        ? {
            balance: wallet.balance ?? 0,
          }
        : null,

      // default address snapshot (for checkout + address book prefill)
      defaultAddress: defaultAddress
        ? {
            id: defaultAddress.id,
            line1: defaultAddress.line1,
            line2: defaultAddress.line2,
            city: defaultAddress.city,
            state: defaultAddress.state,
            postalCode: defaultAddress.postalCode,
            countryIso2: defaultAddress.countryIso2,
            phone: defaultAddress.phone,
            label: defaultAddress.label,
          }
        : null,

      // referral / customer code
      customerCode: user.customerCode || null,
      referral_code: user.customerCode || null,
      referral_id: user.customerCode || null,
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        // ensure the client never caches this
        "cache-control":
          "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } catch (err) {
    console.error("[GET /api/customers/me]", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
