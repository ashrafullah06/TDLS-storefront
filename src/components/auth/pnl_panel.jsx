// FILE: src/components/auth/pnl_panel.jsx
"use client";

import useSWR from "swr";
import Link from "next/link";
import { useMemo, useState } from "react";

const fetcher = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json());
const fmt = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(n || 0));

export default function PnlPanel() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const last30 = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const [start, setStart] = useState(last30);
  const [end, setEnd] = useState(todayISO);
  const [group, setGroup] = useState("month");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("start", start);
    p.set("end", end);
    p.set("group", group);
    return p.toString();
  }, [start, end, group]);

  const { data, isLoading, error, mutate } = useSWR(`/api/analytics/pnl?${qs}`, fetcher, {
    revalidateOnFocus: false
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
        <div>
          <div className="text-xs text-gray-500">Grouping</div>
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded border px-2 py-1">
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
            <option value="half">Half-Yearly</option>
            <option value="year">Yearly</option>
            <option value="total">Total</option>
          </select>
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

        <a
          href={`/api/analytics/pnl/pdf?${qs}`}
          target="_blank"
          rel="noreferrer"
          className="rounded px-4 py-2 font-semibold shadow-sm"
          style={{ background: "#0b1b3b", color: "#fff", border: "1px solid #0b1b3b" }}
        >
          Download PDF
        </a>
      </div>

      {/* Totals */}
      <div className="rounded-xl border">
        <div className="px-4 py-3 font-semibold border-b">Totals</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
          <Kpi label="Revenue" value={fmt(data?.totals?.revenue)} />
          <Kpi label="COGS" value={fmt(data?.totals?.cogs)} />
          <Kpi label="Profit" value={fmt(data?.totals?.profit)} />
          <Kpi label="Margin %" value={`${fmt(data?.totals?.margin)}%`} />
        </div>
      </div>

      {/* By Period */}
      <div className="rounded-xl border overflow-x-auto">
        <div className="px-4 py-3 font-semibold border-b">By Period</div>
        <table className="min-w-[720px] text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-4 py-2 border-b">Period</th>
              <th className="text-left px-4 py-2 border-b">Revenue</th>
              <th className="text-left px-4 py-2 border-b">COGS</th>
              <th className="text-left px-4 py-2 border-b">Profit</th>
              <th className="text-left px-4 py-2 border-b">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {(data?.byPeriod || []).map((r) => (
              <tr key={r.period} className="odd:bg-white even:bg-gray-50">
                <td className="px-4 py-2 border-b">{r.period}</td>
                <td className="px-4 py-2 border-b">{fmt(r.revenue)}</td>
                <td className="px-4 py-2 border-b">{fmt(r.cogs)}</td>
                <td className="px-4 py-2 border-b">{fmt(r.profit)}</td>
                <td className="px-4 py-2 border-b">{fmt(r.margin)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Products: make each row a link to product P&L */}
      {data?.byPeriod?.length ? (
        <div className="rounded-xl border overflow-x-auto">
          <div className="px-4 py-3 font-semibold border-b">
            Top Products (Period: {data.byPeriod[data.byPeriod.length - 1].period})
          </div>
          <table className="min-w-[880px] text-sm">
            <thead>
              <tr className="bg-gray-50">
                {["Product", "Units", "Revenue", "COGS", "Profit", "Margin %", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2 border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.byPeriod[data.byPeriod.length - 1].byProduct.slice(0, 50).map((p) => (
                <tr key={p.id} className="odd:bg-white even:bg-gray-50">
                  <td className="px-4 py-2 border-b">{p.label || p.id}</td>
                  <td className="px-4 py-2 border-b">{p.units}</td>
                  <td className="px-4 py-2 border-b">{fmt(p.revenue)}</td>
                  <td className="px-4 py-2 border-b">{fmt(p.cogs)}</td>
                  <td className="px-4 py-2 border-b">{fmt(p.profit)}</td>
                  <td className="px-4 py-2 border-b">{fmt(p.margin)}%</td>
                  <td className="px-4 py-2 border-b">
                    {/* Prefer productId if the id looks numeric, else pass as sku */}
                    {String(p.id).startsWith("variant:") ? (
                      <Link
                        href={`/admin/reports/pnl/product/${encodeURIComponent(String(p.id).replace(/^variant:/, ""))}?kind=variant&${new URLSearchParams({ start, end, group })}`}
                        className="rounded px-3 py-1 border border-[#0b1b3b] text-[#0b1b3b] hover:bg-[#f6f7fb]"
                      >
                        View P&L
                      </Link>
                    ) : /^\d+$/.test(String(p.id)) ? (
                      <Link
                        href={`/admin/reports/pnl/product/${p.id}?kind=product&${new URLSearchParams({ start, end, group })}`}
                        className="rounded px-3 py-1 border border-[#0b1b3b] text-[#0b1b3b] hover:bg-[#f6f7fb]"
                      >
                        View P&L
                      </Link>
                    ) : (
                      <Link
                        href={`/admin/reports/pnl/product/${encodeURIComponent(p.id)}?kind=sku&${new URLSearchParams({ start, end, group })}`}
                        className="rounded px-3 py-1 border border-[#0b1b3b] text-[#0b1b3b] hover:bg-[#f6f7fb]"
                      >
                        View P&L
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">Failed to load P&L.</p>}
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
  lines.push(`GROUP,${data.group}`);
  lines.push("");
  lines.push("TOTALS");
  lines.push("Revenue,COGS,Profit,Margin%");
  lines.push([data.totals.revenue, data.totals.cogs, data.totals.profit, data.totals.margin].join(","));
  lines.push("");
  lines.push("BY PERIOD");
  lines.push("Period,Revenue,COGS,Profit,Margin%");
  data.byPeriod.forEach((r) => {
    lines.push([r.period, r.revenue, r.cogs, r.profit, r.margin].join(","));
  });

  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pnl_${data.start}_to_${data.end}_${data.group}.csv`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}
