//FILE: src/components/checkout/address-block.jsx
"use client";

import React, { useMemo } from "react";
import { BORDER, NAVY, MUTED } from "./checkout.addressbook";

/**
 * AddressBlock (TDLS)
 * -----------------------------------------------------------------------------
 * PURPOSE
 * - Pure display + action triggers (Select / Edit / Delete)
 * - Keyboard-accessible (Enter/Space selects)
 * - Defensive against partial/missing fields
 *
 * IMPORTANT COMPATIBILITY NOTES
 * - This component must NOT enforce business rules that the parent already handles.
 *   Example: default-address deletion is handled by the parent (OTP + backend rules).
 *   Therefore, Delete is NOT hard-blocked here.
 *
 * Props:
 *  - addr: Address object
 *  - selected: boolean
 *  - onSelect(): void
 *  - onEdit(addr): void        (preferred; parent opens modal / AddressForm / OTP)
 *  - onDelete(addr): void      (preferred; parent handles OTP + API)
 *
 * LEGACY (supported only if onEdit not provided):
 *  - getOtp: () => Promise<{ code:string, identifier:string, purpose?:string }>
 *  - buildUpdatePayload: (addr) => any
 *  - onRefresh: (result) => void
 *  - apiOrigin?: string (optional; defaults to window.location.origin)
 */

export default function AddressBlock({
  addr = {},
  selected = false,
  onSelect,
  onDelete,
  onEdit,

  /** LEGACY OTP-based edit flow (avoid if possible) */
  getOtp,
  buildUpdatePayload,
  onRefresh,

  /** optional */
  apiOrigin,
}) {
  const isDefault = !!addr?.isDefault;

  const resolvedOrigin = useMemo(() => {
    if (apiOrigin && typeof apiOrigin === "string") return apiOrigin.replace(/\/+$/, "");
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin.replace(/\/+$/, "");
    }
    return "";
  }, [apiOrigin]);

  const display = useMemo(() => getAddressDisplay(addr), [addr]);

  const handleTileKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.();
    }
  };

  /* ───────── Edit behavior ─────────
     1) Preferred: parent-driven via onEdit(addr)
     2) Legacy: OTP + PUT flow (kept for backward compatibility)
  */
  const handleEdit = async (e) => {
    e.stopPropagation();

    if (typeof onEdit === "function") {
      onEdit(addr);
      return;
    }

    // Legacy path
    if (!addr?.id) return;
    if (typeof getOtp !== "function" || typeof buildUpdatePayload !== "function") return;

    try {
      const otp = await getOtp(); // modal → { code, identifier, purpose? }
      if (!otp?.code || !otp?.identifier) return;

      const rawPayload = buildUpdatePayload(addr) || {};
      const payload = normalizeAddressInput(rawPayload);

      const res = await updateAddressWithOtp({
        origin: resolvedOrigin,
        id: addr.id,
        data: payload,
        otp, // {code, identifier, purpose?}
      });

      onRefresh?.(res);
    } catch (err) {
      // Intentionally silent (parent can surface errors); avoid console noise in prod.
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (typeof onDelete === "function") onDelete(addr);
  };

  return (
    <div
      className={`addr-tile ${selected ? "active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleTileKey}
      aria-pressed={!!selected}
      aria-label={`Select address ${display?.title || ""}`}
      data-testid="address-tile"
    >
      <div className="row-top">
        <div className="title">
          <span className="name">{display?.title || "—"}</span>
          {isDefault ? <span className="pill-default">Default</span> : null}
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={handleEdit}
            aria-label="Edit address"
          >
            Edit
          </button>

          {typeof onDelete === "function" ? (
            <button
              type="button"
              className="btn-danger"
              onClick={handleDelete}
              aria-label="Delete address"
              title={isDefault ? "Default address delete may require OTP" : "Delete address"}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="row-mid">
        <div className="line contact">{display?.contact || "—"}</div>
        <div className="line strong">{display?.lineA || "—"}</div>
        {display?.lineB ? <div className="line strong">{display.lineB}</div> : null}
        <div className="line strong">{display?.lineC || "—"}</div>
      </div>

      <style jsx>{`
        .addr-tile {
          width: 100%;
          border: 1px solid ${BORDER};
          border-radius: 18px;
          padding: 16px;
          background: linear-gradient(180deg, #fff 0%, #fafbff 100%);
          box-shadow: 0 8px 24px rgba(15, 33, 71, 0.06);
          display: grid;
          gap: 10px;
          outline: none;
          cursor: pointer;
        }

        .addr-tile.active {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
          background: #f7faff;
        }

        .row-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: ${NAVY};
          min-width: 0;
        }

        .name {
          font-weight: 900;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 52vw;
        }

        .pill-default {
          background: #eef2ff;
          color: #3730a3;
          border: 1px solid #e0e7ff;
          font-weight: 800;
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 999px;
          flex: 0 0 auto;
        }

        .actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .btn-ghost,
        .btn-danger {
          height: 38px;
          min-height: 38px;
          padding: 0 12px;
          border-radius: 10px;
          font-weight: 900;
          border: 1px solid ${BORDER};
          background: #fff;
          color: ${NAVY};
          cursor: pointer;
        }

        .btn-danger {
          background: #fff1f2;
          color: #991b1b;
          border-color: #fecaca;
        }

        .row-mid .line {
          color: ${NAVY};
        }

        .row-mid .line.strong {
          font-weight: 850;
        }

        .row-mid .line.contact {
          color: ${MUTED};
          font-weight: 800;
        }

        @media (max-width: 520px) {
          .addr-tile {
            padding: 14px;
          }
          .name {
            max-width: 60vw;
          }
          .btn-ghost,
          .btn-danger {
            height: 42px; /* better tap target on mobile */
            min-height: 42px;
          }
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Display & normalization helpers (model-aligned; legacy-safe)
*/

export function getAddressDisplay(addr = {}) {
  const title =
    safeStr(addr?.label) ||
    safeStr(addr?.alias) ||
    safeStr(addr?.nickname) ||
    safeStr(addr?.name) ||
    safeStr(addr?.title) ||
    "—";

  // Identity block (some flows attach these in Address.granular or UI payload)
  const person = safeStr(addr?.name) || safeStr(addr?.fullName) || "";
  const phone =
    safeStr(addr?.phone) ||
    safeStr(addr?.mobile) ||
    safeStr(addr?.phoneNumber) ||
    safeStr(addr?.contactPhone) ||
    "";

  const emailSafe = addr?.email ? String(addr.email).toLowerCase().trim() : "";
  const contact = [person, phone, emailSafe].filter(Boolean).join(" • ") || "—";

  // Canonical: line1/line2/city/state/postalCode/countryIso2
  const line1 =
    safeStr(addr?.line1) ||
    safeStr(addr?.address1) ||
    safeStr(addr?.addressLine1) ||
    safeStr(addr?.streetAddress) ||
    buildLine1FromGranular(addr);

  const line2 =
    safeStr(addr?.line2) ||
    safeStr(addr?.address2) ||
    safeStr(addr?.addressLine2) ||
    safeStr(addr?.unit) ||
    safeStr(addr?.apartmentNo) ||
    safeStr(addr?.floorNo) ||
    "";

  const legacyLineB = [
    addr?.village,
    addr?.postOffice,
    addr?.union,
    addr?.policeStation,
    addr?.sublocality,
    addr?.locality,
    addr?.neighborhood,
  ]
    .map(safeStr)
    .filter(Boolean)
    .join(", ");

  const lineA = line1 || "—";
  const lineB = line2 || legacyLineB || "";

  const city =
    safeStr(addr?.city) || safeStr(addr?.upazila) || safeStr(addr?.adminLevel2) || "";
  const state =
    safeStr(addr?.state) || safeStr(addr?.district) || safeStr(addr?.adminLevel1) || "";
  const postal =
    safeStr(addr?.postalCode) || safeStr(addr?.zip) || safeStr(addr?.postcode) || "";
  const countryIso2 = (
    safeStr(addr?.countryIso2) ||
    safeStr(addr?.country) ||
    safeStr(addr?.countryCode) ||
    "BD"
  )
    .toUpperCase()
    .trim();

  const lineC = [city, state, postal, countryIso2].filter(Boolean).join(", ") || "—";

  return { title, contact, lineA, lineB, lineC };
}

export function normalizeAddressInput(input = {}) {
  const data = { ...(input || {}) };

  // Canonical line1
  if (!safeStr(data.line1)) {
    data.line1 =
      safeStr(data.streetAddress) ||
      safeStr(data.address1) ||
      safeStr(data.addressLine1) ||
      buildLine1FromGranular(data) ||
      data.line1;
  }

  // Canonical line2
  if (!safeStr(data.line2)) {
    data.line2 =
      safeStr(data.address2) ||
      safeStr(data.addressLine2) ||
      safeStr(data.unit) ||
      data.line2;
  }

  // Canonical city/state (BD: upazila/district commonly supplied by UI)
  if (!safeStr(data.city)) data.city = safeStr(data.upazila) || safeStr(data.adminLevel2) || data.city;
  if (!safeStr(data.state)) data.state = safeStr(data.district) || safeStr(data.adminLevel1) || data.state;

  if (!safeStr(data.postalCode)) data.postalCode = safeStr(data.zip) || safeStr(data.postcode) || data.postalCode;

  if (!safeStr(data.countryIso2)) {
    const c = safeStr(data.countryIso2) || safeStr(data.country) || safeStr(data.countryCode) || "BD";
    data.countryIso2 = String(c).toUpperCase();
  }

  if (!safeStr(data.phone)) data.phone = safeStr(data.mobile) || safeStr(data.phoneNumber) || data.phone;

  // label is optional but helps UX
  if (!safeStr(data.label)) {
    data.label =
      safeStr(data.label) ||
      safeStr(data.alias) ||
      safeStr(data.nickname) ||
      safeStr(data.name) ||
      data.label;
  }

  return data;
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s ? s : "";
}

function buildLine1FromGranular(a = {}) {
  const legacyHouse = [
    safeStr(a?.houseName),
    safeStr(a?.houseNo),
    safeStr(a?.apartmentNo),
    safeStr(a?.floorNo),
  ]
    .filter(Boolean)
    .join(", ");

  const street = [safeStr(a?.streetNumber), safeStr(a?.route)].filter(Boolean).join(" ");
  const premise = [safeStr(a?.premise), safeStr(a?.subpremise)].filter(Boolean).join(", ");

  const built = [legacyHouse, premise, street].filter(Boolean).join(", ");
  return built || "";
}

/* ──────────────────────────── LEGACY API helpers ────────────────────────────
   Updated to match your CURRENT conventions:
   - Endpoint: /api/customers/address-book and /api/customers/address-book/[id]
   - OTP passed in BODY: otp: { identifier, code, purpose }
   These helpers are kept only for older callers; newer code should mutate in parent.
*/

export async function createAddressWithOtp({
  origin = "",
  data = {},
  otp,
  makeDefault = false,
} = {}) {
  if (!otp?.code || !otp?.identifier) throw new Error("OTP code & identifier are required");

  const normalized = normalizeAddressInput(data);
  const base = (origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(
    /\/+$/,
    ""
  );

  const res = await fetch(`${base}/api/customers/address-book`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      ...normalized,
      makeDefault: !!makeDefault,
      otp: {
        identifier: String(otp.identifier),
        code: String(otp.code),
        purpose: String(otp.purpose || "address_create"),
      },
    }),
  });

  return safeJson(res);
}

export async function updateAddressWithOtp({
  origin = "",
  id,
  data = {},
  otp,
  makeDefault = false,
} = {}) {
  if (!id) throw new Error("Address id is required");
  if (!otp?.code || !otp?.identifier) throw new Error("OTP code & identifier are required");

  const normalized = normalizeAddressInput(data);
  const base = (origin || (typeof window !== "undefined" ? window.location.origin : "")).replace(
    /\/+$/,
    ""
  );

  const res = await fetch(`${base}/api/customers/address-book/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      ...normalized,
      makeDefault: !!makeDefault,
      otp: {
        identifier: String(otp.identifier),
        code: String(otp.code),
        purpose: String(otp.purpose || "address_update"),
      },
    }),
  });

  return safeJson(res);
}

async function safeJson(res) {
  let j = null;
  try {
    j = await res.json();
  } catch {
    j = { ok: false, error: "BAD_JSON" };
  }

  if (j && typeof j === "object") {
    if (typeof j.ok !== "boolean") j.ok = !!res?.ok;
    j.__httpStatus = res.status;
  }
  return j;
}
