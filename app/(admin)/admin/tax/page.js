// FILE: app/(admin)/admin/tax/page.js
"use client";

import { useEffect, useMemo, useState } from "react";

export default function TaxAdminPage() {
  const [perms, setPerms] = useState(null);
  const [data, setData] = useState(null);
  const [rules, setRules] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/session", { cache: "no-store" });
      const j = await r.json();
      setPerms(j?.user?.permissions || []);
    })();
  }, []);

  const canView = useMemo(() => perms?.includes("VIEW_TAX"), [perms]);
  const canManage = useMemo(() => perms?.includes("MANAGE_TAX"), [perms]);

  async function load() {
    setErr(""); setLoading(true);
    try {
      const [a, b] = await Promise.all([
        fetch("/api/tax/summary", { cache: "no-store" }).then(r => r.json()),
        fetch("/api/tax/rules", { cache: "no-store" }).then(r => r.json()),
      ]);
      setData(a); setRules(b.rules || []);
    } catch (e) {
      setErr(String(e.message || e));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (!perms) return <div className="text-sm">Checking permissions…</div>;
  if (!canView) return <div className="rounded border bg-white p-4 text-sm text-red-600">Missing VIEW_TAX.</div>;

  async function addRule() {
    if (!canManage) return;
    const name = prompt("Rule name?");
    const rate = Number(prompt("Rate %?"));
    if (!name || !Number.isFinite(rate)) return;
    const r = await fetch("/api/tax/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, rate }) });
    const j = await r.json(); if (!r.ok) return alert(j.error || "failed");
    await load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Tax / VAT</h1>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {loading ? <div className="text-sm">Loading…</div> : (
        <>
          <div className="rounded border bg-white">
            <div className="p-4 border-b font-medium">Summary</div>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-neutral-500">Taxable Orders</div><div className="font-medium">{data?.taxableOrders ?? "—"}</div></div>
              <div><div className="text-neutral-500">Tax Collected</div><div className="font-medium">৳{Number(data?.taxCollected || 0).toFixed(2)}</div></div>
              <div><div className="text-neutral-500">Effective Rate</div><div className="font-medium">{Number(data?.effectiveRate || 0).toFixed(2)}%</div></div>
              <div><div className="text-neutral-500">Last 30d</div><div className="font-medium">৳{Number(data?.taxCollected30d || 0).toFixed(2)}</div></div>
            </div>
          </div>

          <div className="rounded border bg-white overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-medium">Rules</div>
              {canManage && <button onClick={addRule} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Add Rule</button>}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Rate %</th>
                    <th className="px-3 py-2 text-left">Zone</th>
                    <th className="px-3 py-2 text-left">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.rate}</td>
                      <td className="px-3 py-2">{r.zone || "—"}</td>
                      <td className="px-3 py-2">{String(r.active)}</td>
                    </tr>
                  ))}
                  {rules.length === 0 && <tr><td className="px-3 py-2 text-neutral-600" colSpan={4}>No rules.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
