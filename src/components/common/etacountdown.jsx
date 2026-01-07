import React, { useState, useEffect } from "react";
export default function ETACountdown({ eta }) {
  // eta: e.g., "2025-08-03T20:00:00Z"
  const [time, setTime] = useState("");
  useEffect(() => {
    if (!eta) return;
    const target = new Date(eta);
    const update = () => {
      const now = new Date();
      const diff = target - now;
      if (diff <= 0) { setTime("Arriving soon!"); return; }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff / (1000 * 60)) % 60);
      setTime(`${h}h ${m}m left to get fastest delivery`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [eta]);
  if (!eta) return null;
  return (
    <div style={{
      background: "#f7fcf4", color: "#247d22", borderRadius: 8,
      fontWeight: 800, padding: "7px 18px", margin: "7px 0", fontSize: 15
    }}>
      🚚 {time}
    </div>
  );
}
