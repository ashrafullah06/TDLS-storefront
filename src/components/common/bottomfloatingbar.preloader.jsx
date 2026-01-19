//src/components/common/bottomfloatingbar.preloader.jsx
"use client";

import React, { useEffect, useRef } from "react";

/* =========================================
   BFBar Preloader (invisible, site-load warm)
   - Runs on every website load/refresh
   - Fetches BFBar datasets via existing /api/strapi proxy
   - Stores a compact “nav index” payload in localStorage
   ========================================= */

/* ---------------- cache keys (MUST match bottomfloatingbar.jsx) ---------------- */
const LS_BF_PAYLOAD_KEY = "tdls:bfbar:payload_nav:v1";
const LS_BF_PAYLOAD_TS = "tdls:bfbar:payload_nav_ts:v1";
const BF_PAYLOAD_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const LS_AUD_KEY = "tdls:bfbar:audiences:v1";
const LS_AUD_TS = "tdls:bfbar:audiences_ts:v1";

/* ---------------- robust helpers (trimmed to what preloader needs) ---------------- */
const normSlug = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

function pickSlugs(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.map(normSlug).filter(Boolean);

  if (obj?.data) {
    const d = obj.data;
    if (Array.isArray(d)) {
      return d
        .map((x) => x?.attributes?.slug || x?.slug || x?.attributes?.name || x?.name)
        .filter(Boolean)
        .map(normSlug);
    }
    const one = d?.attributes?.slug || d?.slug || d?.attributes?.name || d?.name || null;
    return one ? [normSlug(one)] : [];
  }

  const one = obj?.attributes?.slug || obj?.slug || obj?.attributes?.name || obj?.name || null;
  return one ? [normSlug(one)] : [];
}

const FIELD_ALIASES = {
  audience_categories: ["audience_categories", "audience_category", "audiences", "audience", "audienceCategories"],
  categories: ["categories", "category", "product_categories", "product_category", "categories_slugs", "category_slugs"],
  sub_categories: ["sub_categories", "sub_category", "subCategories", "subcategory", "subCategory"],
  super_categories: ["super_categories", "super_category", "superCategories", "supercategory", "superCategory"],
  age_groups: ["age_groups", "age_group", "ageGroups", "ageGroup"],
  gender_groups: ["gender_groups", "gender_group", "genderGroups", "genderGroup"],
};

function extractRelSlugs(product, canonicalKey) {
  const p = product || {};

  const pre = p[`${canonicalKey}_slugs`];
  const pre2 = p[`${canonicalKey}Slugs`];

  const fromPre = pickSlugs(pre);
  if (fromPre.length) return Array.from(new Set(fromPre));

  const fromPre2 = pickSlugs(pre2);
  if (fromPre2.length) return Array.from(new Set(fromPre2));

  const aliases = FIELD_ALIASES[canonicalKey] || [canonicalKey];
  const out = [];
  for (const k of aliases) {
    const v = p?.[k];
    const slugs = pickSlugs(v);
    for (const s of slugs) out.push(s);
  }
  return Array.from(new Set(out.map(normSlug).filter(Boolean)));
}

function minifyProductsForNav(list = []) {
  if (!Array.isArray(list)) return [];
  const KEYS = ["audience_categories", "categories", "sub_categories", "super_categories", "age_groups", "gender_groups"];

  return list
    .map((p) => {
      // Normalize “Strapi node” shape into the common flattened shape used elsewhere
      const base = p?.attributes ? { id: p.id, ...p.attributes, attributes: p.attributes } : p;
      const out = { id: base?.id ?? p?.id };

      for (const k of KEYS) {
        const slugs = extractRelSlugs(base, k);
        if (slugs.length) out[`${k}_slugs`] = slugs;
      }

      // Keep only compact nav index; drop heavy fields
      const hasUseful = Object.keys(out).length > 1;
      return hasUseful ? out : null;
    })
    .filter(Boolean);
}

/* ---------------- local cache I/O ---------------- */
function readPayloadCache() {
  try {
    const raw = window.localStorage.getItem(LS_BF_PAYLOAD_KEY);
    const ts = Number(window.localStorage.getItem(LS_BF_PAYLOAD_TS) || "0");
    const payload = raw ? JSON.parse(raw) : null;
    if (!payload || typeof payload !== "object") return { ok: false, payload: null, ts: 0 };
    return { ok: true, payload, ts: Number.isFinite(ts) ? ts : 0 };
  } catch {
    return { ok: false, payload: null, ts: 0 };
  }
}

function writePayloadCache(payload) {
  try {
    const toStore = {
      products: minifyProductsForNav(payload?.products),
      ageGroups: Array.isArray(payload?.ageGroups) ? payload.ageGroups : [],
      categories: Array.isArray(payload?.categories) ? payload.categories : [],
      audienceCategories: Array.isArray(payload?.audienceCategories) ? payload.audienceCategories : [],
    };

    window.localStorage.setItem(LS_BF_PAYLOAD_KEY, JSON.stringify(toStore));
    window.localStorage.setItem(LS_BF_PAYLOAD_TS, String(Date.now()));

    // Also refresh the existing audience-only cache (used by BFBar SWR effect)
    if (Array.isArray(toStore.audienceCategories) && toStore.audienceCategories.length) {
      window.localStorage.setItem(LS_AUD_KEY, JSON.stringify(toStore.audienceCategories));
      window.localStorage.setItem(LS_AUD_TS, String(Date.now()));
    }
  } catch {}
}

/* ---------------- proxy fetchers (same behavior as BFBar) ---------------- */
async function fetchFromStrapi(path) {
  try {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const q = encodeURIComponent(normalizedPath);

    const res = await fetch(`/api/strapi?path=${q}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "force-cache",
    });
    if (!res.ok) return null;

    const raw = await res.json().catch(() => null);
    if (!raw) return null;

    // Our proxy returns { ok: true, data: <rawStrapiJson> }
    const payload = raw?.ok ? raw.data : raw;
    return payload;
  } catch {
    return null;
  }
}

async function fetchProductsClient() {
  const payload = await fetchFromStrapi("/products?populate=*");
  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data.map((n) => (n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n));
}

async function fetchAgeGroupsClient() {
  const payload = await fetchFromStrapi("/age-groups?populate=*");
  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((n) => {
      const a = n?.attributes || {};
      return {
        id: n?.id,
        slug: a.slug || a.name || "",
        name: a.name || a.slug || "",
        order: typeof a.order === "number" ? a.order : undefined,
      };
    })
    .filter((x) => x.slug && x.name);
}

async function fetchCategoriesClient() {
  const payload = await fetchFromStrapi("/categories?populate=*");
  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((n) => {
      const a = n?.attributes || {};
      return {
        id: n?.id,
        slug: a.slug || a.name || "",
        name: a.name || a.slug || "",
        order: typeof a.order === "number" ? a.order : undefined,
      };
    })
    .filter((x) => x.slug && x.name);
}

async function fetchAudienceCategoriesClient() {
  const payload =
    (await fetchFromStrapi("/audience-categories?populate=*&pagination[pageSize]=500")) ||
    (await fetchFromStrapi("/audience-categories?populate=*")) ||
    (await fetchFromStrapi("/audience-categories"));

  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((n) => {
      const a = n?.attributes || {};
      return {
        id: n?.id,
        slug: a.slug || a.name || "",
        name: a.name || a.slug || "",
        order: typeof a.order === "number" ? a.order : undefined,
      };
    })
    .filter((x) => x.slug && x.name);
}

/* ---------------- scheduler ---------------- */
function scheduleIdle(cb, timeout = 900) {
  if (typeof window === "undefined") return () => {};
  const ric = window.requestIdleCallback
    ? window.requestIdleCallback
    : (fn) => window.setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), 80);
  const cancel = window.cancelIdleCallback ? window.cancelIdleCallback : window.clearTimeout;
  const id = ric(cb, { timeout });
  return () => cancel(id);
}

export default function BottomFloatingBarPreloader() {
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const maybeWarm = async () => {
      try {
        const cached = readPayloadCache();
        const now = Date.now();
        const fresh = cached.ok && now - (cached.ts || 0) < BF_PAYLOAD_TTL_MS;

        // If cache is fresh and has meaningful payload, skip network
        if (fresh && cached.payload && Array.isArray(cached.payload.products) && cached.payload.products.length) return;

        const [ps, ags, cats, auds] = await Promise.allSettled([
          fetchProductsClient(),
          fetchAgeGroupsClient(),
          fetchCategoriesClient(),
          fetchAudienceCategoriesClient(),
        ]);

        const payload = {
          products: ps.status === "fulfilled" && Array.isArray(ps.value) ? ps.value : [],
          ageGroups: ags.status === "fulfilled" && Array.isArray(ags.value) ? ags.value : [],
          categories: cats.status === "fulfilled" && Array.isArray(cats.value) ? cats.value : [],
          audienceCategories: auds.status === "fulfilled" && Array.isArray(auds.value) ? auds.value : [],
        };

        // Only store if we got at least something useful (avoid writing empty forever)
        const hasAny =
          (payload.products && payload.products.length) ||
          (payload.audienceCategories && payload.audienceCategories.length) ||
          (payload.categories && payload.categories.length) ||
          (payload.ageGroups && payload.ageGroups.length);

        if (hasAny) writePayloadCache(payload);
      } catch {
        // silent by design
      }
    };

    // 1) Kick quickly (so it’s effectively “site-load”)
    const cancelIdle = scheduleIdle(() => {
      maybeWarm();
    }, 700);

    // 2) Also re-warm when tab becomes visible (helps after long idle)
    const onVis = () => {
      if (document.visibilityState === "visible") {
        scheduleIdle(() => {
          maybeWarm();
        }, 700);
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      try {
        cancelIdle();
      } catch {}
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null; // invisible by design
}
