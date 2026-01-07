// FILE: src/components/cart/proceed-to-checkout-button.jsx
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Proceed-to-Checkout CTA (Guest rules aligned):
 * - If customer is logged in -> go to checkout normally
 * - If NOT logged in -> show a 3-option modal ONLY (no address form here):
 *     1) Guest Mode -> redirect to /checkout?mode=guest (guest address form must appear on checkout page)
 *     2) Account Login -> /login?redirect=/checkout
 *     3) Create Account -> /register?redirect=/checkout
 *
 * IMPORTANT guest rules:
 * - Do NOT show guest address form in the sliding panel / mini cart.
 * - Do NOT persist guest checkout via cookies here (no cross-tab / post-close remembering).
 * - Only set lightweight sessionStorage flags for the checkout page.
 *
 * Props:
 *   className?: string
 *   style?: React.CSSProperties
 *   disabled?: boolean
 *   reason?: string
 *   children?: React.ReactNode
 *   href?: string (default "/checkout")
 *   loginHref?: string (default "/login?redirect=/checkout")
 *   registerHref?: string (default "/register?redirect=/checkout")
 *   onBeforeNavigate?: () => void
 */
export default function ProceedToCheckoutButton({
  className = "",
  style,
  disabled = false,
  reason = "",
  children = "Proceed to Checkout",
  href = "/checkout",
  loginHref = "/login?redirect=%2Fcheckout",
  registerHref = "/register?redirect=%2Fcheckout",
  onBeforeNavigate,
}) {
  const router = useRouter();

  const [modalOpen, setModalOpen] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [sessionKnown, setSessionKnown] = React.useState(false);
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const [sessionError, setSessionError] = React.useState("");

  const firstButtonRef = React.useRef(null);

  // If session probe fails, do not block checkout.
  const sessionProbeFailedRef = React.useRef(false);

  const withQueryParam = React.useCallback((url, key, value) => {
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.set(key, value);
      return `${u.pathname}${u.search}${u.hash}`;
    } catch {
      // best-effort fallback
      const hasQ = String(url).includes("?");
      const sep = hasQ ? "&" : "?";
      return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
  }, []);

  // --------------------------
  // Session detection (customer)
  // --------------------------
  const detectCustomerSession = React.useCallback(async () => {
    // Cache: avoid repeated fetches
    if (sessionKnown) return isLoggedIn;

    setChecking(true);
    setSessionError("");
    sessionProbeFailedRef.current = false;

    try {
      const res = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        // Fail-open: do not block checkout if session endpoint has issues
        sessionProbeFailedRef.current = true;
        setSessionKnown(true);
        setIsLoggedIn(false);
        return false;
      }

      const data = await res.json().catch(() => null);
      const logged =
        !!data &&
        !!data.user &&
        (Boolean(data.user.id) ||
          Boolean(data.user.email) ||
          Boolean(data.user.phone) ||
          Boolean(data.user.name));

      setSessionKnown(true);
      setIsLoggedIn(logged);
      return logged;
    } catch {
      // Fail-open: do not block checkout if probe fails
      sessionProbeFailedRef.current = true;
      setSessionKnown(true);
      setIsLoggedIn(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, [sessionKnown, isLoggedIn]);

  // Pre-warm session in background
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await detectCustomerSession();
        if (!alive) return;
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [detectCustomerSession]);

  // Focus management + ESC close
  React.useEffect(() => {
    if (!modalOpen) return;

    const t = setTimeout(() => {
      try {
        firstButtonRef.current?.focus?.();
      } catch {}
    }, 0);

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modalOpen]);

  const safeNavigate = React.useCallback(
    (to) => {
      try {
        onBeforeNavigate?.();
      } catch {}
      try {
        queueMicrotask(() => router.push(to));
      } catch {
        router.push(to);
      }
    },
    [router, onBeforeNavigate]
  );

  const closeModal = React.useCallback(() => {
    setModalOpen(false);
    setSessionError("");
  }, []);

  const openGateModal = React.useCallback(() => {
    setSessionError("");
    setModalOpen(true);
  }, []);

  const clearGuestCheckoutSession = React.useCallback(() => {
    // Guest mode must not “remember” across tab close; sessionStorage is tab-scoped.
    try {
      sessionStorage.removeItem("TDLC_GUEST_CHECKOUT_V1");
    } catch {}
    try {
      sessionStorage.removeItem("TDLC_CHECKOUT_GUEST_DRAFT");
    } catch {}
  }, []);

  const markGuestModeAndGo = React.useCallback(() => {
    // Ensure old/stale guest payload does not show up unexpectedly
    clearGuestCheckoutSession();

    // Minimal, non-sensitive marker for checkout page routing decisions
    try {
      sessionStorage.setItem(
        "TDLC_CHECKOUT_MODE",
        JSON.stringify({ mode: "guest", createdAt: new Date().toISOString() })
      );
    } catch {}

    const guestCheckoutHref = withQueryParam(href || "/checkout", "mode", "guest");
    closeModal();
    safeNavigate(guestCheckoutHref);
  }, [clearGuestCheckoutSession, closeModal, safeNavigate, withQueryParam, href]);

  const goLogin = React.useCallback(() => {
    // Avoid leaking guest flags into account flows
    try {
      sessionStorage.removeItem("TDLC_CHECKOUT_MODE");
    } catch {}
    closeModal();
    safeNavigate(loginHref);
  }, [closeModal, safeNavigate, loginHref]);

  const goRegister = React.useCallback(() => {
    // Avoid leaking guest flags into account flows
    try {
      sessionStorage.removeItem("TDLC_CHECKOUT_MODE");
    } catch {}
    closeModal();
    safeNavigate(registerHref);
  }, [closeModal, safeNavigate, registerHref]);

  const onClick = async (e) => {
    // Prevent Link navigation; allow async session check to finish.
    e.preventDefault();

    if (disabled || checking) return;

    const logged = await detectCustomerSession();

    // If session probe failed, do not block customers. Go to checkout directly.
    if (sessionProbeFailedRef.current) {
      safeNavigate(href);
      return;
    }

    if (logged) {
      safeNavigate(href);
      return;
    }

    // Not logged in -> show modal (NO address form here)
    openGateModal();
  };

  const overlay = modalOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Checkout options"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20000,
        background: "rgba(2,6,23,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div
        style={{
          width: "min(720px, calc(100vw - 32px))",
          borderRadius: 22,
          overflow: "hidden",
          border: "1px solid rgba(226,232,240,0.65)",
          background: "linear-gradient(145deg,rgba(255,255,255,0.98),rgba(244,247,255,0.98))",
          boxShadow: "0 30px 90px rgba(2,6,23,0.35)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px",
            background:
              "radial-gradient(circle at top left,rgba(229,231,255,0.95),rgba(248,250,252,0.98))",
            borderBottom: "1px solid rgba(226,232,240,0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                letterSpacing: ".18em",
                textTransform: "uppercase",
                fontWeight: 900,
                color: "#0F2147",
              }}
            >
              Checkout Options
            </div>
            <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
              Choose how you want to continue. Guest mode redirects to the checkout page.
            </div>
          </div>

          <button
            type="button"
            onClick={closeModal}
            aria-label="Close"
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              border: "1px solid rgba(226,232,240,0.9)",
              background: "linear-gradient(135deg,#FFFFFF,#F1F5F9)",
              fontSize: 18,
              fontWeight: 900,
              cursor: "pointer",
              color: "#0F2147",
              boxShadow: "0 10px 25px rgba(2,6,23,0.12)",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          {sessionError ? (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 14,
                background: "rgba(254,242,242,1)",
                border: "1px solid rgba(254,202,202,1)",
                color: "#991B1B",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {sessionError}
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {/* Guest */}
            <button
              ref={firstButtonRef}
              type="button"
              onClick={markGuestModeAndGo}
              style={{
                padding: 14,
                borderRadius: 18,
                border: "1px solid rgba(226,232,240,0.9)",
                background: "linear-gradient(135deg,#0F2147,#0B1733)",
                color: "#F8FAFC",
                textAlign: "left",
                cursor: "pointer",
                boxShadow: "0 20px 40px rgba(15,33,71,0.25)",
              }}
            >
              <div style={{ fontSize: 12, letterSpacing: ".16em", fontWeight: 900 }}>GUEST MODE</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "rgba(248,250,252,0.85)" }}>
                Continue without login. You will enter shipping address on the checkout page.
              </div>
            </button>

            {/* Login */}
            <button
              type="button"
              onClick={goLogin}
              style={{
                padding: 14,
                borderRadius: 18,
                border: "1px solid rgba(226,232,240,0.9)",
                background: "linear-gradient(135deg,#FFFFFF,#F8FAFC)",
                color: "#0F2147",
                textAlign: "left",
                cursor: "pointer",
                boxShadow: "0 14px 30px rgba(2,6,23,0.10)",
              }}
            >
              <div style={{ fontSize: 12, letterSpacing: ".16em", fontWeight: 900 }}>ACCOUNT LOGIN</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#64748B" }}>
                Already have an account? Log in and continue.
              </div>
            </button>

            {/* Register */}
            <button
              type="button"
              onClick={goRegister}
              style={{
                padding: 14,
                borderRadius: 18,
                border: "1px solid rgba(226,232,240,0.9)",
                background: "linear-gradient(135deg,#FFFFFF,#F8FAFC)",
                color: "#0F2147",
                textAlign: "left",
                cursor: "pointer",
                boxShadow: "0 14px 30px rgba(2,6,23,0.10)",
              }}
            >
              <div style={{ fontSize: 12, letterSpacing: ".16em", fontWeight: 900 }}>CREATE ACCOUNT</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#64748B" }}>
                Create an account for faster reorder & tracking.
              </div>
            </button>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>
            Note: For COD orders, OTP is expected at order confirmation on the checkout page (not here).
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <Link
        href={href}
        prefetch={false}
        aria-disabled={disabled ? "true" : "false"}
        aria-label="Proceed to checkout"
        onClick={onClick}
        className={[
          "pointer-events-auto select-none",
          className,
          disabled ? "opacity-60 cursor-not-allowed" : "",
        ].join(" ")}
        style={style}
        data-testid="proceed-to-checkout"
        title={disabled && reason ? reason : "Proceed to checkout"}
      >
        {checking ? "Checking…" : children}
      </Link>

      {overlay}
    </>
  );
}
