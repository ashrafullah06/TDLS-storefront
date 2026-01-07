import React from "react";
export default function TrustBadges() {
  return (
    <div style={{ display: "flex", gap: 16, margin: "23px 0 14px 0", flexWrap: "wrap" }}>
      <div style={{ background: "#f3fcf7", color: "#19a949", fontWeight: 700, borderRadius: 10, padding: "8px 16px", fontSize: 15 }}>
        ✔ Authentic Product Guarantee
      </div>
      <div style={{ background: "#f3fcf7", color: "#19a949", fontWeight: 700, borderRadius: 10, padding: "8px 16px", fontSize: 15 }}>
        🔄 7-Day Easy Returns
      </div>
      <div style={{ background: "#f3fcf7", color: "#19a949", fontWeight: 700, borderRadius: 10, padding: "8px 16px", fontSize: 15 }}>
        💳 Secure Payment
      </div>
      {/* Add more badges as desired */}
    </div>
  );
}
