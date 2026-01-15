// FILE: src/components/common/navbar.jsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Logorotator from "@/components/common/logorotator";
import Slidingmenubar from "@/components/common/slidingmenubar";
import HomePanel from "@/components/common/homepanel";
import NavSearchbar from "@/components/common/nav_searchbar";

function HomeButton({ onClick, isActive }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      aria-label="Home"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      type="button"
      className="tdlc-homebtn"
      style={{
        marginLeft: 0,
        marginRight: 18,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 64,
        cursor: "pointer",
        background: "none",
        border: "none",
        outline: "none",
        flex: "0 0 auto",
        padding: 0,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        className="tdlc-homebtn-icon"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 20,
          width: 44,
          height: 44,
          background:
            hover || isActive
              ? "linear-gradient(135deg, #fffbe6 60%, #f8edc2 100%)"
              : "linear-gradient(135deg, #fcfbf4 50%, #f1ede2 100%)",
          boxShadow:
            hover || isActive
              ? "0 6px 24px #e8c98277, 0 3px 9px #0c23401a"
              : "0 2.5px 13px #e7dac944, 0 2px 7px #0c23400f",
          border: hover || isActive ? "2.4px solid #BFA750" : "2.4px solid #ede8cf",
          transform: hover || isActive ? "scale(1.06)" : "scale(1.0)",
          transition: "all .18s cubic-bezier(.7,.1,.8,1.2)",
        }}
      >
        <svg
          className="tdlc-homebtn-svg"
          width="28"
          height="28"
          fill="none"
          stroke="#BFA750"
          strokeWidth="2.4"
          viewBox="0 0 32 32"
          aria-hidden
        >
          <path d="M6 16L16 7L26 16" />
          <rect x="10.6" y="18.6" width="10.8" height="7.6" rx="2" stroke="#0c2340" strokeWidth="2" />
        </svg>
      </span>

      <span
        className="tdlc-home-label"
        style={{
          marginTop: 6,
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: ".12em",
          color: "#0c2340",
          textAlign: "center",
          whiteSpace: "nowrap",
          lineHeight: 1.06,
        }}
      >
        HOME
      </span>
    </button>
  );
}

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [homePanelOpen, setHomePanelOpen] = useState(false);
  const headerRef = useRef(null);

  useEffect(() => {
    try {
      router.prefetch?.("/");
      router.prefetch?.("/search");
    } catch {}
  }, [router]);

  async function fetchCategoriesFromStrapi() {
    // preserved
    return [
      { label: "LIMITED EDITION", id: "limited", href: "/collections/limited-edition" },
      { label: "PREMIUM COLLECTION", id: "premium", href: "/collections/premium-collection" },
      { label: "SIGNATURE SERIES", id: "signature", href: "/collections/signature-series" },
      { label: "HERITAGE COLLECTION", id: "heritage", href: "/collections/heritage-collection" },
    ];
  }

  const handleMenuClick = async () => {
    if (!menuOpen && categories.length === 0) {
      setCategories(await fetchCategoriesFromStrapi());
    }
    setMenuOpen((prev) => !prev);
  };

  const handleHomeClick = (e) => {
    e.preventDefault();
    setHomePanelOpen((v) => !v);
    setMenuOpen(false);
  };

  const goHomepage = () => {
    if (typeof window === "undefined") return;
    if (window.location.pathname !== "/") router.push("/");
  };

  // Robust “big TDLC” dismissor (preserved)
  useEffect(() => {
    if (typeof document === "undefined") return;

    const SELECTORS = [
      "#big-tdlc",
      "#big-tdlc-overlay",
      ".big-tdlc",
      ".big-tdlc-overlay",
      "[data-big-tdlc]",
      "[data-tdlc-splash]",
      "[data-show-big-tdlc='true']",
      "[aria-modal='true'][data-tdlc]",
    ];

    const hideBigTDLC = () => {
      const nodes = document.querySelectorAll(SELECTORS.join(","));
      nodes.forEach((el) => {
        try {
          if (typeof el.close === "function" && el.open) el.close();
        } catch {}
        el.style.opacity = "0";
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
        el.style.display = "none";
        el.setAttribute("aria-hidden", "true");
        el.removeAttribute("open");
        el.classList.remove("open", "opened", "visible", "show", "active", "modal", "mounted");
      });
      document.body?.classList?.remove("show-big-tdlc", "tdlc-splash-open", "tdlc-open", "no-scroll");
      document.documentElement?.classList?.remove("show-big-tdlc", "tdlc-splash-open", "tdlc-open", "no-scroll");
    };

    let rafId = 0;
    const mo = new MutationObserver(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        mo.disconnect();
        try {
          hideBigTDLC();
        } finally {
          mo.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "style"],
          });
        }
      });
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const cap = { capture: true, passive: true };
    const onPointerDownCapture = () => hideBigTDLC();
    const onClickBubble = () => hideBigTDLC();
    const onEsc = (e) => {
      if (e.key === "Escape") hideBigTDLC();
    };
    const onResize = () => hideBigTDLC();
    const onScroll = () => hideBigTDLC();

    const t0 = requestAnimationFrame(hideBigTDLC);

    document.addEventListener("pointerdown", onPointerDownCapture, cap);
    document.addEventListener("click", onClickBubble, true);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(t0);
      if (rafId) cancelAnimationFrame(rafId);
      mo.disconnect();
      document.removeEventListener("pointerdown", onPointerDownCapture, cap);
      document.removeEventListener("click", onClickBubble, true);
      document.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  // Maintain layout space below fixed navbar
  useEffect(() => {
    const setHeights = () => {
      const h = headerRef.current?.offsetHeight || 88;
      document.documentElement.style.setProperty("--nav-h", `${h}px`);
      document.body.style.paddingTop = `${h}px`;
    };
    setHeights();
    window.addEventListener("resize", setHeights, { passive: true });
    return () => window.removeEventListener("resize", setHeights);
  }, []);

  return (
    <>
      <header
        ref={headerRef}
        className="tdlc-header"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          background: "#FFFDF8",
          borderBottom: "1px solid #ece9db",
          boxShadow: "0 2px 10px rgba(36,31,68,0.04)",
          zIndex: 2147483647,
          display: "grid",
          alignItems: "center",
          height: "89px",
          paddingLeft: "var(--nav-gutter-x, var(--page-gutter-x))",
          paddingRight: "var(--nav-gutter-x, var(--page-gutter-x))",
          transition: "background .34s, box-shadow .28s, border .28s, height .18s",
        }}
      >
        <div
          className="tdlc-navgrid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, auto) minmax(0, 1fr) minmax(0, auto)",
            gridTemplateAreas: "'left center right'",
            alignItems: "center",
            width: "100%",
            height: "100%",
            columnGap: 14,
            minWidth: 0,
          }}
        >
          {/* LEFT */}
          <div
            className="tdlc-left"
            style={{
              gridArea: "left",
              display: "flex",
              alignItems: "center",
              minWidth: 0,
            }}
          >
            <HomeButton onClick={handleHomeClick} isActive={homePanelOpen} />
          </div>

          {/* CENTER — BRAND */}
          <div
            className="tdlc-center"
            style={{
              gridArea: "center",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              pointerEvents: "none",
            }}
          >
            <div
              onClick={goHomepage}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") goHomepage();
              }}
              tabIndex={0}
              role="link"
              aria-label="Go to homepage"
              title="Go to Homepage"
              className="tdlc-brand"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                pointerEvents: "auto",
                padding: "8px 10px",
                borderRadius: 12,
                transition: "transform .12s",
                userSelect: "none",
                cursor: "pointer",
                minWidth: 0,
              }}
            >
              {/* Keep Logorotator size as-is on mobile (do NOT downscale) */}
              <Logorotator size={36} />
              <span
                className="tdlc-brand-text"
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 800,
                  color: "#0c2340",
                  textTransform: "uppercase",
                  lineHeight: 1.1,
                  textShadow: "0 2px 14px #e7ebf640",
                }}
              >
                TDLS
              </span>
            </div>
          </div>

          {/* RIGHT — SEARCH (desktop only) + HAMBURGER */}
          <div
            className="tdlc-right"
            style={{
              gridArea: "right",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              minWidth: 0,
              gap: 18,
            }}
          >
            {/* Search stays for desktop/tablet; hidden on mobile via CSS below */}
            <NavSearchbar className="tdlc-navsearch" />

            <div className="tdlc-menublock" style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
              <button
                aria-label="Open menu"
                className="tdlc-menu-btn"
                style={{
                  background: "#fffdf8",
                  border: "1px solid #ece9db",
                  outline: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 44,
                  width: 54,
                  borderRadius: 16,
                  boxShadow: "0 2px 8px #e3e9f180",
                  padding: "6px 0",
                  transition: "background 0.18s, transform .1s",
                  flex: "0 0 auto",
                  WebkitTapHighlightColor: "transparent",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#F4F2E7")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#fffdf8")}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1.0)")}
                onClick={handleMenuClick}
                type="button"
              >
                <svg className="tdlc-menu-svg" width={28} height={26} viewBox="0 0 26 26" fill="none" aria-hidden>
                  <rect y="5" width="26" height="3.2" rx="1.6" fill="#0c2340" />
                  <rect y="11.2" width="26" height="3.2" rx="1.6" fill="#a6b6d6" />
                  <rect y="17.2" width="26" height="3.2" rx="1.6" fill="#0c2340" />
                </svg>
              </button>

              <span
                className="tdlc-menu-label"
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  color: "#0c2340",
                  marginTop: 2,
                  textShadow: "0 1px 5px #e7e2ce70",
                  letterSpacing: "0.22em",
                  lineHeight: 1.04,
                  whiteSpace: "nowrap",
                }}
              >
                MENU
              </span>
            </div>
          </div>
        </div>

        <style jsx>{`
          /* Shared gutter token (no “inch” padding) */
          .tdlc-header {
            --nav-gutter-x: var(--page-gutter-x);
          }

          /* Width-trap prevention: allow shrink everywhere it matters */
          .tdlc-navgrid,
          .tdlc-left,
          .tdlc-center,
          .tdlc-right,
          .tdlc-brand {
            min-width: 0;
          }

          /* Desktop default brand: premium single-line with safe truncation */
          .tdlc-brand-text {
            font-size: 3.9rem;
            letter-spacing: 0.19em;

            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: min(54vw, 560px);
          }

          /* Large screens: constrain heavy rules through shared token */
          @media (min-width: 1280px) {
            .tdlc-header {
              --nav-gutter-x: clamp(28px, 4.6vw, 96px);
              height: 92px;
            }
          }

          /* 1024–1279: 2-line clamp to prevent brand forcing overflow */
          @media (max-width: 1279px) and (min-width: 1024px) {
            .tdlc-header {
              height: 84px;
              --nav-gutter-x: clamp(20px, 3.2vw, 44px);
            }

            .tdlc-brand-text {
              font-size: 1.7rem;
              letter-spacing: 0.16em;
              max-width: min(52vw, 520px);

              white-space: normal;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(160px, 24vw, 220px) !important;
              min-width: 0 !important;
            }
          }

          /* 820–1023 */
          @media (max-width: 1023px) and (min-width: 820px) {
            .tdlc-header {
              height: 82px;
              --nav-gutter-x: clamp(18px, 3vw, 32px);
            }

            .tdlc-brand-text {
              font-size: 1.5rem;
              letter-spacing: 0.14em;
              max-width: min(48vw, 460px);

              white-space: normal;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(150px, 30vw, 210px) !important;
              min-width: 0 !important;
            }
          }

          /* 640–819 */
          @media (max-width: 819px) and (min-width: 640px) {
            .tdlc-header {
              --nav-gutter-x: clamp(14px, 2.8vw, 22px);
            }

            .tdlc-brand-text {
              font-size: 1.34rem;
              letter-spacing: 0.12em;
              max-width: min(44vw, 420px);

              white-space: normal;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(140px, 36vw, 200px) !important;
              min-width: 0 !important;
            }
          }

          /* Mobile: remove searchbar; keep clean layout; reduce CTA sizes without touching desktop */
          @media (max-width: 639px) {
            .tdlc-header {
              height: clamp(64px, 12.5vw, 76px);
              --nav-gutter-x: clamp(10px, 3.2vw, 14px);
            }

            :global(.tdlc-navsearch) {
              display: none !important;
            }

            /* Keep brand text hidden on mobile as before (Logorotator still visible, size preserved) */
            .tdlc-brand-text {
              display: none;
            }

            .tdlc-right {
              gap: clamp(10px, 2.6vw, 12px) !important;
            }

            /* HOME + MENU labels: smaller on tiny screens */
            .tdlc-home-label,
            .tdlc-menu-label {
              font-size: clamp(0.72rem, 2.9vw, 0.82rem) !important;
              letter-spacing: 0.16em !important;
              line-height: 1.02 !important;
              margin-top: 2px !important;
            }

            /* Home button: reduce footprint (touch-safe, premium) */
            :global(.tdlc-homebtn) {
              width: clamp(46px, 13vw, 56px) !important;
              margin-right: clamp(10px, 3vw, 14px) !important;
            }
            :global(.tdlc-homebtn-icon) {
              width: clamp(34px, 10.5vw, 40px) !important;
              height: clamp(34px, 10.5vw, 40px) !important;
              border-radius: clamp(14px, 4.2vw, 18px) !important;
              box-shadow: 0 2px 10px #e7dac944, 0 2px 7px #0c23400f !important;
            }
            :global(.tdlc-homebtn-svg) {
              width: clamp(20px, 6.2vw, 24px) !important;
              height: clamp(20px, 6.2vw, 24px) !important;
            }

            /* Menu button: reduce footprint + SVG scale down */
            :global(.tdlc-menu-btn) {
              width: clamp(42px, 12.5vw, 50px) !important;
              height: clamp(34px, 10.5vw, 40px) !important;
              border-radius: clamp(12px, 3.8vw, 14px) !important;
              padding: 0 !important;
              box-shadow: 0 2px 8px #e3e9f170 !important;
            }
            :global(.tdlc-menu-svg) {
              width: clamp(20px, 6.2vw, 24px) !important;
              height: clamp(18px, 5.8vw, 22px) !important;
            }

            /* Prevent horizontal overflow in ultra-small / landscape */
            .tdlc-navgrid {
              column-gap: clamp(8px, 2vw, 12px) !important;
            }
            .tdlc-left,
            .tdlc-right {
              max-width: 40vw;
            }
          }

          /* Extra safety: very small landscape (e.g., 568x320) */
          @media (max-width: 639px) and (max-height: 420px) {
            .tdlc-header {
              height: clamp(58px, 14.5vh, 68px);
            }
            .tdlc-home-label,
            .tdlc-menu-label {
              display: none !important; /* prevents vertical crowding only in tiny landscape */
            }
          }
        `}</style>
      </header>

      <Slidingmenubar open={menuOpen} onClose={() => setMenuOpen(false)} categories={categories} />
      <HomePanel open={homePanelOpen} onClose={() => setHomePanelOpen(false)} />
    </>
  );
}
