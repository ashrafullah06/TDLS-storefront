// FILE: app/product/[slug]/page.js

import { Suspense } from "react";
import { connection } from "next/server";

import prisma from "@/lib/prisma";
import { fetchproductbyslug } from "@/lib/fetchproductbyslug";

import ClientUX from "@/components/product/clientux";
import ProductViewTracker from "@/components/product/product-view-tracker";

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

/* ---------------- SEO/social constants ---------------- */

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

const BRAND = "TDLS";

const FALLBACK_DESC =
  "TDLS is where refined design meets effortless confidence. Timeless in character, effortless in comfort—created to be felt, lived in, and remembered.";

const REVIEW_FETCH_TIMEOUT_MS = 1500;
const STOCK_WAIT_TIMEOUT_MS = 4000;

/* ========= SHAPE NORMALISER ========= */

function normalizeProduct(raw) {
  if (!raw) {
    return null;
  }

  const node = Array.isArray(raw?.data) ? raw.data[0] : raw;

  if (!node) {
    return null;
  }

  if (node.attributes && typeof node.attributes === "object") {
    const attrs = node.attributes;

    return {
      id: node.id ?? attrs.id ?? null,
      ...attrs,
      attributes: attrs,
    };
  }

  const attrs = node.attributes || node;

  return {
    id: node.id ?? attrs.id ?? null,
    ...attrs,
    attributes: attrs,
  };
}

/* ========= HELPERS ========= */

function extractText(val) {
  if (!val) {
    return "";
  }

  if (typeof val === "string") {
    return val;
  }

  if (Array.isArray(val)) {
    return val.map(extractText).join(" ");
  }

  if (typeof val === "object" && val.type && val.children) {
    return extractText(val.children);
  }

  if (typeof val === "object" && val.text) {
    return val.text;
  }

  return "";
}

function toAbsoluteUrl(u) {
  if (!u) {
    return u;
  }

  const s = String(u);

  if (/^https?:\/\//i.test(s)) {
    return s;
  }

  return `${SITE_URL.replace(/\/+$/, "")}${s.startsWith("/") ? "" : "/"}${s}`;
}

function firstMediaUrl(field) {
  if (!field) {
    return null;
  }

  if (Array.isArray(field)) {
    for (const item of field) {
      const url =
        item?.url ||
        item?.attributes?.url ||
        (item?.data && item.data.url) ||
        null;

      if (url) {
        return url;
      }
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

      if (url) {
        return url;
      }
    }

    return null;
  }

  return field.url || field?.attributes?.url || null;
}

function pickOgImage(product) {
  if (!product) {
    return "/tdls-social-preview";
  }

  if (product.cover_image) {
    return product.cover_image;
  }

  if (typeof product.image === "string") {
    return product.image;
  }

  if (product.image?.url) {
    return product.image.url;
  }

  const fromImages = firstMediaUrl(product.images);

  if (fromImages) {
    return fromImages;
  }

  const fromGallery = firstMediaUrl(product.gallery);

  if (fromGallery) {
    return fromGallery;
  }

  return "/tdls-social-preview";
}

/* ========= PRODUCT OPTIONS ========= */

function buildScopedOptions(product) {
  const map = {};

  const raw =
    product?.product_variants ||
    product?.attributes?.product_variants;

  const variants = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data.map((v) => v.attributes || v)
      : [];

  for (const v of variants) {
    const attrs = v.attributes || v.options || v;

    if (!attrs || typeof attrs !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || typeof value === "object") {
        continue;
      }

      const k = String(key).toLowerCase();

      if (
        !["color", "size", "fit", "material", "style", "length"].includes(k)
      ) {
        continue;
      }

      if (!map[k]) {
        map[k] = new Set();
      }

      map[k].add(String(value));
    }
  }

  const out = {};

  for (const [k, set] of Object.entries(map)) {
    out[k] = Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true,
      })
    );
  }

  return out;
}

/* ========= REVIEWS ========= */

function getStrapiBase() {
  /*
   * Keep the same Strapi origin priority used by the corrected
   * product-detail fetcher and /api/strapi proxy.
   */
  const raw =
    process.env.STRAPI_API_ORIGIN ||
    process.env.STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_API_ORIGIN ||
    process.env.STRAPI_API_URL ||
    "http://localhost:1337";

  return String(raw || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
}

async function fetchReviews(productId) {
  if (productId == null) {
    return [];
  }

  const controller = new AbortController();

  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {}
  }, REVIEW_FETCH_TIMEOUT_MS);

  try {
    const API_BASE = getStrapiBase();

    const res = await fetch(
      `${API_BASE}/api/reviews?product=${encodeURIComponent(String(productId))}`,
      {
        method: "GET",

        headers: {
          Accept: "application/json",
        },

        /*
         * Keep reviews dynamic, as they were before.
         * The important correction is the hard timeout.
         */
        cache: "no-store",

        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return [];
    }

    const json = await res.json().catch(() => ({}));

    let arr = json?.data || json;

    if (!Array.isArray(arr)) {
      arr = [];
    }

    return arr;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/* ========= VISIBILITY ========= */

function isSoftDisabled(product) {
  if (!product) {
    return true;
  }

  if (product.disable_frontend === true) {
    return true;
  }

  if (product.is_archived === true) {
    return true;
  }

  return false;
}

/* ========= PRISMA STOCK ========= */

function toInt(val) {
  if (val == null) {
    return null;
  }

  const n =
    typeof val === "string" ? parseInt(val, 10) : Number(val);

  return Number.isInteger(n) ? n : null;
}

function computeAvailableForVariant(variant) {
  const items = Array.isArray(variant.inventoryItems)
    ? variant.inventoryItems
    : [];

  const stockAvailableRaw = Number(variant.stockAvailable ?? 0);

  const stockAvailable = Number.isFinite(stockAvailableRaw)
    ? stockAvailableRaw
    : 0;

  if (stockAvailable <= 0) {
    return 0;
  }

  if (items.length > 0) {
    const total = items.reduce((sum, inv) => {
      const onHand = Number(inv.onHand ?? 0);
      const safety = Number(inv.safetyStock ?? 0);
      const reserved = Number(inv.reserved ?? 0);

      return sum + (onHand - safety - reserved);
    }, 0);

    return Math.max(0, Math.min(total, stockAvailable));
  }

  return Math.max(0, stockAvailable);
}

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
      or.push({
        strapiId,
      });
    }

    if (slug) {
      or.push({
        slug,
      });

      or.push({
        strapiSlug: slug,
      });
    }

    if (product.slug && typeof product.slug === "string") {
      or.push({
        slug: product.slug,
      });

      or.push({
        strapiSlug: product.slug,
      });
    }

    if (
      product.attributes?.slug &&
      typeof product.attributes.slug === "string"
    ) {
      or.push({
        slug: product.attributes.slug,
      });

      or.push({
        strapiSlug: product.attributes.slug,
      });
    }

    if (!or.length) {
      return {
        stockQty: null,
        stockByVariantKey: {},
      };
    }

    const dbProduct = await prisma.product.findFirst({
      where: {
        OR: or,
      },

      include: {
        variants: {
          include: {
            inventoryItems: true,
          },
        },
      },
    });

    if (!dbProduct) {
      return {
        stockQty: null,
        stockByVariantKey: {},
      };
    }

    let total = 0;

    const stockByVariantKey = {};

    for (const variant of dbProduct.variants) {
      const available = computeAvailableForVariant(variant);

      const key =
        variant.strapiSizeId != null
          ? String(variant.strapiSizeId)
          : variant.id;

      stockByVariantKey[key] = available;

      total += available;
    }

    return {
      stockQty: total,
      stockByVariantKey,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[loadStockFromPrisma] failed:", err);
    }

    return {
      stockQty: null,
      stockByVariantKey: {},
    };
  }
}

/**
 * Do not let a cold/unavailable Neon/Prisma connection keep the whole product
 * route in loading state indefinitely.
 */
async function loadStockWithTimeout({ product, slug }) {
  let timer = null;

  const fallback = {
    stockQty: null,
    stockByVariantKey: {},
  };

  try {
    return await Promise.race([
      loadStockFromPrisma({
        product,
        slug,
      }),

      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve(fallback),
          STOCK_WAIT_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function fallbackStockFromStrapi(product) {
  if (typeof product.stock_quantity === "number") {
    return product.stock_quantity;
  }

  if (typeof product.inventory === "number") {
    return product.inventory;
  }

  return 0;
}

/* ========= JSON-LD ========= */

function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

/* ========= DYNAMIC SEO METADATA ========= */

export async function generateMetadata(ctx) {
  const { params } = ctx;

  const { slug } = (await params) || {};

  /*
   * fetchproductbyslug is cached per server render/request, so this lookup
   * and the ProductPage lookup below do not need to create duplicate
   * product-detail work.
   */
  const raw = await fetchproductbyslug(slug);

  const product = normalizeProduct(raw);

  if (!product || isSoftDisabled(product)) {
    return {
      title: {
        absolute: `Product Not Found | ${BRAND}`,
      },

      description:
        "Sorry, this product does not exist or is unavailable.",

      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const name =
    extractText(product.name) ||
    extractText(product.attributes?.name) ||
    "Product";

  const descRaw =
    extractText(product.short_description) ||
    extractText(product.attributes?.short_description) ||
    extractText(product.description) ||
    extractText(product.attributes?.description) ||
    FALLBACK_DESC;

  const desc = String(descRaw || FALLBACK_DESC)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  const ogImage = toAbsoluteUrl(pickOgImage(product));

  const canonical =
    `${SITE_URL.replace(/\/+$/, "")}/product/${encodeURIComponent(
      slug || product.slug || ""
    )}`;

  return {
    title: {
      absolute: `${name} | ${BRAND}`,
    },

    description: desc,

    alternates: {
      canonical,
    },

    openGraph: {
      title: `${name} | ${BRAND}`,
      description: desc,

      images: [
        {
          url: ogImage,
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

/* ========= MAIN PAGE ========= */

export default async function ProductPage(ctx) {
  await connection();

  const { params } = ctx;

  const { slug } = (await params) || {};

  /*
   * Critical request:
   * product data and the bounded live stock lookup precede the product UI.
   *
   * fetchproductbyslug now has:
   * - pageSize=1
   * - schema-aware first-level populate
   * - hard per-attempt timeout
   * - bounded retry
   * - server-request deduplication
   */
  const raw = await fetchproductbyslug(slug);

  const product = normalizeProduct(raw);

  if (!product) {
    return (
      <main className="max-w-4xl mx-auto w-full pt-16 pb-24 px-4 overflow-x-hidden">
        <h1 className="text-2xl font-semibold mb-2">
          Product not found
        </h1>

        <p className="text-slate-600 text-sm">
          We couldn&apos;t find a product with slug:{" "}
          <code>{slug}</code>.
        </p>
      </main>
    );
  }

  if (isSoftDisabled(product)) {
    return (
      <main className="max-w-4xl mx-auto w-full pt-16 pb-24 px-4 overflow-x-hidden">
        <h1 className="text-2xl font-semibold mb-2">
          This product is unavailable
        </h1>

        <p className="text-slate-600 text-sm">
          This item is currently not available for purchase.
        </p>
      </main>
    );
  }

  // Start both requests together. Only stock is required by ClientUX.
  const reviewsPromise = fetchReviews(product.id);

  const prismaStock = await loadStockWithTimeout({
    product,
    slug,
  });

  const stockQty =
    typeof prismaStock.stockQty === "number" &&
    Number.isFinite(prismaStock.stockQty)
      ? prismaStock.stockQty
      : fallbackStockFromStrapi(product);

  const scopedOptions = buildScopedOptions(product);

  const isInStock = stockQty > 0;

  return (
    <main
      className={[
        "max-w-6xl mx-auto w-full pt-12 pb-20 px-2 sm:px-6 lg:px-8",
        "overflow-x-hidden",
        "text-[13px] leading-[1.2] sm:text-[16px] sm:leading-normal",
      ].join(" ")}
      style={{
        paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
        paddingRight: "max(0.5rem, env(safe-area-inset-right))",
        paddingBottom: "max(5rem, env(safe-area-inset-bottom))",
      }}
    >
      <Suspense fallback={null}>
        <ProductSchema
          product={product}
          slug={slug}
          isInStock={isInStock}
          reviewsPromise={reviewsPromise}
        />
      </Suspense>

      {/*
       * Analytics now happens AFTER the product renders.
       * Analytics downtime can no longer block this page.
       */}
      <ProductViewTracker
        productId={product.id ?? null}
        slug={product.slug || slug || ""}
      />

      <ClientUX
        product={product}
        stockQty={stockQty}
        options={scopedOptions}
        stockByVariantKey={prismaStock.stockByVariantKey || {}}
        isOutOfStock={!isInStock}
      />
    </main>
  );
}

// Review-dependent structured data streams without delaying the product UI.
async function ProductSchema({
  product,
  slug,
  isInStock,
  reviewsPromise,
}) {
  const reviews = await reviewsPromise;

  const aggregateRating = reviews.length
    ? {
        "@type": "AggregateRating",

        ratingValue: (
          reviews.reduce((sum, r) => sum + (r.rating || 5), 0) /
          reviews.length
        ).toFixed(1),

        reviewCount: reviews.length,
      }
    : undefined;

  const desc =
    extractText(product.short_description) ||
    extractText(product.attributes?.short_description) ||
    extractText(product.description) ||
    extractText(product.attributes?.description) ||
    FALLBACK_DESC;

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

  const priceCurrency =
    product.currency ||
    product.attributes?.currency ||
    "BDT";

  const sku =
    product.sku ||
    product.product_code ||
    product.base_sku ||
    undefined;

  const productUrlAbs =
    `${SITE_URL.replace(/\/+$/, "")}/product/${encodeURIComponent(
      product.slug || slug || ""
    )}`;

  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",

    name: extractText(product.name),
    image: [ogImage],
    description: desc,
    sku,

    brand: {
      "@type": "Brand",
      name: BRAND,
    },

    offers: {
      "@type": "Offer",
      price,
      priceCurrency,

      availability: isInStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",

      url: productUrlAbs,
    },

    ...(aggregateRating
      ? {
          aggregateRating,
        }
      : {}),

    ...(reviews.length
      ? {
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
        }
      : {}),
  };

  return (
    <script
      id="product-schema"
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: safeJsonLd(productSchema),
      }}
    />
  );
}