// FILE: app/api/wallet/adjust/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { userId, amount, reason, reference, metadata } = body || {};
  if (!userId || typeof amount !== "number" || amount === 0) {
    return NextResponse.json({ error: "userId and non-zero amount required" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (trx) => {
      // ensure user wallet row if your schema needs it
      try {
        await trx.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
      } catch (_) { /* wallet table may not exist; fine to skip */ }

      await trx.walletTransaction.create({
        data: {
          userId,
          delta: amount,
          reason: reason || "ADJUST",
          reference: reference || "admin",
          metadata: metadata || {},
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "wallet adjust unavailable (wallet/walletTransaction models missing)", detail: String(e) },
      { status: 503 }
    );
  }
}
