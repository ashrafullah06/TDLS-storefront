// FILE: app/api/admin/orders/[id]/apology/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/* ---------------- helpers ---------------- */

function hasPerm(session, perm) {
  const p = String(perm || "").toUpperCase();
  const list =
    (Array.isArray(session?.permissions) && session.permissions) ||
    (Array.isArray(session?.user?.permissions) && session.user.permissions) ||
    [];
  return list.map((x) => String(x || "").toUpperCase()).includes(p);
}

function absBaseFromReq(req) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return host ? `${proto}://${host}` : "";
}

function pickCustomer(order) {
  const u = order?.user || null;
  return {
    name: u?.name || order?.userName || "Customer",
    email: u?.email || order?.userEmail || null,
    phone: u?.phone || order?.userPhone || null,
  };
}

function safeTrim(s) {
  return String(s ?? "").replace(/\r\n/g, "\n").trim();
}

async function trySendEmail({ to, subject, text }) {
  const SMTP_HOST = process.env.SMTP_HOST || "";
  const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
  const SMTP_USER = process.env.SMTP_USER || "";
  const SMTP_PASS = process.env.SMTP_PASS || "";
  const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  const FROM_EMAIL = process.env.SMTP_FROM || process.env.MAIL_FROM || process.env.FROM_EMAIL || "";
  const FROM_NAME = process.env.SMTP_FROM_NAME || process.env.MAIL_FROM_NAME || "TDLC";

  if (!to) return { ok: false, error: "DESTINATION_EMAIL_MISSING" };
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !FROM_EMAIL) {
    return { ok: false, error: "EMAIL_DELIVERY_NOT_CONFIGURED" };
  }

  let nodemailer;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    return { ok: false, error: "NODEMAILER_NOT_AVAILABLE" };
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const info = await transporter.sendMail({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject,
    text,
  });

  return { ok: true, infoId: info?.messageId || null };
}

function isDuplicateApology({ order, message }) {
  const m = safeTrim(message);
  const events = Array.isArray(order?.events) ? order.events : [];
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  for (const ev of events) {
    const kind = String(ev?.kind || "").toUpperCase();
    if (kind !== "APOLOGY_SENT") continue;
    const sameMsg = safeTrim(ev?.message) === assertMsg(m);
    if (!sameMsg) continue;

    const t = ev?.createdAt ? new Date(ev.createdAt).getTime() : 0;
    if (t && now - t <= windowMs) return true;
  }
  return false;

  function assertMsg(x) {
    return safeTrim(x);
  }
}

/* ---------------- handler ---------------- */

export async function POST(req, { params }) {
  const session = await auth();
  const userId = session?.user?.id || null;

  if (!userId) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!hasPerm(session, "MANAGE_ORDERS")) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const id = params?.id ? String(params.id) : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "ORDER_ID_REQUIRED" }, { status: 400 });
  }

  let body = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const message = safeTrim(body?.message);
  const reasons = Array.isArray(body?.reasons) ? body.reasons.map((x) => safeTrim(x)).filter(Boolean) : [];
  const note = safeTrim(body?.note || "");

  if (!message || message.length < 10) {
    return NextResponse.json(
      { ok: false, error: "MESSAGE_REQUIRED" },
      { status: 400 }
    );
  }

  const base = absBaseFromReq(req);
  if (!base) {
    return NextResponse.json({ ok: false, error: "HOST_NOT_RESOLVED" }, { status: 500 });
  }

  // Use the same auth/session cookie as the admin UI (no new auth mechanism).
  const cookie = req.headers.get("cookie") || "";

  // 1) Load order using your existing order detail endpoint (no schema assumptions here)
  const orderRes = await fetch(`${base}/api/admin/orders/${id}`, {
    method: "GET",
    headers: { cookie },
    cache: "no-store",
  });

  const orderJson = await orderRes.json().catch(() => null);
  if (!orderRes.ok || orderJson?.ok === false) {
    return NextResponse.json(
      {
        ok: false,
        error: orderJson?.error || orderJson?.message || `ORDER_LOAD_FAILED_${orderRes.status}`,
      },
      { status: 400 }
    );
  }

  const order = orderJson?.order || orderJson?.data || null;
  if (!order) {
    return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  // Deduplicate: if exact apology text was already sent very recently, do nothing
  if (isDuplicateApology({ order, message })) {
    return NextResponse.json(
      { ok: true, deduped: true, delivered: true, channel: "email" },
      { status: 200 }
    );
  }

  // 2) Determine customer destination
  const customer = pickCustomer(order);
  const toEmail = customer.email;

  // 3) Deliver apology (email)
  const subject =
    `Regarding your TDLC order #${order?.orderNumber ?? ""}`.trim() ||
    "Regarding your TDLC order";

  let delivery = null;
  try {
    delivery = await trySendEmail({ to: toEmail, subject, text: message });
  } catch (e) {
    delivery = { ok: false, error: e?.message || "EMAIL_SEND_FAILED" };
  }

  if (!delivery?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: delivery?.error || "DELIVERY_FAILED",
        destination: { email: toEmail || null, phone: customer.phone || null },
      },
      { status: 400 }
    );
  }

  // 4) Log to server timeline via your existing events endpoint (single source of truth)
  //    This keeps your event schema consistent and avoids double counting.
  const evMessageLines = [
    message,
    reasons.length ? `\n\nReasons: ${reasons.join(", ")}` : null,
    note ? `\n\nInternal note: ${note}` : null,
  ].filter(Boolean);

  const evRes = await fetch(`${base}/api/admin/orders/${id}/events`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      kind: "APOLOGY_SENT",
      message: evMessageLines.join(""),
    }),
  });

  const evJson = await evRes.json().catch(() => null);
  if (!evRes.ok || evJson?.ok === false) {
    // Email was sent; event logging failed. Return a clear partial failure.
    return NextResponse.json(
      {
        ok: false,
        error:
          evJson?.error ||
          evJson?.message ||
          `EVENT_LOG_FAILED_${evRes.status}`,
        delivered: true,
        channel: "email",
        messageId: delivery?.infoId || null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      delivered: true,
      channel: "email",
      messageId: delivery?.infoId || null,
      destination: { email: toEmail },
    },
    { status: 200 }
  );
}
