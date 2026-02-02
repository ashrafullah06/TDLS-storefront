//✅ FILE: src/components/common/client_boot.jsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

/**
 * ClientBoot
 * - Prevents server-layout usage of next/dynamic({ ssr:false }) which can crash builds.
 * - Defers all non-UI boot helpers until after hydration + idle for faster first mount.
 * - Loads ONE chunk (site_boot_helpers) instead of 5 parallel chunks.
 */

const SiteBootHelpers = dynamic(() => import("@/components/common/site_boot_helpers"), {
  ssr: false,
  loading: () => null,
});

function useHydrated() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}

function useIdleGate(timeoutMs = 300) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      setReady(true);
    };

    const t = window.setTimeout(run, timeoutMs);

    let idleId = null;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: timeoutMs });
    }

    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearTimeout(t);

      // ✅ FIX: idleId may be 0 (falsy). Must check against null/undefined.
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }

      document.removeEventListener("visibilitychange", onVis);
    };
  }, [timeoutMs]);

  return ready;
}

export default function ClientBoot() {
  const hydrated = useHydrated();
  const idleReady = useIdleGate(300);

  // ✅ Nothing runs until the page is hydrated + idle (faster first paint)
  if (!hydrated || !idleReady) return null;

  return <SiteBootHelpers />;
}