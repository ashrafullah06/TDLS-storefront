"use client";
// components/common/categorytiles.jsx
import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useOptions } from "@/providers/optionsprovider";

export default function CategoryTiles({
  title = "Explore More Categories",
  max = 8,
  style = {},
  className = ""
}) {
  const { collections, products } = useOptions();
  const router = useRouter();

  // Get categories that are in use (i.e., have products)
  const categoryCounts = useMemo(() => {
    const map = {};
    (products || []).forEach(prod => {
      (prod.attributes?.category?.data || []).forEach(cat => {
        const slug = cat.attributes?.slug;
        if (slug) map[slug] = (map[slug] || 0) + 1;
      });
    });
    return map;
  }, [products]);

  const categories = useMemo(() => {
    // If collections has categories, use them; otherwise fallback to product categories
    let cats =
      (collections || []).filter(
        c =>
          c.type === "category" ||
          (!c.type && categoryCounts[c.slug]) // fallback: show if there are products in this cat
      ) || [];
    // Remove dups, sort by product count desc
    const bySlug = {};
    cats.forEach(c => {
      bySlug[c.slug] = { ...c, count: categoryCounts[c.slug] || 0 };
    });
    // If not enough, add from product categories
    if (Object.keys(bySlug).length < max) {
      Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([slug, count]) => {
          if (!bySlug[slug]) {
            bySlug[slug] = {
              slug,
              name: slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
              count,
            };
          }
        });
    }
    return Object.values(bySlug)
      .filter(cat => cat.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, max);
  }, [collections, categoryCounts, max]);

  if (!categories.length) return null;

  return (
    <section
      className={`w-full max-w-7xl mx-auto mt-14 mb-4 px-4 ${className}`}
      style={style}
    >
      <h3 className="text-lg md:text-xl font-bold mb-5 text-center">
        {title}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6 place-items-center">
        {categories.map(cat => (
          <button
            key={cat.slug}
            onClick={() => router.push(`/collections/all/${cat.slug}`)}
            className="w-full h-32 bg-gradient-to-br from-blue-100 to-gray-50 rounded-xl shadow hover:shadow-lg transition flex flex-col items-center justify-center group border border-gray-200 focus:outline-none"
            aria-label={`Go to ${cat.name} category`}
          >
            <span className="text-lg font-semibold text-blue-900 group-hover:text-blue-700 transition mb-2">
              {cat.name}
            </span>
            <span className="text-xs text-gray-500 font-medium">
              {cat.count} product{cat.count !== 1 ? "s" : ""}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
