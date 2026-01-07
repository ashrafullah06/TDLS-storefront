// src/components/common/address-form.jsx
"use client";

import React, { useState } from "react";

const NAVY = "#0f2147";
const BORDER = "#E6EAF4";
const SUBTEXT = "#6F7890";

export default function AddressForm({ prefill, onSubmit, requirePhone = true, loading }) {
  const [form, setForm] = useState(() => ({
    name: prefill?.name || "",
    email: prefill?.email || "",
    phone: prefill?.phone || prefill?.defaultAddress?.phone || "",
    address1: prefill?.defaultAddress?.address1 || "",
    address2: prefill?.defaultAddress?.address2 || "",
    city: prefill?.defaultAddress?.city || "",
    district: prefill?.defaultAddress?.district || "",
    upazila: prefill?.defaultAddress?.upazila || "",
    postcode: prefill?.defaultAddress?.postcode || "",
    country: prefill?.defaultAddress?.country || "BD",
  }));

  const update = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const submit = (e) => { e.preventDefault(); onSubmit(form); };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Full name"><Input value={form.name} onChange={update("name")} required /></Field>
      <Field label="Email (for updates)"><Input type="email" value={form.email} onChange={update("email")} placeholder="you@example.com" /></Field>

      <Field label="Mobile number" hint="Bangladesh format 01XXXXXXXXX (required for delivery & OTP)">
        <Input value={form.phone} onChange={update("phone")} inputMode="numeric" pattern="01[0-9]{9}" placeholder="01XXXXXXXXX" required={requirePhone} />
      </Field>
      <Field label="Postcode"><Input value={form.postcode} onChange={update("postcode")} inputMode="numeric" /></Field>

      <Field label="District"><Input value={form.district} onChange={update("district")} /></Field>
      <Field label="Upazila/Thana"><Input value={form.upazila} onChange={update("upazila")} /></Field>

      <Field label="City / Area"><Input value={form.city} onChange={update("city")} /></Field>
      <div className="sm:col-span-2"><Field label="Address line 1"><Input value={form.address1} onChange={update("address1")} required /></Field></div>
      <div className="sm:col-span-2"><Field label="Address line 2 (optional)"><Input value={form.address2} onChange={update("address2")} /></Field></div>

      <div className="sm:col-span-2 flex items-center gap-3 mt-2">
        <button type="submit" disabled={loading} className="font-semibold" style={{ height: 56, padding: "0 22px", borderRadius: 14, color: "#fff", background: NAVY, boxShadow: "0 18px 40px rgba(15,33,71,.18)" }}>
          {loading ? "Saving…" : "Save & Continue"}
        </button>
        <span className="text-sm" style={{ color: SUBTEXT }}>We never share your contact info.</span>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          height: 54px;
          border-radius: 16px;
          padding: 0 14px;
          border: 1px solid ${BORDER};
          background: #fff;
          outline: none;
          box-shadow:
            inset 0 3px 12px rgba(15,33,71,.06),
            0 0 0 0 rgba(15,33,71,0);
          transition: box-shadow .15s ease, border-color .15s ease;
        }
        .input:focus {
          border-color: ${NAVY};
          box-shadow:
            inset 0 3px 12px rgba(15,33,71,.06),
            0 0 0 6px ${NAVY}1F;
        }
      `}</style>
    </form>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 font-semibold" style={{ color: "#111827" }}>{label}</div>
      {children}
      {hint ? <div className="text-xs mt-1" style={{ color: "#6B7280" }}>{hint}</div> : null}
    </label>
  );
}
function Input(props) { return <input {...props} className="input" />; }
