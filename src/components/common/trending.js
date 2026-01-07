"use client";
import React, { useEffect, useState } from "react";

// You can fetch trending from your backend, or hardcode for now:
const demoTrending = [
  "Ultra-Premium Blue Aura Tee",
  "Heritage Relaxed Trousers",
  "Signature Maroon Oversized",
  "Best-Seller: Sandstone Beige"
];

export default function Trending() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    // Replace with fetch to your Strapi/Next API if needed!
    setItems(demoTrending);
    // Example for live fetch:
    // fetch("/api/trending")
    //   .then(res => res.json())
    //   .then(data => setItems(data.items || []));
  }, []);

  if (!items.length) return null;
  return (
    <div className="w-full bg-[#FFFDEB] border-b border-[#FFD700] py-2 px-4 flex flex-row items-center gap-3 text-[#181A1B] font-semibold text-base overflow-x-auto whitespace-nowrap select-none">
      <svg width="20" height="20" fill="#FFD700" className="mr-2 shrink-0">
        <circle cx="10" cy="10" r="9" stroke="#FFD700" strokeWidth="1.5" fill="#FFD700"/>
        <text x="10" y="14" textAnchor="middle" fill="#181A1B" fontSize="12" fontWeight="bold">★</text>
      </svg>
      <span className="mr-3 text-[#FFD700]">Trending:</span>
      <div className="flex gap-5 animate-marquee">
        {items.map((item, idx) => (
          <span key={idx} className="px-2">{item}</span>
        ))}
      </div>
      <style jsx>{`
        .animate-marquee {
          animation: marquee 16s linear infinite;
        }
        @keyframes marquee {
          0% { transform: translateX(0);}
          100% { transform: translateX(-60%);}
        }
      `}</style>
    </div>
  );
}
