import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

export default function FraudStatusBadge({ userId }) {
  const [loading, setLoading] = useState(true);
  const [fraud, setFraud] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let ignore = false;
    setLoading(true);
    async function fetchFraud() {
      try {
        const res = await fetch(`${API_BASE}/api/fraudstatus?user=${userId}`);
        const json = await res.json();
        setFraud(json.data || json);
      } catch {
        setFraud(null);
      } finally {
        setLoading(false);
      }
    }
    fetchFraud();
    return () => { ignore = true; };
  }, [userId]);

  // Color logic
  let color = "#22a745", bg = "#e7faea", text = "Verified";
  if (fraud?.status === "review") {
    color = "#fbbf24"; bg = "#fef7e1"; text = "Under Review";
  } else if (fraud?.status === "blocked") {
    color = "#f44336"; bg = "#fff2ef"; text = "Blocked";
  }

  // Responsive
  const responsive = `
    @media (max-width: 600px) {
      .fraud-badge { font-size: 13.5px !important; min-width: 140px !important;}
    }
  `;

  if (loading) return (
    <div className="fraud-badge" style={{
      background: "#f7fbe4", color: "#222", borderRadius: 7, fontWeight: 700, fontSize: 15,
      display: "inline-block", padding: "10px 16px", margin: "8px 0", minWidth: 140, textAlign: "center"
    }}>
      <style>{responsive}</style>
      Checking security status...
    </div>
  );

  if (!fraud) return (
    <div className="fraud-badge" style={{
      background: "#fff3e4", color: "#b2290c", borderRadius: 7, fontWeight: 700, fontSize: 15,
      display: "inline-block", padding: "10px 16px", margin: "8px 0", minWidth: 140, textAlign: "center"
    }}>
      <style>{responsive}</style>
      Security status unavailable.
    </div>
  );

  return (
    <div className="fraud-badge" style={{
      background: bg,
      color: color,
      borderRadius: 9,
      fontWeight: 800,
      fontSize: 15.5,
      border: `1.1px solid ${color}`,
      display: "inline-block",
      padding: "10px 24px",
      margin: "8px 0",
      minWidth: 155,
      boxShadow: "0 1px 7px #d9eaca35",
      textAlign: "center"
    }}>
      <style>{responsive}</style>
      <span style={{ fontSize: 15, fontWeight: 900 }}>{text}</span>
      <span style={{ marginLeft: 7, color: "#888", fontWeight: 600, fontSize: 13 }}>
        {fraud.reason || (fraud.status === "clear" ? "No suspicious activity." : "")}
      </span>
      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
        Checked {fraud.lastChecked ? new Date(fraud.lastChecked).toLocaleString() : "now"}
      </div>
    </div>
  );
}
