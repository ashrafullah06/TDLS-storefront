// FILE: app/collections/page.jsx
export const runtime = "nodejs";

import { permanentRedirect } from "next/navigation";

/**
 * ROOT SAFETY ROUTE
 * ------------------------------------------------------------------
 * Converts query-only URLs into segment URLs that match `app/collections/[...segments]/page.jsx`.
 * Also forwards non-segment query params and sets default page/pageSize for fast infinite scrolling.
 *
 * Flicker/blink fix in THIS FILE:
 * - Keep pageSize aligned with CollectionsSegmentClient paging (24).
 * - Use one canonical page size so SSR and browser paging never overlap/skip rows.
 * - Keep query ordering deterministic (already done) to avoid route churn.
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

function pickFirst(searchParams, keys) {
  const sp = searchParams || {};

  const isUSP =
    typeof sp?.get === "function";

  for (const k of keys) {
    let v = isUSP
      ? sp.get(k)
      : sp?.[k];

    if (Array.isArray(v)) {
      v = v[0];
    }

    if (
      typeof v === "string" &&
      v.trim()
    ) {
      return v;
    }
  }

  return "";
}

function safeDecodeURIComponent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return String(s || "");
  }
}

function parsePackedS(searchParams) {
  const sRaw = pickFirst(searchParams, ["s"]);

  if (!sRaw) return [];

  return sRaw
    .split("/")
    .map((x) =>
      cleanSlug(
        safeDecodeURIComponent(x)
      )
    )
    .filter(Boolean);
}

function clampInt(v, fallback, min, max) {
  const n = Number(v);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  const x = Math.floor(n);

  return Math.min(
    max,
    Math.max(min, x)
  );
}

function buildPassThroughQuery(
  sp,
  {
    tier,
    page,
    pageSize,
  }
) {
  const isUSP =
    typeof sp?.get === "function";

  const entries = [];

  if (isUSP) {
    for (const [k, v] of sp.entries()) {
      entries.push([k, v]);
    }
  } else if (
    sp &&
    typeof sp === "object"
  ) {
    for (const k of Object.keys(sp)) {
      const v = sp[k];

      if (Array.isArray(v)) {
        for (const vv of v) {
          entries.push([
            k,
            String(vv),
          ]);
        }
      } else if (v != null) {
        entries.push([
          k,
          String(v),
        ]);
      }
    }
  }

  const drop = new Set(
    [
      "s",

      "audience",
      "audienceslug",
      "aud",
      "audslug",
      "audiencecategory",
      "audience_category",

      "category",
      "categoryslug",
      "cat",
      "product_category",
      "productcategory",

      "subcategory",
      "subcategoryslug",
      "sub_category",
      "sub_category_slug",
      "sub",

      "gender",
      "gendergroup",
      "gendergroupslug",
      "gender_group",
      "gender_group_slug",
      "genderslug",
      "gender_slug",

      "age",
      "agegroup",
      "agegroupslug",
      "age_group",
      "age_group_slug",
      "ageslug",
      "age_slug",

      "event",
      "season",
      "collectionevent",
      "collection_event",

      "tier",
      "tierslug",
      "tier_slug",
      "collection",
      "collectionslug",
      "collection_slug",

      "page",
      "pagesize",
      "p",
      "ps",
    ].map((x) =>
      String(x).toLowerCase()
    )
  );

  const isHeavyOrInternalKey = (k) => {
    const key =
      String(k || "").toLowerCase();

    if (!key) return true;

    if (drop.has(key)) {
      return true;
    }

    if (
      key === "populate" ||
      key.startsWith("populate[") ||
      key === "fields" ||
      key.startsWith("fields[") ||
      key === "filters" ||
      key.startsWith("filters[") ||
      key === "publicationstate" ||
      key === "locale"
    ) {
      return true;
    }

    if (
      key.startsWith("strapi") ||
      key.startsWith("debug") ||
      key.startsWith("trace")
    ) {
      return true;
    }

    return false;
  };

  const clean = [];

  for (const [k, v] of entries) {
    if (!k) continue;

    const kk =
      String(k);

    const vv =
      typeof v === "string"
        ? v
        : String(v ?? "");

    if (!vv.trim()) {
      continue;
    }

    if (
      isHeavyOrInternalKey(
        kk
      )
    ) {
      continue;
    }

    clean.push([
      kk,
      vv,
    ]);
  }

  clean.sort((a, b) => {
    const k =
      a[0].localeCompare(
        b[0]
      );

    if (k !== 0) {
      return k;
    }

    return a[1].localeCompare(
      b[1]
    );
  });

  const qs =
    new URLSearchParams();

  for (const [k, v] of clean) {
    qs.append(k, v);
  }

  qs.set(
    "page",
    String(page)
  );

  qs.set(
    "pageSize",
    String(pageSize)
  );

  if (tier) {
    qs.set(
      "tier",
      tier
    );
  }

  return qs;
}

export default async function CollectionsRootPage({
  searchParams,
}) {
  const sp =
    await Promise.resolve(
      searchParams
    );

  const tier =
    cleanSlug(
      pickFirst(
        sp,
        [
          "tier",
          "tierSlug",
          "tier_slug",
          "collection",
          "collectionSlug",
          "collection_slug",
        ]
      )
    );

  const event =
    cleanSlug(
      pickFirst(
        sp,
        [
          "event",
          "season",
          "collectionEvent",
          "collection_event",
        ]
      )
    );

  const audience =
    cleanSlug(
      pickFirst(
        sp,
        [
          "audience",
          "audienceSlug",
          "aud",
          "audSlug",
          "audienceCategory",
          "audience_category",
        ]
      )
    );

  const category =
    cleanSlug(
      pickFirst(
        sp,
        [
          "category",
          "categorySlug",
          "cat",
          "product_category",
          "productCategory",
        ]
      )
    );

  const subCategory =
    cleanSlug(
      pickFirst(
        sp,
        [
          "subCategory",
          "subCategorySlug",
          "sub_category",
          "sub_category_slug",
          "subcategory",
          "sub",
        ]
      )
    );

  const genderGroup =
    cleanSlug(
      pickFirst(
        sp,
        [
          "gender",
          "genderGroup",
          "genderGroupSlug",
          "gender_group",
          "gender_group_slug",
          "genderSlug",
          "gender_slug",
        ]
      )
    );

  const ageGroup =
    cleanSlug(
      pickFirst(
        sp,
        [
          "age",
          "ageGroup",
          "ageGroupSlug",
          "age_group",
          "age_group_slug",
          "ageSlug",
          "age_slug",
        ]
      )
    );

  const packed =
    parsePackedS(sp);

  let segs =
    packed.slice();

  if (
    segs.length &&
    tier &&
    segs[0] === tier
  ) {
    segs =
      segs.slice(1);
  }

  if (
    event &&
    segs.length &&
    segs[0] !== event
  ) {
    segs = [
      event,
      ...segs,
    ];
  }

  if (!segs.length) {
    const isKids =
      audience === "kids" ||
      audience === "young";

    const baseAfterEvent =
      (() => {
        if (audience) {
          if (isKids) {
            return [
              audience,
              genderGroup,
              ageGroup,
              category,
              subCategory,
            ].filter(Boolean);
          }

          return [
            audience,
            category,
            subCategory,
          ].filter(Boolean);
        }

        return [
          category,
          subCategory,
        ].filter(Boolean);
      })();

    segs =
      event
        ? [
            event,
            ...baseAfterEvent,
          ].filter(Boolean)
        : baseAfterEvent;
  }

  const page =
    clampInt(
      pickFirst(
        sp,
        [
          "page",
          "p",
        ]
      ),
      1,
      1,
      100000
    );

  /*
   * Must match CollectionsSegmentClient PAGE_SIZE exactly.
   */
  const pageSize =
    24;

  if (!segs.length) {
    const qs =
      new URLSearchParams();

    if (tier) {
      qs.set(
        "tier",
        tier
      );
    }

    if (event) {
      qs.set(
        "event",
        event
      );
    }

    qs.set(
      "page",
      String(page)
    );

    qs.set(
      "pageSize",
      String(pageSize)
    );

    permanentRedirect(
      `/product${
        qs.toString()
          ? `?${qs.toString()}`
          : ""
      }`
    );
  }

  const base =
    `/collections/${segs
      .map(
        encodeURIComponent
      )
      .join("/")}`;

  const qs =
    buildPassThroughQuery(
      sp,
      {
        tier,
        page,
        pageSize,
      }
    );

  permanentRedirect(
    `${base}${
      qs.toString()
        ? `?${qs.toString()}`
        : ""
    }`
  );
}