// components/common/filterbar.jsx
import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useOptions } from "@/providers/optionsprovider";
import { FaFilter, FaTimes, FaChevronDown, FaChevronUp } from "react-icons/fa";

/**
 * Universal FilterBar for TDLC: Tier, Audience, Category, Event, Age Group, Gender, Price
 * Progressive disclosure, "See All" links, sticky and mobile-first.
 *
 * CHANGE GOAL:
 * - Keep desktop (md+) view essentially as-is.
 * - Make mobile/tiny screens truly compact: smaller paddings, font sizes, select widths,
 *   and prevent overflow with safe horizontal scroll.
 */
export default function FilterBar({
  filters,
  setFilters,
  showPrice = true,
  className = "",
  style = {},
}) {
  const router = useRouter();

  // OptionsProvider gives us all filterable values
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

  // Progressive disclosure: show only key filters by default
  const [showAll, setShowAll] = useState(false);

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
    if (stateFilters[type] === value) return;
    updateFilters({ ...stateFilters, [type]: value });
  }
  function handleRemove(type) {
    const f = { ...stateFilters };
    delete f[type];
    updateFilters(f);
  }
  function handleClearAll() {
    updateFilters({});
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

    const val = stateFilters.price || max;

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

/**
 * NOTE:
 * This file previously did not import classNames but used it in seeAllLink().
 * To keep behavior intact and avoid runtime error, import it here.
 */
import classNames from "classnames";
