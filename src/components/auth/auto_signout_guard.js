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

const IDLE_MINUTES = Number(process.env.NEXT_PUBLIC_AUTO_SIGNOUT_MINUTES || "45");
const IDLE_MS = Math.max(1, IDLE_MINUTES) * 60 * 1000;

// Optional hard kill switch (no UI impact)
const DISABLE_GUARD =
  String(process.env.NEXT_PUBLIC_DISABLE_AUTO_SIGNOUT || "").trim() === "1";

// Customer-only broadcast channel (must never overlap admin plane)
const BC_NAME = "tdlc_customer_plane_signout_v2";
const MSG_SIGNOUT = "SIGNOUT_CUSTOMER";

// Small safety: never execute if route is (or becomes) admin
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

  // NextAuth customer plane logout (middleware blocks admin from using /api/auth)
  try {
    // Avoid redirect loops: we handle redirect on the page level
    await signOut({ redirect: false });
  } catch {
    // Fallback: no throw
  }
}

export default function AutoSignoutGuard() {
  const nextPathname = usePathname();

  const lastActivityRef = useRef(Date.now());
  // Prevent "race" signouts that appear to happen *on click* when idle threshold is crossed.
  // We require 2 consecutive ticks past the threshold before signing out.
  const pendingSignoutRef = useRef(0);
  const hiddenSinceRef = useRef(0);
  const intervalRef = useRef(null);
  const bcRef = useRef(null);
  const sessionKnownAuthedRef = useRef(false);

  const stopIdleLoop = () => {
    if (intervalRef.current) {
      try {
        window.clearInterval(intervalRef.current);
      } catch {}
      intervalRef.current = null;
    }
  };

  const markActivity = () => {
    lastActivityRef.current = Date.now();
    pendingSignoutRef.current = 0;
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
    const ac = new AbortController();

    // Determine customer auth strictly via CUSTOMER NextAuth session
    const ensureCustomerSession = async () => {
      try {
        const s = await getSession();
        if (!mounted) return false;
        // If session exists, user is signed in as customer plane
        const authed = !!s?.user;
        sessionKnownAuthedRef.current = authed;
        return authed;
      } catch {
        if (!mounted) return false;
        sessionKnownAuthedRef.current = false;
        return false;
      }
    };

    // Cross-tab signout sync (customer only)
    try {
      bcRef.current = new BroadcastChannel(BC_NAME);
      bcRef.current.onmessage = (e) => {
        const msg = e?.data?.type;
        const scope = String(e?.data?.scope || "").toLowerCase();
        const v = Number(e?.data?.v || 0);

        // Accept only customer-scoped events
        if (v !== 2) return;
        if (scope !== "customer") return;

        if (msg === MSG_SIGNOUT) {
          stopIdleLoop();
          void customerSignOut({ broadcast: false });
        }
      };
    } catch {
      bcRef.current = null;
    }

    const onVisibilityChange = () => {
      if (inAuthFlow() || manualSignoutInProgress()) return;
      if (!sessionKnownAuthedRef.current) return;

      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
      } else {
        hiddenSinceRef.current = 0;
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

        // Hidden too long -> logout
        if (document.visibilityState === "hidden") {
          const hs = hiddenSinceRef.current;
          if (hs && now - hs >= IDLE_MS) {
            // two-tick confirmation (prevents "click caused logout" race)
            if (!pendingSignoutRef.current) {
              pendingSignoutRef.current = now;
              return;
            }
            if (now - pendingSignoutRef.current < 5_000) return;

            stopIdleLoop();
            void customerSignOut({ broadcast: true });
          } else {
            pendingSignoutRef.current = 0;
          }
          return;
        }

        // Foreground idle too long -> logout (two-tick confirmation)
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

      // Activity listeners (customer side only)
      window.addEventListener("mousemove", markActivity, { passive: true });
      window.addEventListener("mousedown", markActivity, { passive: true });
      window.addEventListener("keydown", markActivity, { passive: true });
      window.addEventListener("scroll", markActivity, { passive: true });
      window.addEventListener("touchstart", markActivity, { passive: true });
      window.addEventListener("pointerdown", markActivity, { passive: true });
      window.addEventListener("focus", markActivity, { passive: true });

      document.addEventListener("visibilitychange", onVisibilityChange, { capture: true });
    })();

    return () => {
      mounted = false;
      ac.abort();

      stopIdleLoop();

      window.removeEventListener("mousemove", markActivity);
      window.removeEventListener("mousedown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("scroll", markActivity);
      window.removeEventListener("touchstart", markActivity);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("focus", markActivity);

      document.removeEventListener("visibilitychange", onVisibilityChange, { capture: true });

      try {
        bcRef.current?.close?.();
      } catch {}
      bcRef.current = null;
    };
  }, [nextPathname]);

  return null;
}
