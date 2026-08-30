// PATH: app/collections/[...segments]/collections-segment-client.jsx
"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { FaShoppingCart, FaRegHeart } from "react-icons/fa";

import ProductCard from "@/components/common/productcard";
import QuickView from "@/components/common/quickview";
import { useCart as use_cart } from "@/components/common/cart_context";

// client-only BottomFloatingBar (same pattern as AllProductsClient)
const BottomFloatingBar = dynamic(
  () => import("@/components/common/bottomfloatingbar"),
  { ssr: false }
);

/* ===================== PERF: true paging + preload + no-blink ===================== */
const PAGE_SIZE = 100; // ✅ requested: 100 products per fetch/page (NOT 1000)
const DISPLAY_STEP = 100; // ✅ requested: reveal 100 cards at a time
const PREFETCH_AHEAD_PAGES = 2; // prefetch ahead so scroll feels instant
const FETCH_TIMEOUT_MS = 15000;

// cache: instant open on click (route-scoped)
const CACHE_PREFIX = "tdls_collections_route_cache_v1::";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min (fast + safe)

/* ---------------- helpers: fetch with timeout ---------------- */
async function fetchWithTimeout(url, options = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Unwrap /api/strapi envelope + flatten Strapi {id, attributes} nodes
 */
function unwrapAndFlatten(raw) {
  const payload = raw?.ok ? raw.data : raw;
  const arr = Array.isArray(payload?.data) ? payload.data : [];
  const meta = payload?.meta?.pagination || payload?.meta?.pagination || null;

  const items = arr.map((n) =>
    n?.attributes
      ? { id: n.id, ...n.attributes, attributes: n.attributes }
      : n
  );

  const pagination = payload?.meta?.pagination || payload?.meta?.pagination;
  const p = pagination || meta;

  return {
    items,
    pagination: p
      ? {
          page: Number(p.page || 1),
          pageSize: Number(p.pageSize || PAGE_SIZE),
          pageCount: Number(p.pageCount || 1),
          total: Number(p.total || 0),
        }
      : { page: 1, pageSize: PAGE_SIZE, pageCount: 1, total: items.length },
  };
}

/* ---------------- helpers ---------------- */
const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const get = (o, p) =>
  p
    ?.toString()
    .split(".")
    .reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
const toStr = (x) =>
  typeof x === "string"
    ? x
    : x?.name ||
      x?.label ||
      x?.slug ||
      x?.value ||
      x?.title ||
      "";

const normSlug = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

const pretty = (s) =>
  String(s || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());

const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).filter(Boolean))];

const readRouteCache = (key) => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !Array.isArray(parsed.items)) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeRouteCache = (key, items, pagination) => {
  try {
    // Keep cache bounded (avoid localStorage bloat on very large catalogs)
    const capped = Array.isArray(items) ? items.slice(0, 400) : [];
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({
        ts: Date.now(),
        items: capped,
        pagination: pagination || null,
      })
    );
  } catch {
    // ignore quota
  }
};

const mergeUnique = (prev, next) => {
  const out = Array.isArray(prev) ? [...prev] : [];
  const seen = new Set(
    out.map((p) => String(p?.id || p?.slug || p?.attributes?.slug || ""))
  );
  (Array.isArray(next) ? next : []).forEach((p) => {
    const k = String(p?.id || p?.slug || p?.attributes?.slug || "");
    if (!k) {
      // last-resort: stable-ish key based on signature fields
      const fallback =
        "u:" +
        String(p?.name || p?.attributes?.name || "") +
        "::" +
        String(p?.createdAt || p?.attributes?.createdAt || "");
      if (!seen.has(fallback)) {
        seen.add(fallback);
        out.push(p);
      }
      return;
    }
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  });
  return out;
};

/**
 * Generic slug extractor that understands:
 * - ["kids", "new-arrival"]
 * - [{ slug: "kids" }, { attributes: { slug: "new-arrival" } }]
 * - { data: [...] } Strapi relations
 */
const getSlugs = (rel) => {
  if (!rel) return [];
  if (Array.isArray(rel)) {
    return rel
      .map((x) => {
        if (typeof x === "string") return normSlug(x);
        if (x && typeof x === "object") {
          return normSlug(
            x.slug ||
              x.value ||
              x.name ||
              (x.attributes && (x.attributes.slug || x.attributes.name)) ||
              ""
          );
        }
        return "";
      })
      .filter(Boolean);
  }

  const d = rel?.data;
  if (!d) return [];
  if (Array.isArray(d)) {
    return d
      .map((x) => normSlug(x?.attributes?.slug || x?.slug || ""))
      .filter(Boolean);
  }
  const one = d?.attributes?.slug || d?.slug;
  return one ? [normSlug(one)] : [];
};

const hasSlug = (rel, slug) => {
  if (!isNonEmpty(slug)) return false;
  const target = normSlug(slug);
  return getSlugs(rel).includes(target);
};

const hasSlugKey = (product, baseKey, slug) => {
  if (!product || !isNonEmpty(slug)) return false;
  const target = normSlug(slug);

  const direct = product[`${baseKey}_slugs`] || product[`${baseKey}Slugs`];
  if (direct) return getSlugs(direct).includes(target);

  const rel = product[baseKey] || product?.attributes?.[baseKey];
  return hasSlug(rel, slug);
};

/* ---------------------- relationship key aliases (future-proof) ---------------------- */
const FIELD_ALIASES = {
  tiers: [
    "events_products_collections",
    "eventsProductsCollections",
    "brandTiers",
    "brand_tiers",
    "brandTier",
    "brand_tier",
    "collectionTiers",
    "collection_tiers",
    "collectionTier",
    "collection_tier",
    "tiers",
    "tier",
    "product_tiers",
    "tdlc_tiers",
  ],
  audiences: ["audience_categories", "audiences", "audience", "customer_audiences"],
  categories: ["categories", "category", "product_categories", "product_category"],
  subCategories: ["sub_categories", "subcategories", "sub_category", "subCategory", "subcategory"],
  superCategories: ["super_categories", "supercategories", "super_category", "superCategory"],
  gender: ["gender_groups", "genders", "gender", "genderGroup"],
  age: ["age_groups", "ages", "age", "ageGroup"],
  events: ["events_products_collections", "events", "event", "season", "seasons", "collection_events"],
};

const hasAnySlugKey = (product, keys, slug) => {
  if (!isNonEmpty(slug)) return true;
  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    if (hasSlugKey(product, k, slug)) return true;
  }
  return false;
};

/* ---- variants, price, inventory (aligned with ProductCard & AllProductsClient) ---- */

const readVariants = (p) => {
  const A = p?.attributes || {};

  const pv = p?.product_variants || A?.product_variants;
  if (Array.isArray(pv?.data)) {
    return pv.data.map((node) => {
      const attrs = node?.attributes || {};
      return { id: node.id, ...attrs };
    });
  }
  if (Array.isArray(pv)) {
    return pv.map((node) =>
      node && typeof node === "object"
        ? { id: node.id, ...(node.attributes || node) }
        : node
    );
  }

  if (Array.isArray(p?.variants)) return p.variants;
  if (Array.isArray(A?.variants?.data)) {
    return A.variants.data.map((n) => {
      const attrs = n?.attributes || {};
      return { id: n.id, ...attrs };
    });
  }
  if (Array.isArray(A?.variants)) return A.variants;

  if (Array.isArray(p?.product_variant)) return p.product_variant;
  if (Array.isArray(A?.product_variant)) return A.product_variant;
  if (Array.isArray(A?.options)) return A.options;

  return [];
};

const pickSizeName = (v) =>
  v?.size_name ||
  v?.size?.name ||
  v?.size?.data?.attributes?.name ||
  (typeof v?.size === "string" ? v.size : null) ||
  v?.attributes?.size_name ||
  v?.attributes?.size?.name;

const normVariants = (p) => {
  const base = readVariants(p);
  const out = [];
  if (!base.length) return out;

  base.forEach((v) => {
    const sizes = Array.isArray(v?.sizes) ? v.sizes : null;

    const color_name =
      v?.color_name ||
      v?.color?.name ||
      v?.color?.data?.attributes?.name ||
      (typeof v?.color === "string" ? v.color : null) ||
      null;

    if (sizes && sizes.length) {
      sizes.forEach((s) => {
        const size_name =
          s?.size_name ||
          s?.size ||
          s?.label ||
          s?.value ||
          v?.size_name ||
          v?.size ||
          null;

        const price =
          typeof s?.effective_price === "number"
            ? s.effective_price
            : typeof s?.price_override === "number"
            ? s.price_override
            : typeof s?.price === "number"
            ? s.price
            : typeof v?.price === "number"
            ? v.price
            : typeof v?.price_range?.min === "number"
            ? v.price_range.min
            : null;

        const stock =
          typeof s?.stock_quantity === "number"
            ? s.stock_quantity
            : typeof s?.stock === "number"
            ? s.stock
            : typeof v?.stock_total === "number"
            ? v.stock_total
            : typeof v?.stock === "number"
            ? v.stock
            : typeof v?.stock_quantity === "number"
            ? v.stock_quantity
            : null;

        out.push({
          id: s?.id || v?.id || v?.variantId || null,
          color_name,
          size_name,
          price,
          stock,
        });
      });
    } else {
      const size_name = pickSizeName(v) || null;

      let price =
        typeof v?.price === "number"
          ? v.price
          : typeof v?.sale_price === "number"
          ? v.sale_price
          : null;

      if (price == null && v?.price_range) {
        if (typeof v.price_range.min === "number") price = v.price_range.min;
        else if (typeof v.price_range.max === "number") price = v.price_range.max;
      }

      const stock =
        typeof v?.stock === "number"
          ? v.stock
          : typeof v?.stock_quantity === "number"
          ? v.stock_quantity
          : typeof v?.inventory === "number"
          ? v.inventory
          : typeof v?.stock_total === "number"
          ? v.stock_total
          : null;

      out.push({
        id: v?.id || v?.variantId || null,
        color_name,
        size_name,
        price,
        stock,
      });
    }
  });

  return out;
};

const fallbackColors = (p) => {
  const A = p?.attributes || {};
  const can =
    [p?.colors, A?.colors, A?.color_options, A?.color_names, get(A, "color.data")].flat?.() ||
    [];
  return (Array.isArray(can) ? can : [])
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
};

const fallbackSizes = (p) => {
  const A = p?.attributes || {};
  const can = [p?.sizes, A?.sizes, A?.size_options, A?.size_names].flat?.() || [];
  return (Array.isArray(can) ? can : []).map(toStr).filter(Boolean);
};

const priceOf = (p) => {
  const A = p?.attributes || {};

  const variants = normVariants(p);
  const vPrices = variants
    .map((v) => v.price)
    .filter((n) => typeof n === "number");

  let base =
    typeof p?.selling_price === "number"
      ? p.selling_price
      : typeof A?.selling_price === "number"
      ? A.selling_price
      : typeof p?.price === "number"
      ? p.price
      : typeof A?.price === "number"
      ? A.price
      : typeof p?.base_price === "number"
      ? p.base_price
      : typeof A?.base_price === "number"
      ? A.base_price
      : null;

  if (base == null) {
    const priceSale =
      typeof p?.price_sale === "number"
        ? p.price_sale
        : typeof A?.price_sale === "number"
        ? A.price_sale
        : null;
    const discountPrice =
      typeof p?.discount_price === "number"
        ? p.discount_price
        : typeof A?.discount_price === "number"
        ? A.discount_price
        : null;
    const range = p?.price_range || A?.price_range;

    base =
      priceSale ??
      discountPrice ??
      (range && typeof range.min === "number" ? range.min : null) ??
      base;
  }

  if (vPrices.length) return Math.min(...vPrices);
  return base ?? 0;
};

const compareAtOf = (p) => {
  const A = p?.attributes || {};
  return (
    (typeof p?.regular_price === "number" && p.regular_price) ||
    (typeof A?.regular_price === "number" && A.regular_price) ||
    (typeof p?.compare_at_price === "number" && p.compare_at_price) ||
    (typeof A?.compare_at_price === "number" && A.compare_at_price) ||
    (typeof p?.mrp === "number" && p.mrp) ||
    (typeof A?.mrp === "number" && A.mrp) ||
    (typeof p?.price_mrp === "number" && p.price_mrp) ||
    (typeof A?.price_mrp === "number" && A.price_mrp) ||
    null
  );
};

const discountPct = (p) => {
  const price = priceOf(p);
  const cmp = compareAtOf(p);
  if (!cmp || !price || cmp <= 0) return 0;
  return Math.max(0, Math.round(((cmp - price) / cmp) * 100));
};

const inStockOf = (p) => {
  const A = p?.attributes || {};
  const flags = [
    p?.in_stock,
    A?.in_stock,
    p?.available,
    A?.available,
    p?.isAvailable,
    A?.isAvailable,
  ].some(Boolean);

  const qty =
    Number(
      p?.stock ??
        A?.stock ??
        p?.inventory ??
        A?.inventory ??
        p?.stock_total ??
        A?.stock_total ??
        p?.quantity_available ??
        A?.quantity_available
    ) || 0;

  const varHas = normVariants(p).some((v) => (v.stock || 0) > 0);

  return flags || qty > 0 || varHas;
};

const tsOf = (p) => {
  const A = p?.attributes || {};
  const ts =
    p?.publishedAt ||
    A?.publishedAt ||
    p?.createdAt ||
    A?.createdAt ||
    p?.updatedAt ||
    A?.updatedAt ||
    null;
  return ts ? new Date(ts).getTime() : 0;
};

/* ---- semantic facets ---- */
const deriveTypes = (p) => {
  const A = p?.attributes || {};
  const fromRel = [
    ...getSlugs(p?.categories),
    ...getSlugs(A?.categories),
    ...getSlugs(p?.categories_slugs),
    ...getSlugs(A?.categories_slugs),
  ];
  const extras = [
    A?.type,
    p?.type,
    A?.product_type,
    p?.product_type,
    A?.category,
    p?.category,
  ]
    .filter(Boolean)
    .map(toStr)
    .map(normSlug)
    .filter(Boolean);
  return [...new Set([...fromRel, ...extras])];
};

const deriveBrand = (p) => {
  const A = p?.attributes || {};
  const b = [
    p?.brand,
    A?.brand,
    A?.brand_name,
    p?.brand_name,
    A?.vendor,
    p?.vendor,
  ]
    .map(toStr)
    .filter(Boolean);
  return b.length ? normSlug(b[0]) : "";
};

const deriveTags = (p) => {
  const A = p?.attributes || {};
  const events = [
    ...getSlugs(p?.events_products_collections),
    ...getSlugs(A?.events_products_collections),
    ...getSlugs(p?.events_products_collections_slugs),
    ...getSlugs(A?.events_products_collections_slugs),
  ];
  const audience = [
    ...getSlugs(p?.audience_categories),
    ...getSlugs(A?.audience_categories),
    ...getSlugs(p?.audience_categories_slugs),
    ...getSlugs(A?.audience_categories_slugs),
  ];
  const misc = [
    A?.season,
    p?.season,
    A?.tag,
    p?.tag,
    A?.badge,
    p?.badge,
    A?.labels,
    p?.labels,
  ]
    .flat()
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  return [...new Set([...events, ...audience, ...misc])];
};

/* ===================== page component ===================== */

export default function CollectionsSegmentClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stickyRef = useRef(null);
  const [showTopBtn, setShowTopBtn] = useState(false);

  const cart = use_cart?.();
  const cartCount = Array.isArray(cart?.items) ? cart.items.length : 0;
  const [hoverWhich, setHoverWhich] = useState(null);

  /**
   * ✅ ROUTE-SCOPED "KILL FULL-PAGE GRID" SWITCH
   * If some global CSS/injected overlay is drawing a full-page grid (debug grid),
   * this page disables it ONLY while this route is mounted.
   */
  useLayoutEffect(() => {
    try {
      const root = document.documentElement;
      const prev = root.getAttribute("data-tdls-no-debug-grid");
      root.setAttribute("data-tdls-no-debug-grid", "1");
      return () => {
        if (prev == null) root.removeAttribute("data-tdls-no-debug-grid");
        else root.setAttribute("data-tdls-no-debug-grid", prev);
      };
    } catch {
      // never block render
    }
  }, []);

  // query params (preserved, tolerant aliases + sanitization)
  const cleanParam = (v) =>
    String(v ?? "")
      .trim()
      .replace(/;+$/g, "")
      .replace(/^;+/, "")
      .trim();

  const pickParam = (keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      const v = cleanParam(searchParams.get(k));
      if (isNonEmpty(v)) return v;
    }
    return "";
  };

  // legacy packed path: s=limited-edition/men[/category[/sub]]
  const qpS = cleanParam(searchParams.get("s"));
  const sParts = qpS
    ? qpS
        .split("/")
        .map((x) => cleanParam(x))
        .filter(Boolean)
    : [];

  const qpTier =
    pickParam([
      "tier",
      "tierSlug",
      "tier_slug",
      "collection",
      "collectionSlug",
      "collection_slug",
    ]) || sParts[0] || "";

  const qpAudience =
    pickParam([
      "audience",
      "audienceSlug",
      "audience_slug",
      "aud",
      "audSlug",
      "aud_slug",
      "audience_category",
      "audienceCategory",
    ]) || sParts[1] || "";

  const qpCategory = pickParam([
    "category",
    "categorySlug",
    "category_slug",
    "cat",
    "catSlug",
    "cat_slug",
  ]);

  const qpSubCategory = pickParam([
    "subCategory",
    "sub_category",
    "subcategory",
    "sub",
    "subSlug",
    "sub_slug",
  ]);

  const qpEvent = pickParam([
    "event",
    "season",
    "collectionEvent",
    "collection_event",
  ]);

  const qpGender = pickParam([
    "gender",
    "genderGroup",
    "gender_group",
    "genderSlug",
    "gender_slug",
  ]);

  const qpAge = pickParam([
    "age",
    "ageGroup",
    "age_group",
    "ageSlug",
    "age_slug",
  ]);

  // derive from path
  const segments = useMemo(() => {
    const parts = (pathname || "").split("/").filter(Boolean);
    return parts.slice(1);
  }, [pathname]);

  const derived = useMemo(() => {
    const out = {
      audience: "",
      event: "",
      category: "",
      subCategory: "",
      gender: "",
      age: "",
    };

    const segs = Array.isArray(segments) ? segments.filter(Boolean) : [];
    if (!segs.length) return out;

    const SEASON_SLUGS = new Set([
      "eid",
      "winter",
      "launch-week",
      "new-arrival",
      "on-sale",
      "monsoon",
      "summer",
    ]);

    const AUD_MAIN = new Set([
      "men",
      "women",
      "kids",
      "young",
      "home-decor",
      "accessories",
    ]);

    const first = normSlug(segs[0]);

    if (SEASON_SLUGS.has(first)) {
      out.event = first;

      const second = normSlug(segs[1] || "");
      if (second && AUD_MAIN.has(second)) {
        out.audience = second;

        if (second === "kids" || second === "young") {
          out.gender = normSlug(segs[2] || "");
          out.age = normSlug(segs[3] || "");
          out.category = normSlug(segs[4] || "");
          out.subCategory = normSlug(segs[5] || "");
        } else {
          out.category = normSlug(segs[2] || "");
          out.subCategory = normSlug(segs[3] || "");
        }
      } else {
        out.category = second;
        out.subCategory = normSlug(segs[2] || "");
      }

      return out;
    }

    if (AUD_MAIN.has(first)) {
      out.audience = first;

      if (first === "kids" || first === "young") {
        out.gender = normSlug(segs[1] || "");
        out.age = normSlug(segs[2] || "");
        out.category = normSlug(segs[3] || "");
        out.subCategory = normSlug(segs[4] || "");
      } else {
        out.category = normSlug(segs[1] || "");
        out.subCategory = normSlug(segs[2] || "");
      }

      return out;
    }

    out.audience = first;
    out.category = normSlug(segs[1] || "");
    out.subCategory = normSlug(segs[2] || "");
    return out;
  }, [segments]);

  const selectedTier = isNonEmpty(qpTier) ? qpTier : "";
  const selectedAudience = isNonEmpty(qpAudience) ? qpAudience : derived.audience;
  const selectedCategory = isNonEmpty(qpCategory) ? qpCategory : derived.category;
  const selectedEvent = isNonEmpty(qpEvent) ? qpEvent : derived.event;
  const selectedGender = isNonEmpty(qpGender) ? qpGender : derived.gender;
  const selectedAge = isNonEmpty(qpAge) ? qpAge : derived.age;
  const selectedSubCategory = isNonEmpty(qpSubCategory)
    ? qpSubCategory
    : derived.subCategory;

  const routeKey = useMemo(() => {
    // route-scoped signature (drives cache + safe reset)
    const bits = [
      "path:" + normSlug(pathname || ""),
      "tier:" + normSlug(selectedTier || ""),
      "aud:" + normSlug(selectedAudience || ""),
      "cat:" + normSlug(selectedCategory || ""),
      "sub:" + normSlug(selectedSubCategory || ""),
      "evt:" + normSlug(selectedEvent || ""),
      "gen:" + normSlug(selectedGender || ""),
      "age:" + normSlug(selectedAge || ""),
    ];
    return bits.join("::");
  }, [
    pathname,
    selectedTier,
    selectedAudience,
    selectedCategory,
    selectedSubCategory,
    selectedEvent,
    selectedGender,
    selectedAge,
  ]);

  /* ===================== DATA: paged fetch (instant cache + prefetch) ===================== */

  const [rawProducts, setRawProducts] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const [remotePage, setRemotePage] = useState(0);
  const [remotePageCount, setRemotePageCount] = useState(1);
  const [remoteTotal, setRemoteTotal] = useState(0);

  // mode:
  // - "serverFiltered": ask Strapi for just the collection (fast + correct)
  // - "catalogScan": fallback if server schema mismatch or returns 0 unexpectedly
  const [fetchMode, setFetchMode] = useState("serverFiltered");

  // reveal count (UI pagination)
  const [displayTarget, setDisplayTarget] = useState(DISPLAY_STEP);

  // spinner only if load is not instant (prevents long “Curating…”)
  const [showLoadingHint, setShowLoadingHint] = useState(false);

  const inflightRef = useRef(new Set()); // pages in flight
  const loadedPagesRef = useRef(new Set()); // pages applied to state
  const routeKeyRef = useRef(routeKey);

  // prefetch cache: { routeKey, pages: Map(page -> {items, pagination}) }
  const prefetchRef = useRef({ routeKey, pages: new Map() });

  const abortAllRef = useRef([]);
  const registerAbort = (ctrl) => {
    abortAllRef.current.push(ctrl);
  };
  const abortAll = () => {
    abortAllRef.current.forEach((c) => {
      try {
        c.abort();
      } catch {}
    });
    abortAllRef.current = [];
  };

  const buildServerFiltersQS = useCallback(() => {
    // Keep this intentionally conservative (keys that are most likely to exist).
    // If Strapi schema differs, we fall back to catalogScan automatically.
    const parts = [];
    const addRel = (rel, slug) => {
      if (!isNonEmpty(slug)) return;
      parts.push(
        `filters[${rel}][slug][$eq]=${encodeURIComponent(normSlug(slug))}`
      );
    };

    // Primary collection dimensions
    addRel("audience_categories", selectedAudience);
    addRel("categories", selectedCategory);
    addRel("sub_categories", selectedSubCategory);
    addRel("gender_groups", selectedGender);
    addRel("age_groups", selectedAge);

    // event / seasonal
    // NOTE: tier is sometimes routed as collection/tier; we still apply selectedEvent first
    if (isNonEmpty(selectedEvent)) addRel("events_products_collections", selectedEvent);
    else if (isNonEmpty(selectedTier)) addRel("events_products_collections", selectedTier);

    return parts.join("&");
  }, [
    selectedAudience,
    selectedCategory,
    selectedSubCategory,
    selectedGender,
    selectedAge,
    selectedEvent,
    selectedTier,
  ]);

  const fetchStrapiPage = useCallback(
    async ({ page, useServerFilters }) => {
      const baseQS =
        `pagination[page]=${page}` +
        `&pagination[pageSize]=${PAGE_SIZE}` +
        `&pagination[withCount]=true` +
        `&populate=*`;

      const filtersQS = useServerFilters ? buildServerFiltersQS() : "";
      const qs = filtersQS ? `${baseQS}&${filtersQS}` : baseQS;

      const strapiPath = `/products?${qs}`;

      // Use a dedicated AbortController per request so route changes instantly cancel.
      const ctrl = new AbortController();
      registerAbort(ctrl);

      const res = await fetchWithTimeout(
        `/api/strapi?path=${encodeURIComponent(strapiPath)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: ctrl.signal,
        },
        FETCH_TIMEOUT_MS
      );

      const raw = await safeJson(res);
      if (!res.ok || !raw) {
        return { ok: false, status: res.status, items: [], pagination: null };
      }

      const { items, pagination } = unwrapAndFlatten(raw);

      return { ok: true, status: res.status, items, pagination };
    },
    [buildServerFiltersQS]
  );

  const prefetchAhead = useCallback(
    async ({ fromPage, useServerFilters }) => {
      const pr = prefetchRef.current;
      if (pr.routeKey !== routeKey) return;

      const start = Number(fromPage || 1);
      for (let i = 1; i <= PREFETCH_AHEAD_PAGES; i++) {
        const p = start + i;
        if (p > remotePageCount) break;
        if (loadedPagesRef.current.has(p)) continue;
        if (inflightRef.current.has(p)) continue;
        if (pr.pages.has(p)) continue;

        inflightRef.current.add(p);
        fetchStrapiPage({ page: p, useServerFilters })
          .then((r) => {
            if (!r?.ok) return;
            const now = prefetchRef.current;
            if (now.routeKey !== routeKey) return;
            now.pages.set(p, { items: r.items, pagination: r.pagination });
          })
          .finally(() => {
            inflightRef.current.delete(p);
          });
      }
    },
    [fetchStrapiPage, routeKey, remotePageCount]
  );

  const applyPageResult = useCallback(
    ({ page, items, pagination, allowCacheWrite }) => {
      setRawProducts((prev) => mergeUnique(prev, items));

      if (pagination) {
        setRemotePage(Number(pagination.page || page || 1));
        setRemotePageCount(Number(pagination.pageCount || 1));
        setRemoteTotal(Number(pagination.total || 0));

        if (allowCacheWrite) {
          // cache only needs to make the next click instant
          writeRouteCache(routeKey, mergeUnique([], items), pagination);
        }
      } else {
        setRemotePage((x) => Math.max(x, page || 1));
      }
    },
    [routeKey]
  );

  const loadPage = useCallback(
    async ({ page, useServerFilters, allowCacheWrite = false }) => {
      const p = Number(page || 1);
      if (loadedPagesRef.current.has(p)) return true;

      // use prefetched result if available (instant scroll)
      const pref = prefetchRef.current;
      if (pref.routeKey === routeKey && pref.pages.has(p)) {
        const cached = pref.pages.get(p);
        pref.pages.delete(p);
        loadedPagesRef.current.add(p);
        applyPageResult({
          page: p,
          items: cached.items,
          pagination: cached.pagination,
          allowCacheWrite,
        });
        return true;
      }

      if (inflightRef.current.has(p)) return true;
      inflightRef.current.add(p);

      const isInitial = p === 1;
      if (isInitial) setLoadingInitial(true);
      else setLoadingMore(true);

      try {
        const r = await fetchStrapiPage({ page: p, useServerFilters });
        if (!r.ok) return false;

        // stale route guard
        if (routeKeyRef.current !== routeKey) return false;

        loadedPagesRef.current.add(p);
        applyPageResult({
          page: p,
          items: r.items,
          pagination: r.pagination,
          allowCacheWrite,
        });

        // start prefetch ahead after applying this page
        prefetchAhead({ fromPage: p, useServerFilters });

        return true;
      } catch {
        return false;
      } finally {
        inflightRef.current.delete(p);
        setLoadingMore(false);
        setLoadingInitial(false);
      }
    },
    [applyPageResult, fetchStrapiPage, prefetchAhead, routeKey]
  );

  // spinner delay (so we don’t show “Curating…” if it’s truly instant)
  useEffect(() => {
    if (!loadingInitial) {
      setShowLoadingHint(false);
      return;
    }
    const t = setTimeout(() => setShowLoadingHint(true), 180);
    return () => clearTimeout(t);
  }, [loadingInitial]);

  // RESET + boot: cache-first then fetch
  useEffect(() => {
    routeKeyRef.current = routeKey;

    // hard reset per route key
    abortAll();
    inflightRef.current = new Set();
    loadedPagesRef.current = new Set();
    prefetchRef.current = { routeKey, pages: new Map() };

    setRawProducts([]);
    setFetchError("");
    setRemotePage(0);
    setRemotePageCount(1);
    setRemoteTotal(0);
    setLoadingInitial(true);
    setLoadingMore(false);
    setDisplayTarget(DISPLAY_STEP);

    // Prefer serverFiltered unless nothing is selected
    const hasAnySelection = [
      selectedTier,
      selectedAudience,
      selectedCategory,
      selectedSubCategory,
      selectedEvent,
      selectedGender,
      selectedAge,
    ].some(isNonEmpty);

    setFetchMode(hasAnySelection ? "serverFiltered" : "catalogScan");

    // 1) instant show from route cache (if available)
    const cached = readRouteCache(routeKey);
    if (cached?.items?.length) {
      setRawProducts(Array.isArray(cached.items) ? cached.items : []);
      if (cached.pagination) {
        setRemotePage(Number(cached.pagination.page || 1));
        setRemotePageCount(Number(cached.pagination.pageCount || 1));
        setRemoteTotal(Number(cached.pagination.total || 0));
        loadedPagesRef.current.add(Number(cached.pagination.page || 1));
      }
      setLoadingInitial(false);
    }

    // 2) always refresh page 1 in background (keeps it correct)
    (async () => {
      // First attempt: server filtered (fast + correct)
      const ok1 = await loadPage({
        page: 1,
        useServerFilters: hasAnySelection,
        allowCacheWrite: true,
      });

      // If serverFiltered returns 0 and we have selections, switch to catalogScan automatically
      // (prevents “no products” due to schema mismatches).
      if (routeKeyRef.current !== routeKey) return;

      const shouldFallback =
        hasAnySelection &&
        (!ok1 || (remoteTotal === 0 && (cached?.items?.length || 0) === 0));

      if (shouldFallback) {
        setFetchMode("catalogScan");
        // clear (but keep UI stable; we’ll refill fast)
        setRawProducts((prev) => (prev.length ? prev : []));
        // load catalog page 1 unfiltered
        await loadPage({ page: 1, useServerFilters: false, allowCacheWrite: false });
      }
    })();

    return () => {
      abortAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  /* ===================== Collection match logic (used for scan + UI) ===================== */

  const matchesCollection = useCallback(
    (p) => {
      if (!p) return false;
      if (p.disable_frontend) return false;

      if (isNonEmpty(selectedTier)) {
        const t = normSlug(selectedTier);

        const directTier = normSlug(
          p?.tier ||
            p?.tier_slug ||
            p?.tierSlug ||
            p?.collection ||
            p?.collection_slug ||
            p?.collectionSlug ||
            p?.attributes?.tier ||
            p?.attributes?.tier_slug ||
            p?.attributes?.tierSlug ||
            p?.attributes?.collection ||
            p?.attributes?.collection_slug ||
            p?.attributes?.collectionSlug ||
            ""
        );

        const ok =
          hasAnySlugKey(p, FIELD_ALIASES.tiers, t) ||
          deriveTags(p).includes(t) ||
          (directTier && directTier === t);

        if (!ok) return false;
      }

      if (
        isNonEmpty(selectedAudience) &&
        !hasAnySlugKey(p, FIELD_ALIASES.audiences, selectedAudience)
      )
        return false;

      if (
        isNonEmpty(selectedCategory) &&
        !hasAnySlugKey(p, FIELD_ALIASES.categories, selectedCategory)
      )
        return false;

      if (
        isNonEmpty(selectedSubCategory) &&
        !hasAnySlugKey(p, FIELD_ALIASES.subCategories, selectedSubCategory)
      )
        return false;

      if (
        isNonEmpty(selectedEvent) &&
        !hasAnySlugKey(
          p,
          [...FIELD_ALIASES.audiences, ...FIELD_ALIASES.events],
          selectedEvent
        )
      )
        return false;

      if (
        isNonEmpty(selectedGender) &&
        !hasAnySlugKey(p, FIELD_ALIASES.gender, selectedGender)
      )
        return false;

      if (
        isNonEmpty(selectedAge) &&
        !hasAnySlugKey(p, FIELD_ALIASES.age, selectedAge)
      )
        return false;

      return true;
    },
    [
      selectedTier,
      selectedAudience,
      selectedCategory,
      selectedSubCategory,
      selectedEvent,
      selectedGender,
      selectedAge,
    ]
  );

  /* ---------- 1) apply path + query-based global filters ---------- */
  const globallyFiltered = useMemo(() => {
    if (!Array.isArray(rawProducts) || rawProducts.length === 0) return [];
    return rawProducts.filter(matchesCollection);
  }, [rawProducts, matchesCollection]);

  /* ---------- 2) dynamic facets from what remains (best-effort on loaded set) ---------- */
  const facets = useMemo(() => {
    const mapCount = () => new Map();

    const types = mapCount();
    const colors = mapCount();
    const sizes = mapCount();
    const tags = mapCount();
    const brands = mapCount();

    let priceMin = Infinity;
    let priceMax = 0;

    const inc = (m, key) => {
      if (!key) return;
      const k = String(key);
      m.set(k, (m.get(k) || 0) + 1);
    };

    globallyFiltered.forEach((p) => {
      deriveTypes(p).forEach((t) => inc(types, t));
      deriveTags(p).forEach((t) => inc(tags, t));

      const v = normVariants(p);
      v.forEach((x) => x.color_name && inc(colors, normSlug(String(x.color_name))));
      v.forEach((x) => x.size_name && inc(sizes, String(x.size_name)));
      fallbackColors(p).forEach((c) => inc(colors, normSlug(c)));
      fallbackSizes(p).forEach((s) => inc(sizes, s));

      const b = deriveBrand(p);
      if (b) inc(brands, b);

      const price = priceOf(p);
      if (Number.isFinite(price)) {
        priceMin = Math.min(priceMin, price);
        priceMax = Math.max(priceMax, price);
      }
    });

    const sortEntries = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return {
      types: sortEntries(types),
      colors: sortEntries(colors),
      sizes: sortEntries(sizes),
      tags: sortEntries(tags),
      brands: sortEntries(brands),
      priceMin: Number.isFinite(priceMin) ? priceMin : 0,
      priceMax: Number.isFinite(priceMax) ? priceMax : 0,
    };
  }, [globallyFiltered]);

  /* ---------- 3) page-local filters ---------- */
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("default"); // default | newest | price-asc | price-desc
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [minDiscount, setMinDiscount] = useState(0);
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);
  const [typeSel, setTypeSel] = useState("");
  const [brandSel, setBrandSel] = useState("");
  const [colorSet, setColorSet] = useState(() => new Set());
  const [sizeSet, setSizeSet] = useState(() => new Set());
  const [tagSet, setTagSet] = useState(() => new Set());
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // ✅ IMPORTANT: route-scoped storage so filters never “stick” across different collection pages
  const FILTERS_STORAGE_KEY = useMemo(
    () => "collections_filters_v3::" + routeKey,
    [routeKey]
  );

  // hydrate/persist
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) || {};
      setSearch(s.search || "");
      setSortBy(s.sortBy || "default");
      setOnlyInStock(!!s.onlyInStock);
      setMinDiscount(Number(s.minDiscount || 0));
      setMinPrice(Number(s.minPrice || 0));
      setMaxPrice(Number(s.maxPrice || 0));
      setTypeSel(s.typeSel || "");
      setBrandSel(s.brandSel || "");
      setColorSet(new Set(s.colors || []));
      setSizeSet(new Set(s.sizes || []));
      setTagSet(new Set(s.tags || []));
    } catch {}
  }, [FILTERS_STORAGE_KEY]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({
          search,
          sortBy,
          onlyInStock,
          minDiscount,
          minPrice,
          maxPrice,
          typeSel,
          brandSel,
          colors: [...colorSet],
          sizes: [...sizeSet],
          tags: [...tagSet],
        })
      );
    } catch {}
  }, [
    FILTERS_STORAGE_KEY,
    search,
    sortBy,
    onlyInStock,
    minDiscount,
    minPrice,
    maxPrice,
    typeSel,
    brandSel,
    colorSet,
    sizeSet,
    tagSet,
  ]);

  // init price range once we know bounds
  useEffect(() => {
    if (facets.priceMax && maxPrice === 0) setMaxPrice(facets.priceMax);
    if (minPrice === 0) setMinPrice(facets.priceMin || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets.priceMin, facets.priceMax]);

  // back-to-top button visibility
  useEffect(() => {
    const onScroll = () => setShowTopBtn(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: "smooth" }), []);

  const toggleSet = (setVal, value, setState) => {
    const next = new Set(setVal);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setState(next);
  };

  const clearAll = () => {
    setSearch("");
    setSortBy("default");
    setOnlyInStock(false);
    setMinDiscount(0);
    setMinPrice(facets.priceMin || 0);
    setMaxPrice(facets.priceMax || 0);
    setTypeSel("");
    setBrandSel("");
    setColorSet(new Set());
    setSizeSet(new Set());
    setTagSet(new Set());
    setDisplayTarget(DISPLAY_STEP);
  };

  // derived active chips
  const activeChips = useMemo(() => {
    const chips = [];
    if (isNonEmpty(search)) chips.push({ k: "search", v: search });
    if (typeSel) chips.push({ k: "type", v: pretty(typeSel) });
    if (brandSel) chips.push({ k: "brand", v: pretty(brandSel) });
    if (onlyInStock) chips.push({ k: "stock", v: "In Stock" });
    if (minDiscount > 0) chips.push({ k: "discount", v: `${minDiscount}%+` });
    if (minPrice > facets.priceMin || maxPrice < facets.priceMax)
      chips.push({ k: "price", v: `৳${minPrice}–${maxPrice}` });
    [...colorSet].forEach((c) => chips.push({ k: "color", v: pretty(c), val: c }));
    [...sizeSet].forEach((s) => chips.push({ k: "size", v: s, val: s }));
    [...tagSet].forEach((t) => chips.push({ k: "tag", v: pretty(t), val: t }));
    return chips;
  }, [
    search,
    typeSel,
    brandSel,
    onlyInStock,
    minDiscount,
    minPrice,
    maxPrice,
    colorSet,
    sizeSet,
    tagSet,
    facets,
  ]);

  /* ---------- 4) apply page-local filters on top of global ---------- */
  const pageFiltered = useMemo(() => {
    let list = globallyFiltered;

    if (isNonEmpty(search)) {
      const q = search.toLowerCase();
      list = list.filter((p) => {
        const A = p?.attributes || {};
        const name = (p?.name || A?.name || "").toLowerCase();
        const slug = (p?.slug || A?.slug || "").toLowerCase();
        const desc = (A?.short_description || A?.description || "").toLowerCase();
        return name.includes(q) || slug.includes(q) || desc.includes(q);
      });
    }

    const meta = new Map(
      list.map((p) => {
        const v = normVariants(p);
        const colors = new Set(
          [
            ...v.map((x) => (x.color_name ? normSlug(String(x.color_name)) : "")),
            ...fallbackColors(p),
          ].filter(Boolean)
        );
        const sizes = new Set(
          [
            ...v.map((x) => (x.size_name ? String(x.size_name) : "")),
            ...fallbackSizes(p),
          ].filter(Boolean)
        );
        const A = p?.attributes || {};
        const name = p?.name || A?.name || "";
        return [
          p,
          {
            types: deriveTypes(p),
            brand: deriveBrand(p),
            tags: deriveTags(p),
            colors,
            sizes,
            price: priceOf(p),
            inStock: inStockOf(p),
            discount: discountPct(p),
            name,
          },
        ];
      })
    );

    if (typeSel) list = list.filter((p) => meta.get(p).types.includes(typeSel));
    if (brandSel) list = list.filter((p) => meta.get(p).brand === brandSel);
    if (colorSet.size)
      list = list.filter((p) => [...colorSet].some((c) => meta.get(p).colors.has(c)));
    if (sizeSet.size)
      list = list.filter((p) => [...sizeSet].some((s) => meta.get(p).sizes.has(s)));
    if (tagSet.size)
      list = list.filter((p) => [...tagSet].some((t) => meta.get(p).tags.includes(t)));

    list = list.filter((p) => {
      const pr = meta.get(p).price;
      return (minPrice ? pr >= minPrice : true) && (maxPrice ? pr <= maxPrice : true);
    });

    if (onlyInStock) list = list.filter((p) => meta.get(p).inStock);
    if (minDiscount > 0) list = list.filter((p) => meta.get(p).discount >= minDiscount);

    if (sortBy === "price-asc") {
      list = [...list].sort((a, b) => {
        const A = meta.get(a),
          B = meta.get(b);
        return A.price - B.price || A.name.localeCompare(B.name);
      });
    } else if (sortBy === "price-desc") {
      list = [...list].sort((a, b) => {
        const A = meta.get(a),
          B = meta.get(b);
        return B.price - A.price || A.name.localeCompare(B.name);
      });
    } else if (sortBy === "newest") {
      list = [...list].sort((a, b) => tsOf(b) - tsOf(a));
    }

    return list;
  }, [
    globallyFiltered,
    search,
    sortBy,
    onlyInStock,
    minDiscount,
    minPrice,
    maxPrice,
    typeSel,
    brandSel,
    colorSet,
    sizeSet,
    tagSet,
  ]);

  /* ===================== Infinite auto-load: ALWAYS, no manual paging needed ===================== */

  const sentinelRef = useRef(null);

  const hasMoreRemote = remotePage < remotePageCount;
  const visible = useMemo(() => pageFiltered.slice(0, displayTarget), [pageFiltered, displayTarget]);

  // ensure we have enough loaded products to satisfy displayTarget
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (loadingInitial) return;
      if (loadingMore) return;
      if (!hasMoreRemote) return;

      // If serverFiltered is working, pageFiltered grows by ~100 each page.
      // If we’re in catalogScan, pageFiltered may grow slower; keep fetching until we can fill displayTarget.
      while (!cancelled && pageFiltered.length < displayTarget && remotePage < remotePageCount) {
        const nextPage = (remotePage || 0) + 1;
        const useServerFilters =
          fetchMode === "serverFiltered" &&
          [
            selectedTier,
            selectedAudience,
            selectedCategory,
            selectedSubCategory,
            selectedEvent,
            selectedGender,
            selectedAge,
          ].some(isNonEmpty);

        const ok = await loadPage({ page: nextPage, useServerFilters });
        if (!ok) break;

        // small yield to avoid blocking UI
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [
    displayTarget,
    pageFiltered.length,
    remotePage,
    remotePageCount,
    hasMoreRemote,
    loadingInitial,
    loadingMore,
    loadPage,
    fetchMode,
    selectedTier,
    selectedAudience,
    selectedCategory,
    selectedSubCategory,
    selectedEvent,
    selectedGender,
    selectedAge,
  ]);

  // IntersectionObserver: bump displayTarget by 100 when customer scrolls
  useEffect(() => {
    if (!sentinelRef.current) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          setDisplayTarget((c) => c + DISPLAY_STEP);
        });
      },
      { rootMargin: "900px 0px" }
    );

    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, []);

  // Quick View state
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState(null);

  /* ---------- price preset helpers ---------- */
  const pricePresets = useMemo(() => {
    const lo = facets.priceMin || 0;
    const hi = facets.priceMax || 0;
    if (hi <= lo) return [];
    const span = hi - lo;
    const step = Math.max(500, Math.round(span / 4 / 100) * 100);
    return [
      [lo, lo + step],
      [lo + step, lo + step * 2],
      [lo + step * 2, lo + step * 3],
      [lo + step * 3, hi],
    ];
  }, [facets.priceMin, facets.priceMax]);

  /* ---------- header title / subtitle ---------- */
  const headerTitle =
    selectedAudience
      ? selectedAudience.replace(/-/g, " ").toUpperCase()
      : selectedCategory
      ? selectedCategory.replace(/-/g, " ").toUpperCase()
      : "COLLECTIONS";

  const headerSubtitle = useMemo(() => {
    const parts = [];
    if (selectedEvent) parts.push(pretty(selectedEvent));
    if (selectedAudience) parts.push(pretty(selectedAudience));
    if (selectedGender) parts.push(pretty(selectedGender));
    if (selectedAge) parts.push(pretty(selectedAge));
    if (selectedCategory) parts.push(pretty(selectedCategory));
    if (selectedSubCategory) parts.push(pretty(selectedSubCategory));
    const text = parts.join(" • ");
    return text || "Curated by TDLC studio";
  }, [
    selectedEvent,
    selectedAudience,
    selectedGender,
    selectedAge,
    selectedCategory,
    selectedSubCategory,
  ]);

  const copyShareLink = () => {
    try {
      navigator.clipboard.writeText(window.location.href);
    } catch {}
  };

  const exhausted = !loadingInitial && !loadingMore && remotePage >= remotePageCount;

  // Count line: prefer Strapi total only when serverFiltered is likely correct.
  const showTotal =
    fetchMode === "serverFiltered" &&
    [
      selectedTier,
      selectedAudience,
      selectedCategory,
      selectedSubCategory,
      selectedEvent,
      selectedGender,
      selectedAge,
    ].some(isNonEmpty) &&
    remoteTotal > 0;

  const totalText = showTotal ? remoteTotal : pageFiltered.length;

  /* ---------- styles ---------- */
  const S = {
    pageShell: {
      width: "100%",
      minHeight: "100vh",
      background:
        "radial-gradient(circle at top, #fdf9f0 0, #f6f1e6 40%, #f2ede4 100%)",
      paddingBottom: 96,
      position: "relative",
    },
    pageInner: {
      width: "100%",
      maxWidth: "100%",
      margin: "0 auto",
      padding: "28px clamp(16px, 4vw, 40px) 96px",
    },
    titleRow: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      marginBottom: 18,
    },
    backBtn: {
      height: 38,
      width: 38,
      borderRadius: "999px",
      border: "1px solid #e1d8c4",
      background: "linear-gradient(135deg, #fffdf7, #f7f0dd)",
      cursor: "pointer",
      lineHeight: "36px",
      textAlign: "center",
      fontSize: 18,
      boxShadow: "0 4px 16px rgba(12, 35, 64, 0.08)",
      color: "#3a3342",
    },
    titleBlock: { display: "flex", flexDirection: "column", gap: 4 },
    title: {
      fontFamily: "'Playfair Display', serif",
      fontWeight: 900,
      fontSize: 30,
      letterSpacing: ".12em",
      color: "#0f2147",
    },
    subtitle: {
      fontFamily: "'Playfair Display', serif",
      fontSize: 13,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "#7a6c4b",
      opacity: 0.9,
    },
    topBarWrap: { position: "relative", zIndex: 5 },
    topBar: {
      position: "sticky",
      top: 8,
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      alignItems: "center",
      marginBottom: 12,
      padding: 14,
      border: "1px solid #e6e0cf",
      borderRadius: 18,
      background: "rgba(255, 252, 245, 0.93)",
      backdropFilter: "saturate(180%) blur(10px)",
      boxShadow: "0 10px 32px rgba(27, 29, 53, 0.12)",
    },
    group: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
    label: {
      fontSize: 11,
      fontWeight: 800,
      color: "#7c8190",
      textTransform: "uppercase",
      letterSpacing: ".16em",
    },
    select: {
      height: 36,
      borderRadius: 12,
      border: "1px solid #d4d7e6",
      padding: "0 10px",
      background: "#ffffff",
      fontWeight: 700,
      color: "#0f2147",
      minWidth: 150,
      fontSize: 13,
    },
    input: {
      height: 36,
      borderRadius: 12,
      border: "1px solid #d4d7e6",
      padding: "0 10px",
      background: "#ffffff",
      fontWeight: 700,
      color: "#0f2147",
      minWidth: 120,
      fontSize: 13,
      fontFeatureSettings: "'tnum' 1",
    },
    chip: (active) => ({
      height: 32,
      padding: "0 12px",
      borderRadius: 999,
      border: active ? "1.5px solid #bda04d" : "1px solid #d4d7e6",
      background: active ? "#0f2147" : "#fdfbf4",
      color: active ? "#fdf5da" : "#16224a",
      fontWeight: 800,
      cursor: "pointer",
      fontSize: 12,
      letterSpacing: ".06em",
    }),
    badge: {
      marginLeft: 6,
      fontSize: 10,
      padding: "2px 7px",
      borderRadius: 999,
      background: "#f4efe0",
      color: "#5b4f3a",
      fontWeight: 800,
    },
    activeRow: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap",
      alignItems: "center",
      margin: "2px 0 16px",
    },
    activeChip: {
      height: 30,
      padding: "0 10px",
      borderRadius: 999,
      border: "1px solid #d4d7e6",
      background: "#f8fafc",
      color: "#0f2147",
      fontWeight: 800,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
    },
    gridCard: {
      marginTop: 16,
      padding: 18,
      borderRadius: 22,
      background: "rgba(255,255,255,0.92)",
      border: "1px solid #e3dfd2",
      boxShadow: "0 18px 40px rgba(0,0,0,0.04)",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
      gap: 18,
      listStyle: "none",
      padding: 0,
      margin: 0,
    },
    loadMore: {
      margin: "20px auto 0",
      display: "block",
      padding: "10px 18px",
      borderRadius: 999,
      border: "1px solid #d4d7e6",
      fontWeight: 800,
      background: "#ffffff",
      cursor: "pointer",
      fontSize: 13,
      letterSpacing: ".08em",
    },
    utilBar: { display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" },
    linkBtn: {
      height: 32,
      padding: "0 12px",
      borderRadius: 999,
      border: "1px solid #d4d7e6",
      background: "#ffffff",
      fontWeight: 800,
      color: "#0f2147",
      cursor: "pointer",
      fontSize: 12,
      letterSpacing: ".08em",
    },
    topBtn: {
      position: "fixed",
      right: 16,
      bottom: 120,
      zIndex: 20,
      height: 40,
      padding: "0 14px",
      borderRadius: 14,
      border: "1px solid #d4d7e6",
      background: "#ffffff",
      fontWeight: 900,
      color: "#0f2147",
      cursor: "pointer",
      boxShadow: "0 10px 24px rgba(15,33,71,.16)",
      fontSize: 13,
      letterSpacing: ".09em",
    },
    count: {
      marginTop: 4,
      marginBottom: 10,
      color: "#6f7280",
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: ".08em",
    },
    iconDock: {
      position: "fixed",
      top: "calc(var(--nav-h, 88px) + 48px)",
      right: 24,
      zIndex: 30,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      pointerEvents: "none",
    },
    iconBtn: {
      pointerEvents: "auto",
      width: 48,
      height: 48,
      borderRadius: "50%",
      border: "1px solid rgba(15,33,71,.18)",
      background: "#ffffff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 8px 22px rgba(15,33,71,.18)",
      cursor: "pointer",
      position: "relative",
      transition: "transform .1s ease-out, box-shadow .15s ease, border .15s ease",
    },
    iconBtnHover: {
      transform: "translateY(-1px)",
      boxShadow: "0 12px 28px rgba(15,33,71,.24)",
      border: "1px solid #0f2147",
    },
    iconBadge: {
      position: "absolute",
      top: -5,
      right: -5,
      minWidth: 20,
      height: 20,
      borderRadius: 999,
      background: "#0f2147",
      color: "#f9fafb",
      fontSize: 11,
      fontWeight: 800,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 6px",
    },
    loadingRow: {
      padding: 22,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      fontWeight: 800,
      color: "#7a6c4b",
      fontSize: 14,
    },
    skeleton: {
      height: 320,
      borderRadius: 18,
      border: "1px solid #eee7d8",
      background:
        "linear-gradient(90deg, rgba(246,241,230,.9), rgba(255,255,255,.95), rgba(246,241,230,.9))",
      backgroundSize: "200% 100%",
      animation: "tdlsShimmer 1.2s ease-in-out infinite",
    },
  };

  const stableKey = (p, idx) =>
    String(p?.id || p?.slug || p?.attributes?.slug || `row-${idx}`);

  /* ---------- render ---------- */
  return (
    <div style={S.pageShell}>
      <style jsx global>{`
        @keyframes tdlsSpin {
          to {
            transform: rotate(360deg);
          }
        }
        .tdlsSpinner {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          border: 2px solid rgba(122, 108, 75, 0.25);
          border-top-color: rgba(122, 108, 75, 0.95);
          animation: tdlsSpin 0.8s linear infinite;
        }
        @keyframes tdlsShimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }

        /* ✅ Route-scoped: kill any full-page debug grid overlay/background */
        html[data-tdls-no-debug-grid="1"],
        html[data-tdls-no-debug-grid="1"] body {
          background-image: none !important;
        }

        html[data-tdls-no-debug-grid="1"]::before,
        html[data-tdls-no-debug-grid="1"]::after,
        html[data-tdls-no-debug-grid="1"] body::before,
        html[data-tdls-no-debug-grid="1"] body::after {
          content: "" !important;
          background: none !important;
          background-image: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
          display: none !important;
        }

        html[data-tdls-no-debug-grid="1"] .debug-grid,
        html[data-tdls-no-debug-grid="1"] .grid-overlay,
        html[data-tdls-no-debug-grid="1"] #grid-overlay,
        html[data-tdls-no-debug-grid="1"] [data-debug-grid],
        html[data-tdls-no-debug-grid="1"] [data-grid-overlay] {
          display: none !important;
        }
      `}</style>

      {/* Floating cart + wishlist icons (aligned with AllProductsClient) */}
      <div style={S.iconDock} aria-label="Cart and wishlist">
        <button
          type="button"
          style={{ ...S.iconBtn, ...(hoverWhich === "cart" ? S.iconBtnHover : null) }}
          onMouseEnter={() => setHoverWhich("cart")}
          onMouseLeave={() => setHoverWhich(null)}
          onClick={() => router.push("/cart")}
          aria-label="Open cart"
        >
          <FaShoppingCart size={26} color="#0c2340" />
          {cartCount > 0 && <span style={S.iconBadge}>{cartCount}</span>}
        </button>

        <button
          type="button"
          style={{
            ...S.iconBtn,
            ...(hoverWhich === "wishlist" ? S.iconBtnHover : null),
          }}
          onMouseEnter={() => setHoverWhich("wishlist")}
          onMouseLeave={() => setHoverWhich(null)}
          onClick={() => router.push("/wishlist")}
          aria-label="Open wishlist"
        >
          <FaRegHeart size={26} color="#7a102b" />
        </button>
      </div>

      <main style={S.pageInner}>
        {/* header */}
        <div style={S.titleRow}>
          <button
            type="button"
            aria-label="Back"
            onClick={() => router.back()}
            style={S.backBtn}
          >
            ←
          </button>
          <div style={S.titleBlock}>
            <h1 style={S.title}>{headerTitle}</h1>
            <div style={S.subtitle}>{headerSubtitle}</div>
          </div>
        </div>

        {/* sticky filter bar */}
        <div style={S.topBarWrap} ref={stickyRef}>
          <div style={S.topBar} aria-label="Filters" role="region">
            {/* Search */}
            <div style={S.group}>
              <span style={S.label}>Search</span>
              <input
                style={S.input}
                type="search"
                value={search}
                placeholder="Name, slug or description…"
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search products"
              />
            </div>

            {/* Sort */}
            <div style={S.group}>
              <span style={S.label}>Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={S.select}
                aria-label="Sort products"
              >
                <option value="default">Featured</option>
                <option value="newest">Newest</option>
                <option value="price-asc">Price: Low → High</option>
                <option value="price-desc">Price: High → Low</option>
              </select>
            </div>

            {/* Type */}
            <div style={S.group}>
              <span style={S.label}>Type</span>
              <select
                value={typeSel}
                onChange={(e) => setTypeSel(e.target.value)}
                style={S.select}
                aria-label="Type"
              >
                <option value="">All Types</option>
                {facets.types.map(([t, c]) => (
                  <option key={t} value={t}>
                    {pretty(t)} ({c})
                  </option>
                ))}
              </select>
            </div>

            {/* Brand */}
            {facets.brands.length > 0 && (
              <div style={S.group}>
                <span style={S.label}>Brand</span>
                <select
                  value={brandSel}
                  onChange={(e) => setBrandSel(e.target.value)}
                  style={S.select}
                  aria-label="Brand"
                >
                  <option value="">All Brands</option>
                  {facets.brands.map(([b, c]) => (
                    <option key={b} value={b}>
                      {pretty(b)} ({c})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Price range */}
            <div style={S.group}>
              <span style={S.label}>Price</span>
              <input
                type="number"
                style={{ ...S.input, width: 100 }}
                value={minPrice}
                min={facets.priceMin}
                max={maxPrice || undefined}
                onChange={(e) => setMinPrice(Math.max(0, Number(e.target.value) || 0))}
                aria-label="Min price"
                placeholder={`${facets.priceMin}`}
              />
              <span>–</span>
              <input
                type="number"
                style={{ ...S.input, width: 100 }}
                value={maxPrice}
                min={minPrice || 0}
                max={facets.priceMax}
                onChange={(e) =>
                  setMaxPrice(Math.max(minPrice || 0, Number(e.target.value) || 0))
                }
                aria-label="Max price"
                placeholder={`${facets.priceMax}`}
              />
              {pricePresets.map(([a, b]) => (
                <button
                  key={`${a}-${b}`}
                  type="button"
                  style={S.chip(minPrice === a && maxPrice === b)}
                  onClick={() => {
                    setMinPrice(a);
                    setMaxPrice(b);
                  }}
                  aria-label={`Price ৳${a} to ৳${b}`}
                >
                  ৳{a}–{b}
                </button>
              ))}
            </div>

            {/* Stock / Discount */}
            <div style={S.group}>
              <span style={S.label}>Stock</span>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={onlyInStock}
                  onChange={(e) => setOnlyInStock(e.target.checked)}
                />
                Only in stock
              </label>
            </div>

            <div style={S.group}>
              <span style={S.label}>Discount</span>
              <input
                type="number"
                style={{ ...S.input, width: 80 }}
                value={minDiscount}
                min={0}
                max={90}
                onChange={(e) =>
                  setMinDiscount(Math.max(0, Math.min(90, Number(e.target.value) || 0)))
                }
                aria-label="Minimum discount percent"
                placeholder="0"
              />
              <span>%+</span>
            </div>

            {/* Color / Size visible but compact */}
            {facets.colors.length > 0 && (
              <div style={S.group}>
                <span style={S.label}>Color</span>
                {facets.colors.slice(0, 12).map(([c, n]) => (
                  <button
                    key={c}
                    type="button"
                    style={S.chip(colorSet.has(c))}
                    onClick={() => toggleSet(colorSet, c, setColorSet)}
                    title={pretty(c)}
                  >
                    {pretty(c)} <span style={S.badge}>{n}</span>
                  </button>
                ))}
                {facets.colors.length > 12 && (
                  <button
                    type="button"
                    style={S.linkBtn}
                    onClick={() => setShowMoreFilters((s) => !s)}
                  >
                    More…
                  </button>
                )}
              </div>
            )}

            {facets.sizes.length > 0 && (
              <div style={S.group}>
                <span style={S.label}>Size</span>
                {facets.sizes.slice(0, 12).map(([s, n]) => (
                  <button
                    key={s}
                    type="button"
                    style={S.chip(sizeSet.has(s))}
                    onClick={() => toggleSet(sizeSet, s, setSizeSet)}
                    title={s}
                  >
                    {s} <span style={S.badge}>{n}</span>
                  </button>
                ))}
                {facets.sizes.length > 12 && (
                  <button
                    type="button"
                    style={S.linkBtn}
                    onClick={() => setShowMoreFilters((s) => !s)}
                  >
                    More…
                  </button>
                )}
              </div>
            )}

            {/* utility mini-actions */}
            <div style={S.utilBar}>
              <button
                type="button"
                onClick={copyShareLink}
                style={S.linkBtn}
                title="Copy link of this view"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={clearAll}
                style={{ ...S.linkBtn, borderStyle: "dashed" }}
                title="Reset all filters"
              >
                Clear all
              </button>
            </div>
          </div>

          {/* “More filters” drawer */}
          {showMoreFilters && (
            <div
              role="region"
              aria-label="More filters"
              style={{
                marginTop: 8,
                padding: 14,
                border: "1px solid #e6e0cf",
                borderRadius: 18,
                background: "#fffdf7",
                boxShadow: "0 10px 28px rgba(8,21,64,.08)",
                display: "grid",
                gap: 12,
              }}
            >
              {/* Tags */}
              {facets.tags.length > 0 && (
                <div style={S.group}>
                  <span style={S.label}>Tags</span>
                  {facets.tags.slice(0, 24).map(([t, n]) => (
                    <button
                      key={t}
                      type="button"
                      style={S.chip(tagSet.has(t))}
                      onClick={() => toggleSet(tagSet, t, setTagSet)}
                      title={pretty(t)}
                    >
                      {pretty(t)} <span style={S.badge}>{n}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Remaining Colors */}
              {facets.colors.length > 12 && (
                <div style={S.group}>
                  <span style={S.label}>More Colors</span>
                  {facets.colors.slice(12).map(([c, n]) => (
                    <button
                      key={c}
                      type="button"
                      style={S.chip(colorSet.has(c))}
                      onClick={() => toggleSet(colorSet, c, setColorSet)}
                      title={pretty(c)}
                    >
                      {pretty(c)} <span style={S.badge}>{n}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Remaining Sizes */}
              {facets.sizes.length > 12 && (
                <div style={S.group}>
                  <span style={S.label}>More Sizes</span>
                  {facets.sizes.slice(12).map(([s, n]) => (
                    <button
                      key={s}
                      type="button"
                      style={S.chip(sizeSet.has(s))}
                      onClick={() => toggleSet(sizeSet, s, setSizeSet)}
                      title={s}
                    >
                      {s} <span style={S.badge}>{n}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* active filters row */}
        {activeChips.length > 0 && (
          <div style={S.activeRow} aria-label="Active filters">
            {activeChips.map((c, i) => (
              <span key={i} style={S.activeChip}>
                {c.v}
                <button
                  type="button"
                  aria-label={`Remove ${c.k}`}
                  onClick={() => {
                    if (c.k === "search") setSearch("");
                    if (c.k === "type") setTypeSel("");
                    if (c.k === "brand") setBrandSel("");
                    if (c.k === "stock") setOnlyInStock(false);
                    if (c.k === "discount") setMinDiscount(0);
                    if (c.k === "price") {
                      setMinPrice(facets.priceMin || 0);
                      setMaxPrice(facets.priceMax || 0);
                    }
                    if (c.k === "color") {
                      const next = new Set(colorSet);
                      next.delete(c.val);
                      setColorSet(next);
                    }
                    if (c.k === "size") {
                      const next = new Set(sizeSet);
                      next.delete(c.val);
                      setSizeSet(next);
                    }
                    if (c.k === "tag") {
                      const next = new Set(tagSet);
                      next.delete(c.val);
                      setTagSet(next);
                    }
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontWeight: 900,
                    color: "#0f2147",
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* count */}
        <div style={S.count}>
          Showing {Math.min(displayTarget, pageFiltered.length)} of {totalText} curated item
          {totalText === 1 ? "" : "s"}
        </div>

        {/* grid card */}
        <div style={S.gridCard}>
          {/* main render */}
          {loadingInitial && pageFiltered.length === 0 ? (
            <>
              {/* skeleton grid first (no blank, no blink), message appears only if slow */}
              <ul style={S.grid} aria-label="Loading products">
                {Array.from({ length: 12 }).map((_, i) => (
                  <li key={`sk-${i}`} style={S.skeleton} />
                ))}
              </ul>

              {showLoadingHint && (
                <div style={S.loadingRow}>
                  <span className="tdlsSpinner" aria-hidden="true" />
                  Curating your collection…
                </div>
              )}
            </>
          ) : pageFiltered.length === 0 && exhausted ? (
            <div
              style={{
                padding: 28,
                textAlign: "center",
                fontWeight: 700,
                color: "#7a6c4b",
                fontSize: 14,
              }}
            >
              No pieces match these filters right now.
              <br />
              Try relaxing one or two filters.
            </div>
          ) : (
            <>
              <ul style={S.grid}>
                {visible.map((p, idx) => (
                  <li key={stableKey(p, idx)}>
                    <ProductCard
                      product={p}
                      onQuickView={(prod) => {
                        setQuickProduct(prod || p);
                        setQuickOpen(true);
                      }}
                    />
                  </li>
                ))}

                {/* smooth loader placeholders at the end (prevents “grid blink”) */}
                {loadingMore &&
                  Array.from({ length: 6 }).map((_, i) => (
                    <li key={`more-sk-${i}`} style={S.skeleton} />
                  ))}
              </ul>

              {/* auto infinite loader sentinel */}
              <div ref={sentinelRef} style={{ height: 1 }} />

              {/* optional manual “boost” button (never required) */}
              {pageFiltered.length > visible.length && (
                <button
                  type="button"
                  onClick={() => setDisplayTarget((c) => c + DISPLAY_STEP)}
                  style={S.loadMore}
                >
                  Load next 100
                </button>
              )}

              {loadingMore && (
                <div style={S.loadingRow}>
                  <span className="tdlsSpinner" aria-hidden="true" />
                  Loading more…
                </div>
              )}

              {!!fetchError && (
                <div style={{ ...S.loadingRow, color: "#7a102b" }}>{fetchError}</div>
              )}
            </>
          )}
        </div>

        {/* Bottom floating bar */}
        <BottomFloatingBar />

        {/* Quick View */}
        <QuickView
          open={quickOpen}
          product={quickProduct}
          onClose={() => {
            setQuickOpen(false);
            setQuickProduct(null);
          }}
        />

        {/* Back-to-top */}
        {showTopBtn && (
          <button
            type="button"
            onClick={scrollToTop}
            style={S.topBtn}
            aria-label="Back to top"
          >
            ↑ TOP
          </button>
        )}
      </main>
    </div>
  );
}