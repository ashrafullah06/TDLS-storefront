// FILE: app/api/customers/search/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
  const skip = (page - 1) * pageSize;

  const where = q ? {
    OR: [
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { id: q },
    ]
  } : {};

  try {
    const [items, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      prisma.customer.count({ where }),
    ]);
    return NextResponse.json({ items, total, page, pageSize });
  } catch (e) {
    return NextResponse.json({ error: "customers search unavailable", detail: String(e) }, { status: 503 });
  }
}
