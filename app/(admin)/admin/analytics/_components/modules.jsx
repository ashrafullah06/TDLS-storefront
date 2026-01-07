// FILE: app/(admin)/admin/analytics/_components/modules.jsx
"use client";

import React, { useMemo } from "react";
import { cx, n, safeText } from "../_lib/utils";
import { Pill, Tile } from "./ui";

/* ---------------- Module rendering (generic) ---------------- */

export function KpiMini({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
      <div className="text-[11px] font-black uppercase tracking-[0.08em] text-slate-600">
        {label}
      </div>
      <div className="mt-2 text-[20px] font-black tracking-tight text-slate-900">
        {value}
      </div>
    </div>
  );
}

export function EmptyBreakdown({ title }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
      <div className="text-[12px] font-black text-slate-700">{title}</div>
      <div className="mt-1 text-[12px] text-slate-600">No data</div>
    </div>
  );
}

export function BreakdownBlock({ title, map }) {
  const entries = Object.entries(map || {}).sort((a, b) => n(b[1]) - n(a[1]));
  return (
    <Tile className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-black uppercase tracking-[0.08em] text-slate-700">
          {title}
        </div>
        <Pill tone="neutral">{entries.length} items</Pill>
      </div>
      <div className="mt-4 space-y-2">
        {entries.length ? (
          entries.slice(0, 24).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <div className="min-w-0 truncate text-[13px] font-semibold text-slate-700">
                {safeText(k)}
              </div>
              <div className="shrink-0 text-[13px] font-black text-slate-900">
                {Math.round(n(v, 0))}
              </div>
            </div>
          ))
        ) : (
          <div className="text-[13px] text-slate-600">No values</div>
        )}
      </div>
    </Tile>
  );
}

function isPlainObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function unwrap(module) {
  if (module == null) return null;
  if (Array.isArray(module)) return module;
  if (!isPlainObject(module)) return module;
  if (module.data && (isPlainObject(module.data) || Array.isArray(module.data))) return module.data;
  if (module.payload && (isPlainObject(module.payload) || Array.isArray(module.payload))) return module.payload;
  if (module.result && (isPlainObject(module.result) || Array.isArray(module.result))) return module.result;
  return module;
}

function isRowArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isPlainObject(x));
}

function isNumericMap(v) {
  if (!isPlainObject(v)) return false;
  const entries = Object.entries(v);
  if (!entries.length) return false;
  // allow small non-numeric noise, but require at least 70% numeric
  const num = entries.filter(([, val]) => Number.isFinite(Number(val))).length;
  return num / entries.length >= 0.7;
}

function walk(obj, cb, path = "", depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return;
  cb(obj, path, depth);
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (isPlainObject(v) || Array.isArray(v)) walk(v, cb, `${path}[${i}]`, depth + 1, maxDepth);
    }
    return;
  }
  if (isPlainObject(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (isPlainObject(v) || Array.isArray(v)) walk(v, cb, path ? `${path}.${k}` : k, depth + 1, maxDepth);
    }
  }
}

function extractCandidateTablesDeep(module) {
  const root = unwrap(module);
  const out = [];
  walk(root, (node, path) => {
    if (isRowArray(node)) out.push({ path: path || "rows", rows: node });
  });
  // de-dupe by path, limit count
  const uniq = new Map();
  for (const t of out) {
    if (!uniq.has(t.path)) uniq.set(t.path, t);
  }
  return Array.from(uniq.values()).slice(0, 10);
}

function extractCandidateMapsDeep(module) {
  const root = unwrap(module);
  const out = [];
  walk(root, (node, path) => {
    if (isNumericMap(node)) out.push({ path: path || "map", map: node });
  });
  const uniq = new Map();
  for (const t of out) {
    if (!uniq.has(t.path)) uniq.set(t.path, t);
  }
  return Array.from(uniq.values()).slice(0, 10);
}

function extractKPIs(module) {
  const root = unwrap(module);
  if (!isPlainObject(root)) return [];
  const kpis = [];

  const candidates = [
    root.kpis,
    root.summary,
    root.totals,
    root.metrics,
    root.overview,
    root,
  ].filter(isPlainObject);

  const seen = new Set();
  for (const obj of candidates) {
    for (const [k, v] of Object.entries(obj)) {
      if (seen.has(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) {
        seen.add(k);
        kpis.push({ k, v });
      }
    }
  }
  // Prefer more "KPI-like" keys by sorting
  kpis.sort((a, b) => Math.abs(n(b.v)) - Math.abs(n(a.v)));
  return kpis.slice(0, 18);
}

export function ModuleRenderer({ title, module, money }) {
  const unwrapped = useMemo(() => unwrap(module), [module]);

  const tables = useMemo(() => extractCandidateTablesDeep(unwrapped), [unwrapped]);
  const maps = useMemo(() => extractCandidateMapsDeep(unwrapped), [unwrapped]);
  const kpis = useMemo(() => extractKPIs(unwrapped), [unwrapped]);

  const isEmpty =
    unwrapped == null ||
    (isPlainObject(unwrapped) && Object.keys(unwrapped).length === 0) ||
    (Array.isArray(unwrapped) && unwrapped.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[14px] font-black tracking-tight text-slate-900">
          {title}
        </div>
        <Pill tone={isEmpty ? "warn" : "good"}>
          {isEmpty ? "No module payload" : "Active"}
        </Pill>
      </div>

      {isEmpty ? (
        <Tile className="p-6">
          <div className="text-[13px] font-semibold text-slate-700">
            This module did not return a payload for the selected range/filters.
          </div>
          <div className="mt-2 text-[12px] text-slate-600">
            If you expect data here, confirm the corresponding endpoint returns JSON
            under <span className="font-mono">/api/admin/analytics/*</span> and the
            bundle includes <span className="font-mono">modules.*</span>.
          </div>
        </Tile>
      ) : null}

      {kpis.length ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {kpis.map((r) => (
            <KpiMini
              key={r.k}
              label={r.k}
              value={
                money && /revenue|amount|paid|profit|gmv|sales/i.test(r.k)
                  ? money(n(r.v, 0))
                  : Number.isFinite(n(r.v)) ? n(r.v).toLocaleString() : safeText(r.v)
              }
            />
          ))}
        </div>
      ) : null}

      {maps.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {maps.map((m) => (
            <BreakdownBlock key={m.path} title={`Breakdown • ${m.path}`} map={m.map} />
          ))}
        </div>
      ) : null}

      {tables.length ? (
        <div className="space-y-5">
          {tables.map((t) => (
            <Tile key={t.path} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[12px] font-black uppercase tracking-[0.08em] text-slate-700">
                  Table • {t.path}
                </div>
                <Pill tone="neutral">{t.rows.length} rows</Pill>
              </div>
              <div className="mt-4">
                <AutoTable rows={t.rows} money={money} />
              </div>
            </Tile>
          ))}
        </div>
      ) : null}

      <Tile className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] font-black uppercase tracking-[0.08em] text-slate-700">
            Raw payload
          </div>
          <Pill tone="navy">
            {Array.isArray(unwrapped)
              ? `Array (${unwrapped.length})`
              : isPlainObject(unwrapped)
                ? `Object (${Object.keys(unwrapped).length})`
                : typeof unwrapped}
          </Pill>
        </div>
        <pre className={cx("mt-3 overflow-auto rounded-2xl bg-slate-950 text-slate-100 p-4 text-[11px] leading-relaxed")}>
          {safeText(JSON.stringify(unwrapped, null, 2), "—")}
        </pre>
      </Tile>
    </div>
  );
}

export function AutoTable({ rows, money }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return <div className="text-[13px] text-slate-600">No rows</div>;

  const cols = Object.keys(safeRows[0] || {}).slice(0, 12);
  return (
    <div className="overflow-auto rounded-2xl border border-slate-200">
      <table className="min-w-[720px] w-full text-left text-[12px]">
        <thead className="bg-slate-50">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-black uppercase tracking-[0.08em] text-slate-600">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white">
          {safeRows.slice(0, 100).map((r, i) => (
            <tr key={i} className={cx(i % 2 ? "bg-white" : "bg-slate-50/40")}>
              {cols.map((c) => {
                const v = r?.[c];
                const isMoney = money && /revenue|amount|paid|profit|gmv|sales/i.test(c);
                const cell =
                  v == null
                    ? "—"
                    : typeof v === "number"
                      ? isMoney
                        ? money(v)
                        : v.toLocaleString()
                      : safeText(v);
                return (
                  <td key={c} className="px-3 py-2 whitespace-nowrap text-slate-700">
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
