// components/common/audiencebadge.jsx
import React from "react";

const AUDIENCE_MAP = {
  women: { name: "Women", color: "#F43F5E", bg: "#FFF1F2" },
  men: { name: "Men", color: "#2563EB", bg: "#DBEAFE" },
  kids: { name: "Kids", color: "#0D9488", bg: "#CCFBF1" },
  young: { name: "Young", color: "#7C3AED", bg: "#EDE9FE" }
};

export default function AudienceBadge({ audience = "women", mini = false, style = {}, className = "" }) {
  const map = AUDIENCE_MAP[audience] ||
    Object.values(AUDIENCE_MAP).find(a => a.name === audience) ||
    { name: typeof audience === "string" ? audience : "Audience", color: "#222", bg: "#eee" };

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
