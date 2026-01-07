// FILE: src/components/common/productcard.jsx  
"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
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
    .map((part) =>
      part ? part.charAt(0).toUpperCase() + part.slice(1) : ""
    )
    .join(" ")
    .trim();
};

/**
 * Keep wording as in Strapi, only add "TDLS" if missing.
 * Same logic as QuickView.formatTierText
 */
const formatTierText = (tierLabel, brandTierSlug) => {
  const core =
    (tierLabel ||
      (brandTierSlug ? slugToLabel(brandTierSlug) : "") ||
      "").trim();

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
  add(get(p, "og_image_Social_Media.data.attributes.url"));

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
    if (v.image && (!selectedColor || v.color_name === selectedColor))
      add(v.image);
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
        v?.color_code ||
        v?.color?.hex ||
        v?.color?.data?.attributes?.hex ||
        null;

      const variantImg =
        get(v, "image.data.attributes.url") ||
        v?.image?.url ||
        v?.image ||
        null;

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
    const nums = variants
      .map((v) => v.price)
      .filter((n) => typeof n === "number");
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

/* ---- small style helpers ---- */
const S = {
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#6b7280",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: ".12em",
  },

  // Clickable area (transparent shell)
  swatchButton: (active) => ({
    position: "relative",
    height: 34,
    width: 34,
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
  }),

  // Framed ring that is ALWAYS visible (even if color is white)
  swatchFrame: (active) => ({
    height: 24,
    width: 24,
    borderRadius: "999px",
    border: active ? "2px solid #0f2147" : "1px solid #9ca3af",
    background: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: active
      ? "0 0 0 2px rgba(15,33,71,0.3)"
      : "none",
  }),

  // Inner solid color dot
  swatchDot: (code, isLight) => ({
    height: 16,
    width: 16,
    borderRadius: "999px",
    background: code || "#e5e7eb",
    border: isLight
      ? "1px solid rgba(15,23,42,0.4)" // stronger outline for light colors
      : "1px solid rgba(15,23,42,0.18)",
  }),

  chip: (active, danger = false) => ({
    height: 30,
    minWidth: 40,
    padding: "0 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    cursor: danger ? "not-allowed" : "pointer",
    border: danger
      ? "2px solid #b91c1c"
      : active
      ? "2px solid #0f2147"
      : "1px solid #cfd6e9",
    color: danger
      ? "#b91c1c"
      : active
      ? "#fff"
      : "#1f2a59",
    background: danger
      ? "rgba(248,113,113,.08)"
      : active
      ? "#0f2147"
      : "#fff",
    opacity: danger ? 0.7 : 1,
    transition:
      "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out, color .18s ease-out",
    transform: "translateY(0)",
  }),
  primaryBtn: {
    padding: "8px 14px",
    borderRadius: 999,
    fontWeight: 800,
    fontSize: 11,
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
  },
};

/* ---------------- component ---------------- */
export default function ProductCard({ product, onQuickView }) {
  const cartCtx = use_cart();

  const [idx, setIdx] = useState(0);
  const [selection, setSelection] = useState({
    color: null,
    size: null,
  });
  const [error, setError] = useState(null); // inline validation message

  const mediaRef = useRef(null);

  const variants = useMemo(
    () => (product ? normalizeVariants(product) : []),
    [product]
  );

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
      if (selection.color && v.color_name && v.color_name !== selection.color)
        return;
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
    () =>
      product ? collectImages(product, variants, selection.color) : [],
    [product, variants, selection.color]
  );

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
  const tiers =
    product?.brand_tiers_slugs ||
    product?.attributes?.brand_tiers_slugs ||
    [];
  const brandTierSlug =
    Array.isArray(tiers) && tiers.length ? tiers[0] : null;

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

    const gsm =
      product?.gsm ||
      A?.gsm ||
      A?.GSM ||
      chosen?.gsm ||
      chosen?.GSM ||
      null;

    const fit =
      product?.fit ||
      A?.fit ||
      A?.fit_type ||
      chosen?.fit ||
      null;

    const sizeStockId =
      chosen?.size_stock_id ||
      chosen?.size_id ||
      chosen?.id ||
      null;

    const variantPrismaId =
      chosen?.prisma_id ||
      chosen?.pid ||
      chosen?.variant_pid ||
      null;

    const sku = chosen?.sku || baseSku || null;
    const barcode =
      chosen?.barcode || productBarcode || null;

    const pidExternal =
      productCode ||
      A?.documentId ||
      A?.uuid ||
      slug ||
      (product?.id != null ? String(product.id) : null);

    const vidExternal =
      variantPrismaId ||
      sku ||
      (sizeStockId != null ? String(sizeStockId) : null);

    const maxAvailable =
      typeof stock === "number" && stock > 0
        ? stock
        : null;

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

      size:
        selection.size ||
        chosen.size_name ||
        null,
      color:
        selection.color ||
        chosen.color_name ||
        null,
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
      productId:
        product.id ||
        product?.attributes?.id ||
        slug ||
        name,
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

  /* ---------------- render ---------------- */
  const stockLabel =
    stock != null
      ? stock > 0
        ? `In stock (${stock})`
        : "Out of stock"
      : null;

  return (
    <article className={styles.card}>
      {/* MEDIA */}
      <div className={styles.media} ref={mediaRef} tabIndex={0}>
        <div className={styles.imageWrap}>
          {images.length ? (
            <img
              src={images[idx]}
              alt={name}
              className={styles.image}
            />
          ) : (
            <div className={styles.imagePlaceholder} />
          )}

          {images.length > 1 && (
            <>
              <button
                type="button"
                className={styles.navBtn}
                onClick={() =>
                  setIdx((i) => (i - 1 + images.length) % images.length)
                }
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                type="button"
                className={styles.navBtn}
                onClick={() =>
                  setIdx((i) => (i + 1) % images.length)
                }
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}

          {onQuickView && (
            <button
              type="button"
              className={styles.qvBtn}
              onClick={() => onQuickView(product)}
              aria-label="Quick View"
            >
              QUICK VIEW
            </button>
          )}
        </div>
      </div>

      {/* BODY */}
      <div className={styles.body}>
        <Link href={slug ? `/product/${slug}` : "#"} prefetch={false}>
          <h3 className={styles.title}>{name}</h3>
        </Link>

        {/* Tier – plain text, matches QuickView wording, no CTA, no color pill */}
        {tierText && (
          <div className={styles.metaRow}>
            <span
              style={{
                fontSize: 10,
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
                fontSize: 10,
                fontWeight: 800,
                padding: "3px 8px",
                borderRadius: 999,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                borderWidth: 1,
                borderStyle: "solid",
                ...(stock > 0
                  ? {
                      color: "#065f46",
                      background: "#ecfdf5",
                      borderColor: "#a7f3d0",
                    }
                  : {
                      color: "#b91c1c",
                      background: "#fee2e2",
                      borderColor: "#fecaca",
                    }),
              }}
            >
              {stockLabel}
            </span>
          </div>
        )}

        <div className={styles.priceRow}>
          <span className={styles.price}>
            {money(currencyCode, price)}
          </span>
        </div>

        {/* colors – CENTERED */}
        {!!colors.length && (
          <div
            style={{
              marginTop: 8,
              textAlign: "center",
            }}
          >
            <div
              style={{
                ...S.sectionLabel,
                textAlign: "center",
              }}
            >
              Color
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "center",
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
                            (v) =>
                              v.color_name === nextColor &&
                              v.size_name === sel.size
                          );
                        return {
                          color: nextColor,
                          size: hasSameSize ? sel.size : null,
                        };
                      });
                      setError(null);
                    }}
                    style={S.swatchButton(active)}
                    aria-label={c.name}
                    title={c.name}
                  >
                    <span style={S.swatchFrame(active)}>
                      <span style={S.swatchDot(code, light)} />
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          bottom: -2,
                          right: -2,
                          height: 14,
                          width: 14,
                          borderRadius: "999px",
                          background: "#0f2147",
                          color: "#ffffff",
                          fontSize: 9,
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
                  fontSize: 11,
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
          <div
            style={{
              marginTop: 6,
              textAlign: "center",
            }}
          >
            <div
              style={{
                ...S.sectionLabel,
                textAlign: "center",
              }}
            >
              Size
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "center",
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
                      setSelection((sel) => ({
                        ...sel,
                        size: s,
                      }));
                      setError(null);
                    }}
                    style={S.chip(active, isOOS)}
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
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: 11,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}

        {/* Add to Cart CTA – CENTERED */}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={stock != null && stock <= 0}
            style={{
              ...S.primaryBtn,
              opacity: stock != null && stock <= 0 ? 0.6 : 1,
              cursor:
                stock != null && stock <= 0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            Add to Cart
          </button>
        </div>
      </div>
    </article>
  );
}
