// FILE: src/components/common/homepanel.preloader.jsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * HomePanelPreloader (no UI)
 * -----------------------------------------------------------------------------
 * Goal:
 * - Preload HomePanel highlights after the initial page load.
 * - Store payload in localStorage with TTL.
 * - Dispatch an event so HomePanel can hydrate immediately if it opens too fast.
 * - Warm critical routes via router.prefetch (best-effort).
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
const START_DELAY_MS = 30000;

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
  const trending = Array.isArray(cache?.trendingProducts)
    ? cache.trendingProducts
    : [];

  const bestSellers = Array.isArray(cache?.bestSellerProducts)
    ? cache.bestSellerProducts
    : [];

  return trending.length + bestSellers.length > 0;
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
    const timestamp = raw ? Number(raw) : 0;

    if (
      Number.isFinite(timestamp) &&
      timestamp > 0 &&
      now() - timestamp < LOCK_TTL_MS
    ) {
      return false;
    }

    window.localStorage.setItem(HP_HL_LOCK, String(now()));
    return true;
  } catch {
    // If storage is blocked, proceed as a best-effort fallback.
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
  const response = await fetch("/api/home/highlights", {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
    signal,
  });

  if (!response.ok) return null;

  const json = await response.json().catch(() => null);
  if (!json || !json.ok) return null;

  const trendingProducts = Array.isArray(json.trendingProducts)
    ? json.trendingProducts
    : [];

  const bestSellerProducts = Array.isArray(json.bestSellerProducts)
    ? json.bestSellerProducts
    : [];

  return {
    trendingProducts,
    bestSellerProducts,
  };
}

function safeIdle(callback, timeoutMs = 900) {
  if (typeof window === "undefined") return () => {};

  let cancelled = false;

  const run = () => {
    if (cancelled) return;

    try {
      callback();
    } catch {}
  };

  const requestIdle = window.requestIdleCallback;

  if (typeof requestIdle === "function") {
    let id;

    try {
      id = requestIdle(run, {
        timeout: timeoutMs,
      });

      return () => {
        cancelled = true;

        try {
          window.cancelIdleCallback?.(id);
        } catch {}
      };
    } catch {
      // Fall through to setTimeout.
    }
  }

  const timeoutId = window.setTimeout(
    run,
    Math.min(450, timeoutMs)
  );

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
  };
}

export default function HomePanelPreloader() {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;

    startedRef.current = true;

    if (typeof window === "undefined") return;

    // Immediately announce existing cached data without starting a request.
    const existing = readCache();

    if (existing && hasData(existing)) {
      dispatchReady();
    }

    const shouldFetch = !existing || !isFresh(existing);

    let cancelled = false;
    let cancelIdle = () => {};
    let startTimer = null;
    let deferredWorkStarted = false;

    const runFetch = async (reason = "immediate") => {
      if (cancelled) return;

      // Prevent duplicate requests across tabs or component remounts.
      if (!acquireLock()) return;

      const controller = new AbortController();

      const timeoutMs =
        reason === "immediate"
          ? FETCH_TIMEOUT_IMMEDIATE_MS
          : FETCH_TIMEOUT_BG_MS;

      const timeoutId = window.setTimeout(() => {
        try {
          controller.abort();
        } catch {}
      }, timeoutMs);

      try {
        const data = await fetchHighlights({
          signal: controller.signal,
        });

        if (cancelled || !data) return;

        writeCache(data);
        dispatchReady();
      } catch {
        // Silent by design. HomePanel retains its existing fallback.
      } finally {
        window.clearTimeout(timeoutId);
        releaseLock();

        try {
          controller.abort();
        } catch {}
      }
    };

    const startDeferredWork = () => {
      if (cancelled || startTimer !== null) return;

      startTimer = window.setTimeout(async () => {
        startTimer = null;

        if (cancelled) return;

        deferredWorkStarted = true;

        // Complete the highlights request before warming routes so these
        // background operations do not compete with one another.
        if (shouldFetch) {
          await runFetch("immediate");
        }

        if (cancelled) return;

        try {
          router.prefetch("/product");
          router.prefetch("/collections");
          router.prefetch("/cart");
          router.prefetch("/login");
          router.prefetch("/login/otp");
          router.prefetch("/customer/dashboard");
          router.prefetch("/admin/login");
        } catch {}
      }, START_DELAY_MS);
    };

    if (document.readyState === "complete") {
      startDeferredWork();
    } else {
      window.addEventListener("load", startDeferredWork, {
        once: true,
      });
    }

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;

      const cached = readCache();

      // A visibility event must not bypass the initial defer period.
      if (!deferredWorkStarted) {
        if (cached && hasData(cached)) {
          dispatchReady();
        }

        return;
      }

      if (!cached || !isFresh(cached)) {
        cancelIdle();
        cancelIdle = safeIdle(
          () => runFetch("visible"),
          700
        );
      } else if (hasData(cached)) {
        dispatchReady();
      }
    };

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      cancelled = true;
      cancelIdle();

      if (startTimer !== null) {
        window.clearTimeout(startTimer);
        startTimer = null;
      }

      window.removeEventListener(
        "load",
        startDeferredWork
      );

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );

      // Allow React development effect verification to initialize again
      // after its setup-cleanup cycle.
      startedRef.current = false;

      // The request lock remains TTL-based to avoid cross-tab races.
    };
  }, [router]);

  return null;
}