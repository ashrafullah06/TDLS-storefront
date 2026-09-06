//✅ FILE: src/components/common/site_boot_helpers.jsx
"use client";

import AutoSignoutGuard from "@/components/auth/auto_signout_guard";
import HomePanelPreloader from "@/components/common/homepanel.preloader";
import BottomFloatingBarPreloader from "@/components/common/bottomfloatingbar.preloader";
import SlidingMenuBarPreloader from "@/components/common/slidingmenubar.preloader";
import { HomePanelAllProductsPreloader } from "@/components/common/homepanel_all_products";

/**
 * Customer-site background helpers.
 * Keep the sliding-menu preloader here so menu warming does not depend on
 * a second, easy-to-miss mount in app/layout.js.
 */
export default function SiteBootHelpers() {
  return (
    <>
      <SlidingMenuBarPreloader />
      <AutoSignoutGuard />
      <HomePanelPreloader />
      <HomePanelAllProductsPreloader />
      <BottomFloatingBarPreloader />
    </>
  );
}