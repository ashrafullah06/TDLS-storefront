// app/api/wallet/transfer/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";                  // :contentReference[oaicite:8]{index=8}
import { requireAdmin } from "@/lib/auth";          // :contentReference[oaicite:9]{index=9}
import { walletDelta, ensureWalletAndAccount } from "@/lib/loyalty"; // :contentReference[oaicite:10]{index=10}

export const dynamic = "force-dynamic";

export async function POST(req) {
  await requireAdmin(req);
  const { fromUserId, toUserId, amount, reason, reference, metadata } = await req.json().catch(() => ({}));
  if (!fromUserId || !toUserId || !amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "fromUserId, toUserId, positive amount required" }, { status: 400 });
  }
  // single transaction for atomicity
  await prisma.$transaction(async (trx) => {
    await ensureWalletAndAccount(fromUserId, trx);
    await ensureWalletAndAccount(toUserId, trx);
    await walletDelta(fromUserId, -amount, reason || "TRANSFER_OUT", reference || "admin-transfer", metadata || {}, trx);
    await walletDelta(toUserId, amount, reason || "TRANSFER_IN", reference || "admin-transfer", metadata || {}, trx);
  });
  return NextResponse.json({ ok: true });
}
