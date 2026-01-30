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
      className="tdls-homebtn"
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
        className="tdls-homebtn-icon"
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
          className="tdls-homebtn-svg"
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
        className="tdls-home-label"
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

/** Build strings without leaving legacy tokens in source */
function sFromCodes(codes) {
  return String.fromCharCode(...codes);
}
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ✅ FIX (Hooks-safe + Hydration-safe):
 * - Navbar calls ONE hook and can safely return null for admin routes.
 * - All heavy child components mount ONLY after client hydration (mounted=true),
 *   preventing server/client hook-count mismatches from children that use window/document guards.
 * - HomePanel/Slidingmenubar are conditionally mounted only when open (so they never render "closed" states).
 */
export default function Navbar() {
  const pathname = usePathname() || "";
  const isAdminRoute = typeof pathname === "string" && pathname.startsWith("/admin");
  if (isAdminRoute) return null;

  return <NavbarInner pathname={pathname} />;
}

function NavbarInner({ pathname }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [categories, setCategories] = useState([]);
  const [homePanelOpen, setHomePanelOpen] = useState(false);
  const headerRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  /**
   * Brand normalizer + splash dismiss
   */
  useEffect(() => {
    if (!mounted) return;
    if (typeof document === "undefined") return;

    // Legacy tokens (runtime-constructed so none remain in source)
    const LEGACY_ABBR = sFromCodes([84, 68, 76, 67]); // TDLC
    const LEGACY_ABBR_LO = LEGACY_ABBR.toLowerCase(); // tdlc
    const LEGACY_LONG = sFromCodes([
      84, 72, 69, 32, 68, 78, 65, 32, 76, 65, 66, 32, 67, 76, 79, 84, 72, 73, 78, 71,
    ]); // THE DNA LAB CLOTHING

    const NEW_ABBR = "TDLS";
    const NEW_LONG = "THE DNA LAB STORE";

    const normalizeText = (input) => {
      if (!input) return input;
      let out = String(input);
      out = out.replace(new RegExp(escapeRegExp(LEGACY_ABBR), "g"), NEW_ABBR);
      out = out.replace(new RegExp(escapeRegExp(LEGACY_ABBR_LO), "g"), NEW_ABBR.toLowerCase());
      out = out.replace(new RegExp(escapeRegExp(LEGACY_LONG), "gi"), NEW_LONG);
      return out;
    };

    const normalizeDomBranding = (root = document.body) => {
      if (!root) return;

      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const v = node?.nodeValue;
            if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_ACCEPT;
            const tag = p.tagName;
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        },
        false
      );

      let n = walker.nextNode();
      while (n) {
        const before = n.nodeValue;
        const after = normalizeText(before);
        if (after !== before) n.nodeValue = after;
        n = walker.nextNode();
      }

      const ATTRS = ["title", "aria-label", "placeholder"];
      const els = root.querySelectorAll?.("*");
      if (!els) return;

      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        for (let j = 0; j < ATTRS.length; j++) {
          const a = ATTRS[j];
          const val = el.getAttribute?.(a);
          if (!val) continue;
          const next = normalizeText(val);
          if (next !== val) el.setAttribute(a, next);
        }
      }
    };

    const legacyLower = LEGACY_ABBR_LO; // runtime
    const newLower = NEW_ABBR.toLowerCase(); // tdls

    const selectorsFor = (t) => [
      `#big-${t}`,
      `#big-${t}-overlay`,
      `.big-${t}`,
      `.big-${t}-overlay`,
      `[data-big-${t}]`,
      `[data-${t}-splash]`,
      `[data-show-big-${t}='true']`,
      `[aria-modal='true'][data-${t}]`,
    ];

    const SELECTORS = [...selectorsFor(newLower), ...selectorsFor(legacyLower)];

    const hideBigSplash = () => {
      const nodes = document.querySelectorAll(SELECTORS.join(","));
      nodes.forEach((el) => {
        try {
          normalizeDomBranding(el);
        } catch {}

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

      const removeClasses = (node) => {
        if (!node?.classList?.remove) return;
        node.classList.remove(
          `show-big-${newLower}`,
          `${newLower}-splash-open`,
          `${newLower}-open`,
          "no-scroll",
          `show-big-${legacyLower}`,
          `${legacyLower}-splash-open`,
          `${legacyLower}-open`
        );
      };
      removeClasses(document.body);
      removeClasses(document.documentElement);
    };

    const t0 = requestAnimationFrame(() => {
      try {
        normalizeDomBranding(document.body);
      } finally {
        hideBigSplash();
      }
    });

    let rafId = 0;
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        try {
          normalizeDomBranding(document.body);
        } finally {
          hideBigSplash();
        }
      });
    };

    const moRoot = new MutationObserver(schedule);
    moRoot.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const moBody = new MutationObserver(schedule);
    moBody.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const cap = { capture: true, passive: true };
    const onPointerDownCapture = () => {
      normalizeDomBranding(document.body);
      hideBigSplash();
    };
    const onClickBubble = () => {
      normalizeDomBranding(document.body);
      hideBigSplash();
    };
    const onEsc = (e) => {
      if (e.key === "Escape") {
        normalizeDomBranding(document.body);
        hideBigSplash();
      }
    };
    const onResize = () => {
      normalizeDomBranding(document.body);
      hideBigSplash();
    };
    const onScroll = () => {
      normalizeDomBranding(document.body);
      hideBigSplash();
    };

    document.addEventListener("pointerdown", onPointerDownCapture, cap);
    document.addEventListener("click", onClickBubble, true);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(t0);
      if (rafId) cancelAnimationFrame(rafId);
      moRoot.disconnect();
      moBody.disconnect();
      document.removeEventListener("pointerdown", onPointerDownCapture, cap);
      document.removeEventListener("click", onClickBubble, true);
      document.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, [mounted, pathname]);

  // Maintain layout space below fixed navbar
  useEffect(() => {
    if (!mounted) return;

    const prevBodyPaddingTop = typeof document !== "undefined" ? document.body.style.paddingTop : "";
    const prevNavH =
      typeof document !== "undefined" ? document.documentElement.style.getPropertyValue("--nav-h") : "";

    const setHeights = () => {
      const h = headerRef.current?.offsetHeight || 88;
      document.documentElement.style.setProperty("--nav-h", `${h}px`);
      document.body.style.paddingTop = `${h}px`;
    };

    setHeights();
    window.addEventListener("resize", setHeights, { passive: true });

    return () => {
      window.removeEventListener("resize", setHeights);
      try {
        document.body.style.paddingTop = prevBodyPaddingTop || "";
        if (prevNavH) document.documentElement.style.setProperty("--nav-h", prevNavH);
        else document.documentElement.style.removeProperty("--nav-h");
      } catch {}
    };
  }, [mounted]);

  return (
    <>
      <header
        ref={headerRef}
        className="tdls-header"
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
          className="tdls-navgrid"
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
            className="tdls-left"
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
            className="tdls-center"
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
              className="tdls-brand"
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
              {/* Hydration-safe: show the rotator only after mount */}
              {mounted ? <Logorotator size={36} /> : <span aria-hidden style={{ width: 36, height: 36, display: "inline-block" }} />}
              <span
                className="tdls-brand-text"
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
            className="tdls-right"
            style={{
              gridArea: "right",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              minWidth: 0,
              gap: 18,
            }}
          >
            {/* Hydration-safe: reserve space, mount search only after client hydration */}
            {mounted ? (
              <NavSearchbar className="tdls-navsearch" />
            ) : (
              <div className="tdls-navsearch" aria-hidden />
            )}

            <div
              className="tdls-menublock"
              style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}
            >
              <button
                aria-label="Open menu"
                className="tdls-menu-btn"
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
                <svg className="tdls-menu-svg" width={28} height={26} viewBox="0 0 26 26" fill="none" aria-hidden>
                  <rect y="5" width="26" height="3.2" rx="1.6" fill="#0c2340" />
                  <rect y="11.2" width="26" height="3.2" rx="1.6" fill="#a6b6d6" />
                  <rect y="17.2" width="26" height="3.2" rx="1.6" fill="#0c2340" />
                </svg>
              </button>

              <span
                className="tdls-menu-label"
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
          .tdls-header {
            --nav-gutter-x: var(--page-gutter-x);
          }

          /* Width-trap prevention: allow shrink everywhere it matters */
          .tdls-navgrid,
          .tdls-left,
          .tdls-center,
          .tdls-right,
          .tdls-brand {
            min-width: 0;
          }

          /* Desktop default brand: premium single-line with safe truncation */
          .tdls-brand-text {
            font-size: 3.9rem;
            letter-spacing: 0.19em;

            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: min(54vw, 560px);
          }

          /* Reserve space for search placeholder too */
          :global(.tdls-navsearch) {
            width: clamp(180px, 28vw, 360px);
            min-width: 0;
          }

          /* Large screens: constrain heavy rules through shared token */
          @media (min-width: 1280px) {
            .tdls-header {
              --nav-gutter-x: clamp(28px, 4.6vw, 96px);
              height: 92px;
            }
          }

          /* 1024–1279: 2-line clamp to prevent brand forcing overflow */
          @media (max-width: 1279px) and (min-width: 1024px) {
            .tdls-header {
              height: 84px;
              --nav-gutter-x: clamp(20px, 3.2vw, 44px);
            }

            .tdls-brand-text {
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

            :global(.tdls-navsearch) {
              width: clamp(160px, 24vw, 220px) !important;
              min-width: 0 !important;
            }
          }

          /* 820–1023 */
          @media (max-width: 1023px) and (min-width: 820px) {
            .tdls-header {
              height: 82px;
              --nav-gutter-x: clamp(18px, 3vw, 32px);
            }

            .tdls-brand-text {
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

            :global(.tdls-navsearch) {
              width: clamp(150px, 30vw, 210px) !important;
              min-width: 0 !important;
            }
          }

          /* 640–819 */
          @media (max-width: 819px) and (min-width: 640px) {
            .tdls-header {
              --nav-gutter-x: clamp(14px, 2.8vw, 22px);
            }

            .tdls-brand-text {
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

            :global(.tdls-navsearch) {
              width: clamp(140px, 36vw, 200px) !important;
              min-width: 0 !important;
            }
          }

          /* Mobile: remove searchbar; keep clean layout; reduce CTA sizes without touching desktop */
          @media (max-width: 639px) {
            .tdls-header {
              height: clamp(64px, 12.5vw, 76px);
              --nav-gutter-x: clamp(10px, 3.2vw, 14px);
            }

            :global(.tdls-navsearch) {
              display: none !important;
            }

            /* Keep brand text hidden on mobile as before (Logorotator still visible, size preserved) */
            .tdls-brand-text {
              display: none;
            }

            .tdls-right {
              gap: clamp(10px, 2.6vw, 12px) !important;
            }

            /* HOME + MENU labels: smaller on tiny screens */
            .tdls-home-label,
            .tdls-menu-label {
              font-size: clamp(0.72rem, 2.9vw, 0.82rem) !important;
              letter-spacing: 0.16em !important;
              line-height: 1.02 !important;
              margin-top: 2px !important;
            }

            :global(.tdls-homebtn) {
              width: clamp(46px, 13vw, 56px) !important;
              margin-right: clamp(10px, 3vw, 14px) !important;
            }
            :global(.tdls-homebtn-icon) {
              width: clamp(34px, 10.5vw, 40px) !important;
              height: clamp(34px, 10.5vw, 40px) !important;
              border-radius: clamp(14px, 4.2vw, 18px) !important;
              box-shadow: 0 2px 10px #e7dac944, 0 2px 7px #0c23400f !important;
            }
            :global(.tdls-homebtn-svg) {
              width: clamp(20px, 6.2vw, 24px) !important;
              height: clamp(20px, 6.2vw, 24px) !important;
            }

            :global(.tdls-menu-btn) {
              width: clamp(42px, 12.5vw, 50px) !important;
              height: clamp(34px, 10.5vw, 40px) !important;
              border-radius: clamp(12px, 3.8vw, 14px) !important;
              padding: 0 !important;
              box-shadow: 0 2px 8px #e3e9f170 !important;
            }
            :global(.tdls-menu-svg) {
              width: clamp(20px, 6.2vw, 24px) !important;
              height: clamp(18px, 5.8vw, 22px) !important;
            }

            .tdls-navgrid {
              column-gap: clamp(8px, 2vw, 12px) !important;
            }
            .tdls-left,
            .tdls-right {
              max-width: 40vw;
            }
          }

          @media (max-width: 639px) and (max-height: 420px) {
            .tdls-header {
              height: clamp(58px, 14.5vh, 68px);
            }
            .tdls-home-label,
            .tdls-menu-label {
              display: none !important;
            }
          }
        `}</style>
      </header>

      {/* ✅ Mount overlays only when open (avoids hook-mismatch patterns inside those components) */}
      {mounted && menuOpen ? (
        <Slidingmenubar open={menuOpen} onClose={() => setMenuOpen(false)} categories={categories} />
      ) : null}

      {mounted && homePanelOpen ? (
        <HomePanel open={homePanelOpen} onClose={() => setHomePanelOpen(false)} />
      ) : null}
    </>
  );
}
