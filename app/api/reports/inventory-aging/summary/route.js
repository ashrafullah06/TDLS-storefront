// FILE: app/api/reports/inventory-aging/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    // Try to compute from productVariant table (stock & updatedAt)
    const variants = await prisma.productVariant.findMany({
      select: { id: true, stock: true, updatedAt: true, createdAt: true },
    });

    const now = Date.now();
    const buckets = {
      "0-30": { qty: 0, items: 0 },
      "31-60": { qty: 0, items: 0 },
      "61-90": { qty: 0, items: 0 },
      "91-180": { qty: 0, items: 0 },
      "180+": { qty: 0, items: 0 },
    };

    for (const v of variants) {
      const qty = Number(v.stock || 0);
      if (qty <= 0) continue;
      const base = v.updatedAt || v.createdAt;
      const ageDays = Math.floor((now - new Date(base).getTime()) / (24 * 3600 * 1000));
      let key = "0-30";
      if (ageDays > 180) key = "180+";
      else if (ageDays > 90) key = "91-180";
      else if (ageDays > 60) key = "61-90";
      else if (ageDays > 30) key = "31-60";
      buckets[key].qty += qty;
      buckets[key].items += 1;
    }

    return NextResponse.json({ buckets });
  } catch (e) {
    return NextResponse.json(
      { error: "inventory aging unavailable (productVariant model missing)", detail: String(e) },
      { status: 503 }
    );
  }
}
