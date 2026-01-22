"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddressForm from "./address-form";
import AddressBlock from "./address-block";

/** Prefer canonical palette from the shared checkout module (single source). */
import { BORDER, NAVY, MUTED } from "./checkout.addressbook";

/* ───────────────── utils ───────────────── */

async function fetchJSON(url, init) {
  const r = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });

  const ct = r.headers.get("content-type") || "";
  const isJson = ct.includes("json");
  const body = isJson ? await r.json().catch(() => ({})) : await r.text();

  if (!r.ok) {
    const msg = isJson ? body?.error || body?.message : body;
    throw new Error(msg || `HTTP ${r.status}`);
  }
  return body;
}

function pickArrayFromResponse(j) {
  if (!j) return [];
  if (Array.isArray(j?.addresses)) return j.addresses;
  if (Array.isArray(j?.data)) return j.data;
  if (Array.isArray(j?.items)) return j.items;
  if (Array.isArray(j)) return j;
  return [];
}

function normalizeList(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return list
    .filter(Boolean)
    .map((x, i) => ({
      ...x,
      id: x.id ?? x._id ?? x.uuid ?? `addr_${i}`,
      isDefault: !!x.isDefault,
    }));
}

function needsOtpFromErrorMessage(msg = "") {
  const m = String(msg || "").trim();
  if (!m) return false;
  const codes = [
    "OTP_CODE_REQUIRED",
    "OTP_IDENTIFIER_PHONE_REQUIRED",
    "OTP_NOT_FOUND_OR_EXPIRED",
    "OTP_MISMATCH",
    "OTP_PURPOSE_INVALID",
    "PHONE_VERIFICATION_REQUIRED",
  ];
  return codes.some((c) => m.includes(c));
}

/* ───────────────── Canonical Address CRUD API (single source) ─────────────────
   Matches your saved conventions:
   - base: /api/customers/address-book
   - id routes: /api/customers/address-book/[id]
*/
const AddressAPI = {
  async list() {
    const j = await fetchJSON("/api/customers/address-book");
    return normalizeList(pickArrayFromResponse(j));
  },

  async create(payload) {
    return fetchJSON("/api/customers/address-book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },

  async update(id, payload) {
    return fetchJSON(`/api/customers/address-book/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },

  async remove(id, payload) {
    return fetchJSON(`/api/customers/address-book/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  },
};

/* ───────────────── OTP request (mutation consumes OTP) ───────────────── */
async function requestOtp(identifier, channel = "sms", purpose = "address_update") {
  const res = await fetch("/api/auth/request-otp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, purpose, channel }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || "OTP send failed");
  return Number(j?.ttlSeconds || j?.ttl || 90) || 90;
}

function purposeLabel(purpose) {
  switch (purpose) {
    case "address_create":
      return "Address creation verification";
    case "address_delete":
      return "Address deletion verification";
    case "address_update":
    default:
      return "Address update verification";
  }
}

/* ───────────────── Component ───────────────── */
export default function AddressPicker({
  onSelectedAddress,
  defaultProfile, // { name, phone, email, phoneVerified }
  type = "shipping", // "shipping" | "billing"
}) {
  /** IMPORTANT: must match checkout-page.js + clear helpers */
  const LS_SEL_KEY = useMemo(() => {
    return type === "billing" ? "checkout_address_billing" : "checkout_address_shipping";
  }, [type]);

  const [items, setItems] = useState([]);
  const [selId, setSelId] = useState(null);

  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");

  // OTP state (promise-based)
  const [otpAsk, setOtpAsk] = useState({
    open: false,
    identifier: "",
    channel: "sms",
    ttl: 90,
    purpose: "address_update",
  });
  const [otpCode, setOtpCode] = useState("");
  const otpResolverRef = useRef(null);

  const lockScrollRef = useRef({ prev: "" });

  const getDefaultIdentifier = useCallback(() => {
    const phone = String(defaultProfile?.phone || "").trim();
    return phone || "";
  }, [defaultProfile?.phone]);

  const computePhoneVerified = useCallback(
    (a) => {
      const samePhone = !!a?.phone && a.phone === (defaultProfile?.phone || "");
      return !!defaultProfile?.phoneVerified || samePhone || !!a?.phoneVerifiedAt;
    },
    [defaultProfile?.phone, defaultProfile?.phoneVerified]
  );

  const emitSelected = useCallback(
    (a) => {
      if (!a) return;

      const phoneVerified = computePhoneVerified(a);
      const payload = {
        ...a,
        phoneVerified,
        // normalize type for downstream consumers that rely on it
        type: a?.type || (type === "billing" ? "BILLING" : "SHIPPING"),
      };

      onSelectedAddress?.(payload);
      try {
        localStorage.setItem(LS_SEL_KEY, JSON.stringify(payload));
      } catch {}
    },
    [LS_SEL_KEY, computePhoneVerified, onSelectedAddress, type]
  );

  const hydrate = useCallback(async () => {
    setErr("");

    // fast selection rehydrate (instant; then validate against fetched list)
    let storedSelId = null;
    try {
      const raw = localStorage.getItem(LS_SEL_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.id) storedSelId = String(saved.id);
      }
    } catch {}

    const list = await AddressAPI.list();
    setItems(list);

    let chosen = null;

    if (storedSelId && list.some((x) => String(x.id) === storedSelId)) {
      chosen = list.find((x) => String(x.id) === storedSelId);
    } else {
      chosen = list.find((a) => a.isDefault) || list[0] || null;
    }

    if (chosen) {
      setSelId(chosen.id);
      emitSelected(chosen);
    } else {
      setSelId(null);
      try {
        localStorage.removeItem(LS_SEL_KEY);
      } catch {}
      onSelectedAddress?.(null);
    }
  }, [LS_SEL_KEY, emitSelected, onSelectedAddress]);

  useEffect(() => {
    hydrate().catch(() => setErr("Could not load addresses."));
  }, [hydrate]);

  /* ───────────────── modal ghosting control ───────────────── */
  useEffect(() => {
    if (!open) return;

    // lock html scroll
    const prev = document.documentElement.style.overflow;
    lockScrollRef.current.prev = prev;
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = lockScrollRef.current.prev || "";
    };
  }, [open]);

  function openAdd() {
    setEditing(null);
    setOpen(true);
    setErr("");
  }

  function openEdit(a) {
    const merged = {
      ...a,
      // ensure user identity fields are present for unified form experience
      name: a.name || defaultProfile?.name || "",
      email: a.email || defaultProfile?.email || "",
      phone: a.phone || defaultProfile?.phone || "",
      phoneVerified: computePhoneVerified(a),

      // ensure UI aliases exist for AddressForm (which accepts both DB + UI shapes)
      streetAddress: a.streetAddress || a.address1 || a.line1 || "",
      address2: a.address2 || a.line2 || "",
      countryIso2: (a.countryIso2 || a.country || "BD").toUpperCase(),
      postalCode: a.postalCode || a.postcode || "",
      // keep type explicit
      type: a?.type || (type === "billing" ? "BILLING" : "SHIPPING"),
    };

    setEditing(merged);
    setOpen(true);
    setErr("");
  }

  async function promptOtp({ purpose = "address_update" } = {}) {
    setErr("");
    setOtpCode("");

    const identifier = getDefaultIdentifier();
    if (!identifier) {
      setErr("Phone verification is required to update/delete addresses.");
      return null;
    }

    const channel = "sms";
    try {
      const ttl = await requestOtp(identifier, channel, purpose);
      setOtpAsk({ open: true, identifier, channel, ttl, purpose });

      return await new Promise((resolve) => {
        otpResolverRef.current = resolve;
      });
    } catch (e) {
      setErr(e?.message || "Could not send OTP.");
      return null;
    }
  }

  function resolveOtp(value) {
    if (otpResolverRef.current) {
      otpResolverRef.current(value);
      otpResolverRef.current = null;
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
    resolveOtp(null);
  }

  function handleOtpConfirm() {
    if (otpCode.length !== 6) {
      setErr("Enter the 6-digit code.");
      return;
    }
    const code = String(otpCode || "").trim();
    setOtpAsk({
      open: false,
      identifier: "",
      channel: "sms",
      ttl: 90,
      purpose: "address_update",
    });
    setOtpCode("");
    resolveOtp(code);
  }

  /* Save aligned to backend:
     - UPDATE: prompt OTP, then update with otp payload (secure).
     - CREATE: attempt no-OTP first; if backend requires, prompt OTP then retry.
  */
  async function saveAddress(payload) {
    setErr("");

    const isEdit = !!payload?.id;
    const purpose = isEdit ? "address_update" : "address_create";

    // Ensure type is preserved for downstream behavior
    const withType = {
      ...payload,
      type: payload?.type || (type === "billing" ? "BILLING" : "SHIPPING"),
    };

    try {
      if (isEdit) {
        const code = await promptOtp({ purpose });
        if (!code) return false;

        const identifier = getDefaultIdentifier();
        await AddressAPI.update(withType.id, {
          ...withType,
          otp: { identifier, code, purpose },
        });
      } else {
        try {
          await AddressAPI.create(withType);
        } catch (e) {
          if (!needsOtpFromErrorMessage(e?.message)) throw e;

          const code = await promptOtp({ purpose });
          if (!code) return false;

          const identifier = getDefaultIdentifier();
          await AddressAPI.create({
            ...withType,
            otp: { identifier, code, purpose },
          });
        }
      }

      await hydrate();
      setOpen(false);
      setEditing(null);
      return true;
    } catch (e) {
      const msg = e?.message || "Could not save address.";
      if (msg.includes("OTP_NOT_FOUND_OR_EXPIRED")) {
        setErr("This code expired. Please request a new one and try again.");
      } else if (msg.includes("OTP_MISMATCH")) {
        setErr("That code didn’t match. Please try again.");
      } else {
        setErr(msg);
      }
      return false;
    }
  }

  /* Delete aligned to backend:
     - Try without OTP for non-default (if backend allows).
     - If backend requires OTP or deleting default => prompt OTP and retry.
  */
  async function removeAddress(a) {
    setErr("");
    if (!a?.id) return;

    const purpose = "address_delete";

    try {
      if (a.isDefault) {
        const code = await promptOtp({ purpose });
        if (!code) return;

        const identifier = getDefaultIdentifier();
        await AddressAPI.remove(a.id, { otp: { identifier, code, purpose } });
      } else {
        try {
          await AddressAPI.remove(a.id, {});
        } catch (e) {
          if (!needsOtpFromErrorMessage(e?.message)) throw e;

          const code = await promptOtp({ purpose });
          if (!code) return;

          const identifier = getDefaultIdentifier();
          await AddressAPI.remove(a.id, { otp: { identifier, code, purpose } });
        }
      }

      await hydrate();
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
            <button className="btn" onClick={openAdd} type="button">
              Add address
            </button>
          </div>
        ) : (
          <>
            {items.map((a) => (
              <AddressBlock
                key={a.id}
                addr={a}
                selected={selId === a.id}
                onSelect={() => {
                  setSelId(a.id);
                  emitSelected(a);
                }}
                onEdit={openEdit}
                onDelete={removeAddress}
              />
            ))}

            <div>
              <button onClick={openAdd} className="btn mt-2" type="button">
                + Add new address
              </button>
            </div>
          </>
        )}
      </div>

      {/* Modal: Address editor (uses the SINGLE canonical AddressForm) */}
      {open && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            // click outside closes (prevents stuck overlays)
            if (e.target === e.currentTarget) {
              setOpen(false);
              setEditing(null);
            }
          }}
        >
          <div className="sheet">
            <div className="sheet-head">
              <div className="title">{editing?.id ? "Edit address" : "Add address"}</div>
              <button
                type="button"
                className="x"
                aria-label="Close"
                onClick={() => {
                  setOpen(false);
                  setEditing(null);
                }}
              >
                ×
              </button>
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

      {/* Inline OTP dialog (mutation consumes OTP; no separate verify endpoint) */}
      {otpAsk.open && (
        <div className="otp-overlay" role="dialog" aria-modal="true">
          <div className="otp-sheet">
            <div className="otp-head">
              <div className="otp-ttl">Verify change</div>
              <button
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
                {purposeLabel(otpAsk.purpose)} — we sent a 6-digit code to{" "}
                <b>{otpAsk.identifier}</b>.
              </div>

              <input
                className="otp-input"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                inputMode="numeric"
                autoFocus
              />

              <div className="otp-actions">
                <button
                  className="otp-submit"
                  disabled={otpCode.length !== 6}
                  type="button"
                  onClick={handleOtpConfirm}
                >
                  Continue
                </button>

                <button
                  className="otp-resend"
                  type="button"
                  onClick={async () => {
                    try {
                      setErr("");
                      const ttl = await requestOtp(
                        otpAsk.identifier,
                        otpAsk.channel || "sms",
                        otpAsk.purpose
                      );
                      setOtpAsk((s) => ({ ...s, ttl: ttl || 90 }));
                    } catch (e) {
                      setErr(e?.message || "Could not resend OTP.");
                    }
                  }}
                >
                  Resend
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .picker {
          width: 100%;
        }

        .err {
          color: #dc2626;
          font-weight: 800;
          margin-bottom: 8px;
        }

        .grid {
          display: grid;
          gap: 14px;
        }

        .empty {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn {
          height: 42px;
          padding: 0 14px;
          border-radius: 12px;
          font-weight: 900;
          color: #fff;
          background: ${NAVY};
          border: 1px solid ${NAVY};
          cursor: pointer;
        }

        .mt-2 {
          margin-top: 8px;
        }

        /* Modal */
        .modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 5000;
          padding: 12px;
          overscroll-behavior: contain;
        }

        .sheet {
          width: 760px;
          max-width: calc(100% - 24px);
          background: #fff;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          overflow: hidden;
          box-shadow: 0 16px 40px rgba(15, 33, 71, 0.25);
          max-height: calc(
            100vh -
              (env(safe-area-inset-top) + var(--navbar-h, 96px)) -
              (env(safe-area-inset-bottom) +
                max(var(--bottom-floating-h, 0px), var(--bottom-safe-pad, 84px))) -
              24px
          );
          display: flex;
          flex-direction: column;
        }

        .sheet-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid ${BORDER};
          flex: 0 0 auto;
        }

        .title {
          font-weight: 900;
          color: ${NAVY};
        }

        .x {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 20px;
          cursor: pointer;
          color: ${NAVY};
        }

        .sheet-body {
          padding: 16px;
          overflow: auto;
          flex: 1 1 auto;
        }

        /* OTP */
        .otp-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.38);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 6000;
          padding: 14px;
          overscroll-behavior: contain;
        }

        .otp-sheet {
          width: min(460px, 92vw);
          background: #fff;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          box-shadow: 0 16px 40px rgba(15, 33, 71, 0.25);
          max-height: calc(
            100vh -
              (env(safe-area-inset-top) + var(--navbar-h, 96px)) -
              (env(safe-area-inset-bottom) +
                max(var(--bottom-floating-h, 0px), var(--bottom-safe-pad, 84px))) -
              24px
          );
          display: flex;
          flex-direction: column;
        }

        .otp-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid ${BORDER};
          flex: 0 0 auto;
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
          color: ${NAVY};
        }

        .otp-body {
          padding: 16px;
          display: grid;
          gap: 10px;
          overflow: auto;
          flex: 1 1 auto;
        }

        .otp-line {
          color: ${NAVY};
          font-weight: 750;
        }

        .otp-input {
          height: 54px;
          border: 1px solid ${BORDER};
          border-radius: 14px;
          font-size: 22px;
          text-align: center;
          letter-spacing: 8px;
          outline: none;
        }

        .otp-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .otp-submit {
          flex: 1;
          min-width: 160px;
          height: 46px;
          border-radius: 12px;
          background: ${NAVY};
          color: #fff;
          font-weight: 900;
          border: 0;
          cursor: pointer;
        }

        .otp-submit:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .otp-resend {
          height: 46px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          color: ${NAVY};
          font-weight: 900;
          cursor: pointer;
        }

        @media (max-width: 520px) {
          .sheet-body {
            padding: 12px;
          }
          .btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
