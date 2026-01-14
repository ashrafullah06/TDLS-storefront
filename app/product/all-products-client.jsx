// FILE: app/product/all-products-client.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { FaShoppingCart, FaRegHeart } from "react-icons/fa";

import ProductCard from "@/components/common/productcard";
import QuickView from "@/components/common/quickview";
import { useCart as use_cart } from "@/components/common/cart_context";
import Navbar from "@/components/common/navbar";

// client-only to avoid RSC/static-flag issues
const BottomFloatingBar = dynamic(
  () => import("@/components/common/bottomfloatingbar"),
  { ssr: false }
);

/* ---------------- CLIENT-SAFE FETCH FALLBACK ---------------- */
async function fetchFromStrapi(path) {
  try {
    const res = await fetch(`/api/strapi?path=${encodeURIComponent(path)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchProductsClient() {
  // 🔐 Use the proxy and unwrap { ok, data } → Strapi payload → .data[]
  const json = await fetchFromStrapi("/products?populate=*");
  if (!json) return [];

  // Unwrap proxy envelope if present
  const payload = json?.ok ? json.data : json;

  // Strapi REST: { data: [...], meta: {...} }
  if (Array.isArray(payload?.data)) {
    return payload.data.map((n) =>
      n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n
    );
  }

  // Very defensive: if payload itself is already an array, just return it
  if (Array.isArray(payload)) return payload;

  return [];
}

/* ---------------- tolerant helpers ---------------- */
const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const get = (o, p) =>
  p
    ?.toString()
    .split(".")
    .reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);

// ✅ helper fixed earlier in your file – keep as is
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const toStr = (x) =>
  typeof x === "string"
    ? x
    : x?.name || x?.label || x?.slug || x?.value || x?.title || "";
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

const getSlugs = (rel) => {
  if (!rel) return [];

  // 1) Simple string: "men", "men,winter", or JSON '["men","winter"]'
  if (typeof rel === "string") {
    const raw = rel.trim();
    if (!raw) return [];

    // Try JSON array string first
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x)).filter(Boolean);
      }
    } catch {
      // not JSON, fall through
    }

    // Fallback: comma-separated list or single slug
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // 2) Array of strings/objects
  if (Array.isArray(rel)) {
    return rel
      .map((x) =>
        typeof x === "string"
          ? x
          : x?.slug || x?.attributes?.slug || x?.value || x?.name
      )
      .filter(Boolean);
  }

  // 3) Strapi-style relation: { data: [...] } or { data: {...} }
  const d = rel?.data;
  if (!d) return [];

  if (Array.isArray(d)) {
    return d
      .map(
        (x) => x?.attributes?.slug || x?.slug || x?.attributes?.name || x?.name
      )
      .filter(Boolean);
  }

  const one = d?.attributes?.slug || d?.slug || d?.attributes?.name || d?.name;
  return one ? [one] : [];
};

const hasSlug = (rel, slug) => {
  if (!slug) return false;
  const target = normSlug(slug);
  const list = getSlugs(rel).map(normSlug);
  return list.includes(target);
};

/* ------------ product field readers ------------ */
const readVariants = (p) => {
  const A = p?.attributes || {};
  let rawList = [];

  const pv = p?.product_variants || A?.product_variants;
  if (Array.isArray(pv?.data)) {
    rawList = pv.data.map((node) => {
      const attrs = node?.attributes || {};
      return { id: node.id, ...attrs };
    });
  } else if (Array.isArray(pv)) {
    rawList = pv.map((node) =>
      node && typeof node === "object"
        ? { id: node.id, ...(node.attributes || node) }
        : node
    );
  } else if (Array.isArray(p?.product_variant)) {
    rawList = p.product_variant;
  } else if (Array.isArray(p?.variants)) {
    rawList = p.variants;
  } else if (Array.isArray(A?.variants?.data)) {
    rawList = A.variants.data.map((n) => {
      const attrs = n?.attributes || {};
      return { id: n.id, ...attrs };
    });
  } else if (Array.isArray(A?.variants)) {
    rawList = A.variants;
  } else if (Array.isArray(A?.options)) {
    rawList = A.options;
  } else if (Array.isArray(A?.product_variant)) {
    rawList = A.product_variant;
  }

  const expanded = [];
  for (const raw of rawList) {
    const base = raw && typeof raw === "object" ? raw : {};
    const sizes = Array.isArray(base.sizes) ? base.sizes : null;

    if (sizes && sizes.length) {
      sizes.forEach((s) => {
        const merged = { ...base, ...s };

        if (!merged.size_name) {
          merged.size_name = s.size_name || s.size || s.label || s.value || null;
        }

        if (merged.price == null && merged.sale_price == null) {
          if (typeof s.effective_price === "number") merged.price = s.effective_price;
          else if (typeof s.price === "number") merged.price = s.price;
          else if (typeof s.price_override === "number") merged.price = s.price_override;
        }

        if (merged.compare_at_price == null && merged.mrp == null) {
          if (typeof s.effective_compare_at_price === "number")
            merged.compare_at_price = s.effective_compare_at_price;
          else if (typeof s.compare_at_price === "number")
            merged.compare_at_price = s.compare_at_price;
        }

        if (merged.stock == null && merged.stock_quantity == null) {
          if (typeof s.stock_quantity === "number") merged.stock = s.stock_quantity;
        }

        expanded.push(merged);
      });
    } else {
      const copy = { ...base };

      if (copy.price == null && copy.sale_price == null && copy.price_range) {
        const pr = copy.price_range;
        if (typeof pr.min === "number") copy.price = pr.min;
        else if (typeof pr.max === "number") copy.price = pr.max;
      }

      if (
        copy.stock == null &&
        copy.stock_quantity == null &&
        typeof copy.stock_total === "number"
      ) {
        copy.stock = copy.stock_total;
      }

      expanded.push(copy);
    }
  }

  return expanded;
};

const pickColorName = (v) =>
  v?.color_name ||
  v?.color?.name ||
  v?.color?.data?.attributes?.name ||
  (typeof v?.color === "string" ? v.color : null) ||
  v?.attributes?.color_name ||
  v?.attributes?.color?.name ||
  v?.attributes?.color;

const pickSizeName = (v) =>
  v?.size_name ||
  v?.size?.name ||
  v?.size?.data?.attributes?.name ||
  (typeof v?.size === "string" ? v.size : null) ||
  v?.attributes?.size_name ||
  v?.attributes?.size?.name;

const normVariants = (p) =>
  readVariants(p)
    .map((raw) => raw?.attributes || raw)
    .map((v) => ({
      color_name: pickColorName(v) || null,
      size_name: pickSizeName(v) || null,
      price:
        typeof v?.price === "number"
          ? v.price
          : typeof v?.sale_price === "number"
          ? v.sale_price
          : null,
      stock:
        Number(
          v?.stock ??
            v?.inventory ??
            v?.qty ??
            v?.quantity_available ??
            v?.attributes?.stock ??
            v?.attributes?.inventory
        ) || 0,
      weight_g:
        Number(
          v?.weight_g ??
            v?.weight ??
            (typeof v?.weight_kg === "number" ? v?.weight_kg * 1000 : undefined)
        ) || null,
      volume_ml:
        Number(
          v?.volume_ml ??
            v?.volume ??
            (typeof v?.volume_l === "number" ? v?.volume_l * 1000 : undefined)
        ) || null,
    }));

const fallbackColors = (p) => {
  const A = p?.attributes || {};
  const can =
    [p?.colors, A?.colors, A?.color_options, A?.color_names, get(A, "color.data")].flat?.() ||
    [];
  return (Array.isArray(can) ? can : []).map(toStr).filter(Boolean);
};
const fallbackSizes = (p) => {
  const A = p?.attributes || {};
  const can = [p?.sizes, A?.sizes, A?.size_options, A?.size_names].flat?.() || [];
  return (Array.isArray(can) ? can : []).map(toStr).filter(Boolean);
};

const priceOf = (p) => {
  const A = p?.attributes || {};

  const variants = normVariants(p);
  const vPrices = variants.map((v) => v.price).filter((n) => typeof n === "number");

  // TDLS / Strapi common fields
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
        p?.quantity_available ??
        A?.quantity_available ??
        p?.stock_total ??
        A?.stock_total
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

/* ------------ semantic derivations ------------ */
const deriveTypes = (p) => {
  const A = p?.attributes || {};
  const fromRel = getSlugs(p?.categories).concat(getSlugs(A?.categories));
  const fromSlugs = arr(p?.categories_slugs || A?.categories_slugs).map(normSlug);
  const extras = [A?.type, p?.type, A?.product_type, p?.product_type, A?.category, p?.category]
    .filter(Boolean)
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  return [...new Set([...fromRel, ...fromSlugs, ...extras])];
};
const deriveDepartments = (p) => {
  const A = p?.attributes || {};
  const d = [A?.department, p?.department, A?.departments, p?.departments, A?.category_tree, p?.category_tree]
    .flat()
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  return [...new Set(d)];
};
const deriveTags = (p) => {
  const A = p?.attributes || {};
  const events = getSlugs(p?.events_products_collections).concat(getSlugs(A?.events_products_collections));
  const audience = getSlugs(p?.audience_categories).concat(getSlugs(A?.audience_categories));
  const eventsSlugs = arr(p?.events_products_collections_slugs || A?.events_products_collections_slugs);
  const audienceSlugs = arr(p?.audience_categories_slugs || A?.audience_categories_slugs);
  const misc = [A?.season, p?.season, A?.tag, p?.tag, A?.badge, p?.badge, A?.labels, p?.labels]
    .flat()
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  return [...new Set([...events, ...eventsSlugs, ...audience, ...audienceSlugs, ...misc])];
};
const deriveBrand = (p) => {
  const A = p?.attributes || {};
  const b = [p?.brand, A?.brand, A?.brand_name, p?.brand_name, A?.vendor, p?.vendor]
    .map(toStr)
    .filter(Boolean);
  return b.length ? normSlug(b[0]) : "";
};
const deriveMaterial = (p) => {
  const A = p?.attributes || {};
  const m = [A?.material, p?.material, A?.materials, p?.materials, A?.composition, p?.composition]
    .flat()
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  return [...new Set(m)];
};
const deriveScentFlavor = (p) => {
  const A = p?.attributes || {};
  const s = [A?.scent, p?.scent, A?.flavor, p?.flavor, A?.fragrance, p?.fragrance]
    .flat()
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  return [...new Set(s)];
};
const deriveOrigin = (p) => {
  const A = p?.attributes || {};
  const o = [A?.origin, p?.origin, A?.country, p?.country, A?.country_of_origin, p?.country_of_origin, A?.made_in, p?.made_in]
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  return [...new Set(o)];
};
const deriveDietary = (p) => {
  const A = p?.attributes || {};
  const d = [A?.dietary, p?.dietary, A?.dietary_tags, p?.dietary_tags, A?.allergens_free, p?.allergens_free, A?.certifications, p?.certifications]
    .flat()
    .map(toStr)
    .filter(Boolean)
    .map(normSlug);
  const flags = [];
  const pushIf = (cond, slug) => cond && flags.push(slug);
  pushIf(A?.vegan || p?.vegan, "vegan");
  pushIf(A?.halal || p?.halal, "halal");
  pushIf(A?.vegetarian || p?.vegetarian, "vegetarian");
  pushIf(A?.organic || p?.organic, "organic");
  pushIf(A?.gluten_free || p?.gluten_free, "gluten-free");
  pushIf(A?.sugar_free || p?.sugar_free, "sugar-free");
  pushIf(A?.lactose_free || p?.lactose_free, "lactose-free");
  return [...new Set([...d, ...flags])];
};
const deriveFlags = (p) => {
  const A = p?.attributes || {};
  return {
    imported: !!(A?.imported || p?.imported || A?.is_imported || p?.is_imported),
    giftable: !!(A?.giftable || p?.giftable || A?.gift || p?.gift),
  };
};
const deriveRating = (p) => {
  const A = p?.attributes || {};
  const r =
    Number(
      p?.rating ??
        A?.rating ??
        p?.rating_average ??
        A?.rating_average ??
        p?.avg_rating ??
        A?.avg_rating
    ) || 0;
  const count =
    Number(
      p?.rating_count ??
        A?.rating_count ??
        p?.reviews_count ??
        A?.reviews_count
    ) || 0;
  return { rating: r, ratingCount: count };
};
const deriveUnitMetrics = (p) => {
  const A = p?.attributes || {};
  const v = normVariants(p);
  const vWeight = v.find((x) => x.weight_g)?.weight_g || null;
  const vVol = v.find((x) => x.volume_ml)?.volume_ml || null;
  const weight_g =
    vWeight ||
    Number(
      A?.weight_g ??
        p?.weight_g ??
        (typeof A?.weight_kg === "number" ? A?.weight_kg * 1000 : undefined) ??
        (typeof p?.weight_kg === "number" ? p?.weight_kg * 1000 : undefined)
    ) ||
    null;
  const volume_ml =
    vVol ||
    Number(
      A?.volume_ml ??
        p?.volume_ml ??
        (typeof A?.volume_l === "number" ? A?.volume_l * 1000 : undefined) ??
        (typeof p?.volume_l === "number" ? p?.volume_l * 1000 : undefined)
    ) ||
    null;
  const price = priceOf(p);
  const ppu =
    weight_g && price
      ? (price / weight_g) * 100
      : volume_ml && price
      ? (price / volume_ml) * 100
      : null;
  return { weight_g, volume_ml, pricePer100: ppu };
};

/* ---------------- component ---------------- */
export default function AllProductsClient({ products }) {
  const router = useRouter();
  const cart = use_cart?.();

  // responsive flags (client-only) to keep desktop unchanged
  const [isMobile, setIsMobile] = useState(false);
  const [viewportW, setViewportW] = useState(390);

  useEffect(() => {
    const mq =
      typeof window !== "undefined" ? window.matchMedia("(max-width: 768px)") : null;
    if (!mq) return;
    const apply = () => setIsMobile(!!mq.matches);
    apply();
    // Safari < 14 compatibility
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", apply);
      else mq.removeListener(apply);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportW(Math.max(280, Math.min(820, window.innerWidth || 390)));
    onResize();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // fallback client-fetch products if server didn't pass anything
  const [clientProducts, setClientProducts] = useState(null);
  const finalProducts = clientProducts ?? products ?? [];

  // Quick View
  const [qvOpen, setQvOpen] = useState(false);
  const [qvProduct, setQvProduct] = useState(null);

  const [showTopBtn, setShowTopBtn] = useState(false);
  const sentinelRef = useRef(null);

  // filters & UI state
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [minDiscount, setMinDiscount] = useState(0);
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0);

  const [typeSel, setTypeSel] = useState("");
  const [colorSet, setColorSet] = useState(() => new Set());
  const [sizeSet, setSizeSet] = useState(() => new Set());
  const [tagSet, setTagSet] = useState(() => new Set());

  const [brandSel, setBrandSel] = useState("");
  const [deptSel, setDeptSel] = useState("");
  const [materialSet, setMaterialSet] = useState(() => new Set());
  const [scentSet, setScentSet] = useState(() => new Set());
  const [originSet, setOriginSet] = useState(() => new Set());
  const [dietarySet, setDietarySet] = useState(() => new Set());
  const [flagImported, setFlagImported] = useState(false);
  const [flagGiftable, setFlagGiftable] = useState(false);
  const [minRating, setMinRating] = useState(0);

  const [visibleCount, setVisibleCount] = useState(24);
  const [drawerOpen, setDrawerOpen] = useState(false); // kept for future use

  // suggestions now state-based (to avoid hydration mismatch)
  const [suggestions, setSuggestions] = useState([]);

  // INLINE EXPAND (all screens): “Filters” expands in-place (no side panel, no overlay)
  const [filtersMounted, setFiltersMounted] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Scroll target: results area (CTA should direct here)
  const resultsTopRef = useRef(null);

  // ---------- client fallback fetch ----------
  useEffect(() => {
    if ((products && products.length) || clientProducts) return;
    let cancelled = false;
    (async () => {
      const list = await fetchProductsClient();
      if (!cancelled) {
        setClientProducts(Array.isArray(list) ? list : []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [products, clientProducts]);

  // ---------- GLOBAL FILTER ----------
  const globallyFiltered = useMemo(() => {
    if (!Array.isArray(finalProducts) || finalProducts.length === 0) return [];
    return finalProducts.filter((p) => !p.disable_frontend);
  }, [finalProducts]);

  /* ---------- dynamic facet discovery ---------- */
  const facets = useMemo(() => {
    const mapCount = () => new Map();

    const types = mapCount();
    const colors = mapCount();
    const sizes = mapCount();
    const tags = mapCount();
    const brands = mapCount();
    const departments = mapCount();
    const materials = mapCount();
    const scents = mapCount();
    const origins = mapCount();
    const dietary = mapCount();

    let priceMin = Infinity;
    let priceMax = 0;
    let hasPPU = false;
    let ratingMax = 0;

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

      deriveDepartments(p).forEach((d) => inc(departments, d));
      deriveMaterial(p).forEach((m) => inc(materials, m));
      deriveScentFlavor(p).forEach((s) => inc(scents, s));
      deriveOrigin(p).forEach((o) => inc(origins, o));
      deriveDietary(p).forEach((d) => inc(dietary, d));

      const price = priceOf(p);
      if (Number.isFinite(price)) {
        priceMin = Math.min(priceMin, price);
        priceMax = Math.max(priceMax, price);
      }
      const { pricePer100 } = deriveUnitMetrics(p);
      if (pricePer100 != null) hasPPU = true;

      const { rating } = deriveRating(p);
      ratingMax = Math.max(ratingMax, rating);
    });

    const sortEntries = (m) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return {
      types: sortEntries(types),
      colors: sortEntries(colors),
      sizes: sortEntries(sizes),
      tags: sortEntries(tags),
      brands: sortEntries(brands),
      departments: sortEntries(departments),
      materials: sortEntries(materials),
      scents: sortEntries(scents),
      origins: sortEntries(origins),
      dietary: sortEntries(dietary),
      priceMin: Number.isFinite(priceMin) ? priceMin : 0,
      priceMax: Number.isFinite(priceMax) ? priceMax : 0,
      hasPPU,
      ratingMax,
    };
  }, [globallyFiltered]);

  // hydrate/persist filters
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("all_products_filters_v5");
      if (!raw) return;
      const s = JSON.parse(raw) || {};
      setSearch(s.search || "");
      setSortBy(s.sortBy || "default");
      setOnlyInStock(!!s.onlyInStock);
      setMinDiscount(Number(s.minDiscount || 0));
      setMinPrice(Number(s.minPrice || 0));
      setMaxPrice(Number(s.maxPrice || 0));
      setTypeSel(s.typeSel || "");
      setColorSet(new Set(s.colors || []));
      setSizeSet(new Set(s.sizes || []));
      setTagSet(new Set(s.tags || []));
      setBrandSel(s.brandSel || "");
      setDeptSel(s.deptSel || "");
      setMaterialSet(new Set(s.materials || []));
      setScentSet(new Set(s.scents || []));
      setOriginSet(new Set(s.origins || []));
      setDietarySet(new Set(s.dietary || []));
      setFlagImported(!!s.flagImported);
      setFlagGiftable(!!s.flagGiftable);
      setMinRating(Number(s.minRating || 0));
      setVisibleCount(Number(s.visibleCount || 24));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "all_products_filters_v5",
        JSON.stringify({
          search,
          sortBy,
          onlyInStock,
          minDiscount,
          minPrice,
          maxPrice,
          typeSel,
          colors: [...colorSet],
          sizes: [...sizeSet],
          tags: [...tagSet],
          brandSel,
          deptSel,
          materials: [...materialSet],
          scents: [...scentSet],
          origins: [...originSet],
          dietary: [...dietarySet],
          flagImported,
          flagGiftable,
          minRating,
          visibleCount,
        })
      );
    } catch {}
  }, [
    search,
    sortBy,
    onlyInStock,
    minDiscount,
    minPrice,
    maxPrice,
    typeSel,
    colorSet,
    sizeSet,
    tagSet,
    brandSel,
    deptSel,
    materialSet,
    scentSet,
    originSet,
    dietarySet,
    flagImported,
    flagGiftable,
    minRating,
    visibleCount,
  ]);

  // initialize price range once facets known
  useEffect(() => {
    if (facets.priceMax && maxPrice === 0) setMaxPrice(facets.priceMax);
    if (minPrice === 0) setMinPrice(facets.priceMin || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets.priceMin, facets.priceMax]);

  // infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => e.isIntersecting && setVisibleCount((c) => c + 24)),
      { rootMargin: "600px 0px" }
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, []);

  // top button visibility
  useEffect(() => {
    const onScroll = () => setShowTopBtn(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: "smooth" }), []);

  const toggleSet = (setObj, value, setState) => {
    const next = new Set(setObj);
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
    setColorSet(new Set());
    setSizeSet(new Set());
    setTagSet(new Set());
    setBrandSel("");
    setDeptSel("");
    setMaterialSet(new Set());
    setOriginSet(new Set());
    setDietarySet(new Set());
    setFlagImported(false);
    setFlagGiftable(false);
    setMinRating(0);
    setVisibleCount(24);
  };

  // active filter chips
  const activeChips = useMemo(() => {
    const chips = [];
    if (isNonEmpty(search)) chips.push({ k: "search", v: search });
    if (typeSel) chips.push({ k: "type", v: pretty(typeSel) });
    if (brandSel) chips.push({ k: "brand", v: pretty(brandSel) });
    if (deptSel) chips.push({ k: "dept", v: pretty(deptSel) });
    if (onlyInStock) chips.push({ k: "stock", v: "In Stock" });
    if (minRating > 0) chips.push({ k: "rating", v: `${minRating}★+` });
    if (minDiscount > 0) chips.push({ k: "discount", v: `${minDiscount}%+` });
    if (minPrice > facets.priceMin || maxPrice < facets.priceMax)
      chips.push({ k: "price", v: `৳${minPrice}–${maxPrice}` });
    [...colorSet].forEach((c) => chips.push({ k: "color", v: pretty(c), val: c }));
    [...sizeSet].forEach((s) => chips.push({ k: "size", v: s, val: s }));
    [...materialSet].forEach((m) => chips.push({ k: "mat", v: pretty(m), val: m }));
    [...scentSet].forEach((f) => chips.push({ k: "scent", v: pretty(f), val: f }));
    [...originSet].forEach((o) => chips.push({ k: "origin", v: pretty(o), val: o }));
    [...dietarySet].forEach((d) => chips.push({ k: "diet", v: pretty(d), val: d }));
    if (flagImported) chips.push({ k: "imported", v: "Imported" });
    if (flagGiftable) chips.push({ k: "giftable", v: "Giftable" });
    [...tagSet].forEach((t) => chips.push({ k: "tag", v: pretty(t), val: t }));
    return chips;
  }, [
    search,
    typeSel,
    brandSel,
    deptSel,
    onlyInStock,
    minRating,
    minDiscount,
    minPrice,
    maxPrice,
    colorSet,
    sizeSet,
    materialSet,
    scentSet,
    originSet,
    dietarySet,
    flagImported,
    flagGiftable,
    tagSet,
    facets,
  ]);

  // A stable signature so “closing” behaves like an action (CTA) when something changed in the filters
  const filterSignature = useMemo(() => {
    const sortArr = (s) => [...s].map(String).sort();
    return JSON.stringify({
      search: String(search || ""),
      sortBy: String(sortBy || ""),
      onlyInStock: !!onlyInStock,
      minDiscount: Number(minDiscount || 0),
      minPrice: Number(minPrice || 0),
      maxPrice: Number(maxPrice || 0),
      typeSel: String(typeSel || ""),
      brandSel: String(brandSel || ""),
      deptSel: String(deptSel || ""),
      flagImported: !!flagImported,
      flagGiftable: !!flagGiftable,
      minRating: Number(minRating || 0),
      colors: sortArr(colorSet),
      sizes: sortArr(sizeSet),
      tags: sortArr(tagSet),
      materials: sortArr(materialSet),
      scents: sortArr(scentSet),
      origins: sortArr(originSet),
      dietary: sortArr(dietarySet),
    });
  }, [
    search,
    sortBy,
    onlyInStock,
    minDiscount,
    minPrice,
    maxPrice,
    typeSel,
    brandSel,
    deptSel,
    flagImported,
    flagGiftable,
    minRating,
    colorSet,
    sizeSet,
    tagSet,
    materialSet,
    scentSet,
    originSet,
    dietarySet,
  ]);

  const openSigRef = useRef(filterSignature);

  const getNavHeightPx = useCallback(() => {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--nav-h");
      const n = parseFloat(String(v || "").trim());
      if (Number.isFinite(n) && n > 0) return n;
    } catch {}
    return 88;
  }, []);

  const scrollToResults = useCallback(() => {
    if (typeof window === "undefined") return;
    const el = resultsTopRef.current;
    if (!el) return;
    const navH = getNavHeightPx();
    const y = el.getBoundingClientRect().top + window.scrollY - navH - 10;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }, [getNavHeightPx]);

  const openInlineFilters = useCallback(() => {
    openSigRef.current = filterSignature;
    setFiltersMounted(true);
    // double-rAF prevents “first paint jump” on some mobile browsers (iOS Safari esp.)
    requestAnimationFrame(() => requestAnimationFrame(() => setFiltersVisible(true)));
  }, [filterSignature]);

  const closeInlineFilters = useCallback(
    (asCTA = true) => {
      setFiltersVisible(false);

      const changed = openSigRef.current !== filterSignature;
      if (asCTA && changed) {
        window.setTimeout(() => {
          scrollToResults();
        }, 160);
      }

      // match the longer ease curve to avoid “snap off / jerk”
      window.setTimeout(() => {
        setFiltersMounted(false);
      }, 340);
    },
    [filterSignature, scrollToResults]
  );

  const toggleInlineFilters = useCallback(() => {
    if (filtersMounted) closeInlineFilters(true);
    else openInlineFilters();
  }, [filtersMounted, closeInlineFilters, openInlineFilters]);

  // close on ESC (all screens)
  useEffect(() => {
    if (!filtersMounted) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeInlineFilters(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersMounted, closeInlineFilters]);

  /* ---------- apply page-local filters ---------- */
  const pageFiltered = useMemo(() => {
    let list = globallyFiltered;

    if (isNonEmpty(search)) {
      const q = search.toLowerCase();
      list = list.filter((p) => {
        const A = p?.attributes || {};
        const name = (p?.name || A?.name || "").toLowerCase();
        const slug = (p?.slug || A?.slug || "").toLowerCase();
        const desc = (
          A?.short_description ||
          A?.description ||
          p?.short_description ||
          p?.description
        )
          ?.toString()
          .toLowerCase();
        const synonyms = { frocks: "dress", punjabi: "kurta", hoodie: "sweatshirt" };
        const qq = synonyms[q] || q;
        return name.includes(qq) || slug.includes(qq) || (desc || "").includes(qq);
      });
    }

    const getMeta = (p) => {
      const types = deriveTypes(p);
      const tags = deriveTags(p);
      const brand = deriveBrand(p);
      const departments = deriveDepartments(p);
      const mats = deriveMaterial(p);
      const scents = deriveScentFlavor(p);
      const origins = deriveOrigin(p);
      const diet = deriveDietary(p);
      const flags = deriveFlags(p);
      const rating = deriveRating(p);
      const variants = normVariants(p);

      const colors = new Set();
      variants.forEach((x) => x.color_name && colors.add(normSlug(String(x.color_name))));
      fallbackColors(p).forEach((c) => colors.add(normSlug(c)));

      const sizes = new Set();
      variants.forEach((x) => x.size_name && sizes.add(String(x.size_name)));
      fallbackSizes(p).forEach((s) => sizes.add(s));

      const price = priceOf(p);
      const ppu = deriveUnitMetrics(p).pricePer100;
      const A = p?.attributes || {};
      const name = p?.name || A?.name || "";
      return {
        types,
        tags,
        brand,
        departments,
        mats,
        scents,
        origins,
        diet,
        flags,
        rating: rating.rating,
        ratingCount: rating.ratingCount,
        colors,
        sizes,
        price,
        ppu,
        inStock: inStockOf(p),
        discount: discountPct(p),
        name,
      };
    };

    const meta = new Map(list.map((p) => [p, getMeta(p)]));

    if (typeSel) list = list.filter((p) => meta.get(p).types.includes(typeSel));
    if (colorSet.size)
      list = list.filter((p) => [...colorSet].some((c) => meta.get(p).colors.has(c)));
    if (sizeSet.size)
      list = list.filter((p) => [...sizeSet].some((s) => meta.get(p).sizes.has(s)));
    if (tagSet.size)
      list = list.filter((p) => [...tagSet].some((t) => meta.get(p).tags.includes(t)));

    if (brandSel) list = list.filter((p) => meta.get(p).brand === brandSel);
    if (deptSel) list = list.filter((p) => meta.get(p).departments.includes(deptSel));
    if (materialSet.size)
      list = list.filter((p) => meta.get(p).mats.some((m) => materialSet.has(m)));
    if (scentSet.size)
      list = list.filter((p) => meta.get(p).scents.some((s) => scentSet.has(s)));
    if (originSet.size)
      list = list.filter((p) => meta.get(p).origins.some((o) => originSet.has(o)));
    if (dietarySet.size)
      list = list.filter((p) => meta.get(p).diet.some((d) => dietarySet.has(d)));
    if (flagImported) list = list.filter((p) => meta.get(p).flags.imported);
    if (flagGiftable) list = list.filter((p) => meta.get(p).flags.giftable);
    if (minRating > 0) list = list.filter((p) => meta.get(p).rating >= minRating);

    list = list.filter((p) => {
      const pr = meta.get(p).price;
      return (minPrice ? pr >= minPrice : true) && (maxPrice ? pr <= maxPrice : true);
    });
    if (onlyInStock) list = list.filter((p) => meta.get(p).inStock);
    if (minDiscount > 0) list = list.filter((p) => meta.get(p).discount >= minDiscount);

    // deterministic sorts
    if (sortBy === "price-asc") {
      list = [...list].sort(
        (a, b) =>
          meta.get(a).price - meta.get(b).price ||
          meta.get(a).name.localeCompare(meta.get(b).name)
      );
    } else if (sortBy === "price-desc") {
      list = [...list].sort(
        (a, b) =>
          meta.get(b).price - meta.get(a).price ||
          meta.get(a).name.localeCompare(meta.get(b).name)
      );
    } else if (sortBy === "newest") {
      list = [...list].sort((a, b) => tsOf(b) - tsOf(a));
    } else if (sortBy === "best-rated") {
      list = [...list].sort(
        (a, b) =>
          meta.get(b).rating - meta.get(a).rating ||
          meta.get(a).name.localeCompare(meta.get(b).name)
      );
    } else if (sortBy === "ppu-asc") {
      list = [...list].sort((a, b) => {
        const A = meta.get(a).ppu ?? Infinity;
        const B = meta.get(b).ppu ?? Infinity;
        return A - B || meta.get(a).name.localeCompare(meta.get(b).name);
      });
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
    colorSet,
    sizeSet,
    tagSet,
    brandSel,
    deptSel,
    materialSet,
    scentSet,
    originSet,
    dietarySet,
    flagImported,
    flagGiftable,
    minRating,
  ]);

  /* ---------- suggestions (moved to useEffect for hydration safety) ---------- */
  useEffect(() => {
    if (!Array.isArray(globallyFiltered) || globallyFiltered.length === 0) {
      setSuggestions([]);
      return;
    }

    try {
      if (typeof window === "undefined") {
        setSuggestions([]);
        return;
      }

      let recent = [];
      try {
        const raw = window.localStorage.getItem("recently_viewed_v1") || "[]";
        recent = JSON.parse(raw) || [];
      } catch {
        recent = [];
      }

      const cartItems = Array.isArray(cart?.items) ? cart.items : [];

      const interestColors = new Set();
      const interestTypes = new Set();

      recent.forEach((r) => {
        if (r?.selectedColor) interestColors.add(String(r.selectedColor));
        if (r?.slug || r?.id) {
          const base = String(r.slug || "").split("-")[0] || "";
          if (base) interestTypes.add(base);
        }
      });

      cartItems.forEach((it) => {
        if (it?.color) interestColors.add(String(it.color));
        if (it?.slug) {
          const base = String(it.slug).split("-")[0] || "";
          if (base) interestTypes.add(base);
        }
      });

      const scored = globallyFiltered
        .map((p) => {
          const types = deriveTypes(p);
          const v = normVariants(p);
          const colors = new Set();
          v.forEach((x) => x.color_name && colors.add(String(x.color_name)));
          fallbackColors(p).forEach((c) => colors.add(String(c)));

          let score = 0;
          if ([...types].some((t) => interestTypes.has(t))) score += 1;
          if ([...colors].some((c) => interestColors.has(c))) score += 1;
          return { p, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((x) => x.p);

      setSuggestions(scored);
    } catch {
      setSuggestions([]);
    }
  }, [globallyFiltered, cart?.items]);

  /* ---------- responsive styles (mobile only) ---------- */
  const S = useMemo(() => {
    const mobile = isMobile;

    // extra compact scaling for small screens (keeps desktop 100% intact)
    const k = mobile ? Math.max(0.84, Math.min(1, viewportW / 390)) : 1;
    const px = (n) => Math.round(n * k);

    const scale = {
      title: mobile ? px(22) : 30,
      subtitle: mobile ? px(10) : 11,
      meta: mobile ? px(11) : 12,
      label: mobile ? px(10) : 11,
      inputFont: mobile ? px(12) : 13,
      selectFont: mobile ? px(12) : 13,
      controlH: mobile ? px(30) : 36, // tighter on mobile
      chipH: mobile ? px(28) : 32,
      chipFont: mobile ? px(11) : 12,
      gridMin: mobile ? Math.max(140, px(160)) : 250,
      gap: mobile ? px(12) : 20,
      topBtnBottom: mobile ? px(108) : 120,
      iconBtn: mobile ? px(44) : 52,
      iconIcon: mobile ? px(22) : 28,
      iconBadge: mobile ? px(18) : 22,
      iconBadgeFont: mobile ? px(10) : 11,
      iconDockRight: mobile ? px(12) : 24,
    };

    return {
      page: {
        width: "100%",
        maxWidth: "100vw",
        margin: "0 auto",
        paddingTop: mobile ? 18 : 40,
        paddingBottom: mobile ? 92 : 96,
        minHeight: "100vh",
        overflowX: "hidden", // ✅ hard stop: no horizontal page overflow
        overflowY: "visible",
        background:
          "radial-gradient(circle at top left,#e5e7eb 0,#f9fafb 45%,#f3f4f6 100%)",
      },
      container: {
        paddingLeft: mobile ? 12 : 0,
        paddingRight: mobile ? 12 : 0,
        maxWidth: "100%",
        overflowX: "hidden", // ✅ contain any wide children
      },
      titleRow: {
        display: "flex",
        alignItems: mobile ? "flex-start" : "flex-end",
        justifyContent: "space-between",
        gap: 18,
        marginBottom: 8,
        flexWrap: mobile ? "wrap" : "nowrap",
        maxWidth: "100%",
      },
      titleLeft: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        minWidth: 0,
        maxWidth: "100%",
      },
      backBtn: {
        height: mobile ? 34 : 38,
        width: mobile ? 34 : 38,
        borderRadius: "999px",
        border: "1px solid rgba(15,33,71,.14)",
        background: "#ffffff",
        cursor: "pointer",
        lineHeight: mobile ? "32px" : "36px",
        textAlign: "center",
        fontSize: mobile ? 16 : 18,
        boxShadow: "0 10px 26px rgba(15,33,71,.10)",
        color: "#0f2147",
        flexShrink: 0,
      },
      title: {
        fontFamily: "'Playfair Display', serif",
        fontWeight: 900,
        fontSize: scale.title,
        letterSpacing: ".18em",
        color: "#0f2147",
        textTransform: "uppercase",
      },
      subtitle: {
        fontSize: scale.subtitle,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        color: "#9ca3af",
        marginTop: 4,
      },

      taglineRow: {
        display: "flex",
        justifyContent: "flex-end",
        alignItems: mobile ? "flex-start" : "center",
        gap: mobile ? 10 : 16,
        marginBottom: 16,
        padding: mobile ? "12px 12px" : "14px 18px",
        borderRadius: 18,
        border: "1px solid rgba(15,33,71,.06)",
        background: "linear-gradient(135deg,rgba(15,33,71,.06),rgba(243,244,246,1))",
        boxShadow: "0 14px 32px rgba(15,33,71,.08)",
        flexDirection: "row",
        maxWidth: "100%",
        overflow: "hidden",
      },
      taglineMeta: {
        fontSize: scale.meta,
        color: "#6b7280",
        textAlign: "right",
        width: "auto",
      },
      taglineMetaHighlight: { fontWeight: 800, color: "#a67c37" },

      miniBar: {
        position: "sticky",
        top: "calc(var(--nav-h, 88px) + 8px)",
        zIndex: 6,
        marginBottom: 12,
        borderRadius: 16,
        border: "1px solid #dde3f4",
        background: "linear-gradient(135deg,#ffffff 0%,#f9fafb 45%,#edf2ff 100%)",
        boxShadow: "0 14px 28px rgba(15,33,71,.10)",
        padding: mobile ? "9px 9px" : "10px 12px",
        display: mobile ? "grid" : "flex",
        alignItems: mobile ? "stretch" : "center",
        gap: 10,
        flexWrap: mobile ? "unset" : "wrap",
        maxWidth: "100%",
        overflow: "hidden",
      },
      desktopRow: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        width: "100%",
        minWidth: 0,
      },
      mobileMiniRow: {
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 8,
        alignItems: "center",
        minWidth: 0,
      },
      mobileMiniRow2: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        alignItems: "center",
        minWidth: 0,
      },

      filtersBtn: {
        height: 33,
        padding: "0 12px",
        borderRadius: 12,
        border: "1px solid rgba(15,33,71,.18)",
        background: "linear-gradient(135deg,#0f2147,#111827)",
        color: "#f9fafb",
        fontWeight: 900,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        fontSize: 11,
        cursor: "pointer",
        whiteSpace: "nowrap",
      },
      filtersBtnGhost: {
        height: 33,
        padding: "0 12px",
        borderRadius: 12,
        border: "1px solid rgba(15,33,71,.18)",
        background: "linear-gradient(135deg,#ffffff,#f9fafb)",
        color: "#0f2147",
        fontWeight: 900,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        fontSize: 11,
        cursor: "pointer",
        whiteSpace: "nowrap",
      },

      inlineWrap: {
        borderRadius: 18,
        border: "1px solid rgba(15,33,71,.10)",
        background: "linear-gradient(180deg,#ffffff 0%,#f9fafb 60%,#f3f4f6 100%)",
        boxShadow: "0 18px 44px rgba(15,33,71,.12)",
        overflow: "hidden",
        marginBottom: 14,
        maxWidth: "100%",
        contain: "layout paint", // ✅ reduces reflow “jerk” on open/close
      },

      // smoother + no snap: longer curve + stable maxHeight + hidden overflow
      inlinePanel: {
        maxHeight: filtersVisible
          ? mobile
            ? "calc(100dvh - var(--nav-h, 88px) - 170px)" // ✅ slightly more compact vertically
            : "calc(100dvh - var(--nav-h, 88px) - 190px)"
          : 0,
        opacity: filtersVisible ? 1 : 0,
        transform: filtersVisible ? "translateY(0)" : "translateY(-8px)",
        transition:
          "max-height .34s cubic-bezier(.2,.9,.2,1), opacity .22s ease, transform .26s cubic-bezier(.2,.9,.2,1)",
        willChange: "max-height, opacity, transform",
        overflow: "hidden",
      },

      inlineHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: mobile ? "9px 10px" : "12px 12px", // ✅ less vertical space
        borderBottom: "1px solid rgba(15,33,71,.10)",
        background: "linear-gradient(135deg,#ffffff,#f6f7fb)",
        maxWidth: "100%",
      },
      inlineTitle: {
        fontWeight: 900,
        color: "#0f2147",
        letterSpacing: ".16em",
        textTransform: "uppercase",
        fontSize: mobile ? 11 : 12,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },

      inlineBody: {
        padding: mobile ? "8px 8px" : "10px 10px", // ✅ less vertical space
        overflowY: "auto",
        overflowX: "hidden", // ✅ stop any body-wide horizontal overflow
        WebkitOverflowScrolling: "touch",
        maxHeight: mobile
          ? "calc(100dvh - var(--nav-h, 88px) - 170px - 50px - 58px)" // header+footer smaller
          : "calc(100dvh - var(--nav-h, 88px) - 190px - 56px - 66px)",
      },

      // Premium horizontal filter rail — safe on any width (incl. landscape)
      rail: {
        width: "100%",
        maxWidth: "100%",
        display: "flex",
        alignItems: "center",
        gap: mobile ? 8 : 10,
        flexWrap: "nowrap",
        overflowX: "auto",
        overflowY: "hidden",
        paddingBottom: 6,
        WebkitOverflowScrolling: "touch",
        scrollBehavior: "smooth",
        overscrollBehaviorX: "contain",
      },

      railGroup: {
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap", // ✅ allows safe wrap inside group on ultra-small widths
        rowGap: 6,
        padding: mobile ? "6px 8px" : "8px 12px", // ✅ tighter
        borderRadius: 14,
        border: "1px solid rgba(15,33,71,.12)",
        background: "linear-gradient(135deg,#ffffff,#f9fafb)",
        boxShadow: "0 10px 22px rgba(15,33,71,.07)",
        minWidth: mobile ? 180 : 240, // ✅ smaller baseline
        maxWidth: mobile ? "min(84vw, 320px)" : "min(78vw, 420px)", // ✅ never forces page overflow
        boxSizing: "border-box",
      },
      railGroupWide: {
        minWidth: mobile ? 200 : 360,
        maxWidth: mobile ? "min(92vw, 360px)" : "min(78vw, 520px)",
      },
      railLabel: {
        fontSize: mobile ? 10 : 11,
        fontWeight: 900,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: ".18em",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      },
      railControl: {
        height: mobile ? 30 : 34, // ✅ tighter
        borderRadius: 12,
        border: "1px solid #cfd6e9",
        padding: "0 10px",
        background: "#fff",
        fontWeight: 800,
        color: "#0f2147",
        fontFeatureSettings: "'tnum' 1",
        fontSize: mobile ? 12 : 13,
        minWidth: 0, // ✅ critical for flex overflow safety
        flex: "1 1 140px",
        maxWidth: "100%",
        boxSizing: "border-box",
      },
      railControlSmall: {
        flex: "1 1 90px",
        minWidth: 0,
        width: "auto",
        maxWidth: 120,
      },

      railChipsBlock: {
        width: "100%",
        maxWidth: "100%",
        marginTop: mobile ? 8 : 10, // ✅ slightly tighter
        borderRadius: 16,
        border: "1px solid rgba(15,33,71,.10)",
        background: "linear-gradient(180deg,#ffffff,#f6f7fb)",
        boxShadow: "0 14px 30px rgba(15,33,71,.08)",
        padding: mobile ? "8px 8px" : "10px 10px", // ✅ tighter
        overflow: "hidden",
      },
      railChipsTitleRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 8,
      },
      railChipsTitle: {
        fontWeight: 900,
        color: "#0f2147",
        letterSpacing: ".14em",
        textTransform: "uppercase",
        fontSize: mobile ? 10 : 12,
      },
      railChipsRow: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "nowrap",
        overflowX: "auto",
        overflowY: "hidden",
        paddingBottom: 4,
        WebkitOverflowScrolling: "touch",
        maxWidth: "100%",
        overscrollBehaviorX: "contain",
      },

      inlineFooter: {
        position: "sticky",
        bottom: 0,
        padding: mobile ? "8px 8px" : "10px 10px", // ✅ tighter
        borderTop: "1px solid rgba(15,33,71,.10)",
        background: "linear-gradient(135deg,#ffffff,#f6f7fb)",
        display: "flex",
        gap: 8,
        alignItems: "center",
        maxWidth: "100%",
      },
      inlineFooterMeta: {
        flex: 1,
        minWidth: 0,
        color: "#334155",
        fontWeight: 800,
        fontSize: 11,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },

      label: {
        fontSize: scale.label,
        fontWeight: 800,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: ".18em",
      },

      select: {
        height: scale.controlH,
        borderRadius: 12,
        border: "1px solid #cfd6e9",
        padding: "0 10px",
        background: "#fff",
        fontWeight: 700,
        color: "#0f2147",
        minWidth: mobile ? "100%" : 150,
        fontSize: scale.selectFont,
        width: mobile ? "100%" : "auto",
        maxWidth: "100%",
        boxSizing: "border-box",
      },

      input: {
        height: scale.controlH,
        borderRadius: 12,
        border: "1px solid #cfd6e9",
        padding: "0 10px",
        background: "#fff",
        fontWeight: 700,
        color: "#0f2147",
        minWidth: mobile ? "100%" : 120,
        fontFeatureSettings: "'tnum' 1",
        fontSize: scale.inputFont,
        width: mobile ? "100%" : "auto",
        maxWidth: "100%",
        boxSizing: "border-box",
      },

      chip: (active) => ({
        height: scale.chipH,
        padding: "0 10px",
        borderRadius: 999,
        border: active ? "2px solid #0f2147" : "1px solid #cfd6e9",
        background: active ? "linear-gradient(135deg,#0f2147,#111827)" : "#ffffff",
        color: active ? "#f9fafb" : "#16224a",
        fontWeight: 800,
        cursor: "pointer",
        fontSize: scale.chipFont,
        letterSpacing: ".04em",
        boxShadow: active
          ? "0 10px 24px rgba(15,33,71,.22)"
          : "0 2px 4px rgba(15,33,71,.03)",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
      }),

      badge: {
        marginLeft: 6,
        fontSize: mobile ? 9 : 10,
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(15,33,71,.06)",
        color: "#111827",
        fontWeight: 800,
      },

      activeRow: {
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        margin: "0 0 16px",
        maxWidth: "100%",
      },
      activeChip: {
        height: mobile ? 28 : 30,
        padding: "0 10px",
        borderRadius: 999,
        border: "1px solid rgba(15,33,71,.12)",
        background: "linear-gradient(135deg,rgba(15,33,71,1),rgba(17,24,39,1))",
        color: "#f9fafb",
        fontWeight: 800,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: mobile ? 10 : 11,
        maxWidth: "100%",
      },

      grid: {
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill,minmax(${scale.gridMin}px,1fr))`,
        gap: scale.gap,
        maxWidth: "100%",
      },

      linkBtn: {
        height: scale.chipH,
        padding: "0 10px",
        borderRadius: 12,
        border: "1px solid rgba(15,33,71,.18)",
        background: "linear-gradient(135deg,#ffffff,#f9fafb)",
        fontWeight: 800,
        color: "#0f2147",
        cursor: "pointer",
        fontSize: mobile ? 11 : 12,
        width: mobile ? "100%" : "auto",
        maxWidth: "100%",
      },

      topBtn: {
        position: "fixed",
        right: mobile ? 12 : 16,
        bottom: scale.topBtnBottom,
        zIndex: 20,
        height: mobile ? 38 : 40,
        padding: mobile ? "0 12px" : "0 14px",
        borderRadius: 14,
        border: "1px solid #cfd6e9",
        background: "linear-gradient(135deg,#ffffff,#f3f4f6)",
        fontWeight: 900,
        color: "#0f2147",
        cursor: "pointer",
        boxShadow: "0 12px 30px rgba(15,33,71,.18)",
        fontSize: mobile ? 12 : 13,
      },

      iconDock: {
        position: "fixed",
        top: "calc(var(--nav-h, 88px) + 48px)",
        right: scale.iconDockRight,
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none",
      },
      iconBtn: {
        pointerEvents: "auto",
        width: scale.iconBtn,
        height: scale.iconBtn,
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
        touchAction: "manipulation",
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
        minWidth: scale.iconBadge,
        height: scale.iconBadge,
        borderRadius: 999,
        background: "#0f2147",
        color: "#f9fafb",
        fontSize: scale.iconBadgeFont,
        fontWeight: 800,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 6px",
      },
      iconSizeCart: scale.iconIcon,
      iconSizeHeart: mobile ? 20 : 24,
    };
  }, [isMobile, viewportW, filtersVisible]);

  const pricePresets = useMemo(() => {
    const lo = facets.priceMin || 0;
    const hi = facets.priceMax || 0;
    if (hi <= lo) return [];
    const span = hi - lo;
    const step = Math.max(500, Math.round((span / 4 / 100)) * 100);
    return [
      [lo, lo + step],
      [lo + step, lo + step * 2],
      [lo + step * 2, lo + step * 3],
      [lo + step * 3, hi],
    ];
  }, [facets.priceMin, facets.priceMax]);

  const copyShareLink = () => {
    try {
      navigator.clipboard.writeText(window.location.href);
    } catch {}
  };

  const total = pageFiltered.length;
  const visible = pageFiltered.slice(0, visibleCount);

  const cartCount = Array.isArray(cart?.items) ? cart.items.length : 0;

  // simple hover state to avoid inline onMouseOver hacks
  const [hoverWhich, setHoverWhich] = useState(null);

  const activeCount = activeChips.length;

  // ✅ Rebuilt: expanded filters are a compact horizontal bar/rail (not stacked left column)
  const renderFullFilterControls = (forMobileCtx) => {
    const mobileCtx = !!forMobileCtx;

    return (
      <>
        <div style={S.rail} aria-label="Filter controls rail">
          {/* Search */}
          <div style={{ ...S.railGroup, ...S.railGroupWide }}>
            <span style={S.railLabel}>Search</span>
            <input
              style={S.railControl}
              type="search"
              value={search}
              placeholder="Search…"
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search products"
            />
          </div>

          {/* Sort */}
          <div style={S.railGroup}>
            <span style={S.railLabel}>Sort</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={S.railControl}
              aria-label="Sort products"
            >
              <option value="default">Curated</option>
              <option value="newest">Newest</option>
              <option value="price-asc">Price ↑</option>
              <option value="price-desc">Price ↓</option>
              <option value="best-rated">Best rated</option>
              {facets.hasPPU && <option value="ppu-asc">Unit price ↑</option>}
            </select>
          </div>

          {/* Type */}
          <div style={S.railGroup}>
            <span style={S.railLabel}>Type</span>
            <select
              value={typeSel}
              onChange={(e) => setTypeSel(e.target.value)}
              style={S.railControl}
              aria-label="Type"
            >
              <option value="">All</option>
              {facets.types.map(([t, c]) => (
                <option key={t} value={t}>
                  {pretty(t)} ({c})
                </option>
              ))}
            </select>
          </div>

          {/* Brand */}
          {facets.brands.length > 0 && (
            <div style={S.railGroup}>
              <span style={S.railLabel}>Brand</span>
              <select
                value={brandSel}
                onChange={(e) => setBrandSel(e.target.value)}
                style={S.railControl}
                aria-label="Brand"
              >
                <option value="">All</option>
                {facets.brands.map(([b, c]) => (
                  <option key={b} value={b}>
                    {pretty(b)} ({c})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Department */}
          {facets.departments?.length > 0 && (
            <div style={S.railGroup}>
              <span style={S.railLabel}>Dept</span>
              <select
                value={deptSel}
                onChange={(e) => setDeptSel(e.target.value)}
                style={S.railControl}
                aria-label="Department"
              >
                <option value="">All</option>
                {facets.departments.map(([d, c]) => (
                  <option key={d} value={d}>
                    {pretty(d)} ({c})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Price */}
          <div style={S.railGroup}>
            <span style={S.railLabel}>Price</span>
            <input
              type="number"
              style={S.railControlSmall}
              value={minPrice}
              min={facets.priceMin}
              max={maxPrice || undefined}
              onChange={(e) => setMinPrice(Math.max(0, Number(e.target.value) || 0))}
              aria-label="Min price"
            />
            <span style={{ fontWeight: 900, color: "#0f2147" }}>–</span>
            <input
              type="number"
              style={S.railControlSmall}
              value={maxPrice}
              min={minPrice || 0}
              max={facets.priceMax}
              onChange={(e) => setMaxPrice(Math.max(minPrice || 0, Number(e.target.value) || 0))}
              aria-label="Max price"
            />
          </div>

          {/* Stock */}
          <div style={S.railGroup}>
            <span style={S.railLabel}>Stock</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#0f2147", fontWeight: 800 }}>
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={(e) => setOnlyInStock(e.target.checked)}
              />
              Only
            </label>
          </div>

          {/* Discount */}
          <div style={S.railGroup}>
            <span style={S.railLabel}>Off</span>
            <input
              type="number"
              style={S.railControlSmall}
              value={minDiscount}
              min={0}
              max={90}
              onChange={(e) => setMinDiscount(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
              aria-label="Minimum discount percent"
            />
            <span style={{ fontWeight: 900, color: "#0f2147" }}>%+</span>
          </div>

          {/* Rating */}
          {facets.ratingMax > 0 && (
            <div style={S.railGroup}>
              <span style={S.railLabel}>Rate</span>
              <input
                type="number"
                style={S.railControlSmall}
                value={minRating}
                min={0}
                max={5}
                step={0.5}
                onChange={(e) => setMinRating(Math.max(0, Math.min(5, Number(e.target.value) || 0)))}
                aria-label="Minimum rating"
              />
              <span style={{ fontWeight: 900, color: "#0f2147" }}>★+</span>
            </div>
          )}

          {/* Utilities */}
          <div style={S.railGroup}>
            <button type="button" onClick={copyShareLink} style={S.filtersBtnGhost} title="Copy link of this view">
              Copy link
            </button>
            <button
              type="button"
              onClick={clearAll}
              style={{ ...S.filtersBtnGhost, borderStyle: "dashed" }}
              title="Reset all filters"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* Price presets as a horizontal strip */}
        {pricePresets.length > 0 && (
          <div style={S.railChipsBlock} aria-label="Price presets">
            <div style={S.railChipsTitleRow}>
              <div style={S.railChipsTitle}>Price presets</div>
            </div>
            <div style={S.railChipsRow}>
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
          </div>
        )}

        {/* Colors + Sizes as horizontal strips (no stacked left columns) */}
        {facets.colors.length > 0 && (
          <div style={S.railChipsBlock} aria-label="Colors">
            <div style={S.railChipsTitleRow}>
              <div style={S.railChipsTitle}>Colors</div>
            </div>
            <div style={S.railChipsRow}>
              {facets.colors.slice(0, mobileCtx ? 14 : 18).map(([c, n]) => (
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
          </div>
        )}

        {facets.sizes.length > 0 && (
          <div style={S.railChipsBlock} aria-label="Sizes">
            <div style={S.railChipsTitleRow}>
              <div style={S.railChipsTitle}>Sizes</div>
            </div>
            <div style={S.railChipsRow}>
              {facets.sizes.slice(0, mobileCtx ? 14 : 18).map(([s, n]) => (
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
          </div>
        )}
      </>
    );
  };

  return (
    <>
      <Navbar />

      {/* Page-local hardening against horizontal overflow without changing other pages */}
      <style jsx global>{`
        .all-products-page {
          overflow-x: hidden;
          max-width: 100vw;
        }
        .all-products-page * {
          box-sizing: border-box;
        }
      `}</style>

      {/* Floating minimal cart & wishlist icons */}
      <div style={S.iconDock} aria-label="Cart and wishlist">
        <button
          type="button"
          style={{ ...S.iconBtn, ...(hoverWhich === "cart" ? S.iconBtnHover : null) }}
          onMouseEnter={() => setHoverWhich("cart")}
          onMouseLeave={() => setHoverWhich(null)}
          onClick={() => router.push("/cart")}
          aria-label="Open cart"
        >
          <FaShoppingCart size={S.iconSizeCart} color="#0c2340" />
          {cartCount > 0 && <span style={S.iconBadge}>{cartCount}</span>}
        </button>

        <button
          type="button"
          style={{ ...S.iconBtn, ...(hoverWhich === "wishlist" ? S.iconBtnHover : null) }}
          onMouseEnter={() => setHoverWhich("wishlist")}
          onMouseLeave={() => setHoverWhich(null)}
          onClick={() => router.push("/wishlist")}
          aria-label="Open wishlist"
        >
          <FaRegHeart size={S.iconSizeHeart} color="#7a102b" />
        </button>
      </div>

      <main className="all-products-page" style={S.page}>
        <div style={S.container}>
          {/* Header row */}
          <div style={S.titleRow}>
            <div style={S.titleLeft}>
              <button type="button" aria-label="Back" onClick={() => router.back()} style={S.backBtn}>
                ←
              </button>
              <div style={{ minWidth: 0 }}>
                <h1 style={S.title}>All Products</h1>
                <div style={S.subtitle}>CURATED BY THE DNA LAB CLOTHING</div>
              </div>
            </div>
          </div>

          {/* Tagline / hero microcopy */}
          <section style={S.taglineRow}>
            <div style={S.taglineMeta}>
              <div>
                Total catalogue <span style={S.taglineMetaHighlight}>{total}</span>
              </div>
              <div>Refined filters for mood, size and stories.</div>
            </div>
          </section>

          {/* FILTERS (ALL SCREENS): compact bar + inline expand (no side panel, no overlay) */}
          <div style={S.miniBar} role="region" aria-label="Filters">
            {!isMobile ? (
              <div style={S.desktopRow}>
                <input
                  style={{ ...S.input, minWidth: 260, flex: "1 1 320px" }}
                  type="search"
                  value={search}
                  placeholder="Search products…"
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search products"
                />

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={{ ...S.select, minWidth: 190 }}
                  aria-label="Sort products"
                >
                  <option value="default">Curated Default</option>
                  <option value="newest">Newest</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="price-desc">Price: High → Low</option>
                  <option value="best-rated">Best rated</option>
                  {facets.hasPPU && <option value="ppu-asc">Price per unit ↑</option>}
                </select>

                <button
                  type="button"
                  style={S.filtersBtn}
                  onClick={toggleInlineFilters}
                  aria-label="Toggle filters"
                  title="Toggle filters"
                >
                  {filtersMounted ? "Hide" : "Filters"}
                  {activeCount > 0 ? ` (${activeCount})` : ""}
                </button>

                <button
                  type="button"
                  style={S.filtersBtnGhost}
                  onClick={() => {
                    clearAll();
                    window.setTimeout(() => scrollToResults(), 80);
                  }}
                  aria-label="Clear all filters"
                  title="Reset all filters"
                >
                  Clear
                </button>

                {activeCount > 0 && (
                  <button
                    type="button"
                    style={S.filtersBtnGhost}
                    onClick={scrollToResults}
                    aria-label="View results"
                    title="Jump to results"
                  >
                    View results ({total})
                  </button>
                )}
              </div>
            ) : (
              <>
                <div style={S.mobileMiniRow}>
                  <input
                    style={S.input}
                    type="search"
                    value={search}
                    placeholder="Search products…"
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search products"
                  />
                  <button
                    type="button"
                    style={S.filtersBtn}
                    onClick={toggleInlineFilters}
                    aria-label="Toggle filters"
                    title="Toggle filters"
                  >
                    {filtersMounted ? "Hide" : "Filters"}
                    {activeCount > 0 ? ` (${activeCount})` : ""}
                  </button>
                </div>

                <div style={S.mobileMiniRow2}>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    style={S.select}
                    aria-label="Sort products"
                  >
                    <option value="default">Curated</option>
                    <option value="newest">Newest</option>
                    <option value="price-asc">Price ↑</option>
                    <option value="price-desc">Price ↓</option>
                    <option value="best-rated">Best rated</option>
                    {facets.hasPPU && <option value="ppu-asc">Unit price ↑</option>}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      clearAll();
                      window.setTimeout(() => scrollToResults(), 80);
                    }}
                    style={S.filtersBtnGhost}
                    aria-label="Clear all filters"
                    title="Reset all filters"
                  >
                    Clear
                  </button>
                </div>

                {activeCount > 0 && (
                  <button
                    type="button"
                    onClick={scrollToResults}
                    style={{ ...S.filtersBtnGhost, width: "100%" }}
                    aria-label="View filtered results"
                    title="Jump to results"
                  >
                    View results ({total})
                  </button>
                )}
              </>
            )}
          </div>

          {filtersMounted && (
            <div style={S.inlineWrap} role="region" aria-label="Expanded filters">
              <div style={S.inlinePanel}>
                <div style={S.inlineHeader}>
                  <div style={S.inlineTitle}>
                    Filters{activeCount > 0 ? ` (${activeCount})` : ""}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={clearAll}
                      style={S.filtersBtnGhost}
                      aria-label="Clear all filters"
                      title="Reset all filters"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => closeInlineFilters(true)}
                      style={S.filtersBtnGhost}
                      aria-label="Hide filters"
                      title="Hide"
                    >
                      Hide
                    </button>
                  </div>
                </div>

                <div style={S.inlineBody}>{renderFullFilterControls(isMobile)}</div>

                {/* Sticky footer CTA: hide is part of the filtering flow */}
                <div style={S.inlineFooter}>
                  <div style={S.inlineFooterMeta}>
                    Showing {total} result{total === 1 ? "" : "s"}
                  </div>

                  <button
                    type="button"
                    style={S.filtersBtnGhost}
                    onClick={() => closeInlineFilters(true)}
                    aria-label="Hide filters"
                    title="Hide"
                  >
                    Hide
                  </button>

                  <button
                    type="button"
                    style={S.filtersBtn}
                    onClick={() => closeInlineFilters(true)}
                    aria-label="Show results"
                    title="Show results"
                  >
                    Show {total}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active chips */}
          {activeChips.length > 0 && (
            <div style={S.activeRow} aria-label="Active filters">
              {activeChips.map((c, i) => (
                <span key={i} style={S.activeChip} title={c.v}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: isMobile ? "72vw" : "none",
                    }}
                  >
                    {c.v}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${c.k}`}
                    onClick={() => {
                      if (c.k === "search") setSearch("");
                      if (c.k === "type") setTypeSel("");
                      if (c.k === "brand") setBrandSel("");
                      if (c.k === "dept") setDeptSel("");
                      if (c.k === "stock") setOnlyInStock(false);
                      if (c.k === "rating") setMinRating(0);
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
                      if (c.k === "mat") {
                        const next = new Set(materialSet);
                        next.delete(c.val);
                        setMaterialSet(next);
                      }
                      if (c.k === "scent") {
                        const next = new Set(scentSet);
                        next.delete(c.val);
                        setScentSet(next);
                      }
                      if (c.k === "origin") {
                        const next = new Set(originSet);
                        next.delete(c.val);
                        setOriginSet(next);
                      }
                      if (c.k === "diet") {
                        const next = new Set(dietarySet);
                        next.delete(c.val);
                        setDietarySet(next);
                      }
                      if (c.k === "imported") setFlagImported(false);
                      if (c.k === "giftable") setFlagGiftable(false);
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
                      color: "#f9fafb",
                      flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* CTA anchor for “Show results” / “Hide = apply” */}
          <div ref={resultsTopRef} style={{ height: 1 }} />

          {/* Count */}
          <div
            style={{
              marginBottom: 12,
              color: "#6b7280",
              fontWeight: 700,
              fontSize: isMobile ? 12 : 13,
            }}
          >
            Showing {Math.min(visibleCount, total)} of {total} item{total === 1 ? "" : "s"}
          </div>

          {/* Grid */}
          {total === 0 ? (
            <div style={{ color: "#6b7280", fontSize: isMobile ? 13 : 14 }}>
              No products match these filters.
            </div>
          ) : (
            <ul style={S.grid}>
              {visible.map((p, idx) => (
                <li key={p.id ?? p.slug ?? p?.attributes?.slug ?? `idx-${idx}`}>
                  <ProductCard
                    product={p}
                    onQuickView={(prod) => {
                      setQvProduct(prod || p);
                      setQvOpen(true);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          {/* infinite sentinel */}
          {visibleCount < total && <div ref={sentinelRef} style={{ height: 1 }} />}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <>
              <h2
                style={{
                  marginTop: 28,
                  marginBottom: 10,
                  fontWeight: 900,
                  color: "#0f2147",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  fontSize: isMobile ? 14 : 16,
                }}
              >
                Suggestions For You
              </h2>
              <ul
                style={{
                  display: "grid",
                  gridAutoFlow: "column",
                  gridAutoColumns: `minmax(${isMobile ? 160 : 200}px, 1fr)`,
                  overflowX: "auto",
                  gap: isMobile ? 10 : 12,
                  paddingBottom: 6,
                  WebkitOverflowScrolling: "touch",
                }}
              >
                {suggestions.map((p, idx) => (
                  <li key={`sugg-${p.id ?? p.slug ?? p?.attributes?.slug ?? idx}`}>
                    <ProductCard
                      product={p}
                      onQuickView={(prod) => {
                        setQvProduct(prod || p);
                        setQvOpen(true);
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <BottomFloatingBar />

        {/* Quick View */}
        <QuickView
          open={qvOpen}
          product={qvProduct}
          onClose={() => {
            setQvOpen(false);
            setQvProduct(null);
          }}
        />

        {/* Back-to-top */}
        {showTopBtn && (
          <button type="button" onClick={scrollToTop} style={S.topBtn} aria-label="Back to top">
            ↑ Top
          </button>
        )}
      </main>
    </>
  );
}
