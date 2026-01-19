// FILE: app/product/[slug]/page.js
import prisma from "@/lib/prisma";
import { fetchproductbyslug } from "@/lib/fetchproductbyslug";
import { trackProductView } from "@/lib/trackview";
import ClientUX from "@/components/product/clientux";

/**
 * IMPORTANT (Mobile correctness):
 * - Ensure the browser uses device-width viewport and safe-area insets (iOS notch).
 * - This does NOT change desktop layout; it only prevents mobile scaling quirks.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

/* ---------------- SEO/social constants (no UI/UX impact) ---------------- */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

const BRAND = "TDLS";
const FALLBACK_DESC =
  "TDLS is a premium multi-product ecommerce brand. Shop curated essentials across multiple categories.";

/* ========= SHAPE NORMALISER ========= */
/**
 * Normalises Strapi product shapes into:
 *   { id, ...flatFields, attributes: { ...flatFields } }
 */
function normalizeProduct(raw) {
  if (!raw) return null;

  // Case 1: Strapi response { data: [...] }
  const node = Array.isArray(raw?.data) ? raw.data[0] : raw;
  if (!node) return null;

  // Case 2: { id, attributes: { ... } }
  if (node.attributes && typeof node.attributes === "object") {
    const attrs = node.attributes;
    return {
      id: node.id ?? attrs.id ?? null,
      ...attrs,
      attributes: attrs,
    };
  }

  // Case 3: already flat, no attributes but we still add .attributes for ClientUX
  const attrs = node.attributes || node;
  return {
    id: node.id ?? attrs.id ?? null,
    ...attrs,
    attributes: attrs,
  };
}

/* ========= HELPERS ========= */

function extractText(val) {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(extractText).join(" ");
  if (typeof val === "object" && val.type && val.children)
    return extractText(val.children);
  if (typeof val === "object" && val.text) return val.text;
  return "";
}

function toAbsoluteUrl(u) {
  if (!u) return u;
  const s = String(u);
  if (/^https?:\/\//i.test(s)) return s;
  return `${SITE_URL.replace(/\/+$/, "")}${s.startsWith("/") ? "" : "/"}${s}`;
}

function firstMediaUrl(field) {
  if (!field) return null;

  if (Array.isArray(field)) {
    for (const item of field) {
      const url =
        item?.url ||
        item?.attributes?.url ||
        (item?.data && item.data.url) ||
        null;
      if (url) return url;
    }
    return null;
  }

  if (Array.isArray(field.data)) {
    for (const item of field.data) {
      const url =
        item?.url ||
        item?.attributes?.url ||
        (item?.data && item.data.url) ||
        null;
      if (url) return url;
    }
    return null;
  }

  return field.url || field?.attributes?.url || null;
}

function pickOgImage(product) {
  if (!product) return "/img/product-placeholder.png";

  if (product.cover_image) return product.cover_image;

  if (typeof product.image === "string") return product.image;
  if (product.image?.url) return product.image.url;

  const fromImages = firstMediaUrl(product.images);
  if (fromImages) return fromImages;

  const fromGallery = firstMediaUrl(product.gallery);
  if (fromGallery) return fromGallery;

  return "/img/product-placeholder.png";
}

// Build a product-scoped options map from variants (e.g., color/size/material)
function buildScopedOptions(product) {
  const map = {};

  const raw =
    product?.product_variants || product?.attributes?.product_variants;
  const variants = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
    ? raw.data.map((v) => v.attributes || v)
    : [];

  for (const v of variants) {
    const attrs = v.attributes || v.options || v;
    if (!attrs || typeof attrs !== "object") continue;

    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || typeof value === "object") continue;
      const k = String(key).toLowerCase();

      if (!["color", "size", "fit", "material", "style", "length"].includes(k))
        continue;

      if (!map[k]) map[k] = new Set();
      map[k].add(String(value));
    }
  }

  const out = {};
  for (const [k, set] of Object.entries(map)) {
    out[k] = Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }
  return out;
}

async function fetchReviews(productId) {
  try {
    const API_BASE =
      process.env.NEXT_PUBLIC_STRAPI_API_URL || "http://localhost:1337";
    const res = await fetch(`${API_BASE}/api/reviews?product=${productId}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    let arr = json?.data || json;
    if (!Array.isArray(arr)) arr = [];
    return arr;
  } catch {
    return [];
  }
}

/**
 * Soft visibility guard
 */
function isSoftDisabled(product) {
  if (!product) return true;
  if (product.disable_frontend === true) return true;
  if (product.is_archived === true) return true;
  return false;
}

/* ========= PRISMA STOCK SNAPSHOT (DB IS SOURCE OF TRUTH) ========= */

function toInt(val) {
  if (val == null) return null;
  const n = typeof val === "string" ? parseInt(val, 10) : Number(val);
  return Number.isInteger(n) ? n : null;
}

/**
 * Compute available stock for a variant.
 *
 * IMPORTANT:
 * - We treat variant.stockAvailable as a **floor / override**.
 *   If stockAvailable <= 0, we force available = 0 even if InventoryItem says 5.
 *   This matches what you see in Prisma when you look at that column.
 * - Otherwise, we use InventoryItem sum: Σ(onHand - safetyStock - reserved).
 * - If there are no inventoryItems, we fall back to stockAvailable (if any).
 */
function computeAvailableForVariant(variant) {
  const items = Array.isArray(variant.inventoryItems)
    ? variant.inventoryItems
    : [];

  const stockAvailableRaw = Number(variant.stockAvailable ?? 0);
  const stockAvailable = Number.isFinite(stockAvailableRaw)
    ? stockAvailableRaw
    : 0;

  // 🔒 Hard floor: if stockAvailable is 0 or negative, this variant is OUT OF STOCK.
  if (stockAvailable <= 0) {
    return 0;
  }

  // If we have inventoryItems, respect them – but never go below 0.
  if (items.length > 0) {
    const total = items.reduce((sum, inv) => {
      const onHand = Number(inv.onHand ?? 0);
      const safety = Number(inv.safetyStock ?? 0);
      const reserved = Number(inv.reserved ?? 0);
      return sum + (onHand - safety - reserved);
    }, 0);

    // Clamp at 0 – and also don't exceed stockAvailable (safety belt).
    return Math.max(0, Math.min(total, stockAvailable));
  }

  // No inventory rows → fall back to stockAvailable.
  return Math.max(0, stockAvailable);
}

/**
 * Uses Prisma (Product + variants + InventoryItem) to compute live stock:
 *  - Locate Product via strapiId / slug / strapiSlug
 *  - For each variant: computeAvailableForVariant(...)
 *
 * Returns:
 *   {
 *     stockQty: number,                           // total available across variants
 *     stockByVariantKey: { [key: string]: number } // key = strapiSizeId || variant.id
 *   }
 */
async function loadStockFromPrisma({ product, slug }) {
  try {
    const or = [];

    const strapiId = toInt(
      product.id ??
        product.strapiId ??
        product.attributes?.strapiId ??
        product.attributes?.id
    );
    if (strapiId != null) {
      or.push({ strapiId });
    }

    if (slug) {
      or.push({ slug });
      or.push({ strapiSlug: slug });
    }

    if (product.slug && typeof product.slug === "string") {
      or.push({ slug: product.slug });
      or.push({ strapiSlug: product.slug });
    }

    if (
      product.attributes?.slug &&
      typeof product.attributes.slug === "string"
    ) {
      or.push({ slug: product.attributes.slug });
      or.push({ strapiSlug: product.attributes.slug });
    }

    if (!or.length) {
      return { stockQty: null, stockByVariantKey: {} };
    }

    const dbProduct = await prisma.product.findFirst({
      where: { OR: or },
      include: {
        variants: {
          include: {
            inventoryItems: true,
          },
        },
      },
    });

    if (!dbProduct) {
      return { stockQty: null, stockByVariantKey: {} };
    }

    let total = 0;
    const stockByVariantKey = {};

    for (const variant of dbProduct.variants) {
      const available = computeAvailableForVariant(variant);

      const key =
        variant.strapiSizeId != null ? String(variant.strapiSizeId) : variant.id;

      stockByVariantKey[key] = available;
      total += available;
    }

    return { stockQty: total, stockByVariantKey };
  } catch (err) {
    console.error("[loadStockFromPrisma] failed:", err);
    return { stockQty: null, stockByVariantKey: {} };
  }
}

/**
 * Strapi-side stock fallback if DB has no info.
 */
function fallbackStockFromStrapi(product) {
  if (typeof product.stock_quantity === "number") {
    return product.stock_quantity;
  }
  if (typeof product.inventory === "number") {
    return product.inventory;
  }
  return 0;
}

/* ========= JSON-LD SAFE STRINGIFY ========= */
/**
 * Prevents "<" sequences from breaking out of the script tag.
 * Keeps the exact same schema content you already emit.
 */
function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

/* ========= DYNAMIC SEO METADATA ========= */

export async function generateMetadata(ctx) {
  const { params } = ctx;
  const { slug } = (await params) || {};

  const raw = await fetchproductbyslug(slug);
  const product = normalizeProduct(raw);

  if (!product || isSoftDisabled(product)) {
    return {
      title: `Product Not Found | ${BRAND}`,
      description: "Sorry, this product does not exist or is unavailable.",
      robots: { index: false, follow: false },
    };
  }

  const name =
    extractText(product.name) ||
    extractText(product.attributes?.name) ||
    "Product";

  const descRaw =
    extractText(product.short_description) ||
    extractText(product.attributes?.short_description) ||
    (typeof product.description === "string"
      ? product.description.substring(0, 160)
      : FALLBACK_DESC);

  const desc = String(descRaw || FALLBACK_DESC).slice(0, 180);

  const ogImage = toAbsoluteUrl(pickOgImage(product));
  const canonical = `${SITE_URL.replace(/\/+$/, "")}/product/${encodeURIComponent(
    slug || product.slug || ""
  )}`;

  return {
    title: `${name} | ${BRAND}`,
    description: desc,
    alternates: { canonical },
    openGraph: {
      title: `${name} | ${BRAND}`,
      description: desc,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: name,
        },
      ],
      type: "website",
      siteName: BRAND,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} | ${BRAND}`,
      description: desc,
      images: [ogImage],
    },
  };
}

/* ========= MAIN PAGE COMPONENT ========= */

export default async function ProductPage(ctx) {
  const { params } = ctx;
  const { slug } = (await params) || {};

  const raw = await fetchproductbyslug(slug);
  const product = normalizeProduct(raw);

  if (!product) {
    return (
      <main className="max-w-4xl mx-auto w-full pt-16 pb-24 px-4 overflow-x-hidden">
        <h1 className="text-2xl font-semibold mb-2">Product not found</h1>
        <p className="text-slate-600 text-sm">
          We couldn&apos;t find a product with slug: <code>{slug}</code>.
        </p>
      </main>
    );
  }

  if (isSoftDisabled(product)) {
    return (
      <main className="max-w-4xl mx-auto w-full pt-16 pb-24 px-4 overflow-x-hidden">
        <h1 className="text-2xl font-semibold mb-2">This product is unavailable</h1>
        <p className="text-slate-600 text-sm">
          This item is currently not available for purchase.
        </p>
      </main>
    );
  }

  try {
    await trackProductView(product);
  } catch (e) {
    console.error("[trackProductView] failed:", e);
  }

  const reviews = await fetchReviews(product.id);
  const aggregateRating = reviews.length
    ? {
        "@type": "AggregateRating",
        ratingValue: (
          reviews.reduce((sum, r) => sum + (r.rating || 5), 0) / reviews.length
        ).toFixed(1),
        reviewCount: reviews.length,
      }
    : undefined;

  const desc =
    extractText(product.short_description) ||
    extractText(product.attributes?.short_description) ||
    (typeof product.description === "string"
      ? product.description.substring(0, 140)
      : FALLBACK_DESC);

  const ogImage = toAbsoluteUrl(pickOgImage(product));

  const price =
    typeof product.price === "number"
      ? product.price
      : typeof product.discount_price === "number"
      ? product.discount_price
      : typeof product.base_price === "number"
      ? product.base_price
      : typeof product.price_mrp === "number"
      ? product.price_mrp
      : 0;

  const priceCurrency = product.currency || product.attributes?.currency || "BDT";

  // 🔹 STOCK: DB (Prisma) is canonical, Strapi is only fallback
  const prismaStock = await loadStockFromPrisma({ product, slug });
  const stockQty =
    typeof prismaStock.stockQty === "number" && Number.isFinite(prismaStock.stockQty)
      ? prismaStock.stockQty
      : fallbackStockFromStrapi(product);

  const sku = product.sku || product.product_code || product.base_sku || undefined;

  const scopedOptions = buildScopedOptions(product);

  const isInStock = stockQty > 0;

  const productUrlAbs = `${SITE_URL.replace(/\/+$/, "")}/product/${encodeURIComponent(
    product.slug || slug || ""
  )}`;

  // Keep the exact same schema payload structure; only brand/site naming + absolute url hardened.
  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: extractText(product.name),
    image: [ogImage],
    description: desc,
    sku: sku,
    brand: {
      "@type": "Brand",
      name: BRAND,
    },
    offers: {
      "@type": "Offer",
      price: price,
      priceCurrency: priceCurrency,
      availability: isInStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      url: productUrlAbs,
    },
    ...(aggregateRating && { aggregateRating }),
    ...(reviews.length && {
      review: reviews.map((r) => ({
        "@type": "Review",
        reviewRating: {
          "@type": "Rating",
          ratingValue: r.rating || 5,
        },
        author: {
          "@type": "Person",
          name: r.user?.name || "Customer",
        },
        reviewBody: r.text || r.body || "",
        datePublished: r.createdAt || "",
      })),
    }),
  };

  return (
    <main
      className={[
        // Desktop kept intact (your existing max width & breakpoints remain).
        "max-w-6xl mx-auto w-full pt-12 pb-20 px-2 sm:px-6 lg:px-8",

        // Mobile hardening: never allow horizontal overflow on small screens.
        "overflow-x-hidden",

        /**
         * Mobile typography + control sizing:
         * - On mobile we slightly reduce inherited font size so CTAs/text inside ClientUX
         *   don’t render “too large” by default.
         * - Desktop remains unchanged at sm+.
         */
        "text-[13px] leading-[1.2] sm:text-[16px] sm:leading-normal",
      ].join(" ")}
      style={{
        // iOS safe-area support (notch/home-indicator) without affecting desktop.
        paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
        paddingRight: "max(0.5rem, env(safe-area-inset-right))",
        paddingBottom: "max(5rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* JSON-LD (same content), but avoids importing next/script (prevents Turbopack HMR crash path) */}
      <script
        id="product-schema"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productSchema) }}
      />

      <ClientUX
        product={product}
        stockQty={stockQty}
        options={scopedOptions}
        // Per-variant available stock keyed by strapiSizeId (if present) or variant.id
        stockByVariantKey={prismaStock.stockByVariantKey}
        // OPTIONAL: if ClientUX supports this, you can pass it too:
        isOutOfStock={!isInStock}
      />
    </main>
  );
}
