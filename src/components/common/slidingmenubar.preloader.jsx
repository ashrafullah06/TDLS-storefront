// ✅ FILE: src/components/common/slidingmenubar.preloader.jsx
"use client";

import { useEffect } from "react";

/**
 * TDLS SlidingMenuBar boot preloader
 * -----------------------------------------------------------------------------
 * Purpose:
 * - Start loading menu taxonomy as soon as THIS SMALL MODULE is evaluated.
 * - Do not wait for the customer to click the menu.
 * - Do not wait for requestIdleCallback.
 * - Do not require the large SlidingMenuBar chunk before the API request starts.
 * - Share the fetched payload through globalThis + localStorage so the menu can
 *   build instantly when its chunk is eventually mounted.
 */

const GLOBAL_KEY = "__TDLS_SMB_PRELOAD_STATE__";

const RAW_LS_KEY = "tdls:slidingmenubar:raw-products:v1";
const RAW_LS_TS = "tdls:slidingmenubar:raw-products-ts:v1";
const RAW_LS_TTL_MS = 6 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 16000;

/**
 * IMPORTANT:
 * This query is deliberately shallow and bounded.
 * It contains only the relations required by SlidingMenuBar and stays below
 * the public heavy-query guard used by /api/strapi.
 */
const PRODUCTS_PRELOAD_PATH =
  "/products?pagination[pageSize]=500" +
  "&fields[0]=slug&fields[1]=name&fields[2]=status&fields[3]=disable_frontend&fields[4]=is_archived" +
  "&populate[audience_categories][fields][0]=slug&populate[audience_categories][fields][1]=name" +
  "&populate[categories][fields][0]=slug&populate[categories][fields][1]=name" +
  "&populate[sub_categories][fields][0]=slug&populate[sub_categories][fields][1]=name" +
  "&populate[gender_groups][fields][0]=slug&populate[gender_groups][fields][1]=name" +
  "&populate[age_groups][fields][0]=slug&populate[age_groups][fields][1]=name" +
  "&populate[tiers][fields][0]=slug&populate[tiers][fields][1]=name" +
  "&populate[brand_tiers][fields][0]=slug&populate[brand_tiers][fields][1]=name" +
  "&populate[collection_tiers][fields][0]=slug&populate[collection_tiers][fields][1]=name" +
  "&populate[events_products_collections][fields][0]=slug&populate[events_products_collections][fields][1]=name" +
  "&populate[product_collections][fields][0]=slug&populate[product_collections][fields][1]=name";

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function canUseLS() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function getGlobalState() {
  const root = globalThis;

  if (!root[GLOBAL_KEY]) {
    root[GLOBAL_KEY] = {
      ok: false,
      inFlight: false,
      promise: null,
      rawOk: false,
      rawPayload: null,
      rawTs: 0,
      menuData: null,
      lastFailAt: 0,
      retryCount: 0,
    };
  } else {
    const state = root[GLOBAL_KEY];
    if (!("ok" in state)) state.ok = false;
    if (!("inFlight" in state)) state.inFlight = false;
    if (!("promise" in state)) state.promise = null;
    if (!("rawOk" in state)) state.rawOk = false;
    if (!("rawPayload" in state)) state.rawPayload = null;
    if (!("rawTs" in state)) state.rawTs = 0;
    if (!("menuData" in state)) state.menuData = null;
    if (!("lastFailAt" in state)) state.lastFailAt = 0;
    if (!("retryCount" in state)) state.retryCount = 0;
  }

  return root[GLOBAL_KEY];
}

function unwrapProxyPayload(raw) {
  if (!raw || typeof raw !== "object") return raw;

  if (Object.prototype.hasOwnProperty.call(raw, "ok")) {
    if (raw.ok === true) return raw.data ?? null;
    return null;
  }

  if (raw?.error && raw?.data == null) return null;
  return raw;
}

function extractRows(raw) {
  const payload = unwrapProxyPayload(raw);
  if (!payload) return [];

  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && Array.isArray(payload.data?.data)) return payload.data.data;

  return [];
}

function hasUsableRawPayload(raw) {
  return extractRows(raw).length > 0;
}

function hasUsableMenuData(data) {
  return (
    (data?.audienceRows?.length || 0) > 0 &&
    (data?.productIndex?.size || 0) > 0
  );
}

function readRawCache() {
  if (!canUseLS()) return null;

  try {
    const ts = Number(window.localStorage.getItem(RAW_LS_TS) || 0);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > RAW_LS_TTL_MS) return null;

    const text = window.localStorage.getItem(RAW_LS_KEY);
    if (!text) return null;

    const raw = safeJsonParse(text);
    if (!hasUsableRawPayload(raw)) return null;

    return { raw, ts };
  } catch {
    return null;
  }
}

function publishRawPayload(raw, ts = Date.now()) {
  if (!hasUsableRawPayload(raw)) return false;

  const state = getGlobalState();
  state.rawOk = true;
  state.rawPayload = raw;
  state.rawTs = ts;

  if (canUseLS()) {
    try {
      window.localStorage.setItem(RAW_LS_KEY, JSON.stringify(raw));
      window.localStorage.setItem(RAW_LS_TS, String(ts));
    } catch {}
  }

  try {
    window.dispatchEvent(
      new CustomEvent("tdls:slidingmenubar-preloaded", {
        detail: { raw: true, ts },
      })
    );
  } catch {}

  return true;
}

function hydrateGlobalFromRawCache() {
  const state = getGlobalState();

  if (state.rawOk && hasUsableRawPayload(state.rawPayload)) {
    return { raw: state.rawPayload, ts: state.rawTs || Date.now() };
  }

  const cached = readRawCache();
  if (!cached) return null;

  state.rawOk = true;
  state.rawPayload = cached.raw;
  state.rawTs = cached.ts;
  return cached;
}

async function fetchRawProducts() {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && typeof window !== "undefined"
      ? window.setTimeout(() => {
          try {
            controller.abort();
          } catch {}
        }, FETCH_TIMEOUT_MS)
      : null;

  try {
    const url = `/api/strapi?path=${encodeURIComponent(PRODUCTS_PRELOAD_PATH)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "default",
      signal: controller?.signal,
    });

    if (!res.ok) throw new Error(`Sliding menu preload HTTP ${res.status}`);

    const raw = await res.json().catch(() => null);
    if (!hasUsableRawPayload(raw)) {
      throw new Error("Sliding menu preload returned no products");
    }

    const ts = Date.now();
    publishRawPayload(raw, ts);
    return { raw, ts };
  } finally {
    if (timer && typeof window !== "undefined") window.clearTimeout(timer);
  }
}

/**
 * Starts the real preload.
 *
 * The API request starts independently of the large menu chunk. After raw data
 * is available, the menu module is imported and asked to convert/cache it. That
 * means a later menu click normally performs zero waiting network work.
 */
async function startPreload({ forceNetwork = false } = {}) {
  if (typeof window === "undefined") return null;

  const state = getGlobalState();

  if (state.ok && !forceNetwork) return state.menuData || null;
  if (state.promise) return state.promise;

  state.inFlight = true;

  state.promise = (async () => {
    let module = null;
    let cachedRaw = hydrateGlobalFromRawCache();

    // Start downloading the menu chunk immediately, in parallel with the API.
    const modulePromise = import("@/components/common/slidingmenubar")
      .then((m) => m)
      .catch(() => null);

    // If we already have usable raw data, build the processed cache immediately.
    if (cachedRaw) {
      module = await modulePromise;
      if (module?.warmSlidingMenuBar) {
        try {
          const cachedData = await module.warmSlidingMenuBar({ forceRefresh: false, fromPreloader: true });
          if (hasUsableMenuData(cachedData)) {
            state.ok = true;
            state.menuData = cachedData;
          }
        } catch {}
      }
    }

    // Always make one network warm attempt per page load unless another call is
    // already doing it. This keeps live data current while cached data remains instant.
    try {
      const freshRaw = await fetchRawProducts();
      cachedRaw = freshRaw || cachedRaw;

      module = module || (await modulePromise);
      if (!module?.warmSlidingMenuBar) {
        throw new Error("Sliding menu module could not be loaded");
      }

      // forceRefresh:false is intentional: the fresh raw payload is already in
      // the shared cache, so the menu should CONVERT it, not start a second API request.
      const data = await module.warmSlidingMenuBar({ forceRefresh: false, fromPreloader: true });

      if (!hasUsableMenuData(data)) {
        throw new Error("Sliding menu preload returned no usable menu data");
      }

      state.ok = true;
      state.menuData = data;
      state.retryCount = 0;
      state.lastFailAt = 0;

      return data;
    } catch (error) {
      // A previously cached menu is still a successful preload for the current click.
      if (state.ok && state.menuData) return state.menuData;

      module = module || (await modulePromise);

      // Final fallback: let SlidingMenuBar perform its own resilient fetch path.
      if (module?.warmSlidingMenuBar) {
        const data = await module.warmSlidingMenuBar({ forceRefresh: true, fromPreloader: true });
        if (hasUsableMenuData(data)) {
          state.ok = true;
          state.menuData = data;
          state.retryCount = 0;
          state.lastFailAt = 0;
          return data;
        }
      }

      throw error;
    }
  })()
    .catch((error) => {
      state.lastFailAt = Date.now();
      throw error;
    })
    .finally(() => {
      state.inFlight = false;
      state.promise = null;
    });

  return state.promise;
}

/**
 * CRITICAL PRELOAD:
 * Begin immediately when the preloader JS chunk is evaluated — before React's
 * effect phase and without waiting for user interaction or browser idle time.
 */
if (typeof window !== "undefined") {
  try {
    hydrateGlobalFromRawCache();
    void startPreload().catch(() => {});
  } catch {}
}

export default function SlidingMenuBarPreloader() {
  useEffect(() => {
    let mounted = true;
    let retryTimer = null;

    const state = getGlobalState();
    const removeRef = { done: false };

    function removeListeners() {
      if (removeRef.done) return;
      removeRef.done = true;

      window.removeEventListener("pointerdown", warmOnInteraction, true);
      window.removeEventListener("keydown", warmOnInteraction, true);
      document.removeEventListener("visibilitychange", warmOnVisibility);
      window.removeEventListener("focus", warmOnFocus);
      window.removeEventListener("online", warmOnOnline);
    }

    function scheduleRetry() {
      if (!mounted || state.ok || state.retryCount >= 4 || retryTimer !== null) return;

      const retryDelays = [800, 2500, 7000, 15000];
      const delay = retryDelays[state.retryCount] || retryDelays[retryDelays.length - 1];
      state.retryCount += 1;

      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void warm(false);
      }, delay);
    }

    async function warm(forceNetwork = false) {
      if (!mounted) return;

      if (state.ok && !forceNetwork) {
        removeListeners();
        return;
      }

      if (state.inFlight || state.promise) return;

      if (state.lastFailAt && Date.now() - state.lastFailAt < 500) return;

      try {
        await startPreload({ forceNetwork });
        if (state.ok) removeListeners();
      } catch {
        scheduleRetry();
      }
    }

    function warmOnInteraction() {
      void warm(false);
    }

    function warmOnVisibility() {
      if (document.visibilityState === "visible") void warm(false);
    }

    function warmOnFocus() {
      void warm(false);
    }

    function warmOnOnline() {
      state.lastFailAt = 0;
      void warm(true);
    }

    // Effect-level call is a second guarantee. Module evaluation already started it.
    void warm(false);

    window.addEventListener("pointerdown", warmOnInteraction, {
      passive: true,
      capture: true,
    });

    window.addEventListener("keydown", warmOnInteraction, {
      capture: true,
    });

    document.addEventListener("visibilitychange", warmOnVisibility, {
      passive: true,
    });

    window.addEventListener("focus", warmOnFocus, {
      passive: true,
    });

    window.addEventListener("online", warmOnOnline, {
      passive: true,
    });

    return () => {
      mounted = false;

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }

      removeListeners();
    };
  }, []);

  return null;
}