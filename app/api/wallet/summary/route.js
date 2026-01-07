export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(req) {
  const url = new URL(req.url);
  let userId = url.searchParams.get("userId");

  // If userId not provided explicitly, try to infer from logged-in user
  if (!userId) {
    try {
      const session = await auth();
      if (session?.user?.id) {
        userId = session.user.id;
      }
    } catch {
      // ignore auth errors here; we'll handle missing userId below
    }
  }

  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        error: "USER_ID_REQUIRED",
        detail: "Provide a userId query parameter or be logged in.",
      },
      { status: 401 }
    );
  }

  try {
    // Wallet is keyed by userId (1:1)
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    // If wallet does not exist yet, return zero state
    if (!wallet) {
      return NextResponse.json(
        {
          ok: true,
          userId,
          walletId: null,
          balance: 0,
          txns: [],
        },
        { status: 200 }
      );
    }

    // Latest 50 transactions for this wallet
    const txns = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { at: "desc" },
      take: 50,
      select: {
        id: true,
        delta: true,
        reason: true,
        reference: true,
        metadata: true,
        at: true,
      },
    });

    // Use Wallet.balance as canonical balance
    const balance = Number(wallet.balance || 0);

    return NextResponse.json(
      {
        ok: true,
        userId,
        walletId: wallet.id,
        balance,
        txns,
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "WALLET_SUMMARY_UNAVAILABLE",
        detail: String(e),
      },
      { status: 503 }
    );
  }
}
