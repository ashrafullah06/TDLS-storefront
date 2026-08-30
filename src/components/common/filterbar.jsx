// components/common/filterbar.jsx
"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import classNames from "classnames";
import { useOptions } from "@/providers/optionsprovider";
import { usePathname } from "next/navigation";
import { FaFilter, FaTimes, FaChevronDown, FaChevronUp } from "react-icons/fa";

/**
 * Universal FilterBar for TDLS: Tier, Audience, Category, Event, Age Group, Gender, Price
 * Progressive disclosure, "See All" links, sticky and mobile-first.
 *
 * UNIVERSAL BEHAVIOR (updated):
 * - Never leak “UI filters” (especially price) from one collection/listing page to another.
 * - Preserve the page’s own scope (category/event/audience/tier) derived from the URL.
 * - Do NOT wipe filters when leaving listing → product/details (so back-navigation is not harmed).
 * - Treat “price == current max” as “All” (no active filter) to avoid stale max causing hidden products.
 * - UI kept exactly the same.
 */

const KNOWN_FILTER_KEYS = ["tier", "audience", "category", "event", "age", "gender", "price"];
const AUDIENCE_SLUGS = new Set(["women", "men", "kids", "young", "home-decor"]);

function safeDecode(seg) {
  try {
    return decodeURIComponent(seg || "");
  } catch {
    return String(seg || "");
  }
}

/**
 * Derive the listing "scope" from the pathname.
 * This allows us to reset only the UI filters that should never leak,
 * while preserving the page’s own scope.
 */
function deriveCollectionScope(pathname) {
  const p = (pathname || "").split("?")[0].replace(/\/+$/, "");
  const segs = p.split("/").filter(Boolean); // ["collections", ...]
  if (segs[0] !== "collections") return { isListing: false, base: {}, scopeId: "nonlisting" };

  // /collections/all/:categorySlug
  if (segs[1] === "all") {
    const cat = segs[2] ? safeDecode(segs[2]) : null;
    const base = cat ? { category: cat } : {};
    const scopeId = cat ? `collections:category:${cat}` : "collections:all";
    return { isListing: true, base, scopeId };
  }

  // /collections/events/:eventSlug
  if (segs[1] === "events") {
    const ev = segs[2] ? safeDecode(segs[2]) : null;
    const base = ev ? { event: ev } : {};
    const scopeId = ev ? `collections:event:${ev}` : "collections:events";
    return { isListing: true, base, scopeId };
  }

  // /collections/:slug  (audience OR tier)
  if (segs[1]) {
    const slug = safeDecode(segs[1]);
    if (AUDIENCE_SLUGS.has(slug)) {
      return { isListing: true, base: { audience: slug }, scopeId: `collections:audience:${slug}` };
    }
    return { isListing: true, base: { tier: slug }, scopeId: `collections:tier:${slug}` };
  }

  return { isListing: true, base: {}, scopeId: "collections:all" };
}

/**
 * Keep any unknown keys (for parent/page logic) untouched.
 * Only manage the keys FilterBar is responsible for.
 */
function stripKnownKeysKeepUnknown(obj) {
  const out = {};
  const src = obj || {};
  for (const k in src) {
    if (!KNOWN_FILTER_KEYS.includes(k)) out[k] = src[k];
  }
  return out;
}

function normalizeEmpty(v) {
  if (v === "" || v == null) return undefined;
  return v;
}

function shouldResetToBase(current, base) {
  const cur = current || {};
  const b = base || {};

  for (const k of KNOWN_FILTER_KEYS) {
    const cv = normalizeEmpty(cur[k]);
    const bv = normalizeEmpty(b[k]);

    // For price, we only care whether a price filter exists (value handled separately with max-normalization).
    if (k === "price") {
      if (cv === undefined && bv === undefined) continue;
      // Any carried price when base has none should be cleared on scope change.
      if (bv === undefined && cv !== undefined) return true;
      // (base never sets price in our URL derivation)
      continue;
    }

    if (cv === undefined && bv === undefined) continue;
    if (String(cv) !== String(bv)) return true;
  }

  return false;
}

export default function FilterBar({
  filters,
  setFilters,
  showPrice = true,
  className = "",
  style = {},
}) {
  const {
    tiers,
    collections,
    categories,
    events,
    ageGroups,
    genderGroups,
    minPrice,
    maxPrice,
  } = useOptions();

  const pathname = usePathname();

  // Build option lists
  const tierOptions = useMemo(
    () => (tiers || []).map((t) => ({ label: t.name, value: t.slug })),
    [tiers]
  );

  const audienceOptions = useMemo(
    () =>
      (collections || [])
        .filter((c) => ["women", "men", "kids", "young", "home-decor"].includes(c.slug))
        .map((c) => ({ label: c.name, value: c.slug })),
    [collections]
  );

  const categoryOptions = useMemo(
    () =>
      (categories || []).map((cat) => ({
        label:
          cat.name ||
          cat.slug
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
        value: cat.slug,
      })),
    [categories]
  );

  const eventOptions = useMemo(
    () =>
      (events || []).map((ev) => ({
        label:
          ev.name ||
          ev.slug
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
        value: ev.slug,
      })),
    [events]
  );

  const ageOptions = useMemo(
    () => (ageGroups || []).map((ag) => ({ label: ag.name, value: ag.slug })),
    [ageGroups]
  );

  const genderOptions = useMemo(
    () => (genderGroups || []).map((gg) => ({ label: gg.name, value: gg.slug })),
    [genderGroups]
  );

  const min = minPrice ?? 0;
  const max = maxPrice ?? 99999;

  // Controlled filter state
  const [localFilters, setLocalFilters] = useState({});
  const stateFilters = filters ?? localFilters;
  const updateFilters = setFilters ?? setLocalFilters;

  // Progressive disclosure
  const [showAll, setShowAll] = useState(false);

  // Scope from URL (keeps page’s “base” intact)
  const scope = useMemo(() => deriveCollectionScope(pathname), [pathname]);

  // Refs for stable access inside effects
  const latestFiltersRef = useRef(stateFilters);
  const updateFiltersRef = useRef(updateFilters);
  const lastScopeIdRef = useRef(scope.scopeId);
  const lastWasListingRef = useRef(scope.isListing);

  useEffect(() => {
    latestFiltersRef.current = stateFilters;
  }, [stateFilters]);

  useEffect(() => {
    updateFiltersRef.current = updateFilters;
  }, [updateFilters]);

  function resetToBase(reason = "") {
    const cur = latestFiltersRef.current || {};
    const unknown = stripKnownKeysKeepUnknown(cur);
    const next = { ...unknown, ...scope.base };

    // Avoid unnecessary updates
    // (We compare only known keys; unknown keys already preserved.)
    const wouldReset = shouldResetToBase(cur, scope.base);
    const curPrice = normalizeEmpty(cur.price);
    const hasPrice = curPrice !== undefined && curPrice !== null && curPrice !== "";
    if (!wouldReset && !hasPrice) return;

    try {
      updateFiltersRef.current?.(next);
    } catch {
      // never block UI
    }
  }

  /**
   * UNIVERSAL RESET RULE:
   * - Reset ONLY when moving between listing scopes (collections pages),
   *   so price (and other UI filters) never leak into the next listing page.
   * - Do NOT reset when leaving listing → non-listing (prevents harming back-navigation).
   */
  useEffect(() => {
    const prevScopeId = lastScopeIdRef.current;
    const prevWasListing = lastWasListingRef.current;

    const nowScopeId = scope.scopeId;
    const nowIsListing = scope.isListing;

    if (prevWasListing && nowIsListing && prevScopeId !== nowScopeId) {
      // Moved between listing pages -> reset to URL base
      resetToBase("scope-change");
      setShowAll(false);
    }

    lastScopeIdRef.current = nowScopeId;
    lastWasListingRef.current = nowIsListing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.scopeId, scope.isListing]);

  /**
   * PRICE NORMALIZATION (critical):
   * If price is equal/above current max, it is effectively “All”.
   * Keeping it would become a *real* filter when customer moves to a page with higher max,
   * which is exactly how products get hidden “automatically”.
   */
  useEffect(() => {
    if (!showPrice) return;
    const cur = latestFiltersRef.current || {};
    const raw = normalizeEmpty(cur.price);
    if (raw === undefined) return;

    const p = Number(raw);
    if (!Number.isFinite(p)) return;

    if (p >= max) {
      const unknown = stripKnownKeysKeepUnknown(cur);
      const next = { ...unknown, ...scope.base }; // drop price
      try {
        updateFiltersRef.current?.(next);
      } catch {
        // never block UI
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max, showPrice, scope.scopeId]);

  // Helper: "See All in This Category" link
  function seeAllLink() {
    const linkBase =
      "ml-2 sm:ml-3 text-blue-900 underline font-semibold whitespace-nowrap";
    const linkStyle = { marginTop: 4, marginBottom: 4, display: "inline-block" };

    if (stateFilters.category)
      return (
        <a
          className={classNames(linkBase, "text-[12px] sm:text-sm md:text-base")}
          href={`/collections/all/${stateFilters.category}`}
          style={linkStyle}
        >
          See all in this category &rsaquo;
        </a>
      );

    if (stateFilters.tier)
      return (
        <a
          className={classNames(linkBase, "text-[12px] sm:text-sm md:text-base")}
          href={`/collections/${stateFilters.tier}`}
          style={linkStyle}
        >
          See all in this tier &rsaquo;
        </a>
      );

    if (stateFilters.audience)
      return (
        <a
          className={classNames(linkBase, "text-[12px] sm:text-sm md:text-base")}
          href={`/collections/${stateFilters.audience}`}
          style={linkStyle}
        >
          See all in this audience &rsaquo;
        </a>
      );

    if (stateFilters.event)
      return (
        <a
          className={classNames(linkBase, "text-[12px] sm:text-sm md:text-base")}
          href={`/collections/events/${stateFilters.event}`}
          style={linkStyle}
        >
          See all in this event &rsaquo;
        </a>
      );

    return null;
  }

  // Filter handlers
  function handleSelect(type, value) {
    // If user chose "All X" (empty value), remove the filter instead of storing "".
    if (value === "" || value == null) {
      if (!stateFilters[type]) return;

      const f = { ...stateFilters };
      delete f[type];

      // If user clears the scope key (category/tier/audience/event), keep URL base intact by rebuilding from scope
      // (prevents weird “empty UI but still on a scoped page” situations).
      if (type === "category" || type === "tier" || type === "audience" || type === "event") {
        const unknown = stripKnownKeysKeepUnknown(f);
        updateFilters({ ...unknown, ...scope.base, ...stripKnownKeysKeepUnknown(stateFilters) });
        return;
      }

      updateFilters(f);
      return;
    }

    if (type === "price") {
      const n = Number(value);
      if (!Number.isFinite(n)) return;

      // If user slides to max, treat as “All” (no price filter)
      if (n >= max) {
        if (!stateFilters.price) return;
        const f = { ...stateFilters };
        delete f.price;
        updateFilters(f);
        return;
      }

      if (stateFilters.price === n) return;
      updateFilters({ ...stateFilters, price: n });
      return;
    }

    if (stateFilters[type] === value) return;
    updateFilters({ ...stateFilters, [type]: value });
  }

  function handleRemove(type) {
    const f = { ...stateFilters };
    delete f[type];
    updateFilters(f);
  }

  function handleClearAll() {
    // “Clear All” should NOT destroy the page’s own scope.
    // It clears only UI filters and returns to the URL-derived base.
    const unknown = stripKnownKeysKeepUnknown(stateFilters);
    updateFilters({ ...unknown, ...scope.base });
    setShowAll(false);
  }

  // Filter select box generator
  function renderSelect(options, type, icon) {
    if (!options?.length) return null;

    return (
      <div className="flex items-center gap-1 flex-shrink-0">
        {icon ? <span className="hidden sm:inline-flex">{icon}</span> : null}

        <select
          className={
            [
              "border border-gray-200 bg-white focus:outline-none",
              "rounded-lg",
              // Desktop stays as before; mobile becomes compact
              "px-2 sm:px-3",
              "py-1.5 sm:py-2",
              "text-[12px] sm:text-sm md:text-base",
              // Mobile width constraints to avoid overflow
              "max-w-[42vw] sm:max-w-none",
              "min-w-[120px] sm:min-w-[160px]",
              "mr-2 sm:mr-3",
            ].join(" ")
          }
          value={stateFilters[type] || ""}
          onChange={(e) => handleSelect(type, e.target.value)}
        >
          <option value="">
            All {type.charAt(0).toUpperCase() + type.slice(1)}
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Price filter
  function renderPriceFilter() {
    if (!showPrice || min === max) return null;

    // If no active price filter, show slider at max but do NOT store it in state
    const val = stateFilters.price ?? max;

    return (
      <div className="flex items-center gap-2 flex-shrink-0 mr-2 sm:mr-4">
        <span className="font-medium text-gray-600 text-[12px] sm:text-sm md:text-base">
          ৳
        </span>

        <input
          type="range"
          min={min}
          max={max}
          value={val}
          onChange={(e) => handleSelect("price", e.target.value)}
          className="mx-1 sm:mx-2 w-[120px] sm:w-[160px] md:w-[200px]"
        />

        <span className="font-medium text-gray-600 text-[12px] sm:text-sm md:text-base whitespace-nowrap">
          {stateFilters.price ? `≤ ৳${stateFilters.price}` : `All`}
        </span>
      </div>
    );
  }

  // Active filter "pills"
  function renderActivePills() {
    const pills = [];
    for (let key in stateFilters) {
      if (!stateFilters[key]) continue;

      // Do not show a no-op price pill (price >= max is normalized away, but keep safe)
      if (key === "price") {
        const p = Number(stateFilters[key]);
        if (Number.isFinite(p) && p >= max) continue;
      }

      let label = "";
      switch (key) {
        case "tier":
          label = `Tier: ${
            tierOptions.find((t) => t.value === stateFilters[key])?.label ||
            stateFilters[key]
          }`;
          break;
        case "audience":
          label = `Audience: ${
            audienceOptions.find((a) => a.value === stateFilters[key])?.label ||
            stateFilters[key]
          }`;
          break;
        case "category":
          label = `Category: ${
            categoryOptions.find((c) => c.value === stateFilters[key])?.label ||
            stateFilters[key]
          }`;
          break;
        case "event":
          label = `Event: ${
            eventOptions.find((e) => e.value === stateFilters[key])?.label ||
            stateFilters[key]
          }`;
          break;
        case "age":
          label = `Age: ${
            ageOptions.find((a) => a.value === stateFilters[key])?.label ||
            stateFilters[key]
          }`;
          break;
        case "gender":
          label = `Gender: ${
            genderOptions.find((g) => g.value === stateFilters[key])?.label ||
            stateFilters[key]
          }`;
          break;
        case "price":
          label = `≤ ৳${stateFilters[key]}`;
          break;
        default:
          label = `${key}: ${stateFilters[key]}`;
      }

      pills.push(
        <span
          key={key}
          className={[
            "inline-flex items-center bg-gray-200 text-gray-700 rounded-full mr-2 mb-2",
            // Desktop stays; mobile becomes compact
            "px-2 sm:px-3",
            "py-1",
            "text-[11px] sm:text-sm",
            "font-medium",
            "max-w-full",
          ].join(" ")}
          title={label}
        >
          <span className="truncate max-w-[68vw] sm:max-w-none">{label}</span>
          <button
            className="ml-2 text-gray-500 hover:text-red-500 flex-shrink-0"
            aria-label={`Remove filter ${label}`}
            onClick={() => handleRemove(key)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <FaTimes />
          </button>
        </span>
      );
    }

    if (pills.length === 0) return null;

    return (
      <div className="flex flex-wrap items-center mb-2">
        {pills}
        <button
          className="ml-1 sm:ml-2 text-blue-700 underline text-[11px] sm:text-sm font-semibold"
          onClick={handleClearAll}
        >
          Clear All
        </button>
      </div>
    );
  }

  // -- Main Render --
  return (
    <section
      className={`w-full bg-white border-b border-gray-200 z-30 sticky top-0 ${className}`}
      style={style}
    >
      {/* MOBILE: tighter padding; DESKTOP: original spacing */}
      <div className="py-2 px-2 sm:px-3 md:px-1 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 md:gap-6">
        {/* Filter Selectors */}
        <div
          className={[
            // horizontal scroll only when needed
            "flex items-center",
            "gap-2 md:gap-4",
            "overflow-x-auto overflow-y-hidden",
            "whitespace-nowrap",
            "scrollbar-thin",
            // ensure it never pushes layout wider than viewport
            "max-w-full",
            "pr-1",
          ].join(" ")}
        >
          <FaFilter className="text-gray-400 flex-shrink-0" />

          {renderSelect(tierOptions, "tier")}
          {renderSelect(audienceOptions, "audience")}
          {renderSelect(categoryOptions, "category")}
          {showAll && renderSelect(eventOptions, "event")}
          {showAll && renderSelect(ageOptions, "age")}
          {showAll && renderSelect(genderOptions, "gender")}
          {showPrice && renderPriceFilter()}

          <button
            className={[
              "inline-flex items-center flex-shrink-0",
              "text-gray-700 bg-gray-100 border border-gray-200 hover:bg-gray-200",
              "rounded-full",
              // Desktop stays; mobile compact
              "px-2.5 sm:px-3",
              "py-1 sm:py-1.5",
              "text-[11px] sm:text-sm",
              "font-semibold",
              "ml-1",
            ].join(" ")}
            onClick={() => setShowAll((v) => !v)}
            aria-label={showAll ? "Show fewer filters" : "Show more filters"}
          >
            {showAll ? (
              <>
                <FaChevronUp className="mr-1" /> Show Less
              </>
            ) : (
              <>
                <FaChevronDown className="mr-1" /> Show More
              </>
            )}
          </button>

          {seeAllLink()}
        </div>

        {/* Active Filter Pills */}
        <div className="flex-grow min-w-0">{renderActivePills()}</div>
      </div>
    </section>
  );
}