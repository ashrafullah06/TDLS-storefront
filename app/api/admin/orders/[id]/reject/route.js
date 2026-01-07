// PATH: app/api/admin/orders/[id]/reject/route.js
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

function str(v) {
  return String(v ?? "").trim();
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(arr) ? arr : []) {
    const s = str(x);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function nowISO() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

/**
 * POST /api/admin/orders/:id/reject
 * Body: { reasons: string[], note?: string, idempotencyKey?: string }
 *
 * Idempotency:
 * - If the order is already CANCELLED and we already wrote a REJECTED event with the same idempotency key,
 *   return ok without writing duplicates.
 */
export async function POST(req, { params }) {
  let admin;
  try {
    admin = await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  const actorId = admin.user?.id || admin.userId;
  const orderId = str(params?.id);

  if (!orderId) return json({ ok: false, error: "BAD_REQUEST" }, 400);

  const body = await req.json().catch(() => ({}));
  const reasons = uniqStrings(body?.reasons);
  const note = str(body?.note || "");
  const idempotencyKey =
    str(body?.idempotencyKey) || str(req.headers.get("x-idempotency-key"));

  if (!reasons.length) {
    return json({ ok: false, error: "REASONS_REQUIRED" }, 400);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      orderNumber: true,
      userId: true,
      paymentStatus: true,
      fulfillmentStatus: true,
    },
  });

  if (!order) return json({ ok: false, error: "NOT_FOUND" }, 404);

  const eventMessageKey = idempotencyKey
    ? `REJECTED:${idempotencyKey}`
    : null;

  // If idempotency key provided, and event already exists, return without writing duplicates.
  if (eventMessageKey) {
    const existing = await prisma.orderEvent.findFirst({
      where: {
        orderId,
        kind: "REJECTED",
        message: eventMessageKey,
      },
      select: { id: true },
    });

    if (existing) {
      const refreshed = await prisma.order.findUnique({
        where: { id: orderId },
      });
      return json({ ok: true, order: refreshed, deduped: true }, 200);
    }
  }

  // Transaction: status->CANCELLED (if not already), create event, create notification (best-effort in same tx).
  const result = await prisma.$transaction(async (tx) => {
    // Double-click safe status update:
    // update only if not cancelled already
    const updated =
      order.status === "CANCELLED"
        ? await tx.order.findUnique({ where: { id: orderId } })
        : await tx.order.update({
            where: { id: orderId },
            data: { status: "CANCELLED" },
          });

    const event = await tx.orderEvent.create({
      data: {
        orderId,
        kind: "REJECTED",
        message: eventMessageKey || "REJECTED",
        metadata: {
          reasons,
          note: note || null,
          by: actorId || null,
          at: nowISO(),
        },
        actorId,
        actorRole: "admin",
      },
    });

    // Customer-facing apology/in-app notification (DB-backed).
    // If your customer UI reads notifications, this will appear immediately.
    // Keep it deterministic and concise.
    let notification = null;
    if (updated?.userId) {
      const title = `Order ${
        updated.orderNumber ? `#${updated.orderNumber}` : updated.id
      } rejected`;
      const bodyText =
        `We’re sorry—your order could not be processed.` +
        (reasons.length ? ` Reason(s): ${reasons.join(", ")}.` : "") +
        (note ? ` Note: ${note}` : "");

      // These fields follow your existing Notification model approach in the plan.
      notification = await tx.notification.create({
        data: {
          userId: updated.userId,
          orderId: updated.id,
          channel: "IN_APP",
          type: "ORDER_REJECTED",
          title,
          body: bodyText,
          data: {
            reasons,
            note: note || null,
            orderId: updated.id,
            orderNumber: updated.orderNumber || null,
          },
        },
      });
    }

    return { order: updated, event, notification };
  });

  return json({ ok: true, ...result }, 200);
}
