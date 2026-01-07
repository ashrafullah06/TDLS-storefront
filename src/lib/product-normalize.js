// FILE: src/lib/product-normalize.js

// ───────────────────────── basic tolerant utilities ─────────────────────────

export const ABS = (u) => {
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

export const get = (o, p) =>
  p
    ?.toString()
    .split(".")
    .reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);

export const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];

// ───────────────────────── variant reader (QuickView-aligned) ─────────────────────────

function readVariantsRaw(p) {
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

  // Legacy: product_variant (singular or array-ish)
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
    return A.variants.data.map((n) => {
      const attrs = n?.attributes || {};
      return { id: n.id, ...attrs };
    });
  }

  // Sometimes options is effectively variants
  if (Array.isArray(A?.options)) return A.options;

  return [];
}

// ───────────────────────── fallback colors + sizes ─────────────────────────

export function fallbackColors(p) {
  const A = p?.attributes || {};
  const candidates =
    [p?.colors, A?.colors, A?.color_options, A?.color_names, get(A, "color.data")].flat?.() ||
    [];

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
}

export function fallbackSizes(p) {
  const A = p?.attributes || {};
  const candidates = [p?.sizes, A?.sizes, A?.size_options, A?.size_names].flat?.() || [];
  return (Array.isArray(candidates) ? candidates : [])
    .map((s) => (typeof s === "string" ? s : s?.name || s?.label))
    .filter(Boolean);
}

// ───────────────────────── image collector (QuickView-aligned) ─────────────────────────

export function collectImages(product, variants = [], selectedColor = null) {
  const s = new Set();
  const add = (u) => u && s.add(ABS(u));
  const addData = (arr) =>
    Array.isArray(arr) && arr.forEach((n) => add(n?.attributes?.url || n?.url || n));

  // Public-shape: cover_image + gallery (urls/objects)
  add(product?.cover_image);
  if (Array.isArray(product?.gallery)) {
    product.gallery.forEach((g) => add(g?.url || g));
  }

  // Top-level REST-ish fields
  add(product?.image);
  Array.isArray(product?.images) && product.images.forEach((x) => add(x?.url || x));
  addData(product?.images?.data);
  add(get(product, "gallery.url"));
  addData(get(product, "gallery.data"));
  add(get(product, "cover.data.attributes.url"));
  add(get(product, "og_image_Social_Media.data.attributes.url"));

  // attributes-level mirrors
  const A = product?.attributes || {};
  add(A?.cover_image);
  if (Array.isArray(A?.gallery)) {
    A.gallery.forEach((g) => add(g?.url || g));
  }
  add(A?.image);
  Array.isArray(A?.images) && A.images.forEach((x) => add(x?.url || x));
  addData(A?.images?.data);
  add(get(A, "gallery.url"));
  addData(A?.gallery?.data);
  add(get(A, "cover.data.attributes.url"));

  // variant-specific images
  (variants || []).forEach((v) => {
    if (!v) return;
    if (selectedColor && v.color_name && v.color_name !== selectedColor) return;

    if (v.image) add(v.image);

    if (Array.isArray(v.images)) {
      v.images.forEach((img) => add(img?.url || img));
    }
    if (Array.isArray(v.images?.data)) {
      v.images.data.forEach((img) => add(img?.attributes?.url || img?.url));
    }
  });

  return [...s];
}

// ───────────────────────── canonical variant normalization ─────────────────────────
/**
 * This is aligned with QuickView's normalizeVariants, but enriched with:
 *  - strapiSizeId, sizeRowId, variantNodeId (for ProductCard recent-view meta)
 *  - productCode/baseSku/productBarcode aliases
 */
export function normVariants(product) {
  const base = readVariantsRaw(product);
  const A = product?.attributes || {};

  const productId = product?.id || A?.id || null;
  const productSlug = product?.slug || A?.slug || null;

  const codes = product?.codes || A?.codes || {};
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
        (typeof v?.color === "string" ? v.color : null) ||
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

      // Prefer Prisma-style stockAvailable at VARIANT level
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
        // ── nested sizes[]: each size becomes its own normalized row ──
        sizes.forEach((sz) => {
          if (!sz) return;

          const size_name =
            sz?.size_name ||
            sz?.size ||
            sz?.name ||
            sz?.label ||
            v?.size_name ||
            v?.size ||
            null;

          const price =
            typeof sz?.effective_price === "number"
              ? sz.effective_price
              : typeof sz?.price_override === "number"
              ? sz.price_override
              : typeof sz?.price === "number"
              ? sz.price
              : variantMinPrice;

          // Prefer Prisma stockAvailable at SIZE level, then fall back
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

          const sku = sz?.sku || sz?.variant_sku || v?.sku || v?.variant_sku || null;
          const barcode =
            sz?.barcode || sz?.variant_barcode || v?.barcode || v?.variant_barcode || null;

          const sz_prisma_id =
            sz?.prisma_id ||
            sz?.pid ||
            sz?.variant_pid ||
            pv_prisma_id ||
            null;

          const strapiSizeId =
            size_stock_id ??
            v?.strapiSizeId ??
            v?.strapi_size_id ??
            v?.size_id ??
            v?.variantId ??
            null;

          const primaryId = strapiSizeId ?? size_stock_id ?? pv_id ?? null;

          flattened.push({
            // core identity
            id: primaryId,

            // aliases used by ProductCard / QuickView
            pv_id,
            size_id: size_stock_id,
            size_stock_id,
            pid: sz_prisma_id,
            prisma_id: sz_prisma_id,

            // extra aliases for other components
            strapiSizeId,
            sizeRowId: size_stock_id,
            variantNodeId: pv_id,
            productId,
            productSlug,

            // product-level codes (both snake + camel for convenience)
            product_code,
            base_sku,
            product_barcode,
            productCode: product_code,
            baseSku: base_sku,
            productBarcode: product_barcode,

            // human labels
            color_name,
            color_code,
            size_name,
            colorLabel: color_name,
            sizeLabel: size_name,

            // sku/barcode surfaced at row level
            sku,
            barcode,

            // presentation
            image: img ? ABS(img) : null,
            price,
            stock,

            // debug snapshot
            raw: {
              variant: v,
              size: sz,
            },
          });
        });
      } else {
        // ── simple variant row ──
        const size_name =
          v?.size_name ||
          v?.size?.name ||
          v?.size?.data?.attributes?.name ||
          (typeof v?.size === "string" ? v.size : null) ||
          null;

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

        const stock = variantStockTotal;

        const strapiSizeId =
          v?.strapiSizeId ||
          v?.strapi_size_id ||
          v?.size_id ||
          v?.id ||
          v?.variantId ||
          null;

        const primaryId = strapiSizeId ?? pv_id ?? null;

        const sku = v?.sku || v?.variant_sku || null;
        const barcode = v?.barcode || v?.variant_barcode || null;

        flattened.push({
          id: primaryId,

          pv_id,
          size_id: null,
          size_stock_id: null,
          pid: pv_prisma_id,
          prisma_id: pv_prisma_id,

          strapiSizeId,
          sizeRowId: null,
          variantNodeId: pv_id,
          productId,
          productSlug,

          product_code,
          base_sku,
          product_barcode,
          productCode: product_code,
          baseSku: base_sku,
          productBarcode: product_barcode,

          color_name,
          color_code,
          size_name,
          colorLabel: color_name,
          sizeLabel: size_name,

          sku,
          barcode,

          image: variantImg ? ABS(variantImg) : null,
          price,
          stock,

          raw: {
            variant: v,
          },
        });
      }
    });

    return flattened;
  }

  // ── synthetic combos when no explicit variants exist ──
  const colors = fallbackColors(product);
  const sizes = fallbackSizes(product);
  if (!colors.length && !sizes.length) return [];

  const imgs = collectImages(product, [], null);
  const priceRange = product?.price_range || A?.price_range || null;

  const basePrice =
    typeof product?.price_sale === "number"
      ? product.price_sale
      : typeof product?.base_price === "number"
      ? product.base_price
      : typeof A?.base_price === "number"
      ? A.base_price
      : typeof priceRange?.min === "number"
      ? priceRange.min
      : typeof product?.price === "number"
      ? product.price
      : typeof A?.price === "number"
      ? A.price
      : typeof product?.discount_price === "number"
      ? product.discount_price
      : typeof A?.discount_price === "number"
      ? A.discount_price
      : null;

  const combos = [];

  if (colors.length && sizes.length) {
    colors.forEach((c) =>
      sizes.forEach((s) =>
        combos.push({
          id: null,
          pv_id: null,
          size_id: null,
          size_stock_id: null,
          pid: null,
          prisma_id: null,
          strapiSizeId: null,
          sizeRowId: null,
          variantNodeId: null,
          productId,
          productSlug,
          product_code,
          base_sku,
          product_barcode,
          productCode: product_code,
          baseSku: base_sku,
          productBarcode: product_barcode,
          color_name: c.name,
          color_code: c.code,
          size_name: s,
          colorLabel: c.name,
          sizeLabel: s,
          sku: null,
          barcode: null,
          image: imgs[0] || null,
          price: basePrice,
          stock: null,
          raw: null,
        })
      )
    );
  } else if (colors.length) {
    colors.forEach((c) =>
      combos.push({
        id: null,
        pv_id: null,
        size_id: null,
        size_stock_id: null,
        pid: null,
        prisma_id: null,
        strapiSizeId: null,
        sizeRowId: null,
        variantNodeId: null,
        productId,
        productSlug,
        product_code,
        base_sku,
        product_barcode,
        productCode: product_code,
        baseSku: base_sku,
        productBarcode: product_barcode,
        color_name: c.name,
        color_code: c.code,
        size_name: null,
        colorLabel: c.name,
        sizeLabel: null,
        sku: null,
        barcode: null,
        image: imgs[0] || null,
        price: basePrice,
        stock: null,
        raw: null,
      })
    );
  } else {
    sizes.forEach((s) =>
      combos.push({
        id: null,
        pv_id: null,
        size_id: null,
        size_stock_id: null,
        pid: null,
        prisma_id: null,
        strapiSizeId: null,
        sizeRowId: null,
        variantNodeId: null,
        productId,
        productSlug,
        product_code,
        base_sku,
        product_barcode,
        productCode: product_code,
        baseSku: base_sku,
        productBarcode: product_barcode,
        color_name: null,
        color_code: null,
        size_name: s,
        colorLabel: null,
        sizeLabel: s,
        sku: null,
        barcode: null,
        image: imgs[0] || null,
        price: basePrice,
        stock: null,
        raw: null,
      })
    );
  }

  return combos;
}

// ───────────────────────── stock derivation (QuickView-aligned) ─────────────────────────

export function deriveStock(product, variants = [], sel = {}) {
  const A = product?.attributes || {};

  // product-level fallback stock when no variants
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

  if (!variants || !variants.length) return pStock;

  const candidates = variants.filter(
    (v) =>
      (!sel.color || v.color_name === sel.color) &&
      (!sel.size || v.size_name === sel.size)
  );

  const pool = candidates.length ? candidates : variants;

  // Prefer stockAvailable on normalized variant if we ever attach it;
  // otherwise use stock / stock_quantity / inventory, exactly like QuickView does.
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
}

// ───────────────────────── currency symbol helper ─────────────────────────

export function currencySymbol(c = "BDT") {
  const m = {
    BDT: "৳",
    USD: "$",
    EUR: "€",
    GBP: "£",
  };
  const key = String(c || "").toUpperCase();
  return m[key] || "";
}
