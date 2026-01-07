// FILE: app/(admin)/admin/promotions/page.js
"use client";

import { useEffect, useMemo, useState } from "react";

export default function PromotionsAdminPage() {
  const [perms, setPerms] = useState(null);
  const [tab, setTab] = useState("coupons"); // coupons|banners
  const [coupons, setCoupons] = useState([]);
  const [banners, setBanners] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => { (async () => {
    const j = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json()).catch(() => ({}));
    setPerms(j?.user?.permissions || []);
  })(); }, []);
  const canManage = useMemo(() => perms?.includes("MANAGE_COUPONS") || perms?.includes("MANAGE_SETTINGS"), [perms]);

  async function load() {
    setErr("");
    try {
      const [c, b] = await Promise.all([
        fetch("/api/promotions/coupons", { cache: "no-store" }).then(r => r.json()),
        fetch("/api/promotions/banners", { cache: "no-store" }).then(r => r.json())
      ]);
      setCoupons(c?.items || []); setBanners(b?.items || []);
    } catch (e) { setErr(String(e.message || e)); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Promotions</h1>
          <div className="text-xs text-neutral-600 mt-1">Coupons & banners.</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTab("coupons")} className={`rounded border px-3 py-1 text-sm ${tab==="coupons" ? "bg-neutral-100" : "hover:bg-neutral-50"}`}>Coupons</button>
          <button onClick={() => setTab("banners")} className={`rounded border px-3 py-1 text-sm ${tab==="banners" ? "bg-neutral-100" : "hover:bg-neutral-50"}`}>Banners</button>
          <button onClick={load} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Refresh</button>
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {tab === "coupons" ? (
        <div className="rounded border bg-white overflow-hidden">
          <div className="p-3 border-b font-medium">Coupons</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50"><tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Value</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2 text-left">Window</th>
              </tr></thead>
              <tbody>
                {coupons.map(c => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{c.code}</td>
                    <td className="px-3 py-2">{c.type}</td>
                    <td className="px-3 py-2">{c.value}</td>
                    <td className="px-3 py-2">{String(c.enabled)}</td>
                    <td className="px-3 py-2">{c.startAt ? new Date(c.startAt).toLocaleDateString() : "—"} → {c.endAt ? new Date(c.endAt).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
                {coupons.length === 0 && <tr><td className="px-3 py-3 text-neutral-600" colSpan={5}>No coupons.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded border bg-white overflow-hidden">
          <div className="p-3 border-b font-medium">Banners</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50"><tr>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Placement</th>
                <th className="px-3 py-2 text-left">URL</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2 text-left">Window</th>
              </tr></thead>
              <tbody>
                {banners.map(b => (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{b.title}</td>
                    <td className="px-3 py-2">{b.placement}</td>
                    <td className="px-3 py-2 break-all">{b.url || "—"}</td>
                    <td className="px-3 py-2">{String(b.enabled)}</td>
                    <td className="px-3 py-2">{b.startAt ? new Date(b.startAt).toLocaleDateString() : "—"} → {b.endAt ? new Date(b.endAt).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
                {banners.length === 0 && <tr><td className="px-3 py-3 text-neutral-600" colSpan={5}>No banners.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!canManage && <div className="text-xs text-neutral-500">To edit, you need MANAGE_COUPONS or MANAGE_SETTINGS.</div>}
    </div>
  );
}
