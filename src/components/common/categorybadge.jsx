// components/common/categorybadge.jsx
import React from "react";

// You can extend this map with your most-used categories and unique colors
const CATEGORY_MAP = {
  "t-shirt": { name: "T-Shirt", color: "#10B981", bg: "#ECFDF5" },
  "sharee": { name: "Sharee", color: "#EA580C", bg: "#FFEDD5" },
  "panjabi": { name: "Panjabi", color: "#3B82F6", bg: "#DBEAFE" },
  "bed-sheet": { name: "Bed Sheet", color: "#D97706", bg: "#FEF3C7" },
  "jacket": { name: "Jacket", color: "#6366F1", bg: "#EEF2FF" }
  // ...add more as needed
};

export default function CategoryBadge({ category = "t-shirt", mini = false, style = {}, className = "" }) {
  const map = CATEGORY_MAP[category] ||
    Object.values(CATEGORY_MAP).find(c => c.name === category) ||
    { name: typeof category === "string" ? category.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()) : "Category", color: "#222", bg: "#eee" };

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
        boxShadow: "0 1px 6px 0 rgba(0,0,0,0.04)",
        verticalAlign: "middle",
        ...style
      }}
      title={map.name}
    >
      {map.name}
    </span>
  );
}
