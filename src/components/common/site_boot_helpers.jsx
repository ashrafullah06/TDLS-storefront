// FILE: src/components/common/site_boot_helpers.jsx
"use client";

import { useEffect, useState } from "react";
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
  const [
    mountAllProductsPreloader,
    setMountAllProductsPreloader,
  ] = useState(false);

  useEffect(() => {
    let timer = null;

    const schedule = () => {
      if (timer !== null) return;

      timer = window.setTimeout(() => {
        setMountAllProductsPreloader(true);
      }, 60000);
    };

    if (document.readyState === "complete") {
      schedule();
    } else {
      window.addEventListener("load", schedule, {
        once: true,
      });
    }

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }

      window.removeEventListener("load", schedule);
    };
  }, []);

  return (
    <>
      <AutoSignoutGuard />
      <HomePanelPreloader />

      {mountAllProductsPreloader ? (
        <HomePanelAllProductsPreloader />
      ) : null}

      <BottomFloatingBarPreloader />
    </>
  );
}