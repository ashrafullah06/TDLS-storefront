// src/components/admin/table/toolbar.js
import React from "react";

export default function Toolbar({
  title = "Orders",
  count,
  search,
  onSearch,
  actions = null,
  children,
}) {
  return (
    <div className="w-full flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {typeof count === "number" && (
          <span className="text-sm text-gray-500">({count.toLocaleString()})</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            value={search ?? ""}
            onChange={(e) => onSearch?.(e.target.value)}
            placeholder="Search orders, email, phone…"
            className="h-9 w-64 rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {actions}
      </div>

      {children ? <div className="w-full">{children}</div> : null}
    </div>
  );
}
