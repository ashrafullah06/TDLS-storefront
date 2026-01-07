// FILE: src/components/auth/inventory_aging_panel.jsx
"use client";

import useSWR from "swr";

const fetcher = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json());
const fmt = (n) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(n || 0));

export default function InventoryAgingPanel() {
  const { data, isLoading, error, mutate } = useSWR(
    "/api/reports/inventory-aging",
    fetcher,
    { revalidateOnFocus: false }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
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
        <div className="px-4 py-3 font-semibold border-b">Aging Buckets (Units)</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4">
          {["0-30", "31-60", "61-90", "91-180", "181+"].map((b) => (
            <Kpi key={b} label={b} value={fmt(data?.buckets?.[b])} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border">
        <div className="px-4 py-3 font-semibold border-b">Totals</div>
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4 p-4">
          <Kpi label="Units" value={fmt(data?.totals?.units)} />
          <Kpi label="Stock Value" value={fmt(data?.totals?.stockValue)} />
        </div>
      </div>

      <div className="rounded-xl border overflow-x-auto">
        <div className="px-4 py-3 font-semibold border-b">Oldest Inventory (Top 200)</div>
        <table className="min-w-[880px] text-sm">
          <thead>
            <tr className="bg-gray-50">
              {["Product/ID", "SKU", "Qty", "Age (days)", "Cost", "Stock Value", "Bucket"].map((h) => (
                <th key={h} className="text-left px-4 py-2 border-b">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.lines || []).slice(0, 200).map((r) => (
              <tr key={`${r.id}-${r.sku}`} className="odd:bg-white even:bg-gray-50">
                <td className="px-4 py-2 border-b">{r.id}</td>
                <td className="px-4 py-2 border-b">{r.sku}</td>
                <td className="px-4 py-2 border-b">{fmt(r.qty)}</td>
                <td className="px-4 py-2 border-b">{fmt(r.ageDays)}</td>
                <td className="px-4 py-2 border-b">{fmt(r.cost)}</td>
                <td className="px-4 py-2 border-b">{fmt(r.stockValue)}</td>
                <td className="px-4 py-2 border-b">{r.bucket}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">Failed to load inventory aging.</p>}
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
  lines.push(`GENERATED_AT,${data.generatedAt}`);
  lines.push("");
  lines.push("BUCKETS");
  lines.push("0-30,31-60,61-90,91-180,181+");
  lines.push(
    [
      data.buckets["0-30"] || 0,
      data.buckets["31-60"] || 0,
      data.buckets["61-90"] || 0,
      data.buckets["91-180"] || 0,
      data.buckets["181+"] || 0,
    ].join(",")
  );
  lines.push("");
  lines.push("TOTALS");
  lines.push("Units,Stock Value");
  lines.push([data.totals.units, data.totals.stockValue].join(","));
  lines.push("");
  lines.push("DETAIL (Top 500 limited to 200 rows here)");
  lines.push("Product/ID,SKU,Qty,Age (days),Cost,Stock Value,Bucket");
  (data.lines || []).slice(0, 200).forEach((r) =>
    lines.push([r.id, r.sku, r.qty, r.ageDays, r.cost, r.stockValue, r.bucket].join(","))
  );

  const csv = lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory_aging_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}
