"use client";
// components/common/patchbar.jsx
import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useOptions } from "@/providers/optionsprovider";


/**
 * A floating patch-bar for instant navigation.
 * Pulls Audiences, Tiers, Categories, and Events from OptionsProvider.
 */
export default function PatchBar({ className = "", style }) {
  const router = useRouter();
  const {
    collections,
    tiers,
    filters,
    products,
  } = useOptions();

  // --- Build patch options dynamically ---
  const audiencePatches = useMemo(
    () =>
      (collections || [])
        .filter(c => ["women", "men", "kids", "young"].includes(c.slug))
        .map(col => ({
          key: `audience-${col.slug}`,
          label: col.name,
          type: "audience",
          href: `/collections/${col.slug}`,
        })),
    [collections]
  );

  const tierPatches = useMemo(
    () =>
      (tiers || []).map(tier => ({
        key: `tier-${tier.slug}`,
        label: tier.name,
        type: "tier",
        href: `/collections/${tier.slug}`,
      })),
    [tiers]
  );

  // Find top 3 categories (by product count) for variety patches
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
  const topCategories = useMemo(() => {
    const categoryObjs = [];
    (collections || []).forEach(col => {
      if (
        col.type === "category" ||
        (!col.type && ["t-shirt", "sharee", "panjabi"].includes(col.slug))
      ) {
        categoryObjs.push({
          key: `cat-${col.slug}`,
          label: col.name,
          type: "category",
          href: `/collections/all/${col.slug}`,
          count: categoryCounts[col.slug] || 0,
        });
      }
    });
    // Fallback if collections doesn't have categories: get from product data
    if (categoryObjs.length === 0 && Object.keys(categoryCounts).length > 0) {
      Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .forEach(([slug, count]) => {
          categoryObjs.push({
            key: `cat-${slug}`,
            label: slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            type: "category",
            href: `/collections/all/${slug}`,
            count,
          });
        });
    }
    return categoryObjs.slice(0, 4);
  }, [collections, categoryCounts]);

  // Key event collection patches (New Arrival, On Sale, Monsoon, etc)
  const eventPatches = useMemo(
    () =>
      (collections || [])
        .filter(col =>
          [
            "new-arrival",
            "on-sale",
            "monsoon",
            "summer",
            "winter",
          ].includes(col.slug)
        )
        .map(col => ({
          key: `event-${col.slug}`,
          label:
            col.name ||
            col.slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
          type: "event",
          href: `/collections/events/${col.slug}`,
        })),
    [collections]
  );

  // "Shop All" Patch
  const allPatch = {
    key: "all",
    label: "Shop All",
    type: "all",
    href: "/collections/all-products",
  };

  // Compose all patches
  const PATCHES = [
    ...audiencePatches,
    ...tierPatches,
    ...topCategories,
    ...eventPatches,
    allPatch,
  ];

  return (
    <div
      className={`fixed flex flex-wrap gap-2 bottom-8 right-8 z-50 bg-white/95 shadow-2xl rounded-2xl px-5 py-3 border border-gray-200 ${className}`}
      style={{
        maxWidth: "98vw",
        minWidth: 0,
        ...style,
      }}
    >
      {PATCHES.map(patch => (
        <button
          key={patch.key}
          onClick={() => router.push(patch.href)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition
            shadow-sm border border-gray-200 focus:outline-none
            hover:scale-105 hover:bg-blue-900 hover:text-white
            ${
              patch.type === "tier"
                ? "bg-yellow-100 text-yellow-900"
                : patch.type === "event"
                ? "bg-pink-100 text-pink-900"
                : patch.type === "category"
                ? "bg-green-100 text-green-900"
                : patch.type === "audience"
                ? "bg-blue-100 text-blue-900"
                : patch.type === "all"
                ? "bg-gray-900 text-white"
                : ""
            }
          `}
          style={{ margin: "0.18em 0.25em", minWidth: 90 }}
          aria-label={`Jump to ${patch.label}`}
        >
          {patch.label}
        </button>
      ))}
    </div>
  );
}
