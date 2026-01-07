// FILE: app/(admin)/admin/catalog/_components/ProductDrawer.jsx
"use client";

import React, { useEffect, useMemo } from "react";

function str(v) {
  return String(v ?? "").trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function statusTone(status) {
  const s = str(status).toLowerCase();
  if (s === "active") return "ok";
  if (s === "draft") return "warn";
  if (s === "archived") return "bad";
  return "neutral";
}

function safeAlt(p) {
  return str(p?.title) || str(p?.slug) || (p?.id != null ? `Product ${p.id}` : "Product image");
}

function formatUpdated(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

/**
 * ProductDrawer (stateless UI renderer)
 * Parent is responsible for:
 *  - fetching /api/admin/catalog/products/[id]
 *  - fetching /api/admin/catalog/diagnostics (optional)
 *
 * This component renders only what it receives. No guessing.
 */
export default function ProductDrawer({
  open = false,
  loading = false,
  error = "",
  product = null, // normalized detail (recommended: API returns normalized DTO)
  variantsMatrix = [], // array of variants (with size_stocks + app join)
  diagnostics = null, // { issues:[], actions:[] } optional
  warehouseMode = false,
  onToggleWarehouseMode,
  onClose,
  className = "",
}) {
  const pid = num(product?.id);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (typeof onClose === "function") onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const mediaImages = useMemo(() => {
    const out = [];
    const images = Array.isArray(product?.media?.images) ? product.media.images : [];
    const gallery = Array.isArray(product?.media?.gallery) ? product.media.gallery : [];
    // keep order: images first then gallery, stable.
    for (const m of images) if (m?.url) out.push(m);
    for (const m of gallery) if (m?.url) out.push(m);
    return out;
  }, [product]);

  const availability = product?.availability || null;

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-[80] ${className}`}>
      {/* Overlay */}
      <button
        type="button"
        onClick={() => typeof onClose === "function" && onClose()}
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
      />

      {/* Panel */}
      <div className="absolute right-0 top-0 h-full w-full max-w-[980px] overflow-hidden rounded-l-3xl border-l border-neutral-200 bg-white shadow-2xl">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate text-lg font-extrabold text-neutral-900">
                  {product?.title || product?.slug || (pid ? `Product #${pid}` : "Product")}
                </div>
                {product?.status ? <Badge tone={statusTone(product.status)}>{product.status}</Badge> : null}
                {loading ? <Badge tone="info">Loading…</Badge> : null}
                {error ? <Badge tone="bad">{error}</Badge> : null}
                {product?.app?.hasBridge === false ? <Badge tone="warn">No app bridge</Badge> : null}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                {pid ? <span>ID: {pid}</span> : null}
                {product?.slug ? <span>Slug: {product.slug}</span> : null}
                {product?.codes?.product_code ? <span>Code: {product.codes.product_code}</span> : null}
                {product?.codes?.base_sku ? <span>Base SKU: {product.codes.base_sku}</span> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-800">
                <input
                  type="checkbox"
                  checked={Boolean(warehouseMode)}
                  onChange={(e) =>
                    typeof onToggleWarehouseMode === "function" && onToggleWarehouseMode(e.target.checked)
                  }
                />
                Warehouse mode
              </label>

              <button
                type="button"
                onClick={() => typeof onClose === "function" && onClose()}
                className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-50"
              >
                Close
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* Media */}
              <div className="lg:col-span-5">
                <div className="rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
                  <div className="text-sm font-extrabold text-neutral-900">Media</div>

                  <div className="mt-2">
                    {product?.media?.thumbnail ? (
                      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
                        <img
                          src={product.media.thumbnail}
                          alt={safeAlt(product)}
                          className="h-64 w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="flex h-64 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-sm font-semibold text-neutral-600">
                        No media
                      </div>
                    )}

                    {mediaImages.length ? (
                      <div className="mt-3 grid grid-cols-4 gap-2">
                        {mediaImages.slice(0, 12).map((m) => (
                          <div
                            key={`${m.id ?? "m"}-${m.url}`}
                            className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50"
                          >
                            <img src={m.url} alt={m.alternativeText || "Image"} className="h-16 w-full object-cover" loading="lazy" />
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Taxonomy */}
                <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
                  <div className="text-sm font-extrabold text-neutral-900">Taxonomy</div>
                  <div className="mt-2 space-y-3">
                    <TaxoBlock title="Categories" items={product?.taxonomy?.categories} />
                    <TaxoBlock title="Sub Categories" items={product?.taxonomy?.sub_categories} />
                    <TaxoBlock title="Super Categories" items={product?.taxonomy?.super_categories} />
                    <TaxoBlock title="Audience Categories" items={product?.taxonomy?.audience_categories} />
                    <TaxoBlock title="Brand Tiers" items={product?.taxonomy?.brand_tiers} />
                    <TaxoBlock title="Tags" items={product?.taxonomy?.tags} />
                  </div>
                </div>
              </div>

              {/* Right column */}
              <div className="lg:col-span-7">
                {/* Availability */}
                <div className="rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-extrabold text-neutral-900">Availability</div>
                    <div className="flex flex-wrap items-center gap-2">
                      {availability ? (
                        <>
                          <Badge tone="neutral">
                            Mapped: {Number(availability.mappedSizeStocks ?? 0)}/{Number(availability.totalSizeStocks ?? 0)}
                          </Badge>
                          <Badge tone={Number(availability.totalAvailable ?? 0) > 0 ? "ok" : "bad"}>
                            Total: {Number(availability.totalAvailable ?? 0)}
                          </Badge>
                          {warehouseMode && availability.computedTotalAvailable != null ? (
                            <Badge tone="info">Computed: {Number(availability.computedTotalAvailable ?? 0)}</Badge>
                          ) : null}
                        </>
                      ) : (
                        <Badge>—</Badge>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <InfoCard
                      title="Pricing"
                      lines={[
                        product?.pricing?.selling_price != null
                          ? `Selling: ${product.pricing.selling_price}${product.pricing.currency ? ` ${product.pricing.currency}` : ""}`
                          : "Selling: —",
                        product?.pricing?.compare_price != null
                          ? `Compare: ${product.pricing.compare_price}${product.pricing.currency ? ` ${product.pricing.currency}` : ""}`
                          : "Compare: —",
                      ]}
                    />
                    <InfoCard
                      title="Timestamps"
                      lines={[
                        `Updated: ${formatUpdated(product?.timestamps?.updatedAt)}`,
                        `Created: ${formatUpdated(product?.timestamps?.createdAt)}`,
                      ]}
                    />
                  </div>
                </div>

                {/* Variants matrix */}
                <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
                  <div className="text-sm font-extrabold text-neutral-900">Variants</div>

                  <div className="mt-2 space-y-4">
                    {(Array.isArray(variantsMatrix) ? variantsMatrix : []).map((v) => (
                      <div key={v?.id ?? `${v?.color}-${v?.color_key}`} className="rounded-2xl border border-neutral-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-extrabold text-neutral-900">
                            {v?.color || v?.color_key || "Variant"}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {v?.generated_sku ? <Badge>SKU: {v.generated_sku}</Badge> : null}
                            {v?.barcode ? <Badge>Barcode: {v.barcode}</Badge> : null}
                          </div>
                        </div>

                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full border-separate border-spacing-0">
                            <thead>
                              <tr className="text-left text-xs font-extrabold text-neutral-700">
                                <th className="px-2 py-2">Size</th>
                                <th className="px-2 py-2">Active</th>
                                <th className="px-2 py-2">Strapi SKU</th>
                                <th className="px-2 py-2">App</th>
                                <th className="px-2 py-2">App Available</th>
                                {warehouseMode ? <th className="px-2 py-2">Computed</th> : null}
                                <th className="px-2 py-2">Price</th>
                                <th className="px-2 py-2">Barcode</th>
                                {warehouseMode ? <th className="px-2 py-2">Warehouses</th> : null}
                              </tr>
                            </thead>
                            <tbody>
                              {(Array.isArray(v?.size_stocks) ? v.size_stocks : []).map((s) => {
                                const app = s?.app || null;
                                const mapped = Boolean(app);
                                const appAvail = mapped ? Number(app.stockAvailable ?? 0) : null;
                                const computed = mapped ? Number(app.computedAvailable ?? 0) : null;

                                return (
                                  <tr key={s?.id ?? `${v?.id}-${s?.size_name}`} className="border-t border-neutral-200">
                                    <td className="px-2 py-2 text-xs font-semibold text-neutral-900">
                                      {s?.size_name || s?.primary_value || s?.secondary_value || "—"}
                                    </td>
                                    <td className="px-2 py-2">
                                      {s?.is_active === true ? (
                                        <Badge tone="ok">Yes</Badge>
                                      ) : s?.is_active === false ? (
                                        <Badge tone="bad">No</Badge>
                                      ) : (
                                        <Badge>—</Badge>
                                      )}
                                    </td>
                                    <td className="px-2 py-2 text-xs text-neutral-800">{s?.generated_sku || "—"}</td>
                                    <td className="px-2 py-2 text-xs">
                                      {mapped ? (
                                        <div className="space-y-1">
                                          <div className="font-semibold text-neutral-900">{app?.sku || "—"}</div>
                                          {app?.variantId ? (
                                            <div className="text-[11px] text-neutral-600">Variant ID: {app.variantId}</div>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <Badge tone="warn">Unmapped</Badge>
                                      )}
                                    </td>
                                    <td className="px-2 py-2 text-xs">
                                      {mapped ? (
                                        appAvail > 0 ? <Badge tone="ok">{appAvail}</Badge> : <Badge tone="bad">{appAvail}</Badge>
                                      ) : (
                                        <span className="text-neutral-600">—</span>
                                      )}
                                    </td>

                                    {warehouseMode ? (
                                      <td className="px-2 py-2 text-xs">
                                        {mapped ? (
                                          computed > 0 ? <Badge tone="info">{computed}</Badge> : <Badge tone="neutral">{computed}</Badge>
                                        ) : (
                                          <span className="text-neutral-600">—</span>
                                        )}
                                      </td>
                                    ) : null}

                                    <td className="px-2 py-2 text-xs text-neutral-800">
                                      {s?.price != null ? <span className="font-semibold text-neutral-900">{s.price}</span> : <span className="text-neutral-600">—</span>}
                                      {s?.compare_at_price != null ? <span className="ml-2 text-neutral-600">({s.compare_at_price})</span> : null}
                                    </td>
                                    <td className="px-2 py-2 text-xs text-neutral-800">{s?.barcode || app?.barcode || "—"}</td>

                                    {warehouseMode ? (
                                      <td className="px-2 py-2 text-xs text-neutral-800">
                                        {mapped && Array.isArray(app?.inventory) && app.inventory.length ? (
                                          <div className="space-y-1">
                                            {app.inventory.slice(0, 10).map((ii) => (
                                              <div key={ii.id} className="rounded-xl border border-neutral-200 bg-neutral-50 px-2 py-1">
                                                <div className="font-semibold text-neutral-900">
                                                  {ii.warehouseName || "Warehouse"}
                                                  {ii.warehouseCode ? ` (${ii.warehouseCode})` : ""}
                                                </div>
                                                <div className="text-[11px] text-neutral-700">
                                                  OnHand: {Number(ii.onHand ?? 0)} • Reserved: {Number(ii.reserved ?? 0)} • Safety: {Number(ii.safetyStock ?? 0)}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-neutral-600">—</span>
                                        )}
                                      </td>
                                    ) : null}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}

                    {!loading && Array.isArray(variantsMatrix) && variantsMatrix.length === 0 ? (
                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold text-neutral-700">
                        No variants found in Strapi for this product.
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Diagnostics */}
                <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-extrabold text-neutral-900">Diagnostics</div>
                    {diagnostics?.lastRunAt ? <Badge tone="neutral">Run: {formatUpdated(diagnostics.lastRunAt)}</Badge> : null}
                  </div>

                  {diagnostics && (Array.isArray(diagnostics.issues) || Array.isArray(diagnostics.actions)) ? (
                    <div className="mt-3 space-y-3">
                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                        <div className="text-xs font-extrabold text-neutral-700">Issues</div>
                        <div className="mt-2 space-y-2">
                          {(Array.isArray(diagnostics.issues) ? diagnostics.issues : []).length ? (
                            diagnostics.issues.map((it, idx) => (
                              <div key={it?.code || idx} className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge tone={it?.severity === "high" ? "bad" : it?.severity === "medium" ? "warn" : "neutral"}>
                                    {str(it?.severity) || "info"}
                                  </Badge>
                                  <div className="text-xs font-extrabold text-neutral-900">{it?.title || it?.code || "Issue"}</div>
                                </div>
                                {it?.message ? (
                                  <div className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">{it.message}</div>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <div className="text-xs font-semibold text-neutral-700">No issues reported.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                        <div className="text-xs font-extrabold text-neutral-700">Suggested actions</div>
                        <div className="mt-2 space-y-2">
                          {(Array.isArray(diagnostics.actions) ? diagnostics.actions : []).length ? (
                            diagnostics.actions.map((a, idx) => (
                              <div key={a?.id || idx} className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-xs font-extrabold text-neutral-900">{a?.title || "Action"}</div>
                                  {a?.ctaLabel ? <Badge tone="info">{a.ctaLabel}</Badge> : null}
                                </div>
                                {a?.description ? (
                                  <div className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">{a.description}</div>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <div className="text-xs font-semibold text-neutral-700">No actions suggested.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold text-neutral-700">
                      Diagnostics will appear here once the page wires <span className="font-extrabold">/api/admin/catalog/diagnostics</span>.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Description */}
            {product?.short_description || product?.description ? (
              <div className="mt-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-extrabold text-neutral-900">Description</div>
                {product?.short_description ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{product.short_description}</p>
                ) : null}
                {product?.description ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{product.description}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="border-t border-neutral-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-neutral-600">
                {product?.timestamps?.updatedAt ? `Updated: ${formatUpdated(product.timestamps.updatedAt)}` : "—"}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => typeof onClose === "function" && onClose()}
                  className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={!pid}
                  onClick={() => {
                    if (!pid) return;
                    window.open(`/admin/catalog?focus=${encodeURIComponent(String(pid))}`, "_blank", "noopener,noreferrer");
                  }}
                  className={[
                    "rounded-full px-4 py-2 text-sm font-semibold transition",
                    "bg-[#0F2147] text-white shadow-sm hover:brightness-110 active:brightness-95",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  Open in new tab
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaxoBlock({ title, items }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="text-xs font-extrabold text-neutral-700">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {list.length ? (
          list.map((c) => (
            <span
              key={c?.id ?? `${c?.slug}-${Math.random()}`}
              className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-800"
            >
              {c?.name || c?.slug || (c?.id != null ? `#${c.id}` : "—")}
            </span>
          ))
        ) : (
          <span className="text-xs text-neutral-600">—</span>
        )}
      </div>
    </div>
  );
}

function InfoCard({ title, lines }) {
  const list = Array.isArray(lines) ? lines : [];
  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="text-xs font-extrabold text-neutral-700">{title}</div>
      <div className="mt-2 space-y-1 text-xs text-neutral-800">
        {list.map((t, idx) => (
          <div key={idx} className="font-semibold">
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}
