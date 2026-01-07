// FILE: scripts/migrate-size-stock-to-inventory.mjs
// One-time migration:
//   ProductVariant.initialStock  → InventoryItem.onHand
//   + recompute ProductVariant.stockAvailable from Inventory.
//
// Run with (DEV example):
//   node --env-file=.env.local scripts/migrate-size-stock-to-inventory.mjs
//
// Notes:
// - Uses APP_DB_USER_DIRECT if present to avoid PgBouncer issues.
// - Assumes each Strapi size row already mapped to a ProductVariant
//   and its initial stock is in ProductVariant.initialStock.

import { PrismaClient } from "@prisma/client";

// ───────────────── DB URL override (use direct Neon URL) ─────────────────
// Avoid PgBouncer connection_limit issues for this heavy script.
if (process.env.APP_DB_USER_DIRECT) {
  process.env.DATABASE_URL = process.env.APP_DB_USER_DIRECT;
}

console.log("🗄  Prisma DATABASE_URL for migration:", process.env.DATABASE_URL);

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

const MAIN_WAREHOUSE_CODE = "MAIN";

const n = (v) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

async function main() {
  console.log(
    "🚀 Starting migration: ProductVariant.initialStock → InventoryItem"
  );

  // 1) Ensure MAIN warehouse exists
  const mainWarehouse = await prisma.warehouse.upsert({
    where: { code: MAIN_WAREHOUSE_CODE },
    update: {},
    create: {
      code: MAIN_WAREHOUSE_CODE,
      name: "Main Warehouse",
    },
  });

  console.log("🏬 Using warehouse:", {
    id: mainWarehouse.id,
    code: mainWarehouse.code,
    name: mainWarehouse.name,
  });

  // 2) Read all variants that have a non-zero initialStock
  const variants = await prisma.productVariant.findMany({
    where: {
      initialStock: {
        gt: 0,
      },
    },
    select: {
      id: true,
      initialStock: true,
    },
  });

  console.log(
    `📦 Found ${variants.length} ProductVariant records with initialStock > 0`
  );

  if (!variants.length) {
    console.log(
      "ℹ️ No variants with initialStock > 0 found – nothing to migrate."
    );
    console.log(
      "👉 If you still have Strapi size-level stock, ensure your Strapi → Prisma sync fills ProductVariant.initialStock before running this script."
    );
    return;
  }

  // Track per-variant total onHand (for logging only; 1:1 here but kept for clarity)
  const variantTotals = new Map(); // variantId → onHandTotal

  // 3) For each variant, upsert InventoryItem for (variant, MAIN warehouse)
  for (const v of variants) {
    const onHand = Math.max(n(v.initialStock), 0);

    const prev = variantTotals.get(v.id) || 0;
    variantTotals.set(v.id, prev + onHand);

    await prisma.inventoryItem.upsert({
      where: {
        // requires @@unique([variantId, warehouseId]) in InventoryItem
        variantId_warehouseId: {
          variantId: v.id,
          warehouseId: mainWarehouse.id,
        },
      },
      update: {
        onHand,
        // Do not touch reserved/safety here; assume existing values or 0
      },
      create: {
        variantId: v.id,
        warehouseId: mainWarehouse.id,
        onHand,
        reserved: 0,
        safetyStock: 0,
      },
    });
  }

  console.log(
    `✅ Upserted InventoryItem rows for ${variantTotals.size} variants (MAIN warehouse)`
  );

  // 4) Recompute ProductVariant.stockAvailable / stockReserved using ALL InventoryItem rows
  const aggregates = await prisma.inventoryItem.groupBy({
    by: ["variantId"],
    _sum: {
      onHand: true,
      reserved: true,
      safetyStock: true,
    },
  });

  console.log(
    `🔁 Recomputing ProductVariant.stockAvailable for ${aggregates.length} variants`
  );

  for (const agg of aggregates) {
    const onHandTotal = n(agg._sum.onHand);
    const reservedTotal = n(agg._sum.reserved);
    const safetyTotal = n(agg._sum.safetyStock);

    const available = Math.max(onHandTotal - reservedTotal - safetyTotal, 0);

    await prisma.productVariant.update({
      where: { id: agg.variantId },
      data: {
        stockAvailable: available,
        stockReserved: reservedTotal,
      },
    });
  }

  console.log("🎉 Migration complete.");
  console.log(
    "👉 Now your InventoryItem + ProductVariant.stockAvailable are populated from ProductVariant.initialStock."
  );
}

main()
  .catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
