// FILE: app/providers.jsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import { SessionProvider } from "next-auth/react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * COMPLETE SEPARATION GUARANTEE (HARD):
 * - Admin and Customer auth planes NEVER share a SessionProvider basePath.
 * - Admin uses /api/admin/auth (admin cookie namespace: tdlc_a_*)
 * - Customer uses /api/auth (customer cookie namespace: tdlc_c_*)
 * - Storefront analytics never runs on /admin/*
 *
 * IMPORTANT HARDENING:
 * - Explicitly set basePath for BOTH planes (prevents any stale __NEXTAUTH config leakage).
 * - Force remount when switching plane (key="admin" | "customer").
 *
 * FIX (maximum update depth):
 * - useSearchParams() object identity can change frequently; do NOT depend on the object itself.
 * - Depend on the *stringified* query only (stable).
 * - Deduplicate page_view firing to avoid effect storms.
 */

function isAdminPath(pathname) {
  const p = String(pathname || "");
  return p === "/admin" || p.startsWith("/admin/");
}

export default function Providers({ children }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const adminRoute = useMemo(() => isAdminPath(pathname), [pathname]);

  // IMPORTANT: do not put `searchParams` (object) in deps. Convert to a stable string.
  const qsString = useMemo(() => {
    if (adminRoute) return "";
    try {
      const s = searchParams?.toString?.() || "";
      return s ? `?${s}` : "";
    } catch {
      return "";
    }
  }, [adminRoute, searchParams?.toString?.()]); // depend on the string, not the object

  // Stable current path+query (storefront analytics only)
  const pathWithQuery = useMemo(() => {
    if (adminRoute) return ""; // no need to compute
    return `${String(pathname || "")}${qsString}`;
  }, [adminRoute, pathname, qsString]);

  // Deduplicate pageview firing (prevents effect storms on benign rerenders)
  const lastPageRef = useRef("");

  // Initialize analytics SDKs ONCE (storefront only)
  useEffect(() => {
    if (adminRoute) return;

    let cancelled = false;

    (async () => {
      // ---- GA4 (gtag) ----
      const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;
      if (GA_ID && typeof window !== "undefined") {
        const src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
        if (!document.querySelector(`script[src="${src}"]`)) {
          const s = document.createElement("script");
          s.async = true;
          s.src = src;
          document.head.appendChild(s);
        }
        window.dataLayer = window.dataLayer || [];
        window.gtag =
          window.gtag ||
          function gtag() {
            window.dataLayer.push(arguments);
          };
        window.gtag("js", new Date());
        window.gtag("config", GA_ID, { send_page_view: false });
      }

      // ---- PostHog (lazy import so /admin doesn't even bundle/execute it eagerly) ----
      const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
      const PH_HOST =
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com";

      if (PH_KEY && typeof window !== "undefined") {
        try {
          const mod = await import("posthog-js");
          if (cancelled) return;

          const posthog = mod?.default || mod;
          if (posthog && !posthog.__loaded) {
            posthog.init(PH_KEY, { api_host: PH_HOST, autocapture: true });
          }
          window.posthog = posthog;
        } catch {
          // analytics must never break storefront
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adminRoute]);

  // Track page views (storefront only)
  useEffect(() => {
    if (adminRoute) return;

    const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;

    // Dedupe: if we already fired for this exact path+query, do nothing.
    if (pathWithQuery && lastPageRef.current === pathWithQuery) return;
    lastPageRef.current = pathWithQuery || "";

    if (GA_ID && typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "page_view", {
        page_title: document.title,
        page_location: window.location.href,
        page_path: pathWithQuery || window.location.pathname,
      });
    }

    if (typeof window !== "undefined" && window.posthog?.capture) {
      window.posthog.capture("$pageview", { $current_url: window.location.href });
    }
  }, [adminRoute, pathWithQuery]);

  /**
   * ADMIN PLANE (fully isolated):
   * - Uses /api/admin/auth basePath
   * - Forced remount (key="admin") prevents stale customer config
   */
  if (adminRoute) {
    return (
      <SessionProvider
        key="admin"
        basePath="/api/admin/auth"
        refetchOnWindowFocus={false}
        refetchWhenOffline={false}
        refetchInterval={0}
      >
        {children}
      </SessionProvider>
    );
  }

  /**
   * CUSTOMER PLANE (fully isolated):
   * - Explicit /api/auth basePath (prevents stale admin config)
   * - Forced remount (key="customer")
   */
  return (
    <SessionProvider
      key="customer"
      basePath="/api/auth"
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
      refetchInterval={0}
    >
      {children}
    </SessionProvider>
  );
}
