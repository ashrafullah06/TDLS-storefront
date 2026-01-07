// FILE: src/lib/inventory.js
// Canonical inventory helpers: compute availability and recompute ProductVariant.stockAvailable.

import prisma from "../prisma";

const n = (v) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Compute availability from a variant that has inventoryItems loaded
 * OR directly from an array of InventoryItem-like objects.
 *
 * Formula:
 *   onHand      = Σ onHand
 *   reserved    = Σ reserved
 *   safetyStock = Σ safetyStock
 *   available   = max(0, onHand - reserved - safetyStock)
 */
export function computeVariantAvailabilityFromInventory(input) {
  const items = Array.isArray(input)
    ? input
    : Array.isArray(input?.inventoryItems)
    ? input.inventoryItems
    : [];

  let onHand = 0;
  let reserved = 0;
  let safety = 0;

  for (const it of items) {
    onHand += n(it.onHand);
    reserved += n(it.reserved);
    safety += n(it.safetyStock);
  }

  const available = Math.max(0, onHand - reserved - safety);
  return { onHand, reserved, safety, available };
}

/**
 * Recompute and persist ProductVariant.stockAvailable from InventoryItem rows.
 * Can be called with either a Prisma client or tx object.
 */
export async function recomputeVariantStock(txOrClient, variantId) {
  const db = txOrClient || prisma;

  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    include: {
      inventoryItems: true,
    },
  });

  if (!variant) return null;

  const { onHand, reserved, safety, available } =
    computeVariantAvailabilityFromInventory(variant);

  await db.productVariant.update({
    where: { id: variantId },
    data: {
      stockAvailable: available,
    },
  });

  return { onHand, reserved, safety, available };
}

/**
 * Resolve available stock using already-loaded variant (no DB roundtrip).
 */
export function resolveVariantAvailableStockFromLoaded(variant) {
  const { available } = computeVariantAvailabilityFromInventory(variant);
  return available;
}
