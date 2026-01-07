// components/common/filterbar.jsx
import React, { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOptions } from "@/providers/optionsprovider";
import { FaFilter, FaTimes, FaChevronDown, FaChevronUp } from "react-icons/fa";

/**
 * Universal FilterBar for TDLC: Tier, Audience, Category, Event, Age Group, Gender, Price
 * Progressive disclosure, "See All" links, sticky and mobile-first.
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
    tiers, collections, categories, events, ageGroups, genderGroups,
    minPrice, maxPrice,
  } = useOptions();

  // Build option lists
  const tierOptions = useMemo(() =>
    (tiers || []).map(t => ({ label: t.name, value: t.slug })), [tiers]);
  const audienceOptions = useMemo(() =>
    (collections || [])
      .filter(c => ["women", "men", "kids", "young", "home-decor"].includes(c.slug))
      .map(c => ({ label: c.name, value: c.slug })), [collections]);
  const categoryOptions = useMemo(() =>
    (categories || []).map(cat => ({
      label: cat.name || cat.slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
      value: cat.slug
    })), [categories]);
  const eventOptions = useMemo(() =>
    (events || []).map(ev => ({
      label: ev.name || ev.slug.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
      value: ev.slug
    })), [events]);
  const ageOptions = useMemo(() =>
    (ageGroups || []).map(ag => ({ label: ag.name, value: ag.slug })), [ageGroups]);
  const genderOptions = useMemo(() =>
    (genderGroups || []).map(gg => ({ label: gg.name, value: gg.slug })), [genderGroups]);
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
    if (stateFilters.category)
      return (
        <a
          className="ml-3 text-blue-900 underline text-base font-semibold whitespace-nowrap"
          href={`/collections/all/${stateFilters.category}`}
          style={{ marginTop: 5, marginBottom: 6, display: "inline-block" }}
        >See all in this category &rsaquo;</a>
      );
    if (stateFilters.tier)
      return (
        <a
          className="ml-3 text-blue-900 underline text-base font-semibold whitespace-nowrap"
          href={`/collections/${stateFilters.tier}`}
          style={{ marginTop: 5, marginBottom: 6, display: "inline-block" }}
        >See all in this tier &rsaquo;</a>
      );
    if (stateFilters.audience)
      return (
        <a
          className="ml-3 text-blue-900 underline text-base font-semibold whitespace-nowrap"
          href={`/collections/${stateFilters.audience}`}
          style={{ marginTop: 5, marginBottom: 6, display: "inline-block" }}
        >See all in this audience &rsaquo;</a>
      );
    if (stateFilters.event)
      return (
        <a
          className="ml-3 text-blue-900 underline text-base font-semibold whitespace-nowrap"
          href={`/collections/events/${stateFilters.event}`}
          style={{ marginTop: 5, marginBottom: 6, display: "inline-block" }}
        >See all in this event &rsaquo;</a>
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
        {icon}
        <select
          className="border border-gray-200 px-3 py-2 rounded-lg text-base bg-white focus:outline-none mr-3"
          value={stateFilters[type] || ""}
          onChange={e => handleSelect(type, e.target.value)}
        >
          <option value="">All {type.charAt(0).toUpperCase() + type.slice(1)}</option>
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }

  // Price filter
  function renderPriceFilter() {
    if (!showPrice || min === max) return null;
    return (
      <div className="flex items-center gap-2 flex-shrink-0 mr-4">
        <span className="font-medium text-gray-600 text-base">৳</span>
        <input
          type="range"
          min={min}
          max={max}
          value={stateFilters.price || max}
          onChange={e => handleSelect("price", e.target.value)}
          className="mx-2"
        />
        <span className="font-medium text-gray-600 text-base">
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
          label = `Tier: ${tierOptions.find(t => t.value === stateFilters[key])?.label || stateFilters[key]}`; break;
        case "audience":
          label = `Audience: ${audienceOptions.find(a => a.value === stateFilters[key])?.label || stateFilters[key]}`; break;
        case "category":
          label = `Category: ${categoryOptions.find(c => c.value === stateFilters[key])?.label || stateFilters[key]}`; break;
        case "event":
          label = `Event: ${eventOptions.find(e => e.value === stateFilters[key])?.label || stateFilters[key]}`; break;
        case "age":
          label = `Age: ${ageOptions.find(a => a.value === stateFilters[key])?.label || stateFilters[key]}`; break;
        case "gender":
          label = `Gender: ${genderOptions.find(g => g.value === stateFilters[key])?.label || stateFilters[key]}`; break;
        case "price":
          label = `≤ ৳${stateFilters[key]}`; break;
        default: label = `${key}: ${stateFilters[key]}`;
      }
      pills.push(
        <span
          key={key}
          className="inline-flex items-center bg-gray-200 text-gray-700 px-3 py-1 rounded-full mr-2 mb-2 text-sm font-medium"
        >
          {label}
          <button
            className="ml-2 text-gray-500 hover:text-red-500"
            aria-label={`Remove filter ${label}`}
            onClick={() => handleRemove(key)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
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
          className="ml-2 text-blue-700 underline text-sm font-semibold"
          onClick={handleClearAll}
        >Clear All</button>
      </div>
    );
  }

  // -- Main Render --
  return (
    <section className={`w-full bg-white border-b border-gray-200 py-2 px-1 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-6 z-30 sticky top-0 ${className}`}
      style={style}
    >
      {/* Filter Selectors: progressive, expandable */}
      <div className="flex flex-wrap items-center gap-2 md:gap-4 overflow-x-auto scrollbar-thin">
        <FaFilter className="text-gray-400 mr-2" />
        {renderSelect(tierOptions, "tier")}
        {renderSelect(audienceOptions, "audience")}
        {renderSelect(categoryOptions, "category")}
        {showAll && renderSelect(eventOptions, "event")}
        {showAll && renderSelect(ageOptions, "age")}
        {showAll && renderSelect(genderOptions, "gender")}
        {showPrice && renderPriceFilter()}
        <button
          className="inline-flex items-center text-gray-700 bg-gray-100 px-3 py-1 rounded-full ml-1 text-sm font-semibold border border-gray-200 hover:bg-gray-200"
          onClick={() => setShowAll(v => !v)}
          aria-label={showAll ? "Show fewer filters" : "Show more filters"}
        >
          {showAll ? <><FaChevronUp className="mr-1" /> Show Less</> : <><FaChevronDown className="mr-1" /> Show More</>}
        </button>
        {seeAllLink()}
      </div>
      {/* Active Filter Pills */}
      <div className="flex-grow">{renderActivePills()}</div>
    </section>
  );
}
