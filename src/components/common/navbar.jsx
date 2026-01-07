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
      }}
    >
      <span
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
        <svg width="28" height="28" fill="none" stroke="#BFA750" strokeWidth="2.4" viewBox="0 0 32 32" aria-hidden>
          <path d="M6 16L16 7L26 16" />
          <rect x="10.6" y="18.6" width="10.8" height="7.6" rx="2" stroke="#0c2340" strokeWidth="2" />
        </svg>
      </span>
      <span
        style={{
          marginTop: 6,
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700,
          fontSize: 13,
          letterSpacing: ".12em",
          color: "#0c2340",
          textAlign: "center",
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
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "89px",
          background: "#FFFDF8",
          borderBottom: "1px solid #ece9db",
          boxShadow: "0 2px 10px rgba(36,31,68,0.04)",
          zIndex: 2147483647,
          display: "grid",
          alignItems: "center",
          /* BASE padding for small/medium; desktop override below via media queries */
          paddingLeft: "24px",
          paddingRight: "24px",
          transition: "background .34s, box-shadow .28s, border .28s, height .18s",
        }}
      >
        {/* GRID: left / center / right — brand stays centered */}
        <div
          className="tdlc-navgrid"
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gridTemplateAreas: "'left center right'",
            alignItems: "center",
            width: "100%",
            height: "100%",
            columnGap: "14px",
            minWidth: 0,
          }}
        >
          {/* LEFT */}
          <div style={{ gridArea: "left", display: "flex", alignItems: "center", minWidth: 0 }}>
            <HomeButton onClick={handleHomeClick} isActive={homePanelOpen} />
          </div>

          {/* CENTER — BRAND */}
          <div
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
              }}
            >
              <Logorotator size={36} />
              <span
                className="tdlc-brand-text"
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 800,
                  fontSize: "3.9rem",
                  color: "#0c2340",
                  letterSpacing: ".19em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  lineHeight: 1.1,
                  textShadow: "0 2px 14px #e7ebf640",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "54vw",
                }}
              >
                TDLC
              </span>
            </div>
          </div>

          {/* RIGHT — SEARCH + HAMBURGER */}
          <div
            style={{
              gridArea: "right",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              minWidth: 0,
              /* Kept wider breathing room between Search and MENU */
              gap: 18,
            }}
          >
            <NavSearchbar className="tdlc-navsearch" />

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
              <button
                aria-label="Open menu"
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
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#F4F2E7")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#fffdf8")}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1.0)")}
                onClick={handleMenuClick}
                type="button"
              >
                <svg width={28} height={26} viewBox="0 0 26 26" fill="none" aria-hidden>
                  <rect y="5" width="26" height="3.2" rx="1.6" fill="#0c2340" />
                  <rect y="11.2" width="26" height="3.2" rx="1.6" fill="#a6b6d6" />
                  <rect y="17.2" width="26" height="3.2" rx="1.6" fill="#0c2340" />
                </svg>
              </button>
              <span
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  color: "#0c2340",
                  marginTop: 2,
                  textShadow: "0 1px 5px #e7e2ce70",
                  letterSpacing: "0.22em",
                  lineHeight: 1.04,
                }}
              >
                MENU
              </span>
            </div>
          </div>
        </div>

        {/* Responsive rules: 1in only on large screens; smaller screens use compact paddings */}
        <style jsx>{`
          /* Big screens: apply exactly 1 inch on left/right */
          @media (min-width: 1280px) {
            header {
              height: 92px;
              padding-left: 1in !important;
              padding-right: 1in !important;
            }
            .tdlc-brand-text {
              max-width: 54vw;
              letter-spacing: 0.19em;
              font-size: 3.9rem;
            }
            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(180px, 26vw, 260px) !important;
            }
          }

          /* 1024–1279: roomy but not 1 inch */
          @media (max-width: 1279px) and (min-width: 1024px) {
            header {
              height: 84px;
              padding-left: 36px !important;
              padding-right: 36px !important;
            }
            .tdlc-brand-text {
              max-width: 52vw;
              letter-spacing: 0.16em;
              font-size: 1.7rem;
            }
            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(160px, 24vw, 220px) !important;
            }
          }

          /* 820–1023 */
          @media (max-width: 1023px) and (min-width: 820px) {
            header {
              height: 82px;
              padding-left: 28px !important;
              padding-right: 28px !important;
            }
            .tdlc-brand-text {
              max-width: 48vw;
              letter-spacing: 0.14em;
              font-size: 1.5rem;
            }
            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(150px, 30vw, 210px) !important;
            }
          }

          /* 640–819 */
          @media (max-width: 819px) and (min-width: 640px) {
            header {
              padding-left: 22px !important;
              padding-right: 22px !important;
            }
            .tdlc-brand-text {
              max-width: 44vw;
              font-size: 1.34rem;
              letter-spacing: 0.12em;
            }
            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(140px, 36vw, 200px) !important;
            }
          }

          /* 480–639 */
          @media (max-width: 639px) and (min-width: 480px) {
            header {
              padding-left: 18px !important;
              padding-right: 18px !important;
            }
            .tdlc-brand-text {
              max-width: 40vw;
              font-size: 1.22rem;
              letter-spacing: 0.1em;
            }
            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(130px, 42vw, 190px) !important;
            }
          }

          /* <=479: tightest padding; hide big text to free space */
          @media (max-width: 479px) {
            header {
              height: 78px;
              padding-left: 16px !important;
              padding-right: 16px !important;
            }
            .tdlc-brand-text {
              display: none;
            }
            :global(.tdlc-navsearch .tdlc-searchwrap) {
              width: clamp(128px, 50vw, 200px) !important;
            }
          }
        `}</style>
      </header>

      <Slidingmenubar open={menuOpen} onClose={() => setMenuOpen(false)} categories={categories} />
      <HomePanel open={homePanelOpen} onClose={() => setHomePanelOpen(false)} />
    </>
  );
}
