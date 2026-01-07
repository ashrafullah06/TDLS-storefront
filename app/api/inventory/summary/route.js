// FILE: app/api/inventory/summary/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Inventory dashboard summary for BD operations.
 * Fix: Catalog counts must NOT depend on inventory rows.
 * Returns:
 *  - ok
 *  - totals: onHand, reserved, safety
 *  - top_low_stock: up to 10 variants under safetyStock
 *  - by_warehouse: aggregate by warehouse
 *  - products: product count from Product table (fallback-safe)
 *  - variants: variant count from ProductVariant table (fallback-safe)
 *  - lowStock: REAL count of low-stock inventory SKUs
 *  - meta: light diagnostics (not shown in UI unless you use it)
 */
function n(v) {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

async function safeCount(modelName) {
  try {
    const fn = prisma?.[modelName]?.count;
    if (typeof fn !== "function") return null;
    return await fn.call(prisma[modelName], {});
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Catalog counts should come from product tables (so "catalog" never shows 0 just because inventory table is empty)
    const [productCount, variantCount] = await Promise.all([
      safeCount("product"),
      safeCount("productVariant"),
    ]);

    // Inventory rows (may be empty early on; dashboard still must show catalog counts)
    const items = await prisma.inventoryItem.findMany({
      include: {
        variant: { include: { product: true } },
        warehouse: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20000,
    });

    let onHand = 0;
    let reserved = 0;
    let safety = 0;

    const low = [];
    const byWh = new Map();

    let newestUpdatedAt = null;
    let oldestUpdatedAt = null;

    for (const it of items) {
      const itOnHand = n(it?.onHand);
      const itReserved = n(it?.reserved);
      const itSafety = n(it?.safetyStock);

      onHand += itOnHand;
      reserved += itReserved;
      safety += itSafety;

      const u = it?.updatedAt ? new Date(it.updatedAt) : null;
      if (u && (!newestUpdatedAt || u > newestUpdatedAt)) newestUpdatedAt = u;
      if (u && (!oldestUpdatedAt || u < oldestUpdatedAt)) oldestUpdatedAt = u;

      if (itSafety > 0 && itOnHand < itSafety) {
        low.push({
          variantId: it.variantId,
          sku:
            it.variant?.sku ||
            it.variant?.generated_sku ||
            it.variant?.generatedSku ||
            "",
          product:
            it.variant?.product?.title ||
            it.variant?.product?.name ||
            it.variant?.product?.slug ||
            "",
          onHand: itOnHand,
          reserved: itReserved,
          safetyStock: itSafety,
          warehouse: it.warehouse?.name || "",
        });
      }

      const key = it.warehouse?.name || String(it.warehouseId || "UNKNOWN");
      const acc = byWh.get(key) || { onHand: 0, reserved: 0, safety: 0 };
      acc.onHand += itOnHand;
      acc.reserved += itReserved;
      acc.safety += itSafety;
      byWh.set(key, acc);
    }

    const topLow = low
      .sort((a, b) => (b.safetyStock - b.onHand) - (a.safetyStock - a.onHand))
      .slice(0, 10);

    return NextResponse.json({
      ok: true,

      totals: { onHand, reserved, safety },

      top_low_stock: topLow,

      by_warehouse: [...byWh.entries()].map(([name, v]) => ({
        name,
        onHand: v.onHand,
        reserved: v.reserved,
        safety: v.safety,
      })),

      // dashboard-specific (catalog-safe)
      products: productCount ?? 0,
      variants: variantCount ?? 0,

      // inventory-specific
      lowStock: low.length,

      // light diagnostics (helps you prove why UI shows 0 without adding new endpoints/files)
      meta: {
        inventoryRowsScanned: items.length,
        warehouses: byWh.size,
        updatedAtRange: {
          oldest: oldestUpdatedAt ? oldestUpdatedAt.toISOString() : null,
          newest: newestUpdatedAt ? newestUpdatedAt.toISOString() : null,
        },
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
