//FILE 4: src/components/checkout/checkout.addressform.jsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BORDER,
  NAVY,
  MUTED,
  normalizeBDPhone,
  isValidBDMobile,
} from "./checkout.addressbook";

export default function CheckoutAddressForm({
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
  const lastDraftSigRef = useRef("");

  useEffect(() => {
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
        "name","phone","email","houseNo","houseName","apartmentNo","floorNo","streetAddress",
        "address2","village","postOffice","union","policeStation","upazila","district","division",
        "postalCode","countryIso2","makeDefault","label","id",
      ];

      for (const k of owned) {
        if (!Object.is(prev?.[k], next?.[k])) return next;
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(prefill || {})]);

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
      name: nameRaw,
      phone: phoneRaw,
      email: emailRaw,
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
    <form onSubmit={handleSubmit} className="ca-form">
      {title ? <div className="ca-title">{title}</div> : null}
      {subtitle ? <div className="ca-sub">{subtitle}</div> : null}
      {error ? <div className="ca-error">{error}</div> : null}

      {includeUserFields ? (
        <div className="ca-grid">
          <div className={`ca-field${fieldErrors.name ? " invalid" : ""}`}>
            <label>
              Full name <span className="req">*</span>
            </label>
            <input
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
            value={vals.houseNo || ""}
            onChange={(e) => setField("houseNo", e.target.value)}
            placeholder="House No"
          />
        </div>
        <div className="ca-field">
          <label>House Name</label>
          <input
            value={vals.houseName || ""}
            onChange={(e) => setField("houseName", e.target.value)}
            placeholder="House Name"
          />
        </div>
        <div className="ca-field">
          <label>Apartment No</label>
          <input
            value={vals.apartmentNo || ""}
            onChange={(e) => setField("apartmentNo", e.target.value)}
            placeholder="Apartment"
          />
        </div>
        <div className="ca-field">
          <label>Floor No</label>
          <input
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
            value={vals.streetAddress || vals.address1 || ""}
            onChange={(e) => setField("streetAddress", e.target.value)}
            placeholder="Street / Road / Area"
          />
        </div>
        <div className="ca-field ca-span2">
          <label>Address line 2 (optional)</label>
          <input
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
            value={vals.district || ""}
            onChange={(e) => setField("district", e.target.value)}
            placeholder="District"
          />
        </div>
        <div className="ca-field">
          <label>Division (optional)</label>
          <input
            value={vals.division || ""}
            onChange={(e) => setField("division", e.target.value)}
            placeholder="Division"
          />
        </div>
        <div className="ca-field">
          <label>Postal Code (optional)</label>
          <input
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
            value={vals.postOffice || ""}
            onChange={(e) => setField("postOffice", e.target.value)}
            placeholder="Post Office"
          />
        </div>
        <div className="ca-field">
          <label>Union (optional)</label>
          <input
            value={vals.union || ""}
            onChange={(e) => setField("union", e.target.value)}
            placeholder="Union"
          />
        </div>
        <div className="ca-field">
          <label>Police Station / Thana (optional)</label>
          <input
            value={vals.policeStation || vals.thana || ""}
            onChange={(e) => setField("policeStation", e.target.value)}
            placeholder="Police Station / Thana"
          />
        </div>
        <div className="ca-field">
          <label>Country</label>
          <select
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
