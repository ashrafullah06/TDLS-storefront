// PATH: scripts/sync-strapi-products.mjs
// Usage: node scripts/sync-strapi-products.mjs
//
// Goal:
//   - Strapi → Prisma sync for products & size-level variants
//   - NEW size rows: seed initialStock + stockAvailable from Strapi stock_quantity
//   - EXISTING size rows: NEVER touch stockAvailable / stockReserved / initialStock
//                         (we only update descriptive fields + strapiStockRaw)
//   - Size-level price: effective_price / effective_compare_at_price → Price rows
//
// Combined with the Prisma → Strapi cron route, this gives you
// a safe bi-directional sync where Prisma is ALWAYS the stock authority.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* ───────────────────────── config ───────────────────────── */

const STRAPI_URL = process.env.STRAPI_API_URL || "http://localhost:1337";
const STRAPI_TOKEN = process.env.STRAPI_API_TOKEN || "";

if (!STRAPI_URL) {
  console.error("❌ STRAPI_API_URL is not set.");
  process.exit(1);
}
if (!STRAPI_TOKEN) {
  console.error("❌ STRAPI_API_TOKEN is not set.");
  process.exit(1);
}

// Adjust page size if you have lots of products
const PAGE_SIZE = 50;

/* ───────────────────────── tiny helpers ───────────────────────── */

function clampInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return Math.round(v);
}

function cleanSlug(s) {
  if (!s) return "";
  return String(s).trim().toLowerCase();
}

function safeCurrency(code) {
  if (!code) return "BDT";
  return String(code).trim().toUpperCase();
}

/* ───────────────────────── Strapi fetch helpers ───────────────────────── */

async function fetchStrapi(path, searchParams = {}) {
  const base = STRAPI_URL.replace(/\/+$/, "");
  const url = new URL(base + path);

  for (const [k, v] of Object.entries(searchParams)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Strapi request failed: ${res.status} ${res.statusText} – ${text}`,
    );
  }

  const json = await res.json();
  return json;
}

/**
 * Fetch all Strapi products with nested variants + sizes.
 *
 * ⚠️ This is adapted to your CURRENT JSON shape:
 *   - res.data = [ { id, slug, name, price_currency, variants: [...] } ]
 *   - each variant has "sizes": [ { id, size_name, stock_quantity, effective_price, ... } ]
 */
async function fetchAllStrapiProducts() {
  console.log("▶ Fetching products from Strapi...");
  let page = 1;
  let all = [];

  while (true) {
    const res = await fetchStrapi("/api/products", {
      "pagination[page]": page,
      "pagination[pageSize]": PAGE_SIZE,
      "sort[0]": "updatedAt:asc",
      "populate[variants][populate][sizes]": "*",
    });

    const data = res.data || [];
    const meta = res.meta?.pagination || {};
    all = all.concat(data);

    console.log(
      `  - page ${page} → ${data.length} records (total: ${
        meta.total ?? "?"
      })`,
    );

    if (!meta.pageCount || page >= meta.pageCount) break;
    page += 1;
  }

  console.log(`✔ Fetched ${all.length} products from Strapi.`);
  return all;
}

/* ───────────────────────── mapping helpers ───────────────────────── */

/**
 * Map a single Strapi product row to Prisma Product data.
 *
 * row: {
 *   id,
 *   slug,
 *   name,
 *   short_description,
 *   description_html,
 *   description_raw,
 *   status,
 *   seo,
 *   ...
 * }
 */
function mapStrapiProduct(row) {
  const id = row.id;

  const seoPrimary = row.seo?.primary || {};

  return {
    strapiId: id,
    title: row.name ?? `Product ${id}`,
    subtitle: row.short_description ?? null,
    slug: cleanSlug(row.slug || row.name || `product-${id}`),
    description:
      row.description_html ??
      row.description_raw ??
      null,
    status: row.status || "draft",
    brand: row.brand || null,
    metaTitle: seoPrimary.title || null,
    metaDescription: seoPrimary.description || null,
    strapiUpdatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
    strapiSlug: row.slug || null,
    // We’ll use row.price_currency directly when creating Price rows.
  };
}

/**
 * Extract variant + size rows from Strapi product.
 *
 * Returns a flat list of:
 *   {
 *     strapiVariantId,
 *     strapiSizeId,
 *     sizeName,
 *     sizeLabel,
 *     colorName,
 *     colorLabel,
 *     colorCode,
 *     stock,
 *     price,
 *     compareAtPrice,
 *     sku,
 *     barcode,
 *   }
 */
function extractStrapiSizes(row) {
  const variants = row.variants || [];
  const result = [];

  for (const v of variants) {
    const rawVariantId = v.id ?? v.variant_id ?? null;
    const strapiVariantId =
      rawVariantId == null ? null : clampInt(rawVariantId);

    // color fields in your JSON
    const colorName = v.color ?? v.colorName ?? null;
    const colorLabel = v.color_label ?? v.colorLabel ?? null;
    const colorCode = v.color_code ?? v.colorCode ?? null;

    const sizes = v.sizes || [];

    for (const s of sizes) {
      const rawSizeId = s.id ?? s.size_id ?? null;
      const strapiSizeId = rawSizeId == null ? 0 : clampInt(rawSizeId);
      if (!strapiSizeId) continue;

      const stockQty = clampInt(
        s.stock_quantity ?? s.stock ?? s.qty ?? 0,
      );

      const price =
        s.effective_price ??
        s.price ??
        null;

      const compareAtPrice =
        s.effective_compare_at_price ??
        s.compare_at_price ??
        s.price_override ??
        null;

      result.push({
        strapiVariantId,
        strapiSizeId,
        sizeName: s.size_name ?? s.sizeName ?? s.size ?? null,
        sizeLabel: s.size_label ?? s.sizeLabel ?? null,
        colorName,
        colorLabel,
        colorCode,
        stock: stockQty,
        price,
        compareAtPrice,
        sku: s.sku ?? null,
        barcode: s.barcode ?? null,
      });
    }
  }

  return result;
}

/* ───────────────────────── price helper ───────────────────────── */

/**
 * Upsert a simple Price row for a given variant:
 *   - currency: from product.price_currency (fallback BDT)
 *   - amount: sizeRow.price
 *   - compareAt: sizeRow.compareAtPrice
 *
 * We keep it simple:
 *   - look for first Price where variantId + priceListId=null + currency match
 *   - create if none, update if exists
 */
async function upsertVariantPrice({ variantId, currency, price, compareAt }) {
  if (price == null && compareAt == null) {
    // nothing to write
    return;
  }

  const curr = safeCurrency(currency);

  const existing = await prisma.price.findFirst({
    where: {
      variantId,
      priceListId: null,
      currency: curr,
    },
  });

  if (!existing) {
    await prisma.price.create({
      data: {
        variantId,
        productId: null,
        currency: curr,
        amount: price != null ? price : 0,
        compareAt: compareAt != null ? compareAt : null,
        minQty: 1,
        maxQty: null,
      },
    });
  } else {
    await prisma.price.update({
      where: { id: existing.id },
      data: {
        amount: price != null ? price : existing.amount,
        compareAt:
          compareAt != null ? compareAt : existing.compareAt,
      },
    });
  }
}

/* ───────────────────────── core sync ───────────────────────── */

/**
 * Upsert one product & its variants into Prisma, with SAFE stock behaviour:
 *
 * - Product: upsert via strapiId
 * - Variant (size row): upsert via strapiSizeId
 *   - CREATE: set initialStock + stockAvailable from Strapi stock_quantity
 *   - UPDATE: DO NOT touch stockAvailable / stockReserved / initialStock
 *             (only update descriptive fields + strapiStockRaw)
 *   - Also ensure a Price row per variant using size-level pricing.
 */
async function syncOneProduct(row) {
  const mapped = mapStrapiProduct(row);
  const sizes = extractStrapiSizes(row);
  const currency = safeCurrency(row.price_currency || "BDT");

  // 1) Upsert Product
  const product = await prisma.product.upsert({
    where: { strapiId: mapped.strapiId },
    create: {
      title: mapped.title,
      subtitle: mapped.subtitle,
      slug: mapped.slug,
      description: mapped.description,
      status: mapped.status,
      brand: mapped.brand,
      metaTitle: mapped.metaTitle,
      metaDescription: mapped.metaDescription,
      strapiId: mapped.strapiId,
      strapiUpdatedAt: mapped.strapiUpdatedAt,
      strapiSlug: mapped.strapiSlug,
    },
    update: {
      title: mapped.title,
      subtitle: mapped.subtitle,
      slug: mapped.slug,
      description: mapped.description,
      status: mapped.status,
      brand: mapped.brand,
      metaTitle: mapped.metaTitle,
      metaDescription: mapped.metaDescription,
      strapiUpdatedAt: mapped.strapiUpdatedAt,
      strapiSlug: mapped.strapiSlug,
    },
  });

  // 2) Upsert ProductVariant rows for each Strapi size row
  let sizeCount = 0;

  for (const sizeRow of sizes) {
    if (!sizeRow.strapiSizeId) continue; // must have a size id
    sizeCount += 1;

    const liveStock = clampInt(sizeRow.stock);

    // We do NOT overwrite stockAvailable / stockReserved / initialStock on update
    const variant = await prisma.productVariant.upsert({
      where: { strapiSizeId: sizeRow.strapiSizeId },
      create: {
        productId: product.id,
        strapiSizeId: sizeRow.strapiSizeId,
        strapiVariantId: sizeRow.strapiVariantId || null,
        sizeName: sizeRow.sizeName,
        sizeLabel: sizeRow.sizeLabel,
        colorName: sizeRow.colorName,
        colorLabel: sizeRow.colorLabel,
        colorCode: sizeRow.colorCode,
        sku: sizeRow.sku,
        barcode: sizeRow.barcode,
        // stock fields – only on CREATE:
        initialStock: liveStock,
        stockAvailable: liveStock,
        stockReserved: 0,
        strapiStockRaw: liveStock,
        strapiStockSyncedAt: new Date(),
      },
      update: {
        // NEVER touch initialStock / stockAvailable / stockReserved here.
        productId: product.id,
        strapiVariantId: sizeRow.strapiVariantId || null,
        sizeName: sizeRow.sizeName,
        sizeLabel: sizeRow.sizeLabel,
        colorName: sizeRow.colorName,
        colorLabel: sizeRow.colorLabel,
        colorCode: sizeRow.colorCode,
        sku: sizeRow.sku,
        barcode: sizeRow.barcode,
        // Only update the diagnostic mirror:
        strapiStockRaw: liveStock,
        strapiStockSyncedAt: new Date(),
      },
    });

    // 3) Upsert Price for this size-level variant
    await upsertVariantPrice({
      variantId: variant.id,
      currency,
      price: sizeRow.price,
      compareAt: sizeRow.compareAtPrice,
    });
  }

  return { productId: product.id, sizesCount: sizeCount };
}

/* ───────────────────────── main ───────────────────────── */

async function main() {
  console.log("🚀 Strapi → Prisma product sync started…");
  const rows = await fetchAllStrapiProducts();

  let processed = 0;
  let variantTotal = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const res = await syncOneProduct(row);
      processed += 1;
      variantTotal += res.sizesCount;
      if (processed % 10 === 0) {
        console.log(
          `  … synced ${processed}/${rows.length} products (${variantTotal} size-variants so far)`,
        );
      }
    } catch (err) {
      console.error(
        `❌ Error syncing Strapi product id=${row.id}:`,
        err?.message || err,
      );
      errors.push({ id: row.id, message: err?.message || String(err) });
    }
  }

  console.log("✔ Strapi → Prisma sync completed.");
  console.log(`   Products processed: ${processed}`);
  console.log(`   Size-level variants: ${variantTotal}`);
  console.log(`   Errors: ${errors.length}`);

  if (errors.length) {
    console.log("   Sample errors:", errors.slice(0, 5));
  }

  await prisma.$disconnect();
}

// Run
main().catch(async (err) => {
  console.error("💥 Fatal error in sync:", err);
  await prisma.$disconnect();
  process.exit(1);
});
