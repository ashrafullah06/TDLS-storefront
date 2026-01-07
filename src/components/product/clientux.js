// PATH: src/components/product/clientux.js
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart as use_cart } from "@/components/common/cart_context";
import Navbar from "@/components/common/navbar";
import BottomFloatingBar from "@/components/common/bottomfloatingbar";

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

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];

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
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join(" ")
    .trim();
};

const formatTierText = (tierLabel, brandTierSlug) => {
  const core =
    (tierLabel || (brandTierSlug ? slugToLabel(brandTierSlug) : "") || "").trim();
  if (!core) return null;
  const alreadyPrefixed = /^tdls\b/i.test(core);
  return alreadyPrefixed ? core : `TDLS ${core}`;
};

/* -------- color utils for premium swatches -------- */
const isLightColor = (codeRaw) => {
  if (!codeRaw) return false;
  const code = String(codeRaw).trim().toLowerCase();

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
      "snow",
      "bone",
      "ecru",
    ].some((k) => code.includes(k))
  ) {
    return true;
  }

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
  return luminance > 0.82;
};

const normKey = (v) => String(v ?? "").trim().toLowerCase();

/* ---- read variants (copied from quickview; supports product_variants) ---- */
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
      node && typeof node === "object" ? { id: node.id, ...(node.attributes || node) } : node
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
      node && typeof node === "object" ? { id: node.id, ...(node.attributes || node) } : node
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
  const candidates = [p?.colors, A?.colors, A?.color_options, A?.color_names, A?.color_names, get(A, "color.data")].flat?.() || [];
  return (Array.isArray(candidates) ? candidates : [])
    .map((c) =>
      typeof c === "string"
        ? { name: c, code: c }
        : { name: c?.name || c?.label || "", code: c?.hex || c?.code || c?.name || "" }
    )
    .filter((x) => x.name);
};

const fallbackSizes = (p) => {
  const A = p?.attributes || {};
  const candidates = [p?.sizes, A?.sizes, A?.size_options, A?.size_names].flat?.() || [];
  return (Array.isArray(candidates) ? candidates : [])
    .map((s) => (typeof s === "string" ? s : s?.name || s?.label))
    .filter(Boolean);
};

const collectImages = (p, variants, selectedColor) => {
  const s = new Set();
  const add = (u) => u && s.add(ABS(u));
  const addData = (arr) => Array.isArray(arr) && arr.forEach((n) => add(n?.attributes?.url));

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

  // Prefer variant image for selected color (if available)
  variants.forEach((v) => {
    if (v.image && (!selectedColor || normKey(v.color_name) === normKey(selectedColor))) add(v.image);
  });

  return [...s];
};

/**
 * Normalize variants into a flat structure. (copied from quickview)
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

      const variantImg = get(v, "image.data.attributes.url") || v?.image?.url || v?.image || null;

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
            get(sz, "image.data.attributes.url") || sz?.image?.url || sz?.image || variantImg;

          const size_stock_id = sz?.id || null;

          const sku = sz?.sku || v?.sku || null;
          const barcode = sz?.barcode || v?.barcode || null;

          const sz_prisma_id = sz?.prisma_id || sz?.pid || sz?.variant_pid || pv_prisma_id || null;

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
          v?.size_name || v?.size?.name || v?.size?.data?.attributes?.name || v?.size || null;

        const sku = v?.sku || null;
        const barcode = v?.barcode || null;

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
          pid: pv_prisma_id,
          prisma_id: pv_prisma_id,
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
        (!sel.color || normKey(v.color_name) === normKey(sel.color)) &&
        (!sel.size || normKey(v.size_name) === normKey(sel.size))
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
      (!sel.color || normKey(v.color_name) === normKey(sel.color)) &&
      (!sel.size || normKey(v.size_name) === normKey(sel.size))
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

  if (stocks.length) return stocks.reduce((sum, n) => sum + n, 0);
  return pStock;
};

const pickVariantForSelection = (variants, selection) => {
  if (!Array.isArray(variants) || !variants.length) return null;
  const byColor = selection?.color
    ? variants.filter((v) => normKey(v.color_name) === normKey(selection.color))
    : variants;
  const bySize = selection?.size
    ? byColor.filter((v) => normKey(v.size_name) === normKey(selection.size))
    : byColor;
  return bySize[0] || byColor[0] || variants[0] || null;
};

/* ---------------- premium icons (updated wishlist/share as requested) ---------------- */
function IconWishlist({ filled = false, size = 18 }) {
  // Premium heart with crown notch (distinct from prior)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s-7.1-4.4-9.5-8.8C.5 8.5 2.2 5.4 5.6 4.6c2-.4 4 .4 5.1 1.9 1.1-1.5 3.1-2.3 5.1-1.9 3.4.8 5.1 3.9 3.1 7.6C19.1 16.6 12 21 12 21z"
        fill={filled ? "#0f2147" : "none"}
        stroke="#0f2147"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 6.2l1.3 1.2 1.5-1.8 1.5 1.8 1.3-1.2"
        stroke="#0f2147"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}

function IconSharePremium({ size = 18 }) {
  // Premium share with rounded nodes + arrow
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.2 6.2l3.6-2.2v5.4"
        stroke="#0f2147"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.8 4l-5.2 3.2c-1.1.7-1.8 1.9-1.8 3.2v8.2"
        stroke="#0f2147"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7.2 12.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"
        stroke="#0f2147"
        strokeWidth="1.6"
      />
      <path
        d="M19.1 13.2a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"
        stroke="#0f2147"
        strokeWidth="1.6"
      />
      <path
        d="M9.4 14l7.3 1.1"
        stroke="#0f2147"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCopy({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 9h10v12H9V9z"
        stroke="#0f2147"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"
        stroke="#0f2147"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Star({ filled, onClick, size = 18, title, disabled = false }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        lineHeight: 0,
        opacity: disabled ? 0.85 : 1,
      }}
      aria-label={title}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 2.7l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9 2.9-6z"
          fill={filled ? "#0f2147" : "none"}
          stroke="#0f2147"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/* ---------------- robust JSON fetch (no placeholders; tries existing routes) ---------------- */
async function tryFetchJSON(url, init) {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function smartFetchJSON(candidates, init) {
  for (const url of candidates) {
    try {
      const res = await tryFetchJSON(url, init);
      if (res.status !== 404) return { ...res, used: url };
    } catch {
      // continue
    }
  }
  return { ok: false, status: 404, json: {}, used: candidates?.[0] || "" };
}

/* ---------------- Strapi details normalizers (no guessing; render only real fields) ---------------- */
const isPlainPrimitive = (v) =>
  v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const toText = (v) => {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";

  // arrays: join primitives; for objects attempt best-effort string extraction
  if (Array.isArray(v)) {
    const parts = v
      .map((x) => {
        if (isPlainPrimitive(x)) return toText(x);
        if (x && typeof x === "object") return toText(x?.name || x?.label || x?.title || x?.value || null);
        return null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }

  if (v && typeof v === "object") {
    // Strapi media / relation shape
    const relName = v?.data?.attributes?.name || v?.data?.attributes?.title || null;
    if (relName) return String(relName);

    // generic best effort
    const maybe = v?.name || v?.label || v?.title || v?.value || null;
    return maybe ? String(maybe) : null;
  }

  return null;
};

const toBullets = (v) => {
  if (!v) return null;
  if (Array.isArray(v)) {
    const list = v
      .map((x) => {
        if (typeof x === "string") return x.trim();
        if (x && typeof x === "object") return (x?.text || x?.value || x?.label || x?.name || x?.title || "").toString().trim();
        return "";
      })
      .filter(Boolean);
    return list.length ? list : null;
  }
  if (typeof v === "string") {
    const lines = v
      .split(/\r?\n|•|\u2022/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length > 1 ? lines : null;
  }
  return null;
};

const pickAny = (obj, keys) => {
  for (const k of keys) {
    const val = get(obj, k) ?? obj?.[k];
    const txt = toText(val);
    if (txt) return txt;
  }
  return null;
};

const pickAnyRaw = (obj, keys) => {
  for (const k of keys) {
    const val = get(obj, k) ?? obj?.[k];
    if (val != null) return val;
  }
  return null;
};

/* ---------------- component ---------------- */
export default function ClientUX({ product }) {
  const router = useRouter();
  const cartCtx = use_cart();

  const A = product?.attributes || {};

  const [idx, setIdx] = useState(0);
  const [selection, setSelection] = useState({ color: null, size: null });
  const [qty, setQty] = useState(1);
  const [hoveredCTA, setHoveredCTA] = useState(null);
  const [validationError, setValidationError] = useState(null);

  // Customer auth (central truth via /api/auth/session). Used to:
  // - Hide/guard wishlist for guests
  // - Avoid false "not logged in" prompts for already-authenticated customers
  const [customerAuth, setCustomerAuth] = useState({ checked: false, userId: null, raw: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/session", { cache: "no-store" });
        const j = await r.json().catch(() => null);

        // Support multiple response shapes (your route returns { ok, user, session }).
        const uid =
          j?.user?.id ??
          j?.session?.user?.id ??
          j?.session?.userId ??
          j?.session?.user?.userId ??
          null;

        if (!cancelled) setCustomerAuth({ checked: true, userId: uid ? String(uid) : null, raw: j });
      } catch {
        if (!cancelled) setCustomerAuth({ checked: true, userId: null, raw: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);


  // Unified action feedback (success/fail) for wishlist/share/copy/rating/reviews.
  // Updated: execution notice now anchors near the CTA that was clicked (no new panels/drawers).
  const [toast, setToast] = useState({
    open: false,
    type: "info", // info | success | error
    title: "",
    message: "",
    actionLabel: "",
  });

  const [toastPos, setToastPos] = useState(null); // { x, y, placeAbove }
  const toastActionRef = useRef(null);
  const toastTimerRef = useRef(null);

  const closeToast = useCallback(() => {
    try {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    } catch {}
    toastTimerRef.current = null;
    toastActionRef.current = null;
    setToastPos(null);
    setToast((t) => ({ ...t, open: false }));
  }, []);

  const computeToastPosFromEl = useCallback((el) => {
    try {
      if (!el || typeof window === "undefined") return null;
      const r = el.getBoundingClientRect?.();
      if (!r) return null;

      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;

      const maxW = 420; // toast max width
      const approxH = 130; // safe approx to keep within viewport

      const pad = 10;
      const gap = 10;

      let placeAbove = false;
      // default: below
      let y = r.bottom + gap;

      // if too close to bottom, place above
      if (y + approxH > vh - pad) {
        placeAbove = true;
        y = r.top - gap;
      }

      // clamp Y
      y = Math.max(pad, Math.min(y, vh - pad));

      // align left with CTA, clamp X
      let x = r.left;
      x = Math.max(pad, Math.min(x, vw - pad - Math.min(maxW, vw - pad * 2)));

      return { x, y, placeAbove };
    } catch {
      return null;
    }
  }, []);

  const showToast = useCallback(
    (type, title, message, opts = {}) => {
      const safeType = type === "success" || type === "error" ? type : "info";
      const actionLabel = String(opts?.actionLabel || "").trim();
      toastActionRef.current = typeof opts?.onAction === "function" ? opts.onAction : null;

      // Anchor near the CTA that triggered it (if provided)
      const anchorEl = opts?.anchorEl || null;
      const pos = anchorEl ? computeToastPosFromEl(anchorEl) : null;
      setToastPos(pos);

      setToast({
        open: true,
        type: safeType,
        title: String(title || "Notice"),
        message: String(message || ""),
        actionLabel,
      });

      try {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      } catch {}

      const ms = Number.isFinite(Number(opts?.ms)) ? Number(opts.ms) : 2200;
      toastTimerRef.current = setTimeout(() => {
        closeToast();
      }, Math.max(1200, ms));
    },
    [closeToast, computeToastPosFromEl]
  );


  const ensureCustomerAuthed = useCallback(
    (redirectPath = null) => {
      // If auth has not been checked yet, we still allow UI to render,
      // but actions that require auth should prompt/redirect.
      const authed = Boolean(customerAuth.checked && customerAuth.userId);

      if (authed) return true;

      // Guests must not have wishlist at all — prompt and redirect to login.
      const target = redirectPath || "/wishlist";
      const redirectTo = encodeURIComponent(String(target));
      showToast("info", "Wishlist", "Please log in to use wishlist.", { ms: 2200 });
      try {
        router.push(`/login?redirect=${redirectTo}`);
      } catch {}
      return false;
    },
    [customerAuth.checked, customerAuth.userId, router, showToast]
  );


  useEffect(() => {
    return () => {
      try {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      } catch {}
      toastTimerRef.current = null;
      toastActionRef.current = null;
    };
  }, []);

  // Premium extras
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);

  // Reviews (DB-based)
  const [reviewsBusy, setReviewsBusy] = useState(false);
  const [reviewsError, setReviewsError] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewSummary, setReviewSummary] = useState({ count: 0, avgRating: 0, distribution: {} });
  const [reviewSort, setReviewSort] = useState("recent"); // recent | helpful | highest | lowest
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewHasMore, setReviewHasMore] = useState(false);

  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewName, setReviewName] = useState("");
  const [reviewEmail, setReviewEmail] = useState("");
  const [reviewSubmitBusy, setReviewSubmitBusy] = useState(false);

  const [reportOpenId, setReportOpenId] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  // Details accordion
  const [openDetailKey, setOpenDetailKey] = useState("overview");

  const reviewMountedRef = useRef(false);

  const variants = useMemo(() => (product ? normalizeVariants(product) : []), [product]);

  const colors = useMemo(() => {
    const keys = variants.map((v) => (v.color_name ? `${v.color_name}::${v.color_code || ""}` : null));
    return uniq(keys)
      .map((k) => {
        const [n, code] = (k || "").split("::");
        return n ? { name: n, code: code || n } : null;
      })
      .filter(Boolean);
  }, [variants]);

  const sizes = useMemo(() => {
    const pool = selection.color
      ? variants.filter((v) => normKey(v.color_name) === normKey(selection.color))
      : variants;
    return uniq(pool.map((v) => v.size_name));
  }, [variants, selection.color]);

  const sizeStockMap = useMemo(() => {
    const m = new Map();
    variants.forEach((v) => {
      const sizeName = v.size_name;
      if (!sizeName) return;
      if (selection.color && v.color_name && normKey(v.color_name) !== normKey(selection.color)) return;

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

  // Size-based pricing (color-aware) — shows real variant pricing if present (no placeholders)
  const sizePriceMap = useMemo(() => {
    const m = new Map();
    variants.forEach((v) => {
      const sizeName = v.size_name;
      if (!sizeName) return;
      if (selection.color && v.color_name && normKey(v.color_name) !== normKey(selection.color)) return;
      const price = typeof v.price === "number" ? v.price : null;
      if (price == null) return;
      const prev = m.get(sizeName);
      if (typeof prev !== "number") m.set(sizeName, price);
      else m.set(sizeName, Math.min(prev, price));
    });
    return m;
  }, [variants, selection.color]);

  const images = useMemo(
    () => (product ? collectImages(product, variants, selection.color) : []),
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

  const name = product?.name || A?.name || product?.title || A?.title || "Product";
  const slug = product?.slug || A?.slug || "";

  const requiresColor = colors.length > 0;
  const requiresSize = sizes.length > 0;

  const productCodes = product?.codes || A?.codes || {};
  const productCode = productCodes?.product_code || null;
  const baseSku = productCodes?.base_sku || null;
  const productBarcode = productCodes?.barcode || null;

  const brandTierSlug =
    (Array.isArray(product?.brand_tiers_slugs) && product.brand_tiers_slugs[0]) ||
    (Array.isArray(A?.brand_tiers_slugs) && A?.brand_tiers_slugs[0]) ||
    null;

  const tierLabelRaw =
    product?.tier ||
    A?.tier ||
    A?.tier_label ||
    A?.tierLabel ||
    A?.pricing_tier ||
    A?.pricingTier ||
    (brandTierSlug ? brandTierSlug.replace(/[-_]+/g, " ") : null) ||
    null;

  const tierLabel = tierLabelRaw ? String(tierLabelRaw).trim() : null;
  const tierText = formatTierText(tierLabel, brandTierSlug);

  const primaryCategorySlug =
    (Array.isArray(product?.categories_slugs) && product.categories_slugs[0]) ||
    (Array.isArray(A?.categories_slugs) && A?.categories_slugs[0]) ||
    null;
  const primaryCategoryLabel = primaryCategorySlug ? slugToLabel(primaryCategorySlug) : null;

  const primaryAudienceSlug =
    (Array.isArray(product?.audience_categories_slugs) && product.audience_categories_slugs[0]) ||
    (Array.isArray(A?.audience_categories_slugs) && A?.audience_categories_slugs[0]) ||
    null;
  const primaryAudienceLabel = primaryAudienceSlug ? slugToLabel(primaryAudienceSlug) : null;

  const selectedVariant = useMemo(() => pickVariantForSelection(variants, selection), [variants, selection]);

  const displaySku = selectedVariant?.sku || baseSku || null;
  const displayBarcode = selectedVariant?.barcode || productBarcode || null;

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
  const headerGsm = selectedVariant?.gsm || selectedVariant?.GSM || product?.gsm || A?.gsm || A?.GSM || null;
  const headerSizeSystem =
    selectedVariant?.size_system ||
    selectedVariant?.sizeSystem ||
    product?.size_system ||
    A?.size_system ||
    null;

  // Strapi descriptions (render only if present; no placeholders)
  const shortDescription =
    A?.short_description || A?.shortDescription || product?.short_description || product?.shortDescription || null;

  const longDescription =
    A?.description || A?.long_description || A?.longDescription || product?.description || product?.long_description || null;

  const care =
    A?.care || A?.care_instructions || A?.careInstructions || product?.care || product?.care_instructions || null;

  const composition =
    A?.composition || A?.material || A?.fabric || product?.composition || product?.material || product?.fabric || null;

  const shippingNote =
    A?.shipping_note || A?.shippingNote || product?.shipping_note || product?.shippingNote || null;

  // Extra Strapi fields (render only if they exist)
  const highlightsRaw =
    pickAnyRaw(A, ["highlights", "key_features", "keyFeatures", "features", "feature_list", "featureList"]) ||
    pickAnyRaw(product, ["highlights", "key_features", "features"]);

  const highlights = useMemo(() => toBullets(highlightsRaw), [highlightsRaw]);

  const sizeGuide =
    pickAny(A, ["size_guide", "sizeGuide", "fit_guide", "fitGuide", "measurements_note", "measurementsNote"]) ||
    null;

  const origin =
    pickAny(A, ["origin", "country_of_origin", "countryOfOrigin", "made_in", "madeIn"]) ||
    null;

  const collection =
    pickAny(A, ["collection", "collection_name", "collectionName", "capsule", "drop"]) ||
    null;

  const season =
    pickAny(A, ["season", "season_name", "seasonName"]) ||
    null;

  const occasion =
    pickAny(A, ["occasion", "occasions", "wear_for", "wearFor"]) ||
    null;

  const pattern =
    pickAny(A, ["pattern", "print", "print_type", "printType"]) ||
    null;

  const craft =
    pickAny(A, ["craft", "craftsmanship", "embroidery", "embroidery_type", "embroideryType"]) ||
    null;

  const wash =
    pickAny(A, ["wash", "wash_type", "washType", "finish", "finishing"]) ||
    null;

  const warranty =
    pickAny(A, ["warranty", "warranty_note", "warrantyNote"]) ||
    null;

  const tagsText =
    pickAny(A, ["tags", "tag_list", "tagList"]) ||
    null;

  /* ---------------- lifecycle: defaults (copied behavior) ---------------- */
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

      if (!color && colors.length === 1) color = colors[0].name;

      const sizePool = variants
        .filter((v) => !color || normKey(v.color_name) === normKey(color))
        .map((v) => v.size_name)
        .filter(Boolean);

      const uniqueSizes = uniq(sizePool);
      if (!size && uniqueSizes.length === 1) size = uniqueSizes[0];

      if (color === prev.color && size === prev.size) return prev;
      return { color, size };
    });
  }, [product, variants, colors]);

  /* ---------------- selection + stock guards (copied) ---------------- */
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

  /* ---------------- cart line builder (copied logic) ---------------- */
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

    const fabric = product?.fabric || A?.fabric || A?.material || chosen?.fabric || chosen?.material || null;
    const gsm = product?.gsm || A?.gsm || A?.GSM || chosen?.gsm || chosen?.GSM || null;
    const fit = product?.fit || A?.fit || A?.fit_type || chosen?.fit || null;

    const sizeStockId = chosen?.size_stock_id || chosen?.size_id || chosen?.id || null;
    const variantPrismaId = chosen?.prisma_id || chosen?.pid || chosen?.variant_pid || null;

    const sku = chosen?.sku || baseSku || null;
    const barcode = chosen?.barcode || productBarcode || null;

    const pidExternal =
      productCode || A?.documentId || A?.uuid || slug || (product?.id != null ? String(product.id) : null);

    const vidExternal = variantPrismaId || sku || (sizeStockId != null ? String(sizeStockId) : null);

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
      tier: tierLabel,
    };

    const line = {
      productId: product.id || A?.id || slug || name,
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

    if (cartCtx?.add) cartCtx.add(line);
    else if (cartCtx?.addItem) cartCtx.addItem(line);
    else if (cartCtx?.dispatch) cartCtx.dispatch({ type: "ADD", payload: line });

    setValidationError(null);
    return line;
  };

  const handleAddToCart = () => addToCartLine();

  /* ---------------- buy now (kept intact; CTA removed as requested) ---------------- */
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

    const fabric = product?.fabric || A?.fabric || A?.material || chosen?.fabric || chosen?.material || null;
    const gsm = product?.gsm || A?.gsm || A?.GSM || chosen?.gsm || chosen?.GSM || null;
    const fit = product?.fit || A?.fit || A?.fit_type || chosen?.fit || null;

    const sizeStockId = chosen?.size_stock_id || chosen?.size_id || chosen?.id || null;
    const variantPrismaId = chosen?.prisma_id || chosen?.pid || chosen?.variant_pid || null;

    if (!sizeStockId && !variantPrismaId) {
      setValidationError("We couldn't identify this variant. Please try Add to Cart or open the full product page.");
      return;
    }

    const sku = chosen?.sku || baseSku || null;
    const barcode = chosen?.barcode || productBarcode || null;

    const pidExternal =
      productCode || A?.documentId || A?.uuid || slug || (product?.id != null ? String(product.id) : null);
    const vidExternal = variantPrismaId || sku || (sizeStockId != null ? String(sizeStockId) : null);

    const maxAvailable = typeof stock === "number" && stock > 0 ? stock : null;

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
      size: selection.size || chosen.size_name || null,
      color: selection.color || chosen.color_name || null,
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
      productId: product.id || A?.id || slug || name,
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

      variantPrismaId: variantPrismaId ? String(variantPrismaId) : null,

      productVariantStrapiId: chosen?.pv_id ? String(chosen.pv_id) : null,

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
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        console.error("Buy Now failed:", j);
        setValidationError(j?.error || "Buy Now is temporarily unavailable. Please try Add to Cart.");
        return;
      }
      setValidationError(null);

      // IMPORTANT (per spec): Buy Now must behave like "Add to Cart" + "Go to Cart",
      // but must NOT open the cart drawer/panel. The cart context's `addItem` emits
      // a global `cart:open-panel` event, so we temporarily suppress it.
      try {
        if (typeof window !== "undefined") {
          const suppress = (e) => {
            try {
              e?.preventDefault?.();
              e?.stopImmediatePropagation?.();
              e?.stopPropagation?.();
            } catch {}
          };
          try {
            window.addEventListener("cart:open-panel", suppress, { capture: true });
          } catch {}
          try {
            // Mirror the server-side cart add into the client cart context so the /cart page
            // immediately reflects the added item (even if that page renders from context).
            addToCartLine();
          } finally {
            try {
              window.removeEventListener("cart:open-panel", suppress, { capture: true });
            } catch {}
          }
        } else {
          addToCartLine();
        }
      } catch {
        // Non-fatal: server cart already updated via /api/buy-now
      }

      router.push("/cart");
    } catch (e) {
      console.error(e);
      setValidationError("Network error while adding to cart. Please try again.");
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
    A,
    tierLabel,
    requiresColor,
    requiresSize,
  ]);

  /* ---------------- premium wishlist wiring (tries common existing APIs) ---------------- */
  const wishlistIdentifiers = useMemo(() => {
    const pidExternal =
      productCode || A?.documentId || A?.uuid || slug || (product?.id != null ? String(product.id) : null);
    return {
      productId: product?.id != null ? String(product.id) : null,
      slug: slug || null,
      productCode: productCode || null,
      pid: pidExternal || null,
      variantPid: displayPid != null ? String(displayPid) : null,
      variantId: displayVariantId != null ? String(displayVariantId) : null,
    };
  }, [product?.id, slug, productCode, A, displayPid, displayVariantId]);

  const loadWishlistStatus = useCallback(async () => {
    if (!product) return;
    // Wishlist is account-only. If not authenticated, treat as not wishlisted and stop.
    if (customerAuth.checked && !customerAuth.userId) {
      setWishlisted(false);
      return;
    }
    // If auth check hasn't completed yet, don't fire a status request (prevents false 401 noise).
    if (!customerAuth.checked) return;

    const qs = new URLSearchParams();
    if (wishlistIdentifiers.productId) qs.set("productId", wishlistIdentifiers.productId);
    if (wishlistIdentifiers.slug) qs.set("slug", wishlistIdentifiers.slug);
    if (wishlistIdentifiers.productCode) qs.set("productCode", wishlistIdentifiers.productCode);
    if (wishlistIdentifiers.pid) qs.set("pid", wishlistIdentifiers.pid);

    // Prefer customer route first (it supports status queries); keep /status as fallback
    const candidates = [`/api/wishlist?${qs.toString()}`, `/api/wishlist/status?${qs.toString()}`];

    const res = await smartFetchJSON(candidates);

    // Support both legacy `wishlisted` and current customer API `inWishlist`
    const w =
      typeof res?.json?.inWishlist === "boolean"
        ? res.json.inWishlist
        : typeof res?.json?.data?.inWishlist === "boolean"
        ? res.json.data.inWishlist
        : typeof res?.json?.wishlisted === "boolean"
        ? res.json.wishlisted
        : typeof res?.json?.data?.wishlisted === "boolean"
        ? res.json.data.wishlisted
        : (!!res?.json?.items && Array.isArray(res.json.items) && res.json.items.length > 0);

    setWishlisted(!!w);
  }, [product, wishlistIdentifiers, customerAuth.checked, customerAuth.userId]);

  const toggleWishlist = useCallback(
    async (anchorEl = null) => {
      if (!product || wishlistBusy) return;

      // Account-only: guests must not use wishlist.
      const redirectTarget = slug ? `/product/${encodeURIComponent(String(slug))}` : "/wishlist";
      if (!ensureCustomerAuthed(redirectTarget)) return;

      // IMPORTANT: From the product page, wishlist is ADD-ONLY.
      // Removal is allowed only inside the wishlist page UI.
      if (wishlisted) {
        showToast("info", "Wishlist", "Already in your wishlist.", {
          ms: 1800,
          actionLabel: "Open wishlist",
          onAction: () => {
            try {
              router.push("/wishlist");
            } catch {
              if (typeof window !== "undefined") window.location.href = "/wishlist";
            }
          },
          anchorEl,
        });
        return;
      }

      setWishlistBusy(true);
      setValidationError(null);

      try {
        const payload = {
          // Prefer add-only semantics; legacy APIs may ignore and treat as toggle,
          // but we gate duplicates above so it will not remove from this page.
          action: "add",
          ...wishlistIdentifiers,
          name,
          image: images?.[0] || null,
          price: typeof price === "number" ? price : null,
          currency: currencyCode,
          selectedColor: selection.color || null,
          selectedSize: selection.size || null,
        };

        // Prefer explicit add route when available; fallback to existing customer/legacy handlers.
        const candidates = ["/api/wishlist/add", "/api/wishlist", "/api/wishlist/toggle"];

        const res = await smartFetchJSON(candidates, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const inferred =
            typeof res.json?.inWishlist === "boolean"
              ? res.json.inWishlist
              : typeof res.json?.data?.inWishlist === "boolean"
              ? res.json.data.inWishlist
              : typeof res.json?.wishlisted === "boolean"
              ? res.json.wishlisted
              : typeof res.json?.data?.wishlisted === "boolean"
              ? res.json.data.wishlisted
              : res.json?.action === "removed"
              ? false
              : res.json?.action === "added"
              ? true
              : true;

          // Enforce add-only semantics from this page.
          setWishlisted(true);

          showToast(
            "success",
            "Wishlist",
            inferred ? "Added to wishlist successfully." : "Already in your wishlist.",
            {
              ms: 2200,
              actionLabel: "Open wishlist",
              onAction: () => {
                try {
                  router.push("/wishlist");
                } catch {
                  if (typeof window !== "undefined") window.location.href = "/wishlist";
                }
              },
              anchorEl,
            }
          );
        } else if (res.status === 401 || res.status === 403) {
          // Session drift / missing cookie — treat as guest and send to login
          ensureCustomerAuthed(redirectTarget);
        } else {
          const msg =
            res.json?.error ||
            res.json?.message ||
            res.json?.details ||
            `Add to wishlist failed (HTTP ${res.status}).`;
          showToast("error", "Wishlist", String(msg), { ms: 2600, anchorEl });
        }
      } catch (e) {
        showToast("error", "Wishlist", "Add to wishlist failed. Please try again.", { ms: 2400, anchorEl });
      } finally {
        setWishlistBusy(false);
      }
    },
    [
      product,
      wishlistBusy,
      wishlistIdentifiers,
      name,
      images,
      price,
      currencyCode,
      selection.color,
      selection.size,
      router,
      wishlisted,
      showToast,
      ensureCustomerAuthed,
      slug,
    ]
  );
/* ---------------- wishlist: open page (alias /wishlist -> /account/wishlist) ---------------- */
  const openWishlistPage = useCallback(() => {
    if (!ensureCustomerAuthed("/wishlist")) return;

    try {
      router.push("/wishlist");
      return;
    } catch {}
    try {
      if (typeof window !== "undefined") window.location.href = "/wishlist";
    } catch {}
    showToast("error", "Wishlist", "Unable to open wishlist page.", { ms: 2400 });
  }, [router, showToast, ensureCustomerAuthed]);

  /* ---------------- premium share ---------------- */
  const shareProduct = useCallback(async (anchorEl = null) => {
    const url = typeof window !== "undefined" ? window.location.href : slug ? `/product/${slug}` : "";
    try {
      if (navigator?.share) {
        await navigator.share({
          title: name,
          text: shortDescription ? String(shortDescription).slice(0, 140) : name,
          url,
        });
        showToast("success", "Share", "Share opened successfully.", { ms: 1800, anchorEl });
        return;
      }
    } catch {
      // ignore and fallback
    }

    // Clipboard fallback (works for most desktop browsers on HTTPS)
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("success", "Share", "Link copied to clipboard.", { ms: 2000, anchorEl });
        return;
      }
      throw new Error("clipboard_not_available");
    } catch {
      // Last-resort fallback: show the URL for manual copy (works on HTTP / restricted clipboard environments)
      try {
        if (typeof window !== "undefined") window.prompt("Copy this product link:", url);
      } catch {}
      showToast("error", "Share", "Unable to open system share. Please copy the link.", { ms: 2400, anchorEl });
    }
  }, [name, slug, shortDescription, showToast]);

  const copyText = useCallback(async (txt, okMsg, anchorEl = null) => {
    const s = String(txt || "").trim();
    if (!s) return;
    try {
      await navigator.clipboard.writeText(s);
      showToast("success", "Copy", okMsg || "Copied.", { ms: 1600, anchorEl });
    } catch {
      showToast("error", "Copy", "Copy failed.", { ms: 2000, anchorEl });
    }
  }, [showToast]);

  /* ---------------- reviews wiring (DB-based via your API) ---------------- */
  const reviewProductKey = useMemo(() => {
    return {
      productId: product?.id != null ? String(product.id) : null,
      slug: slug || null,
      productCode: productCode || null,
      pid: wishlistIdentifiers?.pid || null,
    };
  }, [product?.id, slug, productCode, wishlistIdentifiers]);

  const buildReviewQS = useCallback(
    ({ page, sort }) => {
      const qs = new URLSearchParams();
      if (reviewProductKey.productId) qs.set("productId", reviewProductKey.productId);
      if (reviewProductKey.slug) qs.set("slug", reviewProductKey.slug);
      if (reviewProductKey.productCode) qs.set("productCode", reviewProductKey.productCode);
      if (reviewProductKey.pid) qs.set("pid", reviewProductKey.pid);
      qs.set("page", String(page || 1));
      qs.set("pageSize", "6");
      qs.set("sort", String(sort || "recent"));
      return qs.toString();
    },
    [reviewProductKey]
  );

  const loadReviews = useCallback(
    async ({ reset = false } = {}) => {
      if (!product) return;
      setReviewsBusy(true);
      setReviewsError(null);

      const nextPage = reset ? 1 : reviewPage;
      const qs = buildReviewQS({ page: nextPage, sort: reviewSort });

      const candidates = [`/api/reviews?${qs}`, `/api/product-reviews?${qs}`, `/api/customer-reviews?${qs}`];

      const res = await smartFetchJSON(candidates);

      if (!res.ok && res.status !== 404) {
        setReviewsError(res?.json?.error || res?.json?.message || "Unable to load reviews.");
        if (reset) setReviews([]);
        setReviewsBusy(false);
        return;
      }

      const list =
        (Array.isArray(res?.json?.reviews) && res.json.reviews) ||
        (Array.isArray(res?.json?.data) && res.json.data) ||
        (Array.isArray(res?.json?.items) && res.json.items) ||
        (Array.isArray(res?.json?.data?.reviews) && res.json.data.reviews) ||
        [];

      const summary =
        (res?.json?.summary && typeof res.json.summary === "object" && res.json.summary) ||
        (res?.json?.data?.summary && res.json.data.summary) ||
        null;

      const pageInfo =
        (res?.json?.pageInfo && typeof res.json.pageInfo === "object" && res.json.pageInfo) ||
        (res?.json?.data?.pageInfo && typeof res.json.data.pageInfo === "object" && res.json.data.pageInfo) ||
        null;

      if (summary) setReviewSummary(summary);

      const hasMore =
        typeof pageInfo?.hasMore === "boolean"
          ? pageInfo.hasMore
          : Array.isArray(list) && list.length >= 6;

      setReviewHasMore(hasMore);

      if (reset) {
        setReviews(list);
        setReviewPage(1);
      } else {
        setReviews((prev) => [...(Array.isArray(prev) ? prev : []), ...list]);
      }

      setReviewsBusy(false);
    },
    [product, buildReviewQS, reviewSort, reviewPage]
  );

  const loadMoreReviews = useCallback(async () => {
    if (reviewsBusy || !reviewHasMore) return;
    const next = reviewPage + 1;
    setReviewPage(next);
    setTimeout(() => {
      loadReviews({ reset: false });
    }, 0);
  }, [reviewsBusy, reviewHasMore, reviewPage, loadReviews]);

  const submitReview = useCallback(async (anchorEl = null) => {
    if (!product) return;
    if (!reviewRating || reviewRating < 1) {
      setValidationError("Please select a star rating before submitting.");
      showToast("error", "Rating/Review", "Please select a star rating before submitting.", { ms: 2400, anchorEl });
      return;
    }
    const _comment = String(reviewComment || "").trim();
    const _hasComment = _comment.length > 0;
    if (_hasComment && _comment.length < 5) {
      setValidationError("Please write at least 5 characters for your review.");
      showToast("error", "Review", "Please write at least 5 characters.", { ms: 2400, anchorEl });
      return;
    }

    setReviewSubmitBusy(true);
    setValidationError(null);

    const payload = {
      action: "create",
      productId: reviewProductKey.productId || reviewProductKey.pid || reviewProductKey.slug || "",
      variantId: displayVariantId != null ? String(displayVariantId) : null,
      rating: reviewRating,
      title: null,
      body: _hasComment ? _comment : null,
      displayName: String(reviewName || "").trim() || null,
      anonymous: false,
      wouldRecommend: null,
      fitFeedback: null,
      email: String(reviewEmail || "").trim() || null,
      selectedColor: selection.color || null,
      selectedSize: selection.size || null,
      variantPid: displayPid != null ? String(displayPid) : null,
    };

    const candidates = ["/api/reviews", "/api/reviews/create", "/api/product-reviews/create"];

    const res = await smartFetchJSON(candidates, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const msg = res?.json?.error || res?.json?.message || "Unable to submit review.";
      setValidationError(String(msg || "Unable to submit review."));
      showToast("error", "Review", String(msg || "Unable to submit review."), { ms: 2600, anchorEl });
      setReviewSubmitBusy(false);
      return;
    }

    setReviewComment("");
    setReviewRating(0);
    await loadReviews({ reset: true });
    showToast(
      "success",
      _hasComment ? "Review" : "Rating",
      _hasComment ? "Review submitted successfully." : "Rating submitted successfully.",
      { ms: 2200, anchorEl }
    );
    setReviewSubmitBusy(false);
  }, [
    product,
    reviewProductKey,
    reviewRating,
    reviewComment,
    reviewName,
    reviewEmail,
    selection.color,
    selection.size,
    displayVariantId,
    displayPid,
    loadReviews,
    showToast,
  ]);

  const voteReview = useCallback(async (reviewId, value) => {
    if (!reviewId) return;
    const payload = { action: "vote", reviewId: String(reviewId), value };
    const res = await smartFetchJSON(["/api/reviews"], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      setValidationError(res?.json?.error || res?.json?.message || "Unable to submit vote.");
      return;
    }

    const helpfulCount = typeof res?.json?.helpfulCount === "number" ? res.json.helpfulCount : null;
    const notHelpfulCount = typeof res?.json?.notHelpfulCount === "number" ? res.json.notHelpfulCount : null;
    const myVote = typeof res?.json?.myVote === "number" ? res.json.myVote : value;

    setReviews((prev) =>
      (Array.isArray(prev) ? prev : []).map((r) => {
        if (String(r?.id) !== String(reviewId)) return r;
        return {
          ...r,
          helpfulCount: helpfulCount ?? r?.helpfulCount ?? 0,
          notHelpfulCount: notHelpfulCount ?? r?.notHelpfulCount ?? 0,
          myVote,
        };
      })
    );
  }, []);

  const reportReview = useCallback(async () => {
    if (!reportOpenId) return;
    const reason = String(reportReason || "").trim();
    if (reason.length < 3) {
      setValidationError("Please write a short reason (min 3 characters).");
      return;
    }

    setReportBusy(true);
    const payload = { action: "report", reviewId: String(reportOpenId), reason };

    const res = await smartFetchJSON(["/api/reviews"], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      setValidationError(res?.json?.error || res?.json?.message || "Unable to report review.");
      setReportBusy(false);
      return;
    }

    setReportOpenId(null);
    setReportReason("");
    setReportBusy(false);
    setValidationError("Report submitted. Thank you.");
    setTimeout(() => setValidationError(null), 1600);
  }, [reportOpenId, reportReason]);

  useEffect(() => {
    if (!product) return;
    if (reviewMountedRef.current) return;
    reviewMountedRef.current = true;
    loadReviews({ reset: true });
    loadWishlistStatus();
  }, [product, loadReviews, loadWishlistStatus]);

  useEffect(() => {
    if (!product) return;
    setReviewPage(1);
    loadReviews({ reset: true });
  }, [reviewSort]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- derived review stats ---------------- */
  const reviewStats = useMemo(() => {
    const count = Number(reviewSummary?.count ?? 0);
    const avg = Number(reviewSummary?.avgRating ?? 0);
    if (Number.isFinite(count) && count > 0 && Number.isFinite(avg) && avg > 0) {
      return { count, avg: Math.round(avg * 10) / 10 };
    }

    const list = Array.isArray(reviews) ? reviews : [];
    const ratings = list
      .map((r) => Number(r?.rating ?? r?.stars ?? r?.score))
      .filter((n) => Number.isFinite(n) && n > 0);
    const avg2 = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    return { count: list.length, avg: avg2 ? Math.round(avg2 * 10) / 10 : 0 };
  }, [reviews, reviewSummary]);

  /* ---------------- UI styles: premium, white/pearl only ---------------- */
  const S = {
    page: {
      width: "100%",
      background: "linear-gradient(180deg,#ffffff,#fbfdff)",
      color: "#0f2147",
    },
    shell: {
      // increased panel size + reduced margins
      maxWidth: 1760,
      margin: "0 auto",
      padding: "10px 8px 54px",
    },
    panel: {
      width: "100%",
      borderRadius: 26,
      background: "rgba(255,255,255,.96)",
      border: "1px solid rgba(15,33,71,.10)",
      boxShadow: "0 30px 92px rgba(15,33,71,.13)",
      overflow: "hidden",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "1.10fr .90fr",
      gap: 0,
    },
    left: {
      background: "radial-gradient(circle at top left,#eef2ff,#ffffff)",
      borderRight: "1px solid rgba(15,33,71,.08)",
    },
    right: {
      padding: 26,
      display: "flex",
      flexDirection: "column",
      gap: 14,
      minWidth: 0,
      background: "linear-gradient(180deg,#ffffff,#fbfdff)",
    },
    heroWrap: {
      position: "relative",
      width: "100%",
      aspectRatio: "4 / 5",
      overflow: "hidden",
    },
    heroImg: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      background: "#eef2ff",
    },
    navBtn: {
      position: "absolute",
      top: "50%",
      transform: "translateY(-50%)",
      height: 46,
      width: 46,
      borderRadius: "50%",
      background: "rgba(255,255,255,.98)",
      border: "1px solid rgba(15,33,71,.16)",
      boxShadow: "0 10px 24px rgba(0,0,0,.10)",
      display: "grid",
      placeItems: "center",
      cursor: "pointer",
      fontSize: 26,
      lineHeight: 1,
      color: "#0f2147",
    },
    thumbBar: {
      display: "flex",
      gap: 10,
      padding: 14,
      overflowX: "auto",
      WebkitOverflowScrolling: "touch",
      borderTop: "1px solid rgba(15,33,71,.06)",
      background: "rgba(255,255,255,.85)",
    },
    thumb: (active) => ({
      height: 64,
      width: 64,
      borderRadius: 14,
      overflow: "hidden",
      background: "#fff",
      padding: 0,
      cursor: "pointer",
      border: active ? "2px solid #0f2147" : "1px solid rgba(15,33,71,.14)",
      flex: "0 0 auto",
      boxShadow: active ? "0 10px 22px rgba(15,33,71,.16)" : "0 2px 8px rgba(15,33,71,.08)",
      transform: active ? "translateY(-1px)" : "translateY(0)",
      transition: "transform .16s ease, box-shadow .16s ease, border-color .16s ease",
    }),
    headerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 12,
    },
    titleColumn: { display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 },
    title: {
      margin: 0,
      fontSize: 26,
      lineHeight: 1.15,
      color: "#0f2147",
      fontWeight: 950,
      letterSpacing: "-0.02em",
    },
    headerMetaRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "center",
    },
    tierText: {
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: ".16em",
      textTransform: "uppercase",
      color: "#111827",
      fontFamily: '"Cormorant Garamond","Playfair Display","Times New Roman",serif',
      padding: "2px 0",
      whiteSpace: "nowrap",
    },
    subtleMeta: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".14em",
      color: "rgba(15,33,71,.70)",
      fontWeight: 750,
      padding: "2px 8px",
      borderRadius: 999,
      background: "rgba(15,33,71,.05)",
      border: "1px solid rgba(15,33,71,.08)",
    },
    actionBar: {
      display: "flex",
      gap: 10,
      alignItems: "center",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      position: "relative",
      zIndex: 80,
      pointerEvents: "auto",
      // move icons ~0.5 inch (≈48px) below current position
      marginTop: 48,
    },
    // icon cluster is now visually distinct: "capsule glass"
    actionBtn: (tone = "glass") => {
      const isGlass = tone === "glass";
      const isOutline = tone === "outline";
      return {
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px", // slightly larger hit-area (click anywhere on CTA)
        borderRadius: 999,
        cursor: "pointer",
        pointerEvents: "auto",
        position: "relative",
        zIndex: 2,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: isOutline ? "rgba(15,33,71,.18)" : "rgba(15,33,71,.10)",
        background: isGlass
          ? "linear-gradient(180deg,rgba(255,255,255,.95),rgba(246,249,255,.92))"
          : "rgba(255,255,255,.96)",
        boxShadow: isGlass ? "0 12px 26px rgba(15,33,71,.10)" : "0 10px 22px rgba(15,33,71,.08)",
        color: "#0f2147",
        fontWeight: 900,
        fontSize: 13,
        letterSpacing: ".02em",
        transition: "transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease",
        transform: "translateY(0)",
        userSelect: "none",
        opacity: wishlistBusy ? 0.92 : 1,
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      };
    },
    priceRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
    price: { color: "#0f2147", fontWeight: 950, fontSize: 20, letterSpacing: "-0.01em" },
    badge: (ok) => ({
      fontSize: 12,
      fontWeight: 900,
      padding: "5px 10px",
      borderRadius: 999,
      color: ok ? "#065f46" : "#b91c1c",
      background: ok ? "#ecfdf5" : "#fee2e2",
      border: `1px solid ${ok ? "#a7f3d0" : "#fecaca"}`,
      textTransform: "uppercase",
      letterSpacing: ".08em",
    }),
    sectionLabel: {
      fontSize: 12,
      fontWeight: 850,
      color: "rgba(15,33,71,.68)",
      marginBottom: 7,
      textTransform: "uppercase",
      letterSpacing: ".12em",
    },
    swatchButton: (active) => ({
      position: "relative",
      height: 38,
      width: 38,
      borderRadius: 999,
      padding: 0,
      border: "none",
      background: active ? "rgba(15,33,71,0.06)" : "transparent",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "transform .16s ease-out, box-shadow .16s ease-out, background .16s ease-out",
      transform: active ? "translateY(-2px) scale(1.06)" : "translateY(0) scale(1)",
      boxShadow: active ? "0 10px 22px rgba(15,33,71,0.18)" : "0 1px 3px rgba(15,33,71,0.10)",
    }),
    swatchFrame: (active) => ({
      height: 26,
      width: 26,
      borderRadius: 999,
      border: active ? "2px solid #0f2147" : "1px solid rgba(15,33,71,.35)",
      background: "#ffffff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: active ? "0 0 0 3px rgba(15,33,71,0.16)" : "none",
    }),
    swatchDot: (code, isLight) => ({
      height: 18,
      width: 18,
      borderRadius: 999,
      background: code || "#e5e7eb",
      border: isLight ? "1px solid rgba(15,23,42,0.45)" : "1px solid rgba(15,23,42,0.18)",
    }),
    chip: (active, danger = false) => ({
      height: 44,
      minWidth: 52,
      padding: "0 14px",
      borderRadius: 14,
      fontWeight: 950,
      cursor: danger ? "not-allowed" : "pointer",
      border: danger ? "2px solid #b91c1c" : active ? "2px solid #0f2147" : "1px solid rgba(15,33,71,.18)",
      color: danger ? "#b91c1c" : active ? "#fff" : "#0f2147",
      background: danger ? "rgba(248,113,113,.08)" : active ? "#0f2147" : "#fff",
      opacity: danger ? 0.7 : 1,
      transition:
        "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out, color .18s ease-out",
      transform: "translateY(0)",
      boxShadow: active ? "0 14px 30px rgba(15,33,71,.14)" : "0 2px 8px rgba(15,33,71,.06)",
    }),
    chipSub: {
      display: "block",
      marginTop: 2,
      fontSize: 11,
      fontWeight: 850,
      opacity: 0.78,
    },
    ctas: {
      marginTop: 8,
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      alignItems: "center",
    },
    primary: {
      padding: "14px 18px",
      borderRadius: 999,
      fontWeight: 950,
      fontSize: 15,
      lineHeight: 1.1,
      background: "#0f2147",
      color: "#fff",
      border: "1px solid #0f2147",
      cursor: "pointer",
      minWidth: 220,
      textAlign: "center",
      transition: "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out",
      transform: "translateY(0)",
      boxShadow: "0 14px 34px rgba(15,33,71,.22)",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    primaryHover: {
      transform: "translateY(-1px)",
      boxShadow: "0 18px 44px rgba(15,33,71,.28)",
      background: "linear-gradient(135deg,#0f2147,#111827)",
      border: "1px solid #020617",
    },
    ghost: {
      padding: "14px 18px",
      borderRadius: 999,
      fontWeight: 950,
      fontSize: 15,
      lineHeight: 1.1,
      background: "#fff",
      color: "#0f2147",
      border: "1px solid rgba(15,33,71,.18)",
      cursor: "pointer",
      minWidth: 220,
      textAlign: "center",
      transition:
        "transform .18s ease-out, box-shadow .18s ease-out, background .18s ease-out, border-color .18s ease-out, color .18s ease-out",
      transform: "translateY(0)",
      boxShadow: "0 10px 24px rgba(15,33,71,.10)",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    ghostHover: {
      transform: "translateY(-1px)",
      boxShadow: "0 14px 30px rgba(15,33,71,.14)",
      background: "#f8fbff",
      border: "1px solid #0f2147",
      color: "#0f2147",
    },
    metaBox: {
      marginTop: 4,
      padding: "10px 12px",
      background: "linear-gradient(180deg,#ffffff,#fbfdff)",
      borderRadius: 14,
      border: "1px dashed rgba(15,33,71,.20)",
      fontSize: 12,
      color: "rgba(15,33,71,.82)",
      display: "grid",
      gridTemplateColumns: "auto 1fr",
      rowGap: 5,
      columnGap: 10,
    },
    metaLabel: { fontWeight: 900, whiteSpace: "nowrap" },
    metaValue: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
    },
    validationBox: {
      marginTop: 8,
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid #fecaca",
      background: "#fef2f2",
      color: "#b91c1c",
      fontSize: 12,
      fontWeight: 750,
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    },
    validationTitle: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".14em",
      opacity: 0.9,
      fontWeight: 900,
    },
    toastWrap: (pos) => ({
      position: "fixed",
      zIndex: 2147483647,
      pointerEvents: "auto",
      maxWidth: 420,
      width: "calc(100vw - 28px)",
      // anchored near clicked CTA when pos is present; otherwise fallback stays above BottomFloatingBar
      right: pos ? "auto" : 14,
      bottom: pos ? "auto" : 88,
      left: pos ? pos.x : "auto",
      top: pos ? pos.y : "auto",
      transform: pos?.placeAbove ? "translateY(-100%)" : "translateY(0)",
    }),
    toastCard: (type) => {
      const ok = type === "success";
      const bad = type === "error";
      return {
        borderRadius: 18,
        border: `1px solid ${ok ? "#a7f3d0" : bad ? "#fecaca" : "rgba(15,33,71,.18)"}`,
        background: ok ? "#ecfdf5" : bad ? "#fef2f2" : "#ffffff",
        color: ok ? "#065f46" : bad ? "#b91c1c" : "#0f2147",
        boxShadow: "0 16px 44px rgba(15,33,71,.18)",
        padding: "12px 12px",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 10,
        alignItems: "start",
      };
    },
    toastTitle: {
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: ".14em",
      fontWeight: 950,
      marginBottom: 2,
    },
    toastMsg: { fontSize: 13, fontWeight: 800, lineHeight: 1.25 },
    toastActions: { display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" },
    toastBtn: {
      borderRadius: 999,
      border: "1px solid rgba(15,33,71,.18)",
      background: "rgba(255,255,255,.92)",
      padding: "8px 10px",
      fontSize: 12,
      fontWeight: 900,
      cursor: "pointer",
      color: "#0f2147",
      whiteSpace: "nowrap",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    toastClose: {
      borderRadius: 999,
      border: "1px solid rgba(15,33,71,.18)",
      background: "rgba(255,255,255,.92)",
      padding: "8px 10px",
      fontSize: 12,
      fontWeight: 950,
      cursor: "pointer",
      color: "#0f2147",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    infoCard: {
      borderRadius: 16,
      border: "1px solid rgba(15,33,71,.10)",
      background: "rgba(255,255,255,.92)",
      boxShadow: "0 10px 26px rgba(15,33,71,.08)",
      padding: 14,
    },
    para: {
      margin: 0,
      color: "rgba(15,33,71,.86)",
      fontSize: 14,
      lineHeight: 1.7,
      fontWeight: 650,
      whiteSpace: "pre-wrap",
    },
    divider: { height: 1, background: "rgba(15,33,71,.08)", width: "100%" },

    // Accordion
    accWrap: { display: "flex", flexDirection: "column", gap: 10 },
    accItem: {
      borderRadius: 16,
      border: "1px solid rgba(15,33,71,.10)",
      background: "linear-gradient(180deg,#ffffff,#fbfdff)",
      overflow: "hidden",
    },
    accHead: (open) => ({
      width: "100%",
      padding: "12px 14px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      cursor: "pointer",
      background: open ? "rgba(15,33,71,.04)" : "transparent",
      border: "none",
      textAlign: "left",
      color: "#0f2147",
      fontWeight: 950,
      letterSpacing: ".02em",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    }),
    accBody: {
      padding: "12px 14px",
      borderTop: "1px solid rgba(15,33,71,.08)",
    },
    bullet: {
      margin: "6px 0 0 0",
      paddingLeft: 18,
      color: "rgba(15,33,71,.86)",
      fontWeight: 650,
      lineHeight: 1.7,
      fontSize: 14,
    },

    reviewsHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    },
    reviewList: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginTop: 12,
    },
    reviewItem: {
      padding: 12,
      borderRadius: 14,
      border: "1px solid rgba(15,33,71,.10)",
      background: "linear-gradient(180deg,#ffffff,#fbfdff)",
    },
    reviewTop: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
    reviewName: { fontWeight: 950, color: "#0f2147", fontSize: 13 },
    reviewMeta: { color: "rgba(15,33,71,.62)", fontWeight: 800, fontSize: 12 },
    input: {
      width: "100%",
      borderRadius: 12,
      border: "1px solid rgba(15,33,71,.16)",
      padding: "10px 12px",
      fontWeight: 800,
      color: "#0f2147",
      background: "#fff",
      outline: "none",
      boxShadow: "0 6px 18px rgba(15,33,71,.06)",
    },
    textarea: {
      width: "100%",
      minHeight: 90,
      resize: "vertical",
      borderRadius: 12,
      border: "1px solid rgba(15,33,71,.16)",
      padding: "10px 12px",
      fontWeight: 700,
      color: "#0f2147",
      background: "#fff",
      outline: "none",
      boxShadow: "0 6px 18px rgba(15,33,71,.06)",
      lineHeight: 1.6,
    },
    reviewSubmit: {
      padding: "12px 16px",
      borderRadius: 999,
      fontWeight: 950,
      fontSize: 14,
      background: "#111827",
      color: "#fff",
      border: "1px solid #111827",
      cursor: "pointer",
      boxShadow: "0 14px 34px rgba(17,24,39,.18)",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    smallBtn: {
      padding: "10px 12px",
      borderRadius: 999,
      fontWeight: 900,
      fontSize: 12,
      background: "#fff",
      color: "#0f2147",
      border: "1px solid rgba(15,33,71,.18)",
      cursor: "pointer",
      boxShadow: "0 8px 18px rgba(15,33,71,.08)",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation",
    },
    select: {
      borderRadius: 12,
      border: "1px solid rgba(15,33,71,.16)",
      padding: "10px 12px",
      fontWeight: 900,
      color: "#0f2147",
      background: "#fff",
      outline: "none",
      boxShadow: "0 6px 18px rgba(15,33,71,.06)",
      cursor: "pointer",
    },
  };

  // Responsive
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const onResize = () => setIsNarrow(typeof window !== "undefined" && window.innerWidth < 980);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!product) return null;

  const gridStyle = isNarrow ? { ...S.grid, gridTemplateColumns: "1fr" } : S.grid;

  /* ---------------- details categories (only show real fields) ---------------- */
  const detailsSections = useMemo(() => {
    const src = A || {};
    const sections = [];

    const overviewText =
      toText(longDescription) ||
      pickAny(src, ["overview", "about", "story", "details_overview", "detailsOverview"]) ||
      null;

    const fabricText =
      toText(composition) ||
      pickAny(src, ["fabric_details", "fabricDetails", "materials", "material_details", "materialDetails"]) ||
      null;

    const careText = toText(care) || null;

    const designText =
      pickAny(src, ["design", "construction", "stitching", "artisan_note", "artisanNote", "craft_note", "craftNote"]) ||
      null;

    const shippingText = toText(shippingNote) || null;

    const extraPairs = [];
    const exclude = new Set([
      "id",
      "createdAt",
      "updatedAt",
      "publishedAt",
      "locale",
      "slug",
      "name",
      "title",
      "description",
      "long_description",
      "longDescription",
      "short_description",
      "shortDescription",
      "care",
      "care_instructions",
      "careInstructions",
      "composition",
      "material",
      "fabric",
      "shipping_note",
      "shippingNote",
      "images",
      "image",
      "cover",
      "gallery",
      "product_variants",
      "product_variant",
      "variants",
      "options",
      "codes",
    ]);

    Object.keys(src || {}).forEach((k) => {
      if (exclude.has(k)) return;
      const v = src[k];
      if (v == null) return;
      if (typeof v === "object") {
        const txt = toText(v);
        if (!txt) return;
        extraPairs.push([slugToLabel(k), txt]);
        return;
      }
      const txt = toText(v);
      if (!txt) return;
      extraPairs.push([slugToLabel(k), txt]);
    });

    if (overviewText) sections.push({ key: "overview", title: "Overview", type: "text", value: overviewText });
    if (highlights && highlights.length) sections.push({ key: "highlights", title: "Highlights", type: "bullets", value: highlights });
    if (fabricText || headerGsm || headerFit || headerSizeSystem)
      sections.push({
        key: "fabric",
        title: "Fabric & Build",
        type: "pairs",
        value: [
          ...(fabricText ? [["Composition", fabricText]] : []),
          ...(headerGsm ? [["GSM", String(headerGsm)]] : []),
          ...(headerFit ? [["Fit", String(headerFit)]] : []),
          ...(headerSizeSystem ? [["Size System", String(headerSizeSystem)]] : []),
          ...(pattern ? [["Pattern / Print", String(pattern)]] : []),
          ...(craft ? [["Craft / Embellishment", String(craft)]] : []),
          ...(wash ? [["Finish / Wash", String(wash)]] : []),
        ],
      });

    if (sizeGuide)
      sections.push({ key: "size", title: "Size & Fit Guide", type: "text", value: String(sizeGuide) });

    if (careText)
      sections.push({ key: "care", title: "Care Instructions", type: "text", value: String(careText) });

    if (designText)
      sections.push({ key: "design", title: "Design Notes", type: "text", value: String(designText) });

    if (origin || collection || season || occasion || warranty || tagsText)
      sections.push({
        key: "context",
        title: "Origin & Context",
        type: "pairs",
        value: [
          ...(origin ? [["Country of Origin", String(origin)]] : []),
          ...(collection ? [["Collection", String(collection)]] : []),
          ...(season ? [["Season", String(season)]] : []),
          ...(occasion ? [["Occasion", String(occasion)]] : []),
          ...(warranty ? [["Warranty", String(warranty)]] : []),
          ...(tagsText ? [["Tags", String(tagsText)]] : []),
        ],
      });

    if (shippingText)
      sections.push({ key: "shipping", title: "Shipping Note", type: "text", value: String(shippingText) });

    if (extraPairs.length)
      sections.push({
        key: "more",
        title: "Additional Information",
        type: "pairs",
        value: extraPairs,
      });

    return sections;
  }, [
    A,
    longDescription,
    composition,
    care,
    shippingNote,
    highlights,
    headerGsm,
    headerFit,
    headerSizeSystem,
    sizeGuide,
    origin,
    collection,
    season,
    occasion,
    pattern,
    craft,
    wash,
    warranty,
    tagsText,
  ]);

  const renderDetailSectionBody = (sec) => {
    if (!sec) return null;
    if (sec.type === "text") {
      return <p style={S.para}>{String(sec.value)}</p>;
    }
    if (sec.type === "bullets") {
      const list = Array.isArray(sec.value) ? sec.value : [];
      return (
        <ul style={S.bullet}>
          {list.map((t, i) => (
            <li key={i}>{String(t)}</li>
          ))}
        </ul>
      );
    }
    if (sec.type === "pairs") {
      const pairs = Array.isArray(sec.value) ? sec.value : [];
      return (
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: 10 }}>
          {pairs.map(([k, v], i) => (
            <div key={`${k}-${i}`} style={{ padding: 10, borderRadius: 14, border: "1px solid rgba(15,33,71,.10)", background: "#fff" }}>
              <div style={{ ...S.sectionLabel, marginBottom: 6 }}>{String(k)}</div>
              <p style={S.para}>{String(v)}</p>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  /* ---------------- render ---------------- */
  return (
    <>
      <Navbar />
      {toast?.open ? (
        <div style={S.toastWrap(toastPos)} role="status" aria-live="polite">
          <div style={S.toastCard(toast.type)}>
            <div>
              <div style={S.toastTitle}>{toast.title || "Notice"}</div>
              <div style={S.toastMsg}>{toast.message}</div>
            </div>
            <div style={S.toastActions}>
              {toast.actionLabel ? (
                <button
                  type="button"
                  style={S.toastBtn}
                  onClick={() => {
                    try {
                      toastActionRef.current?.();
                    } catch {}
                    closeToast();
                  }}
                >
                  {toast.actionLabel}
                </button>
              ) : null}
              <button type="button" style={S.toastClose} onClick={closeToast} aria-label="Close">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div style={S.page}>
        <div style={S.shell}>
          <div style={S.panel}>
            <div style={gridStyle}>
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
                    <img src={images[idx]} alt={name} style={S.heroImg} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: "#eef2ff" }} />
                  )}

                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        aria-label="Previous image"
                        onClick={() => setIdx((i) => (i - 1 + images.length) % images.length)}
                        style={{ ...S.navBtn, left: 14 }}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        aria-label="Next image"
                        onClick={() => setIdx((i) => (i + 1) % images.length)}
                        style={{ ...S.navBtn, right: 14 }}
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
                        <img src={t} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT: info */}
              <div style={S.right}>
                {/* Header row with premium wishlist/share section */}
                <div style={S.headerRow}>
                  <div style={S.titleColumn}>
                    <h1 style={S.title}>{name}</h1>

                    <div style={S.headerMetaRow}>
                      {tierLabel && tierText && <span style={S.tierText}>{tierText}</span>}
                      {headerFit && <span style={S.subtleMeta}>{headerFit}</span>}
                      {headerGsm && <span style={S.subtleMeta}>{headerGsm} GSM</span>}
                      {headerSizeSystem && <span style={S.subtleMeta}>{headerSizeSystem}</span>}
                      {primaryCategoryLabel && <span style={S.subtleMeta}>{primaryCategoryLabel}</span>}
                      {primaryAudienceLabel && <span style={S.subtleMeta}>{primaryAudienceLabel}</span>}
                    </div>

                    {shortDescription ? (
                      <div style={{ marginTop: 6 }}>
                        <p style={S.para}>{String(shortDescription)}</p>
                      </div>
                    ) : null}
                  </div>

                  {/* Distinct premium icon cluster */}
                  <div style={S.actionBar}>
                    <button
                      type="button"
                      onClick={(e) => {
                        // clickable anywhere on this CTA pill
                        e.preventDefault();
                        openWishlistPage();
                      }}
                      style={S.actionBtn("glass")}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-1px)";
                        e.currentTarget.style.boxShadow = "0 18px 38px rgba(15,33,71,.14)";
                        e.currentTarget.style.borderColor = "rgba(15,33,71,.22)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "0 12px 26px rgba(15,33,71,.10)";
                        e.currentTarget.style.borderColor = "rgba(15,33,71,.10)";
                      }}
                      aria-label="Open wishlist"
                    >
                      <IconWishlist filled={wishlisted} />
                      <span>Wishlist</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        shareProduct(e.currentTarget);
                      }}
                      style={S.actionBtn("outline")}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-1px)";
                        e.currentTarget.style.boxShadow = "0 18px 38px rgba(15,33,71,.14)";
                        e.currentTarget.style.borderColor = "rgba(15,33,71,.22)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "0 10px 22px rgba(15,33,71,.08)";
                        e.currentTarget.style.borderColor = "rgba(15,33,71,.18)";
                      }}
                      aria-label="Share"
                    >
                      <IconSharePremium />
                      <span>Share</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => copyText((typeof window !== "undefined" && window.location.href) || "", "Link copied.", e.currentTarget)}
                      style={S.actionBtn("outline")}
                      aria-label="Copy link"
                    >
                      <IconCopy />
                      <span>Copy</span>
                    </button>
                  </div>
                </div>

                <div style={S.priceRow}>
                  <span style={S.price}>{money(currencyCode, price)}</span>
                  {stock != null && (
                    <span style={S.badge(stock > 0)}>{stock > 0 ? `In stock (${stock})` : "Out of stock"}</span>
                  )}
                  {reviewStats.count > 0 ? (
                    <span style={S.subtleMeta}>
                      {reviewStats.avg} / 5 • {reviewStats.count} review{reviewStats.count === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span style={S.subtleMeta}>No reviews yet</span>
                  )}
                </div>

                {(productCode || baseSku || productBarcode || displaySku || displayBarcode || displayPid || displayVariantId || tierLabel) && (
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
                        <div style={S.metaValue}>
                          {productCode}
                          <button type="button" style={S.smallBtn} onClick={(e) => copyText(productCode, "Product code copied.", e.currentTarget)}>
                            Copy
                          </button>
                        </div>
                      </>
                    )}
                    {baseSku && (
                      <>
                        <div style={S.metaLabel}>Base SKU</div>
                        <div style={S.metaValue}>
                          {baseSku}
                          <button type="button" style={S.smallBtn} onClick={(e) => copyText(baseSku, "Base SKU copied.", e.currentTarget)}>
                            Copy
                          </button>
                        </div>
                      </>
                    )}
                    {displaySku && (
                      <>
                        <div style={S.metaLabel}>Variant SKU</div>
                        <div style={S.metaValue}>
                          {displaySku}
                          <button type="button" style={S.smallBtn} onClick={(e) => copyText(displaySku, "Variant SKU copied.", e.currentTarget)}>
                            Copy
                          </button>
                        </div>
                      </>
                    )}
                    {displayBarcode && (
                      <>
                        <div style={S.metaLabel}>Barcode</div>
                        <div style={S.metaValue}>
                          {displayBarcode}
                          <button type="button" style={S.smallBtn} onClick={(e) => copyText(displayBarcode, "Barcode copied.", e.currentTarget)}>
                            Copy
                          </button>
                        </div>
                      </>
                    )}
                    {displayVariantId && (
                      <>
                        <div style={S.metaLabel}>Variant ID</div>
                        <div style={S.metaValue}>
                          {displayVariantId}
                          <button type="button" style={S.smallBtn} onClick={(e) => copyText(String(displayVariantId), "Variant ID copied.", e.currentTarget)}>
                            Copy
                          </button>
                        </div>
                      </>
                    )}
                    {displayPid && (
                      <>
                        <div style={S.metaLabel}>PID</div>
                        <div style={S.metaValue}>
                          {String(displayPid)}
                          <button type="button" style={S.smallBtn} onClick={(e) => copyText(String(displayPid), "PID copied.", e.currentTarget)}>
                            Copy
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Color */}
                {!!colors.length && (
                  <div style={S.infoCard}>
                    <div style={S.sectionLabel}>Color</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {colors.map((c) => {
                        const active = normKey(selection.color) === normKey(c.name);
                        const code = c.code || c.name;
                        const light = isLightColor(code);
                        return (
                          <button
                            key={c.name + c.code}
                            type="button"
                            title={c.name}
                            onClick={() => {
                              setSelection({ color: c.name, size: null });
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
                                  borderRadius: 999,
                                  background: "#0f2147",
                                  color: "#ffffff",
                                  fontSize: 10,
                                  fontWeight: 900,
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
                      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 900, color: "#0f2147" }}>
                        Selected: {selection.color}
                      </div>
                    )}
                  </div>
                )}

                {/* Size (color-aware) + size-based pricing */}
                {!!sizes.length && (
                  <div style={S.infoCard}>
                    <div style={S.sectionLabel}>Size</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {sizes.map((s) => {
                        const active = normKey(selection.size) === normKey(s);
                        const sizeStock = sizeStockMap.get(s);
                        const isOOS = sizeStock != null && sizeStock <= 0;
                        const p = sizePriceMap.get(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              if (isOOS) return;
                              setSelection((sel) => ({ ...sel, size: s }));
                              setValidationError(null);
                            }}
                            style={S.chip(active, isOOS)}
                            title={isOOS ? `${s} - Out of stock` : s}
                            disabled={isOOS}
                          >
                            <span>{s}{isOOS ? " (OOS)" : ""}</span>
                            {typeof p === "number" ? (
                              <span style={S.chipSub}>{money(currencyCode, p)}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quantity */}
                <div style={S.infoCard}>
                  <div style={S.sectionLabel}>
                    Quantity {stock != null && stock > 0 ? `(Available: ${stock})` : ""}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setQty((q) => Math.max(1, q - 1));
                        setValidationError(null);
                      }}
                      style={{ ...S.chip(false, false), width: 46, minWidth: 46, height: 46 }}
                    >
                      −
                    </button>

                    <div style={{ minWidth: 56, textAlign: "center", fontWeight: 950, fontSize: 16 }}>{qty}</div>

                    <button
                      type="button"
                      onClick={() => {
                        setQty((q) => {
                          const next = q + 1;
                          if (stock != null) return Math.min(next, Math.max(1, stock));
                          return next;
                        });
                        setValidationError(null);
                      }}
                      style={{ ...S.chip(false, false), width: 46, minWidth: 46, height: 46 }}
                    >
                      +
                    </button>
                  </div>
                </div>

                {validationError && (
                  <div style={S.validationBox}>
                    <div style={S.validationTitle}>Notice</div>
                    <div>{validationError}</div>
                  </div>
                )}

                {/* CTA block — Add to Cart + Buy Now + Wishlist + Go to Cart (no deletions) */}
                <div style={S.ctas}>
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    style={{
                      ...S.primary,
                      background: "#111827",
                      border: "1px solid #111827",
                      ...(hoveredCTA === "add" ? S.primaryHover : null),
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
                      background: "#0f2147",
                      border: "1px solid #0f2147",
                      ...(hoveredCTA === "buynow" ? S.primaryHover : null),
                    }}
                    disabled={stock != null && stock <= 0}
                    onMouseEnter={() => setHoveredCTA("buynow")}
                    onMouseLeave={() => setHoveredCTA(null)}
                  >
                    Buy Now
                  </button>

                  <button
                    type="button"
                    onClick={(e) => toggleWishlist(e.currentTarget)}
                    style={{
                      ...S.primary,
                      background: "#0f2147",
                      border: "1px solid #0f2147",
                      ...(hoveredCTA === "wish" ? S.primaryHover : null),
                      opacity: wishlistBusy ? 0.88 : 1,
                    }}
                    onMouseEnter={() => setHoveredCTA("wish")}
                    onMouseLeave={() => setHoveredCTA(null)}
                    disabled={wishlistBusy}
                  >
                    {wishlisted ? "Wishlisted" : "Add to Wishlist"}
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/cart")}
                    style={{
                      ...S.ghost,
                      ...(hoveredCTA === "gocart" ? S.ghostHover : null),
                    }}
                    onMouseEnter={() => setHoveredCTA("gocart")}
                    onMouseLeave={() => setHoveredCTA(null)}
                  >
                    Go to Cart
                  </button>
                </div>

                <div style={S.divider} />

                {/* Deep Product Details (Strapi-driven, categorized, no placeholders) */}
                {detailsSections.length ? (
                  <div style={S.infoCard}>
                    <div style={S.sectionLabel}>Product Details</div>

                    <div style={S.accWrap}>
                      {detailsSections.map((sec) => {
                        const open = openDetailKey === sec.key;
                        return (
                          <div key={sec.key} style={S.accItem}>
                            <button
                              type="button"
                              style={S.accHead(open)}
                              onClick={() => setOpenDetailKey((k) => (k === sec.key ? "" : sec.key))}
                              aria-expanded={open ? "true" : "false"}
                            >
                              <span>{sec.title}</span>
                              <span style={{ fontSize: 18, opacity: 0.9 }}>{open ? "–" : "+"}</span>
                            </button>
                            {open ? <div style={S.accBody}>{renderDetailSectionBody(sec)}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Specifications (kept) */}
                {(headerFit || headerGsm || headerSizeSystem || selection.color || selection.size) && (
                  <div style={S.infoCard}>
                    <div style={S.sectionLabel}>Specifications</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {headerFit ? (
                        <div>
                          <div style={S.sectionLabel}>Fit</div>
                          <p style={S.para}>{String(headerFit)}</p>
                        </div>
                      ) : null}
                      {headerGsm ? (
                        <div>
                          <div style={S.sectionLabel}>GSM</div>
                          <p style={S.para}>{String(headerGsm)}</p>
                        </div>
                      ) : null}
                      {headerSizeSystem ? (
                        <div>
                          <div style={S.sectionLabel}>Size System</div>
                          <p style={S.para}>{String(headerSizeSystem)}</p>
                        </div>
                      ) : null}
                      {selection.color ? (
                        <div>
                          <div style={S.sectionLabel}>Selected Color</div>
                          <p style={S.para}>{String(selection.color)}</p>
                        </div>
                      ) : null}
                      {selection.size ? (
                        <div>
                          <div style={S.sectionLabel}>Selected Size</div>
                          <p style={S.para}>{String(selection.size)}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

                {/* Reviews (DB-based): sort + pagination + vote + report */}
                <div style={S.infoCard}>
                  <div style={S.reviewsHeader}>
                    <div>
                      <div style={S.sectionLabel}>Customer Reviews</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 950, color: "#0f2147" }}>
                          {reviewStats.count ? `${reviewStats.avg} / 5` : "No ratings yet"}
                        </span>
                        <span style={{ color: "rgba(15,33,71,.65)", fontWeight: 900 }}>
                          {reviewStats.count ? `${reviewStats.count} review${reviewStats.count === 1 ? "" : "s"}` : ""}
                        </span>

                        <select
                          value={reviewSort}
                          onChange={(e) => setReviewSort(e.target.value)}
                          style={S.select}
                          aria-label="Sort reviews"
                        >
                          <option value="recent">Most Recent</option>
                          <option value="helpful">Most Helpful</option>
                          <option value="highest">Highest Rating</option>
                          <option value="lowest">Lowest Rating</option>
                        </select>

                        <button type="button" onClick={() => loadReviews({ reset: true })} style={S.smallBtn} disabled={reviewsBusy}>
                          Refresh
                        </button>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ ...S.sectionLabel, marginBottom: 0 }}>Your Rating</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            filled={reviewRating >= n}
                            onClick={() => {
                              setReviewRating(n);
                              setValidationError(null);
                            }}
                            title={`Rate ${n} star${n === 1 ? "" : "s"}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {reviewsError ? (
                    <div style={{ ...S.validationBox, marginTop: 12 }}>
                      <div style={S.validationTitle}>Reviews Error</div>
                      <div>{reviewsError}</div>
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr", gap: 10, marginTop: 12 }}>
                    <div>
                      <div style={S.sectionLabel}>Name (optional)</div>
                      <input value={reviewName} onChange={(e) => setReviewName(e.target.value)} style={S.input} />
                    </div>
                    <div>
                      <div style={S.sectionLabel}>Email (optional)</div>
                      <input value={reviewEmail} onChange={(e) => setReviewEmail(e.target.value)} style={S.input} />
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <div style={S.sectionLabel}>Your Review (optional)</div>
                    <div style={{ ...S.subtleMeta, marginTop: 4 }}>You can submit only a star rating, or add a short review.</div>
                    <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} style={S.textarea} />
                  </div>

                  <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      onClick={(e) => submitReview(e.currentTarget)}
                      style={S.reviewSubmit}
                      disabled={reviewSubmitBusy}
                    >
                      {reviewSubmitBusy ? "Submitting..." : (String(reviewComment || "").trim().length ? "Submit Review" : "Submit Rating")}
                    </button>
                  </div>

                  <div style={S.reviewList}>
                    {reviewsBusy ? (
                      <div style={{ ...S.subtleMeta, alignSelf: "flex-start" }}>Loading…</div>
                    ) : null}

                    {!reviewsBusy && (!reviews || reviews.length === 0) ? (
                      <div style={{ marginTop: 10 }}>
                        <p style={S.para}>No reviews yet. Be the first to review this product.</p>
                      </div>
                    ) : null}

                    {Array.isArray(reviews) &&
                      reviews.map((r, i) => {
                        const rating = Number(r?.rating ?? r?.stars ?? r?.score ?? 0);
                        const comment = r?.body ?? r?.comment ?? r?.message ?? r?.text ?? "";
                        const by = r?.displayName ?? r?.name ?? r?.customerName ?? r?.user?.name ?? "Customer";
                        const created = r?.createdAt || r?.created_at || r?.date || r?.timestamp || null;

                        const helpfulCount = Number(r?.helpfulCount ?? 0);
                        const notHelpfulCount = Number(r?.notHelpfulCount ?? 0);
                        const myVote = Number(r?.myVote ?? 0);

                        return (
                          <div key={r?.id || `${i}`} style={S.reviewItem}>
                            <div style={S.reviewTop}>
                              <div style={S.reviewName}>{String(by)}</div>
                              <div style={S.reviewMeta}>{created ? String(created) : ""}</div>
                            </div>

                            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star key={n} filled={rating >= n} onClick={() => {}} title="" size={16} disabled />
                              ))}
                            </div>

                            {comment ? (
                              <div style={{ marginTop: 8 }}>
                                <p style={S.para}>{String(comment)}</p>
                              </div>
                            ) : null}

                            {r?.id ? (
                              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => voteReview(r.id, 1)}
                                  style={S.smallBtn}
                                  title="Helpful"
                                >
                                  Helpful {helpfulCount ? `(${helpfulCount})` : ""}
                                  {myVote === 1 ? " • Selected" : ""}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => voteReview(r.id, -1)}
                                  style={S.smallBtn}
                                  title="Not Helpful"
                                >
                                  Not Helpful {notHelpfulCount ? `(${notHelpfulCount})` : ""}
                                  {myVote === -1 ? " • Selected" : ""}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setReportOpenId(String(r.id));
                                    setReportReason("");
                                    setValidationError(null);
                                  }}
                                  style={S.smallBtn}
                                  title="Report review"
                                >
                                  Report
                                </button>
                              </div>
                            ) : null}

                            {reportOpenId && String(reportOpenId) === String(r?.id) ? (
                              <div style={{ marginTop: 10, padding: 10, borderRadius: 14, border: "1px solid rgba(15,33,71,.14)", background: "#fff" }}>
                                <div style={S.sectionLabel}>Report Reason</div>
                                <textarea value={reportReason} onChange={(e) => setReportReason(e.target.value)} style={S.textarea} />
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                                  <button
                                    type="button"
                                    style={S.smallBtn}
                                    onClick={() => {
                                      setReportOpenId(null);
                                      setReportReason("");
                                    }}
                                    disabled={reportBusy}
                                  >
                                    Cancel
                                  </button>
                                  <button type="button" style={S.reviewSubmit} onClick={reportReview} disabled={reportBusy}>
                                    {reportBusy ? "Submitting..." : "Submit Report"}
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}

                    {!reviewsBusy && reviewHasMore ? (
                      <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
                        <button type="button" onClick={loadMoreReviews} style={S.reviewSubmit}>
                          Load More Reviews
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div style={{ height: 10 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <BottomFloatingBar />
    </>
  );
}
