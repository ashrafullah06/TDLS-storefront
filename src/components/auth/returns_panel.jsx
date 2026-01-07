// FILE: src/components/auth/returns_panel.jsx
"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";

const fetcher = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json());
const fmt = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(n || 0));

export default function ReturnsPanel() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const last30 = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const [start, setStart] = useState(last30);
  const [end, setEnd] = useState(todayISO);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("start", start);
    p.set("end", end);
    return p.toString();
  }, [start, end]);

  const { data, isLoading, error, mutate } = useSWR(`/api/reports/returns?${qs}`, fetcher, {
    revalidateOnFocus: false,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs text-gray-500">From</div>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border px-2 py-1" />
        </div>
        <div>
          <div className="text-xs text-gray-500">To</div>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded border px-2 py-1" />
        </div>

        <button
          onClick={() => mutate()}
          className="rounded px-4 py-2 font-semibold shadow-sm"
          style={{ background: "#0b1b3b", color: "#fff", border: "1px solid #0b1b3b", cursor: "pointer" }}
        >
          Refresh
        </button>

        <button
          onClick={() => data && exportCsv(data)}
          className="rounded px-4 py-2 font-semibold shadow-sm"
          style={{ background: "#fff", color: "#0b1b3b", border: "1px solid #0b1b3b", cursor: "pointer" }}
          disabled={!data}
        >
          Export CSV
        </button>
      </div>

      <div className="rounded-xl border">
        <div className="px-4 py-3 font-semibold border-b">Totals</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
          <Kpi label="Returns" value={fmt(data?.totals?.returnsCount)} />
          <Kpi label="Items Returned" value={fmt(data?.totals?.itemsReturned)} />
          <Kpi label="Refund Total" value={fmt(data?.totals?.refundTotal)} />
          <Kpi label="Return Rate %" value={`${fmt(data?.totals?.returnRatePct)}%`} />
        </div>
      </div>

      <div className="rounded-xl border overflow-x-auto">
        <div className="px-4 py-3 font-semibold border-b">Top Returned Products</div>
        <table className="min-w-[640px] text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-4 py-2 border-b">Product</th>
              <th className="text-left px-4 py-2 border-b">Units</th>
              <th className="text-left px-4 py-2 border-b">Refund</th>
            </tr>
          </thead>
          <tbody>
            {(data?.byProduct || []).map((r) => (
              <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                <td className="px-4 py-2 border-b">{r.id}</td>
                <td className="px-4 py-2 border-b">{fmt(r.units)}</td>
                <td className="px-4 py-2 border-b">{fmt(r.refund)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border overflow-x-auto">
        <div className="px-4 py-3 font-semibold border-b">Return Reasons</div>
        <table className="min-w-[480px] text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-4 py-2 border-b">Reason</th>
              <th className="text-left px-4 py-2 border-b">Count</th>
            </tr>
          </thead>
          <tbody>
            {(data?.byReason || []).map((r) => (
              <tr key={r.reason} className="odd:bg-white even:bg-gray-50">
                <td className="px-4 py-2 border-b">{r.reason}</td>
                <td className="px-4 py-2 border-b">{fmt(r.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">Failed to load returns.</p>}
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value ?? "—"}</div>
    </div>
  );
}

function exportCsv(data) {
  const lines = [];
  lines.push(`FROM,${data.start}`);
  lines.push(`TO,${data.end}`);
  lines.push("");
  lines.push("TOTALS");
  lines.push("Returns,Items Returned,Refund Total,Return Rate %");
  lines.push(
    [
      data.totals.returnsCount,
      data.totals.itemsReturned,
      data.totals.refundTotal,
      data.totals.returnRatePct,
    ].join(",")
  );
  lines.push("");
  lines.push("BY PRODUCT");
  lines.push("Product,Units,Refund");
  (data.byProduct || []).forEach((r) => lines.push([r.id, r.units, r.refund].join(",")));
  lines.push("");
  lines.push("BY REASON");
  lines.push("Reason,Count");
  (data.byReason || []).forEach((r) => lines.push([r.reason, r.count].join(",")));

  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `returns_${data.start}_to_${data.end}.csv`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}
