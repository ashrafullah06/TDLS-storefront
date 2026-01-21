//FILE: src/components/checkout/address-block.jsx
"use client";

import React, { useMemo } from "react";

const NAVY = "#0F2147";
const BORDER = "#DFE3EC";

/**
 * AddressBlock (TDLS)
 * -----------------------------------------------------------------------------
 * PURPOSE
 * - Pure display + action triggers (Select / Edit / Delete)
 * - Default tile is not deletable
 * - Keyboard-accessible (Enter/Space selects)
 * - Defensive against partial/missing fields
 *
 * SINGLE SOURCE OF TRUTH (this file)
 * - Canonical field compatibility is based on your Prisma Address model:
 *   line1, line2, city, state, postalCode, countryIso2, phone, isDefault, label, type, etc.
 * - Backward compatible with legacy field names used across older checkout/address code.
 * - Exported helpers (create/update + normalization) live here so other files can import
 *   from one place and stay model-aligned.
 *
 * Props:
 *  - addr: Address object
 *  - selected: boolean
 *  - onSelect(): void
 *  - onDelete(addr): void (not called for default addr)
 *
 *  NEW (preferred):
 *  - onEdit(addr): void
 *      Parent-driven edit (opens modal, runs OTP, etc.).
 *      If present, overrides the legacy OTP+PUT edit flow.
 *
 *  LEGACY (supported if onEdit not provided):
 *  - getOtp: () => Promise<{ code:string, identifier:string, purpose?:string }>
 *  - buildUpdatePayload: (addr) => any
 *  - onRefresh: (result) => void
 *  - apiOrigin?: string (defaults to NEXT_PUBLIC_APP_ORIGIN or window.location.origin)
 */
export default function AddressBlock({
  addr = {},
  selected = false,
  onSelect,
  onDelete,

  /** OPTIONAL: parent-driven behavior */
  onEdit,

  /** LEGACY OTP-based edit flow */
  getOtp,
  buildUpdatePayload,
  onRefresh,

  /** optional */
  apiOrigin,
}) {
  const isDefault = !!addr?.isDefault;

  const resolvedOrigin = useMemo(() => {
    if (apiOrigin && typeof apiOrigin === "string") return apiOrigin.replace(/\/+$/, "");
    if (typeof process !== "undefined" && process?.env?.NEXT_PUBLIC_APP_ORIGIN) {
      return String(process.env.NEXT_PUBLIC_APP_ORIGIN).replace(/\/+$/, "");
    }
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

  /* ───────── ALWAYS-on Edit button behavior ─────────
     1) If parent provides onEdit(addr), delegate fully.
     2) Otherwise fall back to legacy OTP+PUT flow (kept for compatibility).
  */
  const handleEdit = async (e) => {
    e.stopPropagation();

    // NEW preferred path: delegate to parent
    if (typeof onEdit === "function") {
      onEdit(addr);
      return;
    }

    // Legacy behavior (kept for compatibility)
    if (!addr?.id) {
      console.warn("AddressBlock: missing addr.id — cannot perform update.");
      return;
    }
    if (typeof getOtp !== "function" || typeof buildUpdatePayload !== "function") {
      console.error(
        "AddressBlock: getOtp and buildUpdatePayload are required for legacy OTP Edit flow."
      );
      return;
    }

    try {
      const otp = await getOtp(); // modal → { code, identifier, purpose? }
      const rawPayload = buildUpdatePayload(addr) || {};
      const payload = normalizeAddressInput(rawPayload);

      const res = await updateAddressWithOtp({
        origin: resolvedOrigin,
        id: addr.id,
        data: payload,
        otp, // {code, identifier, purpose?}
      });

      if (!res?.ok) {
        console.warn("Address update failed:", res);
      }

      onRefresh?.(res);
    } catch (err) {
      console.error("Edit (OTP) flow aborted/failed:", err);
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (isDefault) return; // safeguard
    onDelete?.(addr);
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

          {onDelete ? (
            <button
              type="button"
              className={`btn-danger ${isDefault ? "is-disabled" : ""}`}
              onClick={handleDelete}
              disabled={isDefault}
              aria-disabled={isDefault}
              aria-label={isDefault ? "Default address cannot be deleted" : "Delete address"}
              title={isDefault ? "Default address cannot be deleted" : "Delete address"}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <div className="row-mid">
        <div className="line strong">{display?.contact || "—"}</div>
        <div className="line strong">{display?.lineA || "—"}</div>
        {display?.lineB ? <div className="line strong">{display.lineB}</div> : null}
        <div className="line strong">{display?.lineC || "—"}</div>
      </div>

      <style jsx>{`
        .addr-tile {
          width: 100%;
          border: 1px solid ${BORDER};
          border-radius: 18px;
          padding: 18px;
          background: linear-gradient(180deg, #fff 0%, #fafbff 100%);
          box-shadow: 0 8px 24px rgba(15, 33, 71, 0.06);
          display: grid;
          gap: 10px;
          outline: none;
          cursor: pointer;
        }
        .addr-tile + .addr-tile {
          margin-top: 12px;
        }
        .addr-tile.active {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
          background: #f7faff;
        }
        .row-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: ${NAVY};
        }
        .name {
          font-weight: 900;
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
        .actions {
          display: flex;
          gap: 8px;
        }
        .btn-ghost {
          height: 36px;
          padding: 0 10px;
          border-radius: 10px;
          background: #fff;
          color: ${NAVY};
          font-weight: 800;
          border: 1px solid ${BORDER};
        }
        .btn-danger {
          height: 36px;
          padding: 0 10px;
          border-radius: 10px;
          background: #fff1f2;
          color: #991b1b;
          font-weight: 800;
          border: 1px solid #fecaca;
        }
        .btn-danger.is-disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .row-mid .line {
          color: ${NAVY};
        }
        .row-mid .line.strong {
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Display & normalization helpers (model-aligned; legacy-safe)
   -----------------------------------------------------------------------------
   - getAddressDisplay(addr) returns the exact strings AddressBlock renders.
   - normalizeAddressInput(data) maps legacy keys into canonical Prisma keys.
   These are intentionally defined in this file so every address screen can
   import from one place and stay consistent.
*/

export function getAddressDisplay(addr = {}) {
  const title =
    safeStr(addr?.label) ||
    safeStr(addr?.name) ||
    safeStr(addr?.title) ||
    safeStr(addr?.nickname) ||
    "—";

  const phone =
    safeStr(addr?.phone) ||
    safeStr(addr?.mobile) ||
    safeStr(addr?.phoneNumber) ||
    safeStr(addr?.contactPhone) ||
    "";

  // Email is not part of the canonical Address model, but older UI may still attach it.
  const emailSafe = addr?.email ? String(addr.email).toLowerCase().trim() : "";

  const contact = [phone, emailSafe].filter(Boolean).join(" • ") || "—";

  // Canonical (Prisma): line1/line2/city/state/postalCode/countryIso2
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

  // Optional granular/BD legacy fields; used only if line2 is missing
  const legacyLineB = [
    addr?.village,
    addr?.postOffice,
    addr?.union,
    addr?.policeStation,
    addr?.adminLevel4,
    addr?.adminLevel3,
    addr?.adminLevel2,
    addr?.sublocality,
    addr?.locality,
    addr?.neighborhood,
  ]
    .map(safeStr)
    .filter(Boolean)
    .join(", ");

  const lineA = [line1].filter(Boolean).join(", ") || "—";
  const lineB = line2 || legacyLineB || "";

  const city = safeStr(addr?.city) || safeStr(addr?.upazila) || safeStr(addr?.adminLevel2) || "";
  const state = safeStr(addr?.state) || safeStr(addr?.district) || safeStr(addr?.adminLevel1) || "";
  const postal = safeStr(addr?.postalCode) || safeStr(addr?.zip) || safeStr(addr?.postcode) || "";
  const countryIso2 = (
    safeStr(addr?.countryIso2) ||
    safeStr(addr?.country) ||
    safeStr(addr?.countryCode) ||
    ""
  )
    .toUpperCase()
    .trim();

  const lineC = [city, state, postal, countryIso2].filter(Boolean).join(", ") || "—";

  return { title, contact, lineA, lineB, lineC };
}

export function normalizeAddressInput(input = {}) {
  // Keep all original keys, but ensure canonical Prisma keys exist where possible.
  // This avoids breaking existing callers while keeping the backend model happy.
  const data = { ...(input || {}) };

  // line1/line2
  if (!safeStr(data.line1)) {
    data.line1 =
      safeStr(data.address1) ||
      safeStr(data.addressLine1) ||
      safeStr(data.streetAddress) ||
      buildLine1FromGranular(data) ||
      data.line1;
  }
  if (!safeStr(data.line2)) {
    data.line2 = safeStr(data.address2) || safeStr(data.addressLine2) || safeStr(data.unit) || data.line2;
  }

  // city/state/postalCode/countryIso2
  if (!safeStr(data.city)) data.city = safeStr(data.upazila) || safeStr(data.adminLevel2) || data.city;
  if (!safeStr(data.state)) data.state = safeStr(data.district) || safeStr(data.adminLevel1) || data.state;

  if (!safeStr(data.postalCode)) data.postalCode = safeStr(data.zip) || safeStr(data.postcode) || data.postalCode;

  if (!safeStr(data.countryIso2)) {
    const c = safeStr(data.country) || safeStr(data.countryCode) || safeStr(data.countryIso2);
    if (c) data.countryIso2 = String(c).toUpperCase();
  }

  // phone
  if (!safeStr(data.phone)) data.phone = safeStr(data.mobile) || safeStr(data.phoneNumber) || data.phone;

  // label
  if (!safeStr(data.label)) data.label = safeStr(data.name) || safeStr(data.title) || safeStr(data.nickname) || data.label;

  return data;
}

function safeStr(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s ? s : "";
}

function buildLine1FromGranular(a = {}) {
  // Respect canonical fields first; this is only a fallback builder.
  const street = [safeStr(a?.streetNumber), safeStr(a?.route)].filter(Boolean).join(" ");
  const premise = [safeStr(a?.premise), safeStr(a?.subpremise)].filter(Boolean).join(", ");
  const legacyHouse = [
    safeStr(a?.houseName),
    safeStr(a?.houseNo),
    safeStr(a?.apartmentNo),
    safeStr(a?.floorNo),
  ]
    .filter(Boolean)
    .join(", ");

  const built = [legacyHouse, premise, street].filter(Boolean).join(", ");
  return built || "";
}

/* ──────────────────────────── API helpers (exported) ─────────────────────────
   Header-based OTP calls that match your server routes.
   Purposes remain: address_create / address_update.
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
  const url = `${base}/api/customers/address-book`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-otp-code": String(otp.code),
      "x-otp-identifier": String(otp.identifier),
      "x-otp-purpose": String(otp.purpose || "address_create"),
    },
    body: JSON.stringify({ ...normalized, makeDefault: !!makeDefault }),
    credentials: "include",
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
  const url = `${base}/api/customers/address-book/${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-otp-code": String(otp.code),
      "x-otp-identifier": String(otp.identifier),
      "x-otp-purpose": String(otp.purpose || "address_update"),
    },
    body: JSON.stringify({ ...normalized, makeDefault: !!makeDefault }),
    credentials: "include",
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

  // Preserve existing backend shape; add minimal debug fields only.
  if (j && typeof j === "object") {
    if (typeof j.ok !== "boolean") j.ok = !!res?.ok;
    j.__httpStatus = res.status;
  }
  return j;
}
