// FILE: src/components/common/nav_searchbar.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Refined UI + fully working behaviors (click, Enter, quick hints).
 * Preserves your original features and hints.
 */
export default function NavSearchbar({
  className = "",
  onSubmit,
  placeholder = "Search products…",
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  const gotoSearch = (term) => {
    const t = (term ?? "").trim();
    if (!t) return;
    if (typeof onSubmit === "function") onSubmit(t);
    router.push(`/search?q=${encodeURIComponent(t)}&scope=sitewide`);
    try {
      window.dispatchEvent(new CustomEvent("tdlc:search", { detail: { q: t, source: "navbar" } }));
    } catch {}
    // Optional UX: keep focus but collapse hints
    setFocused(false);
  };

  const clear = () => setQ("");

  // Click-away to close hints
  useEffect(() => {
    const onPointer = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) setFocused(false);
    };
    const opts = { capture: true, passive: true };
    document.addEventListener("pointerdown", onPointer, opts);
    return () => document.removeEventListener("pointerdown", onPointer, opts);
  }, []);

  // Slightly larger, pill UI; responsive width via CSS clamp; safe minimums
  const containerStyle = useMemo(
    () => ({
      display: "flex",
      alignItems: "center",
      background: "#F8F6EE",
      border: "1px solid #ECE9DB",
      margin: 0,
      padding: "2px 10px 2px 10px",
      position: "relative",
      maxWidth: 320,
      minWidth: 128,
      width: "clamp(140px, 24vw, 260px)",
      borderRadius: 9999,
      boxShadow: focused ? "0 8px 20px rgba(12,35,64,.06)" : "0 2px 6px rgba(12,35,64,.04)",
      transition: "box-shadow .15s ease, background .2s ease",
    }),
    [focused]
  );

  return (
    <div className={`${className}`} ref={wrapperRef}>
      <form
        role="search"
        aria-label="Sitewide"
        onSubmit={(e) => {
          e.preventDefault();
          gotoSearch(q);
        }}
        className="tdlc-search-form"
        style={{ position: "relative" }}
      >
        <div className="tdlc-searchwrap" style={containerStyle}>
          <button
            type="submit"
            aria-label="Search"
            className="tdlc-search-ico"
            title="Search"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#0c2340" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20L17 17" />
            </svg>
          </button>

          <input
            ref={inputRef}
            className="tdlc-search-input"
            aria-label="Search input"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                clear();
                inputRef.current?.blur();
              }
            }}
            inputMode="search"
            autoComplete="off"
          />

          {q ? (
            <button type="button" className="tdlc-clear" aria-label="Clear search" onClick={clear} title="Clear">
              ×
            </button>
          ) : null}
        </div>
      </form>

      {/* Quick hints (mouseDown so it doesn't blur input before navigation) */}
      <div className={`tdlc-hints ${focused ? "show" : ""}`} role="listbox" aria-label="Quick tips">
        <div className="tdlc-hint" role="option" onMouseDown={() => gotoSearch("T-shirt")}>T-shirt</div>
        <div className="tdlc-hint" role="option" onMouseDown={() => gotoSearch("Trouser")}>Trouser</div>
        <div className="tdlc-hint" role="option" onMouseDown={() => gotoSearch("New arrivals")}>New arrivals</div>
      </div>

      <style jsx>{`
        .tdlc-search-ico {
          background: transparent;
          border: none;
          padding: 8px 6px 8px 4px;
          display: flex;
          align-items: center;
          cursor: pointer;
        }
        .tdlc-search-input {
          flex: 1 1 auto;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          padding: 8px 8px 8px 6px;
          font-size: 14px;
          letter-spacing: 0.03em;
          color: #0c2340;
        }
        .tdlc-search-input::placeholder { color: #6b7280; }
        .tdlc-clear {
          background: transparent;
          border: none;
          padding: 6px 4px;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          color: #0c2340;
        }

        .tdlc-hints {
          position: absolute;
          margin-top: 6px;
          padding: 6px;
          background: #ffffff;
          border: 1px solid #ece9db;
          border-radius: 10px;
          box-shadow: 0 10px 24px rgba(12, 35, 64, 0.08);
          width: max(180px, min(60vw, 280px));
          max-width: 90vw;
          display: none;
          z-index: 9998;
        }
        .tdlc-hints.show { display: block; }
        .tdlc-hint {
          padding: 8px 10px;
          font-size: 14px;
          color: #0c2340;
          cursor: pointer;
          border-radius: 8px;
        }
        .tdlc-hint:hover { background: #f6f5ee; }

        /* Make sure hints never overflow off-screen on small devices */
        @media (max-width: 480px) {
          .tdlc-hints {
            left: auto;
            right: 0;
            width: min(86vw, 320px);
          }
        }
      `}</style>
    </div>
  );
}
