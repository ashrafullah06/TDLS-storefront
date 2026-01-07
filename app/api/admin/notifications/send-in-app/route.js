// FILE: app/api/admin/notifications/send-in-app/route.js
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

function ensureRelativeHref(href) {
  if (!href) return null;
  const s = String(href).trim();
  if (!s) return null;
  if (!s.startsWith("/")) return null;
  if (s.startsWith("//")) return null;
  return s.slice(0, 512);
}

async function chunkCreateMany(rows, chunk = 1000) {
  let total = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const r = await prisma.notification.createMany({ data: rows.slice(i, i + chunk) });
    total += r.count || 0;
  }
  return total;
}

export async function POST(req) {
  const session = await auth().catch(() => null);
  const perms = session?.user?.permissions || [];
  const adminId = session?.user?.id || null;

  if (!adminId) return json({ error: "UNAUTHORIZED" }, 401);
  if (!perms.includes("MANAGE_NOTIFICATIONS")) return json({ error: "FORBIDDEN" }, 403);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "INVALID_JSON" }, 400);

  const idempotencyKey = String(body?.idempotencyKey || "").trim();
  if (!idempotencyKey) return json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, 400);

  // Use templateKey to enforce idempotency for this send request (no schema change).
  const templateKey = `admin_inapp:${idempotencyKey}`;
  const already = await prisma.notification.count({ where: { templateKey, channel: "IN_APP" } });
  if (already > 0) {
    return json({ ok: true, deduped: true, sent: already, targets: already, scheduled: false });
  }

  const audience = body?.audience || {};
  const msg = body?.message || {};
  const schedule = body?.schedule || {};
  const audit = body?.audit || {};

  const all = Boolean(audience?.all);
  const tier = audience?.tier ? String(audience.tier).trim() : "";
  const recipientsText = String(audience?.recipients || "");

  const type = String(msg?.type || "SYSTEM").trim(); // must exist in NotificationType
  const title = String(msg?.title || "").trim();
  const text = String(msg?.body || "").trim();
  const ctaLabel = msg?.ctaLabel ? String(msg.ctaLabel).trim().slice(0, 64) : null;
  const ctaHref = ensureRelativeHref(msg?.ctaHref);
  const campaignKey = msg?.campaignKey ? String(msg.campaignKey).trim().slice(0, 80) : null;

  if (!title || !text) return json({ error: "TITLE_AND_BODY_REQUIRED" }, 400);
  if (title.length > 140) return json({ error: "TITLE_TOO_LONG" }, 400);
  if (text.length > 4000) return json({ error: "BODY_TOO_LONG" }, 400);
  if (msg?.ctaHref && !ctaHref) return json({ error: "CTA_HREF_MUST_BE_RELATIVE" }, 400);

  // schedule: if future -> QUEUED, createdAt = sendAt
  let sendAt = null;
  if (schedule?.sendAt) {
    const d = new Date(String(schedule.sendAt));
    if (!Number.isFinite(d.getTime())) return json({ error: "INVALID_SEND_AT" }, 400);
    sendAt = d;
  }
  const now = new Date();
  const scheduled = sendAt && sendAt.getTime() > now.getTime();
  const createdAt = scheduled ? sendAt : now;

  // Resolve targets
  let targetUserIds = [];

  if (all) {
    const users = await prisma.user.findMany({
      where: { isActive: true, kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] } },
      select: { id: true },
    });
    targetUserIds = users.map((u) => u.id);
  } else if (tier) {
    const users = await prisma.loyaltyAccount.findMany({
      where: { tier },
      select: { userId: true },
    });
    targetUserIds = Array.from(new Set(users.map((x) => x.userId)));
  } else {
    const { userIds, emails, phones } = normalizeRecipients(recipientsText);

    const [byId, byEmail, byPhone] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({
            where: {
              id: { in: userIds },
              isActive: true,
              kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      emails.length
        ? prisma.user.findMany({
            where: {
              email: { in: emails },
              isActive: true,
              kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
      phones.length
        ? prisma.user.findMany({
            where: {
              phone: { in: phones },
              isActive: true,
              kind: { in: ["CUSTOMER_ONLY", "CUSTOMER_AND_STAFF"] },
            },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    targetUserIds = Array.from(new Set([...byId, ...byEmail, ...byPhone].map((u) => u.id)));
  }

  if (!targetUserIds.length) return json({ error: "NO_TARGET_CUSTOMERS_MATCHED" }, 400);

  const payloadData = {
    ...(ctaLabel ? { ctaLabel } : {}),
    ...(ctaHref ? { ctaHref } : {}),
    ...(campaignKey ? { campaignKey } : {}),
    sender: { kind: "ADMIN", adminId },
    // store schedule metadata (useful for UI)
    ...(sendAt ? { sendAt: sendAt.toISOString() } : {}),
  };

  const rows = targetUserIds.map((uid) => ({
    userId: uid,
    orderId: null,
    channel: "IN_APP",
    type,
    title,
    body: text,
    data: payloadData,
    to: null,
    templateKey, // idempotency anchor
    status: scheduled ? "QUEUED" : "DELIVERED",
    queued: scheduled ? true : false,
    bounced: false,
    emailSentAt: null,
    readAt: null,
    createdAt,
  }));

  const sent = await prisma.$transaction(async (tx) => {
    let total = 0;
    // chunk inside tx
    for (let i = 0; i < rows.length; i += 1000) {
      const r = await tx.notification.createMany({ data: rows.slice(i, i + 1000) });
      total += r.count || 0;
    }

    // best-effort audit
    await tx.auditLog
      .create({
        data: {
          userId: adminId,
          category: "ADMIN",
          action: "CUSTOMER_INAPP_NOTIFICATION_SENT",
          message: scheduled
            ? `Scheduled IN_APP notification to ${total} customers`
            : `Sent IN_APP notification to ${total} customers`,
          metadata: {
            targets: total,
            scheduled,
            sendAt: sendAt ? sendAt.toISOString() : null,
            all,
            tier: tier || null,
            campaignKey: campaignKey || null,
            note: audit?.note ? String(audit.note).slice(0, 500) : null,
            type,
            title,
            idempotencyKey,
          },
          context: "admin_panel",
          at: new Date(),
        },
      })
      .catch(() => {});
    return total;
  });

  return json({ ok: true, sent, targets: targetUserIds.length, scheduled });
}
