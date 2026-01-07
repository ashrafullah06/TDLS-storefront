// FILE: app/api/admin/inventory/live/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function j(body, status = 200, headers = {}) {
  return new NextResponse(
    body === undefined ? "null" : JSON.stringify(body),
    { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } }
  );
}

// simple RBAC: allow admins/catalog/analytics
function permitted(user) {
  const p = new Set(
    []
      .concat(user?.permissions || [])
      .concat(user?.perms || [])
      .concat(user?.roles || [])
      .map(String)
  );
  return p.has("ADMIN") || p.has("MANAGE_CATALOG") || p.has("VIEW_ANALYTICS");
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return j({ error: "unauthorized" }, 401);
    if (!permitted(session.user)) return j({ error: "forbidden" }, 403);

    // Aggregate by variant across warehouses using InventoryItem
    const rows = await prisma.inventoryItem.groupBy({
      by: ["variantId"],
      _sum: { onHand: true, reserved: true, safetyStock: true },
    });

    if (!rows.length) return j({ now: new Date().toISOString(), count: 0, items: [] }, 200);

    // hydrate variant basics
    const variantIds = rows.map((r) => r.variantId);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        title: true,
        productId: true,
        product: { select: { title: true } },
        updatedAt: true,
      },
    });
    const vmap = new Map(variants.map((v) => [v.id, v]));

    const items = rows.map((r) => {
      const v = vmap.get(r.variantId);
      const onHand = Number(r._sum.onHand || 0);
      const reserved = Number(r._sum.reserved || 0);
      const safety = Number(r._sum.safetyStock || 0);
      const available = Math.max(onHand - reserved - safety, 0);
      return {
        variantId: r.variantId,
        sku: v?.sku || null,
        name: v?.title || v?.product?.title || null,
        productId: v?.productId || null,
        stockOnHand: onHand,
        stockReserved: reserved,
        safetyStock: safety,
        stockAvailable: available,
        updatedAt: v?.updatedAt || null,
      };
    });

    return j({ now: new Date().toISOString(), count: items.length, items }, 200);
  } catch (err) {
    console.error("[admin/inventory/live] error:", err);
    return j({ error: "server_error" }, 500);
  }
}
