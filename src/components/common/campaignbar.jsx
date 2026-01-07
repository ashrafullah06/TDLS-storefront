import React from "react";

export default function CampaignBar({ message = "", visible = false }) {
  if (!visible || !message) return null;
  return (
    <div style={{
      width: "100%",
      background: "linear-gradient(90deg, #C9B15D 60%, #fff9e1 100%)",
      color: "#19203B",
      textAlign: "center",
      fontWeight: 600,
      padding: "0.7em 0",
      fontSize: "1.09em",
      letterSpacing: "0.01em",
      boxShadow: "0 1px 8px #c9b15d28",
    }}>
      {message}
    </div>
  );
}
