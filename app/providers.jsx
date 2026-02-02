//✅ CHANGED FILE: app/providers.jsx
"use client";

import { Suspense, useEffect, useRef } from "react";
import { SessionProvider } from "next-auth/react";
import { usePathname } from "next/navigation";

/**
 * COMPLETE SEPARATION GUARANTEE (HARD):
 * - Admin and Customer auth planes NEVER share a SessionProvider basePath.
 * - Admin uses /api/admin/auth
 * - Customer uses /api/auth
 *
 * Performance goals:
 * - No useSearchParams at root (avoids query-churn re-render storms).
 * - Analytics init + pageview send are scheduled during idle time.
 * - Dedupe pageviews aggressively.
 * - ✅ Never lose first pageview due to init race.
 */

function isAdminPath(pathname) {
  const p = String(pathname || "");
  return p === "/admin" || p.startsWith("/admin/");
}

function scheduleIdle(fn, timeout = 1500) {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;

  const run = () => {
    if (cancelled) return;
    try {
      fn();
    } catch {
      // analytics must never break storefront
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

  const id = window.setTimeout(run, Math.min(800, timeout));
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}

/** ✅ Ensure GA stub exists immediately so events can queue before script loads */
function ensureGtagStub() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };
}

/** ✅ PostHog queue so pageviews aren’t lost before init */
function queuePosthogPageview(props) {
  if (typeof window === "undefined") return;
  const q = (window.__TDLS_PH_Q__ = window.__TDLS_PH_Q__ || []);
  q.push(props);
}

function flushPosthogQueue() {
  if (typeof window === "undefined") return;
  const q = window.__TDLS_PH_Q__;
  if (!Array.isArray(q) || q.length === 0) return;
  if (!window.posthog?.capture) return;

  while (q.length) {
    const props = q.shift();
    try {
      window.posthog.capture("$pageview", props);
    } catch {
      // never break
    }
  }
}

function ProvidersInner({ children }) {
  const pathname = usePathname();
  const adminRoute = isAdminPath(pathname);

  const analyticsInitRef = useRef(false);
  const lastPageRef = useRef("");

  // ✅ Initialize analytics lazily (storefront only)
  useEffect(() => {
    if (adminRoute) return;
    if (analyticsInitRef.current) return;
    analyticsInitRef.current = true;

    const cancel = scheduleIdle(async () => {
      // ---- GA4 ----
      const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;

      if (GA_ID && typeof window !== "undefined") {
        ensureGtagStub();

        // Avoid re-config storms across HMR / rerenders
        if (!window.__TDLS_GA_INIT__) {
          window.__TDLS_GA_INIT__ = true;

          const src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
          if (!document.querySelector(`script[src="${src}"]`)) {
            const s = document.createElement("script");
            s.async = true;
            s.src = src;
            document.head.appendChild(s);
          }

          window.gtag("js", new Date());
          window.gtag("config", GA_ID, { send_page_view: false });
        }
      }

      // ---- PostHog (lazy import) ----
      const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
      const PH_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com";

      if (PH_KEY && typeof window !== "undefined") {
        try {
          // Avoid repeated init across HMR / rerenders
          if (window.__TDLS_PH_INIT__) {
            flushPosthogQueue();
            return;
          }

          const mod = await import("posthog-js");
          const posthog = mod?.default || mod;

          if (posthog) {
            posthog.init(PH_KEY, { api_host: PH_HOST, autocapture: true });
            window.posthog = posthog;
            window.__TDLS_PH_INIT__ = true;

            // ✅ Flush any queued pageviews that fired before init
            flushPosthogQueue();
          }
        } catch {
          // never break storefront
        }
      }
    }, 2200);

    return cancel;
  }, [adminRoute]);

  // ✅ Track page views (storefront only) — deduped + idle scheduled
  useEffect(() => {
    if (adminRoute) return;
    if (typeof window === "undefined") return;

    const pathWithQuery = `${window.location.pathname}${window.location.search || ""}`;
    if (!pathWithQuery) return;

    if (lastPageRef.current === pathWithQuery) return;
    lastPageRef.current = pathWithQuery;

    // Create GA stub immediately so this pageview can queue even before init finishes
    ensureGtagStub();

    const cancel = scheduleIdle(() => {
      const GA_ID = process.env.NEXT_PUBLIC_GA4_ID;

      if (GA_ID && window.gtag) {
        // If init hasn't run yet, this still safely queues into dataLayer.
        window.gtag("event", "page_view", {
          page_title: document.title,
          page_location: window.location.href,
          page_path: pathWithQuery,
        });
      }

      if (window.posthog?.capture) {
        window.posthog.capture("$pageview", { $current_url: window.location.href });
      } else {
        // ✅ queue for flush after PostHog init
        queuePosthogPageview({ $current_url: window.location.href });
      }
    }, 1200);

    return cancel;
  }, [adminRoute, pathname]);

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

export default function Providers({ children }) {
  return (
    <Suspense fallback={null}>
      <ProvidersInner>{children}</ProvidersInner>
    </Suspense>
  );
}