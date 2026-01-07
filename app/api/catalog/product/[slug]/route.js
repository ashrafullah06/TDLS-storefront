// FILE: app/api/catalog/product/[slug]/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const STRAPI_URL =
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
  process.env.STRAPI_API_URL ||
  "";

// ---- tiny helpers ----
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

async function fetchStrapiProductBySlug(slug) {
  if (!STRAPI_URL) {
    throw new Error("STRAPI_URL env is not configured");
  }

  const url =
    STRAPI_URL.replace(/\/+$/, "") +
    `/api/products?filters[slug][$eq]=${encodeURIComponent(
      slug
    )}&populate[product_variants][populate][0]=sizes&populate=*`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Strapi error: ${res.status}`);
  }
  const json = await res.json();

  const item = Array.isArray(json?.data) ? json.data[0] : null;
  if (!item) return null;

  return item;
}

export async function GET(req, { params }) {
  try {
    const slug = params?.slug;
    if (!slug) return j({ error: "Missing slug" }, 400);

    // 1) Strapi product (with product_variants + sizes)
    const strapiProduct = await fetchStrapiProductBySlug(slug);
    if (!strapiProduct) return j({ error: "Product not found" }, 404);

    const A = strapiProduct.attributes || {};
    const pvRel = A.product_variants || strapiProduct.product_variants;
    const variantNodes = Array.isArray(pvRel?.data) ? pvRel.data : [];

    // 2) Collect ALL Strapi size ids from product_variants[].sizes[]
    const strapiSizeIds = [];
    for (const node of variantNodes) {
      const vAttrs = node?.attributes || {};
      const sizes = Array.isArray(vAttrs?.sizes) ? vAttrs.sizes : [];
      for (const sz of sizes) {
        const id =
          sz?.id ??
          sz?.size_id ??
          sz?.sizeId ??
          sz?.strapi_id ??
          sz?.strapiId ??
          null;
        if (id != null) {
          const num = Number(id);
          if (Number.isFinite(num)) strapiSizeIds.push(num);
        }
      }
    }

    // Nothing to bridge? Return Strapi-only payload.
    if (!strapiSizeIds.length) {
      return j({ ok: true, product: strapiProduct });
    }

    // 3) Prisma ProductVariant rows for those Strapi size rows
    const prismaVariants = await prisma.productVariant.findMany({
      where: {
        strapiSizeId: { in: strapiSizeIds },
      },
      include: {
        inventoryItems: true,
      },
    });

    // Turn them into a lookup table by strapiSizeId
    const byStrapiSizeId = new Map();
    for (const pv of prismaVariants) {
      // derive available from onHand / reserved / safetyStock if needed
      const totalFromInventory =
        pv.inventoryItems?.reduce((acc, item) => {
          const onHand = Number(item.onHand ?? 0);
          const safety = Number(item.safetyStock ?? 0);
          const reserved = Number(item.reserved ?? 0);
          // You can tweak this formula to your policy
          return acc + (onHand - safety - reserved);
        }, 0) ?? 0;

      const stockAvailable =
        pv.stockAvailable != null
          ? pv.stockAvailable
          : totalFromInventory;

      byStrapiSizeId.set(pv.strapiSizeId, {
        prisma_id: pv.id,
        stockAvailable,
        sizeLabel: pv.sizeLabel,
        colorLabel: pv.colorLabel,
        sku: pv.sku,
        barcode: pv.barcode,
      });
    }

    // 4) Merge Prisma info back into Strapi sizes
    const mergedVariants = variantNodes.map((node) => {
      const vAttrs = node?.attributes || {};
      const sizes = Array.isArray(vAttrs?.sizes) ? vAttrs.sizes : [];

      const mergedSizes = sizes.map((sz) => {
        const rawId =
          sz?.id ??
          sz?.size_id ??
          sz?.sizeId ??
          sz?.strapi_id ??
          sz?.strapiId ??
          null;
        const key = rawId != null ? Number(rawId) : null;
        const bridge = key != null ? byStrapiSizeId.get(key) : null;

        if (!bridge) return sz;

        // attach Prisma data in a way QuickView already expects
        return {
          ...sz,
          prisma_id: bridge.prisma_id,
          pid: bridge.prisma_id,
          variant_pid: bridge.prisma_id,
          stockAvailable: bridge.stockAvailable,
          sku: bridge.sku ?? sz.sku,
          barcode: bridge.barcode ?? sz.barcode,
        };
      });

      return {
        ...node,
        attributes: {
          ...vAttrs,
          sizes: mergedSizes,
        },
      };
    });

    // 5) Return product with merged variants
    const productWithPrisma = {
      ...strapiProduct,
      attributes: {
        ...A,
        product_variants: {
          ...(pvRel || {}),
          data: mergedVariants,
        },
      },
    };

    return j({ ok: true, product: productWithPrisma });
  } catch (e) {
    console.error("Catalog product bridge error:", e);
    return j({ error: "Internal error" }, 500);
  }
}
