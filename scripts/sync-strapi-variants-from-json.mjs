// FILE: scripts/sync-strapi-variants-from-json.js
// Purpose: bulk sync ALL Strapi products (variants + sizes) into Prisma Product + ProductVariant.

"use strict";

require("dotenv").config();
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

/* ----------------------- ENV & STRAPI BASE ----------------------- */

const STRAPI_BASE =
  process.env.STRAPI_API_ORIGIN ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.STRAPI_API_URL ||
  "http://127.0.0.1:1337";

console.log("[sync-json] Using DATABASE_URL =", process.env.DATABASE_URL || "<empty>");
console.log("[sync-json] STRAPI_BASE =", STRAPI_BASE);

/* -------------------------- Strapi helpers -------------------------- */

function norm(str) {
  return (str ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getAttr(p) {
  return p && p.attributes ? p.attributes : p;
}

// Handle both raw Strapi and flattened shapes
function getVariants(product) {
  const a = getAttr(product);
  const v = a && (a.variants || a.product_variants || a.variants_json);

  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.data)) return v.data.map((x) => getAttr(x));
  return [];
}

function getSizes(variant) {
  const s = variant && (variant.sizes || variant.size_stocks);
  if (!s) return [];
  if (Array.isArray(s)) return s;
  if (Array.isArray(s?.data)) return s.data.map((x) => getAttr(x));
  return [];
}

/* -------------------------- HTTP helpers -------------------------- */

async function getJson(url) {
  if (typeof fetch !== "function") {
    throw new Error(
      "Global fetch is not available. Use Node 18+ or add a fetch polyfill."
    );
  }
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Fetch failed ${res.status} ${res.statusText} – ${t}`);
  }
  return res.json();
}

async function fetchAllStrapiProducts() {
  let page = 1;
  const pageSize = 50;
  const all = [];

  for (;;) {
    const url = new URL("/api/products", STRAPI_BASE);
    url.searchParams.set("pagination[page]", String(page));
    url.searchParams.set("pagination[pageSize]", String(pageSize));
    url.searchParams.set("populate", "deep,5");

    const json = await getJson(url.toString());
    const data = Array.isArray(json?.data) ? json.data : [];
    const meta = json?.meta || {};
    const pagination = meta.pagination || {};

    all.push(...data);

    const pageCount = Number(pagination.pageCount || 1);
    if (page >= pageCount) break;
    page += 1;
  }

  return all;
}

/* ------------------------ Prisma upsert helpers ------------------------ */

async function upsertProductFromStrapiNode(node) {
  const a = getAttr(node);
  const strapiIdRaw = node?.id ?? a?.id ?? null;
  const strapiId = strapiIdRaw != null ? Number(strapiIdRaw) : null;
  const slug = a?.slug ? String(a.slug) : null;

  const title =
    a?.name ||
    a?.title ||
    slug ||
    `strapi-${strapiId || crypto.randomUUID().slice(0, 8)}`;

  if (!slug && strapiId == null) {
    console.warn("[sync-json] skipping product with no slug/id:", node);
    return null;
  }

  const whereOR = [];
  if (strapiId != null) whereOR.push({ strapiId });
  if (slug) {
    whereOR.push({ slug });
    whereOR.push({ strapiSlug: slug });
  }

  let existing = null;
  if (whereOR.length) {
    existing = await prisma.product.findFirst({ where: { OR: whereOR } });
  }

  const baseData = {
    title: String(title),
  };

  if (slug) baseData.slug = slug;
  if (strapiId != null) baseData.strapiId = strapiId;
  if (slug) baseData.strapiSlug = slug;
  if (a?.updatedAt) baseData.strapiUpdatedAt = new Date(a.updatedAt);

  if (!existing) {
    const created = await prisma.product.create({ data: baseData });
    console.log(
      `[sync-json] Created Product id=${created.id} ← Strapi id=${strapiId} slug="${slug}"`
    );
    return created;
  }

  const updated = await prisma.product.update({
    where: { id: existing.id },
    data: baseData,
  });
  console.log(
    `[sync-json] Updated Product id=${updated.id} ← Strapi id=${strapiId} slug="${slug}"`
  );
  return updated;
}

async function upsertVariantForSize({ prismaProduct, color, sizeId, sizeName }) {
  const productId = prismaProduct.id;
  const colorLabel = color || "default";
  const sizeLabel = sizeName || "ONE";

  // Try strict by strapiSizeId first
  let existing = null;
  if (sizeId != null) {
    existing = await prisma.productVariant.findUnique({
      where: { strapiSizeId: sizeId },
    });
  }

  // Fallback: same product + colorLabel + sizeLabel
  if (!existing) {
    existing = await prisma.productVariant.findFirst({
      where: { productId, colorLabel, sizeLabel },
    });
  }

  const baseData = {
    productId,
    colorLabel,
    sizeLabel,
  };
  if (sizeId != null) baseData.strapiSizeId = sizeId;

  if (!existing) {
    const created = await prisma.productVariant.create({
      data: baseData,
    });
    console.log(
      `[sync-json]   Created ProductVariant id=${created.id} (product=${productId}, color="${colorLabel}", size="${sizeLabel}", strapiSizeId=${sizeId})`
    );
    return created;
  }

  const updated = await prisma.productVariant.update({
    where: { id: existing.id },
    data: baseData,
  });
  console.log(
    `[sync-json]   Updated ProductVariant id=${updated.id} (product=${productId}, color="${colorLabel}", size="${sizeLabel}", strapiSizeId=${sizeId})`
  );
  return updated;
}

/* ----------------------------- main ----------------------------- */

async function main() {
  console.log("[sync-json] Fetching all products from Strapi…");

  const products = await fetchAllStrapiProducts();
  console.log(`[sync-json] Got ${products.length} Strapi products`);

  let syncedProducts = 0;
  let createdVariants = 0;
  let updatedVariants = 0;
  let failedSizes = 0;

  for (const node of products) {
    const a = getAttr(node);
    const slug = a?.slug;
    const name = a?.name || a?.title || `id:${node.id}`;

    try {
      const prismaProduct = await upsertProductFromStrapiNode(node);
      if (!prismaProduct) continue;
      syncedProducts += 1;

      const variants = getVariants(node);
      for (const v of variants) {
        const color = v.color || v.colour || "default";
        const sizes = getSizes(v);
        if (!sizes.length) continue;

        for (const s of sizes) {
          const sizeIdRaw = s?.id ?? s?.strapi_id ?? null;
          const sizeId =
            sizeIdRaw != null && !Number.isNaN(Number(sizeIdRaw))
              ? Number(sizeIdRaw)
              : null;
          const sizeName =
            s.size_name || s.size || s.label || s.primary_value || "ONE";

          try {
            const before =
              sizeId != null
                ? await prisma.productVariant.findUnique({
                    where: { strapiSizeId: sizeId },
                  })
                : null;
            const variant = await upsertVariantForSize({
              prismaProduct,
              color,
              sizeId,
              sizeName,
            });
            if (!before && variant) createdVariants += 1;
            if (before && variant) updatedVariants += 1;
          } catch (err) {
            failedSizes += 1;
            console.warn(
              `[sync-json]   FAILED size for product="${name}" slug="${slug}" color="${color}" size="${sizeName}" sizeId=${sizeId}:`,
              err?.message || err
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `[sync-json] ERROR syncing Strapi product "${name}" slug="${slug}":`,
        err?.message || err
      );
    }
  }

  console.log("────────────────────────────────────────────");
  console.log("[sync-json] DONE");
  console.log(`[sync-json] Synced products:        ${syncedProducts}`);
  console.log(`[sync-json] Variants created:       ${createdVariants}`);
  console.log(`[sync-json] Variants updated:       ${updatedVariants}`);
  console.log(`[sync-json] Size rows failed:       ${failedSizes}`);
}

main()
  .catch((err) => {
    console.error("[sync-json] FATAL:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
