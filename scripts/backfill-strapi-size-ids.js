// FILE: scripts/backfill-strapi-size-ids.js
// Purpose: Long-term bridge between Strapi "sizes" and Prisma ProductVariant
// - For each Strapi product.variant.size row:
//     • finds the matching Prisma Product (by slug / strapiSlug / strapiId)
//     • finds the matching ProductVariant (by Color + Size option values)
//     • writes: strapiSizeId, sizeLabel, colorLabel
//
// Safe to run multiple times (idempotent-ish).
// It ONLY updates existing ProductVariant rows; it never creates or deletes them.

"use strict";

const path = require("path");
const dotenv = require("dotenv");

// ──────────────────────────────────────────────────────────────
// Load env files in the same way your dev app does
// Order: .env.local → .env.development → .env
// ──────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, "..");

for (const file of [".env.local", ".env.development", ".env"]) {
  dotenv.config({
    path: path.join(ROOT, file),
    override: false,
  });
}

// Prisma singleton (same one your app uses)
const prismaModule = require("../src/lib/prisma");
const prisma = prismaModule.default || prismaModule;

const STRAPI_BASE =
  process.env.STRAPI_API_ORIGIN ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.STRAPI_API_URL ||
  "http://localhost:1337";

/* -------------------------- helper: HTTP fetch -------------------------- */

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
    const text = await res.text().catch(() => "");
    throw new Error(`Fetch failed ${res.status} ${res.statusText} – ${text}`);
  }
  return res.json();
}

/* --------------------- helpers to normalize Strapi shape --------------------- */

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

// Try to handle both:
// - flattened shape (your /api/strapi proxy) where variants is an array
// - raw Strapi, where variants may be in attributes
function getVariants(product) {
  const a = getAttr(product);
  const v = a && a.variants;

  if (!v) return [];
  if (Array.isArray(v)) return v;

  // If Strapi ever returns { data: [...] }
  if (Array.isArray(v.data)) {
    return v.data.map((x) => getAttr(x));
  }

  return [];
}

function getSizes(variant) {
  const s = variant && variant.sizes;
  if (!s) return [];
  if (Array.isArray(s)) return s;
  if (Array.isArray(s?.data)) return s.data.map((x) => getAttr(x));
  return [];
}

/* ------------- match Prisma ProductVariant by Color + Size options ------------- */

function matchVariantByColorSize(prismaProduct, wantColor, wantSize) {
  const wantColorNorm = norm(wantColor);
  const wantSizeNorm = norm(wantSize);

  const variants = prismaProduct.variants || [];

  return (
    variants.find((v) => {
      const pairs = v.optionValues.map((ov) => ({
        option: norm(ov.optionValue.option?.name),
        value: norm(ov.optionValue.value),
      }));

      const values = pairs.map((p) => p.value);

      const hasColorByName =
        !wantColorNorm ||
        pairs.some(
          (p) =>
            (p.option.includes("color") || p.option.includes("colour")) &&
            p.value === wantColorNorm
        );

      const hasSizeByName =
        !wantSizeNorm ||
        pairs.some((p) => p.option.includes("size") && p.value === wantSizeNorm);

      const hasColorLoose = !wantColorNorm || values.includes(wantColorNorm);
      const hasSizeLoose = !wantSizeNorm || values.includes(wantSizeNorm);

      const colorOk = wantColorNorm ? hasColorByName || hasColorLoose : true;
      const sizeOk = wantSizeNorm ? hasSizeByName || hasSizeLoose : true;

      return colorOk && sizeOk;
    }) || null
  );
}

/* ------------------- main sync: over all Strapi products ------------------- */

async function fetchAllStrapiProducts() {
  let page = 1;
  const pageSize = 50;
  const all = [];

  for (;;) {
    const url = new URL("/api/products", STRAPI_BASE);
    url.searchParams.set("pagination[page]", String(page));
    url.searchParams.set("pagination[pageSize]", String(pageSize));
    // Deep populate so we get variants.sizes
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

async function main() {
  console.log("[sync] Starting Strapi → Prisma size-id backfill");
  console.log("[sync] STRAPI_BASE =", STRAPI_BASE);

  const products = await fetchAllStrapiProducts();
  console.log(`[sync] Fetched ${products.length} products from Strapi`);

  let matchedCount = 0;
  let updatedCount = 0;
  let unmatchedCount = 0;
  let missingProductCount = 0;

  for (const p of products) {
    const a = getAttr(p);
    const slug = a.slug || a?.slug?.toString?.();
    const name = a.name || a.title || `id:${p.id}`;
    const strapiId = typeof p.id === "number" ? p.id : Number(p.id || NaN);

    if (!slug && !Number.isFinite(strapiId)) {
      console.warn(
        `[sync] Skip Strapi product without slug and numeric id (raw id=${p.id})`
      );
      continue;
    }

    // Load Prisma product + its variants + option values
    const orClauses = [];
    if (slug) {
      orClauses.push({ slug: String(slug) });
      orClauses.push({ strapiSlug: String(slug) });
    }
    if (Number.isFinite(strapiId)) {
      orClauses.push({ strapiId });
    }

    const prismaProduct = await prisma.product.findFirst({
      where: { OR: orClauses },
      include: {
        variants: {
          include: {
            optionValues: {
              include: {
                optionValue: {
                  include: { option: true },
                },
              },
            },
          },
        },
      },
    });

    if (!prismaProduct) {
      missingProductCount++;
      console.warn(
        `[sync] No Prisma product found for Strapi id=${p.id}, slug="${slug}" (Strapi "${name}")`
      );
      continue;
    }

    const variants = getVariants(p);
    if (!variants.length) {
      console.warn(
        `[sync] Strapi product "${name}" (id=${p.id}, slug="${slug}") has no variants; skipping`
      );
      continue;
    }

    for (const v of variants) {
      const color = v.color || v.colour || "default";
      const sizes = getSizes(v);
      if (!sizes.length) {
        console.warn(
          `[sync] Strapi product "${name}" (id=${p.id}, slug="${slug}") variant color="${color}" has no sizes; skipping`
        );
        continue;
      }

      for (const s of sizes) {
        const sizeId = s.id;
        const sizeName =
          s.size_name || s.size || s.label || s.primary_value || "ONE";

        if (sizeId == null) {
          console.warn(
            `[sync] Size row missing id for product "${name}" (id=${p.id}, slug="${slug}"), color="${color}", size="${sizeName}"`
          );
          continue;
        }

        const pv = matchVariantByColorSize(prismaProduct, color, sizeName);

        if (!pv) {
          unmatchedCount++;
          console.warn(
            `[sync] UNMATCHED → Strapi product "${name}" (id=${p.id}, slug="${slug}"), color="${color}", size="${sizeName}" (sizeId=${sizeId}) – no Prisma ProductVariant found`
          );
          continue;
        }

        matchedCount++;

        // Only update if something actually changed
        const already =
          pv.strapiSizeId === sizeId &&
          pv.sizeLabel === sizeName &&
          pv.colorLabel === color;

        if (already) {
          continue;
        }

        await prisma.productVariant.update({
          where: { id: pv.id },
          data: {
            strapiSizeId: sizeId,
            sizeLabel: sizeName,
            colorLabel: color,
          },
        });

        updatedCount++;
        console.log(
          `[sync] Updated ProductVariant ${pv.id} ← (Strapi id=${p.id}, slug="${slug}", color="${color}", size="${sizeName}", strapiSizeId=${sizeId})`
        );
      }
    }
  }

  console.log("────────────────────────────────────────────");
  console.log("[sync] DONE");
  console.log(`[sync] Products missing in Prisma: ${missingProductCount}`);
  console.log(`[sync] Size rows matched to variants: ${matchedCount}`);
  console.log(`[sync] ProductVariants updated:     ${updatedCount}`);
  console.log(`[sync] Unmatched size rows:         ${unmatchedCount}`);
}

main()
  .catch((err) => {
    console.error("[sync] ERROR:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
