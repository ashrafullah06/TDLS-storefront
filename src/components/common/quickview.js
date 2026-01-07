// FILE: src/components/common/quickview.js
"use client";

import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCart as use_cart } from "@/components/common/cart_context";

/* ---------------- helpers ---------------- */
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
 * Tier pill appearance (no longer used as CTA, kept for reference if needed later)
 */
const getTierPillStyles = (slugOrLabel) => {
  const key = (slugOrLabel || "").toLowerCase().trim();

  const base = {
    padding: "8px 24px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    borderWidth: 1,
    borderStyle: "solid",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(249,250,251,.96)",
    color: "#020617",
    borderColor: "rgba(148,163,184,.48)",
    boxShadow: "0 0 0 1px rgba(148,163,184,.22)",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontKerning: "normal",
    textRendering: "optimizeLegibility",
    lineHeight: 1.2,
    transition:
      "transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 200ms ease, background 180ms ease, border-color 180ms ease, color 160ms ease",
  };

  if (key.includes("premium")) {
    return {
      base: {
        ...base,
        borderColor: "rgba(202,138,4,.55)",
      },
      hover: {
        background: "linear-gradient(135deg,#020617,#0b1220)",
        color: "#f9fafb",
        borderColor: "rgba(15,23,42,.98)",
        boxShadow: "0 16px 36px rgba(15,23,42,.38)",
      },
    };
  }

  if (key.includes("limited")) {
    return {
      base: {
        ...base,
        borderColor: "rgba(129,140,248,.60)",
      },
      hover: {
        background: "linear-gradient(135deg,#312e81,#4c1d95)",
        color: "#f9fafb",
        borderColor: "rgba(79,70,229,.98)",
        boxShadow: "0 16px 36px rgba(76,29,149,.38)",
      },
    };
  }

  if (key.includes("signature")) {
    return {
      base: {
        ...base,
        borderColor: "rgba(55,65,81,.55)",
      },
      hover: {
        background: "linear-gradient(135deg,#020617,#111827)",
        color: "#e5e7eb",
        borderColor: "rgba(31,41,55,.98)",
        boxShadow: "0 16px 36px rgba(15,23,42,.38)",
      },
    };
  }

  if (key.includes("heritage")) {
    return {
      base: {
        ...base,
        borderColor: "rgba(185,28,28,.65)",
      },
      hover: {
        background: "linear-gradient(135deg,#7f1d1d,#111827)",
        color: "#fef2f2",
        borderColor: "rgba(127,29,29,.98)",
        boxShadow: "0 16px 36px rgba(127,29,29,.40)",
      },
    };
  }

  return {
    base,
    hover: {
      background: "linear-gradient(135deg,#e5e7eb,#f9fafb)",
      color: "#111827",
      borderColor: "rgba(156,163,175,.85)",
      boxShadow: "0 12px 28px rgba(148,163,184,.30)",
    },
  };
};

/**
 * Tier label text:
 * - Keep the exact wording coming from Strapi (no forced uppercase)
 * - Only add "TDLS" at the front if it's not already there
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

/* ---- read variants (updated for product_variants) ---- */
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
 * Normalize variants into a flat structure.
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
      const pv_prisma_id =
        v?.prisma_id || v?.pid || v?.variant_pid || null;

      if (sizes && sizes.length) {
        sizes.forEach((sz) => {
          if (!sz) return;

          const size_name =
            sz?.size_name || sz?.name || sz?.label || null;

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
            sz?.prisma_id ||
            sz?.pid ||
            sz?.variant_pid ||
            pv_prisma_id ||
            null;

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

  const colors = fallbackColors(p);
  const sizes = fallbackSizes(p);
  if (colors.length || sizes.length) {
    const combos = [];
    const A2 = p?.attributes || {};
    const imgs = collectImages(p, [], null);

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

/**
 * Pick the "current" variant for a given (color, size) selection.
 */
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

/* ---------------- component ---------------- */
export default function QuickView({ open = true, product, onClose }) {
  const [portalEl, setPortalEl] = useState(null);
  const [idx, setIdx] = useState(0);
  const [selection, setSelection] = useState({
    color: null,
    size: null,
  });
  const [isMobile, setIsMobile] = useState(false);
  const [qty, setQty] = useState(1);
  const [hoveredCTA, setHoveredCTA] = useState(null);
  const [validationError, setValidationError] = useState(null); // NEW: inline notification

  const router = useRouter();
  const cartCtx = use_cart();

  const A = product?.attributes || {};

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
    A?.price_currency ||
    product?.currency ||
    A?.currency ||
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
    A?.name ||
    product?.title ||
    A?.title ||
    "Product";
  const slug = product?.slug || A?.slug || "";

  const requiresColor = colors.length > 0;
  const requiresSize = sizes.length > 0;

  const productCodes = product?.codes || A?.codes || {};
  const productCode = productCodes?.product_code || null;
  const baseSku = productCodes?.base_sku || null;
  const productBarcode = productCodes?.barcode || null;

  const brandTierSlug =
    (Array.isArray(product?.brand_tiers_slugs) &&
      product.brand_tiers_slugs[0]) ||
    (Array.isArray(A?.brand_tiers_slugs) &&
      A.brand_tiers_slugs[0]) ||
    null;

  const tierLabelRaw =
    product?.tier ||
    A?.tier ||
    A?.tier_label ||
    A?.tierLabel ||
    A?.pricing_tier ||
    A?.pricingTier ||
    (brandTierSlug
      ? brandTierSlug.replace(/[-_]+/g, " ")
      : null) ||
    null;

  const tierLabel = tierLabelRaw
    ? String(tierLabelRaw).trim()
    : null;

  const tierText = formatTierText(tierLabel, brandTierSlug);

  const primaryCategorySlug =
    (Array.isArray(product?.categories_slugs) &&
      product.categories_slugs[0]) ||
    (Array.isArray(A?.categories_slugs) &&
      A.categories_slugs[0]) ||
    null;
  const primaryCategoryLabel = primaryCategorySlug
    ? slugToLabel(primaryCategorySlug)
    : null;

  const primaryAudienceSlug =
    (Array.isArray(product?.audience_categories_slugs) &&
      product.audience_categories_slugs[0]) ||
    (Array.isArray(A?.audience_categories_slugs) &&
      A.audience_categories_slugs[0]) ||
    null;
  const primaryAudienceLabel = primaryAudienceSlug
    ? slugToLabel(primaryAudienceSlug)
    : null;

  const selectedVariant = useMemo(
    () => pickVariantForSelection(variants, selection),
    [variants, selection]
  );

  const displaySku = selectedVariant?.sku || baseSku || null;
  const displayBarcode =
    selectedVariant?.barcode || productBarcode || null;

  const displayVariantId =
    selectedVariant?.size_stock_id ??
    selectedVariant?.id ??
    selectedVariant?.variantId ??
    selectedVariant?.variant_id ??
    null;

  const displayPid =
    selectedVariant?.prisma_id ??
    selectedVariant?.pid ??
    selectedVariant?.variant_pid ??
    null;

  const headerFit =
    selectedVariant?.fit ||
    selectedVariant?.fit_type ||
    product?.fit ||
    A?.fit ||
    A?.fit_type ||
    null;
  const headerGsm =
    selectedVariant?.gsm ||
    selectedVariant?.GSM ||
    product?.gsm ||
    A?.gsm ||
    A?.GSM ||
    null;
  const headerSizeSystem =
    selectedVariant?.size_system ||
    selectedVariant?.sizeSystem ||
    product?.size_system ||
    A?.size_system ||
    null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!open) return;

    const el = document.createElement("div");
    el.setAttribute("id", "qv-root");
    document.body.appendChild(el);
    setPortalEl(el);

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onResize = () => setIsMobile(window.innerWidth < 768);
    onResize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      document.body.style.overflow = prev;
      el.remove();
      setPortalEl(null);
    };
  }, [open]);

  useEffect(() => {
    if (!brandTierSlug) return;
    try {
      router.prefetch?.(`/collections/brand-tiers/${brandTierSlug}`);
    } catch {
      // ignore
    }
  }, [brandTierSlug, router]);

  useEffect(() => {
    if (!product) return;
    setIdx(0);
    setSelection({ color: null, size: null });
    setQty(1);
    setValidationError(null);
  }, [product]);

  useEffect(() => {
    if (!product || !variants.length) return;
    setSelection((prev) => {
      let color = prev.color;
      let size = prev.size;

      if (!color && colors.length === 1) {
        color = colors[0].name;
      }

      const sizePool = variants
        .filter((v) => !color || v.color_name === color)
        .map((v) => v.size_name)
        .filter(Boolean);
      const uniqueSizes = uniq(sizePool);

      if (!size && uniqueSizes.length === 1) {
        size = uniqueSizes[0];
      }

      if (color === prev.color && size === prev.size) return prev;
      return { color, size };
    });
  }, [product, variants, colors]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (images.length > 1) {
      const pre = new Image();
      pre.src = images[(idx + 1) % images.length];
    }
  }, [open, idx, images]);

  const closeOnBackdrop = useCallback(
    (e) => {
      if (e.target === e.currentTarget) onClose?.();
    },
    [onClose]
  );

  /* ---------------- selection + stock guards ---------------- */

  const ensureSelection = () => {
    if (requiresColor && !selection.color && requiresSize && !selection.size) {
      setValidationError("Please select both color and size to continue.");
      return { ok: false };
    }
    if (requiresColor && !selection.color) {
      setValidationError("Please select your desired color.");
      return { ok: false };
    }
    if (requiresSize && !selection.size) {
      setValidationError("Please select your desired size.");
      return { ok: false };
    }
    setValidationError(null);
    return { ok: true };
  };

  const ensureInStock = () => {
    if (stock != null && stock <= 0) {
      setValidationError("This item is currently out of stock for this selection.");
      return { ok: false };
    }
    return { ok: true };
  };

  const addToCartLine = () => {
    const selCheck = ensureSelection();
    if (!selCheck.ok) return null;

    const stockCheck = ensureInStock();
    if (!stockCheck.ok) return null;

    if (stock != null && qty > stock) {
      setValidationError(`Only ${stock} piece(s) available in stock.`);
      return null;
    }

    const chosen = pickVariantForSelection(variants, selection);
    if (!chosen) {
      setValidationError("No valid variant found for this selection.");
      return null;
    }

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

      tier: tierLabel,
    };

    const line = {
      productId:
        product.id ||
        A?.id ||
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

    setValidationError(null);
    return line;
  };

  const handleAddToCart = () => {
    addToCartLine();
  };

  const buyNowServer = useCallback(async () => {
    const selCheck = ensureSelection();
    if (!selCheck.ok) return;

    const stockCheck = ensureInStock();
    if (!stockCheck.ok) return;

    if (stock != null && qty > stock) {
      setValidationError(`Only ${stock} piece(s) available in stock.`);
      return;
    }

    const chosen = pickVariantForSelection(variants, selection);
    if (!chosen) {
      setValidationError("No valid variant found for this selection.");
      return;
    }

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

    if (!sizeStockId && !variantPrismaId) {
      setValidationError(
        "We couldn't identify this variant. Please try Add to Cart or open the full product page."
      );
      return;
    }

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
      sku,
      barcode,
      productId: pidExternal,
      variantId: vidExternal,
      variantPrismaId: variantPrismaId || null,
      sizeStockId,
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
      fabric,
      gsm,
      fit,
      maxAvailable,
      stock: maxAvailable,
      tier: tierLabel,
    };

    const payload = {
      productId:
        product.id ||
        A?.id ||
        slug ||
        name,
      slug,
      name,
      currency: currencyCode,
      unitPrice: Number(price) || undefined,
      quantity: Math.max(1, qty),
      image: images[0] || null,
      selectedColor: selection.color || null,
      selectedSize: selection.size || null,
      colorLabel: selection.color || null,
      sizeLabel: selection.size || null,

      productCode,
      baseSku,
      productBarcode,

      variantId: sizeStockId ? String(sizeStockId) : null,
      rawVariantId: sizeStockId,
      strapiSizeId: sizeStockId ? String(sizeStockId) : null,

      variantPrismaId: variantPrismaId
        ? String(variantPrismaId)
        : null,

      productVariantStrapiId: chosen?.pv_id
        ? String(chosen.pv_id)
        : null,

      sku,
      barcode,

      fabric,
      gsm,
      fit,

      metadata,
    };

    try {
      const r = await fetch("/api/buy-now", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        console.error("Buy Now failed:", j);
        setValidationError(
          j?.error ||
            "Buy Now is temporarily unavailable. Please try Add to Cart."
        );
        return;
      }

      // IMPORTANT: Buy Now must NOT open the cart drawer.
      // Your CartProvider opens it via window.dispatchEvent("cart:open-panel") on add().
      // We capture and cancel that event ONLY for this Buy Now action.
      let removeBlocker = null;
      if (typeof window !== "undefined") {
        const block = (ev) => {
          try {
            ev?.preventDefault?.();
            ev?.stopImmediatePropagation?.();
            ev?.stopPropagation?.();
          } catch {}
        };
        try {
          window.addEventListener("cart:open-panel", block, true);
          removeBlocker = () => {
            try {
              window.removeEventListener("cart:open-panel", block, true);
            } catch {}
          };
        } catch {
          removeBlocker = null;
        }
      }

      try {
        const line = addToCartLine();
        if (!line) {
          // addToCartLine already sets the correct validation message.
          if (removeBlocker) removeBlocker();
          return;
        }
      } finally {
        if (removeBlocker) removeBlocker();
      }

      setValidationError(null);
      onClose?.();
      router.push("/cart");
    } catch (e) {
      console.error(e);
      setValidationError(
        "Network error while adding this item to cart. Please try again."
      );
    }
  }, [
    selection,
    variants,
    qty,
    currencyCode,
    price,
    name,
    images,
    router,
    stock,
    product?.id,
    slug,
    productCode,
    baseSku,
    productBarcode,
    onClose,
    A,
    tierLabel,
    requiresColor,
    requiresSize,
  ]);

  if (!open || !product || !portalEl) {
    return null;
  }

  /* ---------- styles ---------- */
  const sidePad = isMobile ? 8 : 18;
  const S = {
    overlay: {
      position: "fixed",
      inset: 0,
      zIndex: 2147483647,
      background: "rgba(8,14,34,.55)",
      backdropFilter: "blur(6px)",
      padding: sidePad,
      boxSizing: "border-box",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      overflowY: "auto",
    },
    modal: {
      width: "100%",
      maxWidth: 1100,
      maxHeight: `calc(100vh - ${sidePad * 2}px)`,
      background: "#fff",
      borderRadius: 18,
      overflow: "hidden",
      boxShadow: "0 28px 90px rgba(8,21,64,.40)",
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
    },
    left: {
      flex: isMobile ? "0 0 auto" : "0 0 58%",
      background:
        "radial-gradient(circle at top left,#eef2ff,#f9fafb)",
      borderBottom: isMobile ? "1px solid #e6eaf6" : "none",
    },
    right: {
      flex: "1 1 auto",
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      padding: isMobile ? 14 : 24,
      gap: 14,
      maxHeight: isMobile ? "auto" : `calc(100vh - ${sidePad * 2}px)`,
      overflowY: isMobile ? "visible" : "auto",
    },
    heroWrap: {
      position: "relative",
      width: "100%",
      aspectRatio: isMobile ? "1 / 1" : "4 / 5",
      overflow: "hidden",
    },
    navBtn: {
      position: "absolute",
      top: "50%",
      transform: "translateY(-50%)",
      height: 40,
      width: 40,
      borderRadius: "50%",
      background: "rgba(255,255,255,.96)",
      border: "1px solid #d8deef",
      boxShadow: "0 6px 18px rgba(0,0,0,.12)",
      display: "grid",
      placeItems: "center",
      cursor: "pointer",
      fontSize: 24,
      lineHeight: 1,
    },
    thumbBar: {
      display: "flex",
      gap: 10,
      padding: isMobile ? 8 : 12,
      overflowX: "auto",
      WebkitOverflowScrolling: "touch",
    },
    thumb: (active) => ({
      height: 58,
      width: 58,
      borderRadius: 12,
      overflow: "hidden",
      background: "#fff",
      padding: 0,
      cursor: "pointer",
      border: active ? "2px solid #0f2147" : "1px solid #d9def2",
      flex: "0 0 auto",
    }),
    headerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
    },
    titleColumn: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      flex: 1,
      minWidth: 0,
    },
    title: {
      margin: 0,
      fontSize: 22,
      lineHeight: 1.25,
      color: "#0f2147",
      fontWeight: 900,
    },
    headerMetaRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "center",
    },
    // Elegant tier text
    tierText: {
      fontSize: 14,
      fontWeight: 700,
      letterSpacing: ".16em",
      textTransform: "uppercase",
      color: "#111827",
      fontFamily:
        '"Cormorant Garamond","Playfair Display","Times New Roman",serif',
      padding: "2px 0",
      whiteSpace: "nowrap",
    },
    subtleMeta: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".14em",
      color: "#6b7280",
      fontWeight: 600,
    },
    xBtn: {
      height: 36,
      width: 36,
      borderRadius: "50%",
      background: "#f9fafb",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: "#d7dcef",
      cursor: "pointer",
      fontSize: 22,
      lineHeight: 1,
      display: "grid",
      placeItems: "center",
      transition:
        "background .18s ease-out, transform .18s ease-out, box-shadow .18s ease-out, border-color .18s ease-out",
    },
    priceRow: {
      display: "flex",
      alignItems: "center",
      gap: 10,
    },
    price: {
      color: "#0f2147",
      fontWeight: 900,
      fontSize: 18,
    },
    badge: (ok) => ({
      fontSize: 12,
      fontWeight: 800,
      padding: "4px 9px",
      borderRadius: 999,
      color: ok ? "#065f46" : "#b91c1c",
      background: ok ? "#ecfdf5" : "#fee2e2",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: ok ? "#a7f3d0" : "#fecaca",
      textTransform: "uppercase",
      letterSpacing: ".08em",
    }),
    sectionLabel: {
      fontSize: 12,
      fontWeight: 700,
      color: "#6b7280",
      marginBottom: 6,
      textTransform: "uppercase",
      letterSpacing: ".12em",
    },
    // NEW: louder swatch styles
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
      transform: active
        ? "translateY(-2px) scale(1.05)"
        : "translateY(0) scale(1)",
      boxShadow: active
        ? "0 6px 14px rgba(15,33,71,0.25)"
        : "0 1px 3px rgba(15,33,71,0.12)",
    }),
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
    swatchDot: (code, isLight) => ({
      height: 16,
      width: 16,
      borderRadius: "999px",
      background: code || "#e5e7eb",
      border: isLight
        ? "1px solid rgba(15,23,42,0.4)"
        : "1px solid rgba(15,23,42,0.18)",
    }),
    chip: (active, danger = false) => ({
      height: 36,
      minWidth: 44,
      padding: "0 12px",
      borderRadius: 10,
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
    ctas: {
      marginTop: "auto",
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
    },
    primary: {
      padding: "12px 16px",
      borderRadius: 12,
      fontWeight: 900,
      fontSize: 15,
      lineHeight: 1.1,
      background: "#0f2147",
      color: "#fff",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: "#0f2147",
      textDecoration: "none",
      cursor: "pointer",
      minWidth: 170,
      textAlign: "center",
      transition:
        "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out, color .18s ease-out",
      transform: "translateY(0)",
    },
    primaryHover: {
      transform: "translateY(-1px)",
      boxShadow: "0 14px 32px rgba(15,23,42,.25)",
      background: "linear-gradient(135deg,#0f2147,#111827)",
      borderColor: "#020617",
    },
    ghost: {
      padding: "12px 16px",
      borderRadius: 12,
      fontWeight: 900,
      fontSize: 15,
      lineHeight: 1.1,
      background: "#fff",
      color: "#0f2147",
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: "#cfd6ef",
      cursor: "pointer",
      minWidth: 170,
      textAlign: "center",
      transition:
        "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out, color .18s ease-out",
      transform: "translateY(0)",
    },
    ghostHover: {
      transform: "translateY(-1px)",
      boxShadow: "0 10px 24px rgba(15,23,42,.18)",
      background: "#f9fafb",
      borderColor: "#0f2147",
      color: "#0f2147",
    },
    metaBox: {
      marginTop: 4,
      padding: "8px 10px",
      background: "#f9fafb",
      borderRadius: 10,
      border: "1px dashed #e5e7eb",
      fontSize: 11,
      color: "#4b5563",
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      rowGap: 2,
      columnGap: 8,
    },
    metaLabel: {
      fontWeight: 600,
      whiteSpace: "nowrap",
    },
    metaValue: {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    validationBox: {
      marginTop: 10,
      marginBottom: 4,
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid #fecaca",
      background: "#fef2f2",
      color: "#b91c1c",
      fontSize: 12,
      fontWeight: 600,
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    },
    validationTitle: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".14em",
      color: "#b91c1c",
      opacity: 0.85,
    },
  };

  const modal = (
    <div
      style={S.overlay}
      onClick={closeOnBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Quick view"
    >
      {/* MAIN QUICK VIEW CARD */}
      <div
        style={S.modal}
        onClick={(e) => e.stopPropagation()}
      >
        {/* LEFT: gallery */}
        <div style={S.left}>
          <div
            style={S.heroWrap}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" && images.length > 1)
                setIdx((i) => (i - 1 + images.length) % images.length);
              if (e.key === "ArrowRight" && images.length > 1)
                setIdx((i) => (i + 1) % images.length);
            }}
          >
            {images.length ? (
              <img
                src={images[idx]}
                alt={name}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: "#eef2ff",
                }}
              />
            )}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={() =>
                    setIdx((i) => (i - 1 + images.length) % images.length)
                  }
                  style={{ ...S.navBtn, left: 12 }}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={() =>
                    setIdx((i) => (i + 1) % images.length)
                  }
                  style={{ ...S.navBtn, right: 12 }}
                >
                  ›
                </button>
              </>
            )}
          </div>

          {images.length > 1 && (
            <div style={S.thumbBar}>
              {images.map((t, ti) => (
                <button
                  key={t + ti}
                  type="button"
                  aria-label={`Image ${ti + 1}`}
                  onClick={() => setIdx(ti)}
                  style={S.thumb(ti === idx)}
                >
                  <img
                    src={t}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: info */}
        <div style={S.right}>
          <div style={S.headerRow}>
            <div style={S.titleColumn}>
              <h3 style={S.title}>{name}</h3>
              <div style={S.headerMetaRow}>
                {tierLabel && tierText && (
                  <span style={S.tierText}>{tierText}</span>
                )}
                {headerFit && (
                  <span style={S.subtleMeta}>{headerFit}</span>
                )}
                {headerGsm && (
                  <span style={S.subtleMeta}>{headerGsm} GSM</span>
                )}
                {headerSizeSystem && (
                  <span style={S.subtleMeta}>
                    {headerSizeSystem}
                  </span>
                )}
                {primaryCategoryLabel && (
                  <span style={S.subtleMeta}>
                    {primaryCategoryLabel}
                  </span>
                )}
                {primaryAudienceLabel && (
                  <span style={S.subtleMeta}>
                    {primaryAudienceLabel}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={S.xBtn}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow =
                  "0 10px 26px rgba(15,23,42,.18)";
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.borderColor = "#0f2147";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.background = "#f9fafb";
                e.currentTarget.style.borderColor = "#d7dcef";
              }}
            >
              ×
            </button>
          </div>

          <div style={S.priceRow}>
            <span style={S.price}>
              {money(currencyCode, price)}
            </span>
            {stock != null && (
              <span style={S.badge(stock > 0)}>
                {stock > 0 ? `In stock (${stock})` : "Out of stock"}
              </span>
            )}
          </div>

          {/* TECH DETAILS: product & variant identifiers */}
          {(productCode ||
            baseSku ||
            productBarcode ||
            displaySku ||
            displayBarcode ||
            displayPid ||
            displayVariantId ||
            tierLabel) && (
            <div style={S.metaBox}>
              {tierLabel && tierText && (
                <>
                  <div style={S.metaLabel}>Tier</div>
                  <div style={S.metaValue}>{tierText}</div>
                </>
              )}
              {productCode && (
                <>
                  <div style={S.metaLabel}>Product Code</div>
                  <div style={S.metaValue}>{productCode}</div>
                </>
              )}
              {baseSku && (
                <>
                  <div style={S.metaLabel}>Base SKU</div>
                  <div style={S.metaValue}>{baseSku}</div>
                </>
              )}
              {displaySku && (
                <>
                  <div style={S.metaLabel}>Variant SKU</div>
                  <div style={S.metaValue}>{displaySku}</div>
                </>
              )}
              {displayBarcode && (
                <>
                  <div style={S.metaLabel}>Barcode</div>
                  <div style={S.metaValue}>{displayBarcode}</div>
                </>
              )}
              {displayVariantId && (
                <>
                  <div style={S.metaLabel}>Variant ID</div>
                  <div style={S.metaValue}>{displayVariantId}</div>
                </>
              )}
              {displayPid && (
                <>
                  <div style={S.metaLabel}>PID</div>
                  <div style={S.metaValue}>{displayPid}</div>
                </>
              )}
            </div>
          )}

          {/* Colors */}
          {!!colors.length && (
            <div>
              <div style={S.sectionLabel}>Color</div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {colors.map((c) => {
                  const active = selection.color === c.name;
                  const code = c.code || c.name;
                  const light = isLightColor(code);
                  return (
                    <button
                      key={c.name + c.code}
                      type="button"
                      title={c.name}
                      onClick={() => {
                        setSelection({
                          color: c.name,
                          size: null,
                        });
                        setIdx(0);
                        setValidationError(null);
                      }}
                      style={S.swatchButton(active)}
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
                            height: 16,
                            width: 16,
                            borderRadius: "999px",
                            background: "#0f2147",
                            color: "#ffffff",
                            fontSize: 10,
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
              {selection.color && (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0f2147",
                  }}
                >
                  Selected: {selection.color}
                </div>
              )}
            </div>
          )}

          {/* Sizes */}
          {!!sizes.length && (
            <div>
              <div style={S.sectionLabel}>Size</div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {sizes.map((s) => {
                  const active = selection.size === s;
                  const sizeStock = sizeStockMap.get(s);
                  const isOOS =
                    sizeStock != null && sizeStock <= 0;
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
                        setValidationError(null);
                      }}
                      style={S.chip(active, isOOS)}
                      title={
                        isOOS
                          ? `${s} - Out of stock`
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

          {/* Qty */}
          <div>
            <div style={S.sectionLabel}>
              Quantity{" "}
              {stock != null && stock > 0
                ? `(Available: ${stock})`
                : ""}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setQty((q) => Math.max(1, q - 1));
                  setValidationError(null);
                }}
                style={{
                  ...S.chip(false, false),
                  width: 38,
                  minWidth: 38,
                  height: 38,
                }}
              >
                −
              </button>
              <div
                style={{
                  minWidth: 44,
                  textAlign: "center",
                  fontWeight: 900,
                }}
              >
                {qty}
              </div>
              <button
                type="button"
                onClick={() => {
                  setQty((q) => {
                    const next = q + 1;
                    if (stock != null) {
                      return Math.min(
                        next,
                        Math.max(1, stock)
                      );
                    }
                    return next;
                  });
                  setValidationError(null);
                }}
                style={{
                  ...S.chip(false, false),
                  width: 38,
                  minWidth: 38,
                  height: 38,
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Inline validation notification (centered in modal body) */}
          {validationError && (
            <div style={S.validationBox}>
              <div style={S.validationTitle}>
                Selection Needed
              </div>
              <div>{validationError}</div>
            </div>
          )}

          {/* CTAs */}
          <div style={S.ctas}>
            <button
              type="button"
              onClick={handleAddToCart}
              style={{
                ...S.primary,
                background: "#111827",
                borderColor: "#111827",
                ...(hoveredCTA === "add"
                  ? S.primaryHover
                  : null),
              }}
              disabled={stock != null && stock <= 0}
              onMouseEnter={() => setHoveredCTA("add")}
              onMouseLeave={() => setHoveredCTA(null)}
            >
              Add to Cart
            </button>

            <button
              type="button"
              onClick={buyNowServer}
              style={{
                ...S.primary,
                ...(hoveredCTA === "buy"
                  ? S.primaryHover
                  : null),
              }}
              disabled={stock != null && stock <= 0}
              onMouseEnter={() => setHoveredCTA("buy")}
              onMouseLeave={() => setHoveredCTA(null)}
            >
              Buy Now
            </button>

            <button
              type="button"
              onClick={() => {
                onClose?.();
                router.push("/cart");
              }}
              style={{
                ...S.ghost,
                ...(hoveredCTA === "gocart"
                  ? S.ghostHover
                  : null),
              }}
              onMouseEnter={() => setHoveredCTA("gocart")}
              onMouseLeave={() => setHoveredCTA(null)}
            >
              Go to Cart
            </button>

            <a
              href={slug ? `/product/${slug}` : "#"}
              style={{
                ...S.primary,
                ...(hoveredCTA === "view"
                  ? S.primaryHover
                  : null),
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseEnter={() => setHoveredCTA("view")}
              onMouseLeave={() => setHoveredCTA(null)}
            >
              View Details
            </a>
            <button
              type="button"
              onClick={onClose}
              style={{
                ...S.ghost,
                ...(hoveredCTA === "close"
                  ? S.ghostHover
                  : null),
              }}
              onMouseEnter={() => setHoveredCTA("close")}
              onMouseLeave={() => setHoveredCTA(null)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, portalEl);
}
