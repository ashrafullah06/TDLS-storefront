// PATH: app/api/admin/sync-strapi-products/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prismaDirect from "@/lib/prisma-direct";

/* ───────────────────────── config ───────────────────────── */

const IS_DEV = process.env.NODE_ENV !== "production";

// Prefer explicit API URL variants, then STRAPI_URL, then local
const STRAPI_URL =
  process.env.STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.STRAPI_URL ||
  "http://127.0.0.1:1337";

const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_GRAPHQL_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_TOKEN ||
  process.env.STRAPI_TOKEN ||
  "";

// IMPORTANT: only ADMIN_SYNC_SECRET, no fallback to USER_SYNC_SECRET
const ADMIN_SYNC_SECRET = (process.env.ADMIN_SYNC_SECRET || "").trim();

// Adjust page size if you have lots of products
const PAGE_SIZE = 50;

/* ───────────────────────── tiny helpers ───────────────────────── */

function j(body, status = 200) {
  return new NextResponse(
    body === undefined ? "null" : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

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

function normalizeStrapiBase(raw) {
  let u = (raw || "").trim();
  if (!u) u = "http://127.0.0.1:1337";
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");
  return u.replace(/\/+$/, "");
}

// DEV: always talk to local Strapi
// PROD: use configured CMS URL
const STRAPI_BASE = IS_DEV
  ? "http://127.0.0.1:1337"
  : normalizeStrapiBase(STRAPI_URL);

console.log(
  "[admin/sync-strapi-products] STRAPI_BASE =",
  STRAPI_BASE
);
console.log(
  "[admin/sync-strapi-products] ADMIN_SYNC_SECRET length =",
  ADMIN_SYNC_SECRET.length
);

async function fetchStrapi(path, searchParams = {}) {
  const base = STRAPI_BASE;
  const url = new URL(base.replace(/\/+$/, "") + path);

  for (const [k, v] of Object.entries(searchParams)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }

  const headers = {
    "Content-Type": "application/json",
    ...(STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {}),
  };

  const res = await fetch(url.toString(), {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Strapi request failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  const json = await res.json();
  return json;
}

/**
 * Fetch all Strapi products with nested variants + sizes.
 *
 * Shape assumed (your current JSON):
 *   res.data = [ { id, slug, name, price_currency, variants: [...] } ]
 *   each variant has "sizes": [ { id, size_name, stock_quantity, effective_price, ... } ]
 */
async function fetchAllStrapiProducts() {
  console.log("▶ [admin sync] Fetching products from Strapi…");
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
      })`
    );

    if (!meta.pageCount || page >= meta.pageCount) break;
    page += 1;
  }

  console.log(`✔ [admin sync] Fetched ${all.length} products from Strapi.`);
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
    // product.priceCurrency stays optional, prices use row.price_currency directly
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
        s.stock_quantity ?? s.stock ?? s.qty ?? 0
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

  const existing = await prismaDirect.price.findFirst({
    where: {
      variantId,
      priceListId: null,
      currency: curr,
    },
  });

  if (!existing) {
    await prismaDirect.price.create({
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
    await prismaDirect.price.update({
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
 *   - UPDATE (mode="default"):
 *       DO NOT touch stockAvailable / stockReserved / initialStock
 *       (only update descriptive fields + strapiStockRaw)
 *   - UPDATE (mode="restock"):
 *       If Strapi stock > Prisma stockAvailable, treat as restock and raise
 *       stockAvailable up to Strapi value (never lower it).
 *
 * Also ensure a Price row per variant using size-level pricing.
 *
 * This guarantees:
 *   - Prisma is ALWAYS the stock authority during normal syncs.
 *   - New Strapi sizes seed stock once; orders & inventory live in Prisma.
 *   - When mode="restock", Strapi can correct Prisma upwards after refills.
 */
async function syncOneProduct(row, { mode = "default" } = {}) {
  const mapped = mapStrapiProduct(row);
  const sizes = extractStrapiSizes(row);
  const currency = safeCurrency(row.price_currency || "BDT");

  // 1) Upsert Product
  const product = await prismaDirect.product.upsert({
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

    const strapiStock = clampInt(sizeRow.stock);

    // We do NOT overwrite stockAvailable / stockReserved / initialStock
    // in "default" mode. In "restock" mode we may adjust AFTER upsert.
    const variant = await prismaDirect.productVariant.upsert({
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
        initialStock: strapiStock,
        stockAvailable: strapiStock,
        stockReserved: 0,
        strapiStockRaw: strapiStock,
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
        strapiStockRaw: strapiStock,
        strapiStockSyncedAt: new Date(),
      },
    });

    // ───────── restock mode: let Strapi correct Prisma upwards only ─────────
    if (mode === "restock") {
      const currentAvailable = clampInt(variant.stockAvailable ?? 0);
      const target = strapiStock;

      // Only treat as restock if Strapi says there is MORE stock than Prisma
      if (target > currentAvailable) {
        const delta = target - currentAvailable;

        console.log(
          `[admin sync][restock] productVariant id=${variant.id}, strapiSizeId=${variant.strapiSizeId} – Prisma stockAvailable=${currentAvailable}, Strapi=${target}, delta=+${delta}`
        );

        await prismaDirect.productVariant.update({
          where: { id: variant.id },
          data: {
            stockAvailable: target,
            // Optional: ensure initialStock is at least the max seen
            initialStock:
              (variant.initialStock ?? 0) < target
                ? target
                : variant.initialStock,
          },
        });

        // NOTE:
        // If you later wire InventoryItem / InventoryMovement, this is the
        // correct place to also create a "RESTOCK" movement.
      } else if (target < currentAvailable) {
        // Strapi stock lower than Prisma → do NOT reduce.
        // You can rely on /api/internal/stock-diff to surface these as red alerts.
        console.log(
          `[admin sync][restock] WARNING: Strapi stock (${target}) < Prisma stockAvailable (${currentAvailable}) for variant id=${variant.id}, strapiSizeId=${variant.strapiSizeId}. Skipping reduction.`
        );
      }
    }

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

/* ───────────────────────── runner ───────────────────────── */

async function runSync({ dryRun = false, mode = "default" } = {}) {
  console.log(
    `🚀 [admin sync] Strapi → Prisma product sync started… (dryRun=${dryRun}, mode=${mode})`
  );
  const startedAt = Date.now();

  const rows = await fetchAllStrapiProducts();

  let processed = 0;
  let variantTotal = 0;
  const errors = [];

  if (dryRun) {
    // Only parse / map, no DB writes
    for (const row of rows) {
      try {
        const sizes = extractStrapiSizes(row);
        processed += 1;
        variantTotal += sizes.length;
      } catch (err) {
        errors.push({
          id: row.id,
          message: err?.message || String(err),
        });
      }
    }
  } else {
    for (const row of rows) {
      try {
        const res = await syncOneProduct(row, { mode });
        processed += 1;
        variantTotal += res.sizesCount;
        if (processed % 10 === 0) {
          console.log(
            `  … synced ${processed}/${rows.length} products (${variantTotal} size-variants so far)`
          );
        }
      } catch (err) {
        console.error(
          `❌ [admin sync] Error syncing Strapi product id=${row.id}:`,
          err?.message || err
        );
        errors.push({ id: row.id, message: err?.message || String(err) });
      }
    }
  }

  const ms = Date.now() - startedAt;
  console.log("✔ [admin sync] Strapi → Prisma product sync completed.");
  console.log(`   Products processed: ${processed}`);
  console.log(`   Size-level variants: ${variantTotal}`);
  console.log(`   Errors: ${errors.length}`);
  if (errors.length) {
    console.log("   Sample errors:", errors.slice(0, 5));
  }

  return {
    ok: errors.length === 0,
    processed,
    variantTotal,
    ms,
    errors,
  };
}

/* ───────────────────────── security ───────────────────────── */

function assertAdminSecret(req) {
  if (!ADMIN_SYNC_SECRET) {
    throw new Error("ADMIN_SYNC_SECRET not configured in environment");
  }
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("secret");
  const fromHeader =
    req.headers.get("x-admin-sync-secret") ||
    req.headers.get("x-user-sync-secret");

  const token = (fromQuery || fromHeader || "").trim();
  if (!token || token !== ADMIN_SYNC_SECRET) {
    throw new Error("UNAUTHORIZED_SYNC_TOKEN");
  }
}

/* ───────────────────────── route handlers ───────────────────────── */

export async function GET(req) {
  try {
    assertAdminSecret(req);

    const url = new URL(req.url);

    const modeParam = url.searchParams.get("mode") || "default";
    // "snapshot" still means DRY RUN, for backwards compatibility
    const dry =
      url.searchParams.get("dry") === "1" || modeParam === "snapshot";

    const mode = modeParam === "restock" ? "restock" : "default";

    const result = await runSync({ dryRun: dry, mode });

    return j(
      {
        ok: result.ok,
        dryRun: dry,
        mode,
        summary: {
          productsProcessed: result.processed,
          sizeVariantsProcessed: result.variantTotal,
          ms: result.ms,
          errors: result.errors.slice(0, 20), // cap for response
        },
      },
      200
    );
  } catch (err) {
    console.error("[admin/sync-strapi-products][GET] error:", err);
    return j(
      {
        ok: false,
        error: "SYNC_FAILED",
        message: err?.message || String(err),
      },
      err?.message === "UNAUTHORIZED_SYNC_TOKEN" ? 401 : 500
    );
  }
}

export async function POST(req) {
  // POST behaves the same as GET but is easier to call from admin UI
  return GET(req);
}
