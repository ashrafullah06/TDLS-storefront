// app/api/wallet/balance/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma-client";
import { requireAuth } from "@/lib/auth";
import { ensureWalletAndAccount } from "@/lib/loyalty";

export async function GET(req) {
  try {
    // If your requireAuth expects the Request, pass req; otherwise remove the arg.
    const user = await requireAuth(req);

    const userId =
      user?.id ??
      user?.userId ??
      (typeof user === "string" ? user : undefined);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ensure a wallet/account exists for this user
    const wallet = await ensureWalletAndAccount(userId);

    // Read current balance — adjust the model names/fields if your schema differs
    const balanceRow = await prisma.walletBalance.findUnique({
      where: { walletId: wallet.id },
    });

    return NextResponse.json({
      walletId: wallet.id,
      balance: balanceRow?.amount ?? 0,
      currency: balanceRow?.currency ?? "BDT",
    });
  } catch (err) {
    console.error("[api/wallet/balance] GET error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
