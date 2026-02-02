//✅ FILE: src/components/common/site_boot_helpers.jsx
"use client";

import AutoSignoutGuard from "@/components/auth/auto_signout_guard";
import SlidingMenuBarPreloader from "@/components/common/slidingmenubar.preloader";
import HomePanelPreloader from "@/components/common/homepanel.preloader";
import BottomFloatingBarPreloader from "@/components/common/bottomfloatingbar.preloader";
import { HomePanelAllProductsPreloader } from "@/components/common/homepanel_all_products";

/**
 * SiteBootHelpers
 * - Single “boot helpers” chunk: avoids 5 separate dynamic chunks/network requests.
 * - Runs only on the customer site tree (AdminRouteGate already splits trees).
 * - No UI output; just warms and mounts background helpers.
 */

export default function SiteBootHelpers() {
  return (
    <>
      <AutoSignoutGuard />
      <SlidingMenuBarPreloader />
      <HomePanelPreloader />
      <HomePanelAllProductsPreloader />
      <BottomFloatingBarPreloader />
    </>
  );
}