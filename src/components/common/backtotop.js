"use client";
import React, { useEffect, useState, useRef } from "react";

// Brand colors (tweak as desired)
const BUTTON_BG = "#181A1B"; // rich black/navy
const GOLD = "#FFD700";
const ICON_COLOR = "#232425";

export default function BackToTop() {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const btnRef = useRef();

  // Show when scrolled past 300px, and track progress %
  useEffect(() => {
    function handleScroll() {
      const winH = window.innerHeight;
      const docH = document.body.scrollHeight - winH;
      const scrolled = window.scrollY;
      setVisible(scrolled > 300);
      setProgress(docH ? Math.min(100, Math.round((scrolled / docH) * 100)) : 0);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Tooltip on hover/focus (pure JS)
  function showTooltip(show) {
    if (!btnRef.current) return;
    const tip = btnRef.current.querySelector(".backtotop-tip");
    if (tip) tip.style.opacity = show ? 1 : 0;
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (btnRef.current) btnRef.current.blur();
  }

  // Progress ring (outer SVG border)
  const RADIUS = 25, STROKE = 4;
  const circ = 2 * Math.PI * RADIUS;
  const offset = circ - (progress / 100) * circ;

  return (
    <button
      ref={btnRef}
      onClick={scrollToTop}
      tabIndex={0}
      aria-label="Back to top"
      className={`
        fixed z-[110]
        bottom-8 right-8
        flex items-center justify-center
        rounded-full shadow-2xl
        transition-all duration-300
        ${visible ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-4 pointer-events-none"}
        group
      `}
      style={{
        width: 64,
        height: 64,
        background: BUTTON_BG,
        border: `2.5px solid ${GOLD}`,
        boxShadow: "0 6px 32px 0 rgba(40,32,15,0.16)",
        outline: "none"
      }}
      onMouseEnter={() => showTooltip(true)}
      onFocus={() => showTooltip(true)}
      onMouseLeave={() => showTooltip(false)}
      onBlur={() => showTooltip(false)}
    >
      {/* Progress ring SVG */}
      <svg
        width={58}
        height={58}
        style={{ position: "absolute", top: 3, left: 3, zIndex: 1 }}
      >
        <circle
          cx={29}
          cy={29}
          r={RADIUS}
          fill="none"
          stroke="#eee"
          strokeWidth={STROKE}
        />
        <circle
          cx={29}
          cy={29}
          r={RADIUS}
          fill="none"
          stroke={GOLD}
          strokeWidth={STROKE}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 0.3s",
            filter: "drop-shadow(0 0 2px #FFD70077)"
          }}
        />
      </svg>
      {/* Up arrow icon */}
      <span
        className="relative z-10 flex items-center justify-center"
        style={{ width: 32, height: 32 }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path
            d="M16 24V10M16 10L8 18M16 10L24 18"
            stroke={ICON_COLOR}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {/* Tooltip */}
      <span
        className="backtotop-tip pointer-events-none select-none absolute left-1/2 -translate-x-1/2 -top-3
          text-xs rounded-md bg-black/90 text-[#FFD700] px-3 py-1 transition-all duration-200"
        style={{
          opacity: 0,
          marginBottom: 60,
          whiteSpace: "nowrap",
          zIndex: 10,
        }}
      >
        Back to Top
      </span>
    </button>
  );
}
