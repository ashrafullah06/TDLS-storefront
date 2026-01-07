// FILE: src/components/auth/otpform.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

const NAVY = "#0f2147";
const NAVY_GRAD = "linear-gradient(135deg,#162a4d 0%,#0b1633 100%)";
const GREY_BORDER = "#E4E7EE";

/* ========= EASY-TO-TUNE SPACING TOKENS ========= */
/** Page padding from viewport edges (outside card) */
const PAGE_PADDING_X = "px-4 md:px-8";
const PAGE_PADDING_Y = "py-10";

/** Card inner padding (distance of text from card border) */
const CARD_PADDING_X = "px-7 md:px-10 lg:px-12";
const CARD_PADDING_Y_TOP = "pt-8";
const CARD_PADDING_Y_BOTTOM = "pb-10";

/** Gap between main CTA button and helper text below */
const CTA_TO_HELPER_GAP = "pt-4";

/** Gap around primary CTA block */
const CTA_BLOCK_MARGIN_TOP = "mt-1";
const CTA_BLOCK_MARGIN_BOTTOM = "mb-1";

/** Gap between small resend CTA and text ("Didn't get a code?") */
const RESEND_ROW_GAP = "gap-2";
/* =============================================== */

/* ---------- small helpers ---------- */
const fmt = (s) => {
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
};

const PURPOSE_SET = new Set([
  "signup",
  "login",
  "address_create",
  "address_update",
  "address_delete",
  "mobile_update",
  "cod_confirm",
  "order_confirm",
  "payment_gateway_auth",
  "email_update",
  "password_change",
  "wallet_transfer",
  "refund_destination_confirm",
  "reward_redeem_confirm",
  "privacy_request_confirm",
  "rbac_login",
  "rbac_elevate",
  "rbac_sensitive_action",
]);

const PURPOSE_ALIASES = {
  cod: "cod_confirm",
  place_order: "cod_confirm",
  checkout_confirm: "order_confirm",
  order: "order_confirm",
  address_add: "address_create",
  add_address: "address_create",
  edit_address: "address_update",
  delete_address: "address_delete",
  change_phone: "mobile_update",
  change_email: "email_update",
  change_password: "password_change",
  gateway_auth: "payment_gateway_auth",
  pg_otp: "payment_gateway_auth",
  admin_login: "rbac_login",
  elevate: "rbac_elevate",
  sudo_action: "rbac_sensitive_action",
};

function normalizePurposeClient(raw) {
  const p = String(raw || "").trim().toLowerCase();
  if (PURPOSE_SET.has(p)) return p;
  const mapped = PURPOSE_ALIASES[p] || p;
  if (PURPOSE_SET.has(mapped)) return mapped;
  return "login";
}

/* Purpose → compact context text */
function buildContext(purpose) {
  const base = {
    kind: "customer",
    pill: "Security check",
    title: "Enter the 6-digit code",
    subtitle: "This step keeps your TDLC account safer.",
    cta: "Verify & continue",
  };

  if (purpose === "signup" || purpose === "login") {
    return {
      ...base,
      pill: "Sign-in verification",
      subtitle: "A quick code to confirm it’s really you.",
      cta: "Verify & sign in",
    };
  }

  if (purpose === "cod_confirm") {
    return {
      kind: "cod",
      pill: "Cash-on-Delivery",
      title: "Confirm your COD order",
      subtitle: "We verify your number before shipping a COD parcel.",
      cta: "Confirm COD order",
    };
  }

  if (purpose === "order_confirm") {
    return {
      kind: "checkout",
      pill: "Checkout verification",
      title: "Confirm this checkout",
      subtitle: "One last step to lock in your order details.",
      cta: "Confirm & place order",
    };
  }

  if (purpose === "payment_gateway_auth") {
    return {
      kind: "payment",
      pill: "Payment verification",
      title: "Verify this payment",
      subtitle: "We add an extra security layer to payment attempts.",
      cta: "Confirm payment",
    };
  }

  if (
    purpose === "email_update" ||
    purpose === "mobile_update" ||
    purpose === "address_create" ||
    purpose === "address_update" ||
    purpose === "address_delete" ||
    purpose === "password_change"
  ) {
    return {
      kind: "profile",
      pill: "Account changes",
      title: "Approve this change",
      subtitle: "We verify your identity before updating your details.",
      cta: "Approve & continue",
    };
  }

  if (purpose === "wallet_transfer" || purpose === "refund_destination_confirm") {
    return {
      kind: "finance",
      pill: "Wallet & refunds",
      title: "Confirm this money action",
      subtitle: "We double-check before moving funds or refunds.",
      cta: "Confirm & continue",
    };
  }

  if (purpose === "reward_redeem_confirm") {
    return {
      kind: "loyalty",
      pill: "Rewards",
      title: "Confirm reward redemption",
      subtitle: "We protect your TDLC rewards from misuse.",
      cta: "Redeem rewards",
    };
  }

  if (purpose === "privacy_request_confirm") {
    return {
      kind: "privacy",
      pill: "Privacy & data",
      title: "Confirm this privacy request",
      subtitle: "We verify before exporting or deleting your data.",
      cta: "Confirm request",
    };
  }

  if (
    purpose === "rbac_login" ||
    purpose === "rbac_elevate" ||
    purpose === "rbac_sensitive_action"
  ) {
    return {
      kind: "admin",
      pill: "Admin verification",
      title: "",
      subtitle: "",
      cta: "Approve & continue",
    };
  }

  return base;
}

export default function OtpForm() {
  const router = useRouter();
  const search = useSearchParams();

  const to = search?.get("to") || "";
  const via = (search?.get("via") || "sms").toLowerCase();
  const purposeParam = search?.get("purpose") || "login";
  const purpose = normalizePurposeClient(purposeParam);

  const redirectTo =
    (search?.get("checkout")
      ? "/checkout"
      : search?.get("redirect") || "/customer/dashboard") ||
    "/customer/dashboard";

  const remember = search?.get("remember") === "1";
  const sessionId = search?.get("session") || null;

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [expires, setExpires] = useState(0);

  const abortCtrlRef = useRef(null);
  const lastKeyRef = useRef("");
  const inputRefs = useRef([]);

  const context = useMemo(() => buildContext(purpose), [purpose]);
  const isAdminFlow = context.kind === "admin";
  const isCodFlow = context.kind === "cod";

  /* ---------- Timer ---------- */
  useEffect(() => {
    if (expires <= 0) return;
    const t = setInterval(() => {
      setExpires((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [expires]);

  /* ---------- Android Web OTP (SMS only) ---------- */
  useEffect(() => {
    if (typeof window === "undefined" || !("OTPCredential" in window) || via !== "sms")
      return;
    try {
      abortCtrlRef.current?.abort();
      const ac = new AbortController();
      abortCtrlRef.current = ac;
      // @ts-ignore
      navigator.credentials
        .get({ otp: { transport: ["sms"] }, signal: ac.signal })
        .then((cred) => {
          if (!cred?.code) return;
          const v = String(cred.code).replace(/[^\d]/g, "").slice(0, 6);
          const arr = v.split("");
          while (arr.length < 6) arr.push("");
          setDigits(arr);
          setOtp(v);
        })
        .catch(() => {});
    } catch {}
    return () => abortCtrlRef.current?.abort();
  }, [via]);

  /* ---------- Mask + labels ---------- */
  const mask = useMemo(() => {
    if (!to) return "";
    if (to.includes("@")) {
      const [u, d] = to.split("@");
      return `${u?.slice(0, 2)}***@${d}`;
    }
    const t = to.replace(/^\+/, "");
    return `+${t.slice(0, 2)}***${t.slice(-2)}`;
  }, [to]);

  const viaLabel = useMemo(() => {
    if (via === "email") return "email";
    if (via === "whatsapp") return "WhatsApp";
    return "SMS";
  }, [via]);

  /* ---------- Request / bootstrap OTP ---------- */
  async function bootstrapOtp(silent = true) {
    if (!to || !purpose) return;
    try {
      if (!silent) {
        setErr("");
        setSending(true);
      }
      const channel =
        via === "email" ? "EMAIL" : via === "whatsapp" ? "WHATSAPP" : "SMS";

      // ✔ unified new route
      const r = await fetch("/api/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: to,
          purpose,
          channel,
          allowNew: purpose === "signup",
          sessionId,
        }),
      });
      const jr = await r.json().catch(() => ({}));

      if (!r.ok) {
        if (!silent) {
          setErr(jr?.error || "Unable to send the code right now.");
        }
        return;
      }

      const ttl = Number(jr?.ttlSeconds) || 0;
      if (ttl > 0) setExpires(ttl);
    } catch (e) {
      if (!silent) setErr(e?.message || "Unable to send the code.");
    } finally {
      if (!silent) setSending(false);
    }
  }

  useEffect(() => {
    const key = `${to}|${via}|${purpose}`;
    if (!to) return;
    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      setDigits(["", "", "", "", "", ""]);
      setOtp("");
      setErr("");
      setExpires(0);
      bootstrapOtp(true);
    }
  }, [to, via, purpose]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- OTP input handlers ---------- */
  const handleDigitChange = (index, value) => {
    const v = value.replace(/[^\d]/g, "").slice(-1); // single digit
    const next = [...digits];
    next[index] = v;
    setDigits(next);
    const joined = next.join("");
    setOtp(joined);

    if (v && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index, e) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    }
    if (e.key === "ArrowRight" && index < 5) {
      inputRefs.current[index + 1]?.focus();
      e.preventDefault();
    }
  };

  /* ---------- Actions ---------- */
  async function verify() {
    if (verifying) return;
    setErr("");
    if (!/^\d{6}$/.test(otp)) {
      setErr("Enter the 6-digit code.");
      return;
    }

    setVerifying(true);
    try {
      // 1) Verify OTP with your API (sets otp_session + consumes row)
      const r = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: to,
          purpose,
          code: otp.trim(),
          rememberDevice: remember,
          sessionId,
        }),
      });

      const jr = await r.json().catch(() => ({}));

      if (!r.ok || !(jr?.ok || jr?.verified)) {
        if (jr?.attemptsLeft != null) {
          setErr(
            `That code didn’t work. You have ${jr.attemptsLeft} attempt(s) left.`
          );
        } else if (jr?.error === "OTP_NOT_FOUND_OR_EXPIRED") {
          setErr("This code has expired. Tap resend to get a new one.");
        } else if (jr?.error === "OTP_MISMATCH") {
          setErr("That code didn’t match. Please try again.");
        } else {
          setErr(jr?.error || "Invalid or expired code.");
        }
        setVerifying(false);
        return;
      }

      // 2) NextAuth establishes the session (for login / signup).
      await signIn("credentials", {
        redirect: true,
        type: "otp",
        identifier: to,
        code: otp.trim(),
        purpose,
        callbackUrl: `${redirectTo}?login=1`,
      });
    } catch (e) {
      setErr(e?.message || "Verification failed. Please try again.");
      setVerifying(false);
    }
  }

  async function resend() {
    if (sending || expires > 0) return;
    await bootstrapOtp(false);
    setDigits(["", "", "", "", "", ""]);
    setOtp("");
    inputRefs.current[0]?.focus();
  }

  const canResend = !sending && expires === 0;
  const canVerify = !verifying && otp.length === 6;

  /* ---------- UI ---------- */
  return (
    <section className={`${PAGE_PADDING_X} ${PAGE_PADDING_Y}`}>
      <div className="mx-auto max-w-4xl">
        <div className="relative">
          {/* Glow / emboss background */}
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-[28px] blur-xl opacity-80"
            style={{ background: NAVY_GRAD }}
          />

          {/* Card */}
          <div
            className="relative rounded-[24px] border shadow-[0_18px_40px_rgba(0,0,0,0.65)] border-[rgba(255,255,255,0.08)] bg-[rgba(8,15,32,0.97)] backdrop-blur-md overflow-hidden"
            style={{ color: "#f9fafb" }}
          >
            <div
              className={`${CARD_PADDING_X} ${CARD_PADDING_Y_TOP} ${CARD_PADDING_Y_BOTTOM} flex flex-col gap-6`}
            >
              {/* Top row: step + timer */}
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center rounded-full border border-[rgba(226,232,255,0.38)] px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase text-[rgba(226,232,255,0.9)] whitespace-nowrap">
                  Step 2 of 2 · {context.pill}
                </span>
                {expires > 0 && (
                  <span className="text-[11px] text-[rgba(209,213,255,0.95)] text-right leading-snug">
                    Code expires in{" "}
                    <strong className="font-semibold">{fmt(expires)}</strong>
                  </span>
                )}
              </div>

              {/* Headline + description */}
              <div className="space-y-2 max-w-xl mx-auto">
                <h1
                  className={`text-[22px] md:text-[24px] font-semibold leading-snug tracking-tight ${
                    isAdminFlow
                      ? "text-white text-center"
                      : "text-[rgba(239,242,255,0.96)]"
                  }`}
                >
                  {context.title}
                </h1>
                <p className="text-xs md:text-[13px] text-[rgba(209,213,255,0.94)] leading-relaxed text-center md:text-left">
                  {mask ? (
                    <>
                      We sent a 6-digit code to{" "}
                      <span className="font-semibold text-white">{mask}</span>{" "}
                      via{" "}
                      <span className="font-semibold text-white">
                        {viaLabel}
                      </span>
                      .
                    </>
                  ) : (
                    <>We sent a 6-digit code to your {viaLabel.toLowerCase()}.</>
                  )}
                </p>
                {context.subtitle && (
                  <p className="text-[11px] md:text-[12px] text-[rgba(156,172,230,0.96)] leading-relaxed">
                    {context.subtitle}
                  </p>
                )}
              </div>

              {/* OTP row + resend + errors */}
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="flex justify-between gap-3 w-full max-w-[360px]">
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <input
                        key={idx}
                        ref={(el) => (inputRefs.current[idx] = el)}
                        type="text"
                        inputMode="numeric"
                        autoComplete={idx === 0 ? "one-time-code" : "off"}
                        pattern="[0-9]*"
                        maxLength={1}
                        value={digits[idx]}
                        onChange={(e) => handleDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                        className="flex-1 max-w-[48px] aspect-square rounded-[12px] text-center text-[20px] font-semibold outline-none"
                        style={{
                          backgroundColor: "#f9fafb",
                          border: digits[idx]
                            ? "2px solid rgba(30,64,175,0.9)"
                            : `1.5px solid ${GREY_BORDER}`,
                          color: NAVY,
                          boxShadow: digits[idx]
                            ? "0 0 0 1px rgba(59,130,246,0.4)"
                            : "0 0 0 0 rgba(0,0,0,0)",
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div
                  className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${RESEND_ROW_GAP} w-full max-w-[360px] mx-auto`}
                >
                  <p className="text-[11px] text-slate-300/85 leading-snug">
                    Didn&apos;t get a code?
                  </p>
                  <button
                    type="button"
                    onClick={resend}
                    disabled={!canResend}
                    className="inline-flex items-center justify-center rounded-2xl px-4 py-[9px] text-[12px] md:text-[13px] font-medium text-center whitespace-nowrap transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-[1px] hover:shadow-md"
                    style={{
                      backgroundColor: "#f9fafb",
                      color: NAVY,
                      border: `1.5px solid ${GREY_BORDER}`,
                    }}
                  >
                    {expires > 0
                      ? `Resend in ${fmt(expires)}`
                      : sending
                      ? "Sending…"
                      : "Resend code"}
                  </button>
                </div>

                {err && (
                  <div
                    className="rounded-2xl px-4 py-3 text-[12.5px] max-w-[480px]"
                    style={{
                      color: "#9f1d20",
                      background: "#fff5f5",
                      border: "1px solid #ffdada",
                    }}
                    role="alert"
                    aria-live="polite"
                  >
                    {err}
                  </div>
                )}
              </div>

              {/* Primary CTA */}
              <div
                className={`max-w-[420px] ${CTA_BLOCK_MARGIN_TOP} ${CTA_BLOCK_MARGIN_BOTTOM}`}
              >
                <button
                  type="button"
                  onClick={verify}
                  disabled={!canVerify}
                  className="w-full inline-flex items-center justify-center rounded-[999px] px-8 py-[13px] md:py-[14px] text-[15px] md:text-[16px] font-semibold tracking-[0.03em] text-slate-950 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg,#fde68a 0%,#fbbf24 40%,#d97706 100%)",
                    boxShadow: canVerify
                      ? "0 14px 32px rgba(0,0,0,0.7)"
                      : "0 10px 24px rgba(0,0,0,0.45)",
                  }}
                  onMouseDown={(e) => {
                    if (e.currentTarget.disabled) return;
                    e.currentTarget.style.transform =
                      "translateY(0.5px) scale(0.99)";
                    e.currentTarget.style.boxShadow =
                      "0 8px 20px rgba(0,0,0,0.6)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "";
                    e.currentTarget.style.boxShadow =
                      "0 14px 32px rgba(0,0,0,0.7)";
                  }}
                >
                  {verifying ? "Verifying…" : context.cta}
                </button>
              </div>

              {/* Helper text */}
              <div className={`space-y-2 ${CTA_TO_HELPER_GAP}`}>
                <p className="text-center text-[11px] md:text-[12px] text-[rgba(209,213,255,0.9)] leading-snug">
                  Wrong{" "}
                  {viaLabel === "email" ? "email address" : "phone number"}?{" "}
                  <a
                    href="/login"
                    className="underline underline-offset-2 font-medium"
                    style={{ color: "#f9fafb" }}
                  >
                    Go back & change it
                  </a>
                </p>

                {isAdminFlow && (
                  <p className="text-[10.5px] text-center text-[rgba(186,197,255,0.95)] leading-relaxed">
                    For admin/staff accounts, this OTP protects refunds, stock
                    updates and role changes from unauthorized access.
                  </p>
                )}

                {isCodFlow && (
                  <p className="text-[10.5px] text-center text-[rgba(186,197,255,0.95)] leading-relaxed">
                    For Cash-on-Delivery orders, we only ship after confirming
                    this number. This reduces fake orders and protects your
                    address.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
