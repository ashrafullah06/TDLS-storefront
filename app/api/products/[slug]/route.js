// PATH: app/api/products/[slug]/route.js
// Hybrid product resolver:
// - Fetch product by slug from Strapi (CMS content)
// - Enrich variants/sizes with Prisma stock + codes (SKU, barcode, etc.)
//   • STOCK: Prisma is the source of truth
//   • CODES: prefer Prisma, fall back to Strapi
// Frontend still sees the same Strapi shape, just with better data.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import prisma from "@/lib/prisma";

// ───────────────────────── Strapi config ─────────────────────────

const STRAPI_URL =
  [
    process.env.STRAPI_API_URL,
    process.env.STRAPI_URL,
    process.env.NEXT_PUBLIC_STRAPI_API_URL,
  ]
    .find((v) => typeof v === "string" && v.trim().length > 0)
    ?.replace(/\/+$/, "") || "";

const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
  "";

const BASE_HEADERS = {
  Accept: "application/json",
  ...(STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {}),
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

// ───────────────────────── helpers ─────────────────────────

/**
 * Given a Strapi-style product node, look up the matching Prisma product
 * (by strapiId or slug) and inject Prisma stock + codes into each
 * variant.size row.
 *
 * This function is tolerant to two shapes:
 *   - Strapi v4:   { id, attributes: { slug, variants: [...] } }
 *   - Flattened:   { id, slug, variants: [...] }
 */
async function enrichProductWithPrisma(strapiNode) {
  if (!strapiNode) return strapiNode;

  // Handle both { attributes: {...} } and flat shapes
  const attrs = strapiNode.attributes || strapiNode;
  const strapiId = Number(strapiNode.id ?? attrs.strapiId ?? 0) || null;
  const slug = attrs.slug || null;

  // Find corresponding Prisma product
  const prismaProduct = await prisma.product.findFirst({
    where: strapiId
      ? { strapiId }
      : slug
      ? { slug }
      : undefined,
    include: {
      variants: true, // ProductVariant rows with strapiSizeId, sku, barcode, stockAvailable, etc.
    },
  });

  if (!prismaProduct) {
    // Nothing to enrich; just return original node
    return strapiNode;
  }

  // Index Prisma variants by strapiSizeId for fast lookups
  const variantsBySizeId = new Map();
  for (const pv of prismaProduct.variants) {
    if (pv.strapiSizeId != null) {
      variantsBySizeId.set(Number(pv.strapiSizeId), pv);
    }
  }

  const variants = attrs.variants || [];
  for (const variant of variants) {
    const sizes = variant.sizes || [];
    for (const size of sizes) {
      const rawSizeId =
        size.id ??
        size.size_id ??
        size.strapiSizeId ??
        null;

      const sizeId = rawSizeId != null ? Number(rawSizeId) : null;
      if (!sizeId || !variantsBySizeId.has(sizeId)) continue;

      const pv = variantsBySizeId.get(sizeId);

      // ───── STOCK: Prisma is the authority ─────
      size.stock_quantity = pv.stockAvailable; // override Strapi quantity
      size.stock_available_prisma = pv.stockAvailable;
      size.stock_reserved_prisma = pv.stockReserved;
      size.initial_stock_prisma = pv.initialStock;

      // ───── CODES: prefer Prisma, fall back to Strapi ─────
      const skuPrisma = (pv.sku || "").trim();
      const barcodePrisma = (pv.barcode || "").trim();

      if (skuPrisma) {
        size.sku = skuPrisma;
      }
      if (barcodePrisma) {
        size.barcode = barcodePrisma;
      }

      // Optional: attach raw Prisma snapshot for debugging / future UI
      size.prismaVariant = {
        id: pv.id,
        sku: pv.sku,
        barcode: pv.barcode,
        stockAvailable: pv.stockAvailable,
        stockReserved: pv.stockReserved,
        initialStock: pv.initialStock,
        inventoryStatus: pv.inventoryStatus,
        sizeName: pv.sizeName,
        sizeLabel: pv.sizeLabel,
        colorName: pv.colorName,
        colorLabel: pv.colorLabel,
        colorCode: pv.colorCode,
      };
    }
  }

  // Write back updated attrs into the original node shape
  if (strapiNode.attributes) {
    strapiNode.attributes = attrs;
  } else {
    Object.assign(strapiNode, attrs);
  }

  return strapiNode;
}

// ───────────────────────── GET handler ─────────────────────────

export async function GET(req, { params }) {
  try {
    if (!STRAPI_URL) {
      return json(
        {
          error:
            "STRAPI_URL / STRAPI_API_URL is not configured on the server.",
        },
        500,
      );
    }

    const slug = params?.slug;
    if (!slug) {
      return json({ error: "Missing product slug in route params." }, 400);
    }

    const incoming = new URL(req.url);
    const upstream = new URL(`${STRAPI_URL}/api/products`);

    // Forward query params except our own "slug" (if provided as query)
    incoming.searchParams.forEach((value, key) => {
      if (key !== "slug") {
        upstream.searchParams.append(key, value);
      }
    });

    // Enforce slug filter
    upstream.searchParams.set("filters[slug][$eq]", slug);

    // If caller did not specify populate, give a sensible default
    if (!upstream.searchParams.has("populate")) {
      upstream.searchParams.set("populate", "deep");
    }

    const res = await fetch(upstream.toString(), {
      headers: BASE_HEADERS,
      cache: "no-store",
    });

    const text = await res.text();

    // Try to parse JSON so we can enrich; if it fails, just pass it through
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response(text, {
        status: res.status,
        headers: {
          "content-type":
            res.headers.get("content-type") ||
            "application/json; charset=utf-8",
        },
      });
    }

    // If Strapi returned one or more products, enrich each with Prisma
    if (res.ok && parsed && Array.isArray(parsed.data) && parsed.data.length) {
      for (let i = 0; i < parsed.data.length; i++) {
        const node = parsed.data[i];
        await enrichProductWithPrisma(node);
      }

      return json(parsed, res.status, {
        // preserve content-type for compatibility
        "content-type":
          res.headers.get("content-type") ||
          "application/json; charset=utf-8",
      });
    }

    // No enrichment (error or empty) – just return what Strapi gave
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type":
          res.headers.get("content-type") ||
          "application/json; charset=utf-8",
      },
    });
  } catch (err) {
    return json(
      {
        error: "API error while resolving product by slug.",
        detail: String(err?.message || err),
      },
      500,
    );
  }
}
