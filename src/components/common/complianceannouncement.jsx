import React from "react";
import { fetchComplianceBanner } from "../../utils/api-utils";

/**
 * TDLS Compliance Announcement (customer-friendly, non-intrusive)
 * - Shows at most once per tab/session per notice signature
 * - Auto-closes after 40 seconds if user does nothing
 * - Pauses auto-close on interaction (hover/focus/touch)
 * - Click dismiss: hides for 30 days (signature-aware)
 * - Content change: shows again immediately
 */

const STORAGE_KEY = "tdls_compliance_banner_state_v3";
const LEGACY_DISMISSED_KEY = "complianceBannerDismissed";

const AUTO_HIDE_MS = 40_000; // 40 seconds
const NORMAL_DISMISS_DAYS = 30; // click dismiss => hide for 30 days
const REAPPEAR_COOLDOWN_MS = 24 * 60 * 60 * 1000; // if auto-hidden (no click), do not show again for 24h

function msDays(days) {
  return days * 24 * 60 * 60 * 1000;
}

function safeParseJSON(v) {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function bannerSignature(b) {
  if (!b) return "";
  const links = Array.isArray(b.policyLinks)
    ? b.policyLinks.map((l) => `${String(l?.label || "")}::${String(l?.href || "")}`).join("||")
    : "";
  return [
    String(b.message || ""),
    String(b.lastUpdated || ""),
    b.mustRead ? "1" : "0",
    links,
  ].join("##");
}

function readState() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? safeParseJSON(raw) : null;
}

function writeState(next) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function getSessionKey(sig) {
  return `tdls_compliance_banner_shown_${sig}`;
}

export default function ComplianceAnnouncement() {
  const [banner, setBanner] = React.useState(null);
  const [visible, setVisible] = React.useState(false);

  const sigRef = React.useRef("");
  const timerRef = React.useRef(null);
  const remainingRef = React.useRef(AUTO_HIDE_MS);
  const endAtRef = React.useRef(0);
  const pausedRef = React.useRef(false);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markAutoHidden = React.useCallback(() => {
    const sig = sigRef.current;
    const now = Date.now();

    const raw = readState();
    const state =
      raw && typeof raw === "object"
        ? raw
        : { dismissedUntil: 0, dismissedSig: "", lastSeenAt: 0, lastSeenSig: "" };

    writeState({
      ...state,
      lastSeenAt: now,
      lastSeenSig: sig,
    });
  }, []);

  const stopAndHide = React.useCallback(
    (reason) => {
      clearTimer();
      setVisible(false);

      // If user didn't click dismiss, treat as "auto-hidden" and apply cooldown
      if (reason === "auto") {
        markAutoHidden();
      }
    },
    [clearTimer, markAutoHidden]
  );

  const startAutoClose = React.useCallback(() => {
    clearTimer();

    // Only start if visible and not paused
    if (!visible || pausedRef.current) return;

    remainingRef.current = Math.max(0, remainingRef.current || AUTO_HIDE_MS);
    endAtRef.current = Date.now() + remainingRef.current;

    timerRef.current = window.setTimeout(() => {
      stopAndHide("auto");
    }, remainingRef.current);
  }, [clearTimer, stopAndHide, visible]);

  const pauseAutoClose = React.useCallback(() => {
    if (!visible) return;
    if (pausedRef.current) return;

    pausedRef.current = true;

    // capture remaining time
    const now = Date.now();
    const endAt = endAtRef.current || (now + AUTO_HIDE_MS);
    const remaining = Math.max(0, endAt - now);
    remainingRef.current = remaining;

    clearTimer();
  }, [clearTimer, visible]);

  const resumeAutoClose = React.useCallback(() => {
    if (!visible) return;
    if (!pausedRef.current) return;

    pausedRef.current = false;

    // if already expired, close immediately
    if ((remainingRef.current || 0) <= 0) {
      stopAndHide("auto");
      return;
    }

    startAutoClose();
  }, [startAutoClose, stopAndHide, visible]);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      let data = null;

      try {
        data = await fetchComplianceBanner();
      } catch {
        data = {
          message: "We use cookies and analytics to enhance your experience.",
          lastUpdated: null,
          mustRead: false,
          policyLinks: [
            { label: "Privacy Policy", href: "/privacy-policy" },
            { label: "Refund Policy", href: "/refund-policy" },
          ],
        };
      }

      if (cancelled) return;

      setBanner(data);

      const now = Date.now();
      const sig = bannerSignature(data);
      sigRef.current = sig;

      // Session guard (do not show repeatedly during browsing)
      const sessionKey = getSessionKey(sig);
      const alreadyShownThisSession =
        typeof window !== "undefined" && window.sessionStorage.getItem(sessionKey) === "1";

      // Migrate legacy boolean -> time-bound dismissal once
      const legacy = typeof window !== "undefined" ? window.localStorage.getItem(LEGACY_DISMISSED_KEY) : null;
      const existing = readState();

      let state = existing && typeof existing === "object" ? existing : null;

      if (!state && legacy === "true") {
        state = {
          dismissedUntil: now + msDays(NORMAL_DISMISS_DAYS),
          dismissedSig: sig,
          lastSeenAt: now,
          lastSeenSig: sig,
        };
        window.localStorage.removeItem(LEGACY_DISMISSED_KEY);
        writeState(state);
      }

      if (!state) {
        state = { dismissedUntil: 0, dismissedSig: "", lastSeenAt: 0, lastSeenSig: "" };
      }

      const dismissedUntil = Number(state.dismissedUntil || 0);
      const dismissedSig = String(state.dismissedSig || "");
      const lastSeenAt = Number(state.lastSeenAt || 0);
      const lastSeenSig = String(state.lastSeenSig || "");

      const contentChanged =
        (dismissedSig && dismissedSig !== sig) ||
        (lastSeenSig && lastSeenSig !== sig);

      const dismissedActive = dismissedSig === sig && dismissedUntil > now;

      // If it auto-hidden recently, do not show again for cooldown (unless content changed)
      const cooldownActive =
        !contentChanged &&
        lastSeenSig === sig &&
        lastSeenAt > 0 &&
        now - lastSeenAt < REAPPEAR_COOLDOWN_MS;

      const shouldShow =
        !dismissedActive &&
        !cooldownActive &&
        !alreadyShownThisSession;

      if (shouldShow) {
        // mark as shown in this tab/session immediately to prevent repeated flashes
        try {
          window.sessionStorage.setItem(sessionKey, "1");
        } catch {
          // ignore
        }

        // Reset timer values on show
        remainingRef.current = AUTO_HIDE_MS;
        endAtRef.current = 0;
        pausedRef.current = false;

        setVisible(true);
      } else {
        setVisible(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the 40s auto-close only after it becomes visible
  React.useEffect(() => {
    if (!visible) {
      clearTimer();
      return;
    }
    startAutoClose();
    return () => clearTimer();
  }, [visible, startAutoClose, clearTimer]);

  const dismissByClick = React.useCallback(() => {
    if (!banner) return;

    const now = Date.now();
    const sig = sigRef.current || bannerSignature(banner);

    const raw = readState();
    const state =
      raw && typeof raw === "object"
        ? raw
        : { dismissedUntil: 0, dismissedSig: "", lastSeenAt: 0, lastSeenSig: "" };

    writeState({
      ...state,
      dismissedUntil: now + msDays(NORMAL_DISMISS_DAYS),
      dismissedSig: sig,
      lastSeenAt: now,
      lastSeenSig: sig,
    });

    stopAndHide("click");
  }, [banner, stopAndHide]);

  // Allow closing via Escape (desktop-friendly)
  React.useEffect(() => {
    if (!visible) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") dismissByClick();
    };

    window.addEventListener("keydown", onKeyDown, { passive: true });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, dismissByClick]);

  if (!banner || !visible) return null;

  const lastUpdated =
    banner.lastUpdated ? new Date(banner.lastUpdated).toLocaleString("en-BD") : null;

  const isMustRead = !!banner.mustRead;

  return (
    <div
      className="
        w-full fixed top-0 left-0 z-[9999]
        bg-[#FFFBEA] border-b border-yellow-300 text-[#694502]
        shadow-md
      "
      style={{
        paddingTop: "env(safe-area-inset-top)",
      }}
      role="region"
      aria-label="Compliance notice"
      aria-live="polite"
      data-tdls-banner="compliance"
      onMouseEnter={pauseAutoClose}
      onMouseLeave={resumeAutoClose}
      onFocusCapture={pauseAutoClose}
      onBlurCapture={resumeAutoClose}
      onTouchStart={pauseAutoClose}
      onTouchEnd={resumeAutoClose}
    >
      <div
        className="
          w-full
          px-3 sm:px-6
          py-2
          flex items-start sm:items-center
          gap-2 sm:gap-4
        "
        style={{
          minHeight: 44,
          fontWeight: 500,
          letterSpacing: ".01em",
        }}
      >
        <div className="min-w-0 flex-1 text-center sm:text-left leading-snug">
          <span className="font-bold">Compliance Notice:</span>{" "}
          <span className="break-words text-[12px] sm:text-[13px] md:text-[14px]">
            {banner.message}
          </span>

          {lastUpdated && (
            <span className="ml-2 block sm:inline text-[11px] text-[#a88900]">
              Last updated: {lastUpdated}
            </span>
          )}

          {Array.isArray(banner.policyLinks) && banner.policyLinks.length > 0 && (
            <span className="ml-2 block sm:inline">
              {banner.policyLinks.map((link, idx) => (
                <a
                  key={idx}
                  href={link.href}
                  className="
                    underline text-[#4860b5]
                    mx-1 whitespace-nowrap
                    hover:text-[#294389]
                    transition
                    text-[12px] sm:text-[13px]
                  "
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </span>
          )}
        </div>

        <button
          onClick={dismissByClick}
          className="
            shrink-0
            bg-[#F9E1A8]
            rounded
            px-3 py-1
            text-[11px] sm:text-xs
            font-medium
            hover:bg-yellow-300 hover:text-[#322100]
            transition
            shadow-sm
          "
          aria-label={isMustRead ? "Acknowledge compliance notice" : "Dismiss compliance announcement"}
          title="Dismiss (will not show again for a long time)"
        >
          {isMustRead ? "Got it" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
