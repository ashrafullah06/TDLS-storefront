//src/components/checkout/address-form.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

/** Brand palette (must match checkout-page.js / address-picker.jsx) */
const NAVY = "#0F2147";
const MUTED = "#6B7280";
const BORDER = "#DFE3EC";

/* ---------------- phone helpers (mirrors checkout-page.js) ---------------- */
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

  return s.startsWith("+") ? s : `+${s}`;
}

function isValidBDMobile(p = "") {
  const n = normalizeBDPhone(p);
  return /^\+8801\d{9}$/.test(n);
}

/* ---------------- storage (guest vs account compatible) ---------------- */
/**
 * Checkout-page behavior:
 * - Session key SS_CHECKOUT_MODE_KEY stores ONLY "guest" (session-only).
 * - If absent, checkout-page treats as "no preference" (it does NOT store "account").
 *
 * AddressForm behavior:
 * - If props.checkoutMode provided: trust it.
 * - Else: if sessionStorage says "guest", use guest.
 * - Else: default to "account" (safe for non-checkout usage).
 */
const SS_CHECKOUT_MODE_KEY = "tdlc_checkout_mode_session_v1";

const DRAFT_KEY = "tdlc_checkout_address_draft_v1";
const HIST_KEY = "tdlc_checkout_address_history_v1";

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function uniqPush(arr, v, limit = 8) {
  const s = String(v || "").trim();
  if (!s) return arr;
  const next = [s, ...(arr || []).filter((x) => String(x).trim() && String(x).trim() !== s)];
  return next.slice(0, limit);
}

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, val) {
  try {
    storage?.setItem?.(key, val);
  } catch {}
}

function getDetectedCheckoutModeGuestOnly() {
  // IMPORTANT: checkout-page only writes "guest" here, never "account"
  if (typeof window === "undefined") return null;
  const v = safeGet(window.sessionStorage, SS_CHECKOUT_MODE_KEY);
  const s = String(v || "").toLowerCase().trim();
  if (s === "guest") return "guest";
  return null;
}

function resolveMode(explicitMode) {
  const p = String(explicitMode || "").toLowerCase().trim();
  if (p === "guest" || p === "account") return p;
  const detected = getDetectedCheckoutModeGuestOnly();
  return detected || "account";
}

function pickStorage(mode) {
  if (typeof window === "undefined") return null;
  return mode === "guest" ? window.sessionStorage : window.localStorage;
}

function readDraftFrom(storage) {
  const raw = safeGet(storage, DRAFT_KEY);
  return raw ? safeParse(raw, null) : null;
}

function writeDraftTo(storage, obj) {
  safeSet(storage, DRAFT_KEY, JSON.stringify(obj || {}));
}

function readHistoryFrom(storage) {
  const raw = safeGet(storage, HIST_KEY);
  return raw ? safeParse(raw, {}) : {};
}

function writeHistoryTo(storage, obj) {
  safeSet(storage, HIST_KEY, JSON.stringify(obj || {}));
}

/* ---------------- Canonical payload (single source of truth) ---------------- */
/**
 * Canonical payload aligned with TDLS address-book conventions:
 * - DB-shaped keys: line1/line2/city/state/postalCode/countryIso2
 * - UI-shaped keys: streetAddress/address2/upazila/district/division
 * - Required for write (server): line1, city(upazila), countryIso2
 * - Identity + extras placed into `granular`
 *
 * Enhancements:
 * - Supports address `type` for account mode (SHIPPING/BILLING).
 */
function buildCanonicalAddressPayload(vals, { forceDefault }) {
  const nameRaw = String(vals?.name ?? "");
  const phoneRaw = String(vals?.phone ?? "");
  const emailRaw = String(vals?.email ?? "");

  const name = nameRaw.trim();
  const phone = normalizeBDPhone(phoneRaw);
  const email = emailRaw.trim().toLowerCase();

  const streetAddress = String(vals?.streetAddress || vals?.address1 || vals?.line1 || "").trim();
  const address2 = String(vals?.address2 || vals?.line2 || "").trim();

  const upazila = String(vals?.upazila || vals?.city || "").trim();
  const district = String(vals?.district || vals?.state || "").trim();
  const division = String(vals?.division || "").trim();

  const postalCode = String(vals?.postalCode || "").trim();
  const countryIso2 = String(vals?.countryIso2 || "BD").toUpperCase().trim() || "BD";

  const makeDefault = forceDefault ? true : !!vals?.makeDefault;
  const isDefault = makeDefault;

  // Address type (default shipping)
  const typeRaw = String(vals?.type || "SHIPPING").toUpperCase().trim();
  const type = typeRaw === "BILLING" ? "BILLING" : "SHIPPING";

  const granular = {
    name: name || null,
    phone: phone || null,
    email: email || null,
    label: vals?.label != null ? String(vals.label).trim() || null : null,
    notes: vals?.notes != null ? String(vals.notes).trim() || null : null,

    houseNo: vals?.houseNo != null ? String(vals.houseNo).trim() || null : null,
    houseName: vals?.houseName != null ? String(vals.houseName).trim() || null : null,
    apartmentNo: vals?.apartmentNo != null ? String(vals.apartmentNo).trim() || null : null,
    floorNo: vals?.floorNo != null ? String(vals.floorNo).trim() || null : null,

    village: vals?.village != null ? String(vals.village).trim() || null : null,
    postOffice: vals?.postOffice != null ? String(vals.postOffice).trim() || null : null,
    union: vals?.union != null ? String(vals.union).trim() || null : null,
    policeStation: vals?.policeStation != null ? String(vals.policeStation).trim() || null : null,

    // UI aliases
    streetAddress: streetAddress || null,
    address2: address2 || null,
    upazila: upazila || null,
    district: district || null,
    division: division || null,
  };

  const id = vals?.id != null ? String(vals.id).trim() : "";
  const label = vals?.label != null ? String(vals.label).trim() || null : null;

  return {
    id: id || "",

    // address-book routing
    type, // SHIPPING | BILLING

    // identity fields (UI + flows)
    name,
    phone,
    email,

    // raw + normalized (safe for OTP / server)
    nameRaw,
    phoneRaw,
    emailRaw,
    nameNormalized: name,
    phoneNormalized: phone,
    emailNormalized: email,

    // UI keys
    streetAddress,
    address2: address2 || "",
    upazila,
    district,
    division,
    postalCode,
    countryIso2,

    // DB-shaped canonical keys
    line1: streetAddress,
    line2: address2 || null,
    city: upazila,
    state: district,
    adminLevel1: division || null,
    adminLevel2: district || null,
    adminLevel3: upazila || null,

    // extras
    label,
    phoneModel: phone || null,
    makeDefault,
    isDefault,

    // optional fields
    houseNo: vals?.houseNo ?? "",
    houseName: vals?.houseName ?? "",
    apartmentNo: vals?.apartmentNo ?? "",
    floorNo: vals?.floorNo ?? "",
    policeStation: vals?.policeStation ?? "",
    postOffice: vals?.postOffice ?? "",
    union: vals?.union ?? "",
    village: vals?.village ?? "",

    // blob
    granular,
  };
}

/* ---------------- Address Form ---------------- */
export default function AddressForm({
  title,
  subtitle,
  prefill,

  checkoutMode,

  includeUserFields = true,
  requirePhone = true,

  // default address control
  showMakeDefault = false,
  forceDefault = false,

  // account-mode support: SHIPPING / BILLING
  addressType = "SHIPPING",
  showTypeSelector = false,

  // layout safety (never hide under fixed bars)
  useSafePadding = true,

  submitLabel = "Continue",
  onCancel,
  onSubmit,
  onDraftChange,
  validateSignal = 0,
}) {
  const [mode, setMode] = useState("account");
  const [storage, setStorage] = useState(null);

  const storageRef = useRef(null);
  const modeRef = useRef("account");

  // Track whether user/autofill has started interacting (prevents overwrite flashes)
  const userInteractedRef = useRef(false);
  const hydratedFromStorageRef = useRef(false);

  // Keep latest vals in a ref (for flush operations)
  const valsRef = useRef(null);
  const formRef = useRef(null);

  // Hydration-safe init: resolve mode + storage on mount and whenever checkoutMode changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const resolved = resolveMode(checkoutMode);
    const st = pickStorage(resolved) || window.localStorage;
    modeRef.current = resolved;
    storageRef.current = st;
    setMode(resolved);
    setStorage(st);
  }, [String(checkoutMode || "")]);

  const [vals, setVals] = useState(() => {
    // server-safe initial values; real merge happens when storage becomes available
    return {
      type: String(addressType || "SHIPPING").toUpperCase() === "BILLING" ? "BILLING" : "SHIPPING",

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

      label: "",
      notes: "",
      id: "",
    };
  });

  useEffect(() => {
    valsRef.current = vals;
  }, [vals]);

  const [history, setHistory] = useState({});
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [showOptional, setShowOptional] = useState(false);

  const saveTimerRef = useRef(null);
  const lastPersistSigRef = useRef("");

  // Blink-safe draft-change dispatch (debounced)
  const lastDraftSigRef = useRef("");
  const draftNotifyTimerRef = useRef(null);
  const pendingDraftRef = useRef(null);

  const divisionSuggestions = useMemo(() => {
    const base = [
      "Dhaka",
      "Chattogram",
      "Rajshahi",
      "Khulna",
      "Barishal",
      "Sylhet",
      "Rangpur",
      "Mymensingh",
    ];
    const extra = (history?.division || []).filter(Boolean);
    return Array.from(new Set([...extra, ...base]));
  }, [history]);

  // Helper: "safe merge" - do not overwrite non-empty fields after user interaction,
  // unless a new address id is being applied (selection from address book).
  const safeMergeInto = useCallback((prev, incoming, { allowOverwrite }) => {
    const next = { ...prev };

    const prevId = String(prev?.id || "").trim();
    const incId = String(incoming?.id || "").trim();

    // If a different id comes in, treat as new address selection -> allow overwrite fully
    const newSelection = !!incId && incId !== prevId;

    const overwrite = allowOverwrite || newSelection;

    for (const k of Object.keys(incoming || {})) {
      const v = incoming[k];
      if (v === undefined) continue;

      if (overwrite) {
        next[k] = v;
        continue;
      }

      // Fill-only mode: only fill if current is empty-ish and incoming is meaningful
      const cur = next[k];
      const curEmpty =
        cur == null ||
        (typeof cur === "string" && cur.trim() === "") ||
        (typeof cur === "number" && !Number.isFinite(cur));

      const incMeaningful = v != null && (!(typeof v === "string") || v.trim() !== "");

      if (curEmpty && incMeaningful) next[k] = v;
    }

    return next;
  }, []);

  // When storage becomes available, load draft/history and merge with prefill + defaults.
  useEffect(() => {
    if (!storage) return;

    const st = storage;
    const draft = readDraftFrom(st);
    const p = prefill && typeof prefill === "object" ? prefill : {};

    setHistory(readHistoryFrom(st));

    setVals((prev) => {
      const typeFromProp =
        String(addressType || "SHIPPING").toUpperCase() === "BILLING" ? "BILLING" : "SHIPPING";

      const allowOverwrite = !userInteractedRef.current;

      // Merge order: prev -> draft -> prefill (prefill is higher priority)
      let merged = { ...prev };

      if (draft && typeof draft === "object") {
        merged = safeMergeInto(merged, draft, { allowOverwrite });
      }
      if (p && typeof p === "object") {
        merged = safeMergeInto(merged, p, { allowOverwrite });
      }

      // hard normalize type + country + makeDefault
      const next = {
        ...merged,
        type:
          String(p?.type || merged?.type || draft?.type || typeFromProp)
            .toUpperCase()
            .trim() === "BILLING"
            ? "BILLING"
            : "SHIPPING",
        countryIso2: String(p?.countryIso2 || merged?.countryIso2 || "BD").toUpperCase().trim(),
        makeDefault:
          p?.makeDefault ??
          p?.isDefault ??
          merged?.makeDefault ??
          draft?.makeDefault ??
          prev.makeDefault,
      };

      // Mark we did storage hydration once (useful for debugging / future safety)
      hydratedFromStorageRef.current = true;

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);

  // Keep type synced with prop when type selector is not shown.
  useEffect(() => {
    if (showTypeSelector) return;
    const t = String(addressType || "SHIPPING").toUpperCase().trim() === "BILLING" ? "BILLING" : "SHIPPING";
    setVals((p) => {
      if (String(p.type || "").toUpperCase() === t) return p;
      return { ...p, type: t };
    });
  }, [String(addressType || ""), showTypeSelector]);

  // Prefill can change frequently; merge without loops.
  useEffect(() => {
    const p = prefill && typeof prefill === "object" ? prefill : {};
    if (!p || !Object.keys(p).length) return;

    const patch = {
      type: p.type,

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
      upazila: p.upazila ?? p.city ?? p.adminLevel3,
      district: p.district ?? p.state ?? p.adminLevel2,
      division: p.division ?? p.adminLevel1,
      postalCode: p.postalCode,
      countryIso2: p.countryIso2,
      makeDefault: p.makeDefault ?? p.isDefault,
      label: p.label,
      notes: p.notes,
      id: p.id,
    };

    setVals((prev) => {
      const allowOverwrite = !userInteractedRef.current;

      // Apply patch with "no-overwrite" unless new id
      let next = safeMergeInto(prev, patch, { allowOverwrite });

      next.type =
        String(next.type || "SHIPPING").toUpperCase().trim() === "BILLING" ? "BILLING" : "SHIPPING";
      next.countryIso2 = String(next.countryIso2 || "BD").toUpperCase();

      const owned = [
        "type",
        "name",
        "phone",
        "email",
        "houseNo",
        "houseName",
        "apartmentNo",
        "floorNo",
        "streetAddress",
        "address2",
        "village",
        "postOffice",
        "union",
        "policeStation",
        "upazila",
        "district",
        "division",
        "postalCode",
        "countryIso2",
        "makeDefault",
        "label",
        "notes",
        "id",
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

  // Persist draft smoothly (debounced), respecting guest/account storage.
  useEffect(() => {
    const st = storageRef.current;
    if (typeof window === "undefined" || !st) return;

    const persistObj = {
      ...vals,
      type:
        String(vals.type || "SHIPPING").toUpperCase().trim() === "BILLING" ? "BILLING" : "SHIPPING",
      countryIso2: (vals.countryIso2 || "BD").toString().toUpperCase(),
      makeDefault: forceDefault ? true : !!vals.makeDefault,
    };

    const persistSig = JSON.stringify(persistObj);
    if (persistSig === lastPersistSigRef.current) return;
    lastPersistSigRef.current = persistSig;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      writeDraftTo(st, persistObj);
    }, 220);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [vals, forceDefault]);

  // External validation trigger (e.g., parent CTA)
  useEffect(() => {
    if (!validateSignal) return;

    setError("");
    setFieldErrors({});

    const name = String(vals.name || "").trim();
    const phoneNorm = normalizeBDPhone(String(vals.phone || "").trim());

    const errs = {};
    const missingLabels = [];

    if (includeUserFields) {
      if (!name) errs.name = "required";

      if (requirePhone) {
        if (!phoneNorm) errs.phone = "required";
        else if (!isValidBDMobile(phoneNorm)) errs.phone = "invalid";
      }
    }

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

  function markInteracted() {
    userInteractedRef.current = true;
  }

  function setField(k, v) {
    markInteracted();

    // Clear per-field error instantly on edit (prevents flicker)
    setFieldErrors((prev) => {
      if (!prev || !prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });

    setVals((p) => {
      const prevV = p?.[k];
      if (Object.is(prevV, v)) return p;
      return { ...p, [k]: v };
    });
  }

// Autofill sync: prevents controlled-input "tug-of-war" flicker after browser saved-address fill.
function syncFromDom() {
  const root = formRef.current;
  if (!root || typeof window === "undefined") return;

  const cur = valsRef.current || {};
  const patch = {};

  const map = {
    fullName: "name",
    phone: "phone",
    email: "email",
    houseNo: "houseNo",
    houseName: "houseName",
    apartmentNo: "apartmentNo",
    floorNo: "floorNo",
    addressLine1: "streetAddress",
    addressLine2: "address2",
    city: "upazila",
    district: "district",
    division: "division",
    postalCode: "postalCode",
    postOffice: "postOffice",
    union: "union",
    policeStation: "policeStation",
    country: "countryIso2",
  };

  const els = root.querySelectorAll("input[name], select[name], textarea[name]");
  els.forEach((el) => {
    const n = el.getAttribute("name");
    if (!n) return;
    const k = map[n] || n;
    if (!(k in cur)) return;

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
}

function handleAutofillAnimationStart(e) {
  if (!e?.animationName) return;
  if (e.animationName !== "tdlsAutofillStart") return;

  const raf =
    (typeof window !== "undefined" && window.requestAnimationFrame) ||
    ((fn) => setTimeout(fn, 0));

  raf(() => syncFromDom());
}

useEffect(() => {
  if (typeof window === "undefined") return;
  const t1 = setTimeout(() => syncFromDom(), 60);
  const t2 = setTimeout(() => syncFromDom(), 260);
  return () => {
    clearTimeout(t1);
    clearTimeout(t2);
  };
}, []);

  function isCompleteLocal(a) {
    const line1 = a.streetAddress || a.address1 || a.line1 || "";
    const city = a.upazila || a.city || "";
    const dist = a.district || a.state || "";
    const country = (a.countryIso2 || "BD").toString().toUpperCase();
    if (!line1.trim() || !city.trim() || !dist.trim() || !country.trim()) return false;
    return true;
  }

  function computeDraft() {
    const current = valsRef.current || vals;
    const canonical = buildCanonicalAddressPayload(current, { forceDefault });

    const phoneValid = !requirePhone || isValidBDMobile(canonical.phoneNormalized);
    const userOk = !includeUserFields || (!!canonical.nameNormalized && phoneValid);
    const complete = userOk && isCompleteLocal(canonical);

    return { canonical, complete };
  }

  function flushDraftChange() {
    if (typeof onDraftChange !== "function") return;
    if (draftNotifyTimerRef.current) {
      clearTimeout(draftNotifyTimerRef.current);
      draftNotifyTimerRef.current = null;
    }
    const { canonical, complete } = computeDraft();
    const sig = JSON.stringify({
      v: canonical,
      complete,
      includeUserFields: !!includeUserFields,
      requirePhone: !!requirePhone,
      forceDefault: !!forceDefault,
    });
    if (sig === lastDraftSigRef.current) return;
    lastDraftSigRef.current = sig;
    onDraftChange(canonical, complete);
  }

  // Live canonical draft updates to parent, blink-safe (debounced) to avoid rapid toggle UI flashes.
  useEffect(() => {
    if (typeof onDraftChange !== "function") return;

    const { canonical, complete } = computeDraft();
    pendingDraftRef.current = { canonical, complete };

    const sig = JSON.stringify({
      v: canonical,
      complete,
      includeUserFields: !!includeUserFields,
      requirePhone: !!requirePhone,
      forceDefault: !!forceDefault,
    });

    // If exactly identical payload, do nothing.
    if (sig === lastDraftSigRef.current) return;

    if (draftNotifyTimerRef.current) clearTimeout(draftNotifyTimerRef.current);
    draftNotifyTimerRef.current = setTimeout(() => {
      const p = pendingDraftRef.current;
      if (!p) return;

      const sig2 = JSON.stringify({
        v: p.canonical,
        complete: p.complete,
        includeUserFields: !!includeUserFields,
        requirePhone: !!requirePhone,
        forceDefault: !!forceDefault,
      });
      if (sig2 === lastDraftSigRef.current) return;

      lastDraftSigRef.current = sig2;
      onDraftChange(p.canonical, p.complete);
    }, 160);

    return () => {
      if (draftNotifyTimerRef.current) clearTimeout(draftNotifyTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vals, includeUserFields, requirePhone, forceDefault, typeof onDraftChange]);

  function rememberField(field, value) {
    const s = String(value || "").trim();
    if (!s) return;

    const next = {
      ...(history || {}),
      [field]: uniqPush(history?.[field] || [], s, 10),
    };
    setHistory(next);

    const st = storageRef.current;
    if (st) writeHistoryTo(st, next);
  }

  // Helpers: find nearest scrollable ancestor (modals/drawers), for true "never hide".
  function findScrollParent(el) {
    if (!el || typeof window === "undefined") return null;
    let cur = el.parentElement;
    while (cur && cur !== document.body) {
      const style = window.getComputedStyle(cur);
      const oy = style.overflowY;
      const canScroll = (oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight + 4;
      if (canScroll) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // Mobile focus helper: robust “do not hide under fixed bars”
  const ensureFieldVisible = useCallback((el) => {
    if (!el || typeof window === "undefined") return;

    const isTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");

    if (!isTouch) return;

    const getCssPx = (varName, fallback) => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
        const n = parseFloat(String(v || "").trim());
        return Number.isFinite(n) ? n : fallback;
      } catch {
        return fallback;
      }
    };

    // HARD SAFETY BUFFER (requested): 0.5 inch = 48 CSS px
    const EXTRA_SAFE_PX = 48;

    window.setTimeout(() => {
      try {
        const sp = findScrollParent(el);
        const rect = el.getBoundingClientRect();

        if (sp) {
          const spRect = sp.getBoundingClientRect();
          const topIn = rect.top - spRect.top;
          const bottomIn = rect.bottom - spRect.top;

          const safeTop = 12 + EXTRA_SAFE_PX;
          const safeBottom = sp.clientHeight - 12 - EXTRA_SAFE_PX;

          let delta = 0;
          if (topIn < safeTop) delta = topIn - safeTop;
          else if (bottomIn > safeBottom) delta = bottomIn - safeBottom;

          if (delta !== 0) sp.scrollBy({ top: delta, behavior: "smooth" });
          else el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });

          return;
        }

        // Window scrolling path
        const vvH = window.visualViewport?.height || window.innerHeight;
        const vvTop = window.visualViewport?.offsetTop || 0;

        const navbarH = getCssPx("--navbar-h", 96) + vvTop;
        const bottomH = Math.max(getCssPx("--bottom-floating-h", 0), getCssPx("--bottom-safe-pad", 84));

        const safeTop = navbarH + EXTRA_SAFE_PX + 10;
        const safeBottom = vvH - bottomH - EXTRA_SAFE_PX - 10;

        let delta = 0;
        if (rect.top < safeTop) delta = rect.top - safeTop;
        else if (rect.bottom > safeBottom) delta = rect.bottom - safeBottom;

        if (delta !== 0) window.scrollBy({ top: delta, behavior: "smooth" });
        else el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      } catch {}
    }, 70);
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault?.();

    // Ensure parent has the final stable draft before submit actions (blink-safe)
    flushDraftChange();

    setError("");
    setFieldErrors({});

    const canonical = buildCanonicalAddressPayload(valsRef.current || vals, { forceDefault });

    const errs = {};
    const missingLabels = [];

    if (includeUserFields) {
      if (!canonical.nameNormalized) errs.name = "required";

      if (requirePhone) {
        if (!canonical.phoneRaw.trim()) errs.phone = "required";
        else if (!isValidBDMobile(canonical.phoneNormalized)) errs.phone = "invalid";
      }
    }

    if (!canonical.streetAddress.trim()) errs.streetAddress = "required";
    if (!canonical.upazila.trim()) errs.upazila = "required";
    if (!canonical.district.trim()) errs.district = "required";

    if (Object.keys(errs).length) {
      setFieldErrors(errs);

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

    // remember key fields for next checkout (respects guest/account storage)
    rememberField("name", canonical.nameRaw);
    rememberField("phone", canonical.phoneNormalized);
    rememberField("email", canonical.emailNormalized);
    rememberField("streetAddress", canonical.streetAddress);
    rememberField("address2", canonical.address2);
    rememberField("upazila", canonical.upazila);
    rememberField("district", canonical.district);
    rememberField("division", canonical.division);
    rememberField("postOffice", vals.postOffice);
    rememberField("policeStation", vals.policeStation);
    rememberField("union", vals.union);

    try {
      const res = await onSubmit?.(canonical);
      if (res === false) return;
    } catch (err) {
      setError(
        "Could not save your address. Please try again. If the problem continues, refresh the page and re-submit."
      );
      // eslint-disable-next-line no-console
      console.error("AddressForm onSubmit failed:", err);
    }
  }

  return (
    <div className="ca-safe-wrap" data-mode={mode} data-safe={useSafePadding ? "1" : "0"}>
      <form ref={formRef} onSubmit={handleSubmit} onAnimationStartCapture={handleAutofillAnimationStart} className="ca-form">
        {title ? <div className="ca-title">{title}</div> : null}
        {subtitle ? <div className="ca-sub">{subtitle}</div> : null}

        {error ? <div className="ca-error">{error}</div> : null}

        {/* datalists for suggestions */}
        <datalist id="dl-upazila">
          {(history?.upazila || []).map((x) => (
            <option key={`u-${x}`} value={x} />
          ))}
        </datalist>
        <datalist id="dl-district">
          {(history?.district || []).map((x) => (
            <option key={`d-${x}`} value={x} />
          ))}
        </datalist>
        <datalist id="dl-division">
          {divisionSuggestions.map((x) => (
            <option key={`dv-${x}`} value={x} />
          ))}
        </datalist>
        <datalist id="dl-po">
          {(history?.postOffice || []).map((x) => (
            <option key={`po-${x}`} value={x} />
          ))}
        </datalist>
        <datalist id="dl-ps">
          {(history?.policeStation || []).map((x) => (
            <option key={`ps-${x}`} value={x} />
          ))}
        </datalist>
        <datalist id="dl-union">
          {(history?.union || []).map((x) => (
            <option key={`un-${x}`} value={x} />
          ))}
        </datalist>
        <datalist id="dl-street">
          {(history?.streetAddress || []).map((x) => (
            <option key={`st-${x}`} value={x} />
          ))}
        </datalist>

        {/* Optional address type selector (account pages). Checkout stays unchanged by default. */}
        {showTypeSelector ? (
          <div className="ca-type">
            <div className="ca-type-label">Address type</div>
            <div className="ca-type-row" role="group" aria-label="Address type">
              <button
                type="button"
                className={`ca-type-btn${String(vals.type).toUpperCase() === "SHIPPING" ? " on" : ""}`}
                onClick={() => setField("type", "SHIPPING")}
              >
                Shipping
              </button>
              <button
                type="button"
                className={`ca-type-btn${String(vals.type).toUpperCase() === "BILLING" ? " on" : ""}`}
                onClick={() => setField("type", "BILLING")}
              >
                Billing
              </button>
            </div>
          </div>
        ) : null}

        {/* Primary user + required address fields (always visible) */}
        {includeUserFields ? (
          <div className="ca-grid cols3">
            <div className={`ca-field${fieldErrors.name ? " invalid" : ""}`}>
              <label>
                Full name <span className="req">*</span>
              </label>
              <input
                name="fullName"
                autoComplete="name"
                autoCapitalize="words"
                spellCheck={false}
                value={vals.name || ""}
                onChange={(e) => setField("name", e.target.value)}
                onInput={() => markInteracted()}
                placeholder="Your full name"
                onBlur={() => rememberField("name", vals.name)}
                onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                aria-invalid={!!fieldErrors.name}
              />
            </div>

            <div className={`ca-field${fieldErrors.phone ? " invalid" : ""}`}>
              <label>
                Mobile number {requirePhone ? <span className="req">*</span> : null}
              </label>
              <input
                name="phone"
                autoComplete="tel"
                inputMode="tel"
                spellCheck={false}
                value={vals.phone || ""}
                onChange={(e) => setField("phone", e.target.value)}
                onInput={() => markInteracted()}
                onBlur={(e) => {
                  const n = normalizeBDPhone(e.target.value);
                  if (n && n !== (valsRef.current?.phone || vals.phone)) setField("phone", n);
                  rememberField("phone", n || e.target.value);
                  // Emit a stable draft after normalization (prevents parent toggling twice)
                  flushDraftChange();
                }}
                placeholder="017XXXXXXXX / +88017XXXXXXXX"
                onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                aria-invalid={!!fieldErrors.phone}
              />
            </div>

            <div className="ca-field">
              <label>Email (optional)</label>
              <input
                name="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                value={vals.email || ""}
                onChange={(e) => setField("email", e.target.value)}
                onInput={() => markInteracted()}
                placeholder="name@email.com"
                onBlur={() => rememberField("email", vals.email)}
                onFocus={(e) => ensureFieldVisible(e.currentTarget)}
              />
            </div>
          </div>
        ) : null}

        <div className="ca-grid cols4">
          <div className={`ca-field ca-span4${fieldErrors.streetAddress ? " invalid" : ""}`}>
            <label>
              Street Address <span className="req">*</span>
            </label>
            <input
              name="addressLine1"
              autoComplete="address-line1"
              list="dl-street"
              autoCapitalize="words"
              value={vals.streetAddress || vals.address1 || ""}
              onChange={(e) => setField("streetAddress", e.target.value)}
              onInput={() => markInteracted()}
              placeholder="Street / Road / Area"
              onBlur={() => rememberField("streetAddress", vals.streetAddress)}
              onFocus={(e) => ensureFieldVisible(e.currentTarget)}
              aria-invalid={!!fieldErrors.streetAddress}
            />
          </div>
        </div>

        <div className="ca-grid cols4">
          <div className={`ca-field${fieldErrors.upazila ? " invalid" : ""}`}>
            <label>
              Upazila / City <span className="req">*</span>
            </label>
            <input
              name="city"
              autoComplete="address-level2"
              list="dl-upazila"
              autoCapitalize="words"
              value={vals.upazila || vals.city || ""}
              onChange={(e) => setField("upazila", e.target.value)}
              onInput={() => markInteracted()}
              placeholder="Upazila / City"
              onBlur={() => rememberField("upazila", vals.upazila)}
              onFocus={(e) => ensureFieldVisible(e.currentTarget)}
              aria-invalid={!!fieldErrors.upazila}
            />
          </div>

          <div className={`ca-field${fieldErrors.district ? " invalid" : ""}`}>
            <label>
              District <span className="req">*</span>
            </label>
            <input
              name="district"
              autoComplete="address-level1"
              list="dl-district"
              autoCapitalize="words"
              value={vals.district || ""}
              onChange={(e) => setField("district", e.target.value)}
              onInput={() => markInteracted()}
              placeholder="District"
              onBlur={() => rememberField("district", vals.district)}
              onFocus={(e) => ensureFieldVisible(e.currentTarget)}
              aria-invalid={!!fieldErrors.district}
            />
          </div>

          <div className="ca-field">
            <label>Division (optional)</label>
            <input
              name="division"
              list="dl-division"
              autoCapitalize="words"
              value={vals.division || ""}
              onChange={(e) => setField("division", e.target.value)}
              onInput={() => markInteracted()}
              placeholder="Division"
              onBlur={() => rememberField("division", vals.division)}
              onFocus={(e) => ensureFieldVisible(e.currentTarget)}
            />
          </div>

          <div className="ca-field">
            <label>Postal Code (optional)</label>
            <input
              name="postalCode"
              autoComplete="postal-code"
              inputMode="numeric"
              value={vals.postalCode || ""}
              onChange={(e) => setField("postalCode", e.target.value)}
              onInput={() => markInteracted()}
              placeholder="Postal code"
              onBlur={() => rememberField("postalCode", vals.postalCode)}
              onFocus={(e) => ensureFieldVisible(e.currentTarget)}
            />
          </div>
        </div>

        {/* Optional fields toggle (compress vertical height) */}
        <button
          type="button"
          className="ca-morebtn"
          onClick={() => setShowOptional((v) => !v)}
          aria-expanded={showOptional}
          aria-controls="ca-optional"
        >
          <span className="t">{showOptional ? "Hide optional address details" : "Add optional address details"}</span>
          <span className="i" aria-hidden="true">
            {showOptional ? "▴" : "▾"}
          </span>
        </button>

        {showOptional ? (
          <div id="ca-optional" className="ca-optional">
            <div className="ca-grid cols4">
              <div className="ca-field">
                <label>House No</label>
                <input
                  name="houseNo"
                  autoComplete="address-line1"
                  value={vals.houseNo || ""}
                  onChange={(e) => setField("houseNo", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="House No"
                  onBlur={() => rememberField("houseNo", vals.houseNo)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
              <div className="ca-field">
                <label>House Name</label>
                <input
                  name="houseName"
                  value={vals.houseName || ""}
                  onChange={(e) => setField("houseName", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="House Name"
                  onBlur={() => rememberField("houseName", vals.houseName)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
              <div className="ca-field">
                <label>Apartment No</label>
                <input
                  name="apartmentNo"
                  value={vals.apartmentNo || ""}
                  onChange={(e) => setField("apartmentNo", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="Apartment"
                  onBlur={() => rememberField("apartmentNo", vals.apartmentNo)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
              <div className="ca-field">
                <label>Floor No</label>
                <input
                  name="floorNo"
                  value={vals.floorNo || ""}
                  onChange={(e) => setField("floorNo", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="Floor"
                  onBlur={() => rememberField("floorNo", vals.floorNo)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
            </div>

            <div className="ca-grid cols4">
              <div className="ca-field ca-span4">
                <label>Address line 2 (optional)</label>
                <input
                  name="addressLine2"
                  autoComplete="address-line2"
                  autoCapitalize="words"
                  value={vals.address2 || ""}
                  onChange={(e) => setField("address2", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="Nearby landmark / extra details"
                  onBlur={() => rememberField("address2", vals.address2)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
            </div>

            <div className="ca-grid cols4">
              <div className="ca-field">
                <label>Post Office (optional)</label>
                <input
                  name="postOffice"
                  list="dl-po"
                  autoCapitalize="words"
                  value={vals.postOffice || ""}
                  onChange={(e) => setField("postOffice", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="Post Office"
                  onBlur={() => rememberField("postOffice", vals.postOffice)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
              <div className="ca-field">
                <label>Union (optional)</label>
                <input
                  name="union"
                  list="dl-union"
                  autoCapitalize="words"
                  value={vals.union || ""}
                  onChange={(e) => setField("union", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="Union"
                  onBlur={() => rememberField("union", vals.union)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
              <div className="ca-field">
                <label>Police Station / Thana (optional)</label>
                <input
                  name="policeStation"
                  list="dl-ps"
                  autoCapitalize="words"
                  value={vals.policeStation || vals.thana || ""}
                  onChange={(e) => setField("policeStation", e.target.value)}
                  onInput={() => markInteracted()}
                  placeholder="Police Station / Thana"
                  onBlur={() => rememberField("policeStation", vals.policeStation)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                />
              </div>
              <div className="ca-field">
                <label>Country</label>
                <select
                  name="country"
                  autoComplete="country"
                  value={(vals.countryIso2 || "BD").toString().toUpperCase()}
                  onChange={(e) => setField("countryIso2", e.target.value)}
                  onFocus={(e) => ensureFieldVisible(e.currentTarget)}
                >
                  <option value="BD">Bangladesh (BD)</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}

        {showMakeDefault || forceDefault ? (
          <label className="chk">
            <input
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
          /* ---------------------------------------------------------
           * Never hide under Navbar / BottomFloatingBar:
           * - HARD 0.5in safety buffer top+bottom (requested)
           * - Plus existing navbar/bottombar offsets + safe-area insets
           * - Inputs include scroll-margin
           * - Focus helper adjusts scroll (window OR nearest scroller)
           * --------------------------------------------------------- */

          .ca-safe-wrap {
            width: 100%;
            box-sizing: border-box;
          }

          .ca-safe-wrap[data-safe="1"] {
            /* HARD SAFETY: 0.5 inch top & bottom */
            padding-top: calc(
              0.5in + 10px + env(safe-area-inset-top) + max(var(--navbar-h, var(--nav-h, 96px)), 72px)
            );
            padding-bottom: calc(
              0.5in + 14px + env(safe-area-inset-bottom) +
                max(var(--bottom-floating-h, 0px), var(--bfbar-h, 0px), var(--bottom-safe-pad, 120px))
            );

            /* Keep scrollIntoView behavior consistent when this wrapper is inside a scroller */
            scroll-padding-top: calc(
              0.5in + 10px + env(safe-area-inset-top) + max(var(--navbar-h, var(--nav-h, 96px)), 72px)
            );
            scroll-padding-bottom: calc(
              0.5in + 14px + env(safe-area-inset-bottom) +
                max(var(--bottom-floating-h, 0px), var(--bfbar-h, 0px), var(--bottom-safe-pad, 120px))
            );
          }

          @supports (height: 100dvh) {
            .ca-safe-wrap {
              min-height: 100dvh;
            }
          }

          .ca-form {
            width: min(1320px, 100%);
            margin-left: auto;
            margin-right: auto;

            display: grid;
            gap: 6px;

            padding: 10px 12px;

            align-content: start;
            box-sizing: border-box;
            max-width: 100%;
            overflow-x: clip;

            scroll-margin-top: 16px;
            scroll-margin-bottom: 16px;
          }

          .ca-title {
            font-weight: 900;
            color: ${NAVY};
            font-size: 15px;
            line-height: 1.2;
            letter-spacing: 0.02em;
          }
          .ca-sub {
            color: ${MUTED};
            font-weight: 700;
            font-size: 12.5px;
            line-height: 1.25;
            margin-top: -4px;
          }
          .ca-error {
            background: #fff1f2;
            border: 1px solid #fecdd3;
            color: #9f1239;
            border-radius: 14px;
            padding: 9px 11px;
            font-weight: 800;
            font-size: 12.5px;
            line-height: 1.25;
          }

          .ca-type {
            border: 1px solid rgba(223, 227, 236, 0.95);
            border-radius: 14px;
            padding: 10px 12px;
            background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
            box-shadow: 0 10px 22px rgba(15, 33, 71, 0.06);
          }
          .ca-type-label {
            color: ${NAVY};
            font-weight: 900;
            font-size: 10.5px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            opacity: 0.92;
            margin-bottom: 8px;
          }
          .ca-type-row {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }
          .ca-type-btn {
            height: 36px;
            padding: 0 16px;
            border-radius: 9999px;
            border: 1px solid rgba(223, 227, 236, 0.95);
            background: #fff;
            color: ${NAVY};
            font-weight: 900;
            font-size: 13px;
            box-shadow: 0 10px 18px rgba(15, 33, 71, 0.06);
            cursor: pointer;
            touch-action: manipulation;
          }
          .ca-type-btn.on {
            border: 0;
            background: linear-gradient(135deg, #0f2147 0%, #0ea5e9 100%);
            color: #fff;
            box-shadow: 0 16px 34px rgba(15, 33, 71, 0.18),
              inset 0 1px 0 rgba(255, 255, 255, 0.18);
          }

          .ca-grid {
            display: grid;
            gap: 6px;
            align-items: start;
            min-width: 0;
          }
          .ca-grid.cols3 {
            grid-template-columns: repeat(3, minmax(180px, 1fr));
          }
          .ca-grid.cols4 {
            grid-template-columns: repeat(4, minmax(160px, 1fr));
          }

          .ca-span4 {
            grid-column: span 4;
          }

          .ca-field {
            display: grid;
            gap: 4px;
            min-width: 0;
          }
          .ca-field label {
            color: ${NAVY};
            font-weight: 900;
            font-size: 10.5px;
            line-height: 1.1;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            opacity: 0.92;
          }

          .req {
            color: #dc2626;
            font-weight: 900;
          }

          .ca-field.invalid label {
            color: #dc2626;
            opacity: 1;
          }
          .ca-field.invalid input,
          .ca-field.invalid select,
          .ca-field.invalid textarea {
            border-color: #dc2626 !important;
            box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.14) !important;
          }

          .ca-field input,
          .ca-field select {
            height: 40px;
            border: 1px solid rgba(223, 227, 236, 0.95);
            border-radius: 14px;
            padding: 0 14px;
            font-weight: 800;
            font-size: 13px;
            color: ${NAVY};
            outline: none;

            background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
            box-shadow: inset 0 2px 8px rgba(15, 33, 71, 0.08),
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 10px 22px rgba(15, 33, 71, 0.06);
            transition: box-shadow 150ms ease, border-color 150ms ease, transform 120ms ease;
            box-sizing: border-box;
            width: 100%;
            min-width: 0;
            max-width: 100%;

            /* Add HARD 0.5in buffer into scroll positioning */
            scroll-margin-top: calc(0.5in + 16px + var(--navbar-h, 96px) + env(safe-area-inset-top));
            scroll-margin-bottom: calc(
              0.5in + 16px +
                max(var(--bottom-floating-h, 0px), var(--bfbar-h, 0px), var(--bottom-safe-pad, 120px)) +
                env(safe-area-inset-bottom)
            );
          }

          /* Blink-safe autofill paint (Chrome/WebKit) */
          .ca-field input:-webkit-autofill,
          .ca-field input:-webkit-autofill:hover,
          .ca-field input:-webkit-autofill:focus,
          .ca-field select:-webkit-autofill,
          .ca-field select:-webkit-autofill:hover,
          .ca-field select:-webkit-autofill:focus {
            -webkit-text-fill-color: ${NAVY};
            box-shadow: 0 0 0px 1000px #ffffff inset,
              inset 0 2px 8px rgba(15, 33, 71, 0.08),
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 10px 22px rgba(15, 33, 71, 0.06);
            transition: background-color 9999s ease-in-out 0s;
          }

          .ca-field input::placeholder {
            color: rgba(107, 114, 128, 0.82);
            font-weight: 700;
            letter-spacing: 0.01em;
          }

          .ca-field input:focus,
          .ca-field select:focus {
            border-color: rgba(15, 33, 71, 0.38);
            box-shadow: inset 0 2px 9px rgba(15, 33, 71, 0.1),
              0 0 0 4px rgba(14, 165, 233, 0.14),
              0 12px 26px rgba(15, 33, 71, 0.1);
            transform: translateY(-0.5px);
          }

          .ca-morebtn {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            width: 100%;
            border: 1px solid rgba(223, 227, 236, 0.95);
            background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
            border-radius: 14px;
            padding: 9px 12px;
            color: ${NAVY};
            font-weight: 900;
            font-size: 12.5px;
            box-shadow: 0 10px 22px rgba(15, 33, 71, 0.06);
            cursor: pointer;
            user-select: none;
            touch-action: manipulation;
          }
          .ca-morebtn .t {
            letter-spacing: 0.01em;
          }
          .ca-morebtn .i {
            opacity: 0.7;
            font-size: 14px;
            line-height: 1;
          }
          .ca-morebtn:active {
            transform: translateY(0.5px);
          }

          .ca-optional {
            display: grid;
            gap: 6px;
            padding-top: 2px;
          }

          .chk {
            display: flex;
            align-items: center;
            gap: 10px;
            color: ${NAVY};
            font-weight: 900;
            font-size: 12.5px;
            margin-top: 2px;
          }

          .ca-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            padding-top: 2px;
            flex-wrap: wrap;
          }
          .ca-btn {
            height: 40px;
            border-radius: 9999px;
            font-weight: 900;
            padding: 0 18px;
            border: 1px solid ${BORDER};
            background: #fff;
            color: ${NAVY};
            font-size: 13px;
            box-shadow: 0 10px 18px rgba(15, 33, 71, 0.06);
            transition: transform 120ms ease, box-shadow 150ms ease;
            max-width: 100%;
            touch-action: manipulation;
          }
          .ca-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 14px 26px rgba(15, 33, 71, 0.1);
          }
          .ca-btn:active {
            transform: translateY(0px);
            box-shadow: 0 10px 18px rgba(15, 33, 71, 0.08);
          }
          .ca-btn.primary {
            border: 0;
            background: linear-gradient(135deg, #0f2147 0%, #0ea5e9 100%);
            color: #fff;
            box-shadow: 0 16px 34px rgba(15, 33, 71, 0.18),
              inset 0 1px 0 rgba(255, 255, 255, 0.18);
          }
          .ca-btn.ghost {
            background: #fff;
            border: 1px solid ${BORDER};
          }

          @media (max-width: 1024px) {
            .ca-form {
              width: min(980px, 100%);
              padding: 10px 12px;
            }

            .ca-grid.cols4,
            .ca-grid.cols3 {
              grid-template-columns: repeat(2, minmax(160px, 1fr));
            }
            .ca-span4 {
              grid-column: span 2;
            }
          }

          @media (max-width: 640px) {
            .ca-safe-wrap[data-safe="1"] {
              /* keep 0.5in buffer even on mobile; only fallback navbar height changes */
              padding-top: calc(0.5in + 8px + env(safe-area-inset-top) + var(--navbar-h, 84px));
              padding-bottom: calc(
                0.5in + 14px + env(safe-area-inset-bottom) +
                  max(var(--bottom-floating-h, 0px), var(--bfbar-h, 0px), var(--bottom-safe-pad, 120px))
              );
            }

            .ca-form {
              padding: 10px 10px;
            }

            .ca-title {
              font-size: 14px;
            }
            .ca-sub {
              font-size: 12px;
            }
            .ca-error {
              font-size: 12px;
              padding: 9px 10px;
            }

            .ca-field label {
              font-size: 10px;
              letter-spacing: 0.11em;
            }

            .ca-field input,
            .ca-field select {
              height: 36px;
              border-radius: 13px;
              padding: 0 12px;
              font-size: 12.5px;
            }

            .ca-morebtn {
              padding: 8px 11px;
              font-size: 12.25px;
            }

            .chk {
              font-size: 12px;
            }

            .ca-actions {
              gap: 8px;
              justify-content: stretch;
            }
            .ca-btn {
              height: 38px;
              font-size: 12.5px;
              padding: 0 14px;
              flex: 1 1 160px;
            }
          }

          @media (max-width: 420px) {
            .ca-grid.cols4,
            .ca-grid.cols3 {
              grid-template-columns: 1fr;
            }
            .ca-span4 {
              grid-column: span 1;
            }

            .ca-btn {
              flex: 1 1 auto;
              width: 100%;
            }
          }
        `}</style>
      </form>
    </div>
  );
}
