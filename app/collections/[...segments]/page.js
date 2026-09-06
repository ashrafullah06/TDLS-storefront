// FILE: app/collections/[...segments]/page.jsx
export const revalidate = 60;
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
  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    return `http://127.0.0.1:${
      process.env.PORT ||
      3000
    }`;
  }

  const vercelHost =
    String(
      process.env.VERCEL_URL ||
      ""
    ).trim();

  if (vercelHost) {
    return /^https?:\/\//i.test(
      vercelHost
    )
      ? vercelHost.replace(
          /\/+$/,
          ""
        )
      : `https://${vercelHost.replace(
          /\/+$/,
          ""
        )}`;
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

  if (!raw) {
    return "";
  }

  const cut =
    raw.split(";")[0];

  return cut
    .replace(
      /[?#].*$/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /-+/g,
      "-"
    )
    .replace(
      /^-|-$/g,
      ""
    );
}

/* ---------------- SEO helper only ---------------- */

function prettySlug(v) {
  return String(v || "")
    .replace(/-/g, " ")
    .replace(
      /\b\w/g,
      (m) =>
        m.toUpperCase()
    );
}

function buildCollectionLabel(
  rawSegments
) {
  const parts =
    (
      Array.isArray(
        rawSegments
      )
        ? rawSegments
        : []
    )
      .map(cleanSlug)
      .filter(Boolean);

  if (!parts.length) {
    return "Collections";
  }

  if (
    parts.length ===
    1
  ) {
    return prettySlug(
      parts[0]
    );
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

  if (
    audiences.has(
      first
    )
  ) {
    const last =
      parts[
        parts.length -
          1
      ];

    const qualifiers =
      parts
        .slice(
          1,
          -1
        )
        .map(
          prettySlug
        )
        .filter(Boolean);

    const base =
      `${prettySlug(
        last
      )} for ${prettySlug(
        first
      )}`;

    if (
      !qualifiers.length
    ) {
      return base;
    }

    return `${base} · ${qualifiers.join(
      " · "
    )}`;
  }

  return parts
    .map(prettySlug)
    .join(" · ");
}

export async function generateMetadata({
  params,
  searchParams,
}) {
  const resolvedParams =
    await Promise.resolve(
      params
    );

  const resolvedSearch =
    await Promise.resolve(
      searchParams
    );

  const rawSegments =
    Array.isArray(
      resolvedParams
        ?.segments
    )
      ? resolvedParams
          .segments
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
      searchObj?.tier ||
      ""
    );

  const collectionLabel =
    buildCollectionLabel(
      cleanSegments
    );

  const titleCore =
    tier
      ? `${prettySlug(
          tier
        )} · ${collectionLabel}`
      : collectionLabel;

  const title =
    `${titleCore} | ${BRAND}`;

  const description =
    `Explore ${collectionLabel} by TDLS—refined pieces shaped by timeless character, effortless comfort and confident design.`;

  const path =
    cleanSegments
      .map(
        (segment) =>
          encodeURIComponent(
            segment
          )
      )
      .join("/");

  const canonicalBase =
    `${SITE_URL}/collections/${path}`;

  const canonical =
    tier
      ? `${canonicalBase}?tier=${encodeURIComponent(
          tier
        )}`
      : canonicalBase;

  return {
    title: {
      absolute:
        title,
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
      type:
        "website",

      url:
        canonical,

      siteName:
        BRAND,

      title,

      description,

      images: [
        {
          url:
            OG_IMAGE,

          width:
            1200,

          height:
            630,

          alt:
            `${titleCore} — TDLS`,
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

function clampInt(
  v,
  fallback,
  min,
  max
) {
  const n =
    Number(v);

  if (
    !Number.isFinite(
      n
    )
  ) {
    return fallback;
  }

  const x =
    Math.floor(n);

  return Math.min(
    max,
    Math.max(
      min,
      x
    )
  );
}

function objFromSearchParams(
  sp
) {
  const out = {};

  if (!sp) {
    return out;
  }

  if (
    typeof sp?.entries ===
    "function"
  ) {
    for (
      const [
        k,
        v,
      ] of sp.entries()
    ) {
      out[k] = v;
    }

    return out;
  }

  if (
    typeof sp ===
    "object"
  ) {
    for (
      const k of
        Object.keys(sp)
    ) {
      const v =
        sp[k];

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
  event,
  audience,
  category,
  subCategory,
  genderGroup,
  ageGroup,
  page,
  pageSize,
}) {
  const p =
    new URLSearchParams();

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

  if (event) {
    p.set(
      "filters[events_products_collections][slug][$eq]",
      event
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

  if (tier) {
    const tierRelations = [
      "tiers",
      "brand_tiers",
      "collection_tiers",
      "events_products_collections",
      "product_collections",
    ];

    tierRelations.forEach(
      (
        rel,
        index
      ) => {
        p.set(
          `filters[$or][${index}][${rel}][slug][$eq]`,
          tier
        );
      }
    );
  }

  return `/products?${p.toString()}`;
}

async function fetchInitialProducts({
  tier,
  event,
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
        event,
        audience,
        category,
        subCategory,
        genderGroup,
        ageGroup,
        page: 1,
        pageSize,
      });

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
          method:
            "GET",

          headers: {
            Accept:
              "application/json",
          },

          next: {
            revalidate,

            tags: [
              "tdls-collections-products",
            ],
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
        .catch(
          () => null
        );

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
      data:
        json.data,
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
    initialQuery
      .pageSize;

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
    objFromSearchParams(
      sp
    );

  const p =
    await Promise.resolve(
      params
    );

  const segs =
    Array.isArray(
      p?.segments
    )
      ? p.segments
      : [];

  /*
   * Parse the route exactly the same way as CollectionsSegmentClient.
   */
  const parsed =
    (() => {
      const out = {
        event: "",
        audience: "",
        category: "",
        subCategory: "",
        genderGroup: "",
        ageGroup: "",
      };

      const clean =
        segs
          .map(
            (x) =>
              cleanSlug(x)
          )
          .filter(Boolean);

      if (
        !clean.length
      ) {
        return out;
      }

      const SEASON_SLUGS =
        new Set([
          "eid",
          "winter",
          "launch-week",
          "new-arrival",
          "on-sale",
          "monsoon",
          "summer",
        ]);

      const AUD_MAIN =
        new Set([
          "men",
          "women",
          "kids",
          "young",
          "home-decor",
          "accessories",
        ]);

      const first =
        clean[0] ||
        "";

      if (
        SEASON_SLUGS.has(
          first
        )
      ) {
        out.event =
          first;

        const second =
          clean[1] ||
          "";

        if (
          second &&
          AUD_MAIN.has(
            second
          )
        ) {
          out.audience =
            second;

          if (
            second ===
              "kids" ||
            second ===
              "young"
          ) {
            out.genderGroup =
              clean[2] ||
              "";

            out.ageGroup =
              clean[3] ||
              "";

            out.category =
              clean[4] ||
              "";

            out.subCategory =
              clean[5] ||
              "";
          } else {
            out.category =
              clean[2] ||
              "";

            out.subCategory =
              clean[3] ||
              "";
          }
        } else {
          out.category =
            second;

          out.subCategory =
            clean[2] ||
            "";
        }

        return out;
      }

      if (
        AUD_MAIN.has(
          first
        )
      ) {
        out.audience =
          first;

        if (
          first ===
            "kids" ||
          first ===
            "young"
        ) {
          out.genderGroup =
            clean[1] ||
            "";

          out.ageGroup =
            clean[2] ||
            "";

          out.category =
            clean[3] ||
            "";

          out.subCategory =
            clean[4] ||
            "";
        } else {
          out.category =
            clean[1] ||
            "";

          out.subCategory =
            clean[2] ||
            "";
        }

        return out;
      }

      out.audience =
        first;

      out.category =
        clean[1] ||
        "";

      out.subCategory =
        clean[2] ||
        "";

      return out;
    })();

  const tier =
    cleanSlug(
      spObj?.tier ||
      ""
    );

  /*
   * Must match CollectionsSegmentClient PAGE_SIZE.
   */
  const pageSize =
    24;

  const initialQuery = {
    tier,

    event:
      parsed.event,

    audience:
      parsed.audience,

    category:
      parsed.category,

    subCategory:
      parsed.subCategory,

    genderGroup:
      parsed.genderGroup,

    ageGroup:
      parsed.ageGroup,

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