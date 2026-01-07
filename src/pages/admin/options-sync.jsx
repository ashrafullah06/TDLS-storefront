// src/pages/admin/options-sync.jsx
import React from "react";
import OptionsProvider, { useOptions } from "@/providers/optionsprovider";

// Force runtime render (no static prerender at build)
export async function getServerSideProps() {
  return { props: {} };
}

function OptionsSyncInner() {
  const { refreshOptions, lastSync, loading, syncError } = useOptions();

  return (
    <div style={{ maxWidth: 640, margin: "40px auto", textAlign: "center", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Options Admin</h1>

      <div style={{ color: "#475569", marginBottom: 12 }}>
        Last Sync: {lastSync ? new Date(lastSync).toLocaleString() : "Never"}
      </div>

      {syncError ? (
        <div style={{ color: "#b91c1c", marginBottom: 12 }}>{syncError}</div>
      ) : null}

      <button
        onClick={refreshOptions}
        disabled={loading}
        style={{
          marginTop: 12,
          background: "#19203B",
          color: "#fff",
          fontWeight: 700,
          borderRadius: 8,
          fontSize: 16,
          padding: "12px 24px",
          border: "none",
          boxShadow: "0 2px 12px #e3eaf644",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Refreshing…" : "Refresh Options"}
      </button>

      <div style={{ marginTop: 16, fontSize: 13, color: "#64748b" }}>
        Status: {loading ? "Loading data…" : "Idle"}
      </div>
    </div>
  );
}

export default function OptionSyncAdmin() {
  // Wrap this Pages route with the same provider you use in App Router
  return (
    <OptionsProvider>
      <OptionsSyncInner />
    </OptionsProvider>
  );
}
