import React from "react";

export default function ColorGradientBG() {
  return (
    <div
      style={{
        position: "fixed",
        zIndex: 0,
        inset: 0,
        width: "100vw",
        height: "100vh",
        background:
          "linear-gradient(120deg, #C9B15D 0%, #F8F8F3 44%, #19203B 100%)",
        opacity: 0.98,
        pointerEvents: "none",
      }}
      aria-hidden="true"
    />
  );
}
