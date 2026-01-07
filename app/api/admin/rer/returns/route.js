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
function int(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : d;
}
function isDigits(s) {
  return /^\d+$/.test(String(s ?? "").trim());
}
function prismaErrShape(err) {
  const code = err?.code || err?.meta?.cause || null;
  const message = err?.message ? String(err.message).slice(0, 900) : "Unknown error";
  return { code, message };
}

function parseWindow(url) {
  const u = new URL(url);
  const q = str(u.searchParams.get("q"));
  const status = str(u.searchParams.get("status"));
  const from = str(u.searchParams.get("from"));
  const to = str(u.searchParams.get("to"));
  const take = Math.min(50, Math.max(1, int(u.searchParams.get("take"), 20)));
  const page = Math.max(1, int(u.searchParams.get("page"), 1));
  const skip = (page - 1) * take;

  const createdAt = {};
  if (from) createdAt.gte = new Date(from + "T00:00:00.000Z");
  if (to) createdAt.lte = new Date(to + "T23:59:59.999Z");

  const where = {};
  if (status) where.status = status;
  if (from || to) where.createdAt = createdAt;

  if (q) {
    // Allow searching by return id, orderId, or orderNumber (digits)
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { orderId: { contains: q, mode: "insensitive" } },
    ];
    if (isDigits(q)) {
      // relies on ReturnRequest -> order relation named `order` (you already use it in [id] route)
      where.OR.push({ order: { orderNumber: int(q) } });
    }
  }

  return { where, take, skip, page };
}

async function resolveOrderRef(orderRef) {
  const ref = str(orderRef);
  if (!ref) return null;

  if (isDigits(ref)) {
    const on = int(ref);
    return prisma.order.findFirst({
      where: { orderNumber: on },
      select: { id: true, orderNumber: true },
    });
  }

  return prisma.order.findUnique({
    where: { id: ref },
    select: { id: true, orderNumber: true },
  });
}

/**
 * GET /api/admin/rer/returns
 * Supports: q, status, from, to, take, page
 */
export async function GET(req) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      status
    );
  }

  try {
    const { where, take, skip, page } = parseWindow(req.url);

    const [items, total] = await Promise.all([
      prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        select: {
          id: true,
          orderId: true,
          status: true,
          reason: true,
          notes: true, // schema: notes
          createdAt: true,
          updatedAt: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              invoiceNo: true,
              status: true,
              fulfillmentStatus: true,
              paymentStatus: true,
              deliveredAt: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.returnRequest.count({ where }),
    ]);

    // Backward compatibility: also provide `note`
    const shaped = items.map((it) => ({ ...it, note: it?.notes ?? null }));

    return json({ ok: true, items: shaped, total, page, take }, 200);
  } catch (err) {
    const { code, message } = prismaErrShape(err);
    return json(
      { ok: false, error: "SERVER_ERROR", code: code || "HTTP_500", detail: message },
      500
    );
  }
}

/**
 * POST /api/admin/rer/returns
 * Body: { orderId: string (UUID OR orderNumber), reason?: string|null, note?: string|null, notes?: string|null }
 *
 * Idempotency: uses x-idempotency-key (if provided) by storing it into notes prefix.
 */
export async function POST(req) {
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

  try {
    const body = await req.json().catch(() => ({}));

    // Accept both `note` and `notes` from UI without changing UI
    const orderRef = str(body?.orderId);
    const reason = body?.reason == null ? null : str(body.reason);
    const noteIncoming =
      body?.notes != null ? str(body.notes) : body?.note != null ? str(body.note) : null;

    const idem = str(req.headers.get("x-idempotency-key"));

    if (!orderRef) return json({ ok: false, error: "ORDER_ID_REQUIRED" }, 400);

    const order = await resolveOrderRef(orderRef);
    if (!order) return json({ ok: false, error: "ORDER_NOT_FOUND" }, 404);

    // Dedup (optional)
    if (idem) {
      const existing = await prisma.returnRequest.findFirst({
        where: { orderId: order.id, notes: { startsWith: `IDEMP:${idem}` } },
        select: { id: true },
      });
      if (existing) {
        const found = await prisma.returnRequest.findUnique({
          where: { id: existing.id },
          select: {
            id: true,
            orderId: true,
            status: true,
            reason: true,
            notes: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return json(
          {
            ok: true,
            item: { ...found, note: found?.notes ?? null },
            deduped: true,
            message: "RETURN_CREATE_DEDUPED",
          },
          200
        );
      }
    }

    const notesToSave = idem
      ? `IDEMP:${idem}${noteIncoming ? `\n${noteIncoming}` : ""}`
      : noteIncoming;

    const item = await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        status: "REQUESTED",
        reason,
        notes: notesToSave, // schema: notes
        actorId: actorId || null,
      },
      select: {
        id: true,
        orderId: true,
        status: true,
        reason: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        kind: "RER_RETURN_CREATED",
        message: "RER_RETURN_CREATED",
        metadata: { returnId: item.id, orderNumber: order.orderNumber },
        actorId: actorId || null,
        actorRole: "admin",
      },
    });

    return json(
      { ok: true, item: { ...item, note: item?.notes ?? null }, message: "RETURN_CREATED" },
      201
    );
  } catch (err) {
    const { code, message } = prismaErrShape(err);
    return json(
      { ok: false, error: "SERVER_ERROR", code: code || "HTTP_500", detail: message },
      500
    );
  }
}
