// clubbar.jsx
"use client";
import React from "react";

const HOMEPAGE_BG = "#F9FAF9";

export default function ClubBar() {
  const iconStyle = {
    borderRadius: "50%",
    background: "#fff",
    width: 38,
    height: 38,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2.5px 14px #bfa75018, 0 1.5px 5px #0c234008"
  };
  const labelStyle = {
    fontFamily: "Playfair Display, serif",
    fontWeight: 600,
    fontSize: 12.5,
    color: "#0c2340",
    textAlign: "center",
    marginTop: 4,
    letterSpacing: ".03em",
    textShadow: "0 1.5px 5px #fffde066"
  };
  return (
    <div
      style={{
        position: "fixed",
        top: 96,
        left: 0,
        zIndex: 2147483647,
        background: HOMEPAGE_BG,
        borderTopRightRadius: 23,
        borderBottomRightRadius: 28,
        padding: "11px 23px 11px 13px",
        minWidth: 92,
        display: "flex",
        alignItems: "center",
        gap: "22px",
        boxShadow: "0 2.5px 13px #ece4d733"
      }}
    >
      {/* Club */}
      <a href="/club" aria-label="TDLC Club"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 38, textDecoration: "none" }}>
        <span style={iconStyle}>
          <svg width={25} height={25} fill="none">
            <circle cx="12.5" cy="12.5" r="10.8" stroke="#BFA750" strokeWidth="2.1" />
            <text x="50%" y="58%" dominantBaseline="middle" textAnchor="middle" fontSize="9.5" fill="#0c2340" fontFamily="serif" fontWeight="bold">C</text>
          </svg>
        </span>
        <span style={labelStyle}>Club</span>
      </a>
      {/* Wishlist */}
      <a href="/wishlist" aria-label="Wishlist"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 38, textDecoration: "none" }}>
        <span style={iconStyle}>
          <svg width={25} height={25} fill="none">
            <path d="M7 10C5 12 10 19 12.5 21C15 19 20 12 18 10C16 8 12.5 10 12.5 10C12.5 10 9 8 7 10Z"
              stroke="#0c2340" strokeWidth="2.1" fill="none" />
          </svg>
        </span>
        <span style={labelStyle}>Wishlist</span>
      </a>
      {/* Bag */}
      <a href="/bag" aria-label="Bag"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 38, textDecoration: "none" }}>
        <span style={iconStyle}>
          <svg width={23} height={25} fill="none">
            <rect x="4.2" y="7.2" width="14.6" height="10.6" rx="2.1" stroke="#0c2340" strokeWidth="2.1" />
            <path d="M8 7V5.3a4.5 4.5 0 019 0V7" stroke="#BFA750" strokeWidth="1.5" />
          </svg>
        </span>
        <span style={labelStyle}>Bag</span>
      </a>
      {/* Account */}
      <a href="/customer/dashboard" aria-label="Account"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 38, textDecoration: "none" }}>
        <span style={iconStyle}>
          <svg width={24} height={24} fill="none">
            <circle cx="12" cy="10" r="4.3" stroke="#0c2340" strokeWidth="2.1" />
            <path d="M5 21c2.5-4.2 11.5-4.2 13.9 0" stroke="#BFA750" strokeWidth="1.5" />
          </svg>
        </span>
        <span style={labelStyle}>Account</span>
      </a>
    </div>
  );
}
