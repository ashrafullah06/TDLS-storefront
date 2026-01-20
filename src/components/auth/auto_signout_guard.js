// FILE: src/components/auth/auto_signout_guard.js
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getSession, signOut } from "next-auth/react";

/**
 * TDLC AutoSignoutGuard — CUSTOMER-ONLY idle signout
 *
 * HARD GUARANTEES:
 * - MUST NOT run on /admin routes (admin & customer fully decoupled)
 * - MUST NOT call any /api/admin/* endpoints
 * - MUST NOT clear admin cookies or admin storage namespaces
 * - MUST NOT sign out on navigation/unload events
 *
 * IMPORTANT CHANGE:
 * - Customer "signed in" is determined by CUSTOMER NextAuth session (getSession()).
 *   (No more localStorage heuristics that can fire incorrectly.)
 *
 * Server logout:
 * - We use NextAuth signOut() for customer plane only (it hits /api/auth/*),
 *   and we NEVER call server logout while on /admin routes.
 */

/* ===================== IDLE POLICY (HARD) ===================== */
/**
 * Requirement:
 * - Never sign out while the customer is active.
 * - Only sign out after 1 hour of inactivity (silent / no interaction).
 *
 * We clamp any env misconfig to >= 60 minutes.
 */
const MIN_IDLE_MINUTES = 60;
const RAW_IDLE_MINUTES = Number(process.env.NEXT_PUBLIC_AUTO_SIGNOUT_MINUTES);
const IDLE_MINUTES = Number.isFinite(RAW_IDLE_MINUTES) && RAW_IDLE_MINUTES > 0
  ? Math.max(MIN_IDLE_MINUTES, Math.floor(RAW_IDLE_MINUTES))
  : MIN_IDLE_MINUTES;

const IDLE_MS = IDLE_MINUTES * 60 * 1000;

/* ===================== OPTIONAL GLOBAL KILL SWITCH ===================== */
const DISABLE_GUARD =
  String(process.env.NEXT_PUBLIC_DISABLE_AUTO_SIGNOUT || "").trim() === "1";

/* ===================== CROSS-TAB SYNC (CUSTOMER ONLY) ===================== */
const BC_NAME = "tdlc_customer_plane_signout_v2";
const MSG_SIGNOUT = "SIGNOUT_CUSTOMER";
const MSG_ACTIVITY = "ACTIVITY_CUSTOMER";

// Storage fallback for cross-tab activity (BroadcastChannel may be unavailable)
const ACTIVITY_KEY = "tdlc_customer_last_activity_v2";

/* ===================== ROUTE SAFETY ===================== */
function isAdminPath(p) {
  const s = String(p || "").toLowerCase();
  return s === "/admin" || s.startsWith("/admin/") || s.includes("/admin/");
}

function safePathname(nextPathname) {
  const p1 = String(nextPathname || "").trim();
  if (p1) return p1;
  try {
    return String(window.location?.pathname || "").trim();
  } catch {
    return "";
  }
}

function clearCustomerClientStorage() {
  // Customer-only cleanup (do NOT touch admin storage namespaces)
  try {
    localStorage.removeItem("tdlc_token");
    localStorage.removeItem("tdlc_refresh");
    localStorage.removeItem("strapi_jwt");
    localStorage.removeItem("me");

    // Customer auth flow markers
    sessionStorage.removeItem("tdlc_auth_flow");
    sessionStorage.removeItem("tdlc_manual_signout");
  } catch {}
}

function inAuthFlow() {
  try {
    return sessionStorage.getItem("tdlc_auth_flow") === "1";
  } catch {
    return false;
  }
}

function manualSignoutInProgress() {
  try {
    return sessionStorage.getItem("tdlc_manual_signout") === "1";
  } catch {
    return false;
  }
}

/**
 * CUSTOMER logout action:
 * - Clears customer-only client artifacts.
 * - Uses NextAuth customer signOut() (never admin).
 */
async function customerSignOut({ broadcast = true } = {}) {
  clearCustomerClientStorage();

  // Extra safety: never run while on /admin routes
  const p = safePathname("");
  if (isAdminPath(p)) return;

  if (broadcast) {
    try {
      const bc = new BroadcastChannel(BC_NAME);
      bc.postMessage({ type: MSG_SIGNOUT, scope: "customer", at: Date.now(), v: 2 });
      bc.close();
    } catch {}
  }

  try {
    // Avoid redirect loops: we handle redirect on the page level
    await signOut({ redirect: false });
  } catch {
    // no throw
  }
}

export default function AutoSignoutGuard() {
  const nextPathname = usePathname();

  const lastActivityRef = useRef(Date.now());

  // Two-tick confirmation (prevents “logout on click” race at the threshold edge)
  const pendingSignoutRef = useRef(0);

  const intervalRef = useRef(null);
  const bcRef = useRef(null);
  const sessionKnownAuthedRef = useRef(false);

  // Activity throttles (keep cheap but reliable)
  const lastHiFreqMarkRef = useRef(0);
  const lastActivitySyncRef = useRef(0);

  const stopIdleLoop = () => {
    if (intervalRef.current) {
      try {
        window.clearInterval(intervalRef.current);
      } catch {}
      intervalRef.current = null;
    }
  };

  const applyActivity = (at) => {
    const t = Number(at || Date.now());
    if (!Number.isFinite(t)) return;
    if (t > lastActivityRef.current) lastActivityRef.current = t;
    pendingSignoutRef.current = 0;
  };

  const syncActivityCrossTab = (now) => {
    // Broadcast + storage sync at a controlled cadence
    const t = Number(now || Date.now());
    const SYNC_EVERY_MS = 3_000;

    if (t - lastActivitySyncRef.current < SYNC_EVERY_MS) return;
    lastActivitySyncRef.current = t;

    try {
      // Storage sync (fires “storage” in other tabs)
      localStorage.setItem(ACTIVITY_KEY, String(t));
    } catch {}

    try {
      // BroadcastChannel sync (real-time where supported)
      bcRef.current?.postMessage?.({ type: MSG_ACTIVITY, scope: "customer", at: t, v: 2 });
    } catch {}
  };

  const markActivity = () => {
    const now = Date.now();
    applyActivity(now);
    syncActivityCrossTab(now);
  };

  const markActivityThrottled = () => {
    // For scroll/move/wheel/touchmove: mark activity max 1x per 1000ms
    const now = Date.now();
    if (now - lastHiFreqMarkRef.current < 1000) return;
    lastHiFreqMarkRef.current = now;
    applyActivity(now);
    syncActivityCrossTab(now);
  };

  useEffect(() => {
    if (DISABLE_GUARD) {
      stopIdleLoop();
      return;
    }

    const pathname = safePathname(nextPathname);

    // HARD STOP: never run on admin routes
    if (!pathname || isAdminPath(pathname)) {
      stopIdleLoop();
      return;
    }

    let mounted = true;

    // Determine customer auth strictly via CUSTOMER NextAuth session
    const ensureCustomerSession = async () => {
      try {
        const s = await getSession();
        if (!mounted) return false;

        const authed = !!s?.user;
        sessionKnownAuthedRef.current = authed;
        return authed;
      } catch {
        if (!mounted) return false;
        sessionKnownAuthedRef.current = false;
        return false;
      }
    };

    // Cross-tab signout + activity sync (customer only)
    try {
      bcRef.current = new BroadcastChannel(BC_NAME);
      bcRef.current.onmessage = (e) => {
        const type = e?.data?.type;
        const scope = String(e?.data?.scope || "").toLowerCase();
        const v = Number(e?.data?.v || 0);
        const at = Number(e?.data?.at || 0);

        if (v !== 2) return;
        if (scope !== "customer") return;

        if (type === MSG_SIGNOUT) {
          stopIdleLoop();
          void customerSignOut({ broadcast: false });
          return;
        }

        if (type === MSG_ACTIVITY) {
          // If the customer is active in another tab, we must not sign out here.
          applyActivity(at);
        }
      };
    } catch {
      bcRef.current = null;
    }

    const onStorage = (e) => {
      // Activity sync fallback for browsers without BroadcastChannel
      try {
        if (!e || e.key !== ACTIVITY_KEY) return;
        const t = Number(e.newValue);
        if (!Number.isFinite(t)) return;
        applyActivity(t);
      } catch {}
    };

    const onVisibilityChange = () => {
      // Visibility changes are NOT inactivity; they just should not reset timers incorrectly.
      // When returning to the tab, consider it activity so users are not “logout on return”.
      if (inAuthFlow() || manualSignoutInProgress()) return;
      if (!sessionKnownAuthedRef.current) return;

      if (document.visibilityState !== "hidden") {
        markActivity();
      }
    };

    // Start loop only if customer session exists
    (async () => {
      const authed = await ensureCustomerSession();
      if (!mounted) return;

      if (!authed) {
        stopIdleLoop();
        return;
      }

      stopIdleLoop();

      intervalRef.current = window.setInterval(async () => {
        // Re-check path each tick to prevent any admin leakage during transitions
        const p = safePathname(nextPathname);
        if (!p || isAdminPath(p)) {
          stopIdleLoop();
          return;
        }

        if (inAuthFlow() || manualSignoutInProgress()) return;

        const now = Date.now();
        const idleFor = now - lastActivityRef.current;

        if (!sessionKnownAuthedRef.current) {
          stopIdleLoop();
          return;
        }

        // Only sign out based on REAL inactivity time (foreground or background),
        // and only after 2 consecutive ticks past threshold.
        if (idleFor >= IDLE_MS) {
          if (!pendingSignoutRef.current) {
            pendingSignoutRef.current = now;
            return;
          }
          if (now - pendingSignoutRef.current < 5_000) return;

          stopIdleLoop();
          void customerSignOut({ broadcast: true });
          return;
        }

        // Reset pending if user is active again
        pendingSignoutRef.current = 0;

        // Nearing threshold: confirm session still exists (guards against false positives)
        if (idleFor >= Math.max(60_000, IDLE_MS - 60_000)) {
          const stillAuthed = await ensureCustomerSession();
          if (!stillAuthed) stopIdleLoop();
        }
      }, 15_000);

      /* ---------------- Activity listeners (customer side only) ----------------
         Key fix: capture scroll from ANY scroll container (scroll does not bubble),
         so active users inside panels/lists never get treated as “idle”.
      */
      window.addEventListener("mousedown", markActivity, { passive: true });
      window.addEventListener("keydown", markActivity, { passive: true });
      window.addEventListener("touchstart", markActivity, { passive: true });
      window.addEventListener("pointerdown", markActivity, { passive: true });
      window.addEventListener("focus", markActivity, { passive: true });

      // High-frequency signals (throttled)
      window.addEventListener("mousemove", markActivityThrottled, { passive: true });
      window.addEventListener("wheel", markActivityThrottled, { passive: true });
      window.addEventListener("touchmove", markActivityThrottled, { passive: true });
      window.addEventListener("pointermove", markActivityThrottled, { passive: true });

      // Crucial: scroll capture on document catches scroll in nested containers
      document.addEventListener("scroll", markActivityThrottled, {
        passive: true,
        capture: true,
      });

      document.addEventListener("visibilitychange", onVisibilityChange, { capture: true });
      window.addEventListener("storage", onStorage);
    })();

    return () => {
      mounted = false;

      stopIdleLoop();

      window.removeEventListener("mousedown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("touchstart", markActivity);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("focus", markActivity);

      window.removeEventListener("mousemove", markActivityThrottled);
      window.removeEventListener("wheel", markActivityThrottled);
      window.removeEventListener("touchmove", markActivityThrottled);
      window.removeEventListener("pointermove", markActivityThrottled);

      // Must match capture=true
      document.removeEventListener("scroll", markActivityThrottled, true);
      document.removeEventListener("visibilitychange", onVisibilityChange, true);

      window.removeEventListener("storage", onStorage);

      try {
        bcRef.current?.close?.();
      } catch {}
      bcRef.current = null;
    };
  }, [nextPathname]);

  return null;
}
