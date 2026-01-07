// FILE: src/components/admin/StockSyncButton.jsx
"use client";

import { useState } from "react";

export default function StockSyncButton() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleClick() {
    setLoading(true);
    setStatus("");
    setError("");

    try {
      const res = await fetch("/api/admin/sync-stock", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      // Safer JSON parse (keeps your original behavior)
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;

      if (!res.ok) {
        const msg = data?.error || data?.message || `Sync failed (${res.status})`;
        throw new Error(msg);
      }

      const totalVariants = data?.totalVariants ?? 0;
      const totalUpdated = data?.totalUpdated ?? 0;

      setStatus(
        `Sync complete – ${totalUpdated} size rows updated from ${totalVariants} variants.`
      );
    } catch (err) {
      console.error("Stock sync error:", err);
      setError(err?.message || "Failed to sync stock.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Syncing stock to Strapi…" : "Sync stock to Strapi"}
      </button>

      {status && (
        <p className="text-[11px] text-emerald-600 text-right max-w-xs">
          {status}
        </p>
      )}

      {error && (
        <p className="text-[11px] text-red-600 text-right max-w-xs">
          {error}
        </p>
      )}
    </div>
  );
}
