// FILE: src/components/common/bottomfloatingbar.shell.jsx
"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const BottomFloatingBar = dynamic(() => import("./bottomfloatingbar.client"), {
  ssr: false,
});

const LS_KEY = "tdls:bfbar:data:v1";
const LS_TS = "tdls:bfbar:ts:v1";

// How often to “check” server (still feels hardcoded)
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000; // 6 hours

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function isValidPayload(x) {
  return (
    x &&
    typeof x === "object" &&
    Array.isArray(x.products) &&
    Array.isArray(x.ageGroups) &&
    Array.isArray(x.categories) &&
    Array.isArray(x.audienceCategories)
  );
}

export default function BottomFloatingBarShell(props) {
  const [initialData, setInitialData] = useState(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    // 1) Instant paint from localStorage (hardcoded feel)
    const cachedRaw = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    const cached = cachedRaw ? safeJsonParse(cachedRaw) : null;

    if (isValidPayload(cached)) {
      setInitialData(cached);
    }

    // 2) Best-effort refresh (admin updates), throttled
    const controller = new AbortController();

    (async () => {
      try {
        const last = Number(localStorage.getItem(LS_TS) || "0");
        const now = Date.now();

        // Throttle refresh attempts (prevents repeated calls on errors/navigation)
        if (now - last < CHECK_EVERY_MS) return;

        // Record attempt time immediately to avoid hammering if the API is down
        localStorage.setItem(LS_TS, String(now));

        const res = await fetch("/api/bfbar", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!res.ok) return;

        const json = await res.json().catch(() => null);
        const data = json?.ok ? json.data : null;

        if (!isValidPayload(data)) return;

        // Persist the “caught” snapshot
        localStorage.setItem(LS_KEY, JSON.stringify(data));

        // Update UI if still mounted
        if (mountedRef.current) setInitialData(data);
      } catch {
        // Non-fatal
      }
    })();

    return () => {
      mountedRef.current = false;
      try {
        controller.abort();
      } catch {}
    };
  }, []);

  return <BottomFloatingBar {...props} initialData={initialData} />;
}
