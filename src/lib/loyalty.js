// lib/loyalty.js
import prisma from "./prisma-client";

export const TIER_BANDS = [
  { tier: "MEMBER",    min: 0,     max: 2000 },
  { tier: "BRONZE",    min: 2001,  max: 5000 },
  { tier: "SILVER",    min: 5001,  max: 12000 },
  { tier: "GOLD",      min: 12001, max: 25000 },
  { tier: "PLATINUM",  min: 25001, max: 50000 },
  { tier: "VIP",       min: 50001, max: Infinity },
];

export function pointsToTier(points = 0) {
  const p = Math.max(0, points | 0);
  return TIER_BANDS.find(b => p >= b.min && p <= b.max)?.tier || "MEMBER";
}

/** point→taka; set env LOYALTY_POINT_VALUE_BDT, default 0.10 BDT/point */
export function pointValueBDT() {
  const v = parseFloat(process.env.LOYALTY_POINT_VALUE_BDT ?? "0.10");
  return isNaN(v) ? 0.10 : Math.max(0, v);
}

/** Ensure account row exists; returns {account, wallet} */
export async function ensureWalletAndAccount(userId, tx = prisma) {
  const [account, wallet] = await Promise.all([
    tx.loyaltyAccount.upsert({
      where: { userId },
      update: {},
      create: { userId, currentPoints: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, tier: "MEMBER" },
    }),
    tx.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId, balance: 0 },
    }),
  ]);
  return { account, wallet };
}

/** Recalculate and persist tier after a point delta */
export async function applyPoints(userId, deltaPoints, reason, reference, metadata = {}, tx = prisma) {
  if (!Number.isInteger(deltaPoints) || deltaPoints === 0) return null;

  return tx.$transaction(async (trx) => {
    const { account } = await ensureWalletAndAccount(userId, trx);
    const newPoints = Math.max(0, account.currentPoints + deltaPoints);
    const lifetimeEarned  = deltaPoints > 0 ? account.lifetimeEarned + deltaPoints : account.lifetimeEarned;
    const lifetimeRedeemed = deltaPoints < 0 ? account.lifetimeRedeemed + Math.abs(deltaPoints) : account.lifetimeRedeemed;
    const newTier = pointsToTier(newPoints);

    const taka = deltaPoints > 0 ? null : Number((Math.abs(deltaPoints) * pointValueBDT()).toFixed(2));

    const txn = await trx.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: deltaPoints > 0 ? "EARN" : "REDEEM",
        points: deltaPoints,
        takaValue: taka,
        reason,
        reference,
        metadata,
      },
    });

    await trx.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        currentPoints: newPoints,
        lifetimeEarned,
        lifetimeRedeemed,
        tier: newTier,
        tierCalculatedAt: new Date(),
      },
    });

    return { txn, newPoints, newTier, taka };
  });
}

/** Credit or debit wallet (in BDT) */
export async function walletDelta(userId, deltaAmount, reason, reference, metadata = {}, tx = prisma) {
  if (!deltaAmount || typeof deltaAmount !== "number") return null;
  return tx.$transaction(async (trx) => {
    const { wallet } = await ensureWalletAndAccount(userId, trx);
    const newBalance = Number((Number(wallet.balance) + deltaAmount).toFixed(2));
    await trx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance, txns: { create: { delta: deltaAmount, reason, reference, metadata } } },
    });
    return newBalance;
  });
}
