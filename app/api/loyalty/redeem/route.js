// FILE: app/api/loyalty/redeem/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/** Pretend user-auth via header/cookie in middleware; here we require userId explicitly for clarity */
export async function POST(req) {
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { userId, type, amount, rewardProductId } = body || {};
  if (!userId || !type) return NextResponse.json({ error: "userId and type required" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (trx) => {
      const acct = await trx.loyaltyAccount.upsert({
        where: { userId },
        create: { userId, points: 0 },
        update: {},
      });

      if (type === "wallet") {
        if (typeof amount !== "number" || amount <= 0) throw new Error("amount required");
        const pts = amount; // 1 point => 1 BDT credit (example)
        if (acct.points < pts) throw new Error("insufficient points");
        await trx.loyaltyTransaction.create({ data: { userId, delta: -pts, reason: "REDEEM_WALLET" } });
        await trx.walletTransaction.create({ data: { userId, delta: amount, reason: "LOYALTY_REDEEM" } });
        await trx.loyaltyAccount.update({ where: { userId }, data: { points: acct.points - pts } });
        return { ok: true, walletCredit: amount };
      }

      if (type === "product") {
        const rp = await trx.rewardProduct.findUnique({ where: { id: rewardProductId } });
        if (!rp || !rp.active) throw new Error("invalid reward");
        if (acct.points < rp.pointsRequired) throw new Error("insufficient points");
        await trx.loyaltyTransaction.create({ data: { userId, delta: -rp.pointsRequired, reason: "REDEEM_PRODUCT", meta: { rewardProductId } } });
        await trx.loyaltyAccount.update({ where: { userId }, data: { points: acct.points - rp.pointsRequired } });
        return { ok: true, rewardProductId };
      }

      throw new Error("invalid type");
    });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "redeem failed", detail: String(e) }, { status: 503 });
  }
}
