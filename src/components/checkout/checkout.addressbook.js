//FILE 1: src/components/checkout/checkout.addressbook.js
"use client";

/** =========================
 *  Address Book Single Source of Truth (TDLS)
 *  Canonical endpoint: /api/customers/address-book
 *  ========================= */

export const NAVY = "#0F2147";
export const MUTED = "#6B7280";
export const BORDER = "#DFE3EC";

/* ---------------- tiny helpers ---------------- */
export function titleCase(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

/* ---------------- phone helpers ---------------- */
export function normalizeBDPhone(p = "") {
  let s = String(p || "").trim();
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

/* ---------------- stable key + normalization ---------------- */
export function buildStableKey(a) {
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

export function normalizeAddress(a, idx = 0) {
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

  const houseBits = [out.houseName, out.houseNo, out.apartmentNo, out.floorNo].filter(Boolean);
  const baseStreet = String(out.streetAddress || out.line1 || out.address1 || "").trim();

  if (!out.address1) out.address1 = baseStreet;
  if (!out.line1) out.line1 = out.address1 || baseStreet;
  if (!out.streetAddress) out.streetAddress = out.line1 || out.address1 || baseStreet;

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

export function canonicalAddressSig(a) {
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

export function dedupePreserveOrder(list) {
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

/**
 * Summary components sometimes read `field?.[0]`.
 * If the field is a string, it becomes first character only.
 * This forces common lines into arrays for summary-safe rendering.
 */
export function coerceAddressForSummary(a) {
  if (!a) return null;

  const n =
    normalizeAddress(a, 0) ||
    (a.address && typeof a.address === "object" ? a.address : a);

  const houseBits = [n.houseName, n.houseNo, n.apartmentNo, n.floorNo].filter(Boolean);
  const baseStreet = String(n.streetAddress || n.line1 || n.address1 || "").trim();
  const fullLine1 =
    (houseBits.length ? [...houseBits, baseStreet].filter(Boolean).join(", ") : baseStreet) || "";
  const fullLine2 = String(n.address2 || n.line2 || "").trim();

  const line1Arr = fullLine1 ? [fullLine1] : [];
  const line2Arr = fullLine2 ? [fullLine2] : [];

  const shaped = {
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

export function toServerPayload(values) {
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
    [values.postOffice, values.union, values.policeStation].filter(Boolean).join(", ");

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
    // identity + canonical
    id: values.id,
    name: values.name ?? "",
    phone: values.phone ?? "",
    email: (values.email ?? "").toLowerCase(),

    // canonical mailing
    line1,
    line2,
    city,
    state,
    postalCode,
    countryIso2,

    // compat aliases
    addressLine1: line1,
    addressLine2: line2,
    cityOrUpazila: city,
    districtOrState: state,

    // UX flags
    label: values.label ?? undefined,
    makeDefault: !!values.makeDefault,

    // granular fields (persisted into Address.granular server-side)
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

export async function tryJson(url, method = "GET", body, extraHeaders) {
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

/** ---------------- API wrappers (ACCOUNT MODE ONLY) ----------------
 * Canonical rules:
 * - GET /api/customers/address-book?default=1 returns addresses + default (preferred)
 * - POST /api/customers/address-book create/update or default-only
 * - /api/customers/address-book/[id] supports GET, PUT/PATCH, DELETE (soft)
 * - DELETE compat can be /api/customers/address-book with body {id}
 */
export const book = {
  async bundle() {
    const opts = { credentials: "include", cache: "no-store" };

    // Preferred: bundle in a single call
    let r = await fetch("/api/customers/address-book?default=1", opts);
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const rawList = Array.isArray(j?.addresses)
        ? j.addresses
        : Array.isArray(j?.data)
        ? j.data
        : Array.isArray(j)
        ? j
        : [];

      const rawDef = j?.defaultAddress ?? j?.address ?? j?.default ?? null;

      const list = rawList.map((a, i) => normalizeAddress(a, i)).filter(Boolean);
      const def = normalizeAddress(rawDef, -1);
      return { ok: true, list, def, j };
    }

    // Fallback: list only
    r = await fetch("/api/customers/address-book", opts);
    if (!r.ok) return { ok: false, list: [], def: null, j: null };

    const j = await r.json().catch(() => ({}));
    const rawList = Array.isArray(j?.addresses)
      ? j.addresses
      : Array.isArray(j?.data)
      ? j.data
      : Array.isArray(j)
      ? j
      : [];

    const list = rawList.map((a, i) => normalizeAddress(a, i)).filter(Boolean);
    const def = normalizeAddress(j?.defaultAddress ?? null, -1);

    return { ok: true, list, def, j };
  },

  async create(values) {
    return tryJson("/api/customers/address-book", "POST", { ...toServerPayload(values) });
  },

  async update(id, values) {
    const enc = encodeURIComponent(String(id));
    const payload = { ...toServerPayload({ ...values, id }) };

    // Preferred: PUT /[id]
    let res = await tryJson(`/api/customers/address-book/${enc}`, "PUT", payload);

    // Fallback: PATCH /[id]
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson(`/api/customers/address-book/${enc}`, "PATCH", payload);
    }

    // Compat: POST to root with id
    if (!res.ok && (res.status === 404 || res.status === 405)) {
      res = await tryJson("/api/customers/address-book", "POST", payload);
    }

    return res;
  },

  async setDefault(id) {
    // Canonical: default-only POST
    const res = await tryJson("/api/customers/address-book", "POST", { id, makeDefault: true });
    if (res.ok) return res;

    // Fallback: PATCH /[id]
    const enc = encodeURIComponent(String(id));
    const res2 = await tryJson(`/api/customers/address-book/${enc}`, "PATCH", { makeDefault: true });
    return res2;
  },

  async remove(id) {
    // Preferred: DELETE /[id]
    const enc = encodeURIComponent(String(id));
    let r = await fetch(`/api/customers/address-book/${enc}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });

    let j = {};
    try {
      j = await r.json();
    } catch {}

    if (r.ok) return { ok: true, status: r.status, j };

    // Compat: DELETE root with body {id}
    const res2 = await tryJson("/api/customers/address-book", "DELETE", { id });
    return res2;
  },
};

export const profile = {
  async read() {
    const r = await fetch("/api/customers/me", { credentials: "include", cache: "no-store" });
    if (!r.ok) return {};
    return r.json().catch(() => ({}));
  },
};

export function isAddressComplete(a) {
  if (!a) return false;
  const line1 = a.address1 || a.line1 || a.streetAddress;
  const city = a.upazila || a.city;
  const dist = a.district || a.state;
  const countryIso2 = a.countryIso2 || a.country;
  if (!String(line1 || "").trim()) return false;
  if (!String(city || "").trim()) return false;
  if (!String(dist || "").trim()) return false;
  if (!String(countryIso2 || "").trim()) return false;
  return true;
}

export function addressesEqual(a, b) {
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
