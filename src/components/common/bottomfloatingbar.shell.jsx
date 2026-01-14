// FILE: src/components/common/bottomfloatingbar.shell.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import BottomFloatingBar from "./bottomfloatingbar";

/* ------------------------- local cache ------------------------- */
const LS_KEY = "tdls:bfbar:initialData:v1";
const LS_TS = "tdls:bfbar:initialData_ts:v1";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function now() {
  return Date.now();
}

function readCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const ts = Number(window.localStorage.getItem(LS_TS) || "0");
    const data = raw ? safeParse(raw) : null;
    if (!data || !ts) return null;
    return { data, ts };
  } catch {
    return null;
  }
}

function writeCache(data) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(data));
    window.localStorage.setItem(LS_TS, String(now()));
  } catch {}
}

/* ------------------------- proxy fetch ------------------------- */
async function fetchFromStrapi(path, signal) {
  try {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const q = encodeURIComponent(normalizedPath);

    const res = await fetch(`/api/strapi?path=${q}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "force-cache",
      signal,
    });

    if (!res.ok) return null;

    const raw = await res.json().catch(() => null);
    if (!raw) return null;

    return raw?.ok ? raw.data : raw;
  } catch {
    return null;
  }
}

function normalizeEntities(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data
    .map((n) => (n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n))
    .filter(Boolean);
}

function normalizeTaxonomy(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
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

async function fetchInitialData(signal) {
  const [p, ag, c, aud] = await Promise.allSettled([
    fetchFromStrapi("/products?populate=*", signal),
    fetchFromStrapi("/age-groups?populate=*", signal),
    fetchFromStrapi("/categories?populate=*", signal),
    fetchFromStrapi("/audience-categories?populate=*", signal),
  ]);

  return {
    products: p.status === "fulfilled" && p.value ? normalizeEntities(p.value) : [],
    ageGroups: ag.status === "fulfilled" && ag.value ? normalizeTaxonomy(ag.value) : [],
    categories: c.status === "fulfilled" && c.value ? normalizeTaxonomy(c.value) : [],
    audienceCategories: aud.status === "fulfilled" && aud.value ? normalizeTaxonomy(aud.value) : [],
  };
}

export default function BottomFloatingBarShell(props) {
  const cached = useMemo(() => readCache(), []);
  const [initialData, setInitialData] = useState(() => cached?.data || null);

  const inflightRef = useRef(null);

  useEffect(() => {
    const cacheAge = cached?.ts ? now() - cached.ts : Infinity;
    const hasFreshCache = cacheAge < TTL_MS;

    const controller = new AbortController();
    inflightRef.current = controller;

    const run = async () => {
      const data = await fetchInitialData(controller.signal);
      if (controller.signal.aborted) return;

      const ok =
        (Array.isArray(data.products) && data.products.length > 0) ||
        (Array.isArray(data.categories) && data.categories.length > 0) ||
        (Array.isArray(data.audienceCategories) && data.audienceCategories.length > 0) ||
        (Array.isArray(data.ageGroups) && data.ageGroups.length > 0);

      if (ok) {
        setInitialData(data);
        writeCache(data);
      }
    };

    if (!hasFreshCache) {
      run();
    } else {
      const t = window.setTimeout(run, 250);
      return () => {
        window.clearTimeout(t);
        controller.abort();
      };
    }

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BottomFloatingBar {...props} initialData={initialData} />;
}
