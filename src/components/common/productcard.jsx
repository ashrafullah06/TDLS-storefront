// FILE: src/components/common/productcard.jsx
"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useCart as use_cart } from "@/components/common/cart_context";
import styles from "./productcard.module.css";

/* ---------------- helpers (copied from quickview) ---------------- */
const ABS = (u) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const base =
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.STRAPI_API_URL ||
    "";
  return base
    ? `${base.replace(/\/+$/, "")}${u.startsWith("/") ? "" : "/"}${u}`
    : u;
};

const get = (o, p) =>
  p
    ?.toString()
    .split(".")
    .reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

const money = (c, v) => {
  const sym =
    {
      BDT: "৳",
      USD: "$",
      EUR: "€",
      GBP: "£",
    }[(c || "BDT").toUpperCase()] || `${c} `;
  return v == null ? "Price unavailable" : `${sym}${v}`;
};

/* ---- tier text helpers (aligned with QuickView) ---- */
const slugToLabel = (slug) => {
  if (!slug) return "";
  return slug
    .toString()
    .split(/[-_]+/g)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join(" ")
    .trim();
};

/**
 * Keep wording as in Strapi, only add "TDLS" if missing.
 * Same logic as QuickView.formatTierText
 */
const formatTierText = (tierLabel, brandTierSlug) => {
  const core = (
    tierLabel ||
    (brandTierSlug ? slugToLabel(brandTierSlug) : "") ||
    ""
  ).trim();

  if (!core) return null;

  const alreadyPrefixed = /^tdls\b/i.test(core);
  const finalText = alreadyPrefixed ? core : `TDLS ${core}`;

  return finalText;
};

/* ---- read variants (same as quickview) ---- */
const readVariants = (p) => {
  const A = p?.attributes || {};

  // Preferred: product_variants relation
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

  // Legacy: product_variant (singular)
  const pvLegacy = p?.product_variant || A?.product_variant;
  if (Array.isArray(pvLegacy?.data)) {
    return pvLegacy.data.map((node) => {
      const attrs = node?.attributes || {};
      return { id: node.id, ...attrs };
    });
  }
  if (Array.isArray(pvLegacy)) {
    return pvLegacy.map((node) =>
      node && typeof node === "object"
        ? { id: node.id, ...(node.attributes || node) }
        : node
    );
  }

  // Other legacy shapes
  if (Array.isArray(p?.variants)) return p.variants;
  if (Array.isArray(A?.variants)) return A.variants;
  if (Array.isArray(A?.variants?.data)) {
    return A.variants.data.map((node) => {
      const attrs = node?.attributes || {};
      return { id: node.id, ...attrs };
    });
  }
  if (Array.isArray(A?.options)) return A.options;

  return [];
};

const fallbackColors = (p) => {
  const A = p?.attributes || {};
  const candidates =
    [
      p?.colors,
      A?.colors,
      A?.color_options,
      A?.color_names,
      get(A, "color.data"),
    ].flat?.() || [];
  return (Array.isArray(candidates) ? candidates : [])
    .map((c) =>
      typeof c === "string"
        ? { name: c, code: c }
        : {
            name: c?.name || c?.label || "",
            code: c?.hex || c?.code || c?.name || "",
          }
    )
    .filter((x) => x.name);
};

const fallbackSizes = (p) => {
  const A = p?.attributes || {};
  const candidates =
    [p?.sizes, A?.sizes, A?.size_options, A?.size_names].flat?.() || [];
  return (Array.isArray(candidates) ? candidates : [])
    .map((s) => (typeof s === "string" ? s : s?.name || s?.label))
    .filter(Boolean);
};

/* ---------------- social-friendly / share-only og image (exclude from carousel) ---------------- */
const readOgImage = (p) => {
  const A = p?.attributes || {};
  return (
    get(p, "og_image_Social_Media.data.attributes.url") ||
    get(A, "og_image_Social_Media.data.attributes.url") ||
    null
  );
};

const collectImages = (p, variants, selectedColor) => {
  const s = new Set();
  const add = (u) => u && s.add(ABS(u));
  const addData = (arr) =>
    Array.isArray(arr) && arr.forEach((n) => add(n?.attributes?.url));

  // generic / legacy
  add(p?.image);
  Array.isArray(p?.images) && p.images.forEach((x) => add(x?.url || x));
  addData(p?.images?.data);
  add(get(p, "gallery.url"));
  addData(get(p, "gallery.data"));
  add(get(p, "cover.data.attributes.url"));
  // NOTE: og_image_Social_Media excluded from carousel (share/metadata only)

  const A = p?.attributes || {};
  add(A?.image);
  Array.isArray(A?.images) && A.images.forEach((x) => add(x?.url || x));
  addData(A?.images?.data);
  add(get(A, "gallery.url"));
  addData(A?.gallery?.data);
  add(get(A, "cover.data.attributes.url"));

  // flat cover_image + gallery URL array
  if (p?.cover_image) add(p.cover_image);
  if (Array.isArray(p?.gallery)) p.gallery.forEach((u) => add(u));
  if (A?.cover_image) add(A.cover_image);
  if (Array.isArray(A?.gallery)) A.gallery.forEach((u) => add(u));

  variants.forEach((v) => {
    if (v.image && (!selectedColor || v.color_name === selectedColor)) add(v.image);
  });

  return [...s];
};

/**
 * Normalize variants – EXACT copy from quickview
 */
const normalizeVariants = (p) => {
  const base = readVariants(p);
  const A = p?.attributes || {};

  const codes = p?.codes || A?.codes || {};
  const product_code = codes?.product_code || null;
  const base_sku = codes?.base_sku || null;
  const product_barcode = codes?.barcode || null;

  if (base.length) {
    const flattened = [];

    base.forEach((v) => {
      const sizes = Array.isArray(v?.sizes) ? v.sizes : null;

      const color_name =
        v?.color_name ||
        v?.color?.name ||
        v?.color?.data?.attributes?.name ||
        v?.color ||
        null;
      const color_code =
        v?.color_code || v?.color?.hex || v?.color?.data?.attributes?.hex || null;

      const variantImg =
        get(v, "image.data.attributes.url") || v?.image?.url || v?.image || null;

      const variantMinPrice =
        typeof v?.price === "number"
          ? v.price
          : typeof v?.price_range?.min === "number"
          ? v.price_range.min
          : null;

      const variantStockTotal =
        typeof v?.stockAvailable === "number"
          ? v.stockAvailable
          : typeof v?.stock_total === "number"
          ? v.stock_total
          : typeof v?.stock === "number"
          ? v.stock
          : typeof v?.stock_quantity === "number"
          ? v.stock_quantity
          : typeof v?.inventory === "number"
          ? v.inventory
          : null;

      const pv_id = v?.id || v?.variantId || v?.variant_id || null;
      const pv_prisma_id = v?.prisma_id || v?.pid || v?.variant_pid || null;

      if (sizes && sizes.length) {
        sizes.forEach((sz) => {
          if (!sz) return;

          const size_name = sz?.size_name || sz?.name || sz?.label || null;

          const price =
            typeof sz?.effective_price === "number"
              ? sz.effective_price
              : typeof sz?.price_override === "number"
              ? sz.price_override
              : typeof sz?.price === "number"
              ? sz.price
              : variantMinPrice;

          const stock =
            typeof sz?.stockAvailable === "number"
              ? sz.stockAvailable
              : typeof sz?.stock_quantity === "number"
              ? sz.stock_quantity
              : typeof sz?.stock === "number"
              ? sz.stock
              : typeof sz?.inventory === "number"
              ? sz.inventory
              : variantStockTotal;

          const img =
            get(sz, "image.data.attributes.url") ||
            sz?.image?.url ||
            sz?.image ||
            variantImg;

          const size_stock_id = sz?.id || null;
          const sku = sz?.sku || v?.sku || null;
          const barcode = sz?.barcode || v?.barcode || null;

          const sz_prisma_id =
            sz?.prisma_id || sz?.pid || sz?.variant_pid || pv_prisma_id || null;

          flattened.push({
            color_name,
            color_code,
            size_name,
            image: img ? ABS(img) : null,
            price,
            stock,

            id: size_stock_id || pv_id || null,
            pv_id,
            size_id: size_stock_id,
            size_stock_id,
            sku,
            barcode,
            pid: sz_prisma_id,
            prisma_id: sz_prisma_id,

            product_code,
            base_sku,
            product_barcode,
          });
        });
      } else {
        const size_name =
          v?.size_name ||
          v?.size?.name ||
          v?.size?.data?.attributes?.name ||
          v?.size ||
          null;

        const sku = v?.sku || null;
        const barcode = v?.barcode || null;
        const pv_prisma = pv_prisma_id;

        flattened.push({
          color_name,
          color_code,
          size_name,
          image: variantImg ? ABS(variantImg) : null,
          price: variantMinPrice,
          stock: variantStockTotal,

          id: pv_id || null,
          pv_id,
          size_id: null,
          size_stock_id: null,
          sku,
          barcode,
          pid: pv_prisma,
          prisma_id: pv_prisma,
          product_code,
          base_sku,
          product_barcode,
        });
      }
    });

    if (flattened.length) return flattened;
  }

  // Fallback synth
  const colors = fallbackColors(p);
  const sizes = fallbackSizes(p);
  if (colors.length || sizes.length) {
    const combos = [];
    const imgs = collectImages(p, [], null);

    const A2 = p?.attributes || {};

    const basePrice =
      (typeof p?.price_sale === "number"
        ? p.price_sale
        : typeof A2?.price_sale === "number"
        ? A2.price_sale
        : typeof p?.price_mrp === "number"
        ? p.price_mrp
        : typeof A2?.price_mrp === "number"
        ? A2.price_mrp
        : typeof p?.price_range?.min === "number"
        ? p.price_range.min
        : typeof A2?.price_range?.min === "number"
        ? A2.price_range.min
        : null) ??
      (typeof p?.price === "number"
        ? p.price
        : typeof A2?.price === "number"
        ? A2.price
        : typeof p?.discount_price === "number"
        ? p.discount_price
        : typeof A2?.discount_price === "number"
        ? A2.discount_price
        : typeof p?.base_price === "number"
        ? p.base_price
        : typeof A2?.base_price === "number"
        ? A2.base_price
        : null);

    const productCodes2 = p?.codes || p?.attributes?.codes || {};
    const product_code = productCodes2?.product_code || null;
    const base_sku = productCodes2?.base_sku || null;
    const product_barcode = productCodes2?.barcode || null;

    if (colors.length && sizes.length) {
      colors.forEach((c) =>
        sizes.forEach((s) =>
          combos.push({
            color_name: c.name,
            color_code: c.code,
            size_name: s,
            image: imgs[0] || null,
            price: basePrice,
            stock: null,
            id: null,
            pv_id: null,
            size_id: null,
            size_stock_id: null,
            sku: null,
            barcode: null,
            pid: null,
            prisma_id: null,
            product_code,
            base_sku,
            product_barcode,
          })
        )
      );
    } else if (colors.length) {
      colors.forEach((c) =>
        combos.push({
          color_name: c.name,
          color_code: c.code,
          size_name: null,
          image: imgs[0] || null,
          price: basePrice,
          stock: null,
          id: null,
          pv_id: null,
          size_id: null,
          size_stock_id: null,
          sku: null,
          barcode: null,
          pid: null,
          prisma_id: null,
          product_code,
          base_sku,
          product_barcode,
        })
      );
    } else {
      sizes.forEach((s) =>
        combos.push({
          color_name: null,
          color_code: null,
          size_name: s,
          image: imgs[0] || null,
          price: basePrice,
          stock: null,
          id: null,
          pv_id: null,
          size_id: null,
          size_stock_id: null,
          sku: null,
          barcode: null,
          pid: null,
          prisma_id: null,
          product_code,
          base_sku,
          product_barcode,
        })
      );
    }
    return combos;
  }

  return [];
};

const derivePrice = (product, variants, sel) => {
  const A = product?.attributes || {};

  const basePrice =
    (typeof product?.price_sale === "number"
      ? product.price_sale
      : typeof A?.price_sale === "number"
      ? A.price_sale
      : typeof product?.price_mrp === "number"
      ? product.price_mrp
      : typeof A?.price_mrp === "number"
      ? A.price_mrp
      : typeof product?.price_range?.min === "number"
      ? product.price_range.min
      : typeof A?.price_range?.min === "number"
      ? A.price_range.min
      : null) ??
    (typeof product?.price === "number"
      ? product.price
      : typeof A?.price === "number"
      ? A.price
      : typeof product?.discount_price === "number"
      ? product.discount_price
      : typeof A?.discount_price === "number"
      ? A.discount_price
      : typeof product?.base_price === "number"
      ? product.base_price
      : typeof A?.base_price === "number"
      ? A.base_price
      : null);

  const current =
    variants.find(
      (v) =>
        (!sel.color || v.color_name === sel.color) &&
        (!sel.size || v.size_name === sel.size)
    ) || variants[0];

  let price = current?.price ?? null;
  if (price == null) {
    const nums = variants.map((v) => v.price).filter((n) => typeof n === "number");
    if (nums.length) price = Math.min(...nums);
  }
  if (price == null && basePrice != null) price = basePrice;
  return price;
};

const deriveStock = (product, variants, sel) => {
  const A = product?.attributes || {};
  const pStock =
    (typeof product?.stock_total === "number"
      ? product.stock_total
      : typeof A?.stock_total === "number"
      ? A.stock_total
      : null) ??
    (typeof product?.stock_quantity === "number"
      ? product.stock_quantity
      : typeof A?.stock_quantity === "number"
      ? A.stock_quantity
      : typeof product?.inventory === "number"
      ? product.inventory
      : typeof A?.inventory === "number"
      ? A.inventory
      : null);

  if (!variants.length) return pStock;

  const candidates = variants.filter(
    (v) =>
      (!sel.color || v.color_name === sel.color) &&
      (!sel.size || v.size_name === sel.size)
  );

  const pool = candidates.length ? candidates : variants;

  const stocks = pool
    .map((v) =>
      typeof v.stockAvailable === "number"
        ? v.stockAvailable
        : typeof v.stock === "number"
        ? v.stock
        : typeof v.stock_quantity === "number"
        ? v.stock_quantity
        : typeof v.inventory === "number"
        ? v.inventory
        : null
    )
    .filter((n) => typeof n === "number");

  if (stocks.length) {
    return stocks.reduce((sum, n) => sum + n, 0);
  }

  return pStock;
};

const pickVariantForSelection = (variants, selection) => {
  if (!Array.isArray(variants) || !variants.length) return null;
  const byColor = selection?.color
    ? variants.filter((v) => v.color_name === selection.color)
    : variants;
  const bySize = selection?.size
    ? byColor.filter((v) => v.size_name === selection.size)
    : byColor;
  return bySize[0] || byColor[0] || variants[0] || null;
};

/* -------- color utils for premium swatches -------- */
const isLightColor = (codeRaw) => {
  if (!codeRaw) return false;
  const code = String(codeRaw).trim().toLowerCase();

  // Named light colors
  if (
    [
      "white",
      "offwhite",
      "off white",
      "ivory",
      "cream",
      "creme",
      "beige",
      "eggshell",
      "pearl",
    ].some((k) => code.includes(k))
  ) {
    return true;
  }

  // Hex colors
  const hexMatch = code.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hexMatch) return false;

  let hex = hexMatch[1];
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.8; // very light tones
};

/* ---------------- responsive sizing (desktop unchanged) ---------------- */
const clampScale = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function useUiScale() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth || 1024;
      const h = window.innerHeight || 768;
      const minSide = Math.min(w, h);

      // Desktop stays 1. Mobile/small screens reduce.
      let s = 1;

      // Small phones
      if (minSide <= 360) s = 0.86;
      else if (minSide <= 390) s = 0.9;
      else if (minSide <= 430) s = 0.93;
      else if (minSide <= 520) s = 0.96;

      // Landscape phone: tighten a bit more for height constraints
      const isLandscape = w > h && h <= 480;
      if (isLandscape) s = Math.min(s, 0.9);

      setScale(clampScale(s, 0.82, 1));
    };

    apply();
    window.addEventListener("resize", apply, { passive: true });
    window.addEventListener("orientationchange", apply, { passive: true });
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  return scale;
}

/* ---------------- social sharing helpers ---------------- */
const enc = (v) => encodeURIComponent(String(v ?? ""));

const addUtm = (url, params) => {
  const u = String(url || "").trim();
  if (!u) return "";
  try {
    // Works for absolute URLs; for relative URLs, fall back to manual append.
    const parsed = new URL(
      u,
      typeof window !== "undefined" ? window.location.origin : "https://example.com"
    );
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v == null || v === "") return;
      parsed.searchParams.set(k, String(v));
    });
    // If input was relative, URL() will output absolute with example origin; preserve original when relative:
    const isAbsolute = /^https?:\/\//i.test(u);
    if (isAbsolute) return parsed.toString();
    // Strip origin to keep relative style (but still include query)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    // Very defensive fallback (no throw)
    const joiner = u.includes("?") ? "&" : "?";
    const q = Object.entries(params || {})
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return q ? `${u}${joiner}${q}` : u;
  }
};

const buildShareLinks = (url, text) => {
  const u = String(url || "").trim();
  const t = String(text || "").trim();
  return {
    whatsapp: `https://wa.me/?text=${enc(`${t} ${u}`.trim())}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}`,
    x: `https://twitter.com/intent/tweet?text=${enc(t)}&url=${enc(u)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(u)}`,
  };
};

const copyToClipboard = async (text) => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}

  // Fallback
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch (_) {
    return false;
  }
};

/* ---------------- price range helpers ---------------- */
const getVariantPriceRange = (variants, sel) => {
  if (!Array.isArray(variants) || !variants.length)
    return { min: null, max: null, hasRange: false };

  const pool = variants.filter((v) => {
    if (sel?.color && v.color_name && v.color_name !== sel.color) return false;
    if (sel?.size && v.size_name && v.size_name !== sel.size) return false;
    return true;
  });

  const use = pool.length ? pool : variants;
  const nums = use
    .map((v) => v?.price)
    .filter((n) => typeof n === "number" && isFinite(n));

  if (!nums.length) return { min: null, max: null, hasRange: false };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return { min, max, hasRange: min !== max };
};

/* ---------------- component ---------------- */
export default function ProductCard({ product, onQuickView, siteBaseUrl }) {
  const cartCtx = use_cart();

  const uiScale = useUiScale();

  const [idx, setIdx] = useState(0);
  const [selection, setSelection] = useState({ color: null, size: null });
  const [error, setError] = useState(null); // inline validation message

  // Share UI
  const [shareOpen, setShareOpen] = useState(false);
  const [shareToast, setShareToast] = useState(null);
  const sharePanelRef = useRef(null);
  const shareBtnRef = useRef(null);
  const firstShareLinkRef = useRef(null);

  const mediaRef = useRef(null);

  const variants = useMemo(() => (product ? normalizeVariants(product) : []), [product]);

  const colors = useMemo(() => {
    const keys = variants.map((v) =>
      v.color_name ? `${v.color_name}::${v.color_code || ""}` : null
    );
    return uniq(keys)
      .map((k) => {
        const [n, code] = (k || "").split("::");
        return n ? { name: n, code: code || n } : null;
      })
      .filter(Boolean);
  }, [variants]);

  const sizes = useMemo(() => {
    const pool = selection.color
      ? variants.filter((v) => v.color_name === selection.color)
      : variants;
    return uniq(pool.map((v) => v.size_name));
  }, [variants, selection.color]);

  const requiresColor = colors.length > 0;
  const requiresSize = sizes.length > 0;

  // per-size stock map (for chips) respecting current color
  const sizeStockMap = useMemo(() => {
    const m = new Map();
    variants.forEach((v) => {
      const sizeName = v.size_name;
      if (!sizeName) return;
      if (selection.color && v.color_name && v.color_name !== selection.color) return;
      const val =
        typeof v.stockAvailable === "number"
          ? v.stockAvailable
          : typeof v.stock === "number"
          ? v.stock
          : typeof v.stock_quantity === "number"
          ? v.stock_quantity
          : typeof v.inventory === "number"
          ? v.inventory
          : null;
      if (val == null) return;
      const prev = m.get(sizeName) ?? 0;
      m.set(sizeName, prev + val);
    });
    return m;
  }, [variants, selection.color]);

  const images = useMemo(
    () => (product ? collectImages(product, variants, selection.color) : []),
    [product, variants, selection.color]
  );

  const ogImageForShare = useMemo(() => {
    const u = product ? readOgImage(product) : null;
    return u ? ABS(u) : null;
  }, [product]);

  const currencyCode = (
    product?.price_currency ||
    product?.attributes?.price_currency ||
    product?.currency ||
    product?.attributes?.currency ||
    "BDT"
  ).toUpperCase();

  const price = useMemo(
    () => (product ? derivePrice(product, variants, selection) : null),
    [product, variants, selection]
  );
  const stock = useMemo(
    () => (product ? deriveStock(product, variants, selection) : null),
    [product, variants, selection]
  );

  const priceRange = useMemo(
    () => getVariantPriceRange(variants, selection),
    [variants, selection]
  );

  const name =
    product?.name ||
    product?.attributes?.name ||
    product?.title ||
    product?.attributes?.title ||
    "Product";
  const slug = product?.slug || product?.attributes?.slug || "";

  const productCodes = product?.codes || product?.attributes?.codes || {};
  const productCode = productCodes?.product_code || null;
  const baseSku = productCodes?.base_sku || null;
  const productBarcode = productCodes?.barcode || null;

  const selectedVariant = useMemo(
    () => pickVariantForSelection(variants, selection),
    [variants, selection]
  );

  /* ---- Tier (compatible with QuickView) ---- */
  const tiers = product?.brand_tiers_slugs || product?.attributes?.brand_tiers_slugs || [];
  const brandTierSlug = Array.isArray(tiers) && tiers.length ? tiers[0] : null;

  const tierLabelRaw =
    product?.tier ||
    product?.attributes?.tier ||
    product?.attributes?.tier_label ||
    product?.attributes?.tierLabel ||
    product?.attributes?.pricing_tier ||
    product?.attributes?.pricingTier ||
    (brandTierSlug ? brandTierSlug.replace(/[-_]+/g, " ") : null) ||
    null;

  const tierLabel = tierLabelRaw ? String(tierLabelRaw).trim() : null;
  const tierText = formatTierText(tierLabel, brandTierSlug);

  // Reset selection whenever product/variants change
  useEffect(() => {
    setSelection({ color: null, size: null });
    setError(null);
    setIdx(0);
    setShareOpen(false);
  }, [product, variants.length]);

  // keyboard nav for images
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onKey = (e) => {
      if (e.key === "ArrowLeft" && images.length > 1)
        setIdx((i) => (i - 1 + images.length) % images.length);
      if (e.key === "ArrowRight" && images.length > 1)
        setIdx((i) => (i + 1) % images.length);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [images.length]);

  // preload next image
  useEffect(() => {
    if (images.length > 1) {
      const pre = new Image();
      pre.src = images[(idx + 1) % images.length];
    }
  }, [idx, images]);

  /* ---------------- selection + stock guards ---------------- */
  const ensureSelection = () => {
    if (requiresColor && !selection.color) {
      setError("Please select a color before adding to cart.");
      return { ok: false };
    }
    if (requiresSize && !selection.size) {
      setError("Please select a size before adding to cart.");
      return { ok: false };
    }
    return { ok: true };
  };

  const ensureInStock = () => {
    if (stock != null && stock <= 0) {
      setError("This item is currently out of stock.");
      return { ok: false };
    }
    return { ok: true };
  };

  const handleAddToCart = () => {
    setError(null); // fresh state

    const selCheck = ensureSelection();
    if (!selCheck.ok) return;

    const stockCheck = ensureInStock();
    if (!stockCheck.ok) return;

    const qty = 1;
    if (stock != null && qty > stock) {
      setError(`Only ${stock} piece(s) available in stock for this selection.`);
      return;
    }

    const chosen = pickVariantForSelection(variants, selection);
    if (!chosen) {
      setError("No valid variant found for this selection.");
      return;
    }

    const A = product?.attributes || {};

    const fabric =
      product?.fabric ||
      A?.fabric ||
      A?.material ||
      chosen?.fabric ||
      chosen?.material ||
      null;

    const gsm = product?.gsm || A?.gsm || A?.GSM || chosen?.gsm || chosen?.GSM || null;

    const fit = product?.fit || A?.fit || A?.fit_type || chosen?.fit || null;

    const sizeStockId = chosen?.size_stock_id || chosen?.size_id || chosen?.id || null;

    const variantPrismaId = chosen?.prisma_id || chosen?.pid || chosen?.variant_pid || null;

    const sku = chosen?.sku || baseSku || null;
    const barcode = chosen?.barcode || productBarcode || null;

    const pidExternal =
      productCode ||
      A?.documentId ||
      A?.uuid ||
      slug ||
      (product?.id != null ? String(product.id) : null);

    const vidExternal =
      variantPrismaId || sku || (sizeStockId != null ? String(sizeStockId) : null);

    const maxAvailable = typeof stock === "number" && stock > 0 ? stock : null;

    const metadata = {
      productCode,
      baseSku,
      productBarcode,

      productId: pidExternal,
      variantId: vidExternal,
      variantPrismaId: variantPrismaId || null,
      sizeStockId,

      fabric,
      gsm,
      fit,

      size: selection.size || chosen.size_name || null,
      color: selection.color || chosen.color_name || null,
      selectedSize: selection.size || null,
      selectedColor: selection.color || null,

      sku,
      barcode,
      variantSku: sku,
      variantBarcode: barcode,

      maxAvailable,
      stock: maxAvailable,

      // keep in sync with QuickView metadata
      tier: tierLabel,
      tierSlug: brandTierSlug || null,
    };

    const line = {
      productId: product.id || product?.attributes?.id || slug || name,
      slug,
      name,
      image: images[0],
      price: Number(price) || 0,
      currency: currencyCode,

      size: metadata.size,
      color: metadata.color,
      selectedColor: selection.color || null,
      selectedSize: selection.size || null,

      quantity: qty,

      productCode,
      baseSku,
      productBarcode,

      variantId: sizeStockId ? String(sizeStockId) : null,
      variantPrismaId,
      sizeStockId,

      sku,
      barcode,
      variantSku: sku,
      variantBarcode: barcode,

      maxAvailable,
      stock: maxAvailable,

      metadata,
    };

    if (cartCtx?.add) {
      cartCtx.add(line);
    } else if (cartCtx?.addItem) {
      cartCtx.addItem(line);
    } else if (cartCtx?.dispatch) {
      cartCtx.dispatch({ type: "ADD", payload: line });
    }

    setError(null); // clear error after successful add
    // ✅ Still only the global cart; no separate minicart.
  };

  /* ---------------- social share ---------------- */
  const productPath = slug ? `/product/${slug}` : "";

  // IMPORTANT: deterministic base for SSR/CSR (no window-based branching during render)
  const stableBase = useMemo(() => {
    const fromProp = String(siteBaseUrl || "").trim();
    const fromEnv = String(process.env.NEXT_PUBLIC_SITE_URL || "").trim();
    const base = (fromProp || fromEnv || "").replace(/\/+$/, "");
    return base;
  }, [siteBaseUrl]);

  // Deterministic canonical (absolute when base exists, otherwise relative)
  const canonicalUrl = useMemo(() => {
    if (!productPath) return stableBase || "";
    return stableBase ? `${stableBase}${productPath}` : productPath;
  }, [stableBase, productPath]);

  const shareText = useMemo(() => {
    const t = tierText ? `${name} — ${tierText}` : name;
    return String(t || "TDLS Product").trim();
  }, [name, tierText]);

  const shareUrlWithUtm = useMemo(() => {
    const base = canonicalUrl || productPath;
    return addUtm(base, {
      utm_source: "share",
      utm_medium: "productcard",
      utm_campaign: "tdls",
    });
  }, [canonicalUrl, productPath]);

  const shareLinks = useMemo(() => buildShareLinks(shareUrlWithUtm, shareText), [
    shareUrlWithUtm,
    shareText,
  ]);

  const handleShare = useCallback(async () => {
    setError(null);

    const url =
      shareUrlWithUtm ||
      (typeof window !== "undefined" ? window.location?.origin + productPath : productPath);

    const payload = { title: name, text: shareText, url };

    // Prefer native share on mobile
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function" && url) {
        await navigator.share(payload);
        setShareOpen(false);
        return;
      }
    } catch (_) {
      // user cancelled or unsupported; fall back to panel
    }

    // Fallback panel
    setShareOpen((v) => !v);
  }, [shareUrlWithUtm, productPath, name, shareText]);

  const handleCopyLink = useCallback(async () => {
    const url =
      shareUrlWithUtm ||
      (typeof window !== "undefined" ? window.location?.origin + productPath : productPath);

    if (!url) return;

    const ok = await copyToClipboard(url);
    setShareToast(ok ? "Link copied" : "Copy failed");
    window.setTimeout(() => setShareToast(null), 1400);
  }, [shareUrlWithUtm, productPath]);

  // Close share panel on outside click
  useEffect(() => {
    if (!shareOpen) return;

    const onDown = (e) => {
      const panel = sharePanelRef.current;
      const btn = shareBtnRef.current;
      const t = e.target;

      if (panel && panel.contains(t)) return;
      if (btn && btn.contains(t)) return;

      setShareOpen(false);
      // restore focus to button for keyboard users
      try {
        shareBtnRef.current?.focus?.();
      } catch (_) {}
    };

    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
    };
  }, [shareOpen]);

  // Close share panel on Escape + focus management
  useEffect(() => {
    if (!shareOpen) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        setShareOpen(false);
        try {
          shareBtnRef.current?.focus?.();
        } catch (_) {}
      }
    };

    document.addEventListener("keydown", onKey, true);
    // focus first action
    window.setTimeout(() => {
      try {
        firstShareLinkRef.current?.focus?.();
      } catch (_) {}
    }, 0);

    return () => document.removeEventListener("keydown", onKey, true);
  }, [shareOpen]);

  /* ---------------- responsive style tokens (scaled only on small screens) ---------------- */
  const UX = useMemo(() => {
    const s = uiScale;

    const px = (v) => `${Math.round(v * s)}px`;

    return {
      sectionLabel: {
        fontSize: Math.round(10 * s),
        fontWeight: 700,
        color: "#6b7280",
        marginBottom: px(4),
        textTransform: "uppercase",
        letterSpacing: ".12em",
      },

      swatchButton: (active) => ({
        position: "relative",
        height: px(34),
        width: px(34),
        borderRadius: "999px",
        padding: 0,
        border: "none",
        background: active ? "rgba(15,33,71,0.06)" : "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition:
          "transform .16s ease-out, box-shadow .16s ease-out, background .16s ease-out",
        transform: active ? "translateY(-2px) scale(1.05)" : "translateY(0) scale(1)",
        boxShadow: active
          ? "0 6px 14px rgba(15,33,71,0.25)"
          : "0 1px 3px rgba(15,33,71,0.12)",
        touchAction: "manipulation",
      }),

      swatchFrame: (active) => ({
        height: px(24),
        width: px(24),
        borderRadius: "999px",
        border: active ? "2px solid #0f2147" : "1px solid #9ca3af",
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: active ? "0 0 0 2px rgba(15,33,71,0.3)" : "none",
      }),

      swatchDot: (code, isLight) => ({
        height: px(16),
        width: px(16),
        borderRadius: "999px",
        background: code || "#e5e7eb",
        border: isLight
          ? "1px solid rgba(15,23,42,0.4)"
          : "1px solid rgba(15,23,42,0.18)",
      }),

      chip: (active, danger = false) => ({
        height: px(30),
        minWidth: px(38),
        padding: `0 ${px(10)}`,
        borderRadius: 999,
        fontSize: Math.round(11 * s),
        fontWeight: 800,
        cursor: danger ? "not-allowed" : "pointer",
        border: danger
          ? "2px solid #b91c1c"
          : active
          ? "2px solid #0f2147"
          : "1px solid #cfd6e9",
        color: danger ? "#b91c1c" : active ? "#fff" : "#1f2a59",
        background: danger ? "rgba(248,113,113,.08)" : active ? "#0f2147" : "#fff",
        opacity: danger ? 0.7 : 1,
        transition:
          "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out, color .18s ease-out",
        transform: "translateY(0)",
        maxWidth: "100%",
        touchAction: "manipulation",
      }),

      primaryBtn: {
        padding: `${px(8)} ${px(14)}`,
        borderRadius: 999,
        fontWeight: 800,
        fontSize: Math.round(11 * s),
        letterSpacing: ".08em",
        textTransform: "uppercase",
        background: "#0f2147",
        color: "#fff",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: "#0f2147",
        cursor: "pointer",
        transition:
          "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out, color .18s ease-out",
        transform: "translateY(0)",
        touchAction: "manipulation",
      },

      secondaryBtn: {
        padding: `${px(8)} ${px(12)}`,
        borderRadius: 999,
        fontWeight: 800,
        fontSize: Math.round(11 * s),
        letterSpacing: ".08em",
        textTransform: "uppercase",
        background: "#ffffff",
        color: "#0f2147",
        border: "1px solid rgba(15,33,71,0.25)",
        cursor: "pointer",
        transition: "transform .18s ease-out, box-shadow .18s ease-out",
        transform: "translateY(0)",
        touchAction: "manipulation",
      },
    };
  }, [uiScale]);

  /* ---------------- render ---------------- */
  const stockLabel =
    stock != null ? (stock > 0 ? `In stock (${stock})` : "Out of stock") : null;

  const skuForMicro = selectedVariant?.sku || baseSku || null;
  const imageForMicro = images?.[0] || ogImageForShare || null;

  // CTA label upgrade (no feature removal): clearer states
  const addBtnLabel = useMemo(() => {
    if (stock != null && stock <= 0) return "Out of stock";
    if (requiresColor && !selection.color) return "Select color";
    if (requiresSize && !selection.size) return "Select size";
    return "Add to Cart";
  }, [stock, requiresColor, requiresSize, selection.color, selection.size]);

  const showFromPrefix = priceRange?.hasRange && !selection.size; // if user hasn't pinned size, show "From"
  const displayPriceText = useMemo(() => {
    if (price == null) return money(currencyCode, price);
    if (showFromPrefix && typeof priceRange?.min === "number") {
      return `From ${money(currencyCode, priceRange.min)}`;
    }
    return money(currencyCode, price);
  }, [price, currencyCode, showFromPrefix, priceRange?.min]);

  return (
    <article
      className={`${styles.card} tdlsProductCard`}
      itemScope
      itemType="https://schema.org/Product"
    >
      {/* Microdata: helps external platforms/crawlers interpret the product */}
      <meta itemProp="name" content={name} />
      {imageForMicro ? <meta itemProp="image" content={imageForMicro} /> : null}
      {skuForMicro ? <meta itemProp="sku" content={skuForMicro} /> : null}

      {/* Offers microdata */}
      {price != null ? (
        <div itemProp="offers" itemScope itemType="https://schema.org/Offer" className="srOnly">
          <meta itemProp="priceCurrency" content={currencyCode} />
          <meta itemProp="price" content={String(price)} />
          <link
            itemProp="availability"
            href={
              stock != null && stock > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock"
            }
          />
          {canonicalUrl ? <meta itemProp="url" content={canonicalUrl} /> : null}
        </div>
      ) : null}

      {/* MEDIA */}
      <div className={`${styles.media} tdlsPcMedia`} ref={mediaRef} tabIndex={0}>
        <div className={`${styles.imageWrap} tdlsPcImageWrap`}>
          {images.length ? (
            <img
              src={images[idx]}
              alt={name}
              className={`${styles.image} tdlsPcImage`}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className={styles.imagePlaceholder} />
          )}

          {images.length > 1 && (
            <>
              <button
                type="button"
                className={`${styles.navBtn} tdlsPcNavBtn`}
                onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)}
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                type="button"
                className={`${styles.navBtn} tdlsPcNavBtn`}
                onClick={() => setIdx((i) => (i + 1) % images.length)}
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}

          {onQuickView && (
            <button
              type="button"
              className={`${styles.qvBtn} tdlsPcQvBtn`}
              onClick={() => onQuickView(product)}
              aria-label="Quick View"
            >
              QUICK VIEW
            </button>
          )}
        </div>
      </div>

      {/* BODY */}
      <div className={`${styles.body} tdlsPcBody`}>
        <Link href={slug ? `/product/${slug}` : "#"} prefetch={false} aria-label={name}>
          <h3
            className={`${styles.title} tdlsPcTitle`}
            style={{
              // Hard override to ensure long names never hide/clamp
              whiteSpace: "normal",
              overflow: "visible",
              textOverflow: "clip",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              hyphens: "auto",
              WebkitLineClamp: "unset",
              display: "block",
              maxHeight: "none",
            }}
          >
            {name}
          </h3>
        </Link>

        {/* Tier – plain text, matches QuickView wording, no CTA, no color pill */}
        {tierText && (
          <div className={styles.metaRow}>
            <span
              style={{
                fontSize: Math.max(10, Math.round(10 * uiScale)),
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".14em",
                color: "#4b5563",
              }}
            >
              {tierText}
            </span>
          </div>
        )}

        {/* Stock in a separate line */}
        {stockLabel && (
          <div className={styles.metaRow}>
            <span
              className={styles.stockBadge}
              style={{
                fontSize: Math.max(10, Math.round(10 * uiScale)),
                fontWeight: 800,
                padding: `${Math.round(3 * uiScale)}px ${Math.round(8 * uiScale)}px`,
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                borderWidth: 1,
                borderStyle: "solid",
                ...(stock > 0
                  ? { color: "#065f46", background: "#ecfdf5", borderColor: "#a7f3d0" }
                  : { color: "#b91c1c", background: "#fee2e2", borderColor: "#fecaca" }),
              }}
            >
              {stockLabel}
            </span>
          </div>
        )}

        <div className={`${styles.priceRow} tdlsPcPriceRow`}>
          <span className={`${styles.price} tdlsPcPrice`}>{displayPriceText}</span>

          {/* Optional subtle range hint (only when range exists and size not chosen) */}
          {priceRange?.hasRange && !selection.size && typeof priceRange.max === "number" ? (
            <span
              style={{
                marginLeft: 8,
                fontSize: Math.max(10, Math.round(10 * uiScale)),
                fontWeight: 700,
                color: "#6b7280",
                letterSpacing: ".02em",
              }}
              aria-label="Price range"
              title="Prices vary by size/variant"
            >
              • up to {money(currencyCode, priceRange.max)}
            </span>
          ) : null}
        </div>

        {/* colors – CENTERED */}
        {!!colors.length && (
          <div style={{ marginTop: 8, textAlign: "center" }}>
            <div style={{ ...UX.sectionLabel, textAlign: "center" }}>Color</div>
            <div
              className="tdlsPcOptionsRow"
              style={{
                display: "flex",
                gap: Math.round(10 * uiScale),
                flexWrap: "wrap",
                justifyContent: "center",
                maxWidth: "100%",
              }}
            >
              {colors.map((c) => {
                const active = selection.color === c.name;
                const code = c.code || c.name;
                const light = isLightColor(code);
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => {
                      setSelection((sel) => {
                        const nextColor = c.name;
                        const hasSameSize =
                          sel.size &&
                          variants.some(
                            (v) => v.color_name === nextColor && v.size_name === sel.size
                          );
                        return { color: nextColor, size: hasSameSize ? sel.size : null };
                      });
                      setError(null);
                    }}
                    style={UX.swatchButton(active)}
                    aria-label={c.name}
                    title={c.name}
                  >
                    <span style={UX.swatchFrame(active)}>
                      <span style={UX.swatchDot(code, light)} />
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          bottom: -2,
                          right: -2,
                          height: Math.round(14 * uiScale),
                          width: Math.round(14 * uiScale),
                          borderRadius: "999px",
                          background: "#0f2147",
                          color: "#ffffff",
                          fontSize: Math.max(9, Math.round(9 * uiScale)),
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 0 0 1px #e5e7eb",
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected color label */}
            {selection.color && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: Math.max(11, Math.round(11 * uiScale)),
                  fontWeight: 600,
                  color: "#0f2147",
                }}
              >
                Selected: {selection.color}
              </div>
            )}
          </div>
        )}

        {/* sizes – CENTERED */}
        {!!sizes.length && (
          <div style={{ marginTop: 6, textAlign: "center" }}>
            <div style={{ ...UX.sectionLabel, textAlign: "center" }}>Size</div>
            <div
              className="tdlsPcOptionsRow"
              style={{
                display: "flex",
                gap: Math.round(8 * uiScale),
                flexWrap: "wrap",
                justifyContent: "center",
                maxWidth: "100%",
              }}
            >
              {sizes.map((s) => {
                const active = selection.size === s;
                const sizeStock = sizeStockMap.get(s);
                const isOOS = sizeStock != null && sizeStock <= 0;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      if (isOOS) return;
                      setSelection((sel) => ({ ...sel, size: s }));
                      setError(null);
                    }}
                    style={UX.chip(active, isOOS)}
                    title={
                      isOOS
                        ? `${s} - Out of stock`
                        : sizeStock != null
                        ? `${s} - In stock (${sizeStock})`
                        : s
                    }
                    disabled={isOOS}
                  >
                    {s}
                    {isOOS ? " (OOS)" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* inline error / notification */}
        {error && (
          <div
            style={{
              marginTop: 10,
              padding: `${Math.round(6 * uiScale)}px ${Math.round(10 * uiScale)}px`,
              borderRadius: 999,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: Math.max(11, Math.round(11 * uiScale)),
              fontWeight: 600,
              textAlign: "center",
            }}
            role="status"
            aria-live="polite"
          >
            {error}
          </div>
        )}

        {/* CTA Row – CENTERED (Add to Cart + Share) */}
        <div
          className="tdlsPcCtaRow"
          style={{
            marginTop: 10,
            display: "flex",
            justifyContent: "center",
            gap: Math.round(10 * uiScale),
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={stock != null && stock <= 0}
            style={{
              ...UX.primaryBtn,
              opacity: stock != null && stock <= 0 ? 0.6 : 1,
              cursor: stock != null && stock <= 0 ? "not-allowed" : "pointer",
            }}
            aria-label={addBtnLabel}
            title={addBtnLabel}
          >
            {addBtnLabel}
          </button>

          <button
            type="button"
            ref={shareBtnRef}
            onClick={handleShare}
            style={UX.secondaryBtn}
            aria-label="Share product"
            title="Share"
          >
            Share
          </button>

          <button
            type="button"
            onClick={handleCopyLink}
            style={UX.secondaryBtn}
            aria-label="Copy product link"
            title="Copy link"
          >
            Copy
          </button>
        </div>

        {/* Share panel (fallback when native share isn't available) */}
        {shareOpen && (
          <div
            ref={sharePanelRef}
            className="tdlsSharePanel"
            role="dialog"
            aria-label="Share options"
          >
            <div className="tdlsShareTitle">Share</div>

            {/* Small preview strip for share (uses OG image if present, otherwise product first image) */}
            <div className="tdlsSharePreview" aria-label="Share preview">
              <div className="tdlsShareThumb" aria-hidden="true">
                {ogImageForShare || images?.[0] ? (
                  <img
                    src={ogImageForShare || images?.[0]}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="tdlsShareThumbPh" />
                )}
              </div>
              <div className="tdlsSharePreviewText">
                <div className="tdlsShareName">{name}</div>
                <div className="tdlsShareSub">
                  {tierText ? tierText : "TDLS"}
                  {typeof price === "number" ? ` • ${money(currencyCode, price)}` : ""}
                </div>
              </div>
            </div>

            <div className="tdlsShareLinks">
              <a
                ref={firstShareLinkRef}
                href={shareLinks.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
              <a href={shareLinks.facebook} target="_blank" rel="noopener noreferrer">
                Facebook
              </a>
              <a href={shareLinks.x} target="_blank" rel="noopener noreferrer">
                X
              </a>
              <a href={shareLinks.linkedin} target="_blank" rel="noopener noreferrer">
                LinkedIn
              </a>
            </div>
          </div>
        )}

        {/* Copy toast */}
        {shareToast && <div className="tdlsShareToast">{shareToast}</div>}
      </div>

      {/* Local styles: only touch responsiveness + overflow safety (desktop preserved) */}
      <style jsx>{`
        /* Visually hidden microdata container */
        .srOnly {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }

        /* Hard overflow guards */
        .tdlsProductCard {
          max-width: 100%;
          min-width: 0;
          overflow: hidden; /* prevents accidental horizontal spill */
        }
        .tdlsPcBody {
          min-width: 0;
          max-width: 100%;
        }
        .tdlsPcTitle {
          min-width: 0;
          max-width: 100%;
        }

        /* Share panel: premium, compact */
        .tdlsSharePanel {
          margin-top: 10px;
          border: 1px solid rgba(15, 33, 71, 0.14);
          background: #ffffff;
          border-radius: 14px;
          padding: 10px 12px;
          box-shadow: 0 10px 30px rgba(15, 33, 71, 0.12);
        }
        .tdlsShareTitle {
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-size: 11px;
          color: #0f2147;
          margin-bottom: 8px;
        }

        /* Share preview strip */
        .tdlsSharePreview {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          border-radius: 12px;
          border: 1px solid rgba(15, 33, 71, 0.12);
          background: rgba(15, 33, 71, 0.03);
          margin-bottom: 10px;
          max-width: 100%;
        }
        .tdlsShareThumb {
          width: 46px;
          height: 46px;
          border-radius: 12px;
          overflow: hidden;
          background: #ffffff;
          border: 1px solid rgba(15, 33, 71, 0.12);
          flex: 0 0 auto;
        }
        .tdlsShareThumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .tdlsShareThumbPh {
          width: 100%;
          height: 100%;
          background: rgba(15, 33, 71, 0.06);
        }
        .tdlsSharePreviewText {
          min-width: 0;
          flex: 1 1 auto;
        }
        .tdlsShareName {
          font-weight: 850;
          color: #0f2147;
          font-size: 12px;
          line-height: 1.15;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tdlsShareSub {
          margin-top: 4px;
          font-weight: 700;
          color: rgba(15, 33, 71, 0.72);
          font-size: 11px;
          letter-spacing: 0.02em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tdlsShareLinks {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .tdlsShareLinks a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 8px 10px;
          border-radius: 999px;
          border: 1px solid rgba(15, 33, 71, 0.2);
          color: #0f2147;
          text-decoration: none;
          font-weight: 800;
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          max-width: 100%;
          outline: none;
        }
        .tdlsShareLinks a:focus-visible {
          box-shadow: 0 0 0 3px rgba(15, 33, 71, 0.18);
        }

        .tdlsShareToast {
          margin-top: 10px;
          text-align: center;
          padding: 8px 10px;
          border-radius: 999px;
          background: rgba(15, 33, 71, 0.06);
          border: 1px solid rgba(15, 33, 71, 0.12);
          color: #0f2147;
          font-weight: 700;
          font-size: 12px;
        }

        /* Mobile safety adjustments (desktop untouched) */
        @media (max-width: 640px) {
          .tdlsPcMedia {
            min-width: 0;
          }
          .tdlsPcImageWrap {
            /* Prevent overly tall media on small screens; avoids pushing title/CTA off-screen */
            aspect-ratio: 4 / 5;
          }
          .tdlsPcImage {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          /* Ensure option rows never overflow horizontally */
          :global(.tdlsPcOptionsRow) {
            max-width: 100%;
          }

          /* Reduce share panel typography slightly on small screens */
          .tdlsShareLinks a {
            font-size: 10px;
            padding: 7px 9px;
          }
          .tdlsShareThumb {
            width: 42px;
            height: 42px;
            border-radius: 11px;
          }
        }

        /* Ultra small devices */
        @media (max-width: 380px) {
          .tdlsShareLinks a {
            font-size: 9px;
            padding: 6px 8px;
          }
          .tdlsShareName {
            font-size: 11px;
          }
          .tdlsShareSub {
            font-size: 10px;
          }
        }

        /* Landscape phones: protect vertical space */
        @media (max-height: 420px) and (orientation: landscape) {
          .tdlsPcImageWrap {
            aspect-ratio: 16 / 9;
          }
        }
      `}</style>
    </article>
  );
}
