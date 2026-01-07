// app/api/rewards/redeem/route.js
import { NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma-client";
import { requireAuth } from "../../../../../lib/auth";
import { applyPoints, walletDelta, pointValueBDT } from "../../../../../lib/loyalty";

/** Optional: simple reward catalog mapping (id -> points), override with DB later */
const REWARD_CATALOG = [
  { id: "wallet-100", label: "৳100 wallet credit", points: Math.ceil(100 / pointValueBDT()) },
  { id: "wallet-250", label: "৳250 wallet credit", points: Math.ceil(250 / pointValueBDT()) },
  { id: "wallet-500", label: "৳500 wallet credit", points: Math.ceil(500 / pointValueBDT()) },
];

export async function POST(req) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();

    // Mode A: explicit points redemption to wallet
    if (typeof body.points === "number" && body.points > 0) {
      const points = Math.floor(body.points);
      const { taka } = await applyPoints(userId, -points, "redeem_to_wallet", null, {}, prisma);
      if (taka && taka > 0) await walletDelta(userId, taka, "loyalty_redeem_credit", `points:${points}`);
      return NextResponse.json({ ok: true, mode: "points", points, wallet_credit: taka ?? 0 });
    }

    // Mode B: rewardId from catalog
    if (body.rewardId) {
      const reward = REWARD_CATALOG.find(r => r.id === body.rewardId);
      if (!reward) return NextResponse.json({ ok: false, error: "invalid_reward" }, { status: 400 });

      const { taka } = await applyPoints(userId, -reward.points, `redeem:${reward.id}`, null, { label: reward.label }, prisma);
      const credit = taka ?? Number((reward.points * pointValueBDT()).toFixed(2));
      await walletDelta(userId, credit, `reward:${reward.id}`, null, { label: reward.label });
      return NextResponse.json({ ok: true, mode: "reward", rewardId: reward.id, wallet_credit: credit });
    }

    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
