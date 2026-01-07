// FILE: app/(admin)/admin/payments/paymentsclient.jsx
"use client";

import { useEffect, useState } from "react";

export default function PaymentsClient() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      setErr("");
      setLoading(true);
      try {
        const r = await fetch("/api/payments/providers", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "load failed");
        setProviders(j.providers || []);
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function reconcile() {
    setErr("");
    const r = await fetch("/api/payments/reconcile", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Reconcile failed"); return; }

    // refresh providers (if they surface unsettled counts)
    const rr = await fetch("/api/payments/providers", { cache: "no-store" });
    const jj = await rr.json();
    if (rr.ok) setProviders(jj.providers || []);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Payments</h1>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {loading ? (
        <div className="text-sm">Loading providers…</div>
      ) : (
        <div className="rounded border bg-white">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="font-medium">Providers</div>
            <button
              onClick={reconcile}
              className="rounded border px-3 py-1 text-sm hover:bg-neutral-50"
            >
              Reconcile
            </button>
          </div>
          <div className="divide-y">
            {(providers || []).map((p) => (
              <div key={p.code} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {p.label}{" "}
                    <span className="text-xs text-neutral-500">({p.code})</span>
                  </div>
                  <div className="text-xs text-neutral-600">
                    Mode: {p.mode} • Enabled: {String(p.enabled)}
                  </div>
                  {typeof p.unsettledAmount === "number" && (
                    <div className="text-xs text-neutral-600">
                      Unsettled: ৳{Number(p.unsettledAmount).toFixed(2)}
                    </div>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    p.enabled
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-neutral-50 text-neutral-600 border border-neutral-200"
                  }`}
                >
                  {p.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            ))}
            {(!providers || providers.length === 0) && (
              <div className="p-4 text-sm text-neutral-600">
                No providers configured.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
