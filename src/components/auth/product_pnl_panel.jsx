// FILE: src/components/auth/product_pnl_panel.jsx
"use client";

import { useEffect, useMemo, useState } from "react";

const fmt = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(n || 0));

export default function ProductPnlPanel({ pid, kind = "product", start = "", end = "", initialGroup = "month" }) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const last30 = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(start || last30);
  const [to, setTo] = useState(end || todayISO);
  const [group, setGroup] = useState(initialGroup);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("start", from);
    p.set("end", to);
    p.set("group", group);
    if (kind === "sku") p.set("sku", pid);
    else if (kind === "variant") p.set("variantId", pid);
    else p.set("productId", pid);
    return p.toString();
  }, [from, to, group, pid, kind]);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/reports/pnl/product?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setErr(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  // FIX: useEffect for initial load (was useMemo before)
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const f = data?.filter || {};
  const label =
    f.label || (kind === "sku" ? `SKU: ${pid}` : kind === "variant" ? `Variant: ${pid}` : `Product ID: ${pid}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="text-sm">
          <div className="text-xs text-gray-500">Product</div>
          <div className="font-semibold">{label}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">From</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border px-2 py-1" />
        </div>
        <div>
          <div className="text-xs text-gray-500">To</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border px-2 py-1" />
        </div>
        <div>
          <div className="text-xs text-gray-500">Grouping</div>
          <select value={group} onChange={(e) => setGroup(e.target.value)} className="rounded border px-2 py-1">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="quarter">Quarterly</option>
            <option value="half">Half-Yearly</option>
            <option value="year">Yearly</option>
            <option value="total">Total</option>
          </select>
        </div>

        <button
          onClick={load}
          className="rounded px-4 py-2 font-semibold shadow-sm"
          style={{ background: "#0b1b3b", color: "#fff", border: "1px solid #0b1b3b", cursor: "pointer" }}
        >
          Refresh
        </button>

        <a
          href={`/api/reports/pnl/product/pdf?${qs}`}
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
              {["Period", "Revenue", "COGS", "Profit", "Margin %"].map((h) => (
                <th key={h} className="text-left px-4 py-2 border-b">{h}</th>
              ))}
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

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {err && <p className="text-sm text-red-600">Failed to load: {err}</p>}
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
