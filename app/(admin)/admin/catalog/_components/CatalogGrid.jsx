// FILE: app/(admin)/admin/catalog/_components/CatalogGrid.jsx
"use client";

import React from "react";

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

export default function CatalogGrid({
  items = [],
  onOpen,
  loading = false,
  className = "",
}) {
  const list = Array.isArray(items) ? items : [];

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => {
          const id = num(p?.id);
          const title = p?.title ?? p?.slug ?? (id != null ? `#${id}` : "Product");
          const thumb = p?.thumbnail || null;

          const hasBridge = Boolean(p?.app?.hasBridge);
          const availability = p?.availability || null;
          const totalAvail = availability ? Number(availability.totalAvailable ?? 0) : null;
          const lowCount = availability ? Number(availability.lowStockVariants ?? 0) : 0;

          const priceLabel = formatPrice(p?.pricing);
          const updatedAt = p?.timestamps?.updatedAt ? new Date(p.timestamps.updatedAt) : null;
          const updatedText = updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt.toLocaleString() : null;

          const onClick = () => {
            if (!id) return;
            if (typeof onOpen === "function") onOpen(id);
          };

          return (
            <button
              key={id ?? `${p?.slug}-${Math.random()}`}
              type="button"
              onClick={onClick}
              disabled={loading || !id}
              className={[
                "group text-left",
                "rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm",
                "transition hover:-translate-y-[1px] hover:shadow-md",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              ].join(" ")}
            >
              <div className="flex gap-3">
                <div className="h-20 w-20 flex-none overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={safeAlt(p)}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-neutral-500">
                      No media
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 truncate text-sm font-extrabold text-neutral-900">
                      {title}
                    </div>
                    {p?.status ? <Badge tone={statusTone(p.status)}>{p.status}</Badge> : null}
                    {!hasBridge ? <Badge tone="warn">No app bridge</Badge> : null}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                    {id != null ? <span className="truncate">ID: {id}</span> : null}
                    {p?.slug ? <span className="truncate">Slug: {p.slug}</span> : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {priceLabel ? <Badge tone="neutral">{priceLabel}</Badge> : null}

                    {availability ? (
                      totalAvail > 0 ? (
                        <Badge tone="ok">Available: {totalAvail}</Badge>
                      ) : (
                        <Badge tone="bad">Out of stock</Badge>
                      )
                    ) : (
                      <Badge tone="neutral">Availability: —</Badge>
                    )}

                    {availability && lowCount > 0 ? <Badge tone="warn">Low variants: {lowCount}</Badge> : null}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs font-semibold text-neutral-600">
                  {updatedText ? `Updated: ${updatedText}` : "—"}
                </div>
                <span className="text-xs font-extrabold text-[#0F2147] opacity-0 transition group-hover:opacity-100">
                  Open →
                </span>
              </div>
            </button>
          );
        })}

        {!loading && list.length === 0 ? (
          <div className="col-span-full rounded-3xl border border-neutral-200 bg-neutral-50 p-6 text-sm font-semibold text-neutral-700">
            No products match the current filters.
          </div>
        ) : null}
      </div>
    </div>
  );
}
