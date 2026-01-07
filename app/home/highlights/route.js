// FILE: app/api/home/highlights/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/** Helper: n days ago */
function daysAgo(n) {
  const ms = n * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
}

/**
 * Trending categories from ALL customers
 * - window: last 45 days
 * - based on units sold (OrderItem.quantity)
 * - only non-archived products & categories
 */
async function getTrendingCategories() {
  const since = daysAgo(45);

  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        status: { in: ["PLACED", "CONFIRMED", "COMPLETED"] },
        OR: [
          { placedAt: { gte: since } },
          { createdAt: { gte: since } },
        ],
      },
    },
    select: {
      quantity: true,
      variant: {
        select: {
          product: {
            select: {
              id: true,
              slug: true,
              title: true,
              archivedAt: true,
              categories: {
                select: {
                  category: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      archivedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const map = new Map();

  for (const item of items) {
    const product = item.variant?.product;
    if (!product || product.archivedAt) continue;

    const qty = item.quantity || 0;
    if (!qty) continue;

    const links = product.categories || [];
    for (const link of links) {
      const category = link.category;
      if (!category || category.archivedAt) continue;

      const id = category.id;
      if (!id) continue;

      let entry = map.get(id);
      if (!entry) {
        entry = {
          id,
          name: category.name,
          slug: category.slug,
          href: category.slug
            ? `/collections/${category.slug}`
            : "/collections",
          totalSold: 0,
        };
        map.set(id, entry);
      }
      entry.totalSold += qty;
    }
  }

  const arr = Array.from(map.values());
  arr.sort((a, b) => b.totalSold - a.totalSold || a.name.localeCompare(b.name));
  return arr.slice(0, 8);
}

/**
 * Best-seller products from ALL customers
 * - window: all time
 * - based on total units sold
 * - priceFrom / priceTo from priceSale → priceMrp → unitPrice snapshot
 * - optional coverImageUrl from first ProductMedia
 * - href points to /product/[slug] (your product page)
 */
async function getBestSellerProducts() {
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        status: { in: ["PLACED", "CONFIRMED", "COMPLETED"] },
      },
    },
    select: {
      quantity: true,
      unitPrice: true,
      variant: {
        select: {
          product: {
            select: {
              id: true,
              slug: true,
              title: true,
              archivedAt: true,
              priceSale: true,
              priceMrp: true,
              media: {
                take: 1,
                orderBy: { position: "asc" },
                select: {
                  media: {
                    select: {
                      url: true,
                      alt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const map = new Map();

  for (const item of items) {
    const product = item.variant?.product;
    if (!product || product.archivedAt) continue;

    const pid = product.id;
    if (!pid) continue;

    let entry = map.get(pid);
    if (!entry) {
      const firstMedia = product.media?.[0]?.media;
      entry = {
        id: pid,
        slug: product.slug,
        title: product.title,
        // 🔗 now points to your actual product page route
        href: product.slug ? `/product/${product.slug}` : "/all-products",
        totalSold: 0,
        priceFrom: null,
        priceTo: null,
        coverImageUrl: firstMedia?.url || null,
        coverImageAlt: firstMedia?.alt || product.title || null,
      };
      map.set(pid, entry);
    }

    const qty = item.quantity || 0;
    entry.totalSold += qty;

    // prefer product-level price, fallback to unitPrice
    const rawPrice =
      product.priceSale ??
      product.priceMrp ??
      item.unitPrice ??
      null;

    if (rawPrice != null) {
      const priceNum = Number(rawPrice);
      if (Number.isFinite(priceNum) && priceNum > 0) {
        if (entry.priceFrom == null || priceNum < entry.priceFrom) {
          entry.priceFrom = priceNum;
        }
        if (entry.priceTo == null || priceNum > entry.priceTo) {
          entry.priceTo = priceNum;
        }
      }
    }
  }

  const arr = Array.from(map.values());
  arr.sort(
    (a, b) =>
      b.totalSold - a.totalSold ||
      (a.title || "").localeCompare(b.title || "")
  );
  return arr.slice(0, 10);
}

export async function GET() {
  try {
    const [trendingCategories, bestSellerProducts] = await Promise.all([
      getTrendingCategories(),
      getBestSellerProducts(),
    ]);

    return NextResponse.json({
      ok: true,
      trendingCategories,
      bestSellerProducts,
    });
  } catch (err) {
    console.error("Error in /api/home/highlights", err);
    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_ERROR",
        message: "Failed to load highlights",
      },
      { status: 500 }
    );
  }
}
