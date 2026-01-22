//FILE 3: src/components/checkout/checkout.dialogs.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { BORDER, NAVY, MUTED } from "./checkout.addressbook";

/* ---------------- tiny helpers ---------------- */

function useBodyScrollLock(locked) {
  useEffect(() => {
    if (!locked) return;

    // Store prior styles
    const body = document?.body;
    if (!body) return;

    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    const prevTouchAction = body.style.touchAction;

    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";
    body.style.touchAction = "none";

    return () => {
      body.style.overflow = prevOverflow || "";
      body.style.overscrollBehavior = prevOverscroll || "";
      body.style.touchAction = prevTouchAction || "";
    };
  }, [locked]);
}

function useEscapeToClose(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey, { passive: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

function useRestoreFocus(open) {
  const lastActiveRef = useRef(null);

  useEffect(() => {
    if (open) {
      lastActiveRef.current = document?.activeElement || null;
      return;
    }
    // Restore focus when closed
    const el = lastActiveRef.current;
    if (el && typeof el.focus === "function") {
      try {
        el.focus();
      } catch {}
    }
    lastActiveRef.current = null;
  }, [open]);
}

const SAFE_MAX_HEIGHT = `
  max-height: calc(
    100vh -
      (env(safe-area-inset-top) + var(--navbar-h, 96px)) -
      (env(safe-area-inset-bottom) + max(var(--bottom-floating-h, 0px), var(--bottom-safe-pad, 84px))) -
      24px
  );
`;

const SAFE_MAX_HEIGHT_DVH = `
  max-height: calc(
    100dvh -
      (env(safe-area-inset-top) + var(--navbar-h, 96px)) -
      (env(safe-area-inset-bottom) + max(var(--bottom-floating-h, 0px), var(--bottom-safe-pad, 84px))) -
      24px
  );
`;

/* ---------------- OTP modal (COD ONLY) ---------------- */
export function OtpDialog({
  open,
  identifier,
  // Support BOTH names to avoid mismatches across files.
  purpose,
  purposeLabel = "Cash-on-delivery verification",
  ttlSeconds,
  onSubmit,
  onClose,
  onResend,
}) {
  const [code, setCode] = useState("");
  const [ttl, setTtl] = useState(ttlSeconds || 90);
  const [resending, setResending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const resolvedPurposeLabel = useMemo(() => {
    const v = String(purposeLabel || purpose || "").trim();
    return v || "Verification";
  }, [purposeLabel, purpose]);

  useBodyScrollLock(!!open);
  useEscapeToClose(!!open, onClose);
  useRestoreFocus(!!open);

  useEffect(() => {
    if (open) {
      setCode("");
      setTtl(ttlSeconds || 90);
      setResending(false);
      setSubmitting(false);
      setErr("");
    }
  }, [open, ttlSeconds]);

  useEffect(() => {
    if (!open || ttl <= 0) return;
    const t = setInterval(() => setTtl((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [open, ttl]);

  if (!open) return null;

  const canSubmit = code.length === 6 && !submitting;
  const canResend = ttl <= 0 && !resending && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setErr("");
    try {
      setSubmitting(true);
      await onSubmit?.(code);
    } catch (e) {
      const msg =
        typeof e?.message === "string" && e.message.trim()
          ? e.message.trim()
          : "Verification failed. Please try again.";
      setErr(msg);
      setSubmitting(false);
    }
  }

  return (
    <div
      className="otp-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="OTP Verification"
      onMouseDown={(e) => {
        // Click outside closes (but never when clicking inside the sheet)
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="otp-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="otp-head">
          <div className="otp-ttl">Verify</div>
          <button className="otp-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="otp-body">
          <div className="otp-line">
            We sent a code to <b>{identifier}</b>.
          </div>
          <div className="otp-line">
            Purpose: <b>{resolvedPurposeLabel}</b>.
          </div>

          <div className="otp-line">
            Enter 6-digit code{" "}
            {ttl > 0 ? `(expires in ${ttl}s)` : `(expired)`}.
          </div>

          {err ? <div className="otp-error">{err}</div> : null}

          <input
            className="otp-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="••••••"
            inputMode="numeric"
            pattern="[0-9]*"
            autoFocus
            autoComplete="one-time-code"
            aria-label="OTP code"
          />

          <div className="otp-actions">
            <button className="otp-submit" onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? "Verifying..." : "Verify"}
            </button>

            <button
              className="otp-resend"
              onClick={async () => {
                if (!canResend) return;
                setErr("");
                try {
                  setResending(true);
                  setCode("");
                  const r = await onResend?.();
                  const nextTtl =
                    typeof r === "number"
                      ? r
                      : typeof r?.ttlSeconds === "number"
                      ? r.ttlSeconds
                      : typeof r?.ttl === "number"
                      ? r.ttl
                      : null;
                  if (typeof nextTtl === "number" && nextTtl > 0) setTtl(nextTtl);
                  else setTtl(90); // safe fallback if server does not return ttl
                } catch (e) {
                  const msg =
                    typeof e?.message === "string" && e.message.trim()
                      ? e.message.trim()
                      : "Resend failed. Please try again.";
                  setErr(msg);
                } finally {
                  setResending(false);
                }
              }}
              disabled={!canResend}
              title={
                ttl > 0
                  ? `Resend available in ${ttl}s`
                  : resending
                  ? "Sending..."
                  : "Resend"
              }
            >
              {resending ? "Sending..." : ttl > 0 ? `Resend in ${ttl}s` : "Resend"}
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .otp-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.38);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 120;
          padding: 14px;
        }
        .otp-sheet {
          width: min(460px, 92vw);
          background: #fff;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          box-shadow: 0 16px 40px rgba(15, 33, 71, 0.25);
          overflow: hidden;

          ${SAFE_MAX_HEIGHT}
          display: flex;
          flex-direction: column;
        }
        @supports (height: 100dvh) {
          .otp-sheet {
            ${SAFE_MAX_HEIGHT_DVH}
          }
        }

        .otp-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid ${BORDER};
          flex: 0 0 auto;
        }
        .otp-ttl {
          font-weight: 900;
          color: ${NAVY};
          letter-spacing: 0.02em;
        }
        .otp-x {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 22px;
          cursor: pointer;
          line-height: 1;
        }
        .otp-body {
          padding: 16px;
          display: grid;
          gap: 10px;
          overflow: auto;
          flex: 1 1 auto;
        }
        .otp-line {
          color: ${NAVY};
          font-weight: 800;
          line-height: 1.25;
          font-size: 13px;
        }
        .otp-error {
          background: #fff1f2;
          border: 1px solid #fecdd3;
          color: #9f1239;
          border-radius: 14px;
          padding: 9px 11px;
          font-weight: 900;
          font-size: 12.5px;
          line-height: 1.25;
        }
        .otp-input {
          height: 54px;
          border: 1px solid ${BORDER};
          border-radius: 14px;
          font-size: 22px;
          text-align: center;
          letter-spacing: 8px;
          outline: none;
        }
        .otp-input:focus {
          box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.18);
          border-color: rgba(14, 165, 233, 0.6);
        }
        .otp-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .otp-submit {
          flex: 1;
          min-width: 160px;
          height: 46px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #1e3a8a, #0ea5e9);
          color: #fff;
          font-weight: 900;
          border: 0;
          cursor: pointer;
          box-shadow: 0 10px 22px rgba(14, 165, 233, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
        }
        .otp-submit:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .otp-resend {
          width: 160px;
          max-width: 100%;
          height: 46px;
          border-radius: 9999px;
          background: #fff;
          color: ${NAVY};
          font-weight: 900;
          border: 1px solid ${BORDER};
          cursor: pointer;
        }
        .otp-resend:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

/* ---------------- Mode choice modal ---------------- */
export function CheckoutModeDialog({
  open,
  onGuest,
  onLogin,
  onCreate,
  onClose,
  subtitle,
}) {
  useBodyScrollLock(!!open);
  useEscapeToClose(!!open, onClose);
  useRestoreFocus(!!open);

  if (!open) return null;

  return (
    <div
      className="co-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Checkout Mode Selection"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="mode-sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mode-head">
          <div className="mode-title">How would you like to checkout?</div>
          <button type="button" className="mode-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="mode-sub">{subtitle || "Choose one option to continue."}</div>

        <div className="mode-grid">
          <button type="button" className="mode-card primary" onClick={onGuest}>
            <div className="mode-card-ttl">Guest Mode</div>
            <div className="mode-card-sub">Fast checkout. OTP only for COD confirmation.</div>
          </button>

          <button type="button" className="mode-card" onClick={onLogin}>
            <div className="mode-card-ttl">Account Login</div>
            <div className="mode-card-sub">I already have an account.</div>
          </button>

          <button type="button" className="mode-card" onClick={onCreate}>
            <div className="mode-card-ttl">Create Account</div>
            <div className="mode-card-sub">Create an account for faster future orders.</div>
          </button>
        </div>
      </div>

      <style jsx>{`
        .co-modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.28);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 110;
          padding: 12px;
        }

        .mode-sheet {
          width: min(560px, calc(100vw - 32px));
          background: #fff;
          border-radius: 18px;
          box-shadow: 0 18px 40px rgba(15, 33, 71, 0.28);
          border: 1px solid ${BORDER};
          overflow: hidden;

          ${SAFE_MAX_HEIGHT}
          display: flex;
          flex-direction: column;
        }
        @supports (height: 100dvh) {
          .mode-sheet {
            ${SAFE_MAX_HEIGHT_DVH}
          }
        }

        .mode-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 14px 14px 10px;
          border-bottom: 1px solid ${BORDER};
          flex: 0 0 auto;
        }

        .mode-title {
          font-weight: 900;
          font-size: 16px;
          color: ${NAVY};
          letter-spacing: 0.01em;
          line-height: 1.2;
        }

        .mode-x {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 22px;
          cursor: pointer;
          line-height: 1;
          flex: 0 0 auto;
        }

        .mode-sub {
          color: ${MUTED};
          font-weight: 800;
          font-size: 13px;
          line-height: 1.35;
          padding: 10px 14px 12px;
          flex: 0 0 auto;
        }

        .mode-grid {
          display: grid;
          gap: 10px;
          padding: 0 14px 14px;
          overflow: auto;
          flex: 1 1 auto;
        }

        .mode-card {
          text-align: left;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          padding: 12px 12px;
          background: #fff;
          cursor: pointer;
          display: grid;
          gap: 4px;
          min-height: 56px; /* better tap target */
        }

        .mode-card.primary {
          border-color: #1d4ed8;
          background: #eff6ff;
        }

        .mode-card-ttl {
          font-weight: 900;
          color: ${NAVY};
        }

        .mode-card-sub {
          font-size: 12px;
          font-weight: 800;
          color: ${MUTED};
          line-height: 1.3;
        }
      `}</style>
    </div>
  );
}
