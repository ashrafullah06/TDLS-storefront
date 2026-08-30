// ✅ FILE: src/components/common/slidingmenubar.preloader.jsx
"use client";

import { useEffect } from "react";

/**
 * SlidingMenuBarPreloader
 * - Runs once per website load / refresh (client side).
 * - ✅ Electric-fast mount: warm happens during idle time (or soon via timeout),
 *   so it doesn't compete with first paint/hydration.
 * - ✅ Dynamic import: keeps initial bundle lighter; loads sliding menu chunk only when warming.
 * - ✅ Fallback: interaction / visibility / focus triggers warm if idle hasn't fired yet.
 *
 * PRODUCTION HARDENING:
 * - If the dynamic import / warm fails once, it MUST be allowed to retry.
 * - Do NOT use `{ once:true }` on interaction listeners (it can “consume” the only retry).
 * - Remove listeners only AFTER a successful warm (near-zero overhead afterward).
 * - Use a global singleton warm-state so multiple mounts don’t cause duplicate warming.
 */

const G = typeof globalThis !== "undefined" ? globalThis : {};
const GLOBAL_KEY = "__TDLS_SMB_PRELOAD_STATE__";
const GLOBAL_STATE =
  G[GLOBAL_KEY] ||
  (G[GLOBAL_KEY] = {
    ok: false, // warmed successfully
    inFlight: false, // warm currently running
    lastFailAt: 0, // last failure timestamp (debounce spam retries)
  });

function scheduleIdle(fn, timeout = 900) {
  if (typeof window === "undefined") return () => {};

  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    try {
      fn();
    } catch {
      // never block UI
    }
  };

  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout });
    return () => {
      cancelled = true;
      try {
        window.cancelIdleCallback(id);
      } catch {}
    };
  }

  const id = window.setTimeout(run, Math.min(650, timeout));
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}

export default function SlidingMenuBarPreloader() {
  useEffect(() => {
    let mounted = true;

    const st = GLOBAL_STATE;
    if (st.ok) return;

    const removeRef = { done: false };

    function onFirstInteraction() {
      warm();
    }
    function onVis() {
      if (document.visibilityState === "visible") warm();
    }
    function onFocus() {
      warm();
    }

    const removeListeners = () => {
      if (removeRef.done) return;
      removeRef.done = true;

      try {
        window.removeEventListener("pointerdown", onFirstInteraction, true);
        window.removeEventListener("keydown", onFirstInteraction, true);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("focus", onFocus);
      } catch {
        // ignore
      }
    };

    const warm = async () => {
      if (!mounted) return;

      if (st.ok || st.inFlight) return;

      // Tiny debounce so repeated interaction spam doesn’t hammer import() if it keeps failing.
      if (st.lastFailAt && Date.now() - st.lastFailAt < 600) return;

      st.inFlight = true;
      try {
        const mod = await import("@/components/common/slidingmenubar");

        const maybe = mod?.warmSlidingMenuBar?.();
        if (maybe && typeof maybe.then === "function") await maybe;

        st.ok = true;
        removeListeners();
      } catch {
        // allow retry next idle / interaction / visibility / focus
        st.lastFailAt = Date.now();
      } finally {
        st.inFlight = false;
      }
    };

    // 1) Prefer idle warm (fast mount)
    const cancelIdle = scheduleIdle(warm, 900);

    // 2) Backup: warm on interaction (covers immediate open)
    window.addEventListener("pointerdown", onFirstInteraction, {
      passive: true,
      capture: true,
    });
    window.addEventListener("keydown", onFirstInteraction, {
      passive: true,
      capture: true,
    });

    // 3) If user returns to the tab / focuses window, ensure warm happened
    document.addEventListener("visibilitychange", onVis, { passive: true });
    window.addEventListener("focus", onFocus, { passive: true });

    return () => {
      mounted = false;
      try {
        cancelIdle?.();
      } catch {}
      removeListeners();
    };
  }, []);

  return null;
}