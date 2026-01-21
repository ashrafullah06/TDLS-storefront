//FILE 3: src/components/checkout/checkout.dialogs.jsx
"use client";

import React, { useEffect, useState } from "react";
import { BORDER, NAVY, MUTED } from "./checkout.addressbook";

/* ---------------- OTP modal (COD ONLY) ---------------- */
export function OtpDialog({
  open,
  identifier,
  purposeLabel = "Cash-on-delivery verification",
  ttlSeconds,
  onSubmit,
  onClose,
  onResend,
}) {
  const [code, setCode] = useState("");
  const [ttl, setTtl] = useState(ttlSeconds || 90);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setTtl(ttlSeconds || 90);
      setResending(false);
    }
  }, [open, ttlSeconds]);

  useEffect(() => {
    if (!open || ttl <= 0) return;
    const t = setInterval(() => setTtl((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [open, ttl]);

  if (!open) return null;

  return (
    <div className="otp-overlay">
      <div className="otp-sheet">
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
            Purpose: <b>{purposeLabel}</b>.
          </div>

          <div className="otp-line">
            Enter 6-digit code {ttl > 0 ? `(expires in ${ttl}s)` : `(expired)`}.
          </div>

          <input
            className="otp-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            inputMode="numeric"
            autoFocus
          />

          <div className="otp-actions">
            <button
              className="otp-submit"
              onClick={() => onSubmit(code)}
              disabled={code.length !== 6}
            >
              Verify
            </button>

            <button
              className="otp-resend"
              onClick={async () => {
                if (ttl > 0 || resending) return;
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
                } finally {
                  setResending(false);
                }
              }}
              disabled={ttl > 0 || resending}
              title={ttl > 0 ? `Resend available in ${ttl}s` : resending ? "Sending..." : "Resend"}
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
          background: rgba(0, 0, 0, 0.32);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 14px;
        }
        .otp-sheet {
          width: min(440px, 92vw);
          background: #fff;
          border-radius: 16px;
          border: 1px solid ${BORDER};
          box-shadow: 0 16px 40px rgba(15, 33, 71, 0.25);
        }
        .otp-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid ${BORDER};
        }
        .otp-ttl {
          font-weight: 900;
          color: ${NAVY};
        }
        .otp-x {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 20px;
          cursor: pointer;
        }
        .otp-body {
          padding: 16px;
          display: grid;
          gap: 10px;
        }
        .otp-line {
          color: ${NAVY};
          font-weight: 700;
        }
        .otp-input {
          height: 54px;
          border: 1px solid ${BORDER};
          border-radius: 14px;
          font-size: 22px;
          text-align: center;
          letter-spacing: 8px;
        }
        .otp-actions {
          display: flex;
          gap: 10px;
        }
        .otp-submit {
          flex: 1;
          height: 46px;
          border-radius: 9999px;
          background: linear-gradient(135deg, #1e3a8a, #0ea5e9);
          color: #fff;
          font-weight: 900;
          border: 0;
        }
        .otp-resend {
          width: 140px;
          height: 46px;
          border-radius: 9999px;
          background: #fff;
          color: ${NAVY};
          font-weight: 900;
          border: 1px solid ${BORDER};
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
  if (!open) return null;

  return (
    <div className="co-modal" role="dialog" aria-modal="true">
      <div className="mode-sheet">
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
            <div className="mode-card-sub">
              Fast checkout. OTP only for COD confirmation.
            </div>
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
          background: rgba(0, 0, 0, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 160;
          padding: 12px;
        }
        .mode-sheet {
          width: min(520px, calc(100vw - 40px));
          background: #fff;
          border-radius: 18px;
          padding: 16px;
          box-shadow: 0 18px 40px rgba(15, 33, 71, 0.28);
          border: 1px solid ${BORDER};
        }
        .mode-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .mode-title {
          font-weight: 900;
          font-size: 18px;
          color: ${NAVY};
        }
        .mode-x {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 20px;
          cursor: pointer;
        }
        .mode-sub {
          color: ${MUTED};
          font-weight: 700;
          font-size: 13px;
          margin-bottom: 12px;
          line-height: 1.35;
        }
        .mode-grid {
          display: grid;
          gap: 10px;
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
          font-weight: 700;
          color: ${MUTED};
        }
      `}</style>
    </div>
  );
}
