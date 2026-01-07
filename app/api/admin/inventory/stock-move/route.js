export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

function isAdmin(session) {
  if (!session?.user) return false;
  const role =
    session.user.role ||
    (Array.isArray(session.user.roles) ? session.user.roles[0] : null);
  return role === "admin" || role === "superadmin";
}

function computeAvailableFromInventoryItems(items = []) {
  return items.reduce((sum, item) => {
    const onHand = Number(item.onHand ?? 0);
    const safety = Number(item.safetyStock ?? 0);
    const reserved = Number(item.reserved ?? 0);
    return sum + (onHand - safety - reserved);
  }, 0);
}

export async function POST(req) {
  try {
    const session = await auth();
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      variantId,
      warehouseId: warehouseIdRaw,
      type, // "IN" | "OUT" | "ADJUST"
      quantity,
      reason,
      reference,
    } = body || {};

    const qty = Number(quantity);
    if (!variantId || !type || !Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json(
        {
          error:
            "variantId, type and quantity (>0) are required. type = IN | OUT | ADJUST",
        },
        { status: 400 }
      );
    }

    if (!["IN", "OUT", "ADJUST"].includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    // Ensure variant exists
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        inventoryItems: true,
      },
    });

    if (!variant) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    }

    // Resolve warehouse
    let warehouseId = warehouseIdRaw || null;
    let warehouse = null;

    if (warehouseId) {
      warehouse = await prisma.warehouse.findUnique({
        where: { id: warehouseId },
      });
      if (!warehouse) {
        return NextResponse.json(
          { error: "Warehouse not found" },
          { status: 404 }
        );
      }
    } else {
      // fallback: first ACTIVE warehouse
      warehouse = await prisma.warehouse.findFirst({
        where: { status: "ACTIVE" },
      });
      if (!warehouse) {
        return NextResponse.json(
          { error: "No ACTIVE warehouse found" },
          { status: 400 }
        );
      }
      warehouseId = warehouse.id;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Get or create InventoryItem
      let inventory = await tx.inventoryItem.findUnique({
        where: {
          variantId_warehouseId: {
            variantId: variant.id,
            warehouseId,
          },
        },
      });

      if (!inventory) {
        inventory = await tx.inventoryItem.create({
          data: {
            variantId: variant.id,
            warehouseId,
            onHand: 0,
            reserved: 0,
            safetyStock: 0,
          },
        });
      }

      let newOnHand = inventory.onHand;

      if (type === "IN") {
        newOnHand = inventory.onHand + qty;
      } else if (type === "OUT") {
        // Basic guard: don't allow negative
        const projected = inventory.onHand - qty;
        if (projected < 0) {
          throw new Error(
            `Cannot move OUT ${qty}; onHand=${inventory.onHand} would become negative`
          );
        }
        newOnHand = projected;
      } else if (type === "ADJUST") {
        // quantity = target onHand after stock-take
        newOnHand = qty;
      }

      const updatedInventory = await tx.inventoryItem.update({
        where: { id: inventory.id },
        data: {
          onHand: newOnHand,
        },
      });

      // Create stock movement (always store positive quantity, direction via type)
      const movement = await tx.stockMovement.create({
        data: {
          inventoryItemId: updatedInventory.id,
          type,
          quantity: qty,
          reason: reason || null,
          reference: reference || null,
        },
      });

      // Recompute variant stockAvailable from all warehouses
      const allItems = await tx.inventoryItem.findMany({
        where: { variantId: variant.id },
      });

      const available = computeAvailableFromInventoryItems(allItems);

      const updatedVariant = await tx.productVariant.update({
        where: { id: variant.id },
        data: {
          stockAvailable: available,
        },
      });

      return {
        inventory: updatedInventory,
        movement,
        variant: updatedVariant,
        computedAvailable: available,
      };
    });

    return NextResponse.json({
      ok: true,
      variant: {
        id: result.variant.id,
        sku: result.variant.sku,
        stockAvailable: result.variant.stockAvailable,
        computedAvailable: result.computedAvailable,
      },
      inventory: result.inventory,
      movement: result.movement,
    });
  } catch (err) {
    console.error("Admin inventory stock-move POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
