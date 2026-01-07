import React from "react";

export default function ProductSwatch({ product, variants = [], onSelect }) {
  if (!variants || variants.length === 0) return null;
  // Assuming variant object: { id, color, size, ... }
  // Group by color
  const colorMap = {};
  variants.forEach(v => {
    const color = v.color || v.attributes?.color || "Unknown";
    if (!colorMap[color]) colorMap[color] = [];
    colorMap[color].push(v);
  });

  return (
    <div style={{ margin: "16px 0" }}>
      <div style={{ fontWeight: 700, color: "#888", fontSize: 15, marginBottom: 5 }}>
        Available Colors:
      </div>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        {Object.keys(colorMap).map(color => (
          <button
            key={color}
            aria-label={`Select color ${color}`}
            style={{
              width: 34, height: 34, borderRadius: "50%",
              border: "2px solid #ccc", background: color, cursor: "pointer",
              boxShadow: "0 1px 5px #ddd"
            }}
            onClick={() => onSelect && onSelect(colorMap[color][0])}
            title={color}
          />
        ))}
      </div>
      {/* Sizes, if available */}
      {variants[0].size && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, color: "#888", fontSize: 15, marginBottom: 5 }}>
            Sizes:
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {[...new Set(variants.map(v => v.size))].map(size => (
              <button
                key={size}
                aria-label={`Select size ${size}`}
                style={{
                  border: "1.5px solid #888",
                  borderRadius: 7,
                  background: "#fff",
                  fontWeight: 800,
                  fontSize: 15,
                  minWidth: 40,
                  padding: "5px 13px",
                  cursor: "pointer"
                }}
                onClick={() => onSelect && onSelect(variants.find(v => v.size === size))}
              >{size}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
