// src/components/auth/forgot_password_form.jsx
"use client";

import React, { useMemo, useState } from "react";

const NAVY = "#0f2147";
const BORDER = "#E6EAF4";
const SUBTEXT = "#6F7890";

const isEmailish = (v) => /\S+@\S+\.\S+/.test(String(v || ""));
const isPhoneish = (v) => /^\+?\d[\d\s\-()]*$/.test(String(v || ""));
const toE164 = (raw) => String(raw || "").trim().replace(/[^\d+]/g, "");

export default function ForgotPasswordForm() {
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [via, setVia] = useState("email");
  const [ttl, setTtl] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const idShapeValid = useMemo(() => {
    if (!identifier?.trim()) return false;
    if (isEmailish(identifier)) return true;
    if (isPhoneish(identifier)) {
      const e164 = toE164(identifier);
      return /^\+?\d{8,}$/.test(e164);
    }
    return false;
  }, [identifier]);

  function mapError(code) {
    switch (code) {
      case "IDENTIFIER_REQUIRED":
        return "Enter a valid email address or mobile number.";
      case "USER_NOT_FOUND":
        return "We couldn’t find any account with that email/number. Check for typos or try another.";
      case "RATE_LIMITED":
        return "Too many requests right now. Please wait a bit and try again.";
      case "EMAIL_NOT_CONFIGURED":
        return "Email sending isn’t configured. Please contact support.";
      case "SMS_NOT_CONFIGURED":
        return "SMS/WhatsApp isn’t configured. Please contact support.";
      case "REQUEST_OTP_FAILED":
      case "OTP_SEND_FAILED":
        return "Couldn’t send a code right now. Please try again shortly.";
      case "OTP_INVALID_OR_EXPIRED":
      case "CODE_REQUIRED":
        return "That code didn’t work. Double-check and try again.";
      case "WEAK_PASSWORD":
        return "Use at least 8 characters for the new password.";
      default:
        return code || "Something went wrong. Please try again.";
    }
  }

  async function requestReset() {
    setErr("");
    if (!idShapeValid) {
      setErr("Enter a valid email address or mobile number.");
      return;
    }
    setBusy(true);
    try {
      const normalized = isEmailish(identifier)
        ? identifier.trim().toLowerCase()
        : toE164(identifier);
      const r = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: normalized }),
      });
      const jr = await r.json().catch(() => ({}));
      if (!r.ok || !jr?.ok) {
        if (jr?.error === "RATE_LIMITED" && jr?.retryAfter) {
          setErr(
            `Please wait ${jr.retryAfter} seconds before requesting another code.`
          );
        } else {
          setErr(mapError(jr?.error));
        }
        return;
      }
      setVia(jr?.via || (isEmailish(normalized) ? "email" : "sms"));
      setTtl(Number(jr?.ttlSeconds || 600));
      setStep(2);
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setErr("");
    if (!/^\d{6}$/.test(code)) {
      setErr("Enter the 6-digit code.");
      return;
    }
    if (!pwd || pwd.length < 8) {
      setErr("Use at least 8 characters for the new password.");
      return;
    }
    if (pwd !== confirm) {
      setErr("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const normalized = isEmailish(identifier)
        ? identifier.trim().toLowerCase()
        : toE164(identifier);
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: normalized,
          code: code.trim(),
          newPassword: pwd,
        }),
      });
      const jr = await r.json().catch(() => ({}));
      if (!r.ok || !jr?.ok) {
        setErr(mapError(jr?.error));
        return;
      }
      // Success — show message inline (no forced redirect)
      setDone(true);
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 520 }}>
      <h1
        className="text-[28px] font-bold"
        style={{ color: NAVY, marginBottom: 10 }}
      >
        Reset your password
      </h1>

      {!done && (
        <p className="text-[15px]" style={{ color: SUBTEXT, marginBottom: 20 }}>
          {step === 1
            ? "Enter your email or mobile number. We’ll send a one-time code to verify."
            : `We sent a 6-digit code via ${via}. Enter it and set a new password.`}
        </p>
      )}

      {/* Step 1: request code */}
      {!done && step === 1 && (
        <>
          <label
            className="block text-[13px] font-semibold uppercase"
            style={{ color: NAVY, marginBottom: 8 }}
          >
            Email or Mobile
          </label>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com or +8801…"
            className="w-full text-[16px] rounded-full"
            style={{
              height: 54,
              padding: "0 18px",
              border: `1.5px solid ${BORDER}`,
              boxShadow: "inset 0 8px 18px rgba(15,33,71,.06)",
            }}
            aria-invalid={!idShapeValid && identifier.length > 0}
          />
          {!idShapeValid && identifier.length > 0 && (
            <p className="mt-2 text-[13px]" style={{ color: "#9f1d20" }}>
              That doesn’t look like a valid email or phone number.
            </p>
          )}
          <button
            disabled={busy}
            onClick={requestReset}
            className="w-full mt-4 text-white font-semibold rounded-full"
            style={{ height: 52, background: "#0f2147" }}
          >
            {busy ? "Sending…" : "Send reset code"}
          </button>
        </>
      )}

      {/* Step 2: verify + new password */}
      {!done && step === 2 && (
        <>
          <label
            className="block text-[13px] font-semibold uppercase"
            style={{ color: NAVY, marginBottom: 8 }}
          >
            6-digit code
          </label>
          <input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))
            }
            placeholder="Enter code"
            className="w-full text-[16px] rounded-2xl text-center tracking-[0.5em]"
            style={{
              height: 54,
              padding: "0 18px",
              border: `1.5px solid ${BORDER}`,
              boxShadow: "inset 0 8px 18px rgba(15,33,71,.06)",
            }}
          />
          <p className="text-[13px] mt-2" style={{ color: SUBTEXT }}>
            Code expires in ~{Math.round(ttl / 60)} minute(s).
          </p>

          <div className="mt-5" />

          <label
            className="block text-[13px] font-semibold uppercase"
            style={{ color: NAVY, marginBottom: 8 }}
          >
            New password
          </label>
          <div className="relative">
            <input
              type={showPwd ? "text" : "password"}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full text-[16px] rounded-full pr-12"
              style={{
                height: 54,
                padding: "0 18px",
                border: `1.5px solid ${BORDER}`,
                boxShadow: "inset 0 8px 18px rgba(15,33,71,.06)",
              }}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              aria-pressed={showPwd}
              aria-label={showPwd ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[13px]"
              style={{ color: SUBTEXT }}
            >
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>

          <label
            className="block text-[13px] font-semibold uppercase mt-4"
            style={{ color: NAVY, marginBottom: 8 }}
          >
            Confirm password
          </label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              className="w-full text-[16px] rounded-full pr-12"
              style={{
                height: 54,
                padding: "0 18px",
                border: `1.5px solid ${BORDER}`,
                boxShadow: "inset 0 8px 18px rgba(15,33,71,.06)",
              }}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              aria-pressed={showConfirm}
              aria-label={showConfirm ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[13px]"
              style={{ color: SUBTEXT }}
            >
              {showConfirm ? "Hide" : "Show"}
            </button>
          </div>

          <button
            disabled={busy}
            onClick={resetPassword}
            className="w-full mt-5 text-white font-semibold rounded-full"
            style={{ height: 52, background: "#0f2147" }}
          >
            {busy ? "Resetting…" : "Reset password"}
          </button>
        </>
      )}

      {/* Success state */}
      {done && (
        <div
          className="rounded-2xl px-4 py-4 mt-3"
          style={{
            border: "1px solid #c7f0d8",
            background: "#effaf3",
            color: "#136b3a",
          }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 28,
                height: 28,
                background: "#20c977",
                color: "white",
                fontWeight: 800,
              }}
              aria-hidden="true"
            >
              ✓
            </div>
            <div>
              <p className="font-semibold">Password updated successfully.</p>
              <p className="text-[14px]" style={{ color: "#246e4e" }}>
                You can now sign in with your new password.
              </p>
              <a
                href="/login"
                className="inline-flex items-center mt-3 rounded-full px-4 py-2 text-[14px] font-semibold"
                style={{
                  background: NAVY,
                  color: "#fff",
                  boxShadow: "0 6px 18px rgba(15,33,71,.12)",
                }}
              >
                Go to Sign in
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Error bubble */}
      {err && !done && (
        <div
          className="mt-4 rounded-2xl px-4 py-3 text-[14px]"
          style={{
            color: "#9f1d20",
            background: "#fff5f5",
            border: "1px solid #ffdada",
          }}
          role="alert"
        >
          {err}
        </div>
      )}
    </div>
  );
}
