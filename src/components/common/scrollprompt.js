"use client";
import React, { useEffect, useState } from "react";

export default function ScrollPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      if (window.scrollY < 80) setVisible(true);
      else setVisible(false);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return visible ? (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-8 md:bottom-16 z-[70] flex flex-col items-center pointer-events-none"
      style={{ animation: "fadeInUp 1s" }}
    >
      <div className="rounded-full bg-black/70 px-5 py-2 flex items-center gap-2 shadow-xl">
        <svg width="18" height="18" fill="none" stroke="#FFD700" strokeWidth="2" className="animate-bounce">
          <path d="M9 4v10M9 14l-5-5M9 14l5-5" />
        </svg>
        <span className="text-[#FFD700] text-base font-medium select-none">Scroll to explore more</span>
      </div>
    </div>
  ) : null;
}
