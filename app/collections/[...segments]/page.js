// FILE: app/collections/[...segments]/page.jsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import Navbar from "@/components/common/navbar";
import CollectionsSegmentClient from "./collections-segment-client";
import { Suspense } from "react";

/**
 * Segment route for collections browsing.
 *
 * Examples:
 *  /collections/men
 *  /collections/men/panjabi
 *  /collections/kids/boys/6-10/panjabi
 *
 * Tier MUST remain a query param:
 *  /collections/men/panjabi?tier=limited-edition
 */

function cleanSlug(v) {
  const raw = (v ?? "").toString().trim().toLowerCase();
  if (!raw) return "";
  const cut = raw.split(";")[0];
  return cut
    .replace(/[?#].*$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.floor(n);
  return Math.min(max, Math.max(min, x));
}

function objFromSearchParams(sp) {
  const out = {};
  if (!sp) return out;

  if (typeof sp?.entries === "function") {
    for (const [k, v] of sp.entries()) out[k] = v;
    return out;
  }

  if (typeof sp === "object") {
    for (const k of Object.keys(sp)) {
      const v = sp[k];
      out[k] = Array.isArray(v) ? v[0] : v;
    }
  }
  return out;
}

function buildProductsStrapiPath({
  tier,
  audience,
  category,
  subCategory,
  genderGroup,
  ageGroup,
  page,
  pageSize,
}) {
  const p = new URLSearchParams();

  p.set("pagination[page]", String(page));
  p.set("pagination[pageSize]", String(pageSize));

  p.set("fields[0]", "slug");
  p.set("fields[1]", "name");
  p.set("fields[2]", "title");

  const tax = [
    "tiers",
    "brand_tiers",
    "collection_tiers",
    "categories",
    "audience_categories",
    "sub_categories",
    "gender_groups",
    "age_groups",
    "events_products_collections",
    "product_collections",
  ];
  for (const rel of tax) {
    p.set(`populate[${rel}][fields][0]`, "slug");
  }

  if (audience) p.set("filters[audience_categories][slug][$eq]", audience);
  if (category) p.set("filters[categories][slug][$eq]", category);
  if (subCategory) p.set("filters[sub_categories][slug][$eq]", subCategory);
  if (genderGroup) p.set("filters[gender_groups][slug][$eq]", genderGroup);
  if (ageGroup) p.set("filters[age_groups][slug][$eq]", ageGroup);

  if (tier) {
    p.set("filters[$or][0][tiers][slug][$eq]", tier);
    p.set("filters[$or][1][collection_tiers][slug][$eq]", tier);
  }

  return `/products?${p.toString()}`;
}

async function fetchInitialProducts({
  tier,
  audience,
  category,
  subCategory,
  genderGroup,
  ageGroup,
  pageSize,
}) {
  try {
    const strapiPath = buildProductsStrapiPath({
      tier,
      audience,
      category,
      subCategory,
      genderGroup,
      ageGroup,
      page: 1,
      pageSize,
    });

    const url = `/api/strapi?path=${encodeURIComponent(strapiPath)}`;

    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return { ok: false, data: null };

    const json = await res.json().catch(() => null);
    if (!json?.ok || !json?.data) return { ok: false, data: null };

    return { ok: true, data: json.data };
  } catch {
    return { ok: false, data: null };
  }
}

const GRIDKILL_CSS = `
  html, body, #app-shell, main { background-image:none !important; }
  html::before, html::after,
  body::before, body::after,
  #app-shell::before, #app-shell::after,
  main::before, main::after {
    content:none !important;
    background:none !important;
    background-image:none !important;
    box-shadow:none !important;
    filter:none !important;
  }

  .tdls-collections-gridkill-root { position:relative; isolation:isolate; }
  .tdls-collections-gridkill-bg {
    position:fixed; inset:0; background:#ffffff; z-index:0; pointer-events:none;
  }
  .tdls-collections-gridkill-content { position:relative; z-index:1; }
`;

function InlineProductsLoading() {
  // ✅ Inline loader ONLY (no fixed overlay, no grid)
  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 py-6">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
        <div className="text-gray-800 font-semibold text-sm sm:text-base">
          Loading products…
        </div>
      </div>
    </div>
  );
}

async function ProductsBlock({ initialQuery, initialSearch }) {
  const initial = await fetchInitialProducts(initialQuery);

  const pageSize = initialQuery.pageSize;

  const initialStrapi =
    initial.ok && initial.data
      ? initial.data
      : {
          data: [],
          meta: { pagination: { page: 1, pageSize, total: 0, pageCount: 1 } },
        };

  return (
    <CollectionsSegmentClient
      initialStrapi={initialStrapi}
      initialQuery={initialQuery}
      initialSearch={initialSearch}
    />
  );
}

export default async function CollectionsSegmentPage({ params, searchParams }) {
  const sp = await Promise.resolve(searchParams);
  const spObj = objFromSearchParams(sp);

  const p = await Promise.resolve(params);
  const segs = Array.isArray(p?.segments) ? p.segments : [];

  const audience = cleanSlug(segs[0] || "");
  const category = cleanSlug(segs[1] || "");
  const subCategory = cleanSlug(segs[2] || "");
  const genderGroup = cleanSlug(segs[3] || "");
  const ageGroup = cleanSlug(segs[4] || "");

  const tier = cleanSlug(spObj?.tier || "");
  const pageSize = clampInt(spObj?.pageSize ?? spObj?.ps, 100, 20, 100);

  const initialQuery = {
    tier,
    audience,
    category,
    subCategory,
    genderGroup,
    ageGroup,
    pageSize,
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GRIDKILL_CSS }} />

      <div className="tdls-collections-gridkill-root">
        <div className="tdls-collections-gridkill-bg" aria-hidden="true" />
        <div className="tdls-collections-gridkill-content">
          <Navbar />

          {/* ✅ Inline loading inside the page (NOT route-level loading.jsx) */}
          <Suspense fallback={<InlineProductsLoading />}>
            <ProductsBlock initialQuery={initialQuery} initialSearch={spObj} />
          </Suspense>
        </div>
      </div>
    </>
  );
}