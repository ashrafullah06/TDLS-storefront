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

/* ---------------- SEO/social only ---------------- */

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

const BRAND = "TDLS";

const OG_IMAGE =
  `${SITE_URL}/tdls-social-preview`;

function getServerAppOrigin() {
  if (process.env.NODE_ENV !== "production") {
    return `http://127.0.0.1:${process.env.PORT || 3000}`;
  }

  const vercelHost = String(process.env.VERCEL_URL || "").trim();

  if (vercelHost) {
    return /^https?:\/\//i.test(vercelHost)
      ? vercelHost.replace(/\/+$/, "")
      : `https://${vercelHost.replace(/\/+$/, "")}`;
  }

  return SITE_URL;
}

/* ---------------- existing helpers ---------------- */

function cleanSlug(v) {
  const raw =
    (v ?? "")
      .toString()
      .trim()
      .toLowerCase();

  if (!raw) return "";

  const cut =
    raw.split(";")[0];

  return cut
    .replace(/[?#].*$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/* ---------------- SEO helper only ---------------- */

function prettySlug(v) {
  return String(v || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (m) =>
      m.toUpperCase()
    );
}

/*
 * Builds readable collection names without affecting
 * any existing collection filtering/routing logic.
 *
 * Examples:
 * men
 *   -> Men
 *
 * men/panjabi
 *   -> Panjabi for Men
 *
 * kids/boys/6-10/panjabi
 *   -> Panjabi for Kids · Boys · 6 10
 */
function buildCollectionLabel(rawSegments) {
  const parts =
    (Array.isArray(rawSegments)
      ? rawSegments
      : []
    )
      .map(cleanSlug)
      .filter(Boolean);

  if (!parts.length) {
    return "Collections";
  }

  if (parts.length === 1) {
    return prettySlug(parts[0]);
  }

  const first =
    parts[0];

  const audiences =
    new Set([
      "men",
      "women",
      "kids",
      "young",
    ]);

  if (audiences.has(first)) {
    const last =
      parts[parts.length - 1];

    const qualifiers =
      parts
        .slice(1, -1)
        .map(prettySlug)
        .filter(Boolean);

    const base =
      `${prettySlug(last)} for ${prettySlug(first)}`;

    if (!qualifiers.length) {
      return base;
    }

    return `${base} · ${qualifiers.join(" · ")}`;
  }

  return parts
    .map(prettySlug)
    .join(" · ");
}

/*
 * ✅ Dynamic SEO for each collection route.
 * Does not change collection loading/filtering/UI behavior.
 */
export async function generateMetadata({
  params,
  searchParams,
}) {
  const resolvedParams =
    await Promise.resolve(params);

  const resolvedSearch =
    await Promise.resolve(searchParams);

  const rawSegments =
    Array.isArray(
      resolvedParams?.segments
    )
      ? resolvedParams.segments
      : [];

  const cleanSegments =
    rawSegments
      .map(cleanSlug)
      .filter(Boolean);

  const searchObj =
    objFromSearchParams(
      resolvedSearch
    );

  const tier =
    cleanSlug(
      searchObj?.tier || ""
    );

  const collectionLabel =
    buildCollectionLabel(
      cleanSegments
    );

  const titleCore =
    tier
      ? `${prettySlug(tier)} · ${collectionLabel}`
      : collectionLabel;

  const title =
    `${titleCore} | ${BRAND}`;

  const description =
    `Explore ${collectionLabel} by TDLS—refined pieces shaped by timeless character, effortless comfort and confident design.`;

  const path =
    cleanSegments
      .map((segment) =>
        encodeURIComponent(segment)
      )
      .join("/");

  const canonicalBase =
    `${SITE_URL}/collections/${path}`;

  /*
   * Keep tier because it can materially define the collection.
   * Deliberately exclude page/pageSize/filter noise from canonical URLs.
   */
  const canonical =
    tier
      ? `${canonicalBase}?tier=${encodeURIComponent(tier)}`
      : canonicalBase;

  return {
    title: {
      absolute: title,
    },

    description,

    alternates: {
      canonical,
    },

    robots: {
      index: true,
      follow: true,
    },

    openGraph: {
      type: "website",
      url: canonical,
      siteName: BRAND,
      title,
      description,

      images: [
        {
          url: OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${titleCore} — TDLS`,
        },
      ],
    },

    twitter: {
      card:
        "summary_large_image",

      title,
      description,

      images: [
        OG_IMAGE,
      ],
    },
  };
}

/* ---------------- existing code below remains unchanged ---------------- */

function clampInt(v, fallback, min, max) {
  const n = Number(v);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  const x =
    Math.floor(n);

  return Math.min(
    max,
    Math.max(min, x)
  );
}

function objFromSearchParams(sp) {
  const out = {};

  if (!sp) {
    return out;
  }

  if (
    typeof sp?.entries === "function"
  ) {
    for (const [k, v] of sp.entries()) {
      out[k] = v;
    }

    return out;
  }

  if (
    typeof sp === "object"
  ) {
    for (
      const k of Object.keys(sp)
    ) {
      const v = sp[k];

      out[k] =
        Array.isArray(v)
          ? v[0]
          : v;
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

  p.set(
    "pagination[page]",
    String(page)
  );

  p.set(
    "pagination[pageSize]",
    String(pageSize)
  );

  p.set(
    "pagination[withCount]",
    "true"
  );

  if (audience) {
    p.set(
      "filters[audience_categories][slug][$eq]",
      audience
    );
  }

  if (category) {
    p.set(
      "filters[categories][slug][$eq]",
      category
    );
  }

  if (subCategory) {
    p.set(
      "filters[sub_categories][slug][$eq]",
      subCategory
    );
  }

  if (genderGroup) {
    p.set(
      "filters[gender_groups][slug][$eq]",
      genderGroup
    );
  }

  if (ageGroup) {
    p.set(
      "filters[age_groups][slug][$eq]",
      ageGroup
    );
  }

  /*
   * A tier can be connected through any of the
   * real tier/collection relations used by the
   * current TDLS product schema.
   */
  if (tier) {
    const tierRelations = [
      "tiers",
      "brand_tiers",
      "collection_tiers",
      "events_products_collections",
      "product_collections",
    ];

    tierRelations.forEach(
      (rel, index) => {
        p.set(
          `filters[$or][${index}][${rel}][slug][$eq]`,
          tier
        );
      }
    );
  }

  /*
   * Do NOT send populate=*.
   *
   * /api/strapi already recognizes filtered
   * /products requests and applies its existing
   * deterministic filtersafe profile.
   */
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
    const strapiPath =
      buildProductsStrapiPath({
        tier,
        audience,
        category,
        subCategory,
        genderGroup,
        ageGroup,
        page: 1,
        pageSize,
      });

    /*
     * Server-side fetch() requires a usable absolute URL.
     * Keep using the existing /api/strapi proxy;
     * only make its URL valid for Node/server rendering.
     */
    const proxyUrl =
      new URL(
        "/api/strapi",
        getServerAppOrigin()
      );

    proxyUrl.searchParams.set(
      "path",
      strapiPath
    );

    const res =
      await fetch(
        proxyUrl.toString(),
        {
          method: "GET",
          cache: "no-store",

          headers: {
            Accept:
              "application/json",
          },
        }
      );

    if (!res.ok) {
      return {
        ok: false,
        data: null,
      };
    }

    const json =
      await res
        .json()
        .catch(() => null);

    if (
      !json?.ok ||
      !json?.data
    ) {
      return {
        ok: false,
        data: null,
      };
    }

    return {
      ok: true,
      data: json.data,
    };
  } catch {
    return {
      ok: false,
      data: null,
    };
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

async function ProductsBlock({
  initialQuery,
  initialSearch,
}) {
  const initial =
    await fetchInitialProducts(
      initialQuery
    );

  const pageSize =
    initialQuery.pageSize;

  const initialStrapi =
    initial.ok &&
    initial.data
      ? initial.data
      : {
          data: [],

          meta: {
            pagination: {
              page: 1,
              pageSize,
              total: 0,
              pageCount: 1,
            },
          },
        };

  return (
    <CollectionsSegmentClient
      initialStrapi={
        initialStrapi
      }
      initialOk={
        initial.ok
      }
      initialQuery={
        initialQuery
      }
      initialSearch={
        initialSearch
      }
    />
  );
}

export default async function CollectionsSegmentPage({
  params,
  searchParams,
}) {
  const sp =
    await Promise.resolve(
      searchParams
    );

  const spObj =
    objFromSearchParams(sp);

  const p =
    await Promise.resolve(
      params
    );

  const segs =
    Array.isArray(p?.segments)
      ? p.segments
      : [];

  const audience =
    cleanSlug(
      segs[0] || ""
    );

  const category =
    cleanSlug(
      segs[1] || ""
    );

  const subCategory =
    cleanSlug(
      segs[2] || ""
    );

  const genderGroup =
    cleanSlug(
      segs[3] || ""
    );

  const ageGroup =
    cleanSlug(
      segs[4] || ""
    );

  const tier =
    cleanSlug(
      spObj?.tier || ""
    );

  /*
   * Smaller initial batch:
   * enough for the first view, but avoids making
   * the customer wait for a huge product payload.
   */
  const pageSize =
    clampInt(
      spObj?.pageSize ??
        spObj?.ps,
      24,
      12,
      48
    );

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
      <style
        dangerouslySetInnerHTML={{
          __html:
            GRIDKILL_CSS,
        }}
      />

      <div className="tdls-collections-gridkill-root">
        <div
          className="tdls-collections-gridkill-bg"
          aria-hidden="true"
        />

        <div className="tdls-collections-gridkill-content">
          <Navbar />

          {/* ✅ Inline loading inside the page (NOT route-level loading.jsx) */}
          <Suspense
            fallback={
              <InlineProductsLoading />
            }
          >
            <ProductsBlock
              initialQuery={
                initialQuery
              }
              initialSearch={
                spObj
              }
            />
          </Suspense>
        </div>
      </div>
    </>
  );
}