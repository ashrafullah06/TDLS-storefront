// FILE: app/api/notifications/send/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

async function getPerms() {
  try {
    const r = await fetch("/api/admin/session", { cache: "no-store" });
    const j = await r.json();
    return j?.user?.permissions || [];
  } catch { return []; }
}

/**
 * POST { channel:"email|sms|whatsapp|push", to, templateKey, variables:{} }
 * RBAC: MANAGE_NOTIFICATIONS
 * Email via SMTP if configured; otherwise returns 503.
 */
export async function POST(req) {
  const perms = await getPerms();
  if (!perms.includes("MANAGE_NOTIFICATIONS")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body; try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { channel, to, templateKey, variables } = body || {};
  if (!channel || !to) return NextResponse.json({ error: "channel and to required" }, { status: 400 });

  // template lookup (optional)
  let tpl;
  try {
    tpl = await prisma.notificationTemplate.findUnique({ where: { key_channel: { key: templateKey || "default", channel } } });
  } catch {}

  // EMAIL example via SMTP (nodemailer) if configured
  if (channel === "email") {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
    if (!SMTP_HOST) return NextResponse.json({ error: "smtp not configured" }, { status: 503 });

    let nodemailer; try { nodemailer = (await import("nodemailer")).default; } catch {
      return NextResponse.json({ error: "nodemailer not installed. pnpm add nodemailer" }, { status: 503 });
    }

    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: false,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });

    const subject = tpl?.subject || "TDLC Notification";
    const bodyHtml = (tpl?.bodyHtml || "<p>Hello {{name}}, this is a test.</p>").replace(/\{\{(\w+)\}\}/g, (_, k) => (variables?.[k] ?? ""));
    const bodyText = (tpl?.bodyText || "Hello {{name}}, this is a test.").replace(/\{\{(\w+)\}\}/g, (_, k) => (variables?.[k] ?? ""));

    try {
      const info = await transport.sendMail({ from: SMTP_FROM || "no-reply@tdlc", to, subject, text: bodyText, html: bodyHtml });
      const rec = await prisma.notification.create({ data: { to, channel: "email", templateKey: templateKey || tpl?.key, status: "delivered" } });
      return NextResponse.json({ ok: true, id: rec.id, messageId: info.messageId });
    } catch (e) {
      await prisma?.notification?.create?.({ data: { to, channel: "email", templateKey: templateKey || tpl?.key, status: "failed", bounced: true } }).catch(() => {});
      return NextResponse.json({ error: "send failed", detail: String(e) }, { status: 500 });
    }
  }

  // Other channels: rely on providers if present; else 503
  return NextResponse.json({ error: `${channel} provider not configured` }, { status: 503 });
}
