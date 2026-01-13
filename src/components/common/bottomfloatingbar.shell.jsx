// FILE: src/components/common/bottomfloatingbar.shell.jsx
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const BottomFloatingBar = dynamic(() => import("./bottomfloatingbar.client"), {
  ssr: false,
});

const LS_KEY = "tdls:bfbar:data:v1";
const LS_TS = "tdls:bfbar:ts:v1";

// how often to “check” server (still feels hardcoded)
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000; // 6 hours

export default function BottomFloatingBarShell(props) {
  const [initialData, setInitialData] = useState(null);

  useEffect(() => {
    // 1) Instant paint from localStorage (hardcoded feel)
    try {
      const cached = localStorage.getItem(LS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === "object") setInitialData(parsed);
      }
    } catch {}

    // 2) Best-effort refresh (admin updates). Not every visit.
    (async () => {
      try {
        const last = Number(localStorage.getItem(LS_TS) || "0");
        const now = Date.now();
        if (now - last < CHECK_EVERY_MS) return;

        const res = await fetch("/api/bfbar", { method: "GET", cache: "no-store" });
        if (!res.ok) return;

        const json = await res.json().catch(() => null);
        const data = json?.ok ? json.data : null;
        if (!data) return;

        localStorage.setItem(LS_KEY, JSON.stringify(data));
        localStorage.setItem(LS_TS, String(now));
        setInitialData(data);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  return <BottomFloatingBar {...props} initialData={initialData} />;
}
