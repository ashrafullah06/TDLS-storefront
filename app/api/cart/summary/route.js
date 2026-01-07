// FILE: app/api/cart/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Cart summary:
 * - total carts
 * - avg items per cart
 */
export async function GET() {
  try {
    const totalCarts = await prisma.cart.count();
    const itemsAgg = await prisma.cartItem.aggregate({ _sum: { quantity: true } });
    const totalItems = Number(itemsAgg?._sum?.quantity ?? 0);
    const avgItems = totalCarts > 0 ? (totalItems / totalCarts) : 0;

    return NextResponse.json({ carts: totalCarts, totalItems, avgItems });
  } catch (e) {
    return NextResponse.json({ error: "cart summary unavailable", detail: String(e) }, { status: 503 });
  }
}
