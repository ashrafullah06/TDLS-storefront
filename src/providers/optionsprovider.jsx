// src/providers/optionsprovider.jsx
"use client";
import React, { createContext, useContext, useMemo, useState } from "react";
import useSWR from "swr";

const HARDCODED_FLAGS = {
  premiumHover: true,
  betaSorting: false,
};

const OptionsContext = createContext();

const STRAPI_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "http://localhost:1337";

// SAFE fetcher: never throw; return null on any failure
const fetcher = async (url) => {
  try {
    const fullUrl = url.startsWith("http")
      ? url
      : STRAPI_BASE.replace(/\/+$/, "") + "/api" + (url.startsWith("/") ? url : "/" + url);

    const res = await fetch(fullUrl, { headers: { "Content-Type": "application/json" } });
    if (!res.ok) return null;

    // JSON parse safety
    const json = await res.json().catch(() => null);
    return json ?? null;
  } catch {
    // swallow network errors to avoid SWR bubbling "TypeError: Failed to fetch"
    return null;
  }
};

// Helper for Strapi relation matching (for filter logic)
function matchRelation(attrs, relation, slug) {
  if (!attrs || !relation || !slug) return false;
  const rel = attrs[relation];
  if (!rel || !rel.data) return false;
  if (Array.isArray(rel.data)) {
    return rel.data.some(
      (obj) => (obj.attributes?.slug || "").toLowerCase() === slug.toLowerCase()
    );
  }
  return (rel.data.attributes?.slug || "").toLowerCase() === slug.toLowerCase();
}

export default function OptionsProvider({
  children,
  lang = "en",
  region = "global",
  initialOptions = {},
}) {
  // --- SWR fetches for all needed Strapi collections ---
  const { data: tiersData, error: tiersError, mutate: mutateTiers } = useSWR(
    "/brand-tiers?populate=*",
    fetcher,
    { fallbackData: initialOptions.tiers }
  );
  const {
    data: audiencesData,
    error: audiencesError,
    mutate: mutateAudiences,
  } = useSWR("/audience-categories?populate=*", fetcher, {
    fallbackData: initialOptions.audiences,
  });
  const {
    data: categoriesData,
    error: categoriesError,
    mutate: mutateCategories,
  } = useSWR("/categories?populate=*", fetcher, {
    fallbackData: initialOptions.categories,
  });
  const { data: eventsData, error: eventsError, mutate: mutateEvents } = useSWR(
    "/events-products-collections?populate=*",
    fetcher,
    { fallbackData: initialOptions.events }
  );
  const {
    data: productsData,
    error: productsError,
    mutate: mutateProducts,
  } = useSWR("/products?populate=*", fetcher, {
    fallbackData: initialOptions.products,
  });
  const { data: tagsData, mutate: mutateTags } = useSWR("/tags?populate=*", fetcher, {
    fallbackData: initialOptions.tags,
  });
  const { data: ageGroupsData, mutate: mutateAgeGroups } = useSWR(
    "/age-groups?populate=*",
    fetcher,
    { fallbackData: initialOptions.ageGroups }
  );
  const { data: genderGroupsData, mutate: mutateGenderGroups } = useSWR(
    "/gender-groups?populate=*",
    fetcher,
    { fallbackData: initialOptions.genderGroups }
  );
  const { data: reviewsData, mutate: mutateReviews } = useSWR(
    "/reviews?populate=*",
    fetcher,
    { fallbackData: initialOptions.reviews }
  );
  const { data: flagsData, mutate: mutateFlags } = useSWR("/flags", fetcher, {
    fallbackData: initialOptions.featureFlags || HARDCODED_FLAGS,
  });

  // --- Memoize and clean data ---
  const tiers = useMemo(
    () =>
      tiersData?.data?.length
        ? tiersData.data.map((t) => ({ ...t.attributes, slug: t.attributes.slug, id: t.id }))
        : [],
    [tiersData]
  );
  const audiences = useMemo(
    () =>
      audiencesData?.data?.length
        ? audiencesData.data.map((a) => ({ ...a.attributes, slug: a.attributes.slug, id: a.id }))
        : [],
    [audiencesData]
  );
  const categories = useMemo(
    () =>
      categoriesData?.data?.length
        ? categoriesData.data.map((c) => ({ ...c.attributes, slug: c.attributes.slug, id: c.id }))
        : [],
    [categoriesData]
  );
  const events = useMemo(
    () =>
      eventsData?.data?.length
        ? eventsData.data.map((e) => ({ ...e.attributes, slug: e.attributes.slug, id: e.id }))
        : [],
    [eventsData]
  );
  const products = useMemo(
    () => (productsData?.data?.length ? productsData.data : []),
    [productsData]
  );
  const tags = useMemo(
    () =>
      tagsData?.data?.length
        ? tagsData.data.map((t) => ({ ...t.attributes, slug: t.attributes.slug, id: t.id }))
        : [],
    [tagsData]
  );
  const ageGroups = useMemo(
    () =>
      ageGroupsData?.data?.length
        ? ageGroupsData.data.map((a) => ({ ...a.attributes, slug: a.attributes.slug, id: a.id }))
        : [],
    [ageGroupsData]
  );
  const genderGroups = useMemo(
    () =>
      genderGroupsData?.data?.length
        ? genderGroupsData.data.map((g) => ({ ...g.attributes, slug: g.attributes.slug, id: g.id }))
        : [],
    [genderGroupsData]
  );
  const reviews = useMemo(
    () =>
      reviewsData?.data?.length
        ? reviewsData.data.map((r) => ({ ...r.attributes, id: r.id }))
        : [],
    [reviewsData]
  );
  const featureFlags = useMemo(
    () => ({ ...HARDCODED_FLAGS, ...(flagsData || {}) }),
    [flagsData]
  );

  // --- Loading and error state ---
  const loading = [tiersData, audiencesData, categoriesData, eventsData, productsData].some(
    (v) => typeof v === "undefined"
  );

  const syncError = useMemo(() => {
    const errors = [tiersError, audiencesError, categoriesError, eventsError, productsError].filter(
      Boolean
    );
    if (errors.length) {
      if (typeof window !== "undefined") {
        errors.forEach((e) => console.error("OptionsProvider Error:", e));
      }
      return "Some data may be missing. Reload or check your network.";
    }
    return null;
  }, [tiersError, audiencesError, categoriesError, eventsError, productsError]);

  // --- Frontend filtering ---
  function filterProducts(filtersObj, logic = "AND") {
    if (!filtersObj || !Object.keys(filtersObj).length) return products;
    return products.filter((product) => {
      const attrs = product.attributes || {};
      let checks = [];
      if (filtersObj.tier) checks.push(matchRelation(attrs, "brand_tiers", filtersObj.tier));
      if (filtersObj.audience)
        checks.push(matchRelation(attrs, "audience_categories", filtersObj.audience));
      if (filtersObj.category) checks.push(matchRelation(attrs, "categories", filtersObj.category));
      if (filtersObj.event)
        checks.push(matchRelation(attrs, "events_products_collections", filtersObj.event));
      if (filtersObj.tag) checks.push(matchRelation(attrs, "tags", filtersObj.tag));
      if (filtersObj.age_group) checks.push(matchRelation(attrs, "age_groups", filtersObj.age_group));
      if (filtersObj.gender) checks.push(matchRelation(attrs, "gender_groups", filtersObj.gender));
      return logic === "AND" ? checks.every(Boolean) : checks.some(Boolean);
    });
  }

  // --- Patch-like jump bar options ---
  const getPatchOptions = () => {
    const patchAudiences = audiences.map((aud) => ({
      label: aud.name,
      slug: aud.slug,
      type: "audience",
      href: `/collections/${aud.slug}`,
    }));
    const patchTiers = tiers.map((tier) => ({
      label: tier.name,
      slug: tier.slug,
      type: "tier",
      href: `/collections/${tier.slug}`,
    }));
    const patchCategories = categories.map((cat) => ({
      label: cat.name,
      slug: cat.slug,
      type: "category",
      href: `/collections/all/${cat.slug}`,
    }));
    const patchEvents = events.map((ev) => ({
      label: ev.name,
      slug: ev.slug,
      type: "event",
      href: `/collections/events/${ev.slug}`,
    }));
    return [
      ...patchAudiences,
      ...patchTiers,
      ...patchCategories,
      ...patchEvents,
      { label: "Shop All", slug: "all", type: "all", href: "/collections/all-products" },
    ];
  };

  // --- i18n display helper (stub) ---
  function getDisplayName(item) {
    if (!item) return "";
    if (item[`name_${lang}`]) return item[`name_${lang}`];
    return item.name;
  }

  // --- NEW: manual refresh + lastSync ---
  const [lastSync, setLastSync] = useState(null);
  async function refreshOptions() {
    // revalidate in parallel
    await Promise.all([
      mutateTiers(),
      mutateAudiences(),
      mutateCategories(),
      mutateEvents(),
      mutateProducts(),
      mutateTags(),
      mutateAgeGroups(),
      mutateGenderGroups(),
      mutateReviews(),
      mutateFlags(),
    ]);
    setLastSync(Date.now());
  }

  // --- Context value ---
  const contextValue = {
    // Raw data
    tiers,
    audiences,
    categories,
    events,
    products,
    tags,
    ageGroups,
    genderGroups,
    reviews,
    featureFlags,

    // States
    loading,
    syncError,
    lastSync,

    // Utilities
    filterProducts,
    getPatchOptions,
    getDisplayName,
    lang,
    region,

    // NEW controls
    refreshOptions,
  };

  return <OptionsContext.Provider value={contextValue}>{children}</OptionsContext.Provider>;
}

export function useOptions() {
  return useContext(OptionsContext);
}
