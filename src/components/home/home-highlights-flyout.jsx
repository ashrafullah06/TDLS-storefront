"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const NAVY = "#0F2147";
const GOLD = "#A67C37";

const TAB_TRENDING = "TRENDING";
const TAB_BEST = "BEST";

const SAFE_TOP = 86; // keep within navbar
const SAFE_BOTTOM = 86; // keep above BottomFloatingBar

function money(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 0,
  });
}

export default function HomeHighlightsFlyout({
  open,
  onClose,
  initialTab = TAB_TRENDING,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab || TAB_TRENDING);

    if (data) return;

    (async () => {
      try {
        setLoading(true);
        setError("");

        const res = await fetch("/api/home/highlights", {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          throw new Error(`Failed to load highlights (${res.status})`);
        }

        const json = await res.json();
        if (!json?.ok) {
          throw new Error(json?.error || "HIGHLIGHTS_ERROR");
        }

        setData(json);
      } catch (e) {
        console.error(e);
        setError("Highlights are temporarily unavailable.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, initialTab, data]);

  const trending = data?.trendingProducts ?? [];
  const best = data?.bestSellerProducts ?? [];

  const items = useMemo(
    () => (activeTab === TAB_TRENDING ? trending : best),
    [activeTab, trending, best]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-x-0 z-[120] flex justify-end items-center"
      style={{ top: SAFE_TOP, bottom: SAFE_BOTTOM }}
    >
      {/* Scrim – closes on click, never under navbar or bottom bar */}
      <button
        type="button"
        aria-label="Close highlights overlay"
        onClick={onClose}
        className="absolute inset-0 w-full h-full bg-slate-950/55 backdrop-blur-sm"
        style={{ top: SAFE_TOP, bottom: SAFE_BOTTOM }}
      />

      {/* Flyout panel (right side, vertically centered) */}
      <div className="relative w-full max-w-xl mx-4 rounded-3xl bg-white/95 shadow-[0_26px_80px_rgba(15,33,71,0.65)] border border-slate-200 overflow-hidden flex flex-col pointer-events-auto">
        {/* Gradient top accent */}
        <div
          className="h-1 w-full"
          style={{
            background:
              "linear-gradient(90deg, #A67C37 0%, #FACC15 40%, #0F2147 100%)",
          }}
        />

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-100 bg-white/95">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.22em] uppercase text-slate-400">
              Live Highlights
            </div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
              What TDLC customers are buying
            </div>
            <p className="mt-1 text-[12px] text-slate-500">
              Trending pieces from the last 3 months and all-time best sellers,
              directly from your completed orders.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-[11px] font-medium border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-300 bg-white/90"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 pb-3 border-b border-slate-100 flex gap-2 bg-slate-50/80">
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
              activeTab === TAB_BEST
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Best sellers (all time)
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden bg-gradient-to-b from-white via-white/95 to-slate-50/90">
          <div className="h-full overflow-y-auto px-4 pb-6 pt-4 space-y-3">
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
                  As soon as more TDLC orders are completed, real trending and
                  best-selling pieces will appear here automatically.
                </p>
              </div>
            )}

            {!loading &&
              !error &&
              items.length > 0 &&
              items.map((item, index) => {
                const priceFrom = money(item.priceFrom);
                const priceTo = money(item.priceTo);

                let priceText = "";
                if (priceFrom && priceTo && priceFrom !== priceTo) {
                  priceText = `${priceFrom} – ${priceTo}`;
                } else if (priceFrom) {
                  priceText = priceFrom;
                } else if (priceTo) {
                  priceText = priceTo;
                } else {
                  priceText = "Price visible in cart";
                }

                const soldText =
                  item.totalSold != null && item.totalSold > 0
                    ? `${item.totalSold.toLocaleString(
                        "en-BD"
                      )} piece${item.totalSold > 1 ? "s" : ""} sold`
                    : "Newly introduced – early orders in progress";

                return (
                  <Link
                    key={item.id ?? `${activeTab}-${index}`}
                    href={item.href || "/all-products"}
                    className="group flex gap-3 rounded-2xl border border-slate-100 bg-white/90 hover:bg-slate-50/90 hover:border-slate-200 transition-all overflow-hidden shadow-[0_10px_30px_rgba(15,33,71,0.10)]"
                  >
                    {/* Thumbnail */}
                    <div className="relative w-20 sm:w-24 h-24 sm:h-28 flex-shrink-0 overflow-hidden bg-slate-100">
                      {item.coverImageUrl ? (
                        <img
                          src={item.coverImageUrl}
                          alt={item.coverImageAlt || item.title || "TDLC piece"}
                          className="w-full h-full object-cover transform transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] tracking-[0.28em] uppercase text-slate-400">
                          TDLC
                        </div>
                      )}

                      <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-black/25 via-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>

                    {/* Text stack */}
                    <div className="flex-1 py-3 pr-3 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] uppercase text-slate-500 bg-slate-50/80">
                            {activeTab === TAB_TRENDING
                              ? "Trending"
                              : "Best seller"}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            #{String(index + 1).padStart(2, "0")}
                          </span>
                        </div>

                        <div className="text-sm font-semibold text-slate-900 line-clamp-2">
                          {item.title}
                        </div>

                        <div className="mt-1 text-[11px] text-slate-500">
                          {soldText}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-[11px] text-slate-400">Price</div>
                        <div className="text-[13px] font-semibold text-slate-900">
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
        <div className="border-t border-slate-100 px-6 py-3 flex items-center justify-between bg-slate-50/90 backdrop-blur-sm">
          <div className="text-[11px] text-slate-500">
            Explore the complete TDLC collection.
          </div>
          <Link
            href="/all-products"
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-wide shadow-sm border border-slate-900/10"
            style={{
              background:
                "linear-gradient(135deg, #0F2147 0%, #111827 45%, #A67C37 100%)",
              color: "white",
            }}
          >
            View all products
            <span className="text-[11px]">↗</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
