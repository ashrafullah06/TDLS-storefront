// components/common/eventbadge.jsx
import React from "react";

const EVENT_MAP = {
  "new-arrival": { name: "New Arrival", color: "#C084FC", bg: "#F3E8FF" },
  "on-sale": { name: "On Sale", color: "#E11D48", bg: "#FFE4E6" },
  "monsoon": { name: "Monsoon", color: "#0EA5E9", bg: "#E0F2FE" },
  "summer": { name: "Summer", color: "#FBBF24", bg: "#FEF9C3" },
  "winter": { name: "Winter", color: "#2563EB", bg: "#DBEAFE" }
};

export default function EventBadge({ event = "new-arrival", mini = false, style = {}, className = "" }) {
  const map = EVENT_MAP[event] ||
    Object.values(EVENT_MAP).find(e => e.name === event) ||
    { name: typeof event === "string" ? event : "Event", color: "#222", bg: "#eee" };

  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        background: map.bg,
        color: map.color,
        borderRadius: mini ? 8 : 12,
        padding: mini ? "0.08em 0.5em" : "0.18em 1em",
        fontWeight: 600,
        fontSize: mini ? "0.83em" : "0.91em",
        marginRight: 6,
        marginBottom: mini ? 0 : 3,
        boxShadow: "0 1px 6px 0 rgba(0,0,0,0.05)",
        verticalAlign: "middle",
        ...style
      }}
      title={map.name}
    >
      {map.name}
    </span>
  );
}
