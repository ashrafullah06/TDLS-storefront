// app/api/reports/activity/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";                 // :contentReference[oaicite:17]{index=17}
import { requireAdmin } from "@/lib/auth";         // :contentReference[oaicite:18]{index=18}
import { fetchorders } from "@/lib/fetchorders";   // Strapi orders helper :contentReference[oaicite:19]{index=19}

export const dynamic = "force-dynamic";

function asDate(v) { return v ? new Date(v) : null; }

export async function GET(req) {
  await requireAdmin(req);
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const from = asDate(url.searchParams.get("from"));
  const to = asDate(url.searchParams.get("to"));

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // 1) Orders from Strapi (admin token)
  const token = process.env.STRAPI_ADMIN_TOKEN || process.env.STRAPI_API_TOKEN || process.env.STRAPI_TOKEN;
  let orders = [];
  try { orders = await fetchorders(userId, token); } catch { orders = []; }

  // 2) Wallet + Loyalty from Prisma
  const [wallet, loyAcc, loyTx] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId }, include: { txns: true } }),
    prisma.loyaltyAccount.findUnique({ where: { userId } }),
    prisma.loyaltyTransaction.findMany({ where: { account: { userId } }, orderBy: { createdAt: "desc" } }),
  ]);

  // Build timeline
  const events = [];

  for (const o of orders) {
    const ts = o.createdAt || o.created_at || o.publishedAt;
    events.push({ type: "ORDER", at: ts, ref: o.id, total: o.total || o.total_amount || o.grand_total, status: o.status || o.order_status || "unknown" });
  }
  if (wallet?.txns) {
    for (const t of wallet.txns) {
      events.push({ type: "WALLET", at: t.createdAt, delta: t.delta, reason: t.reason, reference: t.reference, metadata: t.metadata });
    }
  }
  for (const t of loyTx) {
    events.push({ type: "LOYALTY", at: t.createdAt, points: t.points, reason: t.reason, reference: t.reference, taka: t.takaValue });
  }

  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return NextResponse.json({
    userId,
    summary: {
      walletBalance: wallet?.balance ?? 0,
      loyaltyTier: loyAcc?.tier || "MEMBER",
      points: loyAcc?.currentPoints ?? 0,
      orders: orders.length,
    },
    events,
  });
}
