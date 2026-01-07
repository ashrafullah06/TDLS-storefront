// FILE: app/api/loyalty/adjust/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

async function can(permission) {
  try {
    const r = await fetch("/api/admin/session", { cache: "no-store" });
    const j = await r.json();
    return Array.isArray(j?.user?.permissions) && j.user.permissions.includes(permission);
  } catch { return false; }
}

export async function POST(req) {
  if (!(await can("MANAGE_LOYALTY"))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const { userId, delta, reason = "ADJUST", meta = {} } = body || {};
  if (!userId || typeof delta !== "number" || delta === 0)
    return NextResponse.json({ error: "userId and non-zero delta required" }, { status: 400 });

  try {
    const res = await prisma.$transaction(async (trx) => {
      const acct = await trx.loyaltyAccount.upsert({
        where: { userId },
        create: { userId, points: 0 },
        update: {},
      });
      const entry = await trx.loyaltyTransaction.create({
        data: { userId, delta, reason, meta },
      });
      const newPoints = acct.points + delta;
      await trx.loyaltyAccount.update({ where: { userId }, data: { points: newPoints } });

      // tier upgrade logic — highest tier with threshold <= points
      const tiers = await trx.loyaltyTier.findMany({ orderBy: { threshold: "asc" } });
      const fit = tiers.filter(t => t.threshold <= newPoints).pop();
      if (fit) await trx.loyaltyAccount.update({ where: { userId }, data: { tierId: fit.id } });

      return { entry, points: newPoints, tier: fit || null };
    });

    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: "loyalty adjust unavailable", detail: String(e) }, { status: 503 });
  }
}
