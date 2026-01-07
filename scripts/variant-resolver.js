// FILE: src/lib/variant-resolver.js

/**
 * Server-side helper to resolve a Prisma ProductVariant.id
 * from a cart item payload.
 *
 * It uses the following resolution strategy:
 *   1. If item.variantId is already a valid ProductVariant.id → use it.
 *   2. Else, if item.strapiSizeId / sizeId maps to ProductVariant.strapiSizeId → use it.
 *   3. Else, fetch Product by productId or slug and match option values
 *      for color/size (case-insensitive).
 *   4. Else, if the product has exactly one variant, use it.
 */

import prisma from "@/lib/prisma";

function norm(v) {
  return (v ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Resolve a ProductVariant.id for a given cart item-like object.
 *
 * @param {object} item - Cart line payload (productId, variantId, slug, selectedColor, selectedSize, etc.)
 * @returns {Promise<string|null>} - Prisma ProductVariant.id or null if not found.
 */
export async function resolveVariantIdForCartItem(item) {
  if (!item || typeof item !== "object") return null;

  const hinted = item.variantId ?? item.variant_id ?? item.id ?? null;
  const hintedStr = hinted != null ? String(hinted) : null;

  // --- Fast path 1: treat variantId as the real ProductVariant.id if it exists ---
  if (hintedStr) {
    try {
      const found = await prisma.productVariant.findUnique({
        where: { id: hintedStr },
        select: { id: true },
      });
      if (found?.id) {
        return found.id;
      }
    } catch {
      // ignore and fall through
    }
  }

  // --- Fast path 2: Strapi size-row id → ProductVariant.strapiSizeId ---
  const strapiSizeIdRaw =
    item.strapiSizeId ??
    item.strapi_size_id ??
    item.sizeId ??
    item.size_id ??
    null;

  if (strapiSizeIdRaw != null) {
    const sid = Number(strapiSizeIdRaw);
    if (Number.isFinite(sid)) {
      try {
        const foundByStrapiSize = await prisma.productVariant.findUnique({
          where: { strapiSizeId: sid },
          select: { id: true },
        });
        if (foundByStrapiSize?.id) {
          return foundByStrapiSize.id;
        }
      } catch {
        // ignore and fall through
      }
    }
  }

  // --- Fallback: resolve via Product + option values (Color / Size) ---
  const productKey = item.productId ?? item.slug ?? item.name ?? null;
  if (!productKey) return null;

  const wantColor = norm(item.selectedColor ?? item.color ?? item.colour);
  const wantSize = norm(item.selectedSize ?? item.size);

  let product = null;

  if (item.productId) {
    try {
      product = await prisma.product.findUnique({
        where: { id: String(item.productId) },
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
    } catch {
      product = null;
    }
  }

  if (!product && item.slug) {
    try {
      product = await prisma.product.findUnique({
        where: { slug: String(item.slug) },
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
    } catch {
      product = null;
    }
  }

  if (!product) return null;

  const variants = Array.isArray(product.variants) ? product.variants : [];

  // If no specific color/size requested, fall back to default variant
  if (!wantColor && !wantSize) {
    const def = variants.find((v) => v.isDefault) || variants[0];
    return def ? def.id : null;
  }

  const matches = variants.filter((v) => {
    const pairs = (v.optionValues || []).map((ov) => ({
      option: norm(ov.optionValue?.option?.name),
      value: norm(ov.optionValue?.value),
    }));

    const values = pairs.map((p) => p.value);

    const hasColorByName =
      !wantColor ||
      pairs.some(
        (p) =>
          (p.option.includes("color") ||
            p.option.includes("colour")) &&
          p.value === wantColor
      );

    const hasSizeByName =
      !wantSize ||
      pairs.some(
        (p) =>
          p.option.includes("size") && p.value === wantSize
      );

    const hasColorLoose =
      !wantColor || values.includes(wantColor);
    const hasSizeLoose =
      !wantSize || values.includes(wantSize);

    const colorOk = wantColor ? hasColorByName || hasColorLoose : true;
    const sizeOk = wantSize ? hasSizeByName || hasSizeLoose : true;

    return colorOk && sizeOk;
  });

  if (matches.length > 0) {
    return matches[0].id;
  }

  if (variants.length === 1) {
    return variants[0].id;
  }

  return null;
}

export default resolveVariantIdForCartItem;
