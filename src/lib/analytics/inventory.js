// FILE: src/lib/analytics/inventory.js
import prisma from "@/lib/prisma";
import { n } from "./_utils";

/**
 * Inventory:
 * - total onHand/reserved/available
 * - low-stock list (available <= max(safetyStock, reorderPoint)) when thresholds exist
 * - fallback to ProductVariant stock fields when InventoryItem is not available
 */
export async function computeInventory({ take = 25 } = {}) {
  const safeTake = Math.max(1, Number.isFinite(Number(take)) ? Number(take) : 25);

  // -----------------------------
  // 1) Primary: InventoryItem
  // -----------------------------
  let items = null;

  try {
    if (prisma?.inventoryItem?.findMany) {
      items = await prisma.inventoryItem.findMany({
        select: {
          id: true,
          variantId: true,
          sku: true,

          // Common stock fields
          onHand: true,
          reserved: true,

          // Optional thresholds (if your schema has them)
          safetyStock: true,
          reorderPoint: true,
        },
      });
    }
  } catch {
    items = null;
  }

  if (Array.isArray(items) && items.length) {
    const totals = { onHand: 0, reserved: 0, available: 0 };
    const rows = [];

    for (const it of items) {
      const onHand = n(it?.onHand, 0);
      const reserved = n(it?.reserved, 0);
      const available = onHand - reserved;

      totals.onHand += onHand;
      totals.reserved += reserved;
      totals.available += available;

      const safety =
        it && typeof it.safetyStock !== "undefined" && it.safetyStock !== null
          ? n(it.safetyStock, 0)
          : null;

      const reorder =
        it && typeof it.reorderPoint !== "undefined" && it.reorderPoint !== null
          ? n(it.reorderPoint, 0)
          : null;

      const threshold =
        safety == null && reorder == null ? null : Math.max(n(safety, 0), n(reorder, 0));

      rows.push({
        inventoryItemId: it?.id ?? null,
        variantId: it?.variantId ?? null,
        sku: it?.sku ?? null,
        onHand,
        reserved,
        available,
        threshold,
        isLow: threshold == null ? null : available <= threshold,
      });
    }

    const lowCandidates = rows
      .filter((r) => r && r.variantId)
      .slice()
      .sort((a, b) => n(a.available, 0) - n(b.available, 0));

    const low = (rows.some((r) => r.isLow === true)
      ? lowCandidates.filter((r) => r.isLow === true)
      : lowCandidates
    ).slice(0, safeTake);

    // Enrich low-stock with variant titles (best-effort, still real DB)
    const ids = low.map((r) => r.variantId).filter(Boolean);
    let variants = [];
    try {
      if (ids.length && prisma?.productVariant?.findMany) {
        variants = await prisma.productVariant.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, colorName: true, sizeName: true },
        });
      }
    } catch {
      variants = [];
    }

    const vById = new Map((variants || []).map((v) => [v.id, v]));

    const lowStock = low.map((r) => {
      const v = vById.get(r.variantId) || null;
      return {
        ...r,
        title: v?.title ?? null,
        colorName: v?.colorName ?? null,
        sizeName: v?.sizeName ?? null,
      };
    });

    return {
      totals,
      lowStock,
      source: "inventoryItem",
    };
  }

  // ----------------------------------------
  // 2) Fallback: ProductVariant stock fields
  // ----------------------------------------
  let variants = [];
  let mode = "stockOnHand/stockReserved/stockAvailable";

  // Try #1: your earlier fields
  try {
    if (prisma?.productVariant?.findMany) {
      variants = await prisma.productVariant.findMany({
        where: { archivedAt: null },
        select: {
          id: true,
          sku: true,
          title: true,
          colorName: true,
          sizeName: true,
          stockOnHand: true,
          stockReserved: true,
          stockAvailable: true,
        },
      });
    }
  } catch {
    variants = [];
  }

  // Try #2: alternate naming (still real DB, no assumptions)
  if (!variants.length) {
    mode = "onHand/reserved/available";
    try {
      if (prisma?.productVariant?.findMany) {
        variants = await prisma.productVariant.findMany({
          select: {
            id: true,
            sku: true,
            title: true,
            colorName: true,
            sizeName: true,
            onHand: true,
            reserved: true,
            available: true,
          },
        });
      }
    } catch {
      variants = [];
    }
  }

  // Try #3: single quantity field
  if (!variants.length) {
    mode = "stockQuantity";
    try {
      if (prisma?.productVariant?.findMany) {
        variants = await prisma.productVariant.findMany({
          select: {
            id: true,
            sku: true,
            title: true,
            colorName: true,
            sizeName: true,
            stockQuantity: true,
          },
        });
      }
    } catch {
      variants = [];
    }
  }

  const totals = { onHand: 0, reserved: 0, available: 0 };

  const normalized = (variants || []).map((v) => {
    let onHand = 0;
    let reserved = 0;
    let available = 0;

    if (mode === "stockOnHand/stockReserved/stockAvailable") {
      onHand = n(v?.stockOnHand, 0);
      reserved = n(v?.stockReserved, 0);
      available = Number.isFinite(Number(v?.stockAvailable))
        ? n(v?.stockAvailable, 0)
        : onHand - reserved;
    } else if (mode === "onHand/reserved/available") {
      onHand = n(v?.onHand, 0);
      reserved = n(v?.reserved, 0);
      available = Number.isFinite(Number(v?.available))
        ? n(v?.available, 0)
        : onHand - reserved;
    } else {
      // stockQuantity
      onHand = n(v?.stockQuantity, 0);
      reserved = 0;
      available = onHand;
    }

    totals.onHand += onHand;
    totals.reserved += reserved;
    totals.available += available;

    return {
      variantId: v?.id ?? null,
      sku: v?.sku ?? null,
      title: v?.title ?? null,
      colorName: v?.colorName ?? null,
      sizeName: v?.sizeName ?? null,
      onHand,
      reserved,
      available,
    };
  });

  const lowStock = normalized
    .slice()
    .sort((a, b) => n(a.available, 0) - n(b.available, 0))
    .slice(0, safeTake);

  return { totals, lowStock, source: "productVariant", mode };
}
