// FILE: app/collections/page.jsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { redirect } from "next/navigation";

/**
 * ROOT SAFETY ROUTE
 * ------------------------------------------------------------------
 * Why this file exists:
 * - Your menu (and some legacy links) sometimes routes to `/collections?...` (query-only).
 * - Your main collections view is `app/collections/[...segments]/page.jsx`.
 * - Without this file, `/collections?...` can 404 ("Page Not Found").
 *
 * What this file does:
 * - Converts query-only URLs into segment URLs that match `[...segments]`.
 * - Keeps tier strictly as query (`?tier=...`) to avoid treating tier as a path segment.
 *
 * Examples:
 * - /collections?tier=limited-edition&audience=men&category=panjabi
 *   -> /collections/men/panjabi?tier=limited-edition
 *
 * - /collections?s=limited-edition%2Fmen&tier=limited-edition
 *   -> /collections/men?tier=limited-edition
 */

function cleanSlug(v) {
  const raw = (v ?? "").toString().trim().toLowerCase();
  if (!raw) return "";
  // Remove trailing ';' or any garbage (your URL had audienceCategory=men;)
  const cut = raw.split(";")[0];
  return cut
    .replace(/[?#].*$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function pickFirst(searchParams, keys) {
  const sp = searchParams || {};
  const isUSP = typeof sp?.get === "function"; // URLSearchParams-like

  for (const k of keys) {
    let v = isUSP ? sp.get(k) : sp?.[k];

    // Next can provide repeated query params as arrays
    if (Array.isArray(v)) v = v[0];

    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function parsePackedS(searchParams) {
  const sRaw = pickFirst(searchParams, ["s"]);
  if (!sRaw) return [];
  // s might look like: "limited-edition/men" (tier/audience) or "men/panjabi"
  const parts = sRaw
    .split("/")
    .map((x) => cleanSlug(decodeURIComponent(x)))
    .filter(Boolean);
  return parts;
}

export default async function CollectionsRootPage({ searchParams }) {
  // Next.js can pass searchParams as a Promise in newer versions
  const sp = await Promise.resolve(searchParams);

  const tier = cleanSlug(
    pickFirst(sp, ["tier", "tierSlug", "tier_slug", "collection", "collectionSlug", "collection_slug"])
  );

  // Canonical audience/category/subCategory/genderGroup/ageGroup
  const audience = cleanSlug(
    pickFirst(sp, ["audience", "audienceSlug", "aud", "audSlug", "audienceCategory", "audience_category"])
  );
  const category = cleanSlug(
    pickFirst(sp, ["category", "categorySlug", "cat", "product_category", "productCategory"])
  );
  const subCategory = cleanSlug(
    pickFirst(sp, ["subCategory", "subCategorySlug", "sub_category", "sub_category_slug"])
  );
  const genderGroup = cleanSlug(
    pickFirst(sp, ["genderGroup", "genderGroupSlug", "gender_group", "gender_group_slug"])
  );
  const ageGroup = cleanSlug(
    pickFirst(sp, ["ageGroup", "ageGroupSlug", "age_group", "age_group_slug"])
  );

  const packed = parsePackedS(sp);

  // If packed includes tier as first segment (common in your old URL), drop it.
  let segs = packed.slice();
  if (segs.length && tier && segs[0] === tier) segs = segs.slice(1);

  // If no packed segments, build from canonical query (audience-first).
  if (!segs.length) {
    segs = [audience, category, subCategory, genderGroup, ageGroup].filter(Boolean);
  }

  // If still empty, send customers to your normal product listing page.
  if (!segs.length) {
    // keep tier if present
    const qs = new URLSearchParams();
    if (tier) qs.set("tier", tier);
    redirect(`/product${qs.toString() ? `?${qs.toString()}` : ""}`);
  }

  const base = `/collections/${segs.map(encodeURIComponent).join("/")}`;

  const qs = new URLSearchParams();
  if (tier) qs.set("tier", tier);

  redirect(`${base}${qs.toString() ? `?${qs.toString()}` : ""}`);
}
