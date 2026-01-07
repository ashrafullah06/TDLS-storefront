"use client";
import React, { useEffect, useState } from "react";

// Demo FOMO messages — replace with your real logic!
const messages = [
  "🔥 7 people are viewing this right now.",
  "Only 2 left in stock — order soon!",
  "Last purchased 5 minutes ago.",
  "This style is trending this week."
];

export default function FOMO() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex(i => (i + 1) % messages.length), 4200);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed bottom-24 left-8 z-50 bg-white/95 border border-yellow-300 rounded-2xl shadow-lg px-6 py-3 flex items-center gap-2 font-semibold text-gray-900 text-base pointer-events-none select-none"
      style={{ minWidth: 280, maxWidth: 320, transition: "all .35s cubic-bezier(.4,1.3,.4,1)" }}>
      <svg width="22" height="22" fill="none" stroke="#FFD700" strokeWidth="2" className="mr-2">
        <circle cx="11" cy="11" r="10" />
        <path d="M11 7v4l2 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{messages[index]}</span>
    </div>
  );
}
