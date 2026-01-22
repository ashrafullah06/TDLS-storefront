// FILE: src/components/common/homepanel.preloader.jsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ✅ ALSO preload All Products (audience/category/options) at site load
import { HomePanelAllProductsPreloader } from "@/components/common/homepanel_all_products";

/**
 * HomePanelPreloader (no UI)
 * -----------------------------------------------------------------------------
 * Goal:
 * - Preload HomePanel highlights at site load so HomePanel opens with data instantly.
 * - Store payload in localStorage with TTL.
 * - Dispatch an event so HomePanel can hydrate immediately if it opens too fast.
 * - Warm critical routes via router.prefetch (best-effort).
 * - Preload HomePanel All Products dataset (audiences/options) at site load.
 *
 * Shared cache keys (MUST match homepanel.jsx):
 * - tdls:homepanel:highlights:v1
 * - tdls:homepanel:highlights_ts:v1
 */

const HP_HL_KEY = "tdls:homepanel:highlights:v1";
const HP_HL_TS = "tdls:homepanel:highlights_ts:v1";
const HP_HL_TTL_MS = 6 * 60 * 60 * 1000; // 6h

// Ready event name (keep consistent across preloader + homepanel consumer)
const HP_HL_READY_EVENT = "tdls:homepanel:highlightsReady";

// Lightweight in-flight lock to avoid stampede across tabs/re-mounts
const HP_HL_LOCK = "tdls:homepanel:highlights_lock:v1";
const LOCK_TTL_MS = 25 * 1000; // 25s

// Fetch timeout: allow cold-start but never hang
const FETCH_TIMEOUT_IMMEDIATE_MS = 12000; // first-load attempt
const FETCH_TIMEOUT_BG_MS = 15000; // idle/visibility refresh attempt

function now() {
  return Date.now();
}

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readCache() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HP_HL_KEY);
    if (!raw) return null;

    const parsed = safeParseJSON(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const trendingProducts = Array.isArray(parsed.trendingProducts)
      ? parsed.trendingProducts
      : [];
    const bestSellerProducts = Array.isArray(parsed.bestSellerProducts)
      ? parsed.bestSellerProducts
      : [];

    const tsRaw = window.localStorage.getItem(HP_HL_TS);
    const ts = tsRaw ? Number(tsRaw) : 0;

    return {
      trendingProducts,
      bestSellerProducts,
      ts: Number.isFinite(ts) ? ts : 0,
    };
  } catch {
    return null;
  }
}

function writeCache(payload) {
  if (typeof window === "undefined") return;
  try {
    const safePayload = {
      trendingProducts: Array.isArray(payload?.trendingProducts)
        ? payload.trendingProducts
        : [],
      bestSellerProducts: Array.isArray(payload?.bestSellerProducts)
        ? payload.bestSellerProducts
        : [],
    };
    window.localStorage.setItem(HP_HL_KEY, JSON.stringify(safePayload));
    window.localStorage.setItem(HP_HL_TS, String(now()));
  } catch {}
}

function isFresh(cache) {
  const ts = Number(cache?.ts || 0);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return now() - ts < HP_HL_TTL_MS;
}

function hasData(cache) {
  const t = Array.isArray(cache?.trendingProducts)
    ? cache.trendingProducts
    : [];
  const b = Array.isArray(cache?.bestSellerProducts)
    ? cache.bestSellerProducts
    : [];
  return (t.length || 0) + (b.length || 0) > 0;
}

function dispatchReady() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(HP_HL_READY_EVENT));
  } catch {}
}

function acquireLock() {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(HP_HL_LOCK);
    const t = raw ? Number(raw) : 0;

    if (Number.isFinite(t) && t > 0 && now() - t < LOCK_TTL_MS) return false;

    window.localStorage.setItem(HP_HL_LOCK, String(now()));
    return true;
  } catch {
    // If storage is blocked, just proceed (best-effort)
    return true;
  }
}

function releaseLock() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(HP_HL_LOCK);
  } catch {}
}

async function fetchHighlights({ signal }) {
  // Primary endpoint: app-level highlights API (curated)
  const res = await fetch("/api/home/highlights", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  if (!json || !json.ok) return null;

  const trendingProducts = Array.isArray(json.trendingProducts)
    ? json.trendingProducts
    : [];
  const bestSellerProducts = Array.isArray(json.bestSellerProducts)
    ? json.bestSellerProducts
    : [];

  return { trendingProducts, bestSellerProducts };
}

function safeIdle(cb, timeoutMs = 900) {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;

  const run = () => {
    if (cancelled) return;
    try {
      cb();
    } catch {}
  };

  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    let id;
    try {
      id = ric(run, { timeout: timeoutMs });
      return () => {
        cancelled = true;
        try {
          window.cancelIdleCallback?.(id);
        } catch {}
      };
    } catch {
      // fall through to setTimeout
    }
  }

  const tid = window.setTimeout(run, Math.min(450, timeoutMs));
  return () => {
    cancelled = true;
    window.clearTimeout(tid);
  };
}

export default function HomePanelPreloader() {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (typeof window === "undefined") return;

    // 1) If cache exists, immediately notify consumers (instant open)
    const existing = readCache();
    if (existing && hasData(existing)) {
      dispatchReady();
    }

    // 2) Warm critical routes (best effort, no failures allowed)
    try {
      router.prefetch("/product");
      router.prefetch("/collections");
      router.prefetch("/cart");
      router.prefetch("/login");
      router.prefetch("/login/otp");
      router.prefetch("/customer/dashboard");
      router.prefetch("/admin/login");
    } catch {}

    // 3) Fetch on mount if cache missing or stale
    const shouldFetchNow = !existing || !isFresh(existing);

    let cancelled = false;
    let cancelIdle = () => {};

    const runFetch = async (reason = "immediate") => {
      if (cancelled) return;

      // Prevent stampede across tabs/mounts
      if (!acquireLock()) return;

      const ac = new AbortController();
      const timeoutMs =
        reason === "immediate" ? FETCH_TIMEOUT_IMMEDIATE_MS : FETCH_TIMEOUT_BG_MS;

      const t = window.setTimeout(() => {
        try {
          ac.abort();
        } catch {}
      }, timeoutMs);

      try {
        const data = await fetchHighlights({ signal: ac.signal });
        if (cancelled) return;
        if (!data) return;

        writeCache(data);
        dispatchReady();
      } catch {
        // Silent by design (HomePanel will fallback if needed)
      } finally {
        window.clearTimeout(t);
        releaseLock();
        try {
          ac.abort();
        } catch {}
      }
    };

    if (shouldFetchNow) {
      // Run immediately so HomePanel opens with data on first interaction
      runFetch("immediate");
    } else {
      // Cache is fresh: do a silent refresh later (keeps it current without any UI cost)
      cancelIdle = safeIdle(() => runFetch("idle"), 1200);
    }

    // 4) Refresh on visibility return if cache is stale
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;

      const c = readCache();
      if (!c || !isFresh(c)) {
        cancelIdle?.();
        cancelIdle = safeIdle(() => runFetch("visible"), 700);
      } else if (hasData(c)) {
        dispatchReady();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      cancelIdle?.();
      document.removeEventListener("visibilitychange", onVisibility);
      // Lock is TTL-based; no forced release here to avoid cross-tab races.
    };
  }, [router]);

  // ✅ Critical: All-products preloader mounts here so desktop production never misses it
  return <HomePanelAllProductsPreloader />;
}
