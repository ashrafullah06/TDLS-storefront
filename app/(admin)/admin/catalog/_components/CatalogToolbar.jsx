// FILE: app/(admin)/admin/catalog/_components/CatalogToolbar.jsx
"use client";

import React from "react";

function str(v) {
  return String(v ?? "").trim();
}

export default function CatalogToolbar({
  value = {},
  onChange,
  onOpenBulkActions,
  loading = false,
  className = "",
}) {
  const v = value || {};

  const q = str(v.q);
  const sort = str(v.sort) || "updatedAt:desc";
  const view = str(v.view) || "grid";

  const set = (patch) => {
    if (typeof onChange === "function") onChange(patch);
  };

  const PillButton = ({ active, children, onClick, disabled }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-full px-4 py-2 text-sm font-semibold transition",
        "border",
        active
          ? "border-[#0F2147] bg-[#0F2147] text-white shadow-sm"
          : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      ].join(" ")}
    >
      {children}
    </button>
  );

  const SoftButton = ({ children, onClick, disabled }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-full px-4 py-2 text-sm font-semibold transition",
        "border border-neutral-200 bg-white text-neutral-900 hover:bg-neutral-50",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      ].join(" ")}
    >
      {children}
    </button>
  );

  const NavyButton = ({ children, onClick, disabled }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-full px-4 py-2 text-sm font-semibold transition",
        "bg-[#0F2147] text-white shadow-sm hover:brightness-110 active:brightness-95",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      ].join(" ")}
    >
      {children}
    </button>
  );

  return (
    <div
      className={[
        "flex flex-col gap-3 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm",
        "md:flex-row md:items-center md:justify-between",
        className,
      ].join(" ")}
    >
      {/* Left: Search */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-neutral-600">Search</div>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="Name / slug / product code / base SKU"
              className="w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147]"
            />
            {q ? (
              <SoftButton onClick={() => set({ q: "" })} disabled={loading}>
                Clear
              </SoftButton>
            ) : null}
          </div>
        </div>

        {/* Sort */}
        <div className="w-full md:w-64">
          <div className="text-xs font-semibold text-neutral-600">Sort</div>
          <select
            value={sort}
            onChange={(e) => set({ sort: e.target.value })}
            disabled={loading}
            className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
          >
            <option value="updatedAt:desc">Updated (new → old)</option>
            <option value="updatedAt:asc">Updated (old → new)</option>
            <option value="createdAt:desc">Created (new → old)</option>
            <option value="createdAt:asc">Created (old → new)</option>
            <option value="name:asc">Name (A → Z)</option>
            <option value="name:desc">Name (Z → A)</option>
            <option value="price:desc">Price (high → low)</option>
            <option value="price:asc">Price (low → high)</option>
          </select>
        </div>
      </div>

      {/* Right: View toggle + Bulk entry */}
      <div className="flex flex-wrap items-center gap-2">
        <PillButton
          active={view === "grid"}
          onClick={() => set({ view: "grid" })}
          disabled={loading}
        >
          Grid
        </PillButton>
        <PillButton
          active={view === "table"}
          onClick={() => set({ view: "table" })}
          disabled={loading}
        >
          Table
        </PillButton>

        <div className="h-6 w-px bg-neutral-200" />

        <NavyButton
          onClick={() => typeof onOpenBulkActions === "function" && onOpenBulkActions()}
          disabled={loading}
        >
          Bulk actions
        </NavyButton>
      </div>
    </div>
  );
}
