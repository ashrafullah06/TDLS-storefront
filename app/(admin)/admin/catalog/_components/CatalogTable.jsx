// FILE: app/(admin)/admin/catalog/_components/CatalogTable.jsx
"use client";

import React, { useMemo } from "react";
import Image from "next/image";

function str(v) {
  return String(v ?? "").trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function statusTone(status) {
  const s = str(status).toLowerCase();
  if (s === "active") return "ok";
  if (s === "draft") return "warn";
  if (s === "archived") return "bad";
  return "neutral";
}

function Badge({ tone = "neutral", children }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "bad"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "info"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-neutral-200 bg-neutral-50 text-neutral-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function formatPrice(pricing) {
  const cur = str(pricing?.currency);
  const sell = money(pricing?.sellingPrice ?? pricing?.selling_price);
  if (sell == null) return null;
  return `${sell}${cur ? ` ${cur}` : ""}`;
}

function safeAlt(p) {
  return str(p?.title) || str(p?.slug) || (p?.id != null ? `Product ${p.id}` : "Product image");
}

export default function CatalogTable({
  items = [],
  selectedIds = [],
  onToggleSelect,
  onToggleSelectAll,
  onOpen,
  loading = false,
  className = "",
}) {
  const rows = Array.isArray(items) ? items : [];
  const selected = useMemo(
    () =>
      new Set(
        (Array.isArray(selectedIds) ? selectedIds : [])
          .map((x) => Number(x))
          .filter(Number.isFinite)
      ),
    [selectedIds]
  );

  const rowIds = useMemo(() => rows.map((r) => num(r?.id)).filter((x) => x != null), [rows]);

  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id));
  const someSelected = rowIds.some((id) => selected.has(id)) && !allSelected;

  const onRowSelect = (id) => {
    if (!Number.isFinite(id) || id <= 0) return;
    if (typeof onToggleSelect === "function") onToggleSelect(id);
  };

  const onSelectAll = () => {
    if (typeof onToggleSelectAll === "function") onToggleSelectAll(rowIds);
  };

  const onOpenRow = (id) => {
    if (!Number.isFinite(id) || id <= 0) return;
    if (typeof onOpen === "function") onOpen(id);
  };

  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs font-extrabold text-neutral-700">
              <th className="sticky top-0 z-10 w-12 bg-white px-3 py-3">
                <input
                  type="checkbox"
                  disabled={loading || rowIds.length === 0}
                  checked={allSelected}
                  ref={(el) => {
                    if (!el) return;
                    el.indeterminate = someSelected;
                  }}
                  onChange={onSelectAll}
                  aria-label="Select all rows"
                  className="h-4 w-4 accent-[#0F2147]"
                />
              </th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Product</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Status</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Bridge</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Available</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Low</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Price</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Updated</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-3 text-right">Action</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((p, idx) => {
              const id = num(p?.id);
              const isSelected = id != null ? selected.has(id) : false;

              const title = p?.title ?? p?.slug ?? (id != null ? `#${id}` : "Product");
              const thumb = p?.thumbnail || null;

              const hasBridge = Boolean(p?.app?.hasBridge);
              const availability = p?.availability || null;
              const totalAvail = availability ? Number(availability.totalAvailable ?? 0) : null;
              const lowCount = availability ? Number(availability.lowStockVariants ?? 0) : null;

              const priceLabel = formatPrice(p?.pricing);
              const updatedAt = p?.timestamps?.updatedAt ? new Date(p.timestamps.updatedAt) : null;
              const updatedText =
                updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt.toLocaleString() : "—";

              const stableKey = id ?? p?.slug ?? `row-${idx}`;

              return (
                <tr
                  key={stableKey}
                  className={[
                    "border-t border-neutral-200",
                    isSelected ? "bg-[#0F2147]/[0.03]" : "bg-white",
                    "hover:bg-neutral-50/70 transition",
                  ].join(" ")}
                >
                  <td className="px-3 py-3 align-top">
                    <input
                      type="checkbox"
                      disabled={loading || !id}
                      checked={isSelected}
                      onChange={() => onRowSelect(id)}
                      aria-label={`Select product ${id ?? ""}`}
                      className="h-4 w-4 accent-[#0F2147]"
                    />
                  </td>

                  <td className="px-3 py-3 align-top">
                    <div className="flex items-center gap-3">
                      <div className="relative h-12 w-12 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
                        {thumb ? (
                          <Image
                            src={thumb}
                            alt={safeAlt(p)}
                            fill
                            sizes="48px"
                            className="object-cover"
                            priority={false}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-neutral-500">
                            No media
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold text-neutral-900">{title}</div>
                        <div className="truncate text-xs text-neutral-600">
                          {id != null ? `ID: ${id}` : ""}
                          {p?.slug ? ` • ${p.slug}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3 align-top">
                    {p?.status ? <Badge tone={statusTone(p.status)}>{p.status}</Badge> : <Badge>—</Badge>}
                  </td>

                  <td className="px-3 py-3 align-top">
                    {hasBridge ? <Badge tone="ok">Bridged</Badge> : <Badge tone="warn">No bridge</Badge>}
                  </td>

                  <td className="px-3 py-3 align-top">
                    {availability ? (
                      totalAvail > 0 ? <Badge tone="ok">{totalAvail}</Badge> : <Badge tone="bad">0</Badge>
                    ) : (
                      <Badge>—</Badge>
                    )}
                  </td>

                  <td className="px-3 py-3 align-top">
                    {availability ? (
                      lowCount > 0 ? <Badge tone="warn">{lowCount}</Badge> : <Badge tone="neutral">0</Badge>
                    ) : (
                      <Badge>—</Badge>
                    )}
                  </td>

                  <td className="px-3 py-3 align-top">
                    {priceLabel ? <Badge tone="neutral">{priceLabel}</Badge> : <Badge>—</Badge>}
                  </td>

                  <td className="px-3 py-3 align-top text-xs font-semibold text-neutral-700">{updatedText}</td>

                  <td className="px-3 py-3 align-top text-right">
                    <button
                      type="button"
                      onClick={() => onOpenRow(id)}
                      disabled={loading || !id}
                      className={[
                        "rounded-full px-4 py-2 text-sm font-semibold transition",
                        "bg-[#0F2147] text-white shadow-sm hover:brightness-110 active:brightness-95",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                      ].join(" ")}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}

            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10">
                  <div className="rounded-3xl border border-neutral-200 bg-neutral-50 p-6 text-sm font-semibold text-neutral-700">
                    No products match the current filters.
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
