// FILE: src/components/auth/funnel_dashboard.jsx
"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const fetcher = (url) => fetch(url, { cache: "no-store" }).then((r) => r.json());
const fmt = (n) => new Intl.NumberFormat().format(n ?? 0);

export default function FunnelDashboard() {
  // default to last 30 days
  const todayISO = new Date().toISOString().slice(0, 10);
  const last30 = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [from, setFrom] = useState(last30);
  const [to, setTo] = useState(todayISO);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("start", from);
    if (to) p.set("end", to);
    return p.toString();
  }, [from, to]);

  const { data, isLoading, error, mutate } = useSWR(
    `/api/analytics/funnel${qs ? `?${qs}` : ""}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const steps = useMemo(() => {
    if (Array.isArray(data?.series) && data.series.length > 0) return data.series;
    const t = data?.totals ?? {};
    return [
      { name: "Visited", value: t.visitors ?? 0 },
      { name: "Pressed Signup", value: t.signups ?? 0 },
      { name: "OTP Sent", value: t.otps ?? t.otpSent ?? 0 },
      { name: "OTP Verified", value: t.otpVerified ?? 0 },
      { name: "Account Created", value: t.accounts ?? t.orders ?? 0 },
    ];
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Login Funnel</h2>
          <p className="text-sm text-gray-500">
            {(data?.start || from)} → {(data?.end || to)}
          </p>
        </div>

        <div className="flex items-center gap-6">
          <label className="text-sm">
            From
            <input
              type="date"
              className="ml-2 rounded border px-2 py-1"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            To
            <input
              type="date"
              className="ml-2 rounded border px-2 py-1"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          {/* REFRESH — now guaranteed visible with inline styles */}
          <button
            onClick={() => mutate()}
            aria-label="Refresh analytics"
            className="rounded-xl px-4 py-2 font-semibold shadow-sm"
            style={{
              background: "#0b1b3b",
              color: "#ffffff",
              border: "1px solid #0b1b3b",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#10234d")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#0b1b3b")}
          >
            Refresh
          </button>

          {/* EXPORT CSV — high contrast inline fallback as well */}
          <button
            onClick={() => exportCsv(steps, { from, to })}
            aria-label="Export CSV"
            className="rounded-xl px-4 py-2 font-semibold shadow-sm"
            style={{
              background: "#ffffff",
              color: "#0b1b3b",
              border: "1px solid #0b1b3b",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f7fb")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPI label="Visitors" value={fmt(data?.totals?.visitors)} />
        <KPI label="Signups" value={fmt(data?.totals?.signups)} />
        <KPI label="OTP Sent" value={fmt(data?.totals?.otpSent ?? data?.totals?.otps)} />
        <KPI label="OTP Verified" value={fmt(data?.totals?.otpVerified)} />
        <KPI label="Accounts" value={fmt(data?.totals?.accounts ?? data?.totals?.orders)} />
        <KPI label="Conv. Rate" value={`${data?.totals?.conversionRate ?? 0}%`} />
      </div>

      {/* Chart */}
      <div className="h-[360px] w-full rounded-xl border" style={{ borderColor: "#000" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={steps} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis allowDecimals={false} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Bar dataKey="value" name="Count" fill="#0b1b3b" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Status */}
      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p className="text-sm text-red-600">
          Failed to load analytics. Showing last cached values if available.
        </p>
      )}
      <p className="text-xs text-gray-400">
        Source: {data?.source ?? "unknown"} • {data?.generatedAt}
      </p>
    </div>
  );
}

function KPI({ label, value }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value ?? "—"}</div>
    </div>
  );
}

function exportCsv(rows, meta = {}) {
  const header = ["Step", "Count"];
  const body = rows.map((r) => [r.name, r.value]);
  const lines = [
    `Generated At,${new Date().toISOString()}`,
    meta.from ? `From,${meta.from}` : "",
    meta.to ? `To,${meta.to}` : "",
    "",
    header.join(","),
    ...body.map((r) => r.map(csvEscape).join(",")),
  ].filter(Boolean);

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `login-funnel_${meta.from || "start"}_${meta.to || "end"}.csv`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

function csvEscape(val) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
