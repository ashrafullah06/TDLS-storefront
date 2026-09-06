// FILE: src/components/common/site_boot_helpers.jsx
"use client";

import AutoSignoutGuard from "@/components/auth/auto_signout_guard";
import HomePanelPreloader from "@/components/common/homepanel.preloader";
import BottomFloatingBarPreloader from "@/components/common/bottomfloatingbar.preloader";
import { HomePanelAllProductsPreloader } from "@/components/common/homepanel_all_products";

/**
 * Customer-site background helpers.
 *
 * SlidingMenuBarPreloader is intentionally NOT mounted here because app/layout.js
 * already mounts it directly at the top of the customer tree. Keeping a second
 * mount here would duplicate effects/listeners without improving preload timing.
 */
export default function SiteBootHelpers() {
  return (
    <>
      <AutoSignoutGuard />
      <HomePanelPreloader />
      <HomePanelAllProductsPreloader />
      <BottomFloatingBarPreloader />
    </>
  );
}