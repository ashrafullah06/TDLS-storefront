// components/TierGuideModal.jsx
import React from "react";
import { useOptions } from "@/providers/optionsprovider";
export default function TierGuideModal({ onClose }) {
  const { tiers } = useOptions();
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
      background: "rgba(20,20,30,0.37)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, maxWidth: 420, padding: "2em 2em 2.4em 2em",
        boxShadow: "0 2px 40px #2222", position: "relative"
      }}>
        <button onClick={onClose} style={{
          position: "absolute", top: 12, right: 18, fontSize: 24, background: "none", border: "none", cursor: "pointer", color: "#999"
        }}>×</button>
        <h2 style={{ fontWeight: 800, marginBottom: 16 }}>TDLC Tier Guide</h2>
        <ul style={{ padding: 0, listStyle: "none" }}>
          {tiers.map(t => (
            <li key={t.slug} style={{ marginBottom: 18 }}>
              <span style={{
                background: t.color, color: t.text, borderRadius: 10, padding: "4px 13px", fontWeight: 800, minWidth: 90, display: "inline-block"
              }}>{t.name}</span>
              <span style={{ marginLeft: 10, color: "#444" }}>{t.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
