//✅ FILE (NEW): src/components/common/slidingmenubar.preloader.jsx
"use client";

import { useEffect } from "react";
import { warmSlidingMenuBar } from "@/components/common/slidingmenubar";

/**
 * SlidingMenuBarPreloader
 * - Runs once per website load / refresh (client side).
 * - Starts the menu preload immediately (no UI).
 * - Ensures: when user opens the menu, data is already warm (no on-click loading).
 */
export default function SlidingMenuBarPreloader() {
  useEffect(() => {
    try {
      warmSlidingMenuBar?.();
    } catch {
      // never block UI
    }
  }, []);

  return null;
}
