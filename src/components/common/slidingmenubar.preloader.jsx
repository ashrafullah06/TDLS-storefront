// FILE: src/components/common/slidingmenubar.preloader.jsx
"use client";

import { useEffect } from "react";

const GLOBAL_KEY = "__TDLS_SMB_PRELOAD_STATE__";
const RAW_LS_KEY = "tdls:slidingmenubar:raw-products:v1";
const RAW_LS_TS = "tdls:slidingmenubar:raw-products-ts:v1";
const RAW_LS_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25000;
const PAGE_SIZE = 100;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [2500, 7000];

// Use the canonical tier relation shared with product-query.js.
// Do not query all historical tier aliases on the production schema.
const PRODUCT_RELATIONS = [
  "audience_categories",
  "categories",
  "sub_categories",
  "gender_groups",
  "age_groups",
  "brand_tiers",
  "events_products_collections",
];

function buildProductsPath(page) {
  const params = new URLSearchParams();

  params.set("pagination[page]", String(page));
  params.set("pagination[pageSize]", String(PAGE_SIZE));
  params.set("pagination[withCount]", "true");
  params.set("sort", "id:asc");

  [
    "slug",
    "name",
    "status",
    "disable_frontend",
    "is_archived",
  ].forEach((field, index) => {
    params.set(`fields[${index}]`, field);
  });

  for (const relation of PRODUCT_RELATIONS) {
    params.set(`populate[${relation}][fields][0]`, "slug");
    params.set(`populate[${relation}][fields][1]`, "name");
  }

  return `/products?${params}`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getStorage() {
  try {
    return typeof window !== "undefined"
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

function getGlobalState() {
  const state =
    globalThis[GLOBAL_KEY] ||
    (globalThis[GLOBAL_KEY] = {});

  const defaults = {
    ok: false,
    inFlight: false,
    promise: null,
    rawOk: false,
    rawPayload: null,
    rawTs: 0,
    menuData: null,
    lastFailAt: 0,
    retryCount: 0,
    preloadAttempts: 0,
    preloadRetryable: true,
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in state)) {
      state[key] = value;
    }
  }

  return state;
}

function unwrapProxyPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(raw, "ok")) {
    return raw.ok === true
      ? raw.data ?? null
      : null;
  }

  return raw.error ? null : raw;
}

function extractRows(raw) {
  const payload = unwrapProxyPayload(raw);

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }

  return [];
}

function hasUsableRawPayload(raw) {
  const payload = unwrapProxyPayload(raw);
  const pagination = payload?.meta?.pagination;

  // Reject an older first-page-only cache when more pages existed.
  if (pagination && Number(pagination.pageCount) > 1) {
    return false;
  }

  return extractRows(raw).length > 0;
}

function hasUsableMenuData(data) {
  return (
    (data?.audienceRows?.length || 0) > 0 &&
    (data?.productIndex?.size || 0) > 0
  );
}

function isFresh(ts) {
  const age = Date.now() - Number(ts);

  return (
    Number(ts) > 0 &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < RAW_LS_TTL_MS
  );
}

function readRawCache() {
  const storage = getStorage();

  if (!storage) {
    return null;
  }

  try {
    const ts = Number(storage.getItem(RAW_LS_TS) || 0);

    if (!isFresh(ts)) {
      return null;
    }

    const raw = safeJsonParse(
      storage.getItem(RAW_LS_KEY)
    );

    return hasUsableRawPayload(raw)
      ? { raw, ts }
      : null;
  } catch {
    return null;
  }
}

function publishRawPayload(raw, ts = Date.now()) {
  if (!hasUsableRawPayload(raw)) {
    return false;
  }

  const state = getGlobalState();

  state.rawOk = true;
  state.rawPayload = raw;
  state.rawTs = ts;

  const storage = getStorage();

  if (storage) {
    try {
      storage.setItem(
        RAW_LS_KEY,
        JSON.stringify(raw)
      );
      storage.setItem(
        RAW_LS_TS,
        String(ts)
      );
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

  if (
    isFresh(state.rawTs) &&
    hasUsableRawPayload(state.rawPayload)
  ) {
    return {
      raw: state.rawPayload,
      ts: state.rawTs,
    };
  }

  const cached = readRawCache();

  if (!cached) {
    return null;
  }

  state.rawOk = true;
  state.rawPayload = cached.raw;
  state.rawTs = cached.ts;

  return cached;
}

function preloadError(message, retryable = false) {
  const error = new Error(message);
  error.retryable = retryable;
  return error;
}

async function fetchRawProducts() {
  const controller = new AbortController();

  // One deadline covers every page and response-body read in this attempt.
  const timer = window.setTimeout(
    () => controller.abort(),
    FETCH_TIMEOUT_MS
  );

  const rows = [];
  const seen = new Set();

  let page = 1;
  let pageCount = 1;

  try {
    do {
      const res = await fetch(
        `/api/strapi?path=${encodeURIComponent(
          buildProductsPath(page)
        )}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          credentials: "same-origin",
          cache: "default",
          signal: controller.signal,
        }
      );

      const raw = await res.json().catch(() => null);

      if (!res.ok || raw?.ok === false) {
        // The proxy may expose an upstream 400 inside an HTTP 502 response.
        const status = Number(
          raw?.status || res.status
        );

        const retryable = [
          408,
          429,
          500,
          502,
          503,
          504,
          520,
          521,
        ].includes(status);

        throw preloadError(
          `Sliding menu preload failed (HTTP ${status}).`,
          retryable
        );
      }

      const payload = unwrapProxyPayload(raw);

      if (
        !Array.isArray(payload?.data) ||
        payload.error
      ) {
        throw preloadError(
          "Sliding menu preload returned an invalid product response."
        );
      }

      const pagination = payload.meta?.pagination;

      if (pagination) {
        const returnedPage = Number(pagination.page);
        const returnedCount = Number(pagination.pageCount);

        if (
          returnedPage !== page ||
          !Number.isInteger(returnedCount) ||
          returnedCount < 0
        ) {
          throw preloadError(
            "Sliding menu preload returned invalid pagination."
          );
        }

        pageCount = Math.max(1, returnedCount);
      } else if (payload.data.length >= PAGE_SIZE) {
        throw preloadError(
          "Sliding menu preload is missing pagination metadata."
        );
      }

      let added = 0;

      for (const row of payload.data) {
        const key =
          row?.id ??
          row?.documentId ??
          row?.attributes?.slug ??
          row?.slug;

        if (
          key == null ||
          seen.has(String(key))
        ) {
          continue;
        }

        seen.add(String(key));
        rows.push(row);
        added++;
      }

      if (page < pageCount && added === 0) {
        throw preloadError(
          "Sliding menu pagination did not advance."
        );
      }

      page++;
    } while (page <= pageCount);

    if (!rows.length) {
      throw preloadError(
        "Sliding menu preload returned no products."
      );
    }

    // Publish only the completed snapshot; never cache a partial catalogue.
    const raw = { data: rows };
    const ts = Date.now();

    publishRawPayload(raw, ts);

    return { raw, ts };
  } finally {
    window.clearTimeout(timer);
  }
}

async function startPreload(
  { forceNetwork = false } = {}
) {
  if (typeof window === "undefined") {
    return null;
  }

  const state = getGlobalState();

  if (state.promise) {
    return state.promise;
  }

  if (
    state.ok &&
    hasUsableMenuData(state.menuData) &&
    !forceNetwork
  ) {
    return state.menuData;
  }

  if (
    state.preloadAttempts >= MAX_ATTEMPTS ||
    !state.preloadRetryable
  ) {
    return null;
  }

  if (
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    return null;
  }

  state.inFlight = true;
  state.preloadAttempts += 1;

  // Set ownership before the menu module evaluates its own auto-warm code.
  state.promise = Promise.resolve()
    .then(async () => {
      const modulePromise = import(
        "@/components/common/slidingmenubar"
      ).catch(() => null);

      const cached = forceNetwork
        ? null
        : hydrateGlobalFromRawCache();

      if (!cached) {
        await fetchRawProducts();
      }

      const module = await modulePromise;

      if (
        typeof module?.warmSlidingMenuBar !== "function"
      ) {
        throw preloadError(
          "Sliding menu module could not be loaded.",
          true
        );
      }

      // Fresh raw data needs a rebuild. The menu's fetchAndBuildFresh consumes
      // the shared raw snapshot first, without a second product request.
      const data = await module.warmSlidingMenuBar({
        forceRefresh: !cached,
        fromPreloader: true,
      });

      if (!hasUsableMenuData(data)) {
        throw preloadError(
          "Sliding menu preload returned no usable menu data."
        );
      }

      state.ok = true;
      state.menuData = data;
      state.retryCount = 0;
      state.lastFailAt = 0;

      return data;
    })
    .catch((error) => {
      state.lastFailAt = Date.now();

      state.preloadRetryable =
        typeof error?.retryable === "boolean"
          ? error.retryable
          : error?.name === "AbortError" ||
            error instanceof TypeError;

      if (
        state.ok &&
        hasUsableMenuData(state.menuData)
      ) {
        return state.menuData;
      }

      throw error;
    })
    .finally(() => {
      state.inFlight = false;
      state.promise = null;
    });

  return state.promise;
}

// Start before interaction and before React's effect phase.
if (typeof window !== "undefined") {
  void startPreload().catch(() => {});
}

export default function SlidingMenuBarPreloader() {
  useEffect(() => {
    let mounted = true;
    let retryTimer = null;

    const state = getGlobalState();

    function removeListeners() {
      window.removeEventListener(
        "pointerdown",
        warmOnInteraction,
        true
      );

      window.removeEventListener(
        "keydown",
        warmOnInteraction,
        true
      );

      document.removeEventListener(
        "visibilitychange",
        warmOnVisibility
      );

      window.removeEventListener(
        "focus",
        warmOnFocus
      );

      window.removeEventListener(
        "online",
        warmOnOnline
      );
    }

    function scheduleRetry() {
      if (
        !mounted ||
        state.ok ||
        !state.preloadRetryable ||
        state.preloadAttempts >= MAX_ATTEMPTS ||
        retryTimer !== null
      ) {
        return;
      }

      const delay =
        RETRY_DELAYS[
          Math.max(0, state.preloadAttempts - 1)
        ] || 7000;

      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void warm();
      }, delay);
    }

    async function warm() {
      if (!mounted) {
        return;
      }

      if (
        state.ok &&
        hasUsableMenuData(state.menuData)
      ) {
        removeListeners();
        return;
      }

      if (retryTimer !== null) {
        return;
      }

      if (
        state.lastFailAt &&
        Date.now() - state.lastFailAt < 2500
      ) {
        scheduleRetry();
        return;
      }

      try {
        // Join module-level work instead of ignoring its eventual failure.
        await startPreload();

        if (mounted && state.ok) {
          removeListeners();
        }
      } catch {
        scheduleRetry();
      }
    }

    function warmOnInteraction() {
      void warm();
    }

    function warmOnVisibility() {
      if (document.visibilityState === "visible") {
        void warm();
      }
    }

    function warmOnFocus() {
      void warm();
    }

    function warmOnOnline() {
      void warm();
    }

    window.addEventListener(
      "pointerdown",
      warmOnInteraction,
      {
        passive: true,
        capture: true,
      }
    );

    window.addEventListener(
      "keydown",
      warmOnInteraction,
      {
        capture: true,
      }
    );

    document.addEventListener(
      "visibilitychange",
      warmOnVisibility,
      {
        passive: true,
      }
    );

    window.addEventListener(
      "focus",
      warmOnFocus,
      {
        passive: true,
      }
    );

    window.addEventListener(
      "online",
      warmOnOnline,
      {
        passive: true,
      }
    );

    void warm();

    return () => {
      mounted = false;

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }

      removeListeners();
    };
  }, []);

  return null;
}