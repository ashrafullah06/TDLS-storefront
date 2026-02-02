"use client";

import { useEffect } from "react";

/**
 * SlidingMenuBarPreloader
 * - Runs once per website load / refresh (client side).
 * - ✅ Electric-fast mount: warm happens during idle time (or soon via timeout),
 *   so it doesn't compete with first paint/hydration.
 * - ✅ Dynamic import: keeps initial bundle lighter; loads sliding menu chunk only when warming.
 * - ✅ Fallback: first user interaction triggers warm if idle hasn't fired yet.
 */
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
    let warmed = false;

    const warm = async () => {
      if (warmed) return;
      warmed = true;

      try {
        const mod = await import("@/components/common/slidingmenubar");
        mod?.warmSlidingMenuBar?.();
      } catch {
        // never block UI
      }
    };

    // 1) Prefer idle warm (fast mount)
    const cancelIdle = scheduleIdle(warm, 900);

    // 2) Backup: warm on first interaction (covers fast click/open)
    const onFirstInteraction = () => warm();
    window.addEventListener("pointerdown", onFirstInteraction, { passive: true, once: true });
    window.addEventListener("keydown", onFirstInteraction, { passive: true, once: true });

    // 3) Optional: if user returns to the tab, ensure warm happened
    const onVis = () => {
      if (document.visibilityState === "visible") warm();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelIdle?.();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
    };
  }, []);

  return null;
}