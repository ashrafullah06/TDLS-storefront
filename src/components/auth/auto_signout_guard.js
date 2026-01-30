// FILE: src/components/auth/auto_signout_guard.js
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getSession } from "next-auth/react";

/**
 * TDLS AutoSignoutGuard — CUSTOMER-ONLY idle signout
 *
 * HARD GUARANTEES:
 * - MUST NOT run on /admin routes (admin & customer fully decoupled)
 * - MUST NOT call any /api/admin/* endpoints
 * - MUST NOT clear admin cookies or admin storage namespaces
 * - MUST NOT sign out on navigation/unload events
 *
 * CUSTOMER "signed in" is determined by CUSTOMER NextAuth session (getSession()).
 *
 * Server logout:
 * - NEVER call next-auth signOut() here (decoupling safety).
 * - Always use customer-only hard logout endpoint: POST /api/auth/logout
 */

/* ===================== IDLE POLICY (HARD) ===================== */
const MIN_IDLE_MINUTES = 60;
const RAW_IDLE_MINUTES = Number(process.env.NEXT_PUBLIC_AUTO_SIGNOUT_MINUTES);
const IDLE_MINUTES =
  Number.isFinite(RAW_IDLE_MINUTES) && RAW_IDLE_MINUTES > 0
    ? Math.max(MIN_IDLE_MINUTES, Math.floor(RAW_IDLE_MINUTES))
    : MIN_IDLE_MINUTES;

const IDLE_MS = IDLE_MINUTES * 60 * 1000;

/* ===================== OPTIONAL GLOBAL KILL SWITCH ===================== */
const DISABLE_GUARD =
  String(process.env.NEXT_PUBLIC_DISABLE_AUTO_SIGNOUT || "").trim() === "1";

/* ===================== CROSS-TAB SYNC (CUSTOMER ONLY) ===================== */
const BC_NAME = "tdlc_customer_plane_signout_v3";
const MSG_SIGNOUT = "SIGNOUT_CUSTOMER";
const MSG_ACTIVITY = "ACTIVITY_CUSTOMER";

// Storage fallback for cross-tab activity (BroadcastChannel may be unavailable)
const ACTIVITY_KEY = "tdlc_customer_last_activity_v3";

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

/**
 * Manual signout should only suppress the guard briefly.
 * - New format: timestamp (ms)
 * - Legacy: "1" -> auto-migrate to timestamp so it expires
 */
function manualSignoutInProgress() {
  try {
    const v = sessionStorage.getItem("tdlc_manual_signout");
    if (!v) return false;

    if (v === "1") {
      try {
        sessionStorage.setItem("tdlc_manual_signout", String(Date.now()));
      } catch {}
      return true;
    }

    const t = Number(v);
    if (!Number.isFinite(t)) return true;

    // suppress for 60 seconds max
    return Date.now() - t < 60_000;
  } catch {
    return false;
  }
}

/**
 * CUSTOMER logout action (customer-only hard logout endpoint):
 * - Clears customer-only client artifacts.
 * - Calls POST /api/auth/logout (server clears customer cookies at /, /api, /api/auth, /customer).
 * - Broadcasts signout to other customer tabs.
 * - Hard reload to guarantee UI session does not "bounce back".
 */
async function customerHardSignOut({ broadcast = true } = {}) {
  clearCustomerClientStorage();

  // Extra safety: never run while on /admin routes
  const p = safePathname("");
  if (isAdminPath(p)) return;

  if (broadcast) {
    try {
      const bc = new BroadcastChannel(BC_NAME);
      bc.postMessage({ type: MSG_SIGNOUT, scope: "customer", at: Date.now(), v: 3 });
      bc.close();
    } catch {}
  }

  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ok: true }),
    }).catch(() => null);
  } catch {}

  try {
    window.location.reload();
  } catch {}
}

/* ===================== GLOBAL SESSION CHECK DEDUPE (CRITICAL FIX) ===================== */
/**
 * If AutoSignoutGuard is mounted more than once (or remounted frequently),
 * per-instance refs reset and can cause /api/auth/session hammering.
 *
 * This gate guarantees:
 * - one in-flight getSession() at a time (shared)
 * - one real fetch per 30s (shared)
 */
const SESSION_CHECK_EVERY_MS = 30_000;

let _globalSessionCheckAt = 0;
let _globalSessionAuthed = false;
/** @type {Promise<boolean> | null} */
let _globalSessionInFlight = null;

async function getCustomerAuthedShared(now) {
  const t = Number(now || Date.now());
  const ts = Number.isFinite(t) ? t : Date.now();

  // If a request is already running, everybody awaits the same promise.
  if (_globalSessionInFlight) return _globalSessionInFlight;

  // Throttle shared across all instances/mounts.
  if (ts - _globalSessionCheckAt < SESSION_CHECK_EVERY_MS) return _globalSessionAuthed;

  _globalSessionCheckAt = ts;

  _globalSessionInFlight = (async () => {
    try {
      const s = await getSession();
      const authed = !!s?.user;
      _globalSessionAuthed = authed;
      return authed;
    } catch {
      // Preserve last-known shared state on transient failures.
      return _globalSessionAuthed;
    } finally {
      _globalSessionInFlight = null;
    }
  })();

  return _globalSessionInFlight;
}

export default function AutoSignoutGuard() {
  const nextPathname = usePathname();

  const lastActivityRef = useRef(Date.now());
  const pendingSignoutRef = useRef(0);

  const intervalRef = useRef(null);
  const bcRef = useRef(null);

  // last-known customer auth state
  const sessionKnownAuthedRef = useRef(false);

  // Ensure we only run signout once per mount
  const signingOutRef = useRef(false);

  // Activity throttles (keep cheap but reliable)
  const lastHiFreqMarkRef = useRef(0);
  const lastActivitySyncRef = useRef(0);
  const lastSessionCheckRef = useRef(0);

  const stopIdleLoop = () => {
    if (intervalRef.current) {
      try {
        window.clearInterval(intervalRef.current);
      } catch {}
      intervalRef.current = null;
    }
  };

  const triggerIdleSignoutOnce = () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    stopIdleLoop();
    void customerHardSignOut({ broadcast: true });
  };

  const applyActivity = (at) => {
    const t = Number(at || Date.now());
    if (!Number.isFinite(t)) return;
    if (t > lastActivityRef.current) lastActivityRef.current = t;
    pendingSignoutRef.current = 0;
  };

  const syncActivityCrossTab = (now) => {
    const t = Number(now || Date.now());
    const SYNC_EVERY_MS = 3_000;

    if (t - lastActivitySyncRef.current < SYNC_EVERY_MS) return;
    lastActivitySyncRef.current = t;

    try {
      localStorage.setItem(ACTIVITY_KEY, String(t));
    } catch {}

    try {
      bcRef.current?.postMessage?.({ type: MSG_ACTIVITY, scope: "customer", at: t, v: 3 });
    } catch {}
  };

  const ensureCustomerSession = async (now = Date.now()) => {
    const t = Number(now || Date.now());
    const ts = Number.isFinite(t) ? t : Date.now();

    // Keep the existing per-instance throttle (cheap fast-path),
    // but the real protection is the shared global gate.
    const CHECK_EVERY_MS = 30_000;
    if (ts - lastSessionCheckRef.current < CHECK_EVERY_MS) {
      return sessionKnownAuthedRef.current;
    }
    lastSessionCheckRef.current = ts;

    // Shared dedupe prevents hammering across mounts/instances/event storms.
    const authed = await getCustomerAuthedShared(ts);

    // If we just became authed, reset baseline activity to avoid instant idle signout.
    if (authed && !sessionKnownAuthedRef.current) {
      lastActivityRef.current = Date.now();
      pendingSignoutRef.current = 0;
    }

    sessionKnownAuthedRef.current = authed;
    return authed;
  };

  const markActivity = async () => {
    const now = Date.now();

    // Keep auth state warm (hydration-safe)
    if (!sessionKnownAuthedRef.current) {
      await ensureCustomerSession(now);
    }

    // HARD RULE: if already idle for >= 1 hour, do NOT reset timer—sign out.
    if (
      sessionKnownAuthedRef.current &&
      !inAuthFlow() &&
      !manualSignoutInProgress() &&
      now - lastActivityRef.current >= IDLE_MS
    ) {
      triggerIdleSignoutOnce();
      return;
    }

    applyActivity(now);
    if (sessionKnownAuthedRef.current) syncActivityCrossTab(now);
  };

  const markActivityThrottled = async () => {
    const now = Date.now();

    if (!sessionKnownAuthedRef.current) {
      await ensureCustomerSession(now);
    }

    // HARD RULE: if already idle for >= 1 hour, do NOT reset timer—sign out.
    if (
      sessionKnownAuthedRef.current &&
      !inAuthFlow() &&
      !manualSignoutInProgress() &&
      now - lastActivityRef.current >= IDLE_MS
    ) {
      triggerIdleSignoutOnce();
      return;
    }

    if (now - lastHiFreqMarkRef.current < 1000) return;
    lastHiFreqMarkRef.current = now;

    applyActivity(now);
    if (sessionKnownAuthedRef.current) syncActivityCrossTab(now);
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

    // Initialize from cross-tab activity if present (prevents false idle if another tab was active)
    try {
      const t = Number(localStorage.getItem(ACTIVITY_KEY));
      if (Number.isFinite(t) && Date.now() - t < IDLE_MS) {
        lastActivityRef.current = Math.max(lastActivityRef.current, t);
      }
    } catch {}

    // Cross-tab signout + activity sync (customer only)
    try {
      bcRef.current = new BroadcastChannel(BC_NAME);
      bcRef.current.onmessage = (e) => {
        const type = e?.data?.type;
        const scope = String(e?.data?.scope || "").toLowerCase();
        const v = Number(e?.data?.v || 0);
        const at = Number(e?.data?.at || 0);

        if (v !== 3) return;
        if (scope !== "customer") return;

        if (type === MSG_SIGNOUT) {
          stopIdleLoop();
          if (!signingOutRef.current) signingOutRef.current = true;
          void customerHardSignOut({ broadcast: false });
          return;
        }

        if (type === MSG_ACTIVITY) {
          applyActivity(at);
        }
      };
    } catch {
      bcRef.current = null;
    }

    const onStorage = (e) => {
      try {
        if (!e || e.key !== ACTIVITY_KEY) return;
        const t = Number(e.newValue);
        if (!Number.isFinite(t)) return;
        applyActivity(t);
      } catch {}
    };

    const onVisibilityChange = async () => {
      if (!mounted) return;
      if (inAuthFlow() || manualSignoutInProgress()) return;

      // When tab becomes visible, re-check session (hydration-safe)
      if (document.visibilityState !== "hidden") {
        await ensureCustomerSession(Date.now());
      }

      if (!sessionKnownAuthedRef.current) return;

      const now = Date.now();
      const idleFor = now - lastActivityRef.current;

      // HARD RULE: returning to tab does NOT “save” an already-idle session
      if (idleFor >= IDLE_MS) {
        triggerIdleSignoutOnce();
        return;
      }

      void markActivity();
    };

    stopIdleLoop();

    // Run loop regardless; it will activate enforcement once session becomes authed
    intervalRef.current = window.setInterval(async () => {
      const p = safePathname(nextPathname);
      if (!p || isAdminPath(p)) {
        stopIdleLoop();
        return;
      }

      if (inAuthFlow() || manualSignoutInProgress()) return;
      if (signingOutRef.current) return;

      const now = Date.now();

      // Keep checking session until it becomes authenticated (fixes “guard died at mount”)
      await ensureCustomerSession(now);
      if (!sessionKnownAuthedRef.current) return;

      const idleFor = now - lastActivityRef.current;

      // Only sign out after 2 consecutive ticks past threshold.
      if (idleFor >= IDLE_MS) {
        if (!pendingSignoutRef.current) {
          pendingSignoutRef.current = now;
          return;
        }
        if (now - pendingSignoutRef.current < 5_000) return;

        triggerIdleSignoutOnce();
        return;
      }

      pendingSignoutRef.current = 0;
    }, 15_000);

    // Activity listeners (customer side only)
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

    // Crucial: scroll capture catches scroll in nested containers (scroll doesn't bubble)
    document.addEventListener("scroll", markActivityThrottled, {
      passive: true,
      capture: true,
    });

    document.addEventListener("visibilitychange", onVisibilityChange, { capture: true });
    window.addEventListener("storage", onStorage);

    // Prime session detection shortly after mount (hydration-safe)
    (async () => {
      await ensureCustomerSession(Date.now());
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