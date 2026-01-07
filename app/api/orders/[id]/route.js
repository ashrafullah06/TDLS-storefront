// PATH: app/api/orders/[id]/barcode.png/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/* ───────── helpers ───────── */
const isNumeric = (s) => /^[0-9]+$/.test(String(s || "").trim());

function pngResponse(buffer) {
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}

function isAdmin(session) {
  const roles = Array.isArray(session?.roles)
    ? session.roles
    : [session?.role].filter(Boolean);
  return roles.includes("admin") || roles.includes("superadmin");
}

async function tryBwipPng(text) {
  try {
    const bwipjs = (await import("bwip-js")).default;
    return await bwipjs.toBuffer({
      bcid: "code128",
      text: String(text),
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: "center",
      backgroundcolor: "FFFFFF",
      paddingwidth: 8,
      paddingheight: 8,
    });
  } catch {
    return null;
  }
}

async function makeQr(text) {
  // Fallback if bwip-js isn't present
  const QRCode = (await import("qrcode")).default;
  const dataUrl = await QRCode.toDataURL(String(text), {
    errorCorrectionLevel: "M",
    scale: 6,
    margin: 1,
  });
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
}

/* ───────── GET /api/orders/:id/barcode.png ───────── */
export async function GET(req, { params }) {
  try {
    const { userId, roles } = await requireAuth(req);

    const rawKey = decodeURIComponent(String(params?.id || "").trim());
    if (!rawKey) return new Response("Order id required", { status: 400 });

    // Support both /orders/{cuid}/barcode.png and /orders/{orderNumber}/barcode.png
    const where = isNumeric(rawKey)
      ? { orderNumber: Number(rawKey) }
      : { id: rawKey };

    // Use findFirst to allow either unique key
    const order = await prisma.order.findFirst({
      where,
      select: { id: true, userId: true, orderNumber: true },
    });

    if (!order) return new Response("Not found", { status: 404 });

    // Owner or admin/superadmin can view
    if (!(order.userId === userId || isAdmin({ roles }))) {
      return new Response("Forbidden", { status: 403 });
    }

    const payload = order.orderNumber ? String(order.orderNumber) : order.id;

    // Try barcode (Code128), then fallback to QR
    const code128 = await tryBwipPng(payload);
    if (code128) return pngResponse(code128);

    const qr = await makeQr(payload);
    return pngResponse(qr);
  } catch (err) {
    console.error("[api/orders/barcode.png] ", err);
    return new Response("Failed to render barcode", { status: 500 });
  }
}
