// FILE: app/(admin)/admin/checkout/page.js
"use client";

import { useEffect, useMemo, useState } from "react";

export default function CheckoutAdminPage() {
  const [perms, setPerms] = useState(null);
  const [cart, setCart] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json());
        setPerms(s?.user?.permissions || []);
      } catch { setPerms([]); }
    })();
  }, []);

  const canView = useMemo(() => perms?.includes("VIEW_CHECKOUT") || perms?.includes("VIEW_ANALYTICS"), [perms]);

  async function load() {
    setErr("");
    try {
      const [c1, c2] = await Promise.all([
        fetch("/api/cart/summary", { cache: "no-store" }).then(r => r.json()),
        fetch("/api/checkout/summary", { cache: "no-store" }).then(r => r.json()),
      ]);
      setCart(c1); setCheckout(c2);
    } catch (e) { setErr(String(e.message || e)); }
  }
  useEffect(() => { if (canView) load(); }, [canView]);

  if (perms === null) return <div className="text-sm">Checking permissions…</div>;
  if (!canView) return <div className="rounded border bg-white p-4 text-sm text-red-600">You need VIEW_CHECKOUT.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Checkout Monitor</h1>
          <div className="text-xs text-neutral-600 mt-1">Carts, abandonment, and funnel dropoffs.</div>
        </div>
        <button onClick={load} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Refresh</button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid md:grid-cols-4 gap-4">
        <div className="rounded border bg-white p-4"><div className="text-xs text-neutral-500">Active Carts</div><div className="text-2xl font-semibold">{cart?.activeCarts ?? "—"}</div></div>
        <div className="rounded border bg-white p-4"><div className="text-xs text-neutral-500">Avg Items/Cart</div><div className="text-2xl font-semibold">{cart?.avgItems?.toFixed?.(2) ?? "—"}</div></div>
        <div className="rounded border bg-white p-4"><div className="text-xs text-neutral-500">Abandonment (7d)</div><div className="text-2xl font-semibold">{cart?.abandonRate7d != null ? `${cart.abandonRate7d}%` : "—"}</div></div>
        <div className="rounded border bg-white p-4"><div className="text-xs text-neutral-500">Checkout Conversion</div><div className="text-2xl font-semibold">{checkout?.conversion != null ? `${checkout.conversion}%` : "—"}</div></div>
      </div>

      <div className="rounded border bg-white overflow-hidden">
        <div className="p-3 border-b font-medium">Funnel (last 7d)</div>
        <div className="p-4 grid md:grid-cols-4 gap-4 text-sm">
          <div>Shipping: <b>{checkout?.steps?.shipping ?? "—"}</b></div>
          <div>Payment: <b>{checkout?.steps?.payment ?? "—"}</b></div>
          <div>Review: <b>{checkout?.steps?.review ?? "—"}</b></div>
          <div>Confirmed: <b>{checkout?.steps?.confirmed ?? "—"}</b></div>
        </div>
      </div>
    </div>
  );
}
