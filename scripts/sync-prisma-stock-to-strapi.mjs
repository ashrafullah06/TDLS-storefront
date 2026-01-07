// FILE: scripts/sync-prisma-stock-to-strapi.mjs
// One-way stock sync: Prisma (Inventory) → Strapi (size-row stock_quantity)

import { PrismaClient } from "@prisma/client";

// ───────────────── DB URL override for scripts ─────────────────
// Use a *direct* Neon URL (non-pooler) for this script to avoid
// PgBouncer connection_limit issues with the main app.
if (process.env.APP_DB_USER_DIRECT) {
  // This only affects this Node process
  process.env.DATABASE_URL = process.env.APP_DB_USER_DIRECT;
}

console.log("🗄  Prisma DATABASE_URL for stock sync:", process.env.DATABASE_URL);

const prisma = new PrismaClient();

// ───────────────── Strapi config ─────────────────

const STRAPI_BASE =
  process.env.STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  "http://localhost:1337";

const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN;

// Helper: Strapi POST with auth
async function strapiPost(path, body = {}) {
  const url = new URL(path, STRAPI_BASE);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Strapi POST ${url} failed: ${res.status} ${res.statusText} – ${txt}`
    );
  }
  return res.json();
}

function computeAvailableFromInventoryItems(items = []) {
  return items.reduce((sum, item) => {
    const onHand = Number(item.onHand ?? 0);
    const safety = Number(item.safetyStock ?? 0);
    const reserved = Number(item.reserved ?? 0);

    const raw = onHand - safety - reserved;
    const available = raw > 0 ? raw : 0; // never send negative stock to Strapi

    return sum + available;
  }, 0);
}

async function main() {
  console.log("🔄 Reading stock from Prisma…");

  const variants = await prisma.productVariant.findMany({
    where: {
      // Only variants that know which Strapi size-row they belong to
      strapiSizeId: { not: null },
    },
    include: {
      inventoryItems: true,
    },
  });

  console.log(`Found ${variants.length} variants with strapiSizeId`);

  const itemsPayload = variants.map((v) => {
    const available = computeAvailableFromInventoryItems(v.inventoryItems);
    return {
      sizeId: v.strapiSizeId,
      stock: available,
    };
  });

  // Send in batches to avoid huge payloads
  const batchSize = 200;
  for (let i = 0; i < itemsPayload.length; i += batchSize) {
    const batch = itemsPayload.slice(i, i + batchSize);
    console.log(
      `→ Updating Strapi stock for ${batch.length} size rows (batch ${
        i / batchSize + 1
      })`
    );

    const res = await strapiPost("/api/tdlc-sync/update-stock", {
      items: batch,
    });

    console.log("   Strapi response:", res?.updated?.length ?? 0, "rows");
  }

  console.log("✅ Prisma → Strapi stock sync complete");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Stock sync failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
