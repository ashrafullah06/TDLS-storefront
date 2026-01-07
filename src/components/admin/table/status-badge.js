// src/components/admin/table/status-badge.js
import React from "react";

/**
 * StatusBadge supports OrderStatus, PaymentStatus, FulfillmentStatus, ShipmentStatus.
 * Maps to semantic colors; extend safely without breaking callers.
 */

const COLOR = {
  // OrderStatus
  DRAFT: "bg-gray-100 text-gray-700 ring-gray-300",
  PLACED: "bg-indigo-100 text-indigo-700 ring-indigo-300",
  CONFIRMED: "bg-blue-100 text-blue-700 ring-blue-300",
  CANCELLED: "bg-rose-100 text-rose-700 ring-rose-300",
  COMPLETED: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  ARCHIVED: "bg-slate-100 text-slate-700 ring-slate-300",

  // PaymentStatus
  UNPAID: "bg-gray-100 text-gray-700 ring-gray-300",
  PENDING: "bg-amber-100 text-amber-800 ring-amber-300",
  AUTHORIZED: "bg-sky-100 text-sky-800 ring-sky-300",
  PAID: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  INITIATED: "bg-indigo-100 text-indigo-700 ring-indigo-300",
  SETTLED: "bg-green-100 text-green-700 ring-green-300",
  PARTIALLY_REFUNDED: "bg-cyan-100 text-cyan-800 ring-cyan-300",
  REFUNDED: "bg-lime-100 text-lime-800 ring-lime-300",
  FAILED: "bg-rose-100 text-rose-700 ring-rose-300",
  CANCELED: "bg-stone-100 text-stone-700 ring-stone-300",

  // FulfillmentStatus
  UNFULFILLED: "bg-gray-100 text-gray-700 ring-gray-300",
  PARTIAL: "bg-amber-100 text-amber-800 ring-amber-300",
  FULFILLED: "bg-blue-100 text-blue-700 ring-blue-300",
  RETURNED: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-300",

  // ShipmentStatus
  PENDING: "bg-gray-100 text-gray-700 ring-gray-300",
  LABEL_CREATED: "bg-slate-100 text-slate-700 ring-slate-300",
  IN_TRANSIT: "bg-indigo-100 text-indigo-700 ring-indigo-300",
  OUT_FOR_DELIVERY: "bg-amber-100 text-amber-800 ring-amber-300",
  DELIVERED: "bg-emerald-100 text-emerald-700 ring-emerald-300",
  FAILED: "bg-rose-100 text-rose-700 ring-rose-300",
  RETURNED: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-300",
};

function toKey(v) {
  return String(v || "").toUpperCase().replace(/\s+/g, "_");
}

export default function StatusBadge({ value, title }) {
  const key = toKey(value);
  const color = COLOR[key] || "bg-gray-100 text-gray-700 ring-gray-300";
  return (
    <span
      title={title || key}
      className={[
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        color,
      ].join(" ")}
    >
      {value ?? "UNKNOWN"}
    </span>
  );
}
