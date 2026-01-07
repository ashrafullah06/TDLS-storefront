// app/api/rewards/route.js
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma-client";
import { requireAuth } from "../../../../lib/auth";
import { ensureWalletAndAccount } from "../../../../lib/loyalty";

export async function GET(req) {
  try {
    const { userId } = await requireAuth(req);
    await ensureWalletAndAccount(userId);
    const [account, txns] = await Promise.all([
      prisma.loyaltyAccount.findUnique({ where: { userId }, select: { currentPoints: true, lifetimeEarned: true, lifetimeRedeemed: true, tier: true } }),
      prisma.loyaltyTransaction.findMany({ where: { account: { userId } }, orderBy: { at: "desc" }, take: 100 }),
    ]);
    return NextResponse.json({ ok: true, account, transactions: txns });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
