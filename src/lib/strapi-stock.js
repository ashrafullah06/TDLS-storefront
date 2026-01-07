// ✅ PATH: src/lib/strapi-stock.js
// Sync ProductVariant.stockAvailable → Strapi size-stock row using strapiSizeId.

import prisma from "@/lib/prisma";
import { STRAPI_URL } from "@/lib/strapi";

// e.g. "/api/size-stocks" or "/api/product-size-rows"
const SIZE_STOCK_PATH =
  process.env.STRAPI_SIZE_STOCK_PATH || "/api/size-stocks";

// Prefer an internal token if you have one; fall back to standard API token.
const STRAPI_STOCK_TOKEN =
  process.env.STRAPI_INTERNAL_TOKEN ||
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_TOKEN ||
  "";

/**
 * Build the final URL for a size-stock row.
 */
function buildSizeStockUrl(strapiSizeId) {
  if (!STRAPI_URL) return null;
  if (!strapiSizeId) return null;

  const base = STRAPI_URL.replace(/\/+$/, "");

  let path = (SIZE_STOCK_PATH || "").trim() || "/api/size-stocks";
  // ensure leading slash
  if (!path.startsWith("/")) path = `/${path}`;
  // strip trailing slash
  path = path.replace(/\/+$/, "");

  return `${base}${path}/${strapiSizeId}`;
}

/**
 * Low-level helper: push a single numeric stock to a specific Strapi size row.
 * Adjust payload shape if your CT field is different from `stock_quantity`.
 */
async function pushStockToStrapiSizeRow(strapiSizeId, stock) {
  const url = buildSizeStockUrl(strapiSizeId);
  if (!url) return;

  const safeStock =
    typeof stock === "number" && Number.isFinite(stock) ? stock : 0;

  try {
    const res = await fetch(url, {
      method: "PUT", // or "PATCH" if your Strapi route expects that
      headers: {
        "Content-Type": "application/json",
        ...(STRAPI_STOCK_TOKEN
          ? { Authorization: `Bearer ${STRAPI_STOCK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        data: {
          // ❗ change this field name if your Strapi CT uses something else
          stock_quantity: safeStock,
        },
      }),
      cache: "no-store",
    });

    if (!res.ok && process.env.NODE_ENV !== "production") {
      const txt = await res.text().catch(() => "");
      console.warn(
        "[strapi-stock] Non-OK response from Strapi:",
        res.status,
        txt || res.statusText
      );
    }
  } catch (err) {
    console.warn(
      "[strapi-stock] Failed to push size-stock to Strapi",
      String(err)
    );
  }
}

/**
 * Sync a variant that is already loaded with `strapiSizeId` and `stockAvailable`.
 */
export async function syncVariantStockToStrapiFromLoaded(variant) {
  if (!variant) return;
  if (!variant.strapiSizeId) return;

  const stock =
    typeof variant.stockAvailable === "number" ? variant.stockAvailable : 0;

  await pushStockToStrapiSizeRow(variant.strapiSizeId, stock);
}

/**
 * Sync by variant ID:
 *  1) Load ProductVariant (strapiSizeId + stockAvailable)
 *  2) Push to Strapi size-stock row
 */
export async function syncVariantStockToStrapiById(variantId) {
  if (!variantId) return;

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      strapiSizeId: true,
      stockAvailable: true,
    },
  });

  if (!variant) return;

  await syncVariantStockToStrapiFromLoaded(variant);
}
