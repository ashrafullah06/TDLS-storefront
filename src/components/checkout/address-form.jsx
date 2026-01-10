// FILE: src/components/checkout/address-form.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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

/* ---------------- lightweight remember + suggestions (localStorage) ---------------- */
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

function readDraft() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(DRAFT_KEY);
  return raw ? safeParse(raw, null) : null;
}

function writeDraft(obj) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(obj || {}));
  } catch {}
}

function readHistory() {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(HIST_KEY);
  return raw ? safeParse(raw, {}) : {};
}

function writeHistory(obj) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIST_KEY, JSON.stringify(obj || {}));
  } catch {}
}

/* ---------------- Address Form ---------------- */
export default function AddressForm({
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
  onDraftChange,
  validateSignal = 0,
}) {
  const [vals, setVals] = useState(() => {
    const draft = readDraft();
    const p = (prefill && typeof prefill === "object") ? prefill : {};
    return {
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

      ...(draft && typeof draft === "object" ? draft : {}),
      ...(p && typeof p === "object" ? p : {}),
    };
  });

  const [history, setHistory] = useState(() => readHistory());

  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const lastDraftSigRef = useRef("");
  const saveTimerRef = useRef(null);

  // common datalist suggestions (minimal but useful, plus user’s own history)
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

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  useEffect(() => {
    // Prefill can change frequently in some flows.
    // Merge only owned fields and avoid state update loops.
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

      for (const k of Object.keys(patch)) {
        if (patch[k] !== undefined) next[k] = patch[k];
      }

      next.countryIso2 = String(next.countryIso2 || "BD").toUpperCase();

      const owned = [
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

  // persist draft smoothly (debounced)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      writeDraft({
        ...vals,
        countryIso2: (vals.countryIso2 || "BD").toString().toUpperCase(),
        makeDefault: forceDefault ? true : !!vals.makeDefault,
      });
    }, 200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [vals, forceDefault]);

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

  function setField(k, v) {
    setVals((p) => ({ ...p, [k]: v }));
  }

  function isCompleteLocal(a) {
    const line1 = a.streetAddress || a.address1 || a.line1 || "";
    const city = a.upazila || a.city || "";
    const dist = a.district || a.state || "";
    const country = (a.countryIso2 || "BD").toString().toUpperCase();
    if (!line1.trim() || !city.trim() || !dist.trim() || !country.trim()) return false;
    return true;
  }

  useEffect(() => {
    if (typeof onDraftChange !== "function") return;

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

      // provide normalized variants for parent logic
      nameNormalized: nameNorm,
      phoneNormalized: phoneNorm,
      emailNormalized: emailNorm,

      countryIso2: (vals.countryIso2 || "BD").toString().toUpperCase(),
      makeDefault: forceDefault ? true : !!vals.makeDefault,
    };

    const phoneValid = !requirePhone || isValidBDMobile(phoneNorm);
    const userOk = !includeUserFields || (!!nameNorm && phoneValid);

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

  function rememberField(field, value) {
    const s = String(value || "").trim();
    if (!s) return;

    const next = {
      ...(history || {}),
      [field]: uniqPush(history?.[field] || [], s, 10),
    };
    setHistory(next);
    writeHistory(next);
  }

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

    // remember key fields for next checkout
    rememberField("streetAddress", street);
    rememberField("address2", vals.address2);
    rememberField("upazila", city);
    rememberField("district", dist);
    rememberField("division", vals.division);
    rememberField("postOffice", vals.postOffice);
    rememberField("policeStation", vals.policeStation);
    rememberField("union", vals.union);

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
    <form onSubmit={handleSubmit} className="ca-form">
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

      {includeUserFields ? (
        <div className="ca-grid">
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
              placeholder="Your full name"
              onBlur={() => rememberField("name", vals.name)}
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
              onBlur={(e) => {
                const n = normalizeBDPhone(e.target.value);
                if (n && n !== vals.phone) setField("phone", n);
                rememberField("phone", n || e.target.value);
              }}
              placeholder="017XXXXXXXX / +88017XXXXXXXX"
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
              placeholder="name@email.com"
              onBlur={() => rememberField("email", vals.email)}
            />
          </div>
        </div>
      ) : null}

      <div className="ca-grid">
        <div className="ca-field">
          <label>House No</label>
          <input
            name="houseNo"
            autoComplete="address-line1"
            value={vals.houseNo || ""}
            onChange={(e) => setField("houseNo", e.target.value)}
            placeholder="House No"
            onBlur={() => rememberField("houseNo", vals.houseNo)}
          />
        </div>
        <div className="ca-field">
          <label>House Name</label>
          <input
            name="houseName"
            value={vals.houseName || ""}
            onChange={(e) => setField("houseName", e.target.value)}
            placeholder="House Name"
            onBlur={() => rememberField("houseName", vals.houseName)}
          />
        </div>
        <div className="ca-field">
          <label>Apartment No</label>
          <input
            name="apartmentNo"
            value={vals.apartmentNo || ""}
            onChange={(e) => setField("apartmentNo", e.target.value)}
            placeholder="Apartment"
            onBlur={() => rememberField("apartmentNo", vals.apartmentNo)}
          />
        </div>
        <div className="ca-field">
          <label>Floor No</label>
          <input
            name="floorNo"
            value={vals.floorNo || ""}
            onChange={(e) => setField("floorNo", e.target.value)}
            placeholder="Floor"
            onBlur={() => rememberField("floorNo", vals.floorNo)}
          />
        </div>
      </div>

      <div className="ca-grid">
        <div className={`ca-field ca-span3${fieldErrors.streetAddress ? " invalid" : ""}`}>
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
            placeholder="Street / Road / Area"
            onBlur={() => rememberField("streetAddress", vals.streetAddress)}
          />
        </div>
        <div className="ca-field ca-span3">
          <label>Address line 2 (optional)</label>
          <input
            name="addressLine2"
            autoComplete="address-line2"
            autoCapitalize="words"
            value={vals.address2 || ""}
            onChange={(e) => setField("address2", e.target.value)}
            placeholder="Nearby landmark / extra details"
            onBlur={() => rememberField("address2", vals.address2)}
          />
        </div>
      </div>

      <div className="ca-grid">
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
            placeholder="Upazila / City"
            onBlur={() => rememberField("upazila", vals.upazila)}
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
            placeholder="District"
            onBlur={() => rememberField("district", vals.district)}
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
            placeholder="Division"
            onBlur={() => rememberField("division", vals.division)}
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
            placeholder="Postal code"
            onBlur={() => rememberField("postalCode", vals.postalCode)}
          />
        </div>
      </div>

      <div className="ca-grid">
        <div className="ca-field">
          <label>Post Office (optional)</label>
          <input
            name="postOffice"
            list="dl-po"
            autoCapitalize="words"
            value={vals.postOffice || ""}
            onChange={(e) => setField("postOffice", e.target.value)}
            placeholder="Post Office"
            onBlur={() => rememberField("postOffice", vals.postOffice)}
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
            placeholder="Union"
            onBlur={() => rememberField("union", vals.union)}
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
            placeholder="Police Station / Thana"
            onBlur={() => rememberField("policeStation", vals.policeStation)}
          />
        </div>
        <div className="ca-field">
          <label>Country</label>
          <select
            name="country"
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
        /* Center + widen the form, reduce vertical height */
        .ca-form {
          width: min(1180px, 100%);
          margin: 0 auto;
          display: grid;
          gap: 10px;

          padding: 10px 12px;
          padding-top: calc(10px + env(safe-area-inset-top));
          padding-bottom: calc(
            12px + env(safe-area-inset-bottom) + var(--bottom-floating-h, 0px)
          );

          align-content: start;
          box-sizing: border-box;
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
          padding: 10px 12px;
          font-weight: 800;
          font-size: 12.5px;
          line-height: 1.25;
        }

        /* Desktop: triple column, premium spacing, no clipping */
        .ca-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(160px, 1fr));
          gap: 10px;
          align-items: start;
        }
        .ca-span2 {
          grid-column: span 2;
        }
        .ca-span3 {
          grid-column: span 3;
        }

        .ca-field {
          display: grid;
          gap: 6px;
          min-width: 0;
        }
        .ca-field label {
          color: ${NAVY};
          font-weight: 900;
          font-size: 11px;
          line-height: 1.1;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0.92;
        }

        .req {
          color: #dc2626;
          font-weight: 900;
        }

        /* Invalid state */
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

        /* Deep-pond input style: inset shadows + soft depth + safe inner padding */
        .ca-field input,
        .ca-field select {
          height: 44px;
          border: 1px solid rgba(223, 227, 236, 0.95);
          border-radius: 14px;
          padding: 0 14px; /* safe distance from edges (your request) */
          font-weight: 800;
          font-size: 13px;
          color: ${NAVY};
          outline: none;

          background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
          box-shadow:
            inset 0 2px 8px rgba(15, 33, 71, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.9),
            0 10px 22px rgba(15, 33, 71, 0.06);
          transition: box-shadow 150ms ease, border-color 150ms ease, transform 120ms ease;
          box-sizing: border-box;
          width: 100%;
        }

        .ca-field input::placeholder {
          color: rgba(107, 114, 128, 0.82);
          font-weight: 700;
          letter-spacing: 0.01em;
        }

        .ca-field input:focus,
        .ca-field select:focus {
          border-color: rgba(15, 33, 71, 0.38);
          box-shadow:
            inset 0 2px 9px rgba(15, 33, 71, 0.10),
            0 0 0 4px rgba(14, 165, 233, 0.14),
            0 12px 26px rgba(15, 33, 71, 0.10);
          transform: translateY(-0.5px);
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
          gap: 10px;
          justify-content: flex-end;
          padding-top: 6px;
        }
        .ca-btn {
          height: 44px;
          border-radius: 9999px;
          font-weight: 900;
          padding: 0 18px;
          border: 1px solid ${BORDER};
          background: #fff;
          color: ${NAVY};
          font-size: 13px;
          box-shadow: 0 10px 18px rgba(15, 33, 71, 0.06);
          transition: transform 120ms ease, box-shadow 150ms ease;
        }
        .ca-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 26px rgba(15, 33, 71, 0.10);
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
          }
          .ca-grid {
            grid-template-columns: repeat(2, minmax(160px, 1fr));
          }
          .ca-span3 {
            grid-column: span 2;
          }
        }

        @media (max-width: 640px) {
          .ca-form {
            width: min(920px, 100%);
            padding: 10px 10px;
          }
          .ca-grid {
            grid-template-columns: repeat(2, minmax(140px, 1fr));
            gap: 10px;
          }
          .ca-span2,
          .ca-span3 {
            grid-column: span 2;
          }
        }

        @media (max-width: 420px) {
          .ca-grid {
            grid-template-columns: 1fr;
          }
          .ca-span2,
          .ca-span3 {
            grid-column: span 1;
          }
        }
      `}</style>
    </form>
  );
}
