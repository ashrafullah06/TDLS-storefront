// FILE: src/components/checkout/address-picker.jsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import AddressForm from "./address-form";

/** Brand palette */
const NAVY = "#0F2147";
const BORDER = "#DFE3EC";
const MUTED = "#6B7280";

/* ───────────────── utils ───────────────── */
const titleCase = (s = "") =>
  s
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());

const compactLines = (a = {}) => {
  const first = [titleCase(a.name || ""), a.phone, (a.email || "").toLowerCase()]
    .filter(Boolean)
    .join(" • ");

  const l1 = [
    a.houseName,
    a.houseNo,
    a.apartmentNo,
    a.floorNo,
    a.line1 || a.address1 || a.streetAddress,
  ]
    .filter(Boolean)
    .map((x, i) => (i <= 3 ? titleCase(x) : x))
    .join(", ");

  const l2 = [a.line2 || a.address2, a.village, a.postOffice, a.union, a.policeStation]
    .filter(Boolean)
    .map(titleCase)
    .join(", ");

  const l3parts = [a.upazila || a.city, a.district || a.state];
  if (a.postalCode) l3parts.push(a.postalCode);
  l3parts.push((a.countryIso2 || a.country || "BD").toUpperCase());
  const l3 = l3parts
    .filter(Boolean)
    .map((x, idx) => (idx < l3parts.length - 1 ? titleCase(x) : x))
    .join(", ");

  return { first, l1, l2, l3 };
};

async function fetchJSON(url, init) {
  const r = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("json");
  const body = isJson ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw new Error((isJson ? body?.error || body?.message : body) || `HTTP ${r.status}`);
  return body;
}

/* ───────────────── Address CRUD API ─────────────────
   Tries multiple endpoints to remain compatible with existing backends. */
const AddressAPI = {
  async list() {
    const endpoints = ["/api/customers/address-book", "/api/account/addresses", "/api/addresses"];
    for (const u of endpoints) {
      try {
        const j = await fetchJSON(u);
        const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : j?.items || [];
        if (Array.isArray(arr)) {
          return arr.map((x, i) => ({

            ...x,
            id: x.id ?? x._id ?? x.uuid ?? `addr_${i}`,
            isDefault: !!(x.isDefault || x.default || x.primary),
          }));
        }
      } catch {
        /* try next */
      }
    }
    return [];
  },
  async create(payload) {
    return fetchJSON("/api/customers/address-book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async update(id, payload) {
    return fetchJSON(`/api/customers/address-book/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async remove(id) {
    // Try hard DELETE first
    try {
      return await fetchJSON(`/api/customers/address-book/${id}`, { method: "DELETE" });
    } catch (e) {
      // Soft delete fallback (archive)
      const archivedAt = new Date().toISOString();
      return await fetchJSON(`/api/customers/address-book/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archivedAt }),
      });
    }
  },
};

/* ───────────────── OTP helpers ─────────────────
   IMPORTANT: We follow your decision matrix:
   - For changing the existing mobile number or editing/deleting any address,
     the OTP must go to the DEFAULT/EXISTING verified contact (previous phone) or existing email.
   - We DO NOT send OTP to the new phone for verification of the change itself. */
async function requestOtp(identifier, channel = "sms", purpose = "address_update") {
  const res = await fetch("/api/request-otp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, purpose, channel }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || "OTP send failed");
  return j?.ttlSeconds || 90;
}

async function verifyOtp(identifier, code, purpose = "address_update") {
  const res = await fetch("/api/verify-otp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, code, purpose }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !(j?.ok || j?.verified)) {
    const errCode = j?.error;
    if (errCode === "OTP_NOT_FOUND_OR_EXPIRED") {
      throw new Error("This code has expired. Please request a new one.");
    }
    if (errCode === "OTP_MISMATCH") {
      throw new Error("That code didn’t match. Please try again.");
    }
    throw new Error(j?.error || "OTP verification failed.");
  }
  return true;
}

/* ───────────────── Component ───────────────── */
export default function AddressPicker({
  onSelectedAddress,
  defaultProfile, // { name, phone, email, phoneVerified }
  type = "shipping", // "shipping" | "billing"
}) {
  const [items, setItems] = useState([]);
  const [selId, setSelId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");

  // OTP state
  const [otpAsk, setOtpAsk] = useState({
    open: false,
    identifier: "",
    channel: "sms",
    ttl: 90,
    purpose: "address_update", // ✔ keep purpose so verify uses the same
  });
  const [otpCode, setOtpCode] = useState("");
  const otpResolverRef = useRef(null);

  // On mount: fetch list and rehydrate selected tile from localStorage first, fallback to default
  async function hydrate(initial = false) {
    setErr("");
    const list = await AddressAPI.list();
    setItems(list);

    let selectedFromStorage = null;
    try {
      const raw = localStorage.getItem(`checkout_${type}_address`);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.id && list.some((x) => x.id === saved.id)) {
          selectedFromStorage = list.find((x) => x.id === saved.id);
        }
      }
    } catch {}

    const chosen =
      selectedFromStorage || list.find((a) => a.isDefault) || list[0] || null;

    if (chosen) {
      setSelId(chosen.id);
      const samePhone =
        !!chosen.phone && chosen.phone === (defaultProfile?.phone || "");
      const payload = {
        ...chosen,
        phoneVerified: !!defaultProfile?.phoneVerified || samePhone,
      };
      onSelectedAddress?.(payload);
      try {
        localStorage.setItem(`checkout_${type}_address`, JSON.stringify(payload));
      } catch {}
    } else {
      setSelId(null);
    }
  }

  useEffect(() => {
    hydrate(true).catch(() => setErr("Could not load addresses."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() {
    setEditing(null);
    setOpen(true);
    setErr("");
  }
  function openEdit(a) {
    const merged = {
      ...a,
      name: a.name || defaultProfile?.name || "",
      email: a.email || defaultProfile?.email || "",
      phone: a.phone || defaultProfile?.phone || "",
      phoneVerified:
        !!defaultProfile?.phoneVerified || (a.phone && a.phone === defaultProfile?.phone),
      streetAddress: a.streetAddress || a.address1 || a.line1 || "",
      address2: a.address2 || a.line2 || "",
      countryIso2: (a.countryIso2 || a.country || "BD").toUpperCase(),
      postalCode: a.postalCode || a.postcode || "",
    };
    setEditing(merged);
    setOpen(true);
    setErr("");
  }

  /** Send OTP to the existing verified contact (phone → SMS, else email) and
   *  wait for the user to enter it. Purpose is important:
   *   - "address_update" when editing
   *   - "address_delete" when deleting
   */
  async function ensureOtpAgainstDefaultContact({
    preferPhone = true,
    purpose = "address_update",
  } = {}) {
    setErr("");
    setOtpCode("");

    const prevPhone = (defaultProfile?.phone || "").trim();
    const email = (defaultProfile?.email || "").trim();

    const identifier =
      (preferPhone && prevPhone) || prevPhone || email || ""; // fallback to email if no phone
    if (!identifier) {
      // No verified default contact → allow, backend may still enforce.
      return true;
    }

    const channel = identifier.includes("@") ? "email" : "sms";

    try {
      const ttl = await requestOtp(identifier, channel, purpose);
      setOtpAsk({
        open: true,
        identifier,
        channel,
        ttl,
        purpose, // ✔ carry the exact purpose forward
      });

      // Wait until user verifies or cancels
      return await new Promise((resolve) => {
        otpResolverRef.current = resolve;
      });
    } catch (e) {
      setErr(e?.message || "Could not send OTP.");
      return false;
    }
  }

  async function handleOtpVerify() {
    try {
      if (!otpAsk.identifier) {
        setErr("Missing verification target.");
        if (otpResolverRef.current) {
          otpResolverRef.current(false);
          otpResolverRef.current = null;
        }
        setOtpAsk({
          open: false,
          identifier: "",
          channel: "sms",
          ttl: 90,
          purpose: "address_update",
        });
        setOtpCode("");
        return;
      }
      if (otpCode.length !== 6) {
        setErr("Enter the 6-digit code.");
        return;
      }

      await verifyOtp(
        otpAsk.identifier,
        otpCode,
        otpAsk.purpose || "address_update"
      );

      // Success → close dialog and resolve true
      setOtpAsk({
        open: false,
        identifier: "",
        channel: "sms",
        ttl: 90,
        purpose: "address_update",
      });
      setOtpCode("");
      if (otpResolverRef.current) {
        otpResolverRef.current(true);
        otpResolverRef.current = null;
      }
    } catch (e) {
      setErr(e?.message || "OTP verification failed.");
    }
  }

  function handleOtpClose() {
    setOtpAsk({
      open: false,
      identifier: "",
      channel: "sms",
      ttl: 90,
      purpose: "address_update",
    });
    setOtpCode("");
    if (otpResolverRef.current) {
      otpResolverRef.current(false);
      otpResolverRef.current = null;
    }
  }

  /** Save (create/update) with mandatory OTP to default contact if changing number or any edit */
  async function saveAddress(payload) {
    setErr("");
    try {
      const isEdit = !!payload.id;

      // Normalize numbers for comparison (old vs new)
      const phoneBefore = (editing?.phone || defaultProfile?.phone || "").replace(/\s|-/g, "");
      const phoneAfter = (payload?.phone || "").replace(/\s|-/g, "");
      const changedPhone = !!phoneAfter && phoneAfter !== phoneBefore;

      if (isEdit || changedPhone) {
        const ok = await ensureOtpAgainstDefaultContact({
          preferPhone: true,
          purpose: "address_update",
        });
        if (!ok) return;
        if (changedPhone) payload.phoneVerified = true;
      }

      if (isEdit) await AddressAPI.update(payload.id, payload);
      else await AddressAPI.create(payload);

      await hydrate();
      setOpen(false);
      setEditing(null);
    } catch (e) {
      setErr(e?.message || "Could not save address.");
    }
  }

  /** Delete requires OTP to default phone/email */
  async function removeAddress(a) {
    setErr("");
    try {
      if (a.isDefault) {
        setErr("Set another address as default before deleting this one.");
        return;
      }
      const ok = await ensureOtpAgainstDefaultContact({
        preferPhone: true,
        purpose: "address_delete",
      });
      if (!ok) return;

      await AddressAPI.remove(a.id);
      await hydrate();
      if (selId === a.id) {
        setSelId(null);
        try {
          localStorage.removeItem(`checkout_${type}_address`);
        } catch {}
      }
    } catch (e) {
      setErr(e?.message || "Delete failed.");
    }
  }

  return (
    <div className="picker">
      {err ? <div className="err">{err}</div> : null}

      <div className="grid">
        {items.length === 0 ? (
          <div className="empty">
            <p>No saved addresses yet.</p>
            <button className="btn" onClick={openAdd}>
              Add address
            </button>
          </div>
        ) : (
          <>
            {items.map((a) => {
              const { first, l1, l2, l3 } = compactLines(a);
              const isDefault = !!a.isDefault;
              return (
                <div key={a.id} className={`tile ${isDefault ? "def" : ""}`}>
                  <div className="head">
                    <div className="badges">
                      {isDefault && <span className="pill default">Default</span>}
                      {isDefault && (
                        <span className="pill linked">Linked to your account</span>
                      )}
                    </div>
                    <div className="sel">
                      <input
                        type="radio"
                        name={`${type}-addr`}
                        checked={selId === a.id}
                        onChange={() => {
                          setSelId(a.id);
                          const samePhone =
                            !!a.phone && a.phone === (defaultProfile?.phone || "");
                          const payload = {
                            ...a,
                            phoneVerified: !!defaultProfile?.phoneVerified || samePhone,
                          };
                          onSelectedAddress?.(payload);
                          try {
                            localStorage.setItem(
                              `checkout_${type}_address`,
                              JSON.stringify(payload)
                            );
                          } catch {}
                        }}
                      />
                    </div>
                  </div>

                  <div className="who">
                    {first ? (
                      <div className="v">
                        <b>{first}</b>
                      </div>
                    ) : null}
                  </div>

                  <div className="addr">
                    {l1 ? (
                      <div className="v">
                        <b>{l1}</b>
                      </div>
                    ) : null}
                    {l2 ? (
                      <div className="v">
                        <b>{l2}</b>
                      </div>
                    ) : null}
                    {l3 ? (
                      <div className="v">
                        <b>{l3}</b>
                      </div>
                    ) : null}
                  </div>

                  <div className="row">
                    <div className="actions">
                      <button type="button" onClick={() => openEdit(a)} className="muted">
                        Edit
                      </button>
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={() => removeAddress(a)}
                          className="danger"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div>
              <button onClick={openAdd} className="btn mt-2">
                + Add new address
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modal: Address editor */}
      {open && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="sheet">
            <div className="sheet-head">
              <div className="title">{editing?.id ? "Edit address" : "Add address"}</div>
            </div>
            <div className="sheet-body">
              <AddressForm
                prefill={editing || {}}
                onSubmit={saveAddress}
                onCancel={() => {
                  setOpen(false);
                  setEditing(null);
                }}
                submitLabel={editing?.id ? "Save changes" : "Save"}
                showMakeDefault
                includeUserFields
                requirePhone
              />
            </div>
          </div>
        </div>
      )}

      {/* Inline OTP dialog (no navbar popups) */}
      {otpAsk.open && (
        <div className="otp-overlay">
          <div className="otp-sheet">
            <div className="otp-head">
              <div className="otp-ttl">Verify change</div>
              <button
                id="otp-close-btn"
                className="otp-x"
                aria-label="Close"
                type="button"
                onClick={handleOtpClose}
              >
                ×
              </button>
            </div>
            <div className="otp-body">
              <div className="otp-line">
                For your security, we sent a 6-digit code to{" "}
                <b>{otpAsk.identifier}</b> via{" "}
                <b>{otpAsk.channel === "email" ? "email" : "SMS"}</b>.
              </div>
              <input
                className="otp-input"
                value={otpCode}
                onChange={(e) =>
                  setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="••••••"
                inputMode="numeric"
                autoFocus
              />
              <button
                id="otp-ok-btn"
                className="otp-submit"
                disabled={otpCode.length !== 6}
                type="button"
                onClick={handleOtpVerify}
              >
                Verify
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .err {
          color: #dc2626;
          font-weight: 800;
          margin-bottom: 8px;
        }

        .grid {
          display: grid;
          gap: 18px;
        }
        .empty {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .btn {
          height: 40px;
          padding: 0 14px;
          border-radius: 12px;
          font-weight: 900;
          color: #fff;
          background: ${NAVY};
          border: 1px solid ${NAVY};
        }

        .tile {
          border: 1px solid ${BORDER};
          border-radius: 18px;
          padding: 18px;
          background: linear-gradient(180deg, #fff 0%, #fafbff 100%);
          box-shadow: 0 8px 24px rgba(15, 33, 71, 0.06);
        }
        .tile.def {
          outline: 2px solid rgba(15, 33, 71, 0.08);
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .badges {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pill {
          font-weight: 800;
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 999px;
          border: 1px solid ${BORDER};
          background: #fff;
          color: ${NAVY};
        }
        .pill.default {
          background: #eef2ff;
          color: #3730a3;
          border-color: #c7d2fe;
        }
        .pill.linked {
          background: #ecfdf5;
          color: #065f46;
          border-color: #a7f3d0;
        }

        .who .v,
        .addr .v {
          color: ${NAVY};
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 12px;
        }
        .actions {
          display: flex;
          gap: 10px;
        }
        .muted {
          border: 1px solid ${BORDER};
          background: #fff;
          color: ${NAVY};
          padding: 8px 12px;
          border-radius: 12px;
          font-weight: 800;
        }
        .danger {
          background: #fff;
          color: #b91c1c;
          border: 1px solid #fca5a5;
          padding: 8px 12px;
          border-radius: 12px;
          font-weight: 800;
        }

        .modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
        }
        .sheet {
          width: 760px;
          max-width: calc(100% - 32px);
          background: #fff;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(15, 33, 71, 0.25);
        }
        .sheet-head {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          border-bottom: 1px solid ${BORDER};
        }
        .title {
          font-weight: 800;
          color: ${NAVY};
        }
        .sheet-body {
          padding: 16px;
        }

        .otp-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.38);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 70;
          padding: 14px;
        }
        .otp-sheet {
          width: min(460px, 92vw);
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
        }
        .otp-input {
          height: 54px;
          border: 1px solid ${BORDER};
          border-radius: 14px;
          font-size: 22px;
          text-align: center;
          letter-spacing: 8px;
        }
        .otp-submit {
          height: 46px;
          border-radius: 12px;
          background: ${NAVY};
          color: #fff;
          font-weight: 900;
        }
      `}</style>
    </div>
  );
}
