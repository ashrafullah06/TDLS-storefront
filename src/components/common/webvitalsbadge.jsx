import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

export default function WebVitalsBadge({ userId }) {
  const [loading, setLoading] = useState(true);
  const [vitals, setVitals] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let ignore = false;
    setLoading(true);
    async function fetchVitals() {
      try {
        const res = await fetch(`${API_BASE}/api/webvitals?user=${userId}`);
        const json = await res.json();
        setVitals(json.data || json);
      } catch {
        setVitals(null);
      } finally {
        setLoading(false);
      }
    }
    fetchVitals();
    return () => { ignore = true; };
  }, [userId]);

  const color = vitals?.score === "Excellent"
    ? "#22a745" : vitals?.score === "Good"
    ? "#fdc50a" : "#f44336";

  // Responsive
  const responsive = `
    @media (max-width: 600px) {
      .wv-badge { font-size: 13.5px !important; min-width: 160px !important;}
    }
  `;

  if (loading) return (
    <div className="wv-badge" style={{
      background: "#f7fbe4", color: "#222", borderRadius: 7, fontWeight: 700, fontSize: 15,
      display: "inline-block", padding: "10px 18px", margin: "8px 0", minWidth: 160, textAlign: "center"
    }}>
      <style>{responsive}</style>
      Checking site performance...
    </div>
  );

  if (!vitals) return (
    <div className="wv-badge" style={{
      background: "#fff3e4", color: "#b2290c", borderRadius: 7, fontWeight: 700, fontSize: 15,
      display: "inline-block", padding: "10px 18px", margin: "8px 0", minWidth: 160, textAlign: "center"
    }}>
      <style>{responsive}</style>
      Web Vitals unavailable.
    </div>
  );

  return (
    <div className="wv-badge" style={{
      background: "#f5fff9",
      color,
      borderRadius: 9,
      fontWeight: 800,
      fontSize: 15.8,
      border: `1.1px solid ${color}`,
      display: "inline-block",
      padding: "10px 24px",
      margin: "8px 0",
      minWidth: 180,
      boxShadow: "0 1px 7px #aeeada35",
      textAlign: "center"
    }}>
      <style>{responsive}</style>
      <span style={{ fontSize: 15, fontWeight: 900, color }}>{vitals.score || "Web Vitals"}</span>
      <span style={{ marginLeft: 8, color: "#45a", fontWeight: 600, fontSize: 13 }}>
        (LCP: {vitals.lcp || "?"}s, CLS: {vitals.cls ?? "?"}, FID: {vitals.fid ?? "?"}ms)
      </span>
      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
        Device: {vitals.device || "Unknown"} · Checked {vitals.checkedAt ? new Date(vitals.checkedAt).toLocaleString() : "now"}
      </div>
    </div>
  );
}
