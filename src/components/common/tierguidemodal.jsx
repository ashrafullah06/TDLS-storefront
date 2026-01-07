import React, { useRef } from "react";

const TIER_DATA = [
  {
    tier: "Limited",
    color: "#C9B15D",
    desc: "Extremely rare, often limited to a few pieces. Black/gold badge. Highest craftsmanship and collectibility.",
  },
  {
    tier: "Premium",
    color: "#19203B",
    desc: "Top seller, exceptional materials, signature design. Gold/navy badge.",
  },
  {
    tier: "Signature",
    color: "#5A5E4F",
    desc: "Core classics, timeless silhouettes, best value. Olive/blue badge.",
  },
  {
    tier: "Heritage",
    color: "#8C644C",
    desc: "Archival, Bangladesh-rooted, value-based. Cream/maroon badge.",
  },
];

export default function TierGuideModal({ onClose }) {
  const modalRef = useRef(null);
  const pos = useRef({ x: 0, y: 0, left: 0, top: 0, dragging: false });

  // Drag handlers
  function onMouseDown(e) {
    pos.current.dragging = true;
    pos.current.x = e.clientX;
    pos.current.y = e.clientY;
    const modal = modalRef.current;
    if (modal) {
      const rect = modal.getBoundingClientRect();
      pos.current.left = rect.left;
      pos.current.top = rect.top;
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(e) {
    if (!pos.current.dragging) return;
    const dx = e.clientX - pos.current.x;
    const dy = e.clientY - pos.current.y;
    const modal = modalRef.current;
    if (modal) {
      modal.style.left = `${pos.current.left + dx}px`;
      modal.style.top = `${pos.current.top + dy}px`;
      modal.style.margin = "0";
      modal.style.position = "fixed";
    }
  }

  function onMouseUp() {
    pos.current.dragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, zIndex: 9999,
      width: "100vw", height: "100vh", background: "rgba(34,33,33,0.38)",
      display: "flex", alignItems: "center", justifyContent: "center"
    }}>
      <div
        ref={modalRef}
        style={{
          background: "#fff",
          borderRadius: 15,
          maxWidth: 410,
          padding: "2.5em 1.7em",
          boxShadow: "0 4px 36px #211f1e30",
          position: "relative",
          margin: "auto",
        }}
      >
        {/* "Header" drag area */}
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 38,
            borderTopLeftRadius: 15, borderTopRightRadius: 15, cursor: "grab", zIndex: 2,
          }}
          onMouseDown={onMouseDown}
        />
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 12, right: 16,
            fontSize: "1.7em", background: "none", border: "none", cursor: "pointer", color: "#aaa", zIndex: 3,
          }}
          aria-label="Close"
        >×</button>
        <h2 style={{ fontSize: "1.22em", fontWeight: 700, textAlign: "center", color: "#19203B", marginBottom: "1em" }}>
          TDLC Tiering Guide
        </h2>
        <ul style={{ margin: "1.4em 0 0 0", padding: 0, listStyle: "none" }}>
          {TIER_DATA.map(t => (
            <li key={t.tier} style={{ margin: "1.1em 0", padding: 0 }}>
              <span style={{
                display: "inline-block",
                minWidth: 85,
                background: t.color,
                color: "#fff",
                borderRadius: 10,
                padding: "0.19em 1.09em",
                fontWeight: 700,
                fontSize: "0.98em",
                marginRight: 8,
              }}>{t.tier}</span>
              <span style={{ color: "#45433d", fontSize: "0.98em" }}>{t.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
