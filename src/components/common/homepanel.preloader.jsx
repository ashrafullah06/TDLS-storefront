// FILE: src/components/common/bottomfloatingbar.preloader.jsx
"use client";

import { useEffect } from "react";

/**
 * BottomFloatingBarPreloader (no UI)
 * - Runs at site load (mounted in app/layout.js)
 * - Fetches BFBar critical datasets via existing /api/strapi proxy
 * - Stores a consolidated payload into localStorage for instant BFBar hydration
 *
 * Goal: BFBar is always "warm" on refresh and not loaded on click.
 */

/* ---------------- cache keys (must match bottomfloatingbar.jsx) ---------------- */
const LS_INIT_KEY = "tdls:bfbar:init:v1";
const LS_INIT_TS = "tdls:bfbar:init_ts:v1";

// Keep fairly long so refreshes are instant, but still updates within same day
const INIT_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function readInitCache() {
  try {
    const raw = window.localStorage.getItem(LS_INIT_KEY);
    const ts = Number(window.localStorage.getItem(LS_INIT_TS) || "0");
    const payload = raw ? JSON.parse(raw) : null;
    const ok = payload && typeof payload === "object";
    return { ok, payload: ok ? payload : null, ts: Number.isFinite(ts) ? ts : 0 };
  } catch {
    return { ok: false, payload: null, ts: 0 };
  }
}

function writeInitCache(payload) {
  try {
    window.localStorage.setItem(LS_INIT_KEY, JSON.stringify(payload));
    window.localStorage.setItem(LS_INIT_TS, String(Date.now()));
  } catch {}
}

/* ---------------- client-safe proxy fetch ---------------- */
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

    // Proxy returns { ok: true, data: <rawStrapiJson> }
    const payload = raw?.ok ? raw.data : raw;
    return payload;
  } catch {
    return null;
  }
}

async function fetchProductsClient() {
  // Add pageSize to reduce “partial menu” and to avoid repeated pagination calls.
  const payload = await fetchFromStrapi("/products?populate=*&pagination[pageSize]=500");
  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data.map((n) => (n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n));
}

async function fetchAgeGroupsClient() {
  const payload = await fetchFromStrapi("/age-groups?populate=*&pagination[pageSize]=500");
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
  const payload = await fetchFromStrapi("/categories?populate=*&pagination[pageSize]=500");
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

export default function BottomFloatingBarPreloader() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cached = readInitCache();
    const now = Date.now();
    const stale = !cached.ok || now - (cached.ts || 0) >= INIT_TTL_MS;

    // If not stale, do nothing: BFBar will hydrate instantly from cache on refresh.
    if (!stale) return;

    let cancelled = false;

    const run = async () => {
      try {
        const [ps, ags, cats, auds] = await Promise.allSettled([
          fetchProductsClient(),
          fetchAgeGroupsClient(),
          fetchCategoriesClient(),
          fetchAudienceCategoriesClient(),
        ]);

        if (cancelled) return;

        const payload = {
          products: ps.status === "fulfilled" && Array.isArray(ps.value) ? ps.value : [],
          ageGroups: ags.status === "fulfilled" && Array.isArray(ags.value) ? ags.value : [],
          categories: cats.status === "fulfilled" && Array.isArray(cats.value) ? cats.value : [],
          audienceCategories: auds.status === "fulfilled" && Array.isArray(auds.value) ? auds.value : [],
        };

        // Only write if we got anything meaningful
        const meaningful =
          payload.products.length || payload.ageGroups.length || payload.categories.length || payload.audienceCategories.length;

        if (meaningful) writeInitCache(payload);
      } catch {
        // silent by design
      }
    };

    // Start immediately, but allow browser to settle if possible.
    // timeout ensures it still runs quickly even under load.
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => run(), { timeout: 900 });
    } else {
      setTimeout(run, 0);
    }

    // Also retry once when the tab becomes visible (covers back/forward cache + hidden tab loads)
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const c2 = readInitCache();
      const stale2 = !c2.ok || Date.now() - (c2.ts || 0) >= INIT_TTL_MS;
      if (stale2) run();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null; // no UI
}
