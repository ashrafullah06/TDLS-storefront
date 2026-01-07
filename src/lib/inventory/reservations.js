// FILE: src/lib/reservations.js
import prisma from "../prisma";
import { recomputeVariantStock } from "./inventory";
import { syncVariantStockToStrapiById } from "./strapi-stock";

const n = (v) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Reserve stock against a cart item.
 * Ensures InventoryItem exists and has available qty (onHand - reserved - safetyStock).
 */
export async function reserveStock({
  variantId,
  warehouseId,
  quantity,
  cartItemId,
  expiresAt = null,
}) {
  if (quantity <= 0) return;

  await prisma.$transaction(async (tx) => {
    const inv = await tx.inventoryItem.findUnique({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      select: { id: true, onHand: true, reserved: true, safetyStock: true },
    });

    if (!inv) {
      throw new Error("inventory_item_missing");
    }

    const available =
      n(inv.onHand) - n(inv.reserved) - n(inv.safetyStock || 0);

    if (available < quantity) {
      throw new Error("insufficient_stock");
    }

    await tx.inventoryItem.update({
      where: { id: inv.id },
      data: { reserved: n(inv.reserved) + quantity },
    });

    await tx.stockReservation.create({
      data: {
        inventoryItemId: inv.id,
        cartItemId,
        quantity,
        warehouseId,
        expiresAt,
      },
    });
  });
}

/** Release all reservations for a cart item. */
export async function releaseReservationsByCartItem(cartItemId) {
  await prisma.$transaction(async (tx) => {
    const reservations = await tx.stockReservation.findMany({
      where: { cartItemId },
      select: { id: true, inventoryItemId: true, quantity: true },
    });

    for (const r of reservations) {
      const inv = await tx.inventoryItem.findUnique({
        where: { id: r.inventoryItemId },
        select: { reserved: true },
      });
      if (!inv) continue;

      await tx.inventoryItem.update({
        where: { id: r.inventoryItemId },
        data: {
          reserved: Math.max(0, n(inv.reserved) - r.quantity),
        },
      });
    }

    await tx.stockReservation.deleteMany({ where: { cartItemId } });
  });
}

/**
 * Commit reservations from OrderItem:
 *  - decrement InventoryItem.onHand
 *  - decrement InventoryItem.reserved
 *  - create StockMovement(OUT)
 *  - recompute ProductVariant.stockAvailable
 *  - after DB transaction, sync updated variants to Strapi
 */
export async function commitReservationsForOrder(orderId) {
  let affectedVariantIds = [];

  await prisma.$transaction(async (tx) => {
    const lines = await tx.orderItem.findMany({
      where: { orderId },
      select: { id: true },
    });

    const lineIds = lines.map((l) => l.id);
    if (!lineIds.length) return;

    const reservations = await tx.stockReservation.findMany({
      where: { orderItemId: { in: lineIds } },
      include: {
        inventoryItem: true, // { id, onHand, reserved, safetyStock, variantId, warehouseId, ... }
      },
    });

    const variantIdSet = new Set();

    for (const r of reservations) {
      const inv = r.inventoryItem;
      if (!inv) continue;

      const newOnHand = Math.max(0, n(inv.onHand) - r.quantity);
      const newReserved = Math.max(0, n(inv.reserved) - r.quantity);

      // 1) decrement onHand + reserved
      await tx.inventoryItem.update({
        where: { id: inv.id },
        data: {
          onHand: newOnHand,
          reserved: newReserved,
        },
      });

      // 2) create StockMovement(OUT)
      await tx.stockMovement.create({
        data: {
          inventoryItemId: inv.id,
          type: "OUT",
          quantity: r.quantity,
          reason: "ORDER_COMMIT",
          reference: orderId,
        },
      });

      // 3) recompute variant-level cached availability
      if (inv.variantId) {
        variantIdSet.add(inv.variantId);
        await recomputeVariantStock(tx, inv.variantId);
      }
    }

    // 4) cleanup reservations for these order lines
    await tx.stockReservation.deleteMany({
      where: { orderItemId: { in: lineIds } },
    });

    affectedVariantIds = Array.from(variantIdSet);
  });

  // 5) AFTER transaction: best-effort sync of updated variants to Strapi
  for (const variantId of affectedVariantIds) {
    try {
      await syncVariantStockToStrapiById(variantId);
    } catch (err) {
      console.warn(
        "[commitReservationsForOrder] Strapi sync failed for variant",
        variantId,
        String(err)
      );
    }
  }
}
