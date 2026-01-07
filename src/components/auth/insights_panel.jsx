// FILE: src/components/auth/insights_panel.jsx
"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";

const fetcher = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json());
const fmt = (n) => new Intl.NumberFormat().format(n ?? 0);

function useDateWindow() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const last30 = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [start, setStart] = useState(last30);
  const [end, setEnd] = useState(todayISO);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    return p.toString();
  }, [start, end]);
  return { start, end, setStart, setEnd, qs };
}

export default function InsightsPanel() {
  const { start, end, setStart, setEnd, qs } = useDateWindow();
  const { data, isLoading, error, mutate } = useSWR(
    `/api/analytics/insights?${qs}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Product Insights</h2>
          <p className="text-sm text-gray-500">
            {data?.start || start} → {data?.end || end}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <label className="text-sm">
            From
            <input type="date" className="ml-2 rounded border px-2 py-1" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="text-sm">
            To
            <input type="date" className="ml-2 rounded border px-2 py-1" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <button
            onClick={() => mutate()}
            className="rounded-xl px-4 py-2 font-semibold shadow-sm"
            style={{ background: "#0b1b3b", color: "#fff", border: "1px solid #0b1b3b", cursor: "pointer" }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Table
          title="Top Products — Units"
          cols={["Product", "Units"]}
          rows={(data?.topProductsByUnits || []).map((r) => [r.label, fmt(r.units)])}
        />
        <Table
          title="Top Products — Revenue"
          cols={["Product", "Revenue"]}
          rows={(data?.topProductsByRevenue || []).map((r) => [r.label, fmt(r.revenue)])}
        />
        <Table
          title="Most Viewed Products"
          cols={["Product", "Views"]}
          rows={(data?.mostViewedProducts || []).map((r) => [r.label, fmt(r.count)])}
        />
        <Table
          title="Most Added to Cart"
          cols={["Product", "Adds"]}
          rows={(data?.popularAddsToCart || []).map((r) => [r.label, fmt(r.count)])}
        />
        <Table
          title="Abandoned Cart — Products"
          cols={["Product", "Qty in Open Carts"]}
          rows={(data?.abandonedCartProducts || []).map((r) => [r.label, fmt(r.count)])}
        />
        <Table
          title="Repeat Customers"
          cols={["Customer", "Orders"]}
          rows={(data?.repeatCustomers || []).map((r) => [r.name, fmt(r.orders)])}
        />
        <Table
          title="Top Search Terms"
          cols={["Term", "Count"]}
          rows={(data?.topSearchTerms || []).map((r) => [r.term, fmt(r.count)])}
        />
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">Failed to load insights.</p>}
    </div>
  );
}

function Table({ title, cols, rows }) {
  return (
    <div className="rounded-xl border">
      <div className="px-4 py-3 font-semibold border-b">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              {cols.map((c) => (
                <th key={c} className="text-left px-4 py-2 border-b">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="px-4 py-3 text-gray-500" colSpan={cols.length}>—</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="odd:bg-white even:bg-gray-50">
                  {r.map((cell, j) => (
                    <td key={j} className="px-4 py-2 border-b">{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
