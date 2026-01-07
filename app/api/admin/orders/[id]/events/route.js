// PATH: app/api/admin/orders/[id]/events/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/* ---------------- utils ---------------- */

function str(v) {
  return String(v ?? "").trim();
}

function safeKind(v) {
  const k = str(v || "NOTE").toUpperCase();
  // Keep it permissive (no schema assumptions), but avoid absurd payloads.
  return k.slice(0, 64) || "NOTE";
}

function safeMessage(v) {
  // Keep exact text the UI sends; just normalize whitespace.
  const s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  // Prevent accidental massive inserts; still large enough for real notes/emails.
  return s.length > 8000 ? s.slice(0, 8000) : s;
}

function safeMetadata(v) {
  // Allow: null | object | array | JSON-string
  if (v == null) return null;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      return safeMetadata(parsed);
    } catch {
      // Don’t store arbitrary strings as JSON (keeps DB clean)
      return null;
    }
  }

  if (typeof v === "object") {
    // Ensure JSON-serializable
    try {
      JSON.stringify(v);
      return v;
    } catch {
      return null;
    }
  }

  return null;
}

function int(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : d;
}

/**
 * Double-click safety (no duplicate counting):
 * - If idempotencyKey/header exists: dedupe same (orderId, kind, message, actorId) within 10 minutes
 * - Else: dedupe same (orderId, kind, message, actorId) within 60 seconds
 *
 * This avoids duplicates from rapid repeated clicks without changing UI payloads.
 */
async function findDuplicateEvent({ orderId, kind, message, actorId, idempotencyKey }) {
  const windowMs = idempotencyKey ? 10 * 60 * 1000 : 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  return prisma.orderEvent.findFirst({
    where: {
      orderId,
      kind,
      message,
      actorId: actorId || null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
}

/* ---------------- handlers ---------------- */

/**
 * GET /api/admin/orders/:id/events
 * Query: take (default 50, max 200)
 *
 * Needed for timeline rendering (Events & Notes panel).
 */
export async function GET(req, { params }) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  const orderId = str(params?.id);
  if (!orderId) return json({ ok: false, error: "ORDER_ID_REQUIRED" }, 400);

  const u = new URL(req.url);
  const take = Math.min(200, Math.max(1, int(u.searchParams.get("take"), 50)));

  const found = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!found) return json({ ok: false, error: "NOT_FOUND" }, 404);

  const events = await prisma.orderEvent.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      orderId: true,
      kind: true,
      message: true,
      metadata: true,
      actorId: true,
      actorRole: true,
      createdAt: true,
    },
  });

  return json({ ok: true, events }, 200);
}

/**
 * POST /api/admin/orders/:id/events
 * Body: { kind?: string, message?: string, metadata?: any, idempotencyKey?: string }
 *
 * Keeps existing behavior: creates an event row.
 * Adds: validation + dedupe window to prevent double-click duplicates.
 */
export async function POST(req, { params }) {
  let admin;
  try {
    admin = await requireAdmin(req, {
      permission: Permissions.MANAGE_ORDERS,
    });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  const actorId = admin.user?.id || admin.userId || null;

  const orderId = str(params?.id);
  if (!orderId) return json({ ok: false, error: "ORDER_ID_REQUIRED" }, 400);

  const body = await req.json().catch(() => ({}));

  const kind = safeKind(body?.kind);
  const message = safeMessage(body?.message ?? "");
  const metadata = safeMetadata(body?.metadata);
  const idempotencyKey =
    str(body?.idempotencyKey) || str(req.headers.get("x-idempotency-key"));

  const found = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!found) return json({ ok: false, error: "NOT_FOUND" }, 404);

  // Notes / apology events should never be empty; if client sends blank, reject cleanly.
  // For other kinds, we still require a message to keep timeline meaningful and avoid “blank rows”.
  if (!message) {
    return json({ ok: false, error: "MESSAGE_REQUIRED" }, 400);
  }

  // Double-click safety (no duplicate counting)
  const dup = await findDuplicateEvent({
    orderId,
    kind,
    message,
    actorId,
    idempotencyKey,
  });

  if (dup) {
    return json({ ok: true, event: dup, deduped: true }, 200);
  }

  const event = await prisma.orderEvent.create({
    data: {
      orderId,
      kind,
      message,
      metadata: metadata ?? null,
      actorId,
      actorRole: "admin",
    },
  });

  return json({ ok: true, event }, 200);
}
