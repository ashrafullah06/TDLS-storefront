// FILE: src/components/admin/analytics/kpi-board.jsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error || `Failed: ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function moneyBDT(v) {
  const x = n(v, 0);
  return x.toLocaleString("en-BD", { maximumFractionDigits: 2 });
}

function titleCase(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function kvTableRows(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).map(([k, v]) => ({
    key: k,
    value: typeof v === "number" ? String(v) : String(v ?? "—"),
  }));
}

const TAB_KEYS = [
  { key: "overview", label: "Overview" },
  { key: "orders", label: "Orders" },
  { key: "products", label: "Products" },
  { key: "customers", label: "Customers" },
  { key: "otp", label: "OTP" },
  { key: "returns", label: "Returns" },
  { key: "inventory", label: "Inventory" },
  { key: "staff", label: "Staff" },
  { key: "pnl", label: "P&L" },
  { key: "profit", label: "Profit" },
  { key: "projections", label: "Projections" },
];

export default function AdminKpiBoard() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [days, setDays] = useState(30);
  const [compare, setCompare] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  const [analytics, setAnalytics] = useState(null);
  const [health, setHealth] = useState(null);

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("days", String(days));
      q.set("include", "all");
      q.set("group", "day");
      q.set("pnlGroup", "month");
      if (compare) q.set("compare", "1");

      const [a, h] = await Promise.allSettled([
        fetchJson(`/api/admin/analytics?${q.toString()}`),
        fetchJson("/api/health/summary"),
      ]);

      if (a.status === "fulfilled") setAnalytics(a.value);
      if (h.status === "fulfilled") setHealth(h.value);

      const failures = [a, h].filter((x) => x.status === "rejected");
      if (failures.length) {
        setErr("Some analytics sections failed to load; refresh to retry.");
      }
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, compare]);

  const expanded = analytics?.expanded || null;
  const data = expanded?.data || {};
  const meta = expanded?.meta || {};

  const overview = data?.overview || null;
  const orders = data?.orders || null;
  const products = data?.products || null;
  const customers = data?.customers || null;
  const otp = data?.otp || null;
  const returns = data?.returns || null;
  const inventory = data?.inventory || null;
  const staff = data?.staff || null;
  const pnl = data?.pnl || null;
  const profit = data?.profit || null;
  const projections = data?.projections || null;

  // Keep your existing top tiles behavior, but prefer overview KPIs when present
  const kpis = overview?.kpis || {};
  const legacyTotals = analytics?.totals || {};
  const legacySeries = safeArr(analytics?.series);

  const totalOrders = n(kpis.ordersCount, n(legacyTotals.orders, 0));
  const revenuePaid = n(kpis.revenuePaid, n(legacyTotals.revenuePaid, 0));
  const paidOrders = n(kpis.paidOrdersCount, n(orders?.totals?.paidOrders, 0));

  // Order status snapshot (prefer overview breakdowns; fallback to orders.pipeline/byStatus when present)
  const statusRows =
    safeArr(overview?.breakdowns?.status) ||
    safeArr(orders?.pipeline?.byStatus) ||
    [];
  const statusMap = useMemo(() => {
    const m = new Map();
    for (const r of statusRows) {
      const k = String(r?.key || r?.status || "").toUpperCase();
      if (!k) continue;
      m.set(k, n(r?.count, 0));
    }
    return m;
  }, [statusRows]);

  const completedOrders =
    statusMap.get("COMPLETED") ??
    statusMap.get("DELIVERED") ??
    statusMap.get("FULFILLED") ??
    0;

  const cancelledOrders = statusMap.get("CANCELLED") ?? statusMap.get("CANCELED") ?? 0;

  const totalCustomers = n(customers?.leaders?.length ? customers?.leaders?.length : 0, 0);
  // If your customers module returns a total count, prefer it:
  const customersTotalFromModule =
    n(customers?.totals?.customers, n(customers?.totals?.count, 0));
  const customersShown = customersTotalFromModule || totalCustomers;

  const totalReturns = n(returns?.totals?.returns, 0);

  // Inventory summary
  const onHand = n(inventory?.totals?.onHand, 0);
  const reserved = n(inventory?.totals?.reserved, 0);
  const safety = n(inventory?.totals?.safety, 0);

  const exportQuery = useMemo(() => {
    const q = new URLSearchParams();
    q.set("days", String(days));
    q.set("include", "all");
    q.set("group", "day");
    q.set("pnlGroup", "month");
    if (compare) q.set("compare", "1");
    return q.toString();
  }, [days, compare]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Key Performance Overview</h2>
          <p className="mt-1 text-xs text-neutral-600">
            Orders, revenue, customers, returns, inventory, OTP, products, staff, P&amp;L, profit,
            projections — using real DB analytics.
          </p>
          {meta?.from && (
            <p className="mt-1 text-[11px] text-neutral-500">
              Window: {new Date(meta.from).toLocaleString()} →{" "}
              {meta.untilExclusive ? new Date(meta.untilExclusive).toLocaleString() : "—"} • Days:{" "}
              {meta.days ?? days} • Compare: {meta.compare ? "On" : "Off"}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded border bg-white px-2 py-1 text-xs"
            aria-label="Days"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>

          <button
            onClick={() => setCompare((v) => !v)}
            className="rounded border bg-white px-3 py-1 text-xs hover:bg-neutral-50"
            title="Toggle compare with previous window"
          >
            Compare: {compare ? "On" : "Off"}
          </button>

          <button
            onClick={load}
            className="rounded border bg-white px-3 py-1 text-xs hover:bg-neutral-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {err}
        </div>
      ) : null}

      {/* Top KPI tiles (kept as-is styling) */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Orders (window)</div>
          <div className="mt-1 text-2xl font-semibold">
            {loading && totalOrders === 0 ? "…" : totalOrders}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Completed: {completedOrders} • Cancelled: {cancelledOrders}
          </div>
        </div>

        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Revenue Paid (BDT)</div>
          <div className="mt-1 text-2xl font-semibold">
            {loading && revenuePaid === 0 ? "…" : moneyBDT(revenuePaid)}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Paid Orders: {paidOrders}
          </div>
        </div>

        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Customers</div>
          <div className="mt-1 text-2xl font-semibold">
            {loading && customersShown === 0 ? "…" : customersShown}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Leaders list: {safeArr(customers?.leaders).length}
          </div>
        </div>

        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Returns</div>
          <div className="mt-1 text-2xl font-semibold">
            {loading && totalReturns === 0 ? "…" : totalReturns}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Exchanges: {n(returns?.totals?.exchanges, 0)} • Refunds:{" "}
            {n(returns?.totals?.refunds, 0)}
          </div>
        </div>
      </div>

      {/* Export controls */}
      <div className="rounded border bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-neutral-600">
            Export the same analytics shown below (RBAC protected).
          </div>
          <div className="flex items-center gap-2">
            <a
              className="rounded border bg-white px-3 py-1 text-xs hover:bg-neutral-50"
              href={`/api/admin/analytics/export/pdf?${exportQuery}`}
            >
              Export PDF
            </a>
            <a
              className="rounded border bg-white px-3 py-1 text-xs hover:bg-neutral-50"
              href={`/api/admin/analytics/export/xlsx?${exportQuery}`}
            >
              Export Excel
            </a>
            <a
              className="rounded border bg-white px-3 py-1 text-xs hover:bg-neutral-50"
              href={`/api/admin/analytics/export/docx?${exportQuery}`}
            >
              Export DOCX
            </a>
          </div>
        </div>
      </div>

      {/* Tabs (new, minimal, matches existing aesthetic) */}
      <div className="rounded border bg-white p-2">
        <div className="flex flex-wrap gap-2">
          {TAB_KEYS.map((t) => {
            const active = t.key === activeTab;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={[
                  "rounded px-3 py-1 text-xs border transition",
                  active
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded border bg-white p-4 text-sm">
            <div className="text-xs text-neutral-500">Overview KPIs</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="text-[11px] text-neutral-500">Paid rate</div>
                <div className="mt-1 text-lg font-semibold">
                  {n(kpis.paidRate, 0)}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-neutral-500">AOV (Paid)</div>
                <div className="mt-1 text-lg font-semibold">
                  {moneyBDT(n(kpis.aov, n(kpis.aovPaid, 0)))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-neutral-500">Net revenue</div>
                <div className="mt-1 text-lg font-semibold">
                  {moneyBDT(n(kpis.netRevenue, 0))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-neutral-500">Refund amount</div>
                <div className="mt-1 text-lg font-semibold">
                  {moneyBDT(n(kpis.refundsProcessedAmount, 0))}
                </div>
              </div>
            </div>

            {safeArr(overview?.breakdowns?.paymentStatus).length ? (
              <div className="mt-4 border-t pt-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Payment status breakdown
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {overview.breakdowns.paymentStatus.slice(0, 8).map((r) => (
                    <div key={r.key} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-700">{titleCase(r.key)}</span>
                      <span className="text-neutral-500">{r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 text-[11px] text-neutral-500">
                No overview breakdowns returned.
              </div>
            )}
          </div>

          <div className="rounded border bg-white p-4 text-sm">
            <div className="text-xs text-neutral-500">Timeseries snapshot</div>
            <div className="mt-2 text-[11px] text-neutral-500">
              (Legacy series kept; useful for charts.)
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b bg-neutral-50">
                    <th className="px-2 py-1 text-left">Day</th>
                    <th className="px-2 py-1 text-left">Orders</th>
                    <th className="px-2 py-1 text-left">Revenue Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {legacySeries.slice(Math.max(0, legacySeries.length - 14)).map((r) => (
                    <tr key={r.day} className="border-t">
                      <td className="px-2 py-1 font-mono text-[11px]">{r.day}</td>
                      <td className="px-2 py-1">{n(r.orders, 0)}</td>
                      <td className="px-2 py-1">{moneyBDT(n(r.revenuePaid, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === "orders" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Orders module</div>
          {orders ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Totals
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {kvTableRows(orders.totals || {}).slice(0, 16).map((r) => (
                    <div key={r.key} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-700">{titleCase(r.key)}</span>
                      <span className="text-neutral-500">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Pipeline
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {kvTableRows(orders.pipeline || {}).slice(0, 16).map((r) => (
                    <div key={r.key} className="flex items-center justify-between text-xs">
                      <span className="text-neutral-700">{titleCase(r.key)}</span>
                      <span className="text-neutral-500">{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {safeArr(orders.series).length ? (
                <div className="rounded border bg-white p-3 lg:col-span-2">
                  <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                    Orders series (sample)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b bg-neutral-50">
                          <th className="px-2 py-1 text-left">Key</th>
                          <th className="px-2 py-1 text-left">Orders</th>
                          <th className="px-2 py-1 text-left">Revenue Paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.series.slice(0, 20).map((r, idx) => (
                          <tr key={`${r.key || r.day || idx}`} className="border-t">
                            <td className="px-2 py-1 font-mono text-[11px]">
                              {r.key || r.day || "—"}
                            </td>
                            <td className="px-2 py-1">{n(r.orders, 0)}</td>
                            <td className="px-2 py-1">{moneyBDT(n(r.revenuePaid, 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No orders module returned.</div>
          )}
        </div>
      )}

      {activeTab === "products" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Products module</div>
          {products ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Best sellers
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b bg-neutral-50">
                        <th className="px-2 py-1 text-left">Name</th>
                        <th className="px-2 py-1 text-left">Units</th>
                        <th className="px-2 py-1 text-left">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safeArr(products.bestSellers).slice(0, 20).map((p) => (
                        <tr key={p.variantId || p.productId || p.name} className="border-t">
                          <td className="px-2 py-1">{p.name || "—"}</td>
                          <td className="px-2 py-1">{n(p.units, n(p.qty, 0))}</td>
                          <td className="px-2 py-1">{moneyBDT(n(p.revenue, 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Trending
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b bg-neutral-50">
                        <th className="px-2 py-1 text-left">Name</th>
                        <th className="px-2 py-1 text-left">Score</th>
                        <th className="px-2 py-1 text-left">Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safeArr(products.trending).slice(0, 20).map((p) => (
                        <tr key={p.variantId || p.productId || p.name} className="border-t">
                          <td className="px-2 py-1">{p.name || "—"}</td>
                          <td className="px-2 py-1">{p.score ?? "—"}</td>
                          <td className="px-2 py-1">{p.delta ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No products module returned.</div>
          )}
        </div>
      )}

      {activeTab === "customers" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Customers module</div>
          {customers ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Account leaders (top spenders)
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b bg-neutral-50">
                        <th className="px-2 py-1 text-left">Customer</th>
                        <th className="px-2 py-1 text-left">Orders</th>
                        <th className="px-2 py-1 text-left">Spend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safeArr(customers.leaders).slice(0, 25).map((c) => (
                        <tr key={c.userId || c.email || c.phone || c.label} className="border-t">
                          <td className="px-2 py-1">
                            {c.label || c.email || c.phone || c.userId || "—"}
                          </td>
                          <td className="px-2 py-1">{n(c.orders, 0)}</td>
                          <td className="px-2 py-1">{moneyBDT(n(c.spend, 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Cart &amp; Wishlist
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] text-neutral-500">Active carts</div>
                    <div className="mt-1 text-lg font-semibold">
                      {n(customers.cart?.activeCartsCount, 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Wishlist items</div>
                    <div className="mt-1 text-lg font-semibold">
                      {n(customers.wishlist?.itemsCount, 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Cart items</div>
                    <div className="mt-1 text-lg font-semibold">
                      {n(customers.cart?.itemsCount, 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Cart value (BDT)</div>
                    <div className="mt-1 text-lg font-semibold">
                      {moneyBDT(n(customers.cart?.cartValue, 0))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No customers module returned.</div>
          )}
        </div>
      )}

      {activeTab === "otp" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">OTP module</div>
          {otp ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Totals
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] text-neutral-500">Created</div>
                    <div className="mt-1 text-lg font-semibold">{n(otp.totals?.created, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Consumed</div>
                    <div className="mt-1 text-lg font-semibold">{n(otp.totals?.consumed, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Success rate</div>
                    <div className="mt-1 text-lg font-semibold">
                      {n(otp.totals?.successRate, 0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Resends</div>
                    <div className="mt-1 text-lg font-semibold">{n(otp.totals?.resends, 0)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  By purpose
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b bg-neutral-50">
                        <th className="px-2 py-1 text-left">Purpose</th>
                        <th className="px-2 py-1 text-left">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(otp.byPurpose || {})
                        .sort((a, b) => n(b[1], 0) - n(a[1], 0))
                        .slice(0, 25)
                        .map(([purpose, count]) => (
                          <tr key={purpose} className="border-t">
                            <td className="px-2 py-1">{purpose}</td>
                            <td className="px-2 py-1">{n(count, 0)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {otp.projection ? (
                <div className="rounded border bg-white p-3 lg:col-span-2">
                  <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                    Projection
                  </div>
                  <div className="text-xs text-neutral-700">
                    Method: <span className="font-mono">{otp.projection.method}</span> • Periods
                    used: {n(otp.projection.periodsUsed, 0)} • Next created:{" "}
                    {n(otp.projection.nextPeriodCreated, 0)} • Next resends:{" "}
                    {n(otp.projection.nextPeriodResends, 0)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No OTP module returned.</div>
          )}
        </div>
      )}

      {activeTab === "returns" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Returns / Exchanges / Refunds module</div>
          {returns ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">Totals</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] text-neutral-500">Returns</div>
                    <div className="mt-1 text-lg font-semibold">{n(returns.totals?.returns, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Exchanges</div>
                    <div className="mt-1 text-lg font-semibold">
                      {n(returns.totals?.exchanges, 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Refunds</div>
                    <div className="mt-1 text-lg font-semibold">{n(returns.totals?.refunds, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-neutral-500">Return rate</div>
                    <div className="mt-1 text-lg font-semibold">
                      {n(returns.totals?.returnRate, 0)}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Top returned variants
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b bg-neutral-50">
                        <th className="px-2 py-1 text-left">SKU</th>
                        <th className="px-2 py-1 text-left">Title</th>
                        <th className="px-2 py-1 text-left">Returned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safeArr(returns.topReturnedVariants).slice(0, 25).map((v) => (
                        <tr key={v.variantId || v.sku || v.title} className="border-t">
                          <td className="px-2 py-1 font-mono text-[11px]">{v.sku || "—"}</td>
                          <td className="px-2 py-1">{v.title || "—"}</td>
                          <td className="px-2 py-1">{n(v.qtyReturned, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border bg-white p-3 lg:col-span-2">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Reasons (returns / exchanges / refunds)
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { k: "returnReason", label: "Return reasons" },
                    { k: "exchangeReason", label: "Exchange reasons" },
                    { k: "refundReason", label: "Refund reasons" },
                  ].map((box) => (
                    <div key={box.k} className="rounded border bg-white p-3">
                      <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                        {box.label}
                      </div>
                      <div className="space-y-1">
                        {Object.entries(returns.breakdowns?.[box.k] || {})
                          .sort((a, b) => n(b[1], 0) - n(a[1], 0))
                          .slice(0, 10)
                          .map(([reason, count]) => (
                            <div key={reason} className="flex items-center justify-between text-xs">
                              <span className="text-neutral-700">{reason}</span>
                              <span className="text-neutral-500">{n(count, 0)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No returns module returned.</div>
          )}
        </div>
      )}

      {activeTab === "inventory" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500">Inventory &amp; Safety Stock</div>
              <div className="mt-1 text-sm text-neutral-700">
                On-hand vs reserved and safety stock across all warehouses.
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div>
              <div className="text-[11px] text-neutral-500">On-hand</div>
              <div className="mt-1 text-lg font-semibold">{onHand}</div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Reserved</div>
              <div className="mt-1 text-lg font-semibold">{reserved}</div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Safety stock</div>
              <div className="mt-1 text-lg font-semibold">{safety}</div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Available</div>
              <div className="mt-1 text-lg font-semibold">{Math.max(0, onHand - reserved)}</div>
            </div>
          </div>

          {safeArr(inventory?.top_low_stock).length ? (
            <div className="mt-4 border-t pt-3">
              <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                Most critical low-stock variants
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b bg-neutral-50">
                      <th className="px-2 py-1 text-left">SKU</th>
                      <th className="px-2 py-1 text-left">Product</th>
                      <th className="px-2 py-1 text-left">On-hand</th>
                      <th className="px-2 py-1 text-left">Safety stock</th>
                      <th className="px-2 py-1 text-left">Warehouse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.top_low_stock.map((v) => (
                      <tr key={v.variantId} className="border-t">
                        <td className="px-2 py-1 font-mono text-[11px]">{v.sku || "—"}</td>
                        <td className="px-2 py-1">{v.product || "—"}</td>
                        <td className="px-2 py-1">{n(v.onHand, 0)}</td>
                        <td className="px-2 py-1">{n(v.safetyStock, 0)}</td>
                        <td className="px-2 py-1">{v.warehouse || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-4 text-[11px] text-neutral-500">
              No low-stock list returned.
            </div>
          )}
        </div>
      )}

      {activeTab === "staff" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Staff module</div>
          {staff ? (
            <div className="mt-3">
              <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                Leaders
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b bg-neutral-50">
                      <th className="px-2 py-1 text-left">Staff</th>
                      <th className="px-2 py-1 text-left">Actions</th>
                      <th className="px-2 py-1 text-left">Orders touched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safeArr(staff.leaders).slice(0, 30).map((s) => (
                      <tr key={s.staffId || s.email || s.name} className="border-t">
                        <td className="px-2 py-1">{s.name || s.email || s.staffId || "—"}</td>
                        <td className="px-2 py-1">{n(s.actions, n(s.count, 0))}</td>
                        <td className="px-2 py-1">{n(s.ordersTouched, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 text-[11px] text-neutral-500">
                If leaders are empty, check your staff aggregation source (OrderEvent/AuditLog) and
                date window in the compute module.
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No staff module returned.</div>
          )}
        </div>
      )}

      {activeTab === "pnl" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">P&amp;L module</div>
          {pnl ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b bg-neutral-50">
                    <th className="px-2 py-1 text-left">Period</th>
                    <th className="px-2 py-1 text-left">Revenue</th>
                    <th className="px-2 py-1 text-left">Cost</th>
                    <th className="px-2 py-1 text-left">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {safeArr(pnl.rows || pnl.series || [])
                    .slice(0, 36)
                    .map((r, idx) => (
                      <tr key={r.key || r.period || idx} className="border-t">
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {r.key || r.period || r.group || "—"}
                        </td>
                        <td className="px-2 py-1">{moneyBDT(n(r.revenue ?? r.sales, 0))}</td>
                        <td className="px-2 py-1">{moneyBDT(n(r.cost ?? r.cogs, 0))}</td>
                        <td className="px-2 py-1">{moneyBDT(n(r.profit ?? r.grossProfit, 0))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No P&amp;L module returned.</div>
          )}
        </div>
      )}

      {activeTab === "profit" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Profit module</div>
          {profit ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b bg-neutral-50">
                    <th className="px-2 py-1 text-left">Key</th>
                    <th className="px-2 py-1 text-left">Revenue</th>
                    <th className="px-2 py-1 text-left">Cost</th>
                    <th className="px-2 py-1 text-left">Profit</th>
                    <th className="px-2 py-1 text-left">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {safeArr(profit.rows || profit.items || [])
                    .slice(0, 50)
                    .map((r, idx) => (
                      <tr key={r.key || r.sku || r.variantId || idx} className="border-t">
                        <td className="px-2 py-1 font-mono text-[11px]">
                          {r.key || r.sku || r.variantId || r.productId || "—"}
                        </td>
                        <td className="px-2 py-1">{moneyBDT(n(r.revenue, 0))}</td>
                        <td className="px-2 py-1">{moneyBDT(n(r.cost, 0))}</td>
                        <td className="px-2 py-1">{moneyBDT(n(r.profit, 0))}</td>
                        <td className="px-2 py-1">
                          {r.margin != null ? `${n(r.margin, 0)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No profit module returned.</div>
          )}
        </div>
      )}

      {activeTab === "projections" && (
        <div className="rounded border bg-white p-4 text-sm">
          <div className="text-xs text-neutral-500">Projections module</div>
          {projections ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Monthly projection (sample)
                </div>
                <div className="text-xs text-neutral-700">
                  Method: <span className="font-mono">{projections?.monthly?.method || "—"}</span>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b bg-neutral-50">
                        <th className="px-2 py-1 text-left">Month</th>
                        <th className="px-2 py-1 text-left">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {safeArr(projections?.monthly?.months || projections?.monthly?.rows || []).slice(0, 24).map((r, idx) => (
                        <tr key={r.month || r.key || idx} className="border-t">
                          <td className="px-2 py-1 font-mono text-[11px]">{r.month || r.key || "—"}</td>
                          <td className="px-2 py-1">{moneyBDT(n(r.revenue, 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border bg-white p-3">
                <div className="text-[11px] font-semibold text-neutral-600 mb-2">
                  Forecast (next)
                </div>
                <div className="text-xs text-neutral-700">
                  Horizon: {n(projections?.monthly?.projection?.horizon, n(projections?.horizon, 0))}
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  {safeArr(projections?.monthly?.projection?.next || projections?.next || []).slice(0, 12).map((v, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-neutral-600">+{i + 1}</span>
                      <span className="text-neutral-800">{moneyBDT(n(v, 0))}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-neutral-500">No projections module returned.</div>
          )}
        </div>
      )}

      {/* System status mini-strip from health API (kept) */}
      <div className="rounded border bg-white p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-neutral-500">System Health Snapshot</div>
            <div className="mt-1 text-sm text-neutral-700">
              Status and diagnostics (health API).
            </div>
          </div>

          {health ? (
            <span
              className={[
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
                String(health.status || "").toLowerCase() === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-800",
              ].join(" ")}
            >
              {health.status}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-neutral-600">
              {loading ? "…" : "No data"}
            </span>
          )}
        </div>

        <div className="mt-3 text-[11px] text-neutral-500">
          Updated at:{" "}
          {health?.timestamp ? new Date(health.timestamp).toLocaleString() : "—"}
        </div>
      </div>
    </div>
  );
}
