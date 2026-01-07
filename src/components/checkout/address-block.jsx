//FILE: src/components/checkout/address-block.jsx
"use client";

import React, { useMemo } from "react";

const NAVY = "#0F2147";
const MUTED = "#6B7280";
const BORDER = "#DFE3EC";

/**
 * AddressBlock
 * - Pure display + action triggers (Select / Edit / Delete)
 * - Default tile is not deletable
 * - Keyboard-accessible (Enter/Space selects)
 * - Defensive against partial/missing fields
 *
 * Props:
 *  - addr: Address object
 *  - selected: boolean
 *  - onSelect(): void
 *  - onDelete(addr): void (not called for default addr)
 *
 *  NEW (for checkout refinement):
 *  - onEdit(addr): void
 *       Parent-driven edit (opens modal, runs OTP, etc.).
 *       If present, overrides the internal OTP+PUT edit flow.
 *
 *  LEGACY (still supported, but only used if onEdit is not provided):
 *  - getOtp: () => Promise<{ code:string, identifier:string, purpose?:string }>
 *       Your OTP modal. Must be provided by parent.
 *  - buildUpdatePayload: (addr) => any
 *       Should return the payload to update the address (fields user edited).
 *  - onRefresh: (result) => void
 *       Called after successful update to let parent refresh list/selection.
 *  - apiOrigin?: string
 *       Defaults to NEXT_PUBLIC_APP_ORIGIN or window.location.origin.
 */
export default function AddressBlock({
  addr = {},
  selected = false,
  onSelect,
  onDelete,

  /** OPTIONAL: new, parent-driven behaviors */
  onEdit,

  /** LEGACY OTP-based edit flow (used only if onEdit is not provided) */
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

  // Build lines defensively
  const lineA = [
    addr?.houseName,
    addr?.houseNo,
    addr?.apartmentNo,
    addr?.floorNo,
    addr?.line1 || addr?.address1,
  ]
    .filter(Boolean)
    .join(", ");

  const lineBParts = [addr?.village, addr?.postOffice, addr?.union, addr?.policeStation].filter(
    Boolean
  );
  const lineB = lineBParts.length ? lineBParts.join(", ") : "";

  const lineC = [
    addr?.upazila || addr?.city,
    addr?.district || addr?.state,
    addr?.postalCode,
    (addr?.countryIso2 || addr?.country || "").toString().toUpperCase(),
  ]
    .filter(Boolean)
    .join(", ");

  const emailSafe = addr?.email ? String(addr.email).toLowerCase() : "";
  const contact = [addr?.phone, emailSafe].filter(Boolean).join(" • ");

  const handleTileKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.();
    }
  };

  /* ───────── ALWAYS-on Edit button behavior ─────────
     1) If parent provides onEdit(addr), we just call that and let parent
        run its own modal + OTP + update + refresh.
     2) If parent does NOT provide onEdit, we fall back to the legacy
        OTP+PUT flow using getOtp/buildUpdatePayload/onRefresh.
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
      const otp = await getOtp(); // Your modal → { code, identifier, purpose? }
      const payload = buildUpdatePayload(addr) || {};

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
      aria-label={`Select address ${addr?.name || ""}`}
      data-testid="address-tile"
    >
      <div className="row-top">
        <div className="title">
          <span className="name">{addr?.name || "—"}</span>
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

          {/* Make-default CTA intentionally removed for checkout saved cards */}

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
        <div className="line strong">{contact || "—"}</div>
        <div className="line strong">{lineA || "—"}</div>
        {lineB ? <div className="line strong">{lineB}</div> : null}
        <div className="line strong">{lineC || "—"}</div>
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
        .btn-default {
          height: 36px;
          padding: 0 10px;
          border-radius: 10px;
          background: #ecfdf5;
          color: #065f46;
          font-weight: 800;
          border: 1px solid #a7f3d0;
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

/* ──────────────────────────── Helpers (exported) ────────────────────────────
   Header-based OTP calls that match your server routes (purpose-locked to
   address_create / address_update).
*/

export async function createAddressWithOtp({
  origin = "",
  data = {},
  otp,
  makeDefault = false,
} = {}) {
  if (!otp?.code || !otp?.identifier) throw new Error("OTP code & identifier are required");
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
    body: JSON.stringify({ ...data, makeDefault: !!makeDefault }),
    credentials: "include",
  });

  const json = await safeJson(res);
  return json;
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
    body: JSON.stringify({ ...data, makeDefault: !!makeDefault }),
    credentials: "include",
  });

  const json = await safeJson(res);
  return json;
}

async function safeJson(res) {
  let j = null;
  try {
    j = await res.json();
  } catch {
    j = { ok: false, error: "BAD_JSON" };
  }
  if (j && typeof j === "object") j.__httpStatus = res.status;
  return j;
}
