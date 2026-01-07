// FILE: app/(admin)/admin/reports/product-pnl/page.js
// Renders nothing until user provides manual input and runs.
// No fake numbers; table shows only real computeProductPnl results.

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function ymd(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const d2 = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${d2}`;
}

export default function ProductPnlPage() {
  const today = useMemo(() => new Date(), []);
  const thirtyAgo = useMemo(() => new Date(today.getTime() - 29 * 86400000), [today]);

  const [ident, setIdent] = useState({ productId: "", sku: "" });
  const [start, setStart] = useState(ymd(thirtyAgo));
  const [end, setEnd] = useState(ymd(today));
  const [group, setGroup] = useState("month");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  async function run() {
    setErr(null); setLoading(true);
    try {
      const params = new URLSearchParams({ start, end, group });
      if (ident.productId) params.set("productId", ident.productId.trim());
      if (!ident.productId && ident.sku) params.set("sku", ident.sku.trim());

      const res = await fetch(`/api/reports/pnl/product?${params.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setData(j);
    } catch (e) {
      setErr(String(e?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {}, []);

  return (
    <div style={{ padding: "1in 0.5in" }}>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 18, background: "#fff", boxShadow: "0 6px 48px #ececec40", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ padding: 20, borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0C2340", letterSpacing: ".02em" }}>Product P&amp;L</div>
          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
            Provide Product ID or SKU and a date range. We will compute actual results from the DB.
          </div>
        </div>

        {/* Controls (manual input) */}
        <div style={{ padding: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(12, minmax(0,1fr))" }}>
          <div style={{ gridColumn: "span 3 / span 3" }}>
            <label className="block text-xs text-neutral-500">Product ID</label>
            <input
              value={ident.productId}
              onChange={(e)=>setIdent(s=>({ ...s, productId: e.target.value }))}
              placeholder="e.g. 123"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div style={{ gridColumn: "span 3 / span 3" }}>
            <label className="block text-xs text-neutral-500">SKU (optional if Product ID given)</label>
            <input
              value={ident.sku}
              onChange={(e)=>setIdent(s=>({ ...s, sku: e.target.value }))}
              placeholder="e.g. TDLC-TEE-001-BLK-M"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div style={{ gridColumn: "span 2 / span 2" }}>
            <label className="block text-xs text-neutral-500">Start</label>
            <input type="date" value={start} onChange={(e)=>setStart(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div style={{ gridColumn: "span 2 / span 2" }}>
            <label className="block text-xs text-neutral-500">End</label>
            <input type="date" value={end} onChange={(e)=>setEnd(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div style={{ gridColumn: "span 2 / span 2" }}>
            <label className="block text-xs text-neutral-500">Group</label>
            <select value={group} onChange={(e)=>setGroup(e.target.value)} className="w-full border rounded px-3 py-2">
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="half">Half</option>
              <option value="year">Year</option>
              <option value="all">All (total)</option>
            </select>
          </div>
          <div style={{ gridColumn: "span 12 / span 12" }}>
            <button
              onClick={run}
              disabled={loading || (!ident.productId && !ident.sku)}
              style={{ background:"#0C2340", color:"#fff", border:"none", borderRadius:10, padding:"10px 14px", fontWeight:800, cursor:"pointer" }}
            >
              {loading ? "Calculating…" : "Run P&L"}
            </button>
            <Link href="/admin/reports" style={{ marginLeft:12, fontSize:13 }}>Back to Reports</Link>
          </div>
        </div>

        {/* Results (only real results; nothing if none) */}
        <div style={{ padding: 16 }}>
          {err && <div className="text-sm text-red-600">{err}</div>}
          {!err && data && (
            <>
              <div className="text-sm text-neutral-600 mb-2">
                {data.brand} • {data.start} → {data.end} • VAT {Math.round((data.vatRate||0)*100)}%
              </div>
              <div className="overflow-auto">
                <table className="min-w-full border">
                  <thead className="bg-neutral-50">
                    <tr className="text-xs text-neutral-600">
                      <th className="text-left p-2 border">Period</th>
                      <th className="text-right p-2 border">Units</th>
                      <th className="text-right p-2 border">Revenue (incl VAT)</th>
                      <th className="text-right p-2 border">VAT</th>
                      <th className="text-right p-2 border">Net Sales</th>
                      <th className="text-right p-2 border">COGS</th>
                      <th className="text-right p-2 border">Gross Profit</th>
                      <th className="text-right p-2 border">Ship Subsidy</th>
                      <th className="text-right p-2 border">Reship</th>
                      <th className="text-right p-2 border">Gateway Fees</th>
                      <th className="text-right p-2 border">Overhead</th>
                      <th className="text-right p-2 border">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows?.length
                      ? data.rows.map((r, i) => (
                          <tr key={i} className="text-sm">
                            <td className="p-2 border">{r.label}</td>
                            <td className="p-2 border text-right">{r.units}</td>
                            <td className="p-2 border text-right">{r.revenueInclVat.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.vatCollected.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.netSalesExVat.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.cogs.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.grossProfit.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.shippingSubsidy.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.reshipCost.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.paymentFees.toFixed(2)}</td>
                            <td className="p-2 border text-right">{r.overheadAllocated.toFixed(2)}</td>
                            <td className="p-2 border text-right font-semibold">{r.netProfit.toFixed(2)}</td>
                          </tr>
                        ))
                      : null}
                    {data.totals && (
                      <tr className="font-semibold bg-neutral-50">
                        <td className="p-2 border">Total</td>
                        <td className="p-2 border text-right">{data.totals.units}</td>
                        <td className="p-2 border text-right">{data.totals.revenueInclVat.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.vatCollected.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.netSalesExVat.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.cogs.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.grossProfit.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.shippingSubsidy.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.reshipCost.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.paymentFees.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.overheadAllocated.toFixed(2)}</td>
                        <td className="p-2 border text-right">{data.totals.netProfit.toFixed(2)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
