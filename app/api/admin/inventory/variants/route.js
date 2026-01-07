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

export async function GET(req) {
  try {
    const session = await auth();
    if (!isAdmin(session)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const take = Number(url.searchParams.get("take") || 100);
    const skip = Number(url.searchParams.get("skip") || 0);
    const q = url.searchParams.get("q")?.trim() || "";

    const where = q
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { barcode: { contains: q, mode: "insensitive" } },
            { sizeName: { contains: q, mode: "insensitive" } },
            {
              product: {
                title: { contains: q, mode: "insensitive" },
              },
            },
          ],
        }
      : {};

    const [variants, total] = await Promise.all([
      prisma.productVariant.findMany({
        where,
        include: {
          product: { select: { id: true, title: true, slug: true } },
          inventoryItems: {
            include: {
              warehouse: { select: { id: true, name: true, code: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.productVariant.count({ where }),
    ]);

    const data = variants.map((v) => {
      const available = computeAvailableFromInventoryItems(v.inventoryItems);
      return {
        id: v.id,
        productId: v.productId,
        productTitle: v.product?.title,
        productSlug: v.product?.slug,
        sku: v.sku,
        barcode: v.barcode,
        sizeName: v.sizeName,
        colorName: v.colorName,
        strapiSizeId: v.strapiSizeId,
        stockAvailable: v.stockAvailable,
        computedAvailable: available,
        inventory: v.inventoryItems.map((ii) => ({
          id: ii.id,
          warehouseId: ii.warehouseId,
          warehouseName: ii.warehouse?.name,
          warehouseCode: ii.warehouse?.code,
          onHand: ii.onHand,
          reserved: ii.reserved,
          safetyStock: ii.safetyStock,
        })),
      };
    });

    return NextResponse.json({ total, data });
  } catch (err) {
    console.error("Admin inventory variants GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
