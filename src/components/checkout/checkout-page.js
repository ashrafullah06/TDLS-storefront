// FILE: src/components/checkout/checkout-page.js
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PaymentMethods from "./payment-methods";
import Summary from "./summary";
import GoBackButton from "./go-back-button";
import AddressBlock from "./address-block";

import Navbar from "@/components/common/navbar";
import BottomFloatingBar from "@/components/common/bottomfloatingbar";

/** COLORS */
const NAVY = "#0F2147";
const MUTED = "#6B7280";
const BORDER = "#DFE3EC";

/**
 * Storage keys
 * - Guest must NOT persist across tabs; use sessionStorage only.
 * - Account mode may persist (localStorage).
 */
const SS_GUEST_KEY = "tdlc_guest_checkout_session_v1";
const LS_ACCOUNT_PROFILE_OVERRIDE_KEY = "tdlc_checkout_profile_override_v1";

/**
 * Checkout mode:
 * - Guest mode should NOT be remembered after tab close -> sessionStorage only.
 * - Account mode is determined by session; we do not persist "account" here.
 */
const SS_CHECKOUT_MODE_KEY = "tdlc_checkout_mode_session_v1";

/**
 * Payment method:
 * - Guest selection should not survive tab close -> sessionStorage.
 * - Account selection can use localStorage.
 */
const SS_CHECKOUT_METHOD_KEY = "tdlc_checkout_method_session_v1";
const LS_CHECKOUT_METHOD_KEY = "checkout_method";

/** OTP is used ONLY at COD confirmation (both guest + account).
 * Must match server + OTP policy list (see src/components/auth/otpform.jsx): cod_confirm
 */
const COD_OTP_PURPOSE = "cod_confirm";

/* ---------------- tiny helpers ---------------- */
function titleCase(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

function buildStableKey(a) {
  if (a?.id != null) return String(a.id);
  const raw = [
    a?.name,
    a?.email,
    a?.phone,
    a?.houseName,
    a?.houseNo,
    a?.apartmentNo,
    a?.floorNo,
    a?.address1,
    a?.address2,
    a?.line1,
    a?.line2,
    a?.city,
    a?.district,
    a?.upazila,
    a?.postalCode,
    a?.countryIso2,
  ]
    .map((v) => v ?? "")
    .join("|");
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h =
      (h +
        ((h << 1) +
          (h << 4) +
          (h << 7) +
          (h << 8) +
          (h << 24))) >>>
      0;
  }
  return `k_${h.toString(16)}`;
}

function normalizeAddress(a, idx = 0) {
  if (!a) return null;
  const x = a.address || a;
  const out = {
    id: a.id ?? x.id ?? x._id ?? undefined,
    name: x.name ?? a.name ?? "",
    email: (x.email ?? a.email ?? "").toLowerCase(),
    phone: x.phone ?? a.phone ?? "",
    floorNo: x.floorNo ?? "",
    apartmentNo: x.apartmentNo ?? "",
    houseNo: x.houseNo ?? "",
    houseName: x.houseName ?? "",
    streetAddress: x.streetAddress ?? x.line1 ?? x.address1 ?? "",
    line1: x.line1 ?? x.address1 ?? x.streetAddress ?? "",
    line2: x.line2 ?? x.address2 ?? "",
    city: x.city ?? x.upazila ?? "",
    state: x.state ?? x.district ?? x.division ?? "",
    postalCode: x.postalCode ?? x.postcode ?? "",
    countryIso2: (x.countryIso2 ?? x.country ?? "BD").toUpperCase(),
    address1: x.address1 ?? x.line1 ?? x.streetAddress ?? "",
    address2: x.address2 ?? x.line2 ?? "",
    village: x.village ?? "",
    postOffice: x.postOffice ?? "",
    union: x.union ?? "",
    policeStation: x.policeStation ?? x.thana ?? "",
    upazila: x.upazila ?? "",
    district: x.district ?? "",
    division: x.division ?? "",
    isDefault: !!(a.isDefault || x.isDefault),
    phoneVerified: !!(a.phoneVerified || x.phoneVerified || x.phoneVerifiedAt),
    _ord: idx,
  };
  // Ensure a human-friendly first line for display (show house/flat/floor + street)
  const houseBits = [out.houseName, out.houseNo, out.apartmentNo, out.floorNo].filter(Boolean);
  const baseStreet = String(out.streetAddress || out.line1 || out.address1 || "").trim();

  // Ensure primary line fields are populated consistently
  if (!out.address1) out.address1 = baseStreet;
  if (!out.line1) out.line1 = out.address1 || baseStreet;
  if (!out.streetAddress) out.streetAddress = out.line1 || out.address1 || baseStreet;

  // If house parts exist, compose them into the first line so summaries show the full street line
  if (houseBits.length) {
    const composed = [...houseBits, baseStreet].filter(Boolean).join(", ");
    if (composed) {
      out.address1 = composed;
      out.line1 = composed;
      out.streetAddress = composed;
    }
  }

  if (!out.address2) out.address2 = out.line2;
  return { ...out, _key: buildStableKey(out) };
}

/** Canonical signature to dedupe addresses and prevent "multiplying" tiles */
function canonicalAddressSig(a) {
  if (!a) return "";
  const line1 = a.address1 || a.line1 || "";
  const line2 = a.address2 || a.line2 || "";
  const city = a.upazila || a.city || "";
  const dist = a.district || a.state || "";
  const country = (a.countryIso2 || a.country || "").toString().toUpperCase();
  const postal = a.postalCode || a.postcode || "";
  const phone = a.phone || "";
  const email = (a.email || "").toLowerCase();
  const name = (a.name || "").toLowerCase();

  return [name, phone, email, line1, line2, city, dist, postal, country]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .join("|");
}

/**
 * Summary components sometimes read `field?.[0]` (treating fields as arrays of lines).
 * If the field is a string, `?.[0]` returns only the first character.
 * This helper forces the common address line fields into single-item arrays for summary-only rendering.
 */
function coerceAddressForSummary(a) {
  if (!a) return null;

  const n = normalizeAddress(a, 0) || (a.address && typeof a.address === "object" ? a.address : a);

  const houseBits = [n.houseName, n.houseNo, n.apartmentNo, n.floorNo].filter(Boolean);
  const baseStreet = String(n.streetAddress || n.line1 || n.address1 || "").trim();
  const fullLine1 = (houseBits.length ? [...houseBits, baseStreet].filter(Boolean).join(", ") : baseStreet) || "";
  const fullLine2 = String(n.address2 || n.line2 || "").trim();

  const line1Arr = fullLine1 ? [fullLine1] : [];
  const line2Arr = fullLine2 ? [fullLine2] : [];

  const shaped = {
    ...n,

    // string copies (useful if a renderer expects plain strings)
    line1Text: fullLine1,
    line2Text: fullLine2,

    // array variants (avoid string indexing)
    address1: line1Arr,
    line1: line1Arr,
    streetAddress: line1Arr,
    addressLine1: line1Arr,

    address2: line2Arr,
    line2: line2Arr,
    addressLine2: line2Arr,
  };

  // Common nested shapes used by different UIs
  const nested = {
    ...(typeof a.address === "object" && a.address ? a.address : {}),
    ...n,

    line1Text: fullLine1,
    line2Text: fullLine2,

    address1: line1Arr,
    line1: line1Arr,
    streetAddress: line1Arr,
    addressLine1: line1Arr,

    address2: line2Arr,
    line2: line2Arr,
    addressLine2: line2Arr,
  };

  shaped.address = nested;
  shaped.shippingAddress = nested;
  shaped.billingAddress = nested;

  return shaped;
}

function dedupePreserveOrder(list) {
  const seenId = new Set();
  const seenSig = new Set();
  const out = [];

  for (const a of list) {
    if (!a) continue;
    const idStr = a.id != null ? String(a.id) : null;
    const sig = canonicalAddressSig(a);

    if (idStr && seenId.has(idStr)) continue;
    if (sig && seenSig.has(sig)) continue;

    if (idStr) seenId.add(idStr);
    if (sig) seenSig.add(sig);

    out.push(a);
  }

  return out.sort((p, q) => (p._ord ?? 0) - (q._ord ?? 0));
}

function toServerPayload(values) {
  const line1 =
    values.line1 ||
    values.address1 ||
    [
      values.houseName,
      values.houseNo,
      values.apartmentNo,
      values.floorNo,
      values.streetAddress,
    ]
      .filter(Boolean)
      .join(", ");
  const line2 =
    values.line2 ||
    values.address2 ||
    [values.postOffice, values.union, values.policeStation]
      .filter(Boolean)
      .join(", ");
  const city = (
    values.city ||
    values.cityOrUpazila ||
    values.upazila ||
    values.district ||
    ""
  ).trim();
  const state = (
    values.state ||
    values.districtOrState ||
    values.district ||
    values.division ||
    ""
  ).trim();
  const postalCode = values.postalCode || values.postcode || "";
  const countryIso2 = (values.countryIso2 || values.country || "BD").toUpperCase();
  return {
    name: values.name ?? "",
    phone: values.phone ?? "",
    email: (values.email ?? "").toLowerCase(),
    line1,
    line2,
    city,
    state,
    postalCode,
    countryIso2,
    addressLine1: line1,
    addressLine2: line2,
    cityOrUpazila: city,
    districtOrState: state,
    label: values.label ?? undefined,
    makeDefault: !!values.makeDefault,
    id: values.id,
    floorNo: values.floorNo ?? "",
    apartmentNo: values.apartmentNo ?? "",
    houseNo: values.houseNo ?? "",
    houseName: values.houseName ?? "",
    streetAddress: values.streetAddress ?? "",
    village: values.village ?? "",
    postOffice: values.postOffice ?? "",
    union: values.union ?? "",
    policeStation: values.policeStation ?? values.thana ?? "",
    thana: values.thana ?? undefined,
    upazila: values.upazila ?? "",
    district: values.district ?? "",
    division: values.division ?? "",
  };
}

async function tryJson(url, method = "GET", body, extraHeaders) {
  const headers = { "Content-Type": "application/json" };
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v === undefined || v === null || v === "") continue;
      headers[k] = String(v);
    }
  }

  const r = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { ok: r.ok, status: r.status, j };
}

function normalizeBDPhone(p = "") {
  // Accept BD mobile formats:
  // +8801XXXXXXXXX, 8801XXXXXXXXX, 01XXXXXXXXX, 08801XXXXXXXXX, 008801XXXXXXXXX
  // Also auto-corrects mistaken "+01..." into "+8801..."
  let s = String(p || "").trim();
  if (!s) return "";

  // Remove spaces and common separators
  s = s.replace(/[\s-()]/g, "");

  // Convert "00" international prefix to "+"
  if (s.startsWith("00")) s = `+${s.slice(2)}`;

  // Handle "0880..." (some users prefix 0 before country code)
  if (s.startsWith("0880")) s = s.slice(1); // -> "880..."

  // Fix mistaken "+01..." into "+8801..."
  if (s.startsWith("+01")) {
    // "+017..." -> "+88017..."
    return `+88${s.slice(1)}`;
  }

  // Normalize common valid forms
  if (s.startsWith("+8801")) return s;
  if (s.startsWith("8801")) return `+${s}`;
  if (s.startsWith("01")) return `+88${s}`;

  // If user provided "+880..." already, keep it (even if later validated)
  if (s.startsWith("+880")) return s;

  // If user typed "1XXXXXXXXX" (10 digits starting with 1), assume missing 880
  if (/^1\d{9}$/.test(s)) return `+880${s}`;

  // If user typed "+8801..." with extra "+" already handled above; keep "+" form
  return s.startsWith("+") ? s : `+${s}`;
}

function isValidBDMobile(p = "") {
  const n = normalizeBDPhone(p);
  // Strictly BD mobile: +8801 + 9 digits (total: +8801XXXXXXXXX)
  return /^\+8801\d{9}$/.test(n);
}

/* ---------- normalize payment method tokens ---------- */
function normalizeMethod(m) {
  if (!m) return null;
  const s = String(m).trim().toUpperCase();
  if (s === "COD" || s === "CASH" || s === "CASH_ON_DELIVERY") return "COD";
  if (s === "BKASH" || s === "B-KASH") return "BKASH";
  if (s === "NAGAD") return "NAGAD";
  if (s === "SSL" || s === "SSLCOMMERZ" || s === "SSLCOMMERZ_GATEWAY") return "SSL";
  if (s === "STRIPE") return "STRIPE";
  return s;
}

/* ---------------- cart helpers (robust + ENRICHED) ---------------- */
/** Extract (size, color, options) defensively from many shapes */
function extractOptionsShape(it) {
  const opts =
    it?.options ??
    it?.variant?.options ??
    it?.attributes ??
    it?.variantAttributes ??
    it?.selectedOptions ??
    it?.variant?.selectedOptions ??
    null;

  const out = {};
  const kvPairs = Array.isArray(opts)
    ? opts
    : opts && typeof opts === "object"
    ? Object.entries(opts).map(([name, value]) => ({ name, value }))
    : [];

  for (const pair of kvPairs) {
    const name = String(pair?.name ?? pair?.key ?? "").toLowerCase();
    const value = String(pair?.value ?? pair?.label ?? "").trim();
    if (!name) continue;
    out[name] = value;
    if (name === "size" || name === "option1") out.size = value;
    if (name === "color" || name === "colour" || name === "option2") out.color = value;
  }

  out.size = out.size ?? it?.size ?? it?.Size ?? it?.variant?.size ?? null;
  out.color =
    out.color ?? it?.color ?? it?.colour ?? it?.Color ?? it?.variant?.color ?? null;

  const sku = it?.sku || it?.variant?.sku || "";
  if (!out.size && /(?:^|[-_])([XSML]{1,3}\d?)(?:$|[-_])/.test(sku)) {
    const m = sku.match(/(?:^|[-_])([XSML]{1,3}\d?)(?:$|[-_])/i);
    if (m) out.size = m[1].toUpperCase();
  }

  return out;
}

function mapAnyItemToSnapshotShape(it) {
  const variantId =
    it?.variantId ??
    it?.variant_id ??
    it?.variant?.id ??
    it?.id ??
    null;

  const productId =
    it?.productId ?? it?.product_id ?? it?.product?.id ?? it?.parentId ?? null;

  const qty = Number(it?.quantity ?? it?.qty ?? it?.count ?? it?.amount ?? 0);

  const unit = Number(it?.unitPrice ?? it?.price ?? it?.unit_price ?? it?.unit ?? 0);

  const productTitle =
    it?.productTitle ??
    it?.product?.title ??
    it?.product?.name ??
    it?.title ??
    null;

  const variantTitle = it?.variantTitle ?? it?.variant?.title ?? it?.title ?? null;

  const sku = it?.sku ?? it?.variant?.sku ?? it?.product?.sku ?? null;

  const barcode = it?.barcode ?? it?.variant?.barcode ?? it?.product?.barcode ?? null;

  const imageUrl =
    it?.image?.url ??
    it?.image_url ??
    it?.variant?.image?.url ??
    it?.variant?.featuredImage?.url ??
    it?.product?.thumbnail?.url ??
    it?.product?.image?.url ??
    null;

  const slug = it?.slug ?? it?.handle ?? it?.product?.slug ?? it?.product?.handle ?? null;

  if (!Number.isFinite(qty) || qty <= 0) return null;

  const options = extractOptionsShape(it);
  const size = options.size ?? null;
  const color = options.color ?? null;

  const title = variantTitle || productTitle || it?.title || "Item";

  return {
    ...it, // preserve raw fields
    productId: productId ? String(productId) : null,
    variantId: variantId ? String(variantId) : null,
    productTitle: productTitle || null,
    variantTitle: variantTitle || null,
    title,
    slug,
    sku,
    barcode,
    imageUrl,
    options,
    size,
    color,
    lineId: it?.id ?? null,
    quantity: Math.max(1, Math.floor(qty)),
    unitPrice: Number.isFinite(unit) ? unit : 0,
    price: Number.isFinite(unit) ? unit : 0,
    subtotal: Number.isFinite(unit) ? Math.max(1, Math.floor(qty)) * unit : 0,
  };
}

function decorateForDisplay(items = []) {
  return items.map((it) => {
    const parts = [];
    if (it.size) parts.push(`Size: ${it.size}`);
    if (it.color) parts.push(`Color: ${it.color}`);
    const optionSummary = parts.join(" • ");
    return { ...it, optionSummary };
  });
}

/* ---------- purge legacy cart keys (prevents demo data bleed) ---------- */
function purgeLegacyCartKeysIfCanonicalExists() {
  try {
    const canonicalStr =
      localStorage.getItem("tdlc_cart_v1") || localStorage.getItem("TDLC_CART");
    if (canonicalStr) {
      ["cart", "shop_cart", "tdlc_cart"].forEach((k) => localStorage.removeItem(k));
      if (typeof window !== "undefined") {
        if (window.__SHOP_CART__ && !window.__CART__) window.__SHOP_CART__ = { items: [] };
        if (window.__CART_STR__) window.__CART_STR__ = JSON.stringify({ items: [] });
      }
    }
  } catch {}
}

/* ---------- prefer canonical keys, legacy last-resort only ---------- */
function snapshotFromLocalStorage() {
  try {
    const canonicalKeys = ["tdlc_cart_v1", "TDLC_CART"];
    for (const k of canonicalKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.cart?.items)
        ? parsed.cart.items
        : [];
      const mapped = arr.map(mapAnyItemToSnapshotShape).filter(Boolean);
      if (mapped.length) return { items: decorateForDisplay(mapped), _source: `local:${k}` };
    }

    const legacyKeys = ["tdlc_cart", "shop_cart", "cart"];
    for (const k of legacyKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.cart?.items)
        ? parsed.cart.items
        : [];
      const mapped = arr.map(mapAnyItemToSnapshotShape).filter(Boolean);
      if (mapped.length) return { items: decorateForDisplay(mapped), _source: `local:${k}` };
    }
  } catch {}
  return null;
}

/* ---------- ignore legacy globals if canonical exists ---------- */
function snapshotFromWindow() {
  try {
    const hasCanonical = !!(
      localStorage.getItem("tdlc_cart_v1") || localStorage.getItem("TDLC_CART")
    );
    if (hasCanonical) return null;

    const cand =
      (typeof window !== "undefined" && (window.__CART__ || window.__SHOP_CART__)) || null;
    const arr = cand && Array.isArray(cand.items) ? cand.items : Array.isArray(cand) ? cand : [];
    const mapped = arr.map(mapAnyItemToSnapshotShape).filter(Boolean);
    if (mapped.length) return { items: decorateForDisplay(mapped), _source: "window" };
  } catch {}
  return null;
}

/* ---------------- centralized snapshot persistence ---------------- */
function persistSnapshot(snapshot) {
  try {
    if (!snapshot || !Array.isArray(snapshot.items)) return;
    const payload = JSON.stringify({ items: snapshot.items });
    localStorage.setItem("tdlc_cart_v1", payload);
    localStorage.setItem("TDLC_CART", payload);
    if (typeof window !== "undefined") window.__CART__ = { items: snapshot.items };
    purgeLegacyCartKeysIfCanonicalExists();
  } catch {}
}

/* ---------------- API wrappers (ACCOUNT MODE ONLY) ---------------- */
const book = {
  async listWithMeta() {
    return fetchAddressBookMeta();
  },

  async list() {
    const meta = await fetchAddressBookMeta();
    return meta.list;
  },

  // Fallback only (should be unnecessary if /address-book returns defaultAddress)
  async getDefault() {
    const opts = { credentials: "include", cache: "no-store" };
    let r = await fetch("/api/customers/address-book/default", opts);
    if (!r.ok) r = await fetch("/api/customers/address-book?default=1", opts);
    if (!r.ok) return null;

    const j = await r.json().catch(() => ({}));
    const raw = j?.data ?? j?.address ?? j?.defaultAddress ?? null;
    return normalizeAddress(raw, -1);
  },

  async create(values) {
    return tryJson("/api/customers/address-book", "POST", {
      ...toServerPayload(values),
    });
  },

  async update(id, values) {
    const payload = { ...toServerPayload({ ...values, id }) };
    const enc = encodeURIComponent(String(id));
    let res = await tryJson(`/api/customers/address-book/${enc}`, "PUT", payload);

    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(`/api/customers/address-book/${enc}`, "PATCH", payload);
    }
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson("/api/customers/address-book", "POST", payload);
    }
    return res;
  },

  async setDefault(id) {
    const enc = encodeURIComponent(String(id));
    let res = await tryJson(`/api/customers/address-book/${enc}/default`, "POST", {});
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(`/api/customers/address-book/${enc}`, "PATCH", { makeDefault: true });
    }
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson("/api/customers/address-book", "POST", { id, makeDefault: true });
    }
    return res;
  },

  async remove(id) {
    const r = await fetch(`/api/customers/address-book/${id}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    let j = {};
    try {
      j = await r.json();
    } catch {}
    return { ok: r.ok, status: r.status, j };
  },
};

/**
 * Address book "meta" fetch:
 * - Single request returns {addresses, defaultAddress, defaultId, ...} per your API conventions.
 * - Eliminates the extra /default round-trip (biggest source of "wait for address").
 */
async function fetchAddressBookMeta() {
  const r = await fetch("/api/customers/address-book", {
    credentials: "include",
    cache: "no-store",
  });

  const status = r.status;

  if (!r.ok) {
    return { list: [], defaultAddr: null, defaultId: null, _status: status };
  }

  const j = await r.json().catch(() => ({}));

  const rawList = Array.isArray(j?.addresses)
    ? j.addresses
    : Array.isArray(j?.data)
    ? j.data
    : Array.isArray(j)
    ? j
    : [];

  const list = rawList.map((a, i) => normalizeAddress(a, i)).filter(Boolean);

  const rawDef = j?.defaultAddress ?? j?.default_address ?? j?.default ?? j?.address ?? null;
  const defaultAddr = normalizeAddress(rawDef, -1);

  const defaultId =
    j?.defaultId ??
    j?.defaultAddressId ??
    j?.default_address_id ??
    (defaultAddr?.id ?? null);

  return { list, defaultAddr, defaultId, _status: status };
}

/* ---------- eager preload + tiny in-memory cache (SPA fast path) ---------- */
let _addrMetaPrime = null;
let _addrMetaPrimeAt = 0;
const ADDR_META_PRIME_TTL_MS = 25_000;

function invalidateAddressBookMeta() {
  _addrMetaPrime = null;
  _addrMetaPrimeAt = 0;
}

function primeAddressBookMeta({ force = false } = {}) {
  if (typeof window === "undefined") {
    return Promise.resolve({ list: [], defaultAddr: null, defaultId: null, _status: 0 });
  }

  const now = Date.now();
  if (!force && _addrMetaPrime && now - _addrMetaPrimeAt < ADDR_META_PRIME_TTL_MS) return _addrMetaPrime;

  _addrMetaPrimeAt = now;

  _addrMetaPrime = fetchAddressBookMeta()
    .then((m) => {
      // Do NOT cache "not logged in" results; allow retry immediately after login.
      if (m?._status === 401) invalidateAddressBookMeta();
      return m;
    })
    .catch(() => {
      invalidateAddressBookMeta();
      return { list: [], defaultAddr: null, defaultId: null, _status: 0 };
    });

  return _addrMetaPrime;
}

function seedAddressBookMeta(meta) {
  if (!meta) return;
  _addrMetaPrimeAt = Date.now();
  _addrMetaPrime = Promise.resolve(meta);
}

// Start fetching as early as possible (overlaps with session fetch + render).
if (typeof window !== "undefined") {
  primeAddressBookMeta().catch(() => null);
}


const profile = {
  async read() {
    const r = await fetch("/api/customers/me", {
      credentials: "include",
      cache: "no-store",
    });
    if (!r.ok) return {};
    return r.json().catch(() => ({}));
  },
};

/* ---------------- OTP modal (COD ONLY) ---------------- */
function OtpDialog({
  open,
  identifier,
  purpose = COD_OTP_PURPOSE,
  ttlSeconds,
  onSubmit,
  onClose,
  onResend,
}) {
  const [code, setCode] = useState("");
  const [ttl, setTtl] = useState(ttlSeconds || 90);
  const [resending, setResending] = useState(false);

  const purposeLabel = (() => {
    const p = String(purpose || "");
    switch (p) {
      case COD_OTP_PURPOSE:
        return "Cash-on-delivery verification";
      default:
        return p ? p.replace(/_/g, " ") : "Verification";
    }
  })();

  useEffect(() => {
    if (open) {
      setCode("");
      setTtl(ttlSeconds || 90);
      setResending(false);
    }
  }, [open, ttlSeconds]);

  useEffect(() => {
    if (!open || ttl <= 0) return;
    const t = setInterval(() => setTtl((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [open, ttl]);

  // Resend uses the same countdown as the OTP TTL.
  // Button stays disabled until the timer reaches 0 (no extra cooldown layer).

  if (!open) return null;

  return (
    <div className="otp-overlay">
      <div className="otp-sheet">
        <div className="otp-head">
          <div className="otp-ttl">Verify</div>
          <button className="otp-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="otp-body">
          <div className="otp-line">
            We sent a code to <b>{identifier}</b>.
          </div>
          <div className="otp-line">
            Purpose: <b>{purposeLabel}</b>.
          </div>

          <div className="otp-line">
            Enter 6-digit code {ttl > 0 ? `(expires in ${ttl}s)` : `(expired)`}.
          </div>
          <input
            className="otp-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            inputMode="numeric"
            autoFocus
          />
          <div className="otp-actions">
            <button
              className="otp-submit"
              onClick={() => onSubmit(code)}
              disabled={code.length !== 6}
            >
              Verify
            </button>
            <button
              className="otp-resend"
              onClick={async () => {
                if (ttl > 0 || resending) return;
                try {
                  setResending(true);
                  setCode("");
                  const r = await onResend?.();
                  // If parent returns a ttl (or an object containing it), reset the timer immediately.
                  const nextTtl =
                    typeof r === "number"
                      ? r
                      : typeof r?.ttlSeconds === "number"
                      ? r.ttlSeconds
                      : typeof r?.ttl === "number"
                      ? r.ttl
                      : null;
                  if (typeof nextTtl === "number" && nextTtl > 0) setTtl(nextTtl);
                } finally {
                  setResending(false);
                }
              }}
              disabled={ttl > 0 || resending}
              title={ttl > 0 ? `Resend available in ${ttl}s` : resending ? "Sending..." : "Resend"}
            >
              {resending ? "Sending..." : ttl > 0 ? `Resend in ${ttl}s` : "Resend"}
            </button>
          </div>
        </div>
      </div>
      <style jsx>{`
        .otp-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.32);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 14px;
        }
        .otp-sheet {
          width: min(440px, 92vw);
          background: #fff;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          box-shadow: 0 16px 40px rgba(15, 33, 71, 0.25);
        }
        .otp-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid ${BORDER};
        }
        .otp-ttl {
          font-weight: 900;
          color: ${NAVY};
        }
        .otp-x {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 20px;
          cursor: pointer;
        }
        .otp-body {
          padding: 16px;
          display: grid;
          gap: 10px;
        }
        .otp-line {
          color: ${NAVY};
          font-weight: 700;
        }
        .otp-input {
          height: 54px;
          border: 1px solid ${BORDER};
          border-radius: 14px;
          font-size: 22px;
          text-align: center;
          letter-spacing: 8px;
        }
        .otp-actions {
          display: flex;
          gap: 10px;
        }
        .otp-submit {
          flex: 1;
          height: 46px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #1e3a8a, #0ea5e9);
          color: #fff;
          font-weight: 900;
        }
        .otp-resend {
          width: 140px;
          height: 46px;
          border-radius: 9999px;
          background: #fff;
          color: ${NAVY};
          font-weight: 900;
          border: 1px solid ${BORDER};
        }
      `}</style>
    </div>
  );
}

/* OTP API facades (COD only from checkout) */
async function requestOtp(
  identifier,
  channel = "sms",
  purpose = COD_OTP_PURPOSE,
  opts = {}
) {
  const raw = String(channel || "sms").toLowerCase();
  const normalized =
    raw === "email" ? "EMAIL" : raw === "whatsapp" ? "WHATSAPP" : "SMS";

  const payload = { identifier, channel: normalized, purpose };

  // Guest checkout should not require an existing user record
  if (opts?.allowGuest) {
    payload.allowGuest = true;
    payload.guestCheckout = true;
  }

  async function doReq(path) {
    const r = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let j = {};
    try {
      j = await r.json();
    } catch {}
    return { ok: r.ok && (j.ok === undefined || j.ok === true), j, status: r.status };
  }

  // Primary
  const primaryPath = opts?.path || "/api/auth/request-otp";
  let res = await doReq(primaryPath);

  // Fallbacks for guest flows if the auth route insists on a user
  const errCode = res?.j?.error || res?.j?.code || res?.j?.message;
  if (
    !res.ok &&
    opts?.allowGuest &&
    (errCode === "USER_NOT_FOUND" || String(errCode || "").includes("USER_NOT_FOUND"))
  ) {
    // Some deployments keep COD OTP under an orders/checkout route
    res = await doReq("/api/orders/request-otp");
  }

  return res;
}

async function verifyOtpApi(identifier, code, purpose = COD_OTP_PURPOSE) {
  const r = await fetch("/api/auth/verify-otp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, code, purpose }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j?.ok !== false, j };
}

/* ---------------- cart clear helpers ---------------- */
async function clearServerCartIfAny() {
  try {
    await fetch("/api/cart", { method: "DELETE", credentials: "include" });
  } catch {}
}

function clearClientCartEverywhere() {
  try {
    if (typeof window !== "undefined") {
      window.__CART__ = { items: [] };
      window.__SHOP_CART__ = { items: [] };
      window.__CART_STR__ = JSON.stringify({ items: [] });
      const keys = [
        "TDLC_CART",
        "tdlc_cart_v1",
        "cart",
        "shop_cart",
        "TDLC_CART_STR",
        "tdlc_buy_now",
        "buy_now",
        "TDLC_BUY_NOW",
        "tdlc_cart_id",
        "cart_id",
        "cartId",
        "cart_token",
        "cartToken",
        "TDLC_CART_ID",
        "checkout_ctx",
        "checkout_address",
        "checkout_address_shipping",
        "checkout_address_billing",
      ];
      for (const k of keys) localStorage.removeItem(k);
      window.dispatchEvent(new Event("cart:changed"));
    }
  } catch {}
}

/* ---------------- Mode choice modal ---------------- */
function CheckoutModeDialog({ open, onGuest, onLogin, onCreate, onClose, subtitle }) {
  if (!open) return null;
  return (
    <div className="co-modal" role="dialog" aria-modal="true">
      <div className="mode-sheet">
        <div className="mode-head">
          <div className="mode-title">How would you like to checkout?</div>
          <button type="button" className="mode-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="mode-sub">{subtitle || "Choose one option to continue."}</div>

        <div className="mode-grid">
          <button type="button" className="mode-card primary" onClick={onGuest}>
            <div className="mode-card-ttl">Guest Mode</div>
            <div className="mode-card-sub">Fast checkout. OTP only for COD confirmation.</div>
          </button>

          <button type="button" className="mode-card" onClick={onLogin}>
            <div className="mode-card-ttl">Account Login</div>
            <div className="mode-card-sub">I already have an account.</div>
          </button>

          <button type="button" className="mode-card" onClick={onCreate}>
            <div className="mode-card-ttl">Create Account</div>
            <div className="mode-card-sub">Create an account for faster future orders.</div>
          </button>
        </div>
      </div>

      <style jsx>{`
        .mode-sheet {
          width: min(520px, calc(100vw - 40px));
          background: #fff;
          border-radius: 18px;
          padding: 16px;
          box-shadow: 0 18px 40px rgba(15, 33, 71, 0.28);
          border: 1px solid ${BORDER};
        }
        .mode-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .mode-title {
          font-weight: 900;
          font-size: 18px;
          color: ${NAVY};
        }
        .mode-x {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 20px;
          cursor: pointer;
        }
        .mode-sub {
          color: ${MUTED};
          font-weight: 700;
          font-size: 13px;
          margin-bottom: 12px;
          line-height: 1.35;
        }
        .mode-grid {
          display: grid;
          gap: 10px;
        }
        .mode-card {
          text-align: left;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          padding: 12px 12px;
          background: #fff;
          cursor: pointer;
          display: grid;
          gap: 4px;
        }
        .mode-card.primary {
          border-color: #1d4ed8;
          background: #eff6ff;
        }
        .mode-card-ttl {
          font-weight: 900;
          color: ${NAVY};
        }
        .mode-card-sub {
          font-size: 12px;
          font-weight: 700;
          color: ${MUTED};
        }
      `}</style>
    </div>
  );
}

/* ---------------- Guest draft helpers (sessionStorage only) ---------------- */
function readGuestDraft() {
  try {
    const raw = sessionStorage.getItem(SS_GUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeGuestDraft(draft) {
  try {
    sessionStorage.setItem(SS_GUEST_KEY, JSON.stringify(draft || {}));
  } catch {}
}

function clearGuestDraft() {
  try {
    sessionStorage.removeItem(SS_GUEST_KEY);
  } catch {}
}

/* ---------------- checkout mode persistence (guest only, sessionStorage) ---------------- */
function readCheckoutModePref() {
  try {
    const raw = sessionStorage.getItem(SS_CHECKOUT_MODE_KEY);
    const v = String(raw || "").toLowerCase();
    if (v === "guest") return "guest";
  } catch {}
  return null;
}

function writeCheckoutModePref(mode) {
  try {
    if (!mode) sessionStorage.removeItem(SS_CHECKOUT_MODE_KEY);
    else sessionStorage.setItem(SS_CHECKOUT_MODE_KEY, String(mode));
  } catch {}
}

/* ---------------- account profile override helpers (checkout-only) ---------------- */
function readAccountProfileOverride() {
  try {
    const raw = localStorage.getItem(LS_ACCOUNT_PROFILE_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAccountProfileOverride(p) {
  try {
    localStorage.setItem(LS_ACCOUNT_PROFILE_OVERRIDE_KEY, JSON.stringify(p || {}));
  } catch {}
}

function clearAccountProfileOverride() {
  try {
    localStorage.removeItem(LS_ACCOUNT_PROFILE_OVERRIDE_KEY);
  } catch {}
}

/* ---------------- checkout method helpers ---------------- */
function readCheckoutMethod(isGuest) {
  try {
    return isGuest
      ? sessionStorage.getItem(SS_CHECKOUT_METHOD_KEY)
      : localStorage.getItem(LS_CHECKOUT_METHOD_KEY);
  } catch {
    return null;
  }
}

function writeCheckoutMethod(isGuest, method) {
  try {
    const v = method ? String(method) : "";
    if (isGuest) {
      if (!v) sessionStorage.removeItem(SS_CHECKOUT_METHOD_KEY);
      else sessionStorage.setItem(SS_CHECKOUT_METHOD_KEY, v);
      return;
    }
    if (!v) localStorage.removeItem(LS_CHECKOUT_METHOD_KEY);
    else localStorage.setItem(LS_CHECKOUT_METHOD_KEY, v);
  } catch {}
}

/* ---------------- Checkout-local address form ---------------- */
function CheckoutAddressForm({
  title,
  subtitle,
  prefill,
  includeUserFields = true,
  requirePhone = true,
  showMakeDefault = false,
  forceDefault = false,
  submitLabel = "Continue",
  onCancel,
  onSubmit,
  onDraftChange, // NEW: live draft updates (guest)
  validateSignal = 0, // NEW: external validation trigger
}) {
  const [vals, setVals] = useState(() => ({
    name: "",
    phone: "",
    email: "",
    houseNo: "",
    houseName: "",
    apartmentNo: "",
    floorNo: "",
    streetAddress: "",
    address2: "",
    village: "",
    postOffice: "",
    union: "",
    policeStation: "",
    upazila: "",
    district: "",
    division: "",
    postalCode: "",
    countryIso2: "BD",
    makeDefault: false,
    ...((prefill && typeof prefill === "object") ? prefill : {}),
  }));

  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  /* ---------------- Autofill / flicker hardening ----------------
   * Problem: Browser "saved address" autofill can write DOM values without firing React onChange.
   * On any re-render, controlled inputs snap back to state -> browser re-applies -> visible flicker.
   * Fix: (1) detect autofill via CSS animation + capture handler, (2) sync DOM values into state once,
   * (3) stop parent prefill from overwriting after user/autofill interaction.
   */
  const formRef = useRef(null);
  const valsRef = useRef(null);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    valsRef.current = vals;
  }, [vals]);

  const markInteracted = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  const syncFromDom = useCallback(() => {
    const root = formRef.current;
    if (!root || typeof window === "undefined") return;

    const els = root.querySelectorAll("input[name], select[name], textarea[name]");
    if (!els || !els.length) return;

    const cur = valsRef.current || {};
    const patch = {};

    els.forEach((el) => {
      const k = el.getAttribute("data-field") || el.getAttribute("name");
      if (!k) return;

      const v = el.value;
      if (v == null) return;

      const s = String(v);
      if (!s.trim()) return;

      const prev = cur?.[k];
      const prevS = prev == null ? "" : String(prev);

      if (s !== prevS) patch[k] = v;
    });

    const keys = Object.keys(patch);
    if (!keys.length) return;

    markInteracted();

    setVals((p) => {
      let changed = false;
      const next = { ...p };

      for (const k of keys) {
        if (!Object.is(next?.[k], patch[k])) {
          next[k] = patch[k];
          changed = true;
        }
      }

      if (!changed) return p;

      next.countryIso2 = String(next.countryIso2 || "BD").toUpperCase();
      return next;
    });
  }, [markInteracted]);

  const handleAutofillAnimationStart = useCallback(
    (e) => {
      if (!e?.animationName) return;
      if (e.animationName !== "tdlsAutofillStart") return;

      const raf =
        (typeof window !== "undefined" && window.requestAnimationFrame) ||
        ((fn) => setTimeout(fn, 0));

      raf(() => {
        // let the browser finish writing all autofilled fields before syncing
        syncFromDom();
      });
    },
    [syncFromDom]
  );

  // Safety: sync shortly after mount (covers cases where autofill happens instantly on load)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t1 = setTimeout(() => syncFromDom(), 60);
    const t2 = setTimeout(() => syncFromDom(), 260);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [syncFromDom]);
  const lastDraftSigRef = useRef("");

  useEffect(() => {
    // Prefill can change frequently in guest mode (because the parent stores a live draft).
    // To avoid render loops while typing, only merge known form fields AND only update state
    // when at least one field actually changed.
    const p = (prefill && typeof prefill === "object") ? prefill : {};
    const patch = {
      name: p.name,
      phone: p.phone,
      email: p.email,
      houseNo: p.houseNo,
      houseName: p.houseName,
      apartmentNo: p.apartmentNo,
      floorNo: p.floorNo,
      streetAddress: p.streetAddress ?? p.address1 ?? p.line1,
      address2: p.address2 ?? p.line2,
      village: p.village,
      postOffice: p.postOffice,
      union: p.union,
      policeStation: p.policeStation,
      upazila: p.upazila ?? p.city,
      district: p.district ?? p.state,
      division: p.division,
      postalCode: p.postalCode,
      countryIso2: p.countryIso2,
      makeDefault: p.makeDefault,
      label: p.label,
      id: p.id,
    };

    setVals((prev) => {
      const next = { ...prev };

      const prevId = String(prev?.id || "").trim();
      const incId = String(patch?.id || "").trim();

      // If a different id comes in (address-book selection), allow full overwrite.
      // Otherwise, after user/autofill interaction, only fill empty fields to avoid blink/tug-of-war.
      const newSelection = !!incId && incId !== prevId;
      const overwrite = !userInteractedRef.current || newSelection;

      for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (v === undefined) continue;

        if (overwrite) {
          next[k] = v;
          continue;
        }

        // Fill-only mode (post-interaction): do not overwrite existing non-empty values.
        const cur = next[k];
        const curEmpty = cur == null || (typeof cur === "string" && cur.trim() === "");
        const incMeaningful = v != null && (!(typeof v === "string") || v.trim() !== "");

        if (curEmpty && incMeaningful) next[k] = v;
      }

      next.countryIso2 = String(next.countryIso2 || "BD").toUpperCase();

      // If nothing changed, do not update state (prevents maximum-update-depth loops).
      // Only compare the fields this form owns.
      const owned = [
        "name","phone","email","houseNo","houseName","apartmentNo","floorNo","streetAddress",
        "address2","village","postOffice","union","policeStation","upazila","district","division",
        "postalCode","countryIso2","makeDefault","label","id",
      ];

      for (const k of owned) {
        const a = prev?.[k];
        const b = next?.[k];
        if (!Object.is(a, b)) return next;
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(prefill || {})]);


  // NEW: external validation trigger (e.g., when user clicks "Place Order" without pressing Continue)
  useEffect(() => {
    if (!validateSignal) return;

    setError("");
    setFieldErrors({});

    const name = String(vals.name || "").trim();
    const phoneRaw = String(vals.phone || "").trim();
    const phone = normalizeBDPhone(phoneRaw);

    const errs = {};
    const missingLabels = [];

    if (includeUserFields) {
      if (!name) errs.name = "required";

      if (requirePhone) {
        if (!phone) errs.phone = "required";
        else if (!isValidBDMobile(phone)) errs.phone = "invalid";
      }
    }

    // Address fields
    const line1 = String(vals.streetAddress || vals.address1 || vals.line1 || "").trim();
    const city = String(vals.upazila || vals.city || "").trim();
    const dist = String(vals.district || vals.state || "").trim();

    if (!line1) errs.streetAddress = "required";
    if (!city) errs.upazila = "required";
    if (!dist) errs.district = "required";

    if (Object.keys(errs).length) {
      setFieldErrors(errs);

      if (errs.name) missingLabels.push("Full name");
      if (errs.phone === "required") missingLabels.push("Mobile number");
      if (errs.streetAddress) missingLabels.push("Street Address");
      if (errs.upazila) missingLabels.push("Upazila / City");
      if (errs.district) missingLabels.push("District");

      if (errs.phone === "invalid") {
        setError(
          "Mobile number format is invalid. Use 017XXXXXXXX, 88017XXXXXXXX, +88017XXXXXXXX, or 088017XXXXXXXX."
        );
        return;
      }

      setError(
        missingLabels.length
          ? `Please complete the highlighted fields: ${missingLabels.join(", ")}.`
          : "Please complete the highlighted fields."
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validateSignal]);

  const setField = useCallback(
    (k, v) => {
      markInteracted();
      setVals((p) => {
        const prevV = p?.[k];
        if (Object.is(prevV, v)) return p;
        return { ...p, [k]: v };
      });
    },
    [markInteracted]
  );


  function isCompleteLocal(a) {
    const line1 = a.streetAddress || a.address1 || a.line1 || "";
    const city = a.upazila || a.city || "";
    const dist = a.district || a.state || "";
    const country = (a.countryIso2 || "BD").toString().toUpperCase();
    if (!line1.trim() || !city.trim() || !dist.trim() || !country.trim()) return false;
    return true;
  }

  // NEW: push live updates to parent (guest draft)
  useEffect(() => {
    if (typeof onDraftChange !== "function") return;

    // IMPORTANT: While typing, do not mutate user-entered values (e.g., normalizing phone to +880…),
    // otherwise the parent prefill round-trip will overwrite the input value and feel like "auto refresh".
    const nameRaw = String(vals.name ?? "");
    const phoneRaw = String(vals.phone ?? "");
    const emailRaw = String(vals.email ?? "");

    const nameNorm = nameRaw.trim();
    const phoneNorm = normalizeBDPhone(phoneRaw);
    const emailNorm = emailRaw.trim().toLowerCase();

    const candidate = {
      ...vals,

      // keep raw user inputs
      name: nameRaw,
      phone: phoneRaw,
      email: emailRaw,

      // provide normalized variants for parent logic (OTP / payload) without feeding back into inputs
      nameNormalized: nameNorm,
      phoneNormalized: phoneNorm,
      emailNormalized: emailNorm,

      countryIso2: (vals.countryIso2 || "BD").toString().toUpperCase(),
      makeDefault: forceDefault ? true : !!vals.makeDefault,
    };

    const phoneValid = !requirePhone || isValidBDMobile(phoneNorm);
    const userOk = !includeUserFields || (!!nameNorm && phoneValid);

    // Address completeness is checked separately; keep it based on the raw fields.
    const complete = userOk && isCompleteLocal(candidate);

    const sig = JSON.stringify({
      v: candidate,
      complete,
      includeUserFields: !!includeUserFields,
      requirePhone: !!requirePhone,
      forceDefault: !!forceDefault,
    });

    if (sig === lastDraftSigRef.current) return;
    lastDraftSigRef.current = sig;
    onDraftChange(candidate, complete);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vals, includeUserFields, requirePhone, forceDefault, showMakeDefault]);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setError("");
    setFieldErrors({});

    const name = String(vals.name || "").trim();
    const phoneRaw = String(vals.phone || "").trim();
    const phone = normalizeBDPhone(phoneRaw);
    const email = String(vals.email || "").trim().toLowerCase();

    const errs = {};

    if (includeUserFields) {
      if (!name) errs.name = "required";

      if (requirePhone) {
        if (!phoneRaw) errs.phone = "required";
        else if (!isValidBDMobile(phoneRaw)) errs.phone = "invalid";
      }
    }

    const street = String(vals.streetAddress || vals.address1 || vals.line1 || "").trim();
    const city = String(vals.upazila || vals.city || "").trim();
    const dist = String(vals.district || vals.state || "").trim();

    if (!street) errs.streetAddress = "required";
    if (!city) errs.upazila = "required";
    if (!dist) errs.district = "required";

    if (Object.keys(errs).length) {
      setFieldErrors(errs);

      const missingLabels = [];
      if (errs.name) missingLabels.push("Full name");
      if (errs.phone === "required") missingLabels.push("Mobile number");
      if (errs.phone === "invalid") {
        setError(
          "Mobile number format is invalid. Use 017XXXXXXXX, 88017XXXXXXXX, +88017XXXXXXXX, or 088017XXXXXXXX."
        );
        return;
      }
      if (errs.streetAddress) missingLabels.push("Street Address");
      if (errs.upazila) missingLabels.push("Upazila / City");
      if (errs.district) missingLabels.push("District");

      setError(
        missingLabels.length
          ? `Please complete the highlighted fields: ${missingLabels.join(", ")}.`
          : "Please complete the highlighted fields."
      );
      return;
    }

    const candidate = {
      ...vals,
      name,
      phone,
      email,
      countryIso2: (vals.countryIso2 || "BD").toString().toUpperCase(),
      makeDefault: forceDefault ? true : !!vals.makeDefault,
    };

    const res = await onSubmit?.(candidate);
    if (res === false) return;
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} onAnimationStartCapture={handleAutofillAnimationStart} className="ca-form">
      {title ? <div className="ca-title">{title}</div> : null}
      {subtitle ? <div className="ca-sub">{subtitle}</div> : null}

      {error ? <div className="ca-error">{error}</div> : null}

      {includeUserFields ? (
        <div className="ca-grid">
          <div className={`ca-field${fieldErrors.name ? " invalid" : ""}`}>
            <label>Full name <span className="req">*</span></label>
            <input
              name="name"
              autoComplete="name"
              value={vals.name || ""}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Your full name"
            />
          </div>
          <div className={`ca-field${fieldErrors.phone ? " invalid" : ""}`}>
            <label>
              Mobile number {requirePhone ? <span className="req">*</span> : null}
            </label>
            <input
              name="phone"
              autoComplete="tel"
              value={vals.phone || ""}
              onChange={(e) => setField("phone", e.target.value)}
              onBlur={(e) => {
                const n = normalizeBDPhone(e.target.value);
                if (n && n !== vals.phone) setField("phone", n);
              }}
              placeholder="017XXXXXXXX / +88017XXXXXXXX"
              inputMode="tel"
            />
          </div>
          <div className="ca-field">
            <label>Email (optional)</label>
            <input
              name="email"
              autoComplete="email"
              value={vals.email || ""}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="name@email.com"
              inputMode="email"
            />
          </div>
        </div>
      ) : null}

      <div className="ca-grid">
        <div className="ca-field">
          <label>House No</label>
          <input
            name="houseNo"
            autoComplete="off"
            value={vals.houseNo || ""}
            onChange={(e) => setField("houseNo", e.target.value)}
            placeholder="House No"
          />
        </div>
        <div className="ca-field">
          <label>House Name</label>
          <input
            name="houseName"
            autoComplete="off"
            value={vals.houseName || ""}
            onChange={(e) => setField("houseName", e.target.value)}
            placeholder="House Name"
          />
        </div>
        <div className="ca-field">
          <label>Apartment No</label>
          <input
            name="apartmentNo"
            autoComplete="off"
            value={vals.apartmentNo || ""}
            onChange={(e) => setField("apartmentNo", e.target.value)}
            placeholder="Apartment"
          />
        </div>
        <div className="ca-field">
          <label>Floor No</label>
          <input
            name="floorNo"
            autoComplete="off"
            value={vals.floorNo || ""}
            onChange={(e) => setField("floorNo", e.target.value)}
            placeholder="Floor"
          />
        </div>
      </div>

      <div className="ca-grid">
        <div className={`ca-field ca-span2${fieldErrors.streetAddress ? " invalid" : ""}`}>
          <label>
            Street Address <span className="req">*</span>
          </label>
          <input
            name="streetAddress"
            autoComplete="address-line1"
            value={vals.streetAddress || vals.address1 || ""}
            onChange={(e) => setField("streetAddress", e.target.value)}
            placeholder="Street / Road / Area"
          />
        </div>
        <div className="ca-field ca-span2">
          <label>Address line 2 (optional)</label>
          <input
            name="address2"
            autoComplete="address-line2"
            value={vals.address2 || ""}
            onChange={(e) => setField("address2", e.target.value)}
            placeholder="Nearby landmark / extra details"
          />
        </div>
      </div>

      <div className="ca-grid">
        <div className={`ca-field${fieldErrors.upazila ? " invalid" : ""}`}>
          <label>
            Upazila / City <span className="req">*</span>
          </label>
          <input
            name="upazila"
            autoComplete="address-level3"
            value={vals.upazila || vals.city || ""}
            onChange={(e) => setField("upazila", e.target.value)}
            placeholder="Upazila / City"
          />
        </div>
        <div className={`ca-field${fieldErrors.district ? " invalid" : ""}`}>
          <label>
            District <span className="req">*</span>
          </label>
          <input
            name="district"
            autoComplete="address-level2"
            value={vals.district || ""}
            onChange={(e) => setField("district", e.target.value)}
            placeholder="District"
          />
        </div>
        <div className="ca-field">
          <label>Division (optional)</label>
          <input
            name="division"
            autoComplete="address-level1"
            value={vals.division || ""}
            onChange={(e) => setField("division", e.target.value)}
            placeholder="Division"
          />
        </div>
        <div className="ca-field">
          <label>Postal Code (optional)</label>
          <input
            name="postalCode"
            autoComplete="postal-code"
            value={vals.postalCode || ""}
            onChange={(e) => setField("postalCode", e.target.value)}
            placeholder="Postal code"
            inputMode="numeric"
          />
        </div>
      </div>

      <div className="ca-grid">
        <div className="ca-field">
          <label>Post Office (optional)</label>
          <input
            name="postOffice"
            autoComplete="off"
            value={vals.postOffice || ""}
            onChange={(e) => setField("postOffice", e.target.value)}
            placeholder="Post Office"
          />
        </div>
        <div className="ca-field">
          <label>Union (optional)</label>
          <input
            name="union"
            autoComplete="off"
            value={vals.union || ""}
            onChange={(e) => setField("union", e.target.value)}
            placeholder="Union"
          />
        </div>
        <div className="ca-field">
          <label>Police Station / Thana (optional)</label>
          <input
            name="policeStation"
            autoComplete="off"
            value={vals.policeStation || vals.thana || ""}
            onChange={(e) => setField("policeStation", e.target.value)}
            placeholder="Police Station / Thana"
          />
        </div>
        <div className="ca-field">
          <label>Country</label>
          <select
            name="countryIso2"
            autoComplete="country"
            value={(vals.countryIso2 || "BD").toString().toUpperCase()}
            onChange={(e) => setField("countryIso2", e.target.value)}
          >
            <option value="BD">Bangladesh (BD)</option>
          </select>
        </div>
      </div>

      {showMakeDefault || forceDefault ? (
        <label className="chk">
          <input
            name="makeDefault"
            autoComplete="off"
            type="checkbox"
            checked={forceDefault ? true : !!vals.makeDefault}
            onChange={(e) => {
              if (forceDefault) return;
              setField("makeDefault", e.target.checked);
            }}
            disabled={forceDefault}
          />
          <span>Make this my default address</span>
        </label>
      ) : null}

      <div className="ca-actions">
        <button type="button" className="ca-btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="ca-btn primary">
          {submitLabel}
        </button>
      </div>

      <style jsx>{`
        .ca-form {
          width: 100%;
          display: grid;
          gap: 12px;
        }
        .ca-title {
          font-weight: 900;
          color: ${NAVY};
          font-size: 16px;
        }
        .ca-sub {
          color: ${MUTED};
          font-weight: 700;
          font-size: 13px;
          line-height: 1.35;
          margin-top: -6px;
        }
        .ca-error {
          background: #fee2e2;
          border: 1px solid #fecaca;
          color: #991b1b;
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 800;
        }
        .ca-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .ca-span2 {
          grid-column: span 2;
        }
        .ca-field {
          display: grid;
          gap: 6px;
        }
        .ca-field label {
          color: ${NAVY};
          font-weight: 800;
          font-size: 12px;
        }
        .req {
          color: #dc2626;
          font-weight: 900;
        }
        .ca-field.invalid label {
          color: #dc2626;
        }
        .ca-field.invalid input,
        .ca-field.invalid select,
        .ca-field.invalid textarea {
          border-color: #dc2626 !important;
          box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
        }
        .ca-field input,
        .ca-field select {
          height: 44px;
          border: 1px solid ${BORDER};
          border-radius: 12px;
          padding: 0 12px;
          font-weight: 700;
          color: ${NAVY};
          outline: none;
          background: #fff;
        }
/* Autofill: prevent browser repaint flicker + enable animationstart sync */
@keyframes tdlsAutofillStart {
  from {
  }
  to {
  }
}
@keyframes tdlsAutofillCancel {
  from {
  }
  to {
  }
}

.ca-field input:-webkit-autofill,
.ca-field textarea:-webkit-autofill,
.ca-field select:-webkit-autofill {
  animation-name: tdlsAutofillStart;
  animation-duration: 0.01s;
  animation-iteration-count: 1;
}

.ca-field input:-webkit-autofill,
.ca-field input:-webkit-autofill:hover,
.ca-field input:-webkit-autofill:focus,
.ca-field textarea:-webkit-autofill,
.ca-field textarea:-webkit-autofill:hover,
.ca-field textarea:-webkit-autofill:focus,
.ca-field select:-webkit-autofill,
.ca-field select:-webkit-autofill:hover,
.ca-field select:-webkit-autofill:focus {
  -webkit-text-fill-color: ${NAVY};
  caret-color: ${NAVY};
  -webkit-box-shadow: 0 0 0px 1000px #fff inset;
  box-shadow: 0 0 0px 1000px #fff inset;
  transition: background-color 9999s ease-out 0s;
}

        .ca-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          padding-top: 4px;
        }
        .ca-btn {
          height: 44px;
          border-radius: 9999px;
          font-weight: 900;
          padding: 0 18px;
          border: 1px solid ${BORDER};
          background: #fff;
          color: ${NAVY};
        }
        .ca-btn.primary {
          border: 0;
          background: linear-gradient(135deg, #1e3a8a, #0ea5e9);
          color: #fff;
          box-shadow: 0 8px 18px rgba(14, 165, 233, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.25);
        }
        .ca-btn.ghost {
          background: #fff;
          border: 1px solid ${BORDER};
        }
        @media (max-width: 640px) {
          .ca-grid {
            grid-template-columns: 1fr;
          }
          .ca-span2 {
            grid-column: span 1;
          }
        }
      `}</style>
    </form>
  );
}

export default function CheckoutPage({ initialAddressMeta = null, initialSessionUser = null, serverCartId = null } = {}) {
  // Optional SSR/route-level preload (pass the /api/customers/address-book JSON here)
  // so addresses are already rendered on first paint.
  const seededMeta = (() => {
    if (!initialAddressMeta) return null;

    // Accept either server JSON shape or already-normalized internal shape.
    const rawList = Array.isArray(initialAddressMeta?.list)
      ? initialAddressMeta.list
      : Array.isArray(initialAddressMeta?.addresses)
      ? initialAddressMeta.addresses
      : Array.isArray(initialAddressMeta?.data)
      ? initialAddressMeta.data
      : [];

    const list = rawList.map((a, i) => normalizeAddress(a, i)).filter(Boolean);

    const rawDef =
      initialAddressMeta?.defaultAddr ??
      initialAddressMeta?.defaultAddress ??
      initialAddressMeta?.default ??
      initialAddressMeta?.address ??
      null;

    const defaultAddr = normalizeAddress(rawDef, -1);

    const defaultId =
      initialAddressMeta?.defaultId ??
      initialAddressMeta?.defaultAddressId ??
      initialAddressMeta?.default_address_id ??
      (defaultAddr?.id ?? null);

    return { list, defaultAddr, defaultId, _status: 200 };
  })();

  const seededDefault = (() => {
    if (!seededMeta) return null;
    const byDefaultId =
      seededMeta?.defaultId != null
        ? (seededMeta.list || []).find(
            (a) => a?.id != null && String(a.id) === String(seededMeta.defaultId)
          ) || null
        : null;
    return seededMeta.defaultAddr || byDefaultId || (seededMeta.list || []).find((a) => a?.isDefault) || null;
  })();

  const seededDefaultKey = seededDefault?._key ?? null;

  // Seed the in-memory prime cache once (avoids immediate re-fetch after SSR).
  const _seededOnce = useRef(false);
  if (!_seededOnce.current && seededMeta) {
    _seededOnce.current = true;
    seedAddressBookMeta(seededMeta);
  }

  // ACCOUNT MODE STATE
  const [addresses, setAddresses] = useState(() => (seededMeta?.list ? seededMeta.list : []));
  const [selectedKey, setSelectedKey] = useState(() => seededDefaultKey);
  const [shipping, setShipping] = useState(() => seededDefault || null);
  const [billing, setBilling] = useState(() => seededDefault || null);

  const [shippingDifferent, setShippingDifferent] = useState(false);
  const [billingDifferent, setBillingDifferent] = useState(false);
  const [shippingEditorOpen, setShippingEditorOpen] = useState(false);
  const [billingEditorOpen, setBillingEditorOpen] = useState(false);
  const [editingShipping, setEditingShipping] = useState(null);
  const [editingBilling, setEditingBilling] = useState(null);

  const [userInfo, setUserInfo] = useState(() => ({
    id: initialSessionUser?.id || "",
    name: initialSessionUser?.name || "",
    email: initialSessionUser?.email || "",
    phone: initialSessionUser?.phone || "",
    phoneVerified: !!(initialSessionUser?.phoneVerified || initialSessionUser?.phoneVerifiedAt),
  }));
  const [defaultKey, setDefaultKey] = useState(() => seededDefaultKey);
  const [defaultEditing, setDefaultEditing] = useState(false);

  // BOTH MODES
  const [methodSelected, setMethodSelected] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  const [cartId, setCartId] = useState(null);
  const [cartSnapshot, setCartSnapshot] = useState(null);

  const [gateOpen, setGateOpen] = useState(false);
  const [gateMessage, setGateMessage] = useState("");
  const [toast, setToast] = useState("");

  // Place Order CTA guard (shows inline warning near button when CTA is disabled)
  const [placeOrderCtaWarning, setPlaceOrderCtaWarning] = useState("");

  // OTP (COD ONLY: ACCOUNT + GUEST)
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpIdentifier, setOtpIdentifier] = useState("");
  const [otpTtl, setOtpTtl] = useState(90);
  const otpResolverRef = useRef(null);
  const lastOtpRef = useRef(null);

  const initialLoaded = useRef(false);
  const preOtpSnapshotRef = useRef(null);

  // SESSION + CHECKOUT MODE
  const impliedAccount = !!(initialSessionUser?.id || (seededMeta && ((seededMeta.list || []).length || seededMeta.defaultId != null || seededMeta.defaultAddr)));
  const [sessionChecked, setSessionChecked] = useState(() => !!initialSessionUser?.id);
  const [checkoutMode, setCheckoutMode] = useState(() => (impliedAccount ? "account" : null)); // "account" | "guest" | null
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
// GUEST STATE (session-only)
  const [guestDraft, setGuestDraft] = useState({
    profile: { name: "", phone: "", email: "" },
    shipping: null,
    billingDifferent: false,
    billing: null,
  });

  // Guest forms: trigger validation highlight from outside (e.g., Place Order clicked)
  const [guestShipValidateSignal, setGuestShipValidateSignal] = useState(0);
  const [guestBillValidateSignal, setGuestBillValidateSignal] = useState(0);

  // Prevent draft feedback loops while typing in guest address forms
  const lastGuestShipSigRef = useRef("");
  const lastGuestBillSigRef = useRef("");

  // legacy event path support
  useEffect(() => {
    const onPlace = (evt) => {
      const m = normalizeMethod(evt?.detail?.methodSelected);
      if (m) setMethodSelected(m);
      placeOrder(evt?.detail);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("checkout:place-order", onPlace);
      window.__onPlaceOrder = (payload) => {
        const m = normalizeMethod(payload?.methodSelected);
        if (m) setMethodSelected(m);
        placeOrder(payload);
      };
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("checkout:place-order", onPlace);
        if (window.__onPlaceOrder)
          try {
            delete window.__onPlaceOrder;
          } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function gotoLogin() {
    const dest = `/login?redirect=${encodeURIComponent(
      typeof window !== "undefined" ? window.location.pathname || "/checkout" : "/checkout"
    )}`;
    window.location.href = dest;
  }

  function gotoSignup() {
    const dest = `/signup?redirect=${encodeURIComponent(
      typeof window !== "undefined" ? window.location.pathname || "/checkout" : "/checkout"
    )}`;
    window.location.href = dest;
  }

  function openModeDialog(message) {
    if (message) setToast(message);
    setModeDialogOpen(true);
  }

  function pickSelected(list) {
    return list.find((a) => a._key === defaultKey) || list[0] || null;
  }

  function select(addr) {
    if (!addr) return;
    setSelectedKey(addr._key);
    setShipping(addr);
    try {
      localStorage.setItem("checkout_address", JSON.stringify(addr));
    } catch {}
  }

  async function fetchSessionUserNoRedirect() {
    try {
      const r = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => ({}));
      const id = j?.user?.id;
      if (!id) return null;
      return {
        id,
        name: j?.user?.name || "",
        email: j?.user?.email || "",
        phone: j?.user?.phone || "",
        phoneVerified: !!(j?.user?.phoneVerified || j?.user?.phoneVerifiedAt),
      };
    } catch {
      return null;
    }
  }

  async function buildFreshCartSnapshot() {
    let decorated = [];
    let serverCartId = null;

    try {
      const rc = await fetch("/api/cart", {
        credentials: "include",
        cache: "no-store",
      });
      if (rc.ok) {
        const c = await rc.json().catch(() => ({}));
        const serverItems = Array.isArray(c?.items)
          ? c.items
          : Array.isArray(c?.cart?.items)
          ? c.cart.items
          : [];
        const normalized = serverItems.map(mapAnyItemToSnapshotShape).filter(Boolean);
        decorated = decorateForDisplay(normalized);
        serverCartId = c?.id || c?.cartId || c?.cart?.id || null;
      }
    } catch {}

    purgeLegacyCartKeysIfCanonicalExists();

    const fromLS = snapshotFromLocalStorage();
    const fromWin = snapshotFromWindow();

    let snap = null;
    const candidates = [];
    if (decorated.length) candidates.push({ items: decorated, _source: "server" });
    if (fromLS?.items?.length) candidates.push(fromLS);
    if (fromWin?.items?.length) candidates.push(fromWin);

    if (candidates.length) {
      snap = candidates.reduce((best, cur) => {
        const bLen = best?.items?.length || 0;
        const cLen = cur?.items?.length || 0;
        if (cLen > bLen) return cur;
        return best;
      });
    }

    if (snap && Array.isArray(snap.items) && snap.items.length) {
      if (serverCartId) setCartId(String(serverCartId));
      setCartSnapshot(snap);
      persistSnapshot(snap);
      return snap;
    }

    return null;
  }

  // INIT: decide mode (account vs guest) and hydrate accordingly
  useEffect(() => {
    (async () => {
      setToast("");
      purgeLegacyCartKeysIfCanonicalExists();

      // Load guest draft early (session-only)
      const draft = typeof window !== "undefined" ? readGuestDraft() : null;
      if (draft) setGuestDraft((p) => ({ ...p, ...draft }));

      // Load checkout-only account profile override
      const profOverride = typeof window !== "undefined" ? readAccountProfileOverride() : null;
      if (profOverride && typeof profOverride === "object") {
        setUserInfo((prev) => ({ ...prev, ...profOverride }));
      }

      // Start address-book fetch immediately (overlaps with session fetch + render).
      // NOTE: primeAddressBookMeta does NOT cache 401 (not-logged-in) results.
      primeAddressBookMeta().catch(() => null);

      // SSR/route-level session preload: render account UI immediately (no waiting).
      if (initialSessionUser?.id) {
        setCheckoutMode("account");
        setModeDialogOpen(false);
        setUserInfo((prev) => ({ ...prev, ...initialSessionUser }));
        // hydrateAccount will use the already-seeded address meta if present; it can refresh in background.
        hydrateAccount({ sessionUser: initialSessionUser, keepSelection: true }).catch(() => null);
        setSessionChecked(true);
        return;
      }

      const sessionUser = await fetchSessionUserNoRedirect();
if (sessionUser?.id) {
        setCheckoutMode("account");
        setUserInfo((prev) => ({ ...prev, ...sessionUser }));
        await hydrateAccount({ sessionUser, keepSelection: true });
        setSessionChecked(true);
        return;
      }

      // Not logged in -> require explicit mode choice (no cross-tab remembering)
      const pref = typeof window !== "undefined" ? readCheckoutModePref() : null;
      if (pref === "guest") {
        setCheckoutMode("guest");
        setModeDialogOpen(false);
        setSessionChecked(true);

        // IMPORTANT: do NOT preselect payment method; user must pick one
        setMethodSelected(null);
        writeCheckoutMethod(true, "");
        return;
      }

      setCheckoutMode(null);
      setModeDialogOpen(true);
      setSessionChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close OTP modal if mode is not valid
  useEffect(() => {
    if (checkoutMode !== "account" && checkoutMode !== "guest") {
      setOtpOpen(false);
      lastOtpRef.current = null;
      otpResolverRef.current = null;
    }
  }, [checkoutMode]);

  async function hydrateAccount({ sessionUser, keepSelection = true } = {}) {
    const [meta, me] = await Promise.all([
      primeAddressBookMeta().catch(() => ({ list: [], defaultAddr: null, defaultId: null })),
      profile.read().catch(() => ({})),
    ]);

    const allRaw = Array.isArray(meta?.list) ? meta.list : [];
    const byDefaultId =
      meta?.defaultId != null
        ? allRaw.find((a) => a?.id != null && String(a.id) === String(meta.defaultId)) || null
        : null;

    let defRaw = meta?.defaultAddr || byDefaultId || allRaw.find((a) => a?.isDefault) || null;

    // Last-resort fallback if API didn't include default info (kept for backward compatibility)
    if (!defRaw && !initialLoaded.current) {
      defRaw = await book.getDefault().catch(() => null);
    }

    let currentUser = { ...userInfo };
    if (sessionUser?.id) currentUser = { ...currentUser, ...sessionUser };
    if (me?.id) {
      currentUser = {
        ...currentUser,
        id: me.id,
        name: me.name ?? currentUser.name,
        email: me.email ?? currentUser.email,
        phone: me.phone ?? currentUser.phone,
        phoneVerified: !!(me.phoneVerified || me.phoneVerifiedAt) || currentUser.phoneVerified,
      };
      setUserInfo((prev) => ({ ...prev, ...currentUser }));
    } else if (sessionUser?.id) {
      setUserInfo((prev) => ({ ...prev, ...sessionUser }));
    }

    let unique = dedupePreserveOrder(allRaw);
    if (!unique.length && defRaw) unique = [defRaw];
    if (!initialLoaded.current && defRaw) setDefaultKey(defRaw._key);
    setAddresses(unique);

    if (!initialLoaded.current) {
      const initial = defRaw || pickSelected(unique);
      if (initial) select(initial);

      try {
        const s = JSON.parse(localStorage.getItem("checkout_address_shipping"));
        if (s) setShipping(s);
      } catch {}

      try {
        const b = JSON.parse(localStorage.getItem("checkout_address_billing"));
        if (b) setBilling(b);
      } catch {}

      try {
        const savedMethod = localStorage.getItem(LS_CHECKOUT_METHOD_KEY);
        if (savedMethod) setMethodSelected(normalizeMethod(savedMethod));
      } catch {}

      initialLoaded.current = true;
    } else if (keepSelection) {
      const keep = unique.find((a) => a._key === selectedKey) || pickSelected(unique);
      if (keep) select(keep);
    }

    runCompletenessGate({ unique, defRaw, userSnapshot: currentUser });
  }

  useEffect(() => {
    if (!selectedKey) return;
    const now = addresses.find((a) => a._key === selectedKey);
    if (now) setShipping(now);
  }, [addresses, selectedKey]);

  // Only resync stored payment method on tab visibility change
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const isGuest = checkoutMode === "guest";
      const saved = readCheckoutMethod(isGuest);
      if (saved) setMethodSelected(normalizeMethod(saved));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [checkoutMode]);

  /* ---------------- OTP for COD confirmation (account + guest) ---------------- */
  async function openOtpModalFor(identifier, channelGuess = "sms", purpose = COD_OTP_PURPOSE) {
    if (checkoutMode !== "account" && checkoutMode !== "guest") return { ok: false };

    const rawIdentifier = String(identifier || "").trim();
    if (!rawIdentifier) {
      setToast("No phone/email available for OTP verification.");
      return { ok: false };
    }

    const safeId = /\S+@\S+/.test(rawIdentifier) ? rawIdentifier : normalizeBDPhone(rawIdentifier);
    if (!safeId) {
      setToast("Please provide a valid phone/email for OTP verification.");
      return { ok: false };
    }

    const req = await requestOtp(safeId, channelGuess, purpose, { allowGuest: checkoutMode === "guest" });
    if (!req.ok) {
      setToast(req.j?.error || "Could not send verification code.");
      return { ok: false };
    }

    const display = req.j?.displayIdentifier || req.j?.identifier || safeId;

    setOtpIdentifier(display);
    setOtpTtl(req.j?.ttlSeconds || 90);

    lastOtpRef.current = {
      identifier: safeId,
      displayIdentifier: display,
      code: "",
      purpose,
    };

    setOtpOpen(true);
    const result = await new Promise((resolve) => {
      otpResolverRef.current = resolve;
    });
    setOtpOpen(false);
    return result;
  }

  async function verifyOtpPair(identifier, code, purpose = COD_OTP_PURPOSE) {
    const v = await verifyOtpApi(identifier, code, purpose);
    if (!v.ok) setToast("Invalid or expired code. Please try again.");
    return v.ok;
  }

  const defaultAddr =
    addresses.find((a) => a._key === defaultKey) || addresses.find((a) => a.isDefault) || null;

  /**
   * Address create/update: NO OTP in checkout.
   * (Account mode only; guest never calls address book APIs.)
   */
  async function createOrUpdate(values, oldId = null) {
    const newPhone = normalizeBDPhone(values.phone || "");
    const newEmail = (values.email || "").trim().toLowerCase();

    const payloadValues = { ...values, phone: newPhone, email: newEmail };

    const localSaved = normalizeAddress(
      { ...payloadValues, id: oldId || values.id || undefined },
      0
    );

    const attempt = async () =>
      oldId ? await book.update(oldId, payloadValues) : await book.create(payloadValues);

    const res = await attempt();

    if (!res.ok && res.status === 401) {
      setToast("Your session expired. Please login again or use Guest Mode.");
      setCheckoutMode(null);
      setModeDialogOpen(true);
      return { ok: false, localOnly: true, localSaved };
    }

    const msg = String(res?.j?.error || res?.j?.message || "").toUpperCase();
    const otpLike = res.status === 403 || msg.includes("OTP") || msg.includes("VERIFICATION");
    if (!res.ok && otpLike) {
      setToast(
        "This address update needs verification. Checkout will continue using this address for now. OTP is used during COD confirmation."
      );
      return { ok: true, localOnly: true, localSaved };
    }

    if (!res.ok) return { ok: false, localOnly: true, localSaved, res };

    const saved = normalizeAddress(res.j?.data || res.j?.address || res.j, values.id);
    return { ok: true, localOnly: false, saved, res };
  }

  async function saveDefaultProfileAndAddress(values) {
    const newPhone = normalizeBDPhone(values.phone || "");
    const newEmail = (values.email || "").trim().toLowerCase();
    const newName = (values.name || "").trim();

    const override = { name: newName, phone: newPhone, email: newEmail };
    setUserInfo((u) => ({ ...u, ...override }));
    writeAccountProfileOverride(override);

    const res = await createOrUpdate(
      { ...values, name: newName, phone: newPhone, email: newEmail, makeDefault: true },
      values.id || null
    );

    if (!res.ok) {
      setToast(
        res?.res?.j?.error ||
          "Could not save to account. Using these details for this checkout only."
      );
      setDefaultEditing(false);
      return { ok: true, localOnly: true };
    }

    if (!res.localOnly) {
      clearAccountProfileOverride();
      setDefaultEditing(false);
      invalidateAddressBookMeta();
      primeAddressBookMeta({ force: true }).catch(() => null);
      await hydrateAccount({ sessionUser: null, keepSelection: true });
      setToast("Default profile & address updated.");
      return { ok: true };
    }

    setDefaultEditing(false);
    setToast("Updated for this checkout only.");
    return { ok: true, localOnly: true };
  }

  useEffect(() => {
    if (shippingDifferent) setShippingEditorOpen(true);
  }, [shippingDifferent]);

  useEffect(() => {
    if (billingDifferent) setBillingEditorOpen(true);
  }, [billingDifferent]);

  async function submitShipping(values) {
    const res = await createOrUpdate(
      { ...values, makeDefault: !!values.makeDefault },
      editingShipping?.id || null
    );

    if (!res.ok) {
      setToast(res?.res?.j?.error || "Could not save shipping address.");
      return false;
    }

    const saved = res.localOnly ? res.localSaved : res.saved;

    setShipping(saved);
    setSelectedKey(saved._key);

    try {
      localStorage.setItem("checkout_address_shipping", JSON.stringify(saved));
    } catch {}

    if (!res.localOnly) {
      invalidateAddressBookMeta();
      primeAddressBookMeta({ force: true }).catch(() => null);
      await hydrateAccount({ sessionUser: null, keepSelection: true });
    }

    setShippingEditorOpen(false);
    setEditingShipping(null);
    setToast("Shipping address saved.");
    return true;
  }

  async function submitBilling(values) {
    const res = await createOrUpdate(
      { ...values, makeDefault: !!values.makeDefault },
      editingBilling?.id || null
    );

    if (!res.ok) {
      setToast(res?.res?.j?.error || "Could not save billing address.");
      return false;
    }

    const saved = res.localOnly ? res.localSaved : res.saved;

    setBilling(saved);
    try {
      localStorage.setItem("checkout_address_billing", JSON.stringify(saved));
    } catch {}

    if (!res.localOnly) {
      invalidateAddressBookMeta();
      primeAddressBookMeta({ force: true }).catch(() => null);
      await hydrateAccount({ sessionUser: null, keepSelection: true });
    }

    setBillingEditorOpen(false);
    setEditingBilling(null);
    setToast("Billing address saved.");
    return true;
  }

  async function handleGridEdit(addr) {
    setEditingShipping(addr);
    setShippingEditorOpen(true);
    setShippingDifferent(true);
  }

  async function handleGridDelete(addr) {
    if (addr.isDefault || !addr?.id) return;

    const res = await book.remove(addr.id);

    if (!res.ok) {
      if (res.status === 401) {
        setToast("Your session expired. Please choose how you want to continue.");
        setCheckoutMode(null);
        setModeDialogOpen(true);
        return;
      }

      const msg = String(res?.j?.error || res?.j?.message || "").toUpperCase();
      const otpLike = res.status === 403 || msg.includes("OTP") || msg.includes("VERIFICATION");
      if (otpLike) {
        setToast(
          "This delete requires verification. Checkout will continue without deleting. OTP is used during COD confirmation."
        );
        return;
      }

      setToast(res.j?.error || "Could not delete address.");
      invalidateAddressBookMeta();
      primeAddressBookMeta({ force: true }).catch(() => null);
      await hydrateAccount({ sessionUser: null, keepSelection: true });
      return;
    }

    setAddresses((prev) => {
      const filtered = prev.filter(
        (a) => String(a.id) !== String(addr.id) && a._key !== addr._key
      );

      let nextDefaultKey = defaultKey;
      if (addr._key === defaultKey) {
        const nextDefault = filtered.find((a) => a.isDefault) || filtered[0] || null;
        nextDefaultKey = nextDefault?._key ?? null;
        setDefaultKey(nextDefaultKey);
      }

      if (addr._key === selectedKey) {
        const nextSelected =
          filtered.find((a) => a._key === nextDefaultKey) || filtered[0] || null;
        setSelectedKey(nextSelected?._key ?? null);
        setShipping(nextSelected || null);
      }

      runCompletenessGate({
        unique: filtered,
        defRaw: null,
        userSnapshot: userInfo,
      });

      return filtered;
    });

    invalidateAddressBookMeta();
        setToast("Address deleted.");
  }

  function isAddressComplete(a) {
    if (!a) return false;
    const line1 = a.address1 || a.line1 || a.streetAddress;
    const city = a.upazila || a.city;
    const dist = a.district || a.state;
    if (!line1 || !city || !dist || !a.countryIso2) return false;
    return true;
  }

  function runCompletenessGate({ unique, defRaw, userSnapshot }) {
    const defaultAddrGuess = defRaw || unique?.find((a) => a.isDefault) || null;
    const src = userSnapshot || userInfo;
    const effectivePhoneVerified = !!(src.phoneVerified || defaultAddrGuess?.phoneVerified);

    const effectiveName = (src.name || defaultAddrGuess?.name || "").trim();
    const effectivePhone = (src.phone || defaultAddrGuess?.phone || "").trim();
    const missing = [];
    if (!effectiveName) missing.push("Full name");
    if (!effectivePhone) missing.push("Mobile number");

    let msg = "";
    if (missing.length) msg = `Missing: ${missing.join(", ")}`;
    else if (!effectivePhoneVerified) msg = "Mobile will be verified during COD confirmation (OTP).";
    else if (!isAddressComplete(defaultAddrGuess))
      msg = "Your default address needs street / city / district.";
    setGateMessage(msg);
    setGateOpen(Boolean(msg));
  }

  function addressesEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.id && b.id) return String(a.id) === String(b.id);
    const norm = (x) =>
      [
        x.name,
        x.phone,
        x.email,
        x.line1 || x.address1 || x.streetAddress,
        x.line2 || x.address2,
        x.upazila || x.city,
        x.district || x.state,
        x.postalCode,
        (x.countryIso2 || x.country || "").toString().toUpperCase(),
      ]
        .map((v) => String(v ?? "").trim().toLowerCase())
        .join("|");
    return norm(a) === norm(b);
  }

  const methodCanon = normalizeMethod(methodSelected);

  // EFFECTIVE shipping/billing depends on mode
  const isGuest = checkoutMode === "guest";
  const effectiveShipping = isGuest ? guestDraft.shipping : shipping || defaultAddr || null;

  const effectiveBilling = isGuest
    ? guestDraft.billingDifferent
      ? guestDraft.billing
      : guestDraft.shipping
    : billingDifferent
    ? billing || null
    : billing || defaultAddr || null;

  const codNeedsMatch =
    methodCanon === "COD" &&
    effectiveShipping &&
    effectiveBilling &&
    !addressesEqual(effectiveShipping, effectiveBilling);

  // Place Order CTA gating (Summary disables the CTA; we intercept clicks to show a clear message)
  const shipIncomplete = !effectiveShipping || !isAddressComplete(effectiveShipping);
  const savedMethodForUi = !methodCanon ? normalizeMethod(readCheckoutMethod(isGuest)) : null;
  const guestOnlineNotAllowed = isGuest && methodCanon && methodCanon !== "COD";

  // If Summary disables Place Order, we show an invisible click-catcher over the CTA area
  const placeOrderUiDisabled =
    !checkoutMode || !methodCanon || shipIncomplete || codNeedsMatch || guestOnlineNotAllowed;

  // Clear inline CTA warning once the blocking conditions are resolved
  useEffect(() => {
    if (!placeOrderCtaWarning) return;

    if (!placeOrderUiDisabled) {
      setPlaceOrderCtaWarning("");
      return;
    }

    const needsPayment = !methodCanon;
    const needsShip = shipIncomplete;
    const needsCodMatch = codNeedsMatch;

    let next = placeOrderCtaWarning;

    if (!checkoutMode) {
      next = "Please choose a checkout mode to continue.";
    } else if (guestOnlineNotAllowed) {
      next =
        "Online payment requires an account. Please log in or create an account to use online payment methods.";
    } else if (needsPayment && needsShip) {
      next = "Please select a payment method and complete your shipping address.";
    } else if (needsPayment) {
      next = "Please select a payment method to place your order.";
    } else if (needsShip) {
      next = "Please complete your shipping address to place your order.";
    } else if (needsCodMatch) {
      next = "For Cash on Delivery, shipping and billing addresses must be the same.";
    } else {
      next = "Please complete the required steps above to place your order.";
    }

    if (next !== placeOrderCtaWarning) setPlaceOrderCtaWarning(next);
  }, [
    placeOrderUiDisabled,
    methodCanon,
    shipIncomplete,
    codNeedsMatch,
    guestOnlineNotAllowed,
    checkoutMode,
    placeOrderCtaWarning,
  ]);

  // Summary-safe address shapes (prevents string indexing like field?.[0] showing only 1 character)
  const summaryShipping = useMemo(
    () => coerceAddressForSummary(effectiveShipping),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(effectiveShipping || {})]
  );
  const summaryBilling = useMemo(
    () => coerceAddressForSummary(effectiveBilling),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(effectiveBilling || {})]
  );

  /* ---------------- GUEST: live draft apply ---------------- */
  function applyGuestShippingDraft(values) {
    // IMPORTANT: keep raw typed values in draft to avoid input "jumping" while typing.
    // Store normalized variants separately for validation / OTP / server payload.
    const nameRaw = String(values?.name ?? "");
    const phoneRaw = String(values?.phone ?? "");
    const emailRaw = String(values?.email ?? "");

    const nameNorm = nameRaw.trim();
    const phoneNorm = normalizeBDPhone(phoneRaw);
    const emailNorm = emailRaw.trim().toLowerCase();

    // IMPORTANT (guest typing stability):
    // Do NOT run normalizeAddress() here — it can rewrite `streetAddress` by composing house fields,
    // which feeds back into the form and can cause maximum-update-depth loops while typing.
    const rest = values && typeof values === "object" ? { ...values } : {};
    delete rest._key;
    delete rest._ord;
    delete rest.address1;
    delete rest.line1;
    delete rest.line2;

    const shippingDraft = {
      ...rest,

      // raw
      name: nameRaw,
      phone: phoneRaw,
      email: emailRaw,

      // normalized (NOT used by inputs)
      nameNormalized: nameNorm,
      phoneNormalized: phoneNorm,
      emailNormalized: emailNorm,

      countryIso2: String(rest.countryIso2 || "BD").toUpperCase(),
      // Guest checkout never stores defaults
      makeDefault: false,
    };

    setGuestDraft((prev) => {
      const next = {
        ...prev,
        profile: {
          name: nameRaw,
          phone: phoneRaw,
          email: emailRaw,
          nameNormalized: nameNorm,
          phoneNormalized: phoneNorm,
          emailNormalized: emailNorm,
        },
        shipping: shippingDraft,
      };

      const sig = JSON.stringify({ profile: next.profile, shipping: next.shipping });
      if (sig === lastGuestShipSigRef.current) return prev;
      lastGuestShipSigRef.current = sig;

      writeGuestDraft(next);
      return next;
    });
  }

  function applyGuestBillingDraft(values) {
    // Keep raw typed values; store normalized variants separately (avoid input jump).
    const nameRaw = String(values?.name ?? "");
    const phoneRaw = String(values?.phone ?? "");
    const emailRaw = String(values?.email ?? "");

    const nameNorm = nameRaw.trim();
    const phoneNorm = normalizeBDPhone(phoneRaw);
    const emailNorm = emailRaw.trim().toLowerCase();

    const rest = values && typeof values === "object" ? { ...values } : {};
    delete rest._key;
    delete rest._ord;
    delete rest.address1;
    delete rest.line1;
    delete rest.line2;

    const billingDraft = {
      ...rest,

      // raw
      name: nameRaw,
      phone: phoneRaw,
      email: emailRaw,

      // normalized
      nameNormalized: nameNorm,
      phoneNormalized: phoneNorm,
      emailNormalized: emailNorm,

      countryIso2: String(rest.countryIso2 || "BD").toUpperCase(),
      makeDefault: false,
    };

    setGuestDraft((prev) => {
      const next = {
        ...prev,
        profile: {
          name: nameRaw,
          phone: phoneRaw,
          email: emailRaw,
          nameNormalized: nameNorm,
          phoneNormalized: phoneNorm,
          emailNormalized: emailNorm,
        },
        billing: billingDraft,
      };

      const sig = JSON.stringify({
        profile: next.profile,
        billing: next.billing,
        billingDifferent: !!next.billingDifferent,
      });
      if (sig === lastGuestBillSigRef.current) return prev;
      lastGuestBillSigRef.current = sig;

      writeGuestDraft(next);
      return next;
    });
  }

  function validateGuestReady() {
    const p = guestDraft.profile || {};
    const ship = guestDraft.shipping || {};
    const bill = guestDraft.billing || {};

    const name =
      String(p.nameNormalized || ship?.nameNormalized || p.name || ship?.name || "").trim();

    const phoneRaw = String(p.phone || ship?.phone || "").trim();
    const phone = String(p.phoneNormalized || ship?.phoneNormalized || normalizeBDPhone(phoneRaw) || "").trim();

    if (!name) {
      setGuestShipValidateSignal((v) => v + 1);
      return "Please enter your full name.";
    }

    if (!phone || !isValidBDMobile(phone)) {
      setGuestShipValidateSignal((v) => v + 1);
      return "Please enter a valid Bangladeshi mobile number (e.g., 017XXXXXXXX, 88017XXXXXXXX, +88017XXXXXXXX, or 088017XXXXXXXX).";
    }

    // If billing is different in guest mode, ensure billing is complete too
    if (guestDraft.billingDifferent) {
      if (!bill || !isAddressComplete(bill)) {
        setGuestBillValidateSignal((v) => v + 1);
        return "Please complete your billing address (Street Address, Upazila / City, District).";
      }
    }

    // Shipping completeness is validated earlier during Place Order, but keep as a final guard
    if (!ship || !isAddressComplete(ship)) {
      setGuestShipValidateSignal((v) => v + 1);
      return "Please complete your shipping address (Street Address, Upazila / City, District).";
    }

    return "";
  }

  function handleDisabledPlaceOrderClick() {
    // If a saved method exists but state isn't hydrated yet, sync it instead of warning the user.
    if (!methodCanon && savedMethodForUi) {
      setMethodSelected(savedMethodForUi);
      writeCheckoutMethod(isGuest, savedMethodForUi || "");
      setShowGatewayWarning(false);
      setPlaceOrderCtaWarning("");
      return;
    }

    // Mode not chosen (should be rare because modal blocks) — still guard.
    if (!checkoutMode) {
      openModeDialog("Please choose Guest / Login / Create Account to continue.");
      setPlaceOrderCtaWarning("Please choose a checkout mode to continue.");
      return;
    }

    // Guest + online payment is not allowed
    if (guestOnlineNotAllowed) {
      const msg =
        "Online payment requires an account. Please log in or create an account to use online payment methods.";
      setToast(msg);
      setPlaceOrderCtaWarning(msg);
      return;
    }

    const needsPayment = !methodCanon;
    const needsShip = shipIncomplete;
    const needsCodMatch = codNeedsMatch;

    // Compose a clear inline message near the CTA
    if (needsPayment && needsShip) {
      setPlaceOrderCtaWarning("Please select a payment method and complete your shipping address.");
    } else if (needsPayment) {
      setPlaceOrderCtaWarning("Please select a payment method to place your order.");
    } else if (needsShip) {
      setPlaceOrderCtaWarning("Please complete your shipping address to place your order.");
    } else if (needsCodMatch) {
      setPlaceOrderCtaWarning("For Cash on Delivery, shipping and billing addresses must be the same.");
    } else {
      setPlaceOrderCtaWarning("Please complete the required steps above to place your order.");
    }

    // Drive the user to the missing section(s)
    if (needsPayment) {
      setShowGatewayWarning(true);
      const paymentCard = document.getElementById("payment-card");
      paymentCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });

      const tiles = document.getElementById("payment-tiles");
      if (tiles) {
        tiles.classList.add("pulse-once");
        setTimeout(() => tiles.classList.remove("pulse-once"), 900);
      }
    }

    if (needsShip) {
      if (isGuest) setGuestShipValidateSignal((v) => v + 1);

      const addressCard = document.getElementById(isGuest ? "guest-address-card" : "account-address-card");
      addressCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }

  /* ---------------- ORDER PLACEMENT ---------------- */
  async function placeOrder(payload) {
    setToast("");

    if (!checkoutMode) {
      openModeDialog("Please choose Guest / Login / Create Account to continue.");
      return;
    }

    const payloadMethod = normalizeMethod(payload?.methodSelected);

    // IMPORTANT: DO NOT silently default a method. User must select.
    const savedMethod = normalizeMethod(readCheckoutMethod(isGuest));
    const method = payloadMethod || methodCanon || savedMethod;

    if (!method) {
      setShowGatewayWarning(true);
      setToast("Please select a payment method.");
      const tiles = document.getElementById("payment-tiles");
      if (tiles) {
        tiles.scrollIntoView({ behavior: "smooth", block: "center" });
        tiles.classList.add("pulse-once");
        setTimeout(() => tiles.classList.remove("pulse-once"), 900);
        const focusable = tiles.querySelector("input,button,[role='button']");
        focusable?.focus({ preventScroll: true });
      }
      return;
    }

    const ship = effectiveShipping;
    const bill = effectiveBilling;

    if (!ship || !isAddressComplete(ship)) {
      const n = normalizeAddress(ship || {}, 0) || ship || {};
      const missing = [];
      const line1 = String(n.streetAddress || n.address1 || n.line1 || "").trim();
      const city = String(n.upazila || n.city || "").trim();
      const dist = String(n.district || n.state || "").trim();

      if (!line1) missing.push("Street Address");
      if (!city) missing.push("Upazila / City");
      if (!dist) missing.push("District");

      setToast(
        missing.length
          ? `Please complete your shipping address: missing ${missing.join(", ")}.`
          : "Please complete your shipping address."
      );

      if (isGuest) setGuestShipValidateSignal((v) => v + 1);

      const addressCard = document.getElementById("guest-address-card");
      addressCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return;
    }

    // Guest online payment requires account
    if (isGuest && method !== "COD") {
      setToast(
        "Online payment requires an account. Please log in or create an account to use online payment methods."
      );
      return;
    }

    // COD requires shipping=billing
    if (method === "COD") {
      if (!addressesEqual(ship, bill || ship)) {
        setToast("For Cash on Delivery, shipping and billing addresses must be the same.");
        return;
      }
    }

    if (isGuest) {
      const err = validateGuestReady();
      if (err) {
        setToast(err);
        return;
      }
    }

    setPlacing(true);
    try {
      purgeLegacyCartKeysIfCanonicalExists();
      let pre =
        (payload?.cartSnapshot &&
        Array.isArray(payload.cartSnapshot.items) &&
        payload.cartSnapshot.items.length
          ? payload.cartSnapshot
          : null) ||
        snapshotFromLocalStorage() ||
        snapshotFromWindow();

      if (pre?.items?.length) {
        preOtpSnapshotRef.current = pre;
        try {
          sessionStorage.setItem("checkout_ctx", JSON.stringify({ method, snapshot: pre }));
        } catch {}
      }

      let snapshot =
        (payload?.cartSnapshot &&
        Array.isArray(payload.cartSnapshot.items) &&
        payload.cartSnapshot.items.length
          ? payload.cartSnapshot
          : null) ||
        preOtpSnapshotRef.current ||
        snapshotFromLocalStorage() ||
        snapshotFromWindow();

      if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) {
        snapshot = await buildFreshCartSnapshot();
      }

      if (
        (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) &&
        typeof window !== "undefined"
      ) {
        try {
          const ctx = JSON.parse(sessionStorage.getItem("checkout_ctx") || "{}");
          if (Array.isArray(ctx?.snapshot?.items) && ctx.snapshot.items.length > 0) {
            snapshot = ctx.snapshot;
          }
        } catch {}
      }

      if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) {
        setToast("Your cart appears empty. Please refresh and try again.");
        return;
      }

      setCartSnapshot(snapshot);
      persistSnapshot(snapshot);

      // COD CONFIRMATION => OTP for both account & guest
      if (method === "COD") {
        const phoneForOtp = (() => {
          if (!isGuest) return (userInfo.phone || ship.phone || defaultAddr?.phone || "").trim();
          return (
            guestDraft.profile?.phoneNormalized ||
            ship.phoneNormalized ||
            normalizeBDPhone(guestDraft.profile?.phone || ship.phone || "")
          ).trim();
        })();

        if (!phoneForOtp) {
          setToast("A mobile number is required for COD.");
          return;
        }

        const otpRes = await openOtpModalFor(phoneForOtp, "sms", COD_OTP_PURPOSE);
        if (!otpRes?.ok) return;

        const shipPayload = toServerPayload(ship);
        const billPayload = toServerPayload(bill || ship);

        if (!isGuest) {
          const orderPayload = {
            method: "COD",
            shippingAddressId: ship.id || null,
            billingAddressId: (bill || ship).id || null,
            shippingAddress: ship.id ? undefined : shipPayload,
            billingAddress: (bill || ship)?.id ? undefined : billPayload,
            shipping: shipPayload,
            billing: billPayload,
            otp: {
              identifier: otpRes.identifier,
              code: otpRes.code,
              purpose: COD_OTP_PURPOSE,
            },
            cartId: cartId || undefined,
            cartSnapshot: snapshot,
            items: snapshot.items,
            lines: snapshot.items,
            cartItems: snapshot.items,
            cart: { items: snapshot.items },
          };

          const r = await tryJson("/api/orders/place", "POST", orderPayload);

          if (!r.ok) {
            if (r.j?.error === "OTP_INVALID") {
              setToast("OTP invalid. Please recheck and try again.");
              return;
            }
            if (r.j?.error === "EMPTY_CART" || r.j?.error === "CART_EMPTY") {
              setToast("Your cart appears empty. Please refresh and try again.");
              return;
            }
            setToast(r.j?.error || "Could not confirm COD order.");
            return;
          }

          await clearServerCartIfAny();
          clearClientCartEverywhere();
          clearAccountProfileOverride();

          const orderId = r.j?.orderId || r.j?.order?.id || r.j?.id;
          const receiptUrl =
            r.j?.receiptUrl ||
            r.j?.redirectUrl ||
            (orderId ? `/orders/${orderId}/receipt` : "/orders");
          window.location.href = receiptUrl;
          return;
        }

        // Guest COD with OTP
        const guestProfile = {
          name: String(
            guestDraft.profile?.nameNormalized || guestDraft.profile?.name || ship?.name || ""
          ).trim(),
          phone: String(
            guestDraft.profile?.phoneNormalized ||
              ship?.phoneNormalized ||
              normalizeBDPhone(guestDraft.profile?.phone || ship?.phone || "")
          ).trim(),
          email: String(
            guestDraft.profile?.emailNormalized || guestDraft.profile?.email || ship?.email || ""
          )
            .trim()
            .toLowerCase(),
        };

        // Ensure payload uses normalized guest identity fields (server-facing) without forcing the form to rewrite inputs.
        const shipForPayload = { ...ship, ...guestProfile };
        const billForPayload = { ...(bill || ship), ...guestProfile };

        const shipPayloadGuest = toServerPayload(shipForPayload);
        const billPayloadGuest = toServerPayload(billForPayload);

        const orderPayload = {
          method: "COD",
          guest: guestProfile,
          guestCheckout: true,
          shippingAddressId: null,
          billingAddressId: null,
          shippingAddress: shipPayloadGuest,
          billingAddress: billPayloadGuest,
          shipping: shipPayloadGuest,
          billing: billPayloadGuest,
          otp: {
            identifier: otpRes.identifier,
            code: otpRes.code,
            purpose: COD_OTP_PURPOSE,
          },
          cartId: cartId || undefined,
          cartSnapshot: snapshot,
          items: snapshot.items,
          lines: snapshot.items,
          cartItems: snapshot.items,
          cart: { items: snapshot.items },
        };

        const r = await tryJson("/api/orders/place", "POST", orderPayload);

        if (!r.ok && (r.status === 401 || r.j?.error === "AUTH_REQUIRED")) {
          setToast(
            "To place this order, please log in or create an account. Guest checkout is not enabled on the server yet."
          );
          setCheckoutMode(null);
          writeCheckoutModePref(null);
          setModeDialogOpen(true);
          return;
        }

        if (!r.ok) {
          setToast(r.j?.error || "Could not place guest COD order.");
          return;
        }

        await clearServerCartIfAny();
        clearClientCartEverywhere();
        clearGuestDraft();
        writeCheckoutMethod(true, "");

        const orderId = r.j?.orderId || r.j?.order?.id || r.j?.id;
        const receiptUrl =
          r.j?.receiptUrl ||
          r.j?.redirectUrl ||
          (orderId ? `/orders/${orderId}/receipt` : "/orders");
        window.location.href = receiptUrl;
        return;
      }

      // Online payment (account only)
      const r = await tryJson("/api/payments/checkout", "POST", {
        provider: method,
        shippingAddressId: ship.id || null,
        billingAddressId: (bill || ship).id || null,
        returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
      });

      if (!r.ok || !r.j?.redirectUrl) {
        setToast(r.j?.error || "Payment gateway not available. Please use Cash on Delivery.");
        setMethodSelected(null);
        writeCheckoutMethod(false, "");
        setShowGatewayWarning(false);
        return;
      }

      writeCheckoutMethod(false, method);
      window.location.href = r.j.redirectUrl;
    } finally {
      setPlacing(false);
    }
  }

  function renderFullAddressLines(a) {
    if (!a) return <span>—</span>;
    const line1 = [a.houseName, a.houseNo, a.apartmentNo, a.floorNo, a.line1 || a.address1]
      .filter(Boolean)
      .join(", ");
    const line2 = [a.village, a.postOffice, a.union, a.policeStation].filter(Boolean).join(", ");
    const line3Parts = [a.upazila || a.city, a.district || a.state];
    if (a.postalCode) line3Parts.push(a.postalCode);
    if (a.countryIso2) line3Parts.push(String(a.countryIso2).toUpperCase());
    const line3 = line3Parts.filter(Boolean).join(", ");

    return (
      <>
        <div style={{ fontWeight: 800 }}>{line1 || "—"}</div>
        {line2 ? <div style={{ fontWeight: 800 }}>{line2}</div> : null}
        <div style={{ fontWeight: 800 }}>{line3 || "—"}</div>
      </>
    );
  }

  return (
    <>
      <Navbar />

      <div className="checkout bg-white min-h-[100dvh]">
        <style jsx global>{`
          .addr-card {
            width: 100%;
            border: 1px solid ${BORDER};
            border-radius: 18px;
            padding: 20px;
            background: linear-gradient(180deg, #fff 0%, #fafbff 100%);
            box-shadow: 0 8px 24px rgba(15, 33, 71, 0.06);
          }
          .pill-default {
            background: #eef2ff;
            color: #3730a3;
            border: 1px solid #e0e7ff;
            font-weight: 800;
            font-size: 11px;
            padding: 3px 10px;
            border-radius: 999px;
          }

          :root {
            --navbar-h: var(--nav-h, 88px);
            --tdls-safe-top: calc(0.5in + 10px + env(safe-area-inset-top) + max(var(--navbar-h, 88px), 72px));
            --tdls-safe-bottom: calc(
              0.5in + 14px + env(safe-area-inset-bottom) +
                max(var(--bottom-floating-h, 0px), var(--bfbar-h, 0px), var(--bottom-safe-pad, 120px))
            );
          }

          .co-modal {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.25);
            display: flex;
            align-items: flex-start;
            justify-content: center;
            z-index: 2147483647;

            /* HARD GUARANTEE: sheet never sits under navbar/bfbar */
            padding-left: 12px;
            padding-right: 12px;
            padding-top: var(--tdls-safe-top);
            padding-bottom: var(--tdls-safe-bottom);

            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
          }

          .co-sheet {
            width: min(760px, calc(100vw - 24px));
            max-height: calc(100dvh - var(--tdls-safe-top) - var(--tdls-safe-bottom));
            overflow: auto;
            background: #fff;
            border-radius: 16px;
            padding: 16px;
            box-shadow: 0 12px 36px rgba(15, 33, 71, 0.25);
            border: 1px solid ${BORDER};
          }

          .co-sheet-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
          }
          .co-ttl {
            font-weight: 900;
            font-size: 18px;
            color: ${NAVY};
          }

          .chk {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 10px;
          }
          .chk input[type="checkbox"] {
            width: 22px;
            height: 22px;
            accent-color: ${NAVY};
          }
          .chk span {
            font-weight: 800;
            color: ${NAVY};
            line-height: 1.35;
          }

          .container {
            padding-top: var(--nav-h, 88px);
          }
          .checkout {
            padding-bottom: max(140px, env(safe-area-inset-bottom));
          }
          .card {
            border: 1px solid ${BORDER};
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 8px 24px rgba(15, 33, 71, 0.06);
          }
          .card-head {
            padding: 16px 18px;
            border-bottom: 1px solid ${BORDER};
            font-weight: 900;
            color: ${NAVY};
          }
          .card-body {
            padding: 16px;
          }

          .toast {
            background: #fee2e2;
            border: 1px solid #fecaca;
            color: #991b1b;
            border-radius: 12px;
            padding: 10px 12px;
            font-weight: 800;
          }
          .warn {
            background: #fff7ed;
            border: 1px solid ${BORDER};
            color: #9a3412;
            border-radius: 12px;
            padding: 10px 12px;
            font-weight: 800;
          }

          .btn-pill {
            height: 40px;
            padding: 0 18px;
            border-radius: 9999px;
            font-weight: 900;
            color: #fff;
            background: linear-gradient(135deg, #1e3a8a, #0ea5e9);
            border: 0;
            box-shadow: 0 8px 18px rgba(14, 165, 233, 0.25),
              inset 0 1px 0 rgba(255, 255, 255, 0.25);
          }
          .btn-pill:active {
            transform: translateY(0.5px);
          }

          .sticky-col {
            position: sticky;
            top: calc(var(--nav-h, 88px) + 16px);
            align-self: flex-start;
          }

          .po-guard-overlay {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            height: 220px; /* covers the disabled Place Order CTA area */
            background: transparent;
            border: 0;
            padding: 0;
            margin: 0;
            cursor: not-allowed;
            z-index: 80;
          }

          .po-guard-msg-inline {
            position: absolute;
            left: 12px;
            right: 12px;
            bottom: 196px; /* sits just above the CTA area */
            padding: 10px 12px;
            color: #dc2626;
            font-size: 13px;
            font-weight: 800;
            line-height: 1.35;
            background: rgba(254, 242, 242, 0.92);
            border: 1px solid rgba(254, 205, 211, 0.95);
            border-radius: 12px;
            z-index: 90;
            pointer-events: none;
          }

          .pulse-once {
            animation: tdlcPulseOnce 0.9s ease-in-out 1;
          }

          @keyframes tdlcPulseOnce {
            0% {
              transform: scale(1);
              box-shadow: 0 0 0 rgba(37, 99, 235, 0);
            }
            50% {
              transform: scale(1.01);
              box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.18);
            }
            100% {
              transform: scale(1);
              box-shadow: 0 0 0 rgba(37, 99, 235, 0);
            }
          }
        `}</style>

        <header className="container pt-8 pb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <GoBackButton />
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: NAVY }}>
              Checkout
            </h1>
          </div>
          <nav className="hidden md:flex items-center gap-3 text-sm" style={{ color: MUTED }}>
            <span className="font-extrabold" style={{ color: NAVY }}>
              1. Address
            </span>
            <span>•</span>
            <span>2. Payment</span>
          </nav>
        </header>

        <main className="container pb-28 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">
          <div className="space-y-10">
            {toast ? <div className="toast">{toast}</div> : null}

            {/* MODE BANNER */}
            {sessionChecked && (
              <section className="card">
                <div className="card-head">Checkout Mode</div>
                <div className="card-body">
                  <div className="addr-card">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold" style={{ color: NAVY }}>
                          {checkoutMode === "guest"
                            ? "Guest Checkout"
                            : checkoutMode === "account"
                            ? "Account Checkout"
                            : "Choose a mode"}
                        </span>
                        {checkoutMode === "guest" ? (
                          <span className="pill-default">OTP at COD • Session-only</span>
                        ) : checkoutMode === "account" ? (
                          <span className="pill-default">Saved addresses • Account tools</span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        {checkoutMode !== "account" ? (
                          <button
                            className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                            onClick={() => openModeDialog()}
                          >
                            Change
                          </button>
                        ) : null}

                        {checkoutMode === "guest" ? (
                          <>
                            {/* REMOVED: Login button CTA in guest mode (to avoid confusion) */}
                            <button
                              className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                              onClick={gotoSignup}
                            >
                              Create Account
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {checkoutMode === "guest" ? (
                      <div className="mt-2 text-[13px]" style={{ color: MUTED, fontWeight: 700 }}>
                        Guest checkout is session-only: details are not saved. OTP will be requested only when placing a
                        COD order.
                      </div>
                    ) : checkoutMode === "account" ? (
                      <div className="mt-2 text-[13px]" style={{ color: MUTED, fontWeight: 700 }}>
                        Your saved profile + address book are available for quick checkout.
                      </div>
                    ) : (
                      <div className="mt-2 text-[13px]" style={{ color: MUTED, fontWeight: 700 }}>
                        Please choose Guest Mode or Login to proceed.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* GUEST CHECKOUT FORM */}
            {checkoutMode === "guest" ? (
              <section id="guest-address-card" className="card">
                <div className="card-head">Guest Details & Shipping Address</div>
                <div className="card-body">
                  <div className="text-sm mb-3" style={{ color: MUTED, fontWeight: 700 }}>
                    Enter your details. This is not saved. OTP will be requested when you place a COD order.
                  </div>

                  <CheckoutAddressForm
                    validateSignal={guestShipValidateSignal}
                    prefill={{
                      ...(guestDraft.shipping || {}),
                      name: guestDraft.profile?.name || guestDraft.shipping?.name || "",
                      email: guestDraft.profile?.email || guestDraft.shipping?.email || "",
                      phone: guestDraft.profile?.phone || guestDraft.shipping?.phone || "",
                      countryIso2: guestDraft.shipping?.countryIso2 || "BD",
                      streetAddress:
                        guestDraft.shipping?.streetAddress ||
                        guestDraft.shipping?.address1 ||
                        guestDraft.shipping?.line1 ||
                        "",
                      address2:
                        guestDraft.shipping?.address2 ||
                        guestDraft.shipping?.line2 ||
                        "",
                    }}
                    includeUserFields
                    requirePhone
                    showMakeDefault={false}
                    forceDefault={false}
                    submitLabel="Continue"
                    onDraftChange={(vals) => {
                      applyGuestShippingDraft(vals);
                    }}
                    onCancel={() => setToast("")}
                    onSubmit={() => {
                      const err = validateGuestReady();
                      if (err) {
                        setToast(err);
                        return false;
                      }
                      setToast("");
                      const paymentCard = document.getElementById("payment-card");
                      paymentCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                      return true;
                    }}
                  />

                  <div className="mt-4">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={!!guestDraft.billingDifferent}
                        onChange={(e) => {
                          const next = { ...guestDraft, billingDifferent: e.target.checked };
                          setGuestDraft(next);
                          writeGuestDraft(next);
                        }}
                      />
                      <span>Use a different billing address (optional)</span>
                    </label>
                  </div>

                  {guestDraft.billingDifferent ? (
                    <div className="mt-4">
                      <div className="font-extrabold mb-2" style={{ color: NAVY }}>
                        Billing Address
                      </div>
                      <CheckoutAddressForm
                        validateSignal={guestBillValidateSignal}
                        prefill={{
                          ...(guestDraft.billing || {}),
                          name:
                            guestDraft.profile?.name ||
                            guestDraft.billing?.name ||
                            guestDraft.shipping?.name ||
                            "",
                          email:
                            guestDraft.profile?.email ||
                            guestDraft.billing?.email ||
                            guestDraft.shipping?.email ||
                            "",
                          phone:
                            guestDraft.profile?.phone ||
                            guestDraft.billing?.phone ||
                            guestDraft.shipping?.phone ||
                            "",
                          countryIso2: guestDraft.billing?.countryIso2 || "BD",
                          streetAddress:
                            guestDraft.billing?.streetAddress ||
                            guestDraft.billing?.address1 ||
                            guestDraft.billing?.line1 ||
                            "",
                          address2:
                            guestDraft.billing?.address2 ||
                            guestDraft.billing?.line2 ||
                            "",
                        }}
                        includeUserFields
                        requirePhone
                        showMakeDefault={false}
                        forceDefault={false}
                        submitLabel="Continue"
                        onDraftChange={(vals) => {
                          applyGuestBillingDraft(vals);
                        }}
                        onCancel={() => setToast("")}
                        onSubmit={() => {
                          const err = validateGuestReady();
                          if (err) {
                            setToast(err);
                            return false;
                          }
                          setToast("");
                          const paymentCard = document.getElementById("payment-card");
                          paymentCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                          return true;
                        }}
                      />
                    </div>
                  ) : null}

                  <div className="mt-3 text-[13px]" style={{ color: MUTED, fontWeight: 700 }}>
                    Note: Guest checkout supports COD only. Online payment requires an account.
                  </div>
                </div>
              </section>
            ) : null}

            {/* ACCOUNT MODE SECTIONS */}
            {checkoutMode === "account" ? (
              <>
                <section className="card default-tile">
                  <div className="card-head">Default Profile & Address</div>
                  <div className="card-body">
                    <div className="addr-card">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold">Default</span>
                          <span className="pill-default">Linked to your account</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                            onClick={() => setDefaultEditing(true)}
                          >
                            Edit
                          </button>
                        </div>
                      </div>

                      <div className="mt-2" style={{ color: NAVY, fontWeight: 800 }}>
                        <span>
                          {titleCase(userInfo.name || addresses.find((a) => a.isDefault)?.name || "—")}
                        </span>
                        <span> • </span>
                        <span>{userInfo.phone || addresses.find((a) => a.isDefault)?.phone || "—"}</span>
                        {userInfo.email || addresses.find((a) => a.isDefault)?.email ? (
                          <>
                            <span> • </span>
                            <span>
                              {String(userInfo.email || addresses.find((a) => a.isDefault)?.email).toLowerCase()}
                            </span>
                          </>
                        ) : null}
                      </div>

                      <div className="mt-2 text-[13px]" style={{ color: NAVY }}>
                        {renderFullAddressLines(addresses.find((a) => a.isDefault) || null)}
                      </div>

                      {gateOpen && gateMessage ? (
                        <div className="mt-3 text-[13px]" style={{ color: "#b91c1c", fontWeight: 800 }}>
                          {gateMessage}
                        </div>
                      ) : null}
                    </div>

                    {defaultEditing && (
                      <div className="co-modal" role="dialog" aria-modal="true">
                        <div className="co-sheet">
                          <div className="co-sheet-head">
                            <div className="co-ttl">Edit default profile & address</div>
                          </div>

                          <CheckoutAddressForm
                            prefill={{
                              ...(addresses.find((a) => a.isDefault) || {}),
                              name: userInfo.name || addresses.find((a) => a.isDefault)?.name || "",
                              email: userInfo.email || addresses.find((a) => a.isDefault)?.email || "",
                              phone: userInfo.phone || addresses.find((a) => a.isDefault)?.phone || "",
                              id: addresses.find((a) => a.isDefault)?.id,
                              streetAddress:
                                (addresses.find((a) => a.isDefault)?.streetAddress ||
                                  addresses.find((a) => a.isDefault)?.address1 ||
                                  addresses.find((a) => a.isDefault)?.line1 ||
                                  "") ?? "",
                              address2:
                                (addresses.find((a) => a.isDefault)?.address2 ||
                                  addresses.find((a) => a.isDefault)?.line2 ||
                                  "") ?? "",
                            }}
                            includeUserFields
                            requirePhone
                            showMakeDefault={true}
                            forceDefault={true}
                            submitLabel="Save & link to my profile"
                            onCancel={() => {
                              setDefaultEditing(false);
                              runCompletenessGate({
                                unique: addresses,
                                defRaw: null,
                                userSnapshot: userInfo,
                              });
                            }}
                            onSubmit={saveDefaultProfileAndAddress}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section id="account-address-card" className="card">
                  <div className="card-head">Saved Addresses</div>
                  <div className="card-body">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                      {addresses.map((a) => (
                        <AddressBlock
                          key={a._key}
                          addr={a}
                          selected={a._key === selectedKey}
                          onSelect={() => select(a)}
                          onEdit={() => handleGridEdit(a)}
                          onDelete={a.isDefault ? null : () => handleGridDelete(a)}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                <section className="card">
                  <div className="card-head">Shipping Address</div>
                  <div className="card-body space-y-4">
                    <p className="text-sm text-gray-600">
                      We’ll use your <b>default address</b> unless you add a different one.
                    </p>
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={shippingDifferent}
                        onChange={(e) => setShippingDifferent(e.target.checked)}
                      />
                      <span>Use a different shipping address</span>
                    </label>

                    {shippingEditorOpen && (
                      <div className="co-modal" role="dialog" aria-modal="true">
                        <div className="co-sheet">
                          <div className="co-sheet-head">
                            <div className="co-ttl">
                              {editingShipping ? "Edit shipping address" : "Add shipping address"}
                            </div>
                          </div>

                          <CheckoutAddressForm
                            prefill={
                              editingShipping || {
                                name: "",
                                email: "",
                                phone: userInfo.phone || "",
                                countryIso2: "BD",
                                streetAddress: "",
                                address2: "",
                                village: "",
                                postOffice: "",
                                postalCode: "",
                                union: "",
                                policeStation: "",
                                upazila: "",
                                district: "",
                                division: "",
                                houseNo: "",
                                houseName: "",
                                apartmentNo: "",
                                floorNo: "",
                              }
                            }
                            includeUserFields
                            requirePhone
                            showMakeDefault
                            submitLabel="Save shipping address"
                            onCancel={() => {
                              setShippingEditorOpen(false);
                              setShippingDifferent(false);
                              setEditingShipping(null);
                            }}
                            onSubmit={submitShipping}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="card">
                  <div className="card-head">Billing (optional)</div>
                  <div className="card-body space-y-4">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={billingDifferent}
                        onChange={(e) => setBillingDifferent(e.target.checked)}
                      />
                      <span>Use a different billing address</span>
                    </label>

                    {billingEditorOpen && (
                      <div className="co-modal" role="dialog" aria-modal="true">
                        <div className="co-sheet">
                          <div className="co-sheet-head">
                            <div className="co-ttl">
                              {editingBilling ? "Edit billing address" : "Add billing address"}
                            </div>
                          </div>

                          <CheckoutAddressForm
                            prefill={
                              editingBilling || {
                                name: "",
                                email: "",
                                phone: userInfo.phone || "",
                                countryIso2: "BD",
                                streetAddress: "",
                                address2: "",
                                village: "",
                                postOffice: "",
                                postalCode: "",
                                union: "",
                                policeStation: "",
                                upazila: "",
                                district: "",
                                division: "",
                                houseNo: "",
                                houseName: "",
                                apartmentNo: "",
                                floorNo: "",
                              }
                            }
                            includeUserFields
                            requirePhone
                            showMakeDefault={false}
                            submitLabel="Save billing address"
                            onCancel={() => {
                              setBillingEditorOpen(false);
                              setBillingDifferent(false);
                              setEditingBilling(null);
                            }}
                            onSubmit={submitBilling}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </>
            ) : null}

            {/* PAYMENT */}
            <section id="payment-card" className="card">
              <div className="card-head">Payment Method</div>
              <div className="card-body">
                <p className="mb-3 text-[18px] md:text-[20px] font-extrabold text-blue-700 leading-snug">
                  Pick a method below. For COD, we’ll confirm your order with an OTP.
                </p>

                {methodCanon === "COD" && codNeedsMatch ? (
                  <div className="warn mb-3" role="alert">
                    For Cash on Delivery, shipping and billing addresses must be the same.
                  </div>
                ) : null}

                {showGatewayWarning && !methodCanon ? (
                  <div className="warn mb-3" role="alert">
                    Please select a payment method to continue.
                  </div>
                ) : null}

                <PaymentMethods
                  onChangeMethod={(m) => {
                    const canon = normalizeMethod(m);
                    setMethodSelected(canon);
                    setShowGatewayWarning(false);
                    setPlaceOrderCtaWarning("");
                    writeCheckoutMethod(isGuest, canon || "");
                  }}
                  showGatewayWarning={showGatewayWarning}
                />
              </div>
            </section>
          </div>

          <aside className="sticky-col">
            <div className="summary-wrap" style={{ position: "relative" }}>
              <Summary
                shipping={summaryShipping}
                billing={summaryBilling}
                methodSelected={methodCanon}
                placing={placing}
                onPlaceOrder={(payload) => placeOrder(payload)}
              />

              {placeOrderCtaWarning ? (
                <div className="po-guard-msg-inline" role="alert">
                  {placeOrderCtaWarning}
                </div>
              ) : null}

              {placeOrderUiDisabled ? (
                <button
                  type="button"
                  className="po-guard-overlay"
                  aria-label="Place order is currently disabled"
                  onClick={handleDisabledPlaceOrderClick}
                />
              ) : null}
            </div>
          </aside>
        </main>
      </div>

      {/* MODE CHOICE MODAL */}
      <CheckoutModeDialog
        open={modeDialogOpen && checkoutMode !== "account"}
        subtitle="Choose Guest Mode, or log in / create an account."
        onClose={() => setModeDialogOpen(false)}
        onGuest={() => {
          setCheckoutMode("guest");
          writeCheckoutModePref("guest");
          setModeDialogOpen(false);

          // Reset OTP state
          setOtpOpen(false);
          lastOtpRef.current = null;
          otpResolverRef.current = null;

          // Payment method must be selected explicitly (no default)
          setMethodSelected(null);
          writeCheckoutMethod(true, "");

          const draft = readGuestDraft();
          if (draft) setGuestDraft((p) => ({ ...p, ...draft }));
          setToast("");
        }}
        onLogin={() => gotoLogin()}
        onCreate={() => gotoSignup()}
      />

      {/* OTP modal (COD confirmation only) */}
      {checkoutMode === "account" || checkoutMode === "guest" ? (
        <OtpDialog
          open={otpOpen}
          identifier={otpIdentifier}
          purpose={lastOtpRef.current?.purpose || COD_OTP_PURPOSE}
          ttlSeconds={otpTtl}
          onSubmit={async (code) => {
            const purpose = lastOtpRef.current?.purpose || COD_OTP_PURPOSE;
            const rawIdentifier = lastOtpRef.current?.identifier || otpIdentifier;

            const ok = await verifyOtpPair(rawIdentifier, code, purpose);
            if (ok) {
              lastOtpRef.current = {
                ...(lastOtpRef.current || {}),
                identifier: rawIdentifier,
                code,
                purpose,
              };
            }
            otpResolverRef.current?.({ ok, identifier: rawIdentifier, code });
          }}
          onClose={() => otpResolverRef.current?.({ ok: false })}
          onResend={async () => {
            const purpose = lastOtpRef.current?.purpose || COD_OTP_PURPOSE;
            const rawIdentifier = lastOtpRef.current?.identifier || otpIdentifier;

            const req = await requestOtp(
              rawIdentifier,
              /\S+@\S+/.test(rawIdentifier) ? "email" : "sms",
              purpose,
              { allowGuest: checkoutMode === "guest" }
            );
            if (req.ok) {
              const next = req.j?.ttlSeconds || 90;
              setOtpTtl(next);
              return { ok: true, ttlSeconds: next };
            }
            setToast(req.j?.error || "Could not resend code. Try again.");
            return { ok: false };
          }}
        />
      ) : null}

      <BottomFloatingBar />
    </>
  );
}
