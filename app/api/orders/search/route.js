// FILE: app/api/orders/search/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
  const skip = (page - 1) * pageSize;

  const where = {
    ...(status ? { status } : {}),
    ...(q ? {
      OR: [
        { id: q },
        { number: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
        { trackingCode: { contains: q, mode: "insensitive" } },
      ]
    } : {})
  };

  try {
    const [items, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      prisma.order.count({ where }),
    ]);
    return NextResponse.json({ items, total, page, pageSize });
  } catch (e) {
    return NextResponse.json({ error: "orders search unavailable", detail: String(e) }, { status: 503 });
  }
}
