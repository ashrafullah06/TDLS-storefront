// PATH: my-project/src/components/home/home-highlights-flyout.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

const NAVY = "#0F2147";
const GOLD = "#A67C37";

const TAB_TRENDING = "TRENDING";
const TAB_BEST = "BEST";

/* ------------------ viewport-safe vh (iOS/Android) ------------------ */
function setAppVhVar() {
  if (typeof window === "undefined") return;
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--app-vh", `${vh}px`);
}

/** read CSS variable (like --nav-h / --bottom-bar-h) */
function readCssPxVar(name, fallbackPx) {
  if (typeof window === "undefined") return fallbackPx;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const px = parseInt(String(raw || "").replace("px", "").trim(), 10);
    return Number.isFinite(px) && px > 0 ? px : fallbackPx;
  } catch {
    return fallbackPx;
  }
}

/* ---------- data helpers (aligned with HomePanel) ---------- */
function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function money(amount) {
  const v = n(amount, 0);
  if (!Number.isFinite(v) || v <= 0) return "";
  try {
    return v.toLocaleString("en-BD", {
      style: "currency",
      currency: "BDT",
      maximumFractionDigits: 0,
    });
  } catch {
    return `৳${Math.round(v).toLocaleString("en-US")}`;
  }
}

function absUrl(url) {
  if (!url) return "";
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;

  const base =
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    process.env.NEXT_PUBLIC_MEDIA_URL ||
    process.env.STRAPI_API_URL ||
    process.env.STRAPI_URL ||
    "";

  return base
    ? `${String(base).replace(/\/+$/, "")}${u.startsWith("/") ? "" : "/"}${u}`
    : u;
}

function getStrapiAttrs(item) {
  const a = item?.attributes;
  return a && typeof a === "object" ? a : item || {};
}

function pickTitle(item) {
  const a = getStrapiAttrs(item);
  return a.title || item?.title || a.name || item?.name || a.productName || item?.productName || "TDLS piece";
}

function pickSlug(item) {
  const a = getStrapiAttrs(item);
  return a.slug || item?.slug || "";
}

function pickAlt(item) {
  const a = getStrapiAttrs(item);
  return a.coverImageAlt || item?.coverImageAlt || a.imageAlt || item?.imageAlt || pickTitle(item) || "Product";
}

function pickImageUrl(item) {
  const a = getStrapiAttrs(item);

  const candidates = [
    a.coverImageUrl,
    item?.coverImageUrl,
    a.imageUrl,
    item?.imageUrl,
    a.thumbnailUrl,
    item?.thumbnailUrl,

    a.coverImage?.url,
    item?.coverImage?.url,
    a.coverImage?.data?.attributes?.url,
    item?.coverImage?.data?.attributes?.url,

    a.thumb?.url,
    item?.thumb?.url,
    a.thumbnail?.url,
    item?.thumbnail?.url,

    a.cover?.data?.attributes?.url,
    a.image?.data?.attributes?.url,
    a.thumbnail?.data?.attributes?.url,
    a.heroImage?.data?.attributes?.url,

    a.images?.data?.[0]?.attributes?.url,
    a.gallery?.data?.[0]?.attributes?.url,
    a.media?.data?.[0]?.attributes?.url,

    a.images?.[0]?.url,
    a.images?.[0],
    item?.images?.[0]?.url,
    item?.images?.[0],
  ];

  for (const c of candidates) {
    const u = String(c || "").trim();
    if (u) return u;
  }
  return "";
}

function safeHref(item) {
  if (!item) return "/product";
  const href = String(item.href || "").trim();
  if (href.startsWith("/")) return href;

  const slug = pickSlug(item);
  if (slug) return `/product/${slug}`;

  const id = item?.id || getStrapiAttrs(item)?.id;
  if (id) return `/product/${id}`;

  return "/product";
}

function normalizeHighlightItem(it) {
  return {
    ...it,
    title: pickTitle(it),
    slug: pickSlug(it),
    href: safeHref(it),
    coverImageUrl: pickImageUrl(it),
    coverImageAlt: pickAlt(it),
  };
}

export default function HomeHighlightsFlyout({ open, onClose, initialTab = TAB_TRENDING }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(768);
  const [navH, setNavH] = useState(86);
  const [bottomH, setBottomH] = useState(86);

  const panelRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const apply = () => {
      setAppVhVar();
      const w = window.innerWidth || 0;
      const h = window.innerHeight || 0;
      setVw(w);
      setVh(h);

      setNavH(readCssPxVar("--nav-h", 86));
      setBottomH(readCssPxVar("--bottom-bar-h", 86));
    };

    apply();

    const onResize = () => apply();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });

    const vv = window.visualViewport;
    if (vv?.addEventListener) {
      vv.addEventListener("resize", onResize, { passive: true });
      vv.addEventListener("scroll", onResize, { passive: true });
    }

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (vv?.removeEventListener) {
        vv.removeEventListener("resize", onResize);
        vv.removeEventListener("scroll", onResize);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab || TAB_TRENDING);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    if (data) return;

    let cancelled = false;
    const ac = new AbortController();
    const timeoutId = setTimeout(() => {
      try {
        ac.abort();
      } catch {}
    }, 6500);

    (async () => {
      try {
        setLoading(true);
        setError("");

        const res = await fetch("/api/home/highlights", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: ac.signal,
        });

        if (!res.ok) throw new Error(`Failed to load highlights (${res.status})`);

        const json = await res.json();
        if (!json?.ok) throw new Error(json?.error || "HIGHLIGHTS_ERROR");

        if (!cancelled) setData(json);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("Highlights are temporarily unavailable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      try {
        ac.abort();
      } catch {}
    };
  }, [open, data]);

  // Scroll lock while open (match HomePanel robustness)
  useEffect(() => {
    if (!open) return;
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    const prevBodyX = document.body.style.overflowX;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowX = "hidden";

    return () => {
      document.documentElement.style.overflow = prevHtml || "";
      document.body.style.overflow = prevBody || "";
      document.body.style.overflowX = prevBodyX || "";
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [open, onClose]);

  const trendingRaw = data?.trendingProducts ?? [];
  const bestRaw = data?.bestSellerProducts ?? [];

  const trending = useMemo(() => trendingRaw.map(normalizeHighlightItem), [trendingRaw]);
  const best = useMemo(() => bestRaw.map(normalizeHighlightItem), [bestRaw]);

  const items = useMemo(() => (activeTab === TAB_TRENDING ? trending : best), [activeTab, trending, best]);

  const layout = useMemo(() => {
    const safeTopPad = 8;
    const safeBottomPad = 10;

    const viewportPx = `calc(var(--app-vh, 1vh) * 100)`;

    const top = `calc(${navH}px + ${safeTopPad}px + env(safe-area-inset-top))`;
    const bottom = `calc(${bottomH}px + ${safeBottomPad}px + env(safe-area-inset-bottom))`;

    // Panel sizing: never overflow any screen; internal scroll only
    const maxH = `calc(${viewportPx} - ${navH}px - ${bottomH}px - ${safeTopPad}px - ${safeBottomPad}px - env(safe-area-inset-top) - env(safe-area-inset-bottom))`;

    // Width: safe on tiny screens, comfortable on desktop
    const panelW = vw < 480 ? "calc(100vw - 20px)" : "min(640px, calc(100vw - 32px))";

    return { top, bottom, maxH, panelW };
  }, [navH, bottomH, vw, vh]);

  if (!open) return null;

  return (
    <>
      <style>{`
        .tdls-highlights-wrap{
          position: fixed;
          left: 0; right: 0;
          z-index: 120;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          top: ${layout.top};
          bottom: ${layout.bottom};
          pointer-events: none;
          overflow: hidden;
        }

        .tdls-highlights-scrim{
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: auto;
          border: 0;
          background: rgba(2,6,23,.55);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          cursor: pointer;
        }

        .tdls-highlights-panel{
          position: relative;
          pointer-events: auto;
          width: ${layout.panelW};
          max-width: 100%;
          margin: 0 max(10px, env(safe-area-inset-right));
          border-radius: 24px;
          background: rgba(255,255,255,.95);
          border: 1px solid rgba(226,232,240,1);
          box-shadow: 0 26px 80px rgba(15,33,71,0.45);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: ${layout.maxH};
          contain: layout paint style;
        }

        .tdls-highlights-scroll{
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        .tdls-highlights-scroll::-webkit-scrollbar{ width: 0px; height: 0px; }
      `}</style>

      <div className="tdls-highlights-wrap" role="presentation">
        {/* Scrim */}
        <button type="button" aria-label="Close highlights overlay" onClick={onClose} className="tdls-highlights-scrim" />

        {/* Panel */}
        <div ref={panelRef} className="tdls-highlights-panel" role="dialog" aria-modal="true" aria-label="Home highlights">
          {/* Gradient top accent */}
          <div
            className="h-1 w-full"
            style={{
              background: "linear-gradient(90deg, #A67C37 0%, #FACC15 40%, #0F2147 100%)",
            }}
          />

          {/* Header */}
          <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-4 border-b border-slate-100 bg-white/95">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-[0.22em] uppercase text-slate-400">Live Highlights</div>
              <div className="mt-1 text-lg font-semibold tracking-tight text-slate-900">What TDLS customers are buying</div>
              <p className="mt-1 text-[12px] text-slate-500">
                Trending pieces from the last 3 months and all-time best sellers, directly from your completed orders.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-[11px] font-medium border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-300 bg-white/90 flex-shrink-0"
            >
              Close
            </button>
          </div>

          {/* Tabs */}
          <div className="px-5 sm:px-6 pt-3 pb-3 border-b border-slate-100 flex gap-2 bg-slate-50/80">
            <button
              type="button"
              onClick={() => setActiveTab(TAB_TRENDING)}
              className={`relative flex-1 rounded-full px-3 py-2 text-[11px] font-semibold tracking-wide transition-all ${
                activeTab === TAB_TRENDING
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Trending (last 3 months)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab(TAB_BEST)}
              className={`relative flex-1 rounded-full px-3 py-2 text-[11px] font-semibold tracking-wide transition-all ${
                activeTab === TAB_BEST ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Best sellers (all time)
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden bg-gradient-to-b from-white via-white/95 to-slate-50/90">
            <div className="tdls-highlights-scroll h-full px-4 pb-6 pt-4 space-y-3">
              {loading && (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 overflow-hidden animate-pulse"
                    >
                      <div className="w-20 sm:w-24 h-24 sm:h-28 bg-slate-200" />
                      <div className="flex-1 py-3 pr-3">
                        <div className="h-3 w-24 bg-slate-200 rounded-full mb-2" />
                        <div className="h-4 w-40 bg-slate-200 rounded-full mb-3" />
                        <div className="h-3 w-16 bg-slate-200 rounded-full mb-1" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loading && error && (
                <div className="rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-[13px] text-red-600">
                  {error}
                </div>
              )}

              {!loading && !error && items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="text-[11px] font-semibold tracking-[0.25em] uppercase text-slate-400 mb-2">
                    No highlights yet
                  </div>
                  <p className="text-sm text-slate-500 max-w-xs">
                    As soon as more TDLS orders are completed, real trending and best-selling pieces will appear here automatically.
                  </p>
                </div>
              )}

              {!loading &&
                !error &&
                items.length > 0 &&
                items.map((item, index) => {
                  const img = absUrl(item.coverImageUrl);
                  const priceFrom = money(item.priceFrom);
                  const priceTo = money(item.priceTo);

                  let priceText = "";
                  if (priceFrom && priceTo && priceFrom !== priceTo) priceText = `${priceFrom} – ${priceTo}`;
                  else if (priceFrom) priceText = priceFrom;
                  else if (priceTo) priceText = priceTo;
                  else priceText = "Price visible in cart";

                  const soldText =
                    item.totalSold != null && Number(item.totalSold) > 0
                      ? `${Number(item.totalSold).toLocaleString("en-BD")} piece${Number(item.totalSold) > 1 ? "s" : ""} sold`
                      : "Newly introduced – early orders in progress";

                  return (
                    <Link
                      key={item.id ?? item.slug ?? `${activeTab}-${index}`}
                      href={item.href || "/product"}
                      className="group flex gap-3 rounded-2xl border border-slate-100 bg-white/90 hover:bg-slate-50/90 hover:border-slate-200 transition-all overflow-hidden shadow-[0_10px_30px_rgba(15,33,71,0.10)]"
                    >
                      {/* Thumbnail */}
                      <div className="relative w-20 sm:w-24 h-24 sm:h-28 flex-shrink-0 overflow-hidden bg-slate-100">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt={item.coverImageAlt || item.title || "TDLS piece"}
                            className="w-full h-full object-cover transform transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                            onError={(e) => {
                              try {
                                e.currentTarget.style.display = "none";
                              } catch {}
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] tracking-[0.28em] uppercase text-slate-400">
                            TDLS
                          </div>
                        )}

                        <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-black/25 via-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      {/* Text stack */}
                      <div className="flex-1 py-3 pr-3 flex flex-col justify-between min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] uppercase text-slate-500 bg-slate-50/80">
                              {activeTab === TAB_TRENDING ? "Trending" : "Best seller"}
                            </span>
                            <span className="text-[11px] text-slate-400 flex-shrink-0">
                              #{String(index + 1).padStart(2, "0")}
                            </span>
                          </div>

                          <div className="text-sm font-semibold text-slate-900 line-clamp-2">{item.title}</div>

                          <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{soldText}</div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="text-[11px] text-slate-400">Price</div>
                          <div className="text-[13px] font-semibold text-slate-900 text-right whitespace-nowrap">
                            {priceText}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
            </div>
          </div>

          {/* Footer CTA */}
          <div className="border-t border-slate-100 px-5 sm:px-6 py-3 flex items-center justify-between bg-slate-50/90 backdrop-blur-sm gap-3">
            <div className="text-[11px] text-slate-500 min-w-0 truncate">Explore the complete TDLS collection.</div>
            <Link
              href="/product"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-wide shadow-sm border border-slate-900/10 flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #0F2147 0%, #111827 45%, #A67C37 100%)",
                color: "white",
              }}
            >
              View all products
              <span className="text-[11px]">↗</span>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
