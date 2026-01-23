// FILE: src/components/checkout/checkout.addressbook.js
"use client";

/**
 * TDLS Checkout Address Book (Single Source of Truth)
 * --------------------------------------------------
 * - Canonical UI address shape (identity + streetAddress/address2 + geo + house bits)
 * - Canonical server payload shape (/api/customers/address-book)
 * - Robust list/default fetching + dedupe + stable keys
 * - Preload support so address data is ready at checkout mount
 * - Safe create/update/delete/default operations with compatibility fallbacks
 *
 * IMPORTANT:
 * - This module is UI-agnostic. It should be imported by checkout-page.js and address-form.jsx consumers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------ UI tokens (keep aligned with checkout page) ------------------ */
export const NAVY = "#0F2147";
export const MUTED = "#6B7280";
export const BORDER = "#DFE3EC";

/* ------------------ API base (locked convention) ------------------ */
const ADDRESS_BOOK_BASE = "/api/customers/address-book";

/* ------------------ Storage keys (aligned with checkout-page.js) ------------------ */
export const LS_CHECKOUT_SELECTED_ADDRESS_KEY = "checkout_address";

// Primary (current checkout-page.js usage)
export const LS_CHECKOUT_SHIPPING_ADDRESS_KEY = "checkout_address_shipping";
export const LS_CHECKOUT_BILLING_ADDRESS_KEY = "checkout_address_billing";

// Legacy aliases (present in some older checkout components)
const LS_CHECKOUT_SHIPPING_ADDRESS_KEY_LEGACY = "checkout_shipping_address";
const LS_CHECKOUT_BILLING_ADDRESS_KEY_LEGACY = "checkout_billing_address";

/* ------------------ Tiny helpers ------------------ */
function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeString(v) {
  return v == null ? "" : String(v);
}

function trimLower(v) {
  return safeString(v).trim().toLowerCase();
}

function trimUpper(v) {
  return safeString(v).trim().toUpperCase();
}

function isObj(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

export function titleCase(s = "") {
  const x = safeString(s).trim();
  if (!x) return "";
  return x
    .split(/\s+/g)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

/* ------------------ Phone helpers (BD) ------------------ */
export function normalizeBDPhone(p = "") {
  // Accept BD mobile formats:
  // +8801XXXXXXXXX, 8801XXXXXXXXX, 01XXXXXXXXX, 08801XXXXXXXXX, 008801XXXXXXXXX
  // Also auto-corrects mistaken "+01..." into "+8801..."
  let s = safeString(p).trim();
  if (!s) return "";

  s = s.replace(/[\s-()]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0880")) s = s.slice(1);

  if (s.startsWith("+01")) return `+88${s.slice(1)}`;

  if (s.startsWith("+8801")) return s;
  if (s.startsWith("8801")) return `+${s}`;
  if (s.startsWith("01")) return `+88${s}`;
  if (s.startsWith("+880")) return s;

  if (/^1\d{9}$/.test(s)) return `+880${s}`;

  return s.startsWith("+") ? s : `+${s}`;
}

export function isValidBDMobile(p = "") {
  const n = normalizeBDPhone(p);
  return /^\+8801\d{9}$/.test(n);
}

/* ------------------ Stable key + signatures ------------------ */
export function buildStableKey(a) {
  if (a?.id != null) return String(a.id);

  const raw = [
    a?.name,
    a?.email,
    a?.phone,
    a?.line1,
    a?.line2,
    a?.city,
    a?.state,
    a?.postalCode,
    a?.countryIso2,
    a?.houseName,
    a?.houseNo,
    a?.apartmentNo,
    a?.floorNo,
    a?.streetAddress,
    a?.upazila,
    a?.district,
    a?.division,
  ]
    .map((v) => (v == null ? "" : String(v)))
    .join("|");

  // FNV-1a-ish
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

export function canonicalAddressSig(a) {
  if (!a) return "";
  const line1 = a.line1 || a.address1 || a.streetAddress || "";
  const line2 = a.line2 || a.address2 || "";
  const city = a.city || a.upazila || "";
  const dist = a.state || a.district || "";
  const country = trimUpper(a.countryIso2 || a.country || "");
  const postal = a.postalCode || a.postcode || "";
  const phone = a.phone || "";
  const email = trimLower(a.email || "");
  const name = trimLower(a.name || "");

  return [name, phone, email, line1, line2, city, dist, postal, country]
    .map((v) => trimLower(v))
    .join("|");
}

export function addressesEqual(a, b) {
  if (!a || !b) return false;
  const aId = a.id != null ? String(a.id) : null;
  const bId = b.id != null ? String(b.id) : null;
  if (aId && bId) return aId === bId;
  const sa = canonicalAddressSig(a);
  const sb = canonicalAddressSig(b);
  return !!sa && !!sb && sa === sb;
}

export function dedupePreserveOrder(list) {
  const seenId = new Set();
  const seenSig = new Set();

  const out = [];
  const indexed = Array.isArray(list) ? list : [];

  for (let i = 0; i < indexed.length; i++) {
    const a = indexed[i];
    if (!a) continue;

    const idStr = a.id != null ? String(a.id) : null;
    const sig = canonicalAddressSig(a);

    if (idStr && seenId.has(idStr)) continue;
    if (sig && seenSig.has(sig)) continue;

    if (idStr) seenId.add(idStr);
    if (sig) seenSig.add(sig);

    out.push({ a, _i: i });
  }

  // Stable ordering:
  // - Prefer _ord if present
  // - Otherwise preserve insertion order
  out.sort((p, q) => {
    const po = Number.isFinite(p.a?._ord) ? p.a._ord : null;
    const qo = Number.isFinite(q.a?._ord) ? q.a._ord : null;

    if (po != null && qo != null && po !== qo) return po - qo;
    if (po != null && qo == null) return -1;
    if (po == null && qo != null) return 1;
    return p._i - q._i;
  });

  return out.map((x) => x.a);
}

/* ------------------ Normalization: server/UI -> canonical UI shape ------------------ */
export function normalizeAddress(input, ord = 0) {
  if (!input) return null;

  // Some responses may nest under `address`
  const x = isObj(input.address) ? input.address : input;

  // Server stores extra fields under `granular`
  const g = isObj(x.granular)
    ? x.granular
    : isObj(input.granular)
    ? input.granular
    : null;

  const pick = (primary, ...fallbacks) => {
    const vals = [primary, ...fallbacks];
    for (const v of vals) {
      const s = safeString(v).trim();
      if (s) return v;
    }
    return "";
  };

  const out = {
    id: x.id ?? input.id ?? x._id ?? input._id ?? undefined,

    // Identity
    name: pick(x.name, input.name, g?.name, g?.fullName),
    email: trimLower(pick(x.email, input.email, g?.email)),
    phone: pick(x.phone, input.phone, g?.phone, g?.mobile, g?.phoneNumber),

    // Canonical mailing fields (DB shape)
    line1: pick(
      x.line1,
      g?.line1,
      x.streetAddress,
      g?.streetAddress,
      x.address1,
      g?.address1
    ),
    line2: pick(x.line2, g?.line2, x.address2, g?.address2),
    city: pick(x.city, g?.city, x.upazila, g?.upazila),
    state: pick(x.state, g?.state, x.district, g?.district, x.division, g?.division),
    postalCode: pick(x.postalCode, g?.postalCode, x.postcode, g?.postcode, x.zip, g?.zip),
    countryIso2: trimUpper(pick(x.countryIso2, g?.countryIso2, x.country, g?.country, "BD")) || "BD",

    // Admin levels (if server exposes them)
    adminLevel1: pick(x.adminLevel1, g?.adminLevel1, x.division, g?.division),
    adminLevel2: pick(x.adminLevel2, g?.adminLevel2, x.district, g?.district),
    adminLevel3: pick(x.adminLevel3, g?.adminLevel3, x.upazila, g?.upazila),

    // UI granular fields
    houseNo: pick(x.houseNo, g?.houseNo),
    houseName: pick(x.houseName, g?.houseName),
    apartmentNo: pick(x.apartmentNo, g?.apartmentNo, x.subpremise, g?.subpremise),
    floorNo: pick(x.floorNo, g?.floorNo),
    streetAddress: pick(x.streetAddress, g?.streetAddress, x.line1, g?.line1),

    village: pick(x.village, g?.village),
    postOffice: pick(x.postOffice, g?.postOffice),
    union: pick(x.union, g?.union),
    policeStation: pick(x.policeStation, g?.policeStation, x.thana, g?.thana),
    thana: pick(x.thana, g?.thana),
    upazila: pick(x.upazila, g?.upazila, x.city, g?.city),
    district: pick(x.district, g?.district, x.state, g?.state),
    division: pick(x.division, g?.division),

    label: pick(x.label, input.label, g?.label),
    notes: pick(x.notes, input.notes, g?.notes),
    archivedAt: x.archivedAt ?? input.archivedAt ?? null,

    // Flags
    isDefault: !!(x.isDefault || input.isDefault || g?.isDefault),
    phoneVerified: !!(
      x.phoneVerified ||
      input.phoneVerified ||
      x.phoneVerifiedAt ||
      g?.phoneVerifiedAt
    ),

    _ord: ord,
  };

  // Normalize phone best-effort
  const pn = safeString(out.phone).trim();
  out.phone = pn ? normalizeBDPhone(pn) : "";

  // Prefer a human-friendly line1: house bits + street
  const baseStreet = safeString(out.streetAddress || out.line1 || "").trim();
  const houseBits = [out.houseName, out.houseNo, out.apartmentNo, out.floorNo]
    .map((v) => safeString(v).trim())
    .filter(Boolean);

  const composedLine1 = (houseBits.length ? [...houseBits, baseStreet] : [baseStreet])
    .filter(Boolean)
    .join(", ")
    .trim();

  if (composedLine1) {
    out.line1 = composedLine1;
    out.streetAddress = composedLine1;
  } else {
    out.line1 = safeString(out.line1 || "").trim();
    out.streetAddress = safeString(out.streetAddress || "").trim();
  }

  out.line2 = safeString(out.line2 || "").trim();

  // Canonical aliases (many UIs read these)
  out.address1 = out.line1;
  out.address2 = out.line2;

  // Backfill DB-required city/state from UI fields if needed
  out.city = safeString(out.city || out.upazila || "").trim();
  out.state = safeString(out.state || out.district || out.division || "").trim();

  out._key = buildStableKey(out);

  return out;
}

export function isAddressComplete(a) {
  if (!a) return false;
  const line1 = safeString(a.line1 || a.address1 || a.streetAddress).trim();
  const city = safeString(a.city || a.upazila).trim();
  const countryIso2 = trimUpper(a.countryIso2 || "BD") || "BD";
  return !!(line1 && city && countryIso2);
}

/* ------------------ Helpers: UI -> Summary-safe address shape ------------------ */
export function coerceAddressForSummary(addr) {
  const a = normalizeAddress(addr, 0);
  if (!a) return null;
  return {
    id: a.id,
    name: a.name || "",
    email: a.email || "",
    phone: a.phone || "",
    line1: a.line1 || "",
    line2: a.line2 || "",
    city: a.city || "",
    state: a.state || "",
    postalCode: a.postalCode || "",
    countryIso2: a.countryIso2 || "BD",
    isDefault: !!a.isDefault,
    label: a.label || "",
    _key: a._key,
  };
}

/* ------------------ Payload mapping: canonical UI -> server (DB + granular) ------------------ */
export function toServerPayload(values) {
  const v = values && typeof values === "object" ? values : {};

  const name = safeString(v.name).trim();
  const email = trimLower(v.email);

  // address-form.jsx provides phoneNormalized; we still normalize defensively
  const phoneRaw = safeString(v.phoneNormalized || v.phone).trim();
  const phone = phoneRaw ? normalizeBDPhone(phoneRaw) : "";

  // address-form canonical fields
  const streetAddress = safeString(v.streetAddress || v.line1 || v.address1).trim();
  const address2 = safeString(v.address2 || v.line2 || v.address2).trim();

  const upazila = safeString(v.upazila || v.city || v.adminLevel3).trim();
  const district = safeString(v.district || v.state || v.adminLevel2).trim();
  const division = safeString(v.division || v.adminLevel1).trim();

  // DB mailing fields required by server
  const line1 =
    safeString(v.line1 || v.address1 || streetAddress).trim() ||
    [v.houseName, v.houseNo, v.apartmentNo, v.floorNo, streetAddress]
      .map((x) => safeString(x).trim())
      .filter(Boolean)
      .join(", ");

  const line2 =
    safeString(v.line2 || v.address2 || address2).trim() ||
    [v.postOffice, v.union, v.policeStation || v.thana]
      .map((x) => safeString(x).trim())
      .filter(Boolean)
      .join(", ");

  const city = upazila;
  const state = district || division;

  const postalCode = safeString(v.postalCode || v.postcode || v.zip).trim();
  const countryIso2 = trimUpper(v.countryIso2 || v.country || "BD") || "BD";

  const label = v.label != null ? safeString(v.label).trim() : undefined;
  const notes = v.notes != null ? safeString(v.notes).trim() : undefined;

  return {
    // upsert support (id optional)
    id: v.id != null ? v.id : undefined,

    // DB keys
    name,
    email,
    phone: phone || undefined,
    line1,
    line2,
    city,
    state,
    postalCode,
    countryIso2,

    // UI-shaped keys accepted by server (stored in granular / geo mapping)
    streetAddress: line1,
    address2: line2,
    upazila,
    district,
    division,

    // optional alternate keys some servers accept
    addressLine1: line1,
    addressLine2: line2,
    cityOrUpazila: city,
    districtOrState: state,

    label,
    notes,

    // granular merged on server
    granular: {
      name,
      email,
      phone: phone || phoneRaw || "",
      houseNo: safeString(v.houseNo).trim(),
      houseName: safeString(v.houseName).trim(),
      apartmentNo: safeString(v.apartmentNo).trim(),
      floorNo: safeString(v.floorNo).trim(),
      streetAddress: safeString(v.streetAddress).trim() || line1,
      village: safeString(v.village).trim(),
      postOffice: safeString(v.postOffice).trim(),
      union: safeString(v.union).trim(),
      policeStation: safeString(v.policeStation || v.thana).trim(),
      thana: safeString(v.thana).trim(),
      upazila,
      district,
      division,
      label,
      notes,
    },

    // default-only op supported by server
    makeDefault: !!v.makeDefault,
  };
}

/* ------------------ Fetch helper (abortable, 204-safe) ------------------ */
export async function tryJson(url, method = "GET", body, extraHeaders, signal) {
  const headers = { "Content-Type": "application/json" };
  if (extraHeaders && typeof extraHeaders === "object") {
    for (const [k, val] of Object.entries(extraHeaders)) {
      if (val == null || val === "") continue;
      headers[k] = String(val);
    }
  }

  const r = await fetch(url, {
    method,
    credentials: "include",
    cache: "no-store",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  let j = null;
  try {
    if (r.status !== 204) j = await r.json();
  } catch {
    j = null;
  }

  return { ok: r.ok, status: r.status, j };
}

/* ------------------ Server response unification ------------------ */
function extractAddressArray(respJson) {
  if (!respJson) return [];
  if (Array.isArray(respJson.addresses)) return respJson.addresses;
  if (Array.isArray(respJson.data)) return respJson.data; // legacy alias
  if (Array.isArray(respJson.items)) return respJson.items;
  if (Array.isArray(respJson)) return respJson;
  return [];
}

function extractDefault(respJson) {
  if (!respJson) return null;

  if (respJson.defaultAddress && typeof respJson.defaultAddress === "object") {
    return respJson.defaultAddress;
  }
  if (respJson.address && typeof respJson.address === "object") {
    return respJson.address;
  }
  if (respJson.data && typeof respJson.data === "object" && !Array.isArray(respJson.data)) {
    return respJson.data;
  }

  return null;
}

function normalizeList(rawList) {
  const normalized = (Array.isArray(rawList) ? rawList : [])
    .map((a, i) => normalizeAddress(a, i))
    .filter(Boolean)
    .filter((a) => !a.archivedAt);
  return dedupePreserveOrder(normalized);
}

function mergeDefaultIntoList(list, def) {
  if (!def) return list;

  const defId = def.id != null ? String(def.id) : null;
  const defSig = canonicalAddressSig(def);

  const found =
    (defId && list.find((a) => a.id != null && String(a.id) === defId)) ||
    (defSig && list.find((a) => canonicalAddressSig(a) === defSig)) ||
    null;

  if (found) {
    return list.map((a) => (a._key === found._key ? { ...a, isDefault: true } : a));
  }

  // Put default first so defaultKey always exists in list
  const seeded = [{ ...def, isDefault: true, _ord: -1 }, ...list];
  return dedupePreserveOrder(seeded);
}

/* ------------------ Address book API (account mode) ------------------ */
export const addressBookApi = {
  async list({ signal } = {}) {
    const r = await tryJson(ADDRESS_BOOK_BASE, "GET", null, null, signal);
    if (!r.ok) return { ok: false, status: r.status, addresses: [], defaultAddress: null, j: r.j };

    const raw = extractAddressArray(r.j);
    const addresses = normalizeList(raw);

    const rawDefault = extractDefault(r.j);
    const defaultAddress = rawDefault ? normalizeAddress(rawDefault, -1) : null;

    return { ok: true, status: r.status, addresses, defaultAddress, j: r.j };
  },

  async getDefault({ signal } = {}) {
    let r = await tryJson(`${ADDRESS_BOOK_BASE}?default=1`, "GET", null, null, signal);
    if (!r.ok) r = await tryJson(`${ADDRESS_BOOK_BASE}/default`, "GET", null, null, signal);
    if (!r.ok) return { ok: false, status: r.status, address: null, j: r.j };

    const raw = extractDefault(r.j);
    const normalized = raw ? normalizeAddress(raw, -1) : null;
    return { ok: true, status: r.status, address: normalized, j: r.j };
  },

  async create(values, { signal } = {}) {
    const payload = toServerPayload(values);
    return tryJson(ADDRESS_BOOK_BASE, "POST", payload, null, signal);
  },

  async update(id, values, { signal } = {}) {
    const enc = encodeURIComponent(String(id));
    const payload = toServerPayload({ ...values, id });

    // Preferred: PUT /[id]
    let res = await tryJson(`${ADDRESS_BOOK_BASE}/${enc}`, "PUT", payload, null, signal);

    // Compat: PATCH
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(`${ADDRESS_BOOK_BASE}/${enc}`, "PATCH", payload, null, signal);
    }

    // Fallback: POST with id (upsert-style)
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(ADDRESS_BOOK_BASE, "POST", payload, null, signal);
    }

    return res;
  },

  async setDefault(id, { signal } = {}) {
    const payload = { id, makeDefault: true };
    const enc = encodeURIComponent(String(id));

    // Try dedicated endpoint if present
    let res = await tryJson(`${ADDRESS_BOOK_BASE}/${enc}/default`, "POST", {}, null, signal);

    // Compat fallbacks
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(`${ADDRESS_BOOK_BASE}/${enc}`, "PATCH", payload, null, signal);
    }
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(ADDRESS_BOOK_BASE, "POST", payload, null, signal);
    }

    return res;
  },

  async remove(id, { signal } = {}) {
    const enc = encodeURIComponent(String(id));

    // Preferred: DELETE /[id]
    let res = await tryJson(`${ADDRESS_BOOK_BASE}/${enc}`, "DELETE", null, null, signal);

    // Compat: DELETE with body {id}
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(ADDRESS_BOOK_BASE, "DELETE", { id }, null, signal);
    }

    return res;
  },
};

/* ------------------ In-memory preloading (prevents late-load feel) ------------------ */
const _prefetch = {
  inflight: null,
  ts: 0,
  cache: {
    addresses: [],
    defaultAddress: null,
    defaultKey: null,
  },
};

function computeDefaultKey(list, def) {
  const byFlag = list.find((a) => a.isDefault) || null;
  const pick = def || byFlag || list[0] || null;
  return pick?._key ?? null;
}

/**
 * primeAddressBook()
 * - Prefer list() (it may already contain default)
 * - If needed, fetch default
 * - Merge default into list when missing
 * - Cache briefly to eliminate “late load” on re-entries
 */
export function primeAddressBook({ force = false, signal } = {}) {
  if (typeof window === "undefined") {
    return Promise.resolve({ addresses: [], defaultAddress: null, defaultKey: null });
  }

  if (_prefetch.inflight && !force) return _prefetch.inflight;

  if (
    !force &&
    _prefetch.ts &&
    Date.now() - _prefetch.ts < 10_000 &&
    _prefetch.cache.addresses.length
  ) {
    return Promise.resolve({ ..._prefetch.cache });
  }

  _prefetch.inflight = (async () => {
    const l = await addressBookApi.list({ signal }).catch(() => ({
      ok: false,
      addresses: [],
      defaultAddress: null,
    }));

    let list = dedupePreserveOrder(l?.addresses || []);
    let def = l?.defaultAddress || null;

    if (!list.length && !def) {
      const d = await addressBookApi.getDefault({ signal }).catch(() => ({
        ok: false,
        address: null,
      }));
      def = d?.address || null;
    }

    if (!list.length && def) list = [def];

    if (def) list = mergeDefaultIntoList(list, def);

    list = list.map((a, i) => (a && a._ord == null ? { ...a, _ord: i } : a));
    list = dedupePreserveOrder(list);

    const defaultKey = computeDefaultKey(list, def);

    // Avoid caching emptiness when auth/session not ready yet
    const meaningful = list.length > 0 || !!def;
    if (meaningful) {
      _prefetch.cache = { addresses: list, defaultAddress: def, defaultKey };
      _prefetch.ts = Date.now();
    } else {
      _prefetch.cache = { addresses: [], defaultAddress: null, defaultKey: null };
      _prefetch.ts = 0;
    }

    return { ..._prefetch.cache };
  })().finally(() => {
    _prefetch.inflight = null;
  });

  return _prefetch.inflight;
}

/* ------------------ Local selection persistence ------------------ */
function readFromAnyKey(keys = []) {
  if (typeof window === "undefined") return null;
  for (const k of keys) {
    const raw = localStorage.getItem(k);
    const parsed = safeJsonParse(raw);
    if (parsed) return parsed;
  }
  return null;
}

function writeToKey(key, value) {
  if (typeof window === "undefined") return;
  try {
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function readSelectedAddressFromStorage() {
  if (typeof window === "undefined") return null;
  const parsed = readFromAnyKey([LS_CHECKOUT_SELECTED_ADDRESS_KEY]);
  return normalizeAddress(parsed, 0);
}

export function writeSelectedAddressToStorage(addr) {
  writeToKey(LS_CHECKOUT_SELECTED_ADDRESS_KEY, addr || null);
}

export function writeShippingAddressToStorage(addr) {
  writeToKey(LS_CHECKOUT_SHIPPING_ADDRESS_KEY, addr || null);
  writeToKey(LS_CHECKOUT_SHIPPING_ADDRESS_KEY_LEGACY, addr || null);
}

export function writeBillingAddressToStorage(addr) {
  writeToKey(LS_CHECKOUT_BILLING_ADDRESS_KEY, addr || null);
  writeToKey(LS_CHECKOUT_BILLING_ADDRESS_KEY_LEGACY, addr || null);
}

/* ------------------ Hook: checkout address management (account mode) ------------------ */
export function useCheckoutAddressBook({
  enabled = true,
  keepSelection = true,
  preferStoredSelection = true,
} = {}) {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const [addresses, setAddresses] = useState([]);
  const [defaultKey, setDefaultKey] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);

  const mountedRef = useRef(false);
  const lastHydrateRef = useRef(0);
  const hydrateAbortRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        hydrateAbortRef.current?.abort?.();
      } catch {}
    };
  }, []);

  const selected = useMemo(() => {
    return addresses.find((a) => a._key === selectedKey) || null;
  }, [addresses, selectedKey]);

  const defaultAddress = useMemo(() => {
    return (
      addresses.find((a) => a._key === defaultKey) ||
      addresses.find((a) => a.isDefault) ||
      null
    );
  }, [addresses, defaultKey]);

  const hydrate = useCallback(
    async ({ force = false } = {}) => {
      if (!enabled) return { ok: false };

      try {
        hydrateAbortRef.current?.abort?.();
      } catch {}
      const ac = new AbortController();
      hydrateAbortRef.current = ac;

      if (mountedRef.current) setLoading(true);

      try {
        const snap = await primeAddressBook({ force, signal: ac.signal });
        const list = Array.isArray(snap.addresses) ? snap.addresses : [];

        if (!mountedRef.current) return { ok: false };

        setAddresses(list);
        setDefaultKey(snap.defaultKey ?? null);

        // Selection policy:
        // 1) stored selection (if allowed)
        // 2) keep current selection (if exists and keepSelection)
        // 3) defaultKey
        // 4) first address
        let nextSelectedKey = null;

        if (preferStoredSelection) {
          const stored = readSelectedAddressFromStorage();
          if (stored) {
            const found =
              list.find((a) => a._key === stored._key) ||
              list.find((a) => a.id && stored.id && String(a.id) === String(stored.id));
            if (found) nextSelectedKey = found._key;
          }
        }

        if (!nextSelectedKey && keepSelection && selectedKey) {
          const found = list.find((a) => a._key === selectedKey);
          if (found) nextSelectedKey = found._key;
        }

        if (!nextSelectedKey) nextSelectedKey = snap.defaultKey || list[0]?._key || null;

        setSelectedKey(nextSelectedKey);

        // Persist selection immediately (prevents “late show” on summary/review)
        const sel = list.find((a) => a._key === nextSelectedKey) || null;
        if (sel) writeSelectedAddressToStorage(sel);

        lastHydrateRef.current = Date.now();
        setReady(true);

        return { ok: true, addresses: list };
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [enabled, keepSelection, preferStoredSelection, selectedKey]
  );

  // Preload immediately when enabled flips on
  useEffect(() => {
    if (!enabled) return;
    if (lastHydrateRef.current && Date.now() - lastHydrateRef.current < 300) return;
    hydrate({ force: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const select = useCallback((addr) => {
    const a = normalizeAddress(addr, 0);
    if (!a) return;
    setSelectedKey(a._key);
    writeSelectedAddressToStorage(a);
  }, []);

  const create = useCallback(
    async (values) => {
      const payload = toServerPayload(values);

      // Server requires: line1, city, countryIso2
      if (!payload.line1 || !payload.city || !payload.countryIso2) {
        return { ok: false, status: 400, j: { error: "MISSING_REQUIRED_FIELDS" } };
      }

      const res = await addressBookApi.create(values);
      if (res?.ok) await hydrate({ force: true });
      return res;
    },
    [hydrate]
  );

  const update = useCallback(
    async (id, values) => {
      if (!id) return { ok: false, status: 400, j: { error: "MISSING_ID" } };

      const payload = toServerPayload({ ...values, id });
      if (!payload.line1 || !payload.city || !payload.countryIso2) {
        return { ok: false, status: 400, j: { error: "MISSING_REQUIRED_FIELDS" } };
      }

      const res = await addressBookApi.update(id, values);
      if (res?.ok) await hydrate({ force: true });
      return res;
    },
    [hydrate]
  );

  const remove = useCallback(
    async (id) => {
      if (!id) return { ok: false, status: 400, j: { error: "MISSING_ID" } };
      const res = await addressBookApi.remove(id);
      if (res?.ok) await hydrate({ force: true });
      return res;
    },
    [hydrate]
  );

  const setDefault = useCallback(
    async (id) => {
      if (!id) return { ok: false, status: 400, j: { error: "MISSING_ID" } };
      const res = await addressBookApi.setDefault(id);
      if (res?.ok) await hydrate({ force: true });
      return res;
    },
    [hydrate]
  );

  return {
    loading,
    ready,
    addresses,
    defaultKey,
    selectedKey,
    defaultAddress,
    selected,

    hydrate,
    select,
    create,
    update,
    remove,
    setDefault,
  };
}

/* =====================================================================================
 * Backward-compatible exports expected by checkout-page.js
 * -------------------------------------------------------------------------------------
 * checkout-page.js imports { book, profile } from this module.
 * - book.* wraps the single source of truth: /api/customers/address-book
 * - profile.read() provides identity prefill for account-mode (and safe fallback)
 * ===================================================================================== */

/**
 * book.bundle()
 * - Returns: { ok, list, def, status?, j? }
 *   - list: normalized addresses (deduped, non-archived)
 *   - def: normalized default address (or null)
 */
async function bundleAddressBook({ signal } = {}) {
  const l = await addressBookApi.list({ signal }).catch(() => ({
    ok: false,
    status: 0,
    addresses: [],
    defaultAddress: null,
    j: { error: "NETWORK_ERROR" },
  }));

  if (!l?.ok) {
    return {
      ok: false,
      status: l?.status ?? 0,
      list: [],
      def: null,
      j: l?.j || { error: "ADDRESS_BOOK_LIST_FAILED" },
    };
  }

  let list = dedupePreserveOrder(l.addresses || []);
  let def = l.defaultAddress || null;

  // If default wasn't included in list, merge it in to keep UI consistent
  if (def) list = mergeDefaultIntoList(list, def);

  // If no explicit default but list has isDefault flag, derive it
  if (!def) {
    def = list.find((a) => a.isDefault) || null;
  }

  // Final dedupe + order stability
  list = dedupePreserveOrder(list);

  return { ok: true, status: l.status, list, def, j: l.j };
}

/**
 * profile.read()
 * - Returns a minimal profile object used for prefill:
 *   { name, email, phone, phoneNormalized }
 *
 * Implementation notes:
 * - Primary attempt: /api/customers/me (if your app exposes it)
 * - Fallback: /api/auth/session (exists in your storefront)
 * - Never throws; returns {} on failure.
 */
async function readProfile({ signal } = {}) {
  // 1) Preferred: app profile endpoint (if present)
  try {
    const r1 = await tryJson("/api/customers/me", "GET", null, null, signal);
    if (r1?.ok && r1?.j) {
      const u = r1.j?.user || r1.j?.data || r1.j;
      const name = safeString(u?.name || u?.fullName || u?.customerName).trim();
      const email = trimLower(u?.email || u?.user?.email || "");
      const phoneRaw = safeString(u?.phone || u?.mobile || u?.phoneNumber || "").trim();
      const phoneNormalized = phoneRaw ? normalizeBDPhone(phoneRaw) : "";
      return { name, email, phone: phoneNormalized || phoneRaw, phoneNormalized };
    }
  } catch {}

  // 2) Fallback: auth session endpoint (known to exist)
  try {
    const r2 = await tryJson("/api/auth/session", "GET", null, null, signal);
    if (r2?.ok && r2?.j) {
      // Common NextAuth-ish shapes:
      // - { user: {...} }
      // - { session: { user: {...} } }
      const u = r2.j?.user || r2.j?.session?.user || r2.j?.data?.user || null;
      if (u) {
        const name = safeString(u?.name || u?.fullName || u?.customerName).trim();
        const email = trimLower(u?.email || "");
        const phoneRaw = safeString(u?.phone || u?.mobile || u?.phoneNumber || "").trim();
        const phoneNormalized = phoneRaw ? normalizeBDPhone(phoneRaw) : "";
        return { name, email, phone: phoneNormalized || phoneRaw, phoneNormalized };
      }
    }
  } catch {}

  return {};
}

/** Backward-compatible API surface used by checkout-page.js */
export const book = {
  bundle: bundleAddressBook,
  create: (values, opts) => addressBookApi.create(values, opts),
  update: (id, values, opts) => addressBookApi.update(id, values, opts),
  remove: (id, opts) => addressBookApi.remove(id, opts),
  setDefault: (id, opts) => addressBookApi.setDefault(id, opts),
};

export const profile = {
  read: readProfile,
};

