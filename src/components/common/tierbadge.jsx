// components/common/tierbadge.jsx
import React from "react";
import TierGuideModal from "./tierguidemodal";

const TIER_MAP = {
  "limited-edition": { name: "Limited Edition", color: "#C9B15D", bg: "#211F1E" },
  "premium-collection": { name: "Premium Collection", color: "#19203B", bg: "#C9B15D" },
  "signature-series": { name: "Signature Series", color: "#5A5E4F", bg: "#F2F2F2" },
  "heritage-collection": { name: "Heritage Collection", color: "#8C644C", bg: "#FFF6E0" },
  // For backwards compatibility (just in case)
  "Limited": { name: "Limited Edition", color: "#C9B15D", bg: "#211F1E" },
  "Premium": { name: "Premium Collection", color: "#19203B", bg: "#C9B15D" },
  "Signature": { name: "Signature Series", color: "#5A5E4F", bg: "#F2F2F2" },
  "Heritage": { name: "Heritage Collection", color: "#8C644C", bg: "#FFF6E0" }
};

export default function TierBadge({
  tier = "premium-collection",
  showInfo = true,
  mini = false,
  style = {},
  className = ""
}) {
  // Accept either slug or label, auto-map to style & display name
  const map = TIER_MAP[tier] || Object.values(TIER_MAP).find(obj => obj.name === tier) || {
    name: typeof tier === "string" ? tier : "Unknown Tier",
    color: "#222",
    bg: "#eee"
  };

  const [showGuide, setShowGuide] = React.useState(false);

  return (
    <>
      <span
        className={className}
        style={{
          display: "inline-block",
          background: map.bg,
          color: map.color,
          borderRadius: mini ? 8 : 12,
          padding: mini ? "0.1em 0.55em" : "0.26em 1.15em",
          fontWeight: 700,
          fontSize: mini ? "0.85em" : "0.93em",
          marginRight: 6,
          marginBottom: mini ? 1 : 4,
          boxShadow: "0 1px 6px 0 rgba(0,0,0,0.06)",
          cursor: showInfo ? "pointer" : "default",
          verticalAlign: "middle",
          ...style
        }}
        title={showInfo ? `This product is in our ${map.name}. Click for details.` : map.name}
        onClick={showInfo ? () => setShowGuide(true) : undefined}
        tabIndex={0}
      >
        {map.name}
        {showInfo && !mini && (
          <span style={{ marginLeft: 8, fontSize: "1.1em", color: "#bbb" }}>ⓘ</span>
        )}
      </span>
      {showGuide && showInfo && (
        <TierGuideModal onClose={() => setShowGuide(false)} />
      )}
    </>
  );
}
