// FILE: app/(admin)/admin/catalog/_components/CatalogFilters.jsx
"use client";

import React from "react";

function str(v) {
  return String(v ?? "").trim();
}

function int(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * CatalogFilters (sticky rail)
 * - Category / status / stock filters
 * - Does NOT fetch categories directly (no direct Strapi calls from UI)
 *   - categoryOptions is passed by parent (from API payload if/when you add it)
 */
export default function CatalogFilters({
  value = {},
  onChange,
  loading = false,
  categoryOptions = [],
  className = "",
}) {
  const v = value || {};
  const status = str(v.status);
  const stock = str(v.stock);
  const categoryId = str(v.categoryId);
  const subCategoryId = str(v.subCategoryId);
  const superCategoryId = str(v.superCategoryId);
  const audienceCategoryId = str(v.audienceCategoryId);
  const brandTierId = str(v.brandTierId);

  const lowThreshold = clamp(int(v.lowThreshold, 3), 1, 999);

  const set = (patch) => {
    if (typeof onChange === "function") onChange(patch);
  };

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

  // categoryOptions shape (strict):
  // [
  //   { group: "Categories", items: [{id,name,slug}] },
  //   { group: "Sub Categories", items: [...] },
  //   ...
  // ]
  const normalizedGroups = Array.isArray(categoryOptions)
    ? categoryOptions
        .map((g) => ({
          group: str(g?.group) || "",
          items: Array.isArray(g?.items)
            ? g.items
                .map((x) => ({
                  id: str(x?.id),
                  name: x?.name ?? null,
                  slug: x?.slug ?? null,
                }))
                .filter((x) => x.id)
            : [],
        }))
        .filter((g) => g.group && g.items.length)
    : [];

  const hasAnyFilter =
    Boolean(status) ||
    Boolean(stock) ||
    Boolean(categoryId) ||
    Boolean(subCategoryId) ||
    Boolean(superCategoryId) ||
    Boolean(audienceCategoryId) ||
    Boolean(brandTierId) ||
    (str(stock).toLowerCase() === "low" && lowThreshold !== 3);

  return (
    <aside className={className}>
      <div className="sticky top-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-extrabold tracking-tight text-neutral-900">Filters</div>
          <SoftButton
            disabled={loading || !hasAnyFilter}
            onClick={() =>
              set({
                status: "",
                stock: "",
                lowThreshold: 3,
                categoryId: "",
                subCategoryId: "",
                superCategoryId: "",
                audienceCategoryId: "",
                brandTierId: "",
              })
            }
          >
            Reset
          </SoftButton>
        </div>

        {/* Status / Stock */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-semibold text-neutral-600">Status</div>
            <select
              value={status}
              onChange={(e) => set({ status: e.target.value })}
              disabled={loading}
              className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
            >
              <option value="">All</option>
              <option value="Active">Active</option>
              <option value="Draft">Draft</option>
              <option value="Archived">Archived</option>
            </select>
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-neutral-600">Stock</div>
            <select
              value={stock}
              onChange={(e) => set({ stock: e.target.value })}
              disabled={loading}
              className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
            >
              <option value="">All</option>
              <option value="in">In stock</option>
              <option value="out">Out of stock</option>
              <option value="low">Low stock</option>
            </select>
          </label>
        </div>

        {str(stock).toLowerCase() === "low" ? (
          <label className="mt-3 block">
            <div className="text-xs font-semibold text-neutral-600">Low threshold</div>
            <input
              type="number"
              min={1}
              max={999}
              value={lowThreshold}
              disabled={loading}
              onChange={(e) => set({ lowThreshold: clamp(int(e.target.value, 3), 1, 999) })}
              className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
            />
            <div className="mt-1 text-[11px] text-neutral-600">
              A product is “low” if any variant stock is ≤ threshold.
            </div>
          </label>
        ) : null}

        {/* Category groups (optional, if provided by parent) */}
        <div className="mt-4 space-y-3">
          <div className="text-xs font-extrabold text-neutral-700">Categories</div>

          {normalizedGroups.length ? (
            <>
              {/* Primary categories */}
              <label className="block">
                <div className="text-xs font-semibold text-neutral-600">Category</div>
                <select
                  value={categoryId}
                  onChange={(e) => set({ categoryId: e.target.value })}
                  disabled={loading}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
                >
                  <option value="">All</option>
                  {(normalizedGroups.find((g) => g.group === "Categories")?.items || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.slug || c.id}
                    </option>
                  ))}
                </select>
              </label>

              {/* Sub categories */}
              <label className="block">
                <div className="text-xs font-semibold text-neutral-600">Sub Category</div>
                <select
                  value={subCategoryId}
                  onChange={(e) => set({ subCategoryId: e.target.value })}
                  disabled={loading}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
                >
                  <option value="">All</option>
                  {(normalizedGroups.find((g) => g.group === "Sub Categories")?.items || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.slug || c.id}
                    </option>
                  ))}
                </select>
              </label>

              {/* Super categories */}
              <label className="block">
                <div className="text-xs font-semibold text-neutral-600">Super Category</div>
                <select
                  value={superCategoryId}
                  onChange={(e) => set({ superCategoryId: e.target.value })}
                  disabled={loading}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
                >
                  <option value="">All</option>
                  {(normalizedGroups.find((g) => g.group === "Super Categories")?.items || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.slug || c.id}
                    </option>
                  ))}
                </select>
              </label>

              {/* Audience categories */}
              <label className="block">
                <div className="text-xs font-semibold text-neutral-600">Audience Category</div>
                <select
                  value={audienceCategoryId}
                  onChange={(e) => set({ audienceCategoryId: e.target.value })}
                  disabled={loading}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
                >
                  <option value="">All</option>
                  {(normalizedGroups.find((g) => g.group === "Audience Categories")?.items || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.slug || c.id}
                    </option>
                  ))}
                </select>
              </label>

              {/* Brand tiers */}
              <label className="block">
                <div className="text-xs font-semibold text-neutral-600">Brand Tier</div>
                <select
                  value={brandTierId}
                  onChange={(e) => set({ brandTierId: e.target.value })}
                  disabled={loading}
                  className="mt-1 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-[#0F2147] disabled:opacity-50"
                >
                  <option value="">All</option>
                  {(normalizedGroups.find((g) => g.group === "Brand Tiers")?.items || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.slug || c.id}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-xs font-semibold text-neutral-700">
              Category filters will appear here once the Catalog API exposes taxonomy options.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
