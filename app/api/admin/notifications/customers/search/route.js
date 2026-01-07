// FILE: app/api/admin/notifications/customers/search/route.js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
function clampInt(v, def, min, max) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req) {
  const session = await auth().catch(() => null);
  const perms = session?.user?.permissions || [];
  if (!session?.user?.id) return json({ error: "UNAUTHORIZED" }, 401);
  if (!perms.includes("VIEW_NOTIFICATIONS") && !perms.includes("MANAGE_NOTIFICATIONS")) return json({ error: "FORBIDDEN" }, 403);

  const u = new URL(req.url);
  const q = String(u.searchParams.get("q") || "").trim();
  const limit = clampInt(u.searchParams.get("limit"), 10, 1, 25);

  if (q.length < 2) return json({ items: [] });

  const items = await prisma.user.findMany({
    where: {
      isActive: true,
      kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { customerCode: { contains: q, mode: "insensitive" } },
      ],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      customerCode: true,
      loyaltyAccount: { select: { tier: true } },
    },
  });

  return json({
    items: items.map((x) => ({
      id: x.id,
      name: x.name,
      email: x.email,
      phone: x.phone,
      customerCode: x.customerCode,
      tier: x.loyaltyAccount?.tier || null,
    })),
  });
}
