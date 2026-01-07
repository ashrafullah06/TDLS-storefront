// FILE: app/(admin)/admin/catalog/_components/VariantMatrix.jsx
"use client";

import React, { useMemo } from "react";

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

function toneForQty(qty, lowThreshold) {
  const q = Number(qty ?? 0);
  const th = Number(lowThreshold ?? 3);
  if (!Number.isFinite(q)) return "neutral";
  if (q <= 0) return "bad";
  if (q <= th) return "warn";
  return "ok";
}

/**
 * VariantMatrix
 * - Input is the *same* variantsMatrix array returned by /api/admin/catalog/products/[id]
 *   (each element: { color/color_key, size_stocks: [{ id, size_name, is_active, app:{stockAvailable,...} }, ...] })
 * - This component renders a Color × Size grid:
 *   Rows: colors
 *   Columns: sizes (union across all variants)
 * - Each cell shows stock availability (appDb), with status coloring.
 *
 * No guessing:
 * - If app join missing => shows "Unmapped"
 * - If stock missing => "—"
 */
export default function VariantMatrix({
  variants = [],
  lowThreshold = 3,
  className = "",
  showStrapiSku = false,
  onCellClick, // optional: ({ colorKey, sizeKey, sizeStock }) => void
}) {
  const list = Array.isArray(variants) ? variants : [];

  const sizes = useMemo(() => {
    // union of size labels in stable order based on first appearance
    const seen = new Set();
    const out = [];
    for (const v of list) {
      const ss = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
      for (const s of ss) {
        const label = str(s?.size_name) || str(s?.primary_value) || str(s?.secondary_value);
        if (!label) continue;
        const key = label.toUpperCase(); // display-stable key; not persisted
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, label });
      }
    }
    return out;
  }, [list]);

  const rows = useMemo(() => {
    // build a lookup per color for fast cell render
    return list.map((v) => {
      const colorLabel = str(v?.color) || str(v?.color_key) || "Variant";
      const colorKey = str(v?.color_key) || colorLabel;

      const map = new Map();
      const ss = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
      for (const s of ss) {
        const label = str(s?.size_name) || str(s?.primary_value) || str(s?.secondary_value);
        if (!label) continue;
        map.set(label.toUpperCase(), s);
      }

      return { colorLabel, colorKey, sizeMap: map, raw: v };
    });
  }, [list]);

  if (!list.length) {
    return (
      <div className={className}>
        <div className="rounded-3xl border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold text-neutral-700">
          No variants available for matrix rendering.
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-3xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs font-extrabold text-neutral-700">
              <th className="sticky left-0 top-0 z-20 bg-white px-3 py-3">
                Color
              </th>
              {sizes.map((s) => (
                <th key={s.key} className="sticky top-0 z-10 bg-white px-3 py-3">
                  {s.label}
                </th>
              ))}
              <th className="sticky top-0 z-10 bg-white px-3 py-3">Row total</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              let rowTotal = 0;

              // pre-scan for totals (only mapped app stock counts)
              for (const s of sizes) {
                const ss = r.sizeMap.get(s.key);
                const app = ss?.app || null;
                const q = app ? Number(app.stockAvailable ?? 0) : null;
                if (q != null && Number.isFinite(q)) rowTotal += q;
              }

              return (
                <tr key={r.colorKey} className="border-t border-neutral-200">
                  <td className="sticky left-0 z-10 bg-white px-3 py-3 align-top">
                    <div className="min-w-[180px]">
                      <div className="text-sm font-extrabold text-neutral-900">{r.colorLabel}</div>
                      <div className="mt-1 text-[11px] font-semibold text-neutral-600">
                        {r.raw?.generated_sku ? `SKU: ${r.raw.generated_sku}` : ""}
                        {r.raw?.barcode ? ` • Barcode: ${r.raw.barcode}` : ""}
                      </div>
                    </div>
                  </td>

                  {sizes.map((s) => {
                    const ss = r.sizeMap.get(s.key) || null;

                    const isActive = ss?.is_active;
                    const app = ss?.app || null;

                    // availability is appDb authoritative; if unmapped => no guessing
                    const mapped = Boolean(app);
                    const qty = mapped ? num(app?.stockAvailable) : null;

                    const tone = mapped ? toneForQty(qty ?? 0, lowThreshold) : "warn";
                    const cellLabel = mapped
                      ? qty != null
                        ? String(qty)
                        : "—"
                      : "Unmapped";

                    const subLabel = showStrapiSku ? str(ss?.generated_sku) : "";

                    const disabled = typeof isActive === "boolean" ? !isActive : false;

                    return (
                      <td key={`${r.colorKey}-${s.key}`} className="px-3 py-3 align-top">
                        <button
                          type="button"
                          onClick={() =>
                            typeof onCellClick === "function" &&
                            onCellClick({
                              colorKey: r.colorKey,
                              sizeKey: s.key,
                              sizeStock: ss,
                            })
                          }
                          className={[
                            "w-full min-w-[86px] rounded-2xl border px-3 py-2 text-left transition",
                            disabled ? "opacity-60" : "",
                            tone === "ok"
                              ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                              : tone === "warn"
                              ? "border-amber-200 bg-amber-50 hover:bg-amber-100"
                              : tone === "bad"
                              ? "border-red-200 bg-red-50 hover:bg-red-100"
                              : "border-neutral-200 bg-neutral-50 hover:bg-neutral-100",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-extrabold text-neutral-900">{cellLabel}</div>
                            {typeof isActive === "boolean" ? (
                              isActive ? <Badge tone="ok">A</Badge> : <Badge tone="bad">X</Badge>
                            ) : (
                              <Badge tone="neutral">—</Badge>
                            )}
                          </div>

                          <div className="mt-1 text-[11px] font-semibold text-neutral-700">
                            {mapped && app?.sku ? `App SKU: ${app.sku}` : mapped ? "App SKU: —" : "Bridge: missing"}
                          </div>

                          {showStrapiSku ? (
                            <div className="mt-1 text-[11px] text-neutral-600">
                              {subLabel ? `Strapi SKU: ${subLabel}` : "Strapi SKU: —"}
                            </div>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}

                  <td className="px-3 py-3 align-top">
                    <Badge tone={rowTotal > 0 ? "ok" : "bad"}>Total: {rowTotal}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t border-neutral-200">
              <td className="sticky left-0 z-10 bg-white px-3 py-3 text-xs font-extrabold text-neutral-700">
                Column totals
              </td>
              {sizes.map((s) => {
                let total = 0;
                for (const r of rows) {
                  const ss = r.sizeMap.get(s.key);
                  const app = ss?.app || null;
                  const q = app ? Number(app.stockAvailable ?? 0) : null;
                  if (q != null && Number.isFinite(q)) total += q;
                }
                return (
                  <td key={`tot-${s.key}`} className="px-3 py-3">
                    <Badge tone={total > 0 ? "ok" : "neutral"}>{total}</Badge>
                  </td>
                );
              })}
              <td className="px-3 py-3">
                {(() => {
                  let grand = 0;
                  for (const r of rows) {
                    for (const s of sizes) {
                      const ss = r.sizeMap.get(s.key);
                      const app = ss?.app || null;
                      const q = app ? Number(app.stockAvailable ?? 0) : null;
                      if (q != null && Number.isFinite(q)) grand += q;
                    }
                  }
                  return <Badge tone={grand > 0 ? "ok" : "bad"}>Grand: {grand}</Badge>;
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-neutral-700">
        <Badge tone="ok">In stock</Badge>
        <Badge tone="warn">Low / Unmapped</Badge>
        <Badge tone="bad">Out</Badge>
        <span className="text-neutral-600">Low threshold: {Number(lowThreshold ?? 3)}</span>
      </div>
    </div>
  );
}
