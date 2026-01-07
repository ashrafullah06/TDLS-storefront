// FILE: app/api/admin/notifications/target-count/route.js
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function normalizeRecipients(text) {
  const userIds = [];
  const emails = [];
  const phones = [];
  const parts = String(text || "")
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const v of parts) {
    if (v.includes("@")) emails.push(v.toLowerCase());
    else if (/^\+?\d[\d\s\-()]{6,}$/.test(v)) phones.push(v.replace(/\s+/g, ""));
    else userIds.push(v);
  }

  return {
    userIds: Array.from(new Set(userIds)),
    emails: Array.from(new Set(emails)),
    phones: Array.from(new Set(phones)),
  };
}

export async function POST(req) {
  const session = await auth().catch(() => null);
  const perms = session?.user?.permissions || [];
  if (!session?.user?.id) return json({ error: "UNAUTHORIZED" }, 401);
  if (!perms.includes("MANAGE_NOTIFICATIONS")) return json({ error: "FORBIDDEN" }, 403);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "INVALID_JSON" }, 400);

  const audience = body?.audience || {};
  const all = Boolean(audience?.all);
  const tier = audience?.tier ? String(audience.tier).trim() : "";
  const recipients = String(audience?.recipients || "");

  let ids = [];

  if (all) {
    const users = await prisma.user.findMany({
      where: { isActive: true, kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } },
      select: { id: true },
    });
    ids = users.map((u) => u.id);
  } else if (tier) {
    const rows = await prisma.loyaltyAccount.findMany({ where: { tier }, select: { userId: true } });
    ids = Array.from(new Set(rows.map((r) => r.userId)));
  } else {
    const { userIds, emails, phones } = normalizeRecipients(recipients);

    const [byId, byEmail, byPhone] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({
            where: { id: { in: userIds }, isActive: true, kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } },
            select: { id: true },
          })
        : Promise.resolve([]),
      emails.length
        ? prisma.user.findMany({
            where: { email: { in: emails }, isActive: true, kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } },
            select: { id: true },
          })
        : Promise.resolve([]),
      phones.length
        ? prisma.user.findMany({
            where: { phone: { in: phones }, isActive: true, kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    ids = Array.from(new Set([...byId, ...byEmail, ...byPhone].map((x) => x.id)));
  }

  const sampleUsers = await prisma.user.findMany({
    where: { id: { in: ids.slice(0, 50) } },
    take: 5,
    select: { id: true, email: true, phone: true, customerCode: true },
  });

  return json({ count: ids.length, sample: sampleUsers });
}
