//✅ FILE: app/(admin)/admin/orders/[id]/receipt/page.jsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { headers, cookies } from "next/headers";

import ReceiptDownloadButton from "@/components/checkout/receipt-download-button";
import ReceiptPrintButton from "@/components/checkout/receipt-print-button";

/* ───────── helpers ───────── */

function money(n, currency = "BDT") {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return currency === "BDT" ? "৳ 0.00" : `${currency} 0.00`;

  const abs = Math.abs(x);
  const out = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === "BDT") return `৳ ${out}`;
  return `${currency} ${out}`;
}

function fmtDateTime(d) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function safeStr(v) {
  return v == null ? "" : String(v);
}

function pickFirst(...vals) {
  for (const v of vals) {
    const s = safeStr(v).trim();
    if (s) return s;
  }
  return "";
}

const PAIDLIKE = new Set(["PAID", "CAPTURED", "SUCCEEDED", "SUCCESS"]);
const sumPaid = (payments = []) =>
  payments.reduce((s, p) => {
    const st = String(p?.status || "").toUpperCase();
    return PAIDLIKE.has(st) ? s + Number(p.amount || 0) : s;
  }, 0);

const safe = (v) => (v == null || v === "" ? "—" : v);

const toNum = (v, fallback = NaN) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

// Align with schema: Order.taxTotal, Order.discountTotal, Order.shippingTotal, Order.subtotal, Order.grandTotal
const safeVat = (order) => toNum(order?.taxTotal ?? order?.vatTotal ?? order?.vat ?? 0, 0) || 0;
const safeDiscount = (order) => toNum(order?.discountTotal ?? order?.discount ?? 0, 0) || 0;
const safeShipping = (order) => toNum(order?.shippingTotal ?? order?.shippingCharge ?? order?.shipping ?? 0, 0) || 0;
const safeSubtotal = (order) => toNum(order?.subtotal ?? order?.subTotal ?? order?.itemsSubtotal ?? 0, 0) || 0;
const safeGrand = (order) => toNum(order?.grandTotal ?? order?.total ?? order?.amountTotal ?? 0, 0) || 0;

/* ───────── admin session guard (uses your existing /api/admin/session) ───────── */

/** ✅ FIX: strict admin cookie forwarding only (prevents any customer-plane dependency/leak) */
function isAdminCookieName(name) {
  const n = String(name || "");
  return n.startsWith("tdlc_a_") || n.startsWith("__Host-tdlc_a_") || n.startsWith("__Secure-tdlc_a_");
}

async function requireAdminSession() {
  try {
    // ✅ FIX: Next.js dynamic APIs must be awaited
    const h = await headers();
    const jar = await cookies();

    const proto = h.get("x-forwarded-proto") || "http";
    const host = h.get("x-forwarded-host") || h.get("host");
    if (!host) return null;

    // ✅ FIX: forward ONLY admin cookies (no customer cookies, no guest cookies)
    const cookieHeader = jar
      .getAll()
      .filter((c) => isAdminCookieName(c?.name))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    if (!cookieHeader) return null;

    // keep your same endpoint + options; add ts to avoid any proxy cache edge cases
    const url = `${proto}://${host}/api/admin/session?include=roles,permissions,capabilities,policy&ts=${Date.now()}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { cookie: cookieHeader, "user-agent": h.get("user-agent") || "" },
      cache: "no-store",
      next: { revalidate: 0 },
    });

    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    if (!data) return null;

    if (data.ok === true) return data;
    if (data.user || data.session || data.admin) return data;

    return null;
  } catch {
    return null;
  }
}

/* ───────── robust item meta extraction ───────── */

function looksJsonString(v) {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  return (s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"));
}

function tryParseJson(v) {
  if (!looksJsonString(v)) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function normalizeObj(v) {
  if (v && typeof v === "object") return v;
  const parsed = tryParseJson(v);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur) return undefined;

    // If current node is a JSON string, parse it and continue.
    if (typeof cur === "string") {
      const parsed = tryParseJson(cur);
      if (parsed && typeof parsed === "object") cur = parsed;
    }

    if (Array.isArray(cur) && /^\d+$/.test(p)) {
      cur = cur[Number(p)];
      continue;
    }

    if (typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function getAny(obj, paths) {
  for (const p of paths) {
    const v = p.includes(".") ? getPath(obj, p) : obj?.[p];
    const s = safeStr(v).trim();
    if (s) return v;
  }
  return undefined;
}

/**
 * ✅ FIX: For numeric fields (unit price / totals), do NOT stop at "0".
 * Prefer first positive number; fallback to first finite number if no positive exists.
 */
function getAnyNumberPreferPositive(obj, paths) {
  let firstFinite = undefined;

  for (const p of paths) {
    const v = p.includes(".") ? getPath(obj, p) : obj?.[p];
    const n = Number(v);

    if (!Number.isFinite(n)) continue;

    if (firstFinite === undefined) firstFinite = n;
    if (n > 0) return n;
  }

  return firstFinite;
}

function compactMetaLine(parts, max = 10) {
  const clean = parts
    .map((p) => safeStr(p).trim())
    .filter(Boolean)
    .slice(0, max);
  return clean.length ? clean.join(" · ") : "";
}

function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return `${x.toFixed(0)}%`;
}

function extractFromOptionsArray(arr) {
  if (!Array.isArray(arr)) return { size: "", color: "", hex: "" };

  let size = "";
  let color = "";
  let hex = "";

  for (const it of arr) {
    const o = normalizeObj(it) || it;
    if (!o || typeof o !== "object") continue;

    const name = pickFirst(o.name, o.key, o.label, o.title, o.type, "").toLowerCase();
    const value = pickFirst(o.value, o.val, o.option, o.selected, o.choice, o.text, o.nameValue, "");

    if (!size && (name === "size" || name.includes("size"))) size = value;
    if (!color && (name === "color" || name.includes("color"))) color = value;

    const maybeHex = pickFirst(o.hex, o.colorHex, o.valueHex, o.code, "");
    if (!hex && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(maybeHex || "").trim())) hex = maybeHex;
  }

  return { size, color, hex };
}

function extractFromStringBlob(s) {
  const text = safeStr(s);
  if (!text) return { size: "", color: "", hex: "" };

  const sizeMatch =
    text.match(/(?:^|[\s,{([|/\\-])size\s*[:=\-]\s*([a-z0-9.+# _-]{1,20})/i) ||
    text.match(/(?:^|[\s,{([|/\\-])sz\s*[:=\-]\s*([a-z0-9.+# _-]{1,20})/i);

  const colorMatch =
    text.match(/(?:^|[\s,{([|/\\-])color\s*[:=\-]\s*([a-z0-9.+# _-]{1,30})/i) ||
    text.match(/(?:^|[\s,{([|/\\-])colour\s*[:=\-]\s*([a-z0-9.+# _-]{1,30})/i);

  const hexMatch = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})/i);

  const size = sizeMatch ? safeStr(sizeMatch[1]).trim() : "";
  const color = colorMatch ? safeStr(colorMatch[1]).trim() : "";
  const hex = hexMatch ? `#${hexMatch[1]}`.trim() : "";

  return { size, color, hex };
}

function extractSizeColor(it) {
  const sizeFromVariant = pickFirst(
    getAny(it, ["variant.sizeName", "variant.sizeLabel", "variant.primaryValue", "variant.secondaryValue"]),
    ""
  );
  const colorFromVariant = pickFirst(getAny(it, ["variant.colorName", "variant.colorLabel"]), "");
  const hexFromVariant = pickFirst(getAny(it, ["variant.colorCode", "variant.colorHex", "variant.hex"]), "");

  const sizeDirect = pickFirst(
    sizeFromVariant,
    getAny(it, [
      "size",
      "variantSize",
      "selectedSize",
      "optionSize",
      "options.size",
      "variant.size",
      "variant.attributes.size",
      "attributes.size",
      "meta.size",
      "snapshot.size",
      "snapshot.variant.size",
      "variantSnapshot.size",
      "selection.size",
      "chosen.size",
      "lineItem.size",
      "line_item.size",
      "variantInfo.size",
      "variantData.size",
      "variantMeta.size",
      "variantSelection.size",
    ]),
    ""
  );

  const colorDirect = pickFirst(
    colorFromVariant,
    getAny(it, [
      "color",
      "variantColor",
      "selectedColor",
      "optionColor",
      "options.color",
      "variant.color",
      "variant.attributes.color",
      "attributes.color",
      "meta.color",
      "snapshot.color",
      "snapshot.variant.color",
      "variantSnapshot.color",
      "selection.color",
      "chosen.color",
      "lineItem.color",
      "line_item.color",
      "variantInfo.color",
      "variantData.color",
      "variantMeta.color",
      "variantSelection.color",
    ]),
    ""
  );

  const hexDirect = pickFirst(
    hexFromVariant,
    getAny(it, [
      "colorHex",
      "hex",
      "variantColorHex",
      "options.colorHex",
      "variant.colorHex",
      "attributes.colorHex",
      "meta.colorHex",
      "snapshot.colorHex",
      "snapshot.variant.colorHex",
      "variantInfo.colorHex",
      "variantData.colorHex",
      "variantMeta.colorHex",
      "variantSelection.colorHex",
    ]),
    ""
  );

  const optionContainers = [
    it?.options,
    it?.option,
    it?.attributes,
    it?.meta,
    it?.variant,
    it?.variantAttributes,
    it?.variant_options,
    it?.variantOptions,
    it?.selectedOptions,
    it?.selected_options,
    it?.chosenOptions,
    it?.customization,
    it?.snapshot,
    it?.variantSnapshot,
    it?.lineItem,
    it?.line_item,
    it?.variantInfo,
    it?.variantData,
    it?.variantMeta,
    it?.variantSelection,
    it?.selection,
  ];

  let size = sizeDirect;
  let color = colorDirect;
  let hex = hexDirect;

  for (const c0 of optionContainers) {
    const c = normalizeObj(c0) || c0;
    if (!c) continue;

    if (!size) size = pickFirst(getAny(c, ["size", "Size", "variantSize", "selectedSize"]), "");
    if (!color) color = pickFirst(getAny(c, ["color", "Color", "variantColor", "selectedColor"]), "");
    if (!hex) hex = pickFirst(getAny(c, ["hex", "colorHex", "ColorHex", "variantColorHex", "selectedColorHex"]), "");

    const arr =
      (Array.isArray(c) && c) ||
      normalizeObj(c?.items) ||
      normalizeObj(c?.values) ||
      normalizeObj(c?.options) ||
      normalizeObj(c?.attributes) ||
      c?.items ||
      c?.values ||
      c?.options ||
      c?.attributes;

    const asArray = Array.isArray(arr) ? arr : Array.isArray(c) ? c : null;
    if (asArray) {
      const got = extractFromOptionsArray(asArray);
      if (!size && got.size) size = got.size;
      if (!color && got.color) color = got.color;
      if (!hex && got.hex) hex = got.hex;
    }

    if (typeof c === "object" && !Array.isArray(c)) {
      if (!size) size = pickFirst(c.Size, c.size, c.S, c.s, "");
      if (!color) color = pickFirst(c.Color, c.color, c.C, c.c, "");
    }

    if (size && color) break;
  }

  if (!size || !color || !hex) {
    const blobs = [
      it?.variantTitle,
      it?.variantName,
      it?.variantLabel,
      it?.title,
      it?.name,
      it?.description,
      it?.meta,
      it?.attributes,
      it?.options,
      it?.snapshot,
      it?.variantSnapshot,
      it?.variantInfo,
      it?.variantData,
      it?.variantMeta,
      it?.variantSelection,
      it?.variant?.title,
    ];

    for (const b of blobs) {
      const got = extractFromStringBlob(b);
      if (!size && got.size) size = got.size;
      if (!color && got.color) color = got.color;
      if (!hex && got.hex) hex = got.hex;
      if (size && color) break;
    }
  }

  return {
    size: safeStr(size).trim(),
    color: safeStr(color).trim(),
    colorHex: safeStr(hex).trim(),
  };
}

function itemMeta(it, currency = "BDT") {
  const sku = pickFirst(getAny(it, ["sku", "SKU", "variantSku", "productSku", "skuCode", "code", "itemCode", "variant.sku"]), "");
  const ean = pickFirst(getAny(it, ["ean", "EAN", "ean13", "barcode", "barCode", "variant.barcode"]), "");
  const pid = pickFirst(getAny(it, ["productId", "strapiProductId", "product_id", "variant.productId"]), "");
  const vid = pickFirst(getAny(it, ["variantId", "strapiVariantId", "variant_id", "variant.id"]), "");

  const variantLabel = pickFirst(
    getAny(it, [
      "variantTitle",
      "variantName",
      "variantLabel",
      "variant.title",
      "variant.name",
      "snapshot.variantTitle",
      "snapshot.variantName",
      "variantInfo.title",
      "variantInfo.name",
      "variantData.title",
      "variantData.name",
    ]),
    ""
  );

  const { size, color, colorHex } = extractSizeColor(it);

  const unitPrice = toNum(getAny(it, ["unitPrice", "price", "unit", "salePrice", "finalPrice", "unitFinalPrice"]), 0);

  const originalUnit = toNum(
    getAny(it, ["compareAtPrice", "compareAt", "mrp", "listPrice", "regularPrice", "originalUnitPrice", "unitOriginalPrice"]),
    NaN
  );

  const discountAmount = toNum(getAny(it, ["discountAmount", "discount", "lineDiscount", "discountTotal", "discount_value"]), NaN);
  const discountPctExplicit = toNum(getAny(it, ["discountPercent", "discount_percentage", "discountPct"]), NaN);

  const idLine = compactMetaLine([sku ? `SKU: ${sku}` : "", ean ? `EAN: ${ean}` : "", pid ? `PID: ${pid}` : "", vid ? `VID: ${vid}` : ""]);
  const variantLine = compactMetaLine([variantLabel ? `Variant: ${variantLabel}` : "", colorHex ? `HEX: ${colorHex}` : ""]);

  const scCtx = compactMetaLine([size ? `Size ${size}` : "", color ? `Color ${color}` : ""], 3);

  let pricingLine = "";
  if (Number.isFinite(originalUnit) && originalUnit > 0 && originalUnit > unitPrice) {
    const inferredPct = originalUnit ? ((originalUnit - unitPrice) / originalUnit) * 100 : NaN;
    const pctOut = Number.isFinite(discountPctExplicit) ? discountPctExplicit : inferredPct;

    pricingLine = compactMetaLine(
      [
        scCtx ? `Selected: ${money(unitPrice, currency)} (${scCtx})` : `Selected: ${money(unitPrice, currency)}`,
        `MRP: ${money(originalUnit, currency)}`,
        Number.isFinite(pctOut) ? `Off: ${pct(pctOut)}` : "",
      ],
      6
    );
  } else if (unitPrice > 0) {
    pricingLine = scCtx ? `Selected: ${money(unitPrice, currency)} (${scCtx})` : `Selected: ${money(unitPrice, currency)}`;
  }

  const discountLine = Number.isFinite(discountAmount) && discountAmount > 0 ? `Discount: ${money(discountAmount, currency)}` : "";

  return {
    sku,
    ean,
    pid,
    vid,
    size,
    color,
    colorHex,
    variantLabel,
    unitPrice,
    originalUnit,
    idLine,
    variantLine,
    pricingLine,
    discountLine,
  };
}

/* ───────── DB-backed product title resolver (no schema assumptions) ───────── */

function isSafeIdent(s) {
  return typeof s === "string" && /^[A-Za-z0-9_]+$/.test(s);
}

function pickBestTitleColumn(cols) {
  const c = cols.map((x) => String(x || ""));
  const exact = ["title", "name", "productTitle", "productName", "displayName", "label"];
  for (const k of exact) {
    const hit = c.find((x) => x.toLowerCase() === k.toLowerCase());
    if (hit) return hit;
  }
  const containsOrder = ["title", "name", "display", "label"];
  for (const key of containsOrder) {
    const hit = c.find((x) => x.toLowerCase().includes(key));
    if (hit) return hit;
  }
  return "";
}

async function buildProductTitleLookup(prismaClient) {
  let productTable = "";
  let titleCol = "";
  const cache = new Map();

  try {
    const like = "%product%";
    const tables = await prismaClient.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public'
        AND table_type='BASE TABLE'
        AND table_name ILIKE ${like}
    `;

    const names = (tables || []).map((r) => r?.table_name).filter(Boolean);

    const preferredOrder = ["Product", "product", "products", "Products"];
    for (const pref of preferredOrder) {
      if (names.includes(pref)) {
        productTable = pref;
        break;
      }
    }

    if (!productTable) {
      productTable =
        names.find((n) => String(n).toLowerCase() === "product") ||
        names.find((n) => String(n).toLowerCase().endsWith("products")) ||
        names.find((n) => String(n).toLowerCase().includes("product")) ||
        "";
    }

    if (productTable && isSafeIdent(productTable)) {
      const cols = await prismaClient.$queryRaw`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name=${productTable}
      `;
      const colNames = (cols || []).map((r) => r?.column_name).filter(Boolean);
      titleCol = pickBestTitleColumn(colNames);
      if (!titleCol) titleCol = "";
    } else {
      productTable = "";
    }
  } catch {
    productTable = "";
    titleCol = "";
  }

  return async function lookupProductTitle(productId) {
    const pid = safeStr(productId).trim();
    if (!pid) return "";

    if (cache.has(pid)) return cache.get(pid) || "";

    let out = "";
    try {
      if (productTable && titleCol && isSafeIdent(productTable) && isSafeIdent(titleCol)) {
        const rows = await prismaClient.$queryRawUnsafe(
          `SELECT "${titleCol}" FROM "${productTable}" WHERE "id" = $1 LIMIT 1`,
          pid
        );
        const row = Array.isArray(rows) ? rows[0] : null;
        out = safeStr(row?.[titleCol]).trim();
      }
    } catch {
      out = "";
    }

    cache.set(pid, out);
    return out;
  };
}

/* ───────── title resolver (hard guarantee) ───────── */

function resolveInlineProductTitleCandidate(it) {
  const raw = getAny(it, [
    "productTitle",
    "productName",
    "product_title",
    "product_name",
    "product.title",
    "product.name",
    "productTitleSnapshot",
    "productNameSnapshot",
    "snapshot.productTitle",
    "snapshot.productName",
    "snapshot.product_title",
    "snapshot.product_name",
    "snapshot.product.title",
    "snapshot.product.name",
    "meta.productTitle",
    "meta.productName",
    "meta.product_title",
    "meta.product_name",
    "meta.product.title",
    "meta.product.name",
  ]);

  const t = safeStr(raw).trim();
  return t || "";
}

async function resolveItemTitle(it, idx, meta, lookupProductTitle) {
  const direct = resolveInlineProductTitleCandidate(it);
  if (direct) return direct;

  const pid = pickFirst(meta?.pid, it?.productId, it?.product_id, it?.variant?.productId);
  if (pid && typeof lookupProductTitle === "function") {
    const pTitle = safeStr(await lookupProductTitle(pid)).trim();
    if (pTitle) {
      const vLabel = safeStr(meta?.variantLabel).trim();
      if (vLabel && vLabel.toLowerCase() !== pTitle.toLowerCase()) return `${pTitle} — ${vLabel}`;
      return pTitle;
    }
  }

  const variantTxt = pickFirst(
    meta?.variantLabel,
    it?.variantTitle,
    it?.variantName,
    it?.variantLabel,
    it?.variant?.title,
    it?.variant?.name
  );
  if (variantTxt) return safeStr(variantTxt).trim();

  const sku = pickFirst(meta?.sku, getAny(it, ["sku", "SKU", "variantSku", "productSku", "skuCode", "variant.sku"]));
  if (sku) return `Item (${safeStr(sku).trim()})`;

  return `Item #${Number(idx) + 1}`;
}

/* ───────── page ───────── */

export default async function AdminOrderReceiptPage(props) {
  const adminSession = await requireAdminSession();
  if (!adminSession) notFound();

  const params = await props?.params;
  const id = safeStr(params?.id || "").trim();
  if (!id) notFound();

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      user: true,
      payments: true,
      shippingAddress: true,
      items: {
        include: {
          variant: {
            select: {
              id: true,
              productId: true,
              sku: true,
              barcode: true,
              title: true,
              sizeName: true,
              sizeLabel: true,
              colorName: true,
              colorLabel: true,
              colorCode: true,
              discountPrice: true,
            },
          },
        },
      },
    },
  });

  if (!order) notFound();

  const currency = order.currency || "BDT";

  const paidAmount = sumPaid(order.payments || []);
  const vat = safeVat(order);
  const discount = safeDiscount(order);
  const shipping = safeShipping(order);
  const subtotal = safeSubtotal(order) || Math.max(0, safeGrand(order) - shipping - vat + discount);
  const grandTotal = safeGrand(order) || Math.max(0, subtotal + shipping + vat - discount);

  const amountToPay = Math.max(0, grandTotal - paidAmount);

  const address = order.shippingAddress || null;

  const shipName = pickFirst(address?.name, order?.user?.name);
  const shipPhone = pickFirst(address?.phone, order?.user?.phone);
  const shipEmail = pickFirst(address?.email, order?.user?.email);

  const shipLine1 = pickFirst(address?.line1, address?.addressLine1);
  const shipLine2 = pickFirst(address?.line2, address?.addressLine2);
  const shipCity = pickFirst(address?.city);
  const shipState = pickFirst(address?.state, address?.district);
  const shipZip = pickFirst(address?.postalCode, address?.zip);
  const shipCountry = pickFirst(address?.countryIso2, address?.country);

  const shipLandmark = pickFirst(address?.landmark, address?.nearby);
  const shipArea = pickFirst(address?.area, address?.thana, address?.upazila);
  const shipDivision = pickFirst(address?.division);

  const items = Array.isArray(order.items) ? order.items : [];

  const compactShipLine = compactMetaLine([
    shipLine1 ? shipLine1 : "",
    shipLine2 ? shipLine2 : "",
    shipLandmark ? `Landmark: ${shipLandmark}` : "",
    shipArea ? `Area: ${shipArea}` : "",
    shipCity ? shipCity : "",
    shipState ? shipState : "",
    shipDivision ? shipDivision : "",
    shipZip ? shipZip : "",
    shipCountry ? shipCountry : "",
  ]);

  const lookupProductTitle = await buildProductTitleLookup(prisma);

  const viewItems = await Promise.all(
    items.map(async (it, idx) => {
      const key = it.id || `${idx}`;

      const qty = Number(it.quantity ?? it.qty ?? 1) || 1;

      // ✅ FIX ONLY: robust numeric selection that does not stop at 0
      const unitCandidate = getAnyNumberPreferPositive(it, [
        // Common
        "unitPrice",
        "unit_price",
        "unit",
        "price",
        "salePrice",
        "sale_price",
        "finalPrice",
        "final_price",
        "unitFinalPrice",
        "unit_final_price",
        "unitAmount",
        "unit_amount",
        "unitTotal",
        "unit_total",
        "itemPrice",
        "item_price",
        "itemUnitPrice",
        "item_unit_price",

        // Sometimes stored in snapshots/meta
        "meta.unitPrice",
        "meta.price",
        "snapshot.unitPrice",
        "snapshot.price",

        // Variant fallbacks
        "variant.discountPrice",
        "variant.finalPrice",
        "variant.salePrice",
        "variant.price",
        "variant.unitPrice",
        "variant.unitFinalPrice",
      ]);

      const lineCandidate = getAnyNumberPreferPositive(it, [
        // Common
        "lineTotal",
        "line_total",
        "total",
        "amount",
        "lineAmount",
        "line_amount",
        "rowTotal",
        "row_total",
        "itemTotal",
        "item_total",
        "totalPrice",
        "total_price",

        // Sometimes stored in snapshots/meta
        "meta.lineTotal",
        "meta.total",
        "snapshot.lineTotal",
        "snapshot.total",
      ]);

      let unit = Number.isFinite(unitCandidate) ? unitCandidate : NaN;
      let lineTotal = Number.isFinite(lineCandidate) ? lineCandidate : NaN;

      // derive missing values if possible
      if (!Number.isFinite(lineTotal) && Number.isFinite(unit)) lineTotal = unit * qty;
      if (!Number.isFinite(unit) && Number.isFinite(lineTotal) && qty > 0) unit = lineTotal / qty;

      // final safety
      if (!Number.isFinite(unit)) unit = 0;
      if (!Number.isFinite(lineTotal)) lineTotal = unit * qty;

      // ✅ FIX: if DB provides 0 but unit×qty implies a real total, compute it
      if (qty > 0 && Number.isFinite(unit) && unit > 0 && Number.isFinite(lineTotal) && lineTotal === 0) {
        lineTotal = unit * qty;
      }

      const thumb = it.thumb || it.image || it.thumbnailUrl || it.thumbnail || null;

      const meta = itemMeta(it, currency);
      const title = await resolveItemTitle(it, idx, meta, lookupProductTitle);

      const attrs = compactMetaLine([meta.size ? `Size: ${meta.size}` : "", meta.color ? `Color: ${meta.color}` : ""], 6);
      const subline = compactMetaLine(
        [
          meta.variantLabel ? `Variant: ${meta.variantLabel}` : "",
          meta.sku ? `SKU: ${meta.sku}` : "",
          meta.ean ? `EAN: ${meta.ean}` : "",
        ],
        6
      );

      return { key, idx, it, qty, unit, lineTotal, thumb, meta, title, attrs, subline };
    })
  );

  // ───────── counts (tiny display text) ─────────
  const totalItemsQty = viewItems.reduce((s, r) => s + (Number(r?.qty || 0) || 0), 0);
  const productCount = new Set(viewItems.map((r) => pickFirst(r?.meta?.pid, r?.meta?.sku, r?.title, r?.key))).size;

  const slipRows = viewItems.map((r) => ({
    key: r.key,
    idx: r.idx,
    title: r.title,
    qty: r.qty,
    unit: r.unit,
    lineTotal: r.lineTotal,
    attrs: r.attrs,
    subline: r.subline,
  }));

  return (
    <>
      {/* EXPORT / PRINT SURFACE (Slip only, NO CTAs) — kept as top-level sibling so print can target it cleanly */}
      <div id="tdlc-receipt-print" className="export-surface" aria-label="Consignment slip export">
        <section className="slip">
          <div className="slip-top">
            <div className="slip-left">
              <div className="slip-brand">
                <span className="slip-logo">TDLC</span>
                <span className="slip-title">Consignment Slip</span>
              </div>

              <div className="slip-line">
                <span className="mono">Order:</span> <b className="mono">{safe(order.orderNumber || order.id)}</b>
              </div>

              {/* tiny counts (download + print) */}
              <div className="slip-mini">
                Products: <b className="mono">{productCount}</b> · Items: <b className="mono">{totalItemsQty}</b>
              </div>

              <div className="slip-line">
                <span className="mono">Collect:</span> <b className="mono">{money(amountToPay, currency)}</b>
              </div>
              <div className="slip-line">
                <span className="mono">Placed:</span> {fmtDateTime(order.createdAt)}
              </div>
              <div className="slip-line">
                <span className="mono">Status:</span> {safe(order.status || order.orderStatus)}
              </div>
            </div>

            <div className="slip-right">
              <img
                src={`/api/orders/${encodeURIComponent(order.id)}/barcode.png`}
                alt="Order barcode"
                className="slip-barcode"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                draggable={false}
              />
            </div>
          </div>

          <div className="slip-ship">
            <div className="slip-row">
              <span className="slip-k">To</span>
              <span className="slip-v">
                <b>{safe(shipName)}</b>
                {shipPhone ? ` · ${safe(shipPhone)}` : ""}
                {shipEmail ? ` · ${safe(shipEmail)}` : ""}
              </span>
            </div>
            <div className="slip-row">
              <span className="slip-k">Addr</span>
              <span className="slip-v">{compactShipLine ? compactShipLine : "—"}</span>
            </div>
          </div>

          <div className="slip-items">
            {/* IMPORTANT: No <thead>. Header is first row of <tbody> so it can never “float” to the middle. */}
            <table className="slip-table">
              <tbody>
                <tr className="slip-head-row">
                  <td className="mono">#</td>
                  <td>Item</td>
                  <td>Attrs</td>
                  <td className="num mono">Qty</td>
                  <td className="num mono">Unit</td>
                  <td className="num mono">Total</td>
                </tr>

                {slipRows.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">{r.idx + 1}</td>
                    <td>
                      <div className="slip-item-title">{r.title}</div>
                      {r.subline ? <div className="slip-item-sub mono">{r.subline}</div> : null}
                    </td>
                    <td className="mono">{r.attrs || "—"}</td>
                    <td className="num mono">{r.qty}</td>
                    <td className="num mono">{money(r.unit, currency)}</td>
                    <td className="num mono">{money(r.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="slip-totals">
            <div className="slip-t">
              <span>Subtotal</span>
              <b className="mono">{money(subtotal, currency)}</b>
            </div>
            <div className="slip-t">
              <span>Shipping</span>
              <b className="mono">{money(shipping, currency)}</b>
            </div>
            <div className="slip-t">
              <span>Discount</span>
              <b className="mono">{money(discount, currency)}</b>
            </div>
            <div className="slip-t">
              <span>VAT</span>
              <b className="mono">{money(vat, currency)}</b>
            </div>
            <div className="slip-t faint">
              <span>Paid</span>
              <b className="mono">{money(paidAmount, currency)}</b>
            </div>
            <div className="slip-t faint">
              <span>Pay Status</span>
              <b className="mono">{safe(order.paymentStatus || "UNPAID")}</b>
            </div>
            <div className="slip-t grand">
              <span>Grand Total</span>
              <b className="mono">{money(grandTotal, currency)}</b>
            </div>
          </div>
        </section>
      </div>

      {/* SCREEN UI (admin visible) */}
      <main className="wrap">
        <div id="tdlc-receipt-screen" className="paper">
          <header className="top">
            <div className="brand">
              <div className="logo">TDLC</div>
              <div className="tag">Admin Order Receipt</div>
            </div>
            <div className="right">
              <img
                src={`/api/orders/${encodeURIComponent(order.id)}/barcode.png`}
                alt="Order barcode"
                className="barcode"
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                draggable={false}
              />
              <div className="code">#{safe(order.orderNumber)}</div>

              <div className="tiny">
                Products: <b className="mono">{productCount}</b> · Items: <b className="mono">{totalItemsQty}</b>
              </div>
            </div>
          </header>

          <section className="paybox" aria-label="Amount to pay">
            <div className="paybox-left">
              <div className="paybox-label">Amount to Pay</div>
              <div className="paybox-amt">{money(amountToPay, currency)}</div>
            </div>
            <div className="paybox-right">
              <div className="paybox-mini">
                <span>Grand:</span> <b className="mono">{money(grandTotal, currency)}</b>
              </div>
              <div className="paybox-mini">
                <span>Paid:</span> <b className="mono">{money(paidAmount, currency)}</b>
              </div>
              <div className="paybox-tiny">
                Products: <b className="mono">{productCount}</b> · Items: <b className="mono">{totalItemsQty}</b>
              </div>
            </div>
          </section>

          <hr className="cut" />

          <section className="blk">
            <h3>Delivery (Shipping)</h3>
            <div className="grid2">
              <div>
                <div className="row">
                  <span className="k">Name</span>
                  <span className="v">{safe(shipName)}</span>
                </div>
                <div className="row">
                  <span className="k">Phone</span>
                  <span className="v">{safe(shipPhone)}</span>
                </div>
                <div className="row">
                  <span className="k">Email</span>
                  <span className="v">{safe(shipEmail)}</span>
                </div>
              </div>

              <div>
                <div className="row">
                  <span className="k">Address</span>
                  <span className="v">
                    {safe(shipLine1)}
                    {shipLine2 ? `, ${shipLine2}` : ""}
                  </span>
                </div>
                <div className="row">
                  <span className="k">City</span>
                  <span className="v">{safe(shipCity)}</span>
                </div>
                <div className="row">
                  <span className="k">State</span>
                  <span className="v">{safe(shipState)}</span>
                </div>
                <div className="row">
                  <span className="k">ZIP</span>
                  <span className="v">{safe(shipZip)}</span>
                </div>
                <div className="row">
                  <span className="k">Country</span>
                  <span className="v">{safe(shipCountry)}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="blk">
            <h3>Order</h3>
            <div className="grid2">
              <div className="row">
                <span className="k">Order ID</span>
                <span className="v mono">{safe(order.id)}</span>
              </div>
              <div className="row">
                <span className="k">Order #</span>
                <span className="v mono">{safe(order.orderNumber)}</span>
              </div>
              <div className="row">
                <span className="k">Status</span>
                <span className="v">{safe(order.status || order.orderStatus)}</span>
              </div>
              <div className="row">
                <span className="k">Placed</span>
                <span className="v">{fmtDateTime(order.createdAt)}</span>
              </div>
            </div>
          </section>

          <section className="blk">
            <h3>Items</h3>
            <ul className="items">
              {viewItems.map((r) => (
                <li key={r.key} className="item">
                  <div className="item-left">
                    <div className="thumb-wrap">
                      {r.thumb ? (
                        <img
                          src={r.thumb}
                          alt={r.title}
                          className="thumb"
                          crossOrigin="anonymous"
                          referrerPolicy="no-referrer"
                          draggable={false}
                        />
                      ) : null}
                    </div>

                    <div className="item-main">
                      <div className="title">{r.title}</div>

                      {r.meta.variantLabel ? (
                        <div className="meta meta-small">
                          <b>Variant:</b> {safe(r.meta.variantLabel)}
                        </div>
                      ) : null}

                      {(r.meta.size || r.meta.color || r.meta.colorHex) && (
                        <div className="meta meta-attrs">
                          {r.meta.size && <span className="pill">Size: {safe(r.meta.size)}</span>}
                          {r.meta.color && <span className="pill">Color: {safe(r.meta.color)}</span>}
                          {r.meta.colorHex && <span className="pill">HEX: {safe(r.meta.colorHex)}</span>}
                        </div>
                      )}

                      {r.meta.idLine ? <div className="meta meta-small">{r.meta.idLine}</div> : null}
                      {r.meta.pricingLine ? <div className="meta meta-small">{r.meta.pricingLine}</div> : null}
                      {r.meta.discountLine ? <div className="meta meta-small">{r.meta.discountLine}</div> : null}
                      {r.meta.variantLine ? <div className="meta meta-small">{r.meta.variantLine}</div> : null}

                      <div className="meta">
                        Qty: <b>{r.qty}</b>
                      </div>
                    </div>
                  </div>

                  <div className="right">
                    <div className="price">{money(r.unit, currency)}</div>
                    <div className="line">{money(r.lineTotal, currency)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="blk totals">
            <div className="row">
              <span className="k">Payment Status</span>
              <span className="v">{safe(order.paymentStatus || "UNPAID")}</span>
            </div>
            <div className="row">
              <span className="k">Fulfillment</span>
              <span className="v">{safe(order.fulfillmentStatus || "UNFULFILLED")}</span>
            </div>

            <div className="row">
              <span className="k">Subtotal</span>
              <span className="v">{money(subtotal, currency)}</span>
            </div>
            <div className="row">
              <span className="k">Shipping Charge</span>
              <span className="v">{money(shipping, currency)}</span>
            </div>
            <div className="row">
              <span className="k">Discounts</span>
              <span className="v">{money(discount, currency)}</span>
            </div>
            <div className="row">
              <span className="k">VAT</span>
              <span className="v">{money(vat, currency)}</span>
            </div>

            <div className="row">
              <span className="k">Paid Amount</span>
              <span className="v">{money(paidAmount, currency)}</span>
            </div>

            <div className="row grand">
              <span className="k">Grand Total</span>
              <span className="v">{money(grandTotal, currency)}</span>
            </div>
          </section>

          <section className="blk note">
            <h3>Note</h3>
            <div className="fine">
              Thank you for shopping with TDLC. Keep this receipt for your records. For support, contact our official channels. Never share OTPs or sensitive
              information. Official communications come only from verified TDLC channels.
            </div>

            <div className="actions">
              <ReceiptDownloadButton className="btn" orderNumber={order.orderNumber || order.id} createdAt={order.createdAt} />
              <ReceiptPrintButton className="btn" />
              <Link href="/admin/orders" className="btn alt">
                Back to Orders
              </Link>
            </div>
          </section>
        </div>

        <style>{`
          /* (UNCHANGED CSS BELOW — kept as-is) */
          .wrap{
            min-height:100vh;
            padding:34px 16px 70px;
            display:flex;
            justify-content:center;
            background:transparent;
          }

          /* Screen container */
          .paper{
            width:100%;
            max-width:900px;
            background:#fff;
            color:#101214;
            border-radius:18px;
            box-shadow:0 10px 40px rgba(0,0,0,.10);
            padding:18px;
          }

          .top{
            display:flex;
            justify-content:space-between;
            align-items:flex-start;
            gap:14px;
          }
          .brand .logo{
            font-weight:900;
            letter-spacing:.08em;
            font-size:26px;
            line-height:1;
          }
          .brand .tag{
            margin-top:6px;
            font-size:12px;
            opacity:.75;
            font-weight:700;
          }
          .right{ text-align:right; }
          .barcode{
            width:154px;
            height:auto;
            display:block;
            margin-left:auto;
          }
          .code{
            margin-top:6px;
            font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
            font-weight:800;
            font-size:13px;
            opacity:.85;
          }
          .tiny{
            margin-top:4px;
            font-size:10px;
            font-weight:800;
            opacity:.65;
            letter-spacing:.01em;
          }

          .paybox{
            margin-top:12px;
            border:1px solid rgba(0,0,0,.10);
            background:rgba(0,0,0,.03);
            border-radius:16px;
            padding:12px 14px;
            display:flex;
            justify-content:space-between;
            gap:14px;
            align-items:center;
          }
          .paybox-label{
            font-size:12px;
            font-weight:950;
            text-transform:uppercase;
            letter-spacing:.06em;
            opacity:.75;
          }
          .paybox-amt{
            margin-top:4px;
            font-size:26px;
            font-weight:950;
            line-height:1.05;
          }
          .paybox-right{
            text-align:right;
            display:flex;
            flex-direction:column;
            gap:4px;
            min-width:170px;
          }
          .paybox-mini{
            font-size:12px;
            opacity:.85;
            font-weight:800;
          }
          .paybox-tiny{
            margin-top:2px;
            font-size:10px;
            font-weight:800;
            opacity:.62;
          }

          .cut{
            border:none;
            border-top:1px dashed rgba(0,0,0,.25);
            margin:14px 0;
          }

          .blk{ margin:12px 0; }
          .blk h3{
            margin:0 0 8px;
            font-size:13px;
            letter-spacing:.02em;
            text-transform:uppercase;
            opacity:.8;
          }

          .grid2{
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:8px 18px;
          }

          @media (max-width:640px){
            .grid2{ grid-template-columns:1fr; }
            .barcode{ width:140px; }
            .paybox{ flex-direction:column; align-items:flex-start; }
            .paybox-right{ width:100%; text-align:left; min-width:0; }
            .tiny{ text-align:left; }
          }

          .row{
            display:flex;
            justify-content:space-between;
            gap:12px;
            margin:4px 0;
            align-items:flex-start;
          }

          .k{
            font-weight:800;
            font-size:13px;
            opacity:.7;
            min-width:110px;
          }
          .v{
            font-weight:800;
            font-size:13px;
            text-align:right;
            flex:1;
          }
          .mono{ font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }

          .items{
            list-style:none;
            padding:0;
            margin:0;
            display:flex;
            flex-direction:column;
            gap:10px;
          }
          .item{
            border:1px solid rgba(0,0,0,.08);
            border-radius:14px;
            padding:10px;
            display:flex;
            justify-content:space-between;
            gap:12px;
          }
          .item-left{ display:flex; gap:10px; }
          .thumb-wrap{
            width:58px;
            height:58px;
            border-radius:12px;
            overflow:hidden;
            background:rgba(0,0,0,.04);
            flex:0 0 auto;
          }
          .thumb{
            width:100%;
            height:100%;
            object-fit:cover;
            display:block;
          }
          .item-main .title{
            font-weight:900;
            font-size:14px;
            margin-bottom:4px;
          }
          .meta{
            font-size:12px;
            opacity:.8;
            font-weight:700;
            margin-top:3px;
          }
          .meta-small{
            font-size:11px;
            opacity:.75;
          }
          .meta-attrs{
            display:flex;
            gap:6px;
            flex-wrap:wrap;
            margin-top:6px;
          }
          .pill{
            padding:3px 8px;
            border-radius:999px;
            background:rgba(0,0,0,.05);
            font-weight:800;
            font-size:11px;
          }
          .item .right{
            text-align:right;
            min-width:136px;
          }
          .price{
            font-weight:900;
            font-size:13px;
            opacity:.75;
          }
          .line{
            font-weight:900;
            font-size:16px;
            margin-top:4px;
          }

          .totals{
            border-top:1px dashed rgba(0,0,0,.22);
            padding-top:10px;
          }
          .grand .k, .grand .v{
            font-size:15px;
            font-weight:950;
          }
          .grand .v{ font-size:18px; }

          .note .fine{
            font-size:12px;
            line-height:1.4;
            opacity:.8;
            font-weight:700;
          }

          .actions{
            display:flex;
            flex-wrap:wrap;
            gap:10px;
            margin-top:12px;
          }
          .btn{
            appearance:none;
            border:none;
            padding:10px 14px;
            border-radius:12px;
            background:#0F2147;
            color:#fff;
            font-weight:900;
            cursor:pointer;
            text-decoration:none;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            gap:8px;
            transition:transform .12s ease, opacity .12s ease;
          }
          .btn:hover{ transform:translateY(-1px); }
          .btn:active{ transform:translateY(0px); opacity:.9; }
          .btn.alt{
            background:rgba(0,0,0,.06);
            color:#111;
          }

          /* EXPORT / PRINT surface: kept OFFSCREEN for download, but printable */
          .export-surface{
            position:fixed;
            left:-100000px;
            top:0;
            width:920px;
            background:#fff;
            color:#101214;
            padding:0;
            margin:0;
            z-index:-1;
          }

          /* Slip styling (compact but clean) */
          .slip{
            border:1px dashed rgba(0,0,0,.22);
            border-radius:10px;
            padding:10px 10px 9px;
            box-sizing:border-box;
            max-width:100%;
          }
          .slip-top{
            display:flex;
            justify-content:space-between;
            gap:10px;
            align-items:flex-start;
            margin-bottom:8px;
          }
          .slip-brand{
            display:flex;
            align-items:baseline;
            gap:8px;
            margin-bottom:4px;
          }
          .slip-logo{
            font-weight:950;
            letter-spacing:.08em;
          }
          .slip-title{
            font-weight:900;
            opacity:.75;
            text-transform:uppercase;
            font-size:11px;
          }
          .slip-line{
            font-size:11px;
            font-weight:850;
            opacity:.9;
            margin-top:2px;
          }
          .slip-mini{
            margin-top:4px;
            font-size:9.6px;
            font-weight:850;
            opacity:.72;
          }
          .slip-barcode{
            width:128px;
            height:auto;
            display:block;
          }

          .slip-ship{
            margin:6px 0 8px;
            padding-top:6px;
            border-top:1px solid rgba(0,0,0,.12);
          }
          .slip-row{
            display:grid;
            grid-template-columns:40px 1fr;
            gap:8px;
            font-size:11px;
            line-height:1.22;
            margin:3px 0;
          }
          .slip-k{
            font-weight:950;
            opacity:.82;
          }
          .slip-v{
            font-weight:850;
            opacity:.98;
          }

          .slip-table{
            width:100%;
            border-collapse:collapse;
            font-size:10.25px;
          }
          .slip-table td{
            border-bottom:1px solid rgba(0,0,0,.10);
            padding:5px 5px;
            vertical-align:top;
          }
          .slip-table .num{
            text-align:right;
            white-space:nowrap;
          }
          .slip-item-title{
            font-weight:950;
          }
          .slip-item-sub{
            margin-top:2px;
            opacity:.72;
            font-size:9.9px;
            word-break:break-word;
          }

          /* Header row (always first row of tbody) */
          .slip-head-row td{
            font-weight:950;
            border-bottom:1px solid rgba(0,0,0,.18);
            white-space:nowrap;
          }

          .slip-totals{
            margin-top:8px;
            border-top:1px solid rgba(0,0,0,.12);
            padding-top:7px;
            display:grid;
            grid-template-columns:1fr;
            gap:4px;
            font-size:11px;
          }
          .slip-t{
            display:flex;
            justify-content:space-between;
            gap:10px;
            font-weight:900;
          }
          .slip-t.faint{
            opacity:.78;
            font-weight:850;
          }
          .slip-t.grand{
            font-size:12px;
            font-weight:950;
            margin-top:2px;
          }

          /* PRINT: hide admin chrome + start slip at top edge (with slight padding) + no blank trailing page */
          @media print{
            @page{ size:auto; margin:0 !important; }

            html, body{
              margin:0 !important;
              padding:0 !important;
              height:auto !important;
              background:#fff !important;
              -webkit-print-color-adjust:exact;
              print-color-adjust:exact;
              overflow:visible !important;
            }

            /* Hide typical admin chrome (layout header/topbar/sidebar) */
            header, nav, aside, footer{
              display:none !important;
            }
            [role="banner"], [role="navigation"], [role="complementary"]{
              display:none !important;
            }
            /* extra common class/id patterns (safe) */
            .topbar, .Topbar, .admin-topbar, .AdminTopbar, .navbar, .Navbar, .sidebar, .Sidebar{
              display:none !important;
            }
            #topbar, #Topbar, #admin-topbar, #AdminTopbar, #navbar, #Navbar, #sidebar, #Sidebar{
              display:none !important;
            }

            /* Screen receipt never prints */
            #tdlc-receipt-screen{
              display:none !important;
            }

            /* Ensure page wrapper doesn't force extra pages */
            .wrap{
              min-height:auto !important;
              padding:0 !important;
              margin:0 !important;
              display:block !important;
            }

            /* Bring print surface into the page flow at the very top */
            #tdlc-receipt-print.export-surface{
              position:static !important;
              left:auto !important;
              top:auto !important;
              width:100% !important;
              max-width:100% !important;
              margin:0 !important;
              padding:0 !important;
              z-index:auto !important;
              background:#fff !important;
            }

            /* Slight top/side “beauty” margin: done via slip padding (not page margin) */
            #tdlc-receipt-print .slip{
              margin:0 !important;
              padding:3mm 5mm 6mm 5mm !important; /* slight top space, slight left/right */
              border-radius:0 !important;
              box-shadow:none !important;
              page-break-after:auto !important;
              break-after:auto !important;
            }

            /* Do not break the table */
            .slip-top,
            .slip-ship,
            .slip-totals{
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
            .slip-table tr{
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }

            /* Prevent tiny overflow that can create a blank trailing page */
            #tdlc-receipt-print,
            #tdlc-receipt-print .slip,
            #tdlc-receipt-print .slip-table{
              width:100% !important;
              max-width:100% !important;
            }
          }
        `}</style>
      </main>
    </>
  );
}
