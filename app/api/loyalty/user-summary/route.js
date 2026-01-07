// app/api/loyalty/user-summary/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";
import { requireAuth } from "@/lib/auth";
import { ensureWalletAndAccount, TIER_BANDS } from "@/lib/loyalty";

export async function GET(req) {
  try {
    const auth = await requireAuth(req);
    const userId =
      auth?.userId ??
      auth?.id ??
      (typeof auth === "string" ? auth : undefined);

    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // make sure wallet/loyalty scaffolding exists for this user
    await ensureWalletAndAccount(userId);

    // loyalty account with recent transactions
    const account = await prisma.loyaltyAccount.findUnique({
      where: { userId },
      include: { transactions: { orderBy: { at: "desc" }, take: 50 } },
    });

    // if the helper created it on the fly but it hasn't been read yet
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "Loyalty account not found for user." },
        { status: 404 }
      );
    }

    const tier = account.tier;
    const current = account.currentPoints;
    const idx = TIER_BANDS.findIndex((t) => t.tier === tier);
    const nextTier =
      idx >= 0 && idx < TIER_BANDS.length - 1 ? TIER_BANDS[idx + 1] : null;
    const pointsToNextTier = nextTier ? Math.max(0, nextTier.min - current) : 0;

    return NextResponse.json({
      ok: true,
      current_points: current,
      tier,
      next_tier: nextTier ? nextTier.tier : null,
      points_to_next_tier: nextTier ? pointsToNextTier : null,
      total_redeemed: account.lifetimeRedeemed,
      point_history: account.transactions,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal Server Error" },
      { status: e?.status || 500 }
    );
  }
}
