// app/(auth)/signup/page.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

/* ============================================================
   TDLC THEME & DIMENSIONS — tweak here only
   ============================================================ */
const TDLC = {
  NAVY: "#0f2147",
  CTA_TEXT: "#ffffff",
  FIELD_HEIGHT: 64,
  FIELD_RADIUS: 18,
  FIELD_PADDING_X: 18,
  FIELD_FONT_SIZE: 16,
  FIELD_BORDER_WIDTH: 1,
  FIELD_BORDER_COLOR: "rgba(0,0,0,.12)",
  CTA_HEIGHT: 68,
  CTA_WIDTH_PERCENT: 70,
  GAP_FIELD_TO_CTA: 28,
  CONTAINER_MAX_W: 640,
  STACK_GAP_Y: 32,
};
/* ============================================================ */

const isPhoneish = (v) => /^\+?\d[\d\s\-()]*$/.test(String(v || ""));
const isEmailish = (v) => /\S+@\S+\.\S+/.test(String(v || ""));
const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

/** Bangladesh MSISDN rules we enforce in the UI:
 *  - Country code is +880 (we accept +88 and coerce to +880)
 *  - Local after +880 is 10 digits and MUST start with 1 (1XXXXXXXXX)
 *  - If the user types a leading 0 (017…), we auto-strip that 0 -> 17…
 */
function normalizeCountryCode(raw) {
  const s = String(raw || "").trim();
  if (!s) return "+880";
  const d = s.replace(/[^\d+]/g, "");
  if (d === "+88" || d === "88") return "+880";
  if (d.startsWith("+880")) return "+880";
  if (d === "+880") return "+880";
  // lock to BD for this flow
  return "+880";
}

/** Clean local input; auto-remove a single leading 0, keep max 10 digits */
function cleanLocal(raw) {
  let d = onlyDigits(raw || "");
  if (d.startsWith("0")) d = d.replace(/^0+/, ""); // auto-diminish leading zeros
  d = d.slice(0, 10); // hard-limit to 10 digits after +880
  return d;
}

/** Compute E.164 from parts; returns "" if invalid */
function e164FromParts(cc, local) {
  const country = normalizeCountryCode(cc);
  const loc = cleanLocal(local);
  if (country !== "+880") return ""; // locked to BD
  if (loc.length !== 10) return "";  // need full 10 digits
  if (!/^1\d{9}$/.test(loc)) return ""; // must start with '1'
  return `${country}${loc}`;
}

/** Backward compatibility: normalize a single free-form phone string as BD */
function toE164BD(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = onlyDigits(s);

  // Handle forms:
  // +8801XXXXXXXXX
  if (s.startsWith("+8801") && digits.length === 13) return `+${digits}`;

  // 8801XXXXXXXXX
  if (digits.length === 13 && digits.startsWith("8801")) return `+${digits}`;

  // 01XXXXXXXXX -> +8801XXXXXXXXX
  if (digits.length === 11 && digits.startsWith("01")) return `+880${digits.slice(1)}`;

  // If user typed +88 01XXXXXXXXX -> coerce to +8801XXXXXXXXX
  if (s.startsWith("+88") && digits.length >= 12) {
    // remove any extra leading zero after +88
    const rest = digits.replace(/^88+/, ""); // remove country part
    const cleaned = rest.replace(/^0+/, "");
    if (/^1\d{9}$/.test(cleaned)) return `+880${cleaned}`;
  }

  return "";
}

const fmtSeconds = (s) => {
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
};

function useDebounced(value, delay = 450) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** helper to append query flags to a callback URL without breaking existing params */
function withFlags(url, flagsObj) {
  const qs = new URLSearchParams(flagsObj).toString();
  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Steps: 1 = identifier, 2 = details, 3 = OTP verify
  const [step, setStep] = useState(1);

  // MODE: email vs mobile
  const [mode, setMode] = useState("mobile"); // "mobile" | "email"

  // STEP 1: Email path
  const emailRef = useRef(null);
  const [emailMirror, setEmailMirror] = useState("");

  // STEP 1: Mobile path (separate boxes)
  const [cc, setCc] = useState("+880");
  const [local, setLocal] = useState(""); // what the user types (we auto-trim)
  const debouncedLocal = useDebounced(local, 200);

  const [channel, setChannel] = useState("sms"); // sms | whatsapp | email (email used only for email mode)
  const [userTouchedChannel, setUserTouchedChannel] = useState(false);

  const [existsLoading, setExistsLoading] = useState(false);
  const [accountExists, setAccountExists] = useState(null); // null | true | false

  // STEP 2: Details
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [marriageDay, setMarriageDay] = useState("");
  const [loginPref, setLoginPref] = useState("2fa"); // otp | password | 2fa
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwdVisible, setPwdVisible] = useState(false);
  const [cpwdVisible, setCpwdVisible] = useState(false);

  const [agree, setAgree] = useState(true);

  // STEP 3: OTP
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [expiresIn, setExpiresIn] = useState(0);  // visible timer (80s)
  const [resendCooldown, setResendCooldown] = useState(0); // hidden cooldown (30s)
  const otpRef = useRef(null);

  const [msg, setMsg] = useState(null);
  const [focusId, setFocusId] = useState("");
  const dobRef = useRef(null);
  const marriageRef = useRef(null);
  const openPicker = (ref) => { try { ref?.current?.showPicker?.(); } catch {} };

  const resetOtpState = () => {
    setOtp("");
    setSent(false);
    setExpiresIn(0);
    setResendCooldown(0);
    setMsg(null);
  };

  useEffect(() => { if (sent && step === 3) otpRef.current?.focus(); }, [sent, step]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (expiresIn <= 0) return;
    const t = setInterval(() => setExpiresIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [expiresIn]);

  // Auto-choose "email" mode if the user types an email in the email field
  useEffect(() => {
    if (isEmailish(emailMirror) && mode !== "email") setMode("email");
  }, [emailMirror, mode]);

  // Existence check (debounced)
  useEffect(() => {
    let cancelled = false;
    async function check() {
      setAccountExists(null);

      let identifier = "";
      if (mode === "email") {
        const e = (emailRef.current?.value || emailMirror || "").trim();
        if (!isEmailish(e)) return;
        identifier = e.toLowerCase();
      } else {
        const e164 = e164FromParts(cc, local);
        if (!e164) return;
        identifier = e164;
      }

      try {
        setExistsLoading(true);
        const qs = new URLSearchParams({ identifier }).toString();
        const res = await fetch(`/api/auth/account-exists?${qs}`, { method: "GET" });
        if (!res.ok) throw new Error("exists endpoint unavailable");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (typeof data?.exists === "boolean") setAccountExists(data.exists);
        else setAccountExists(null);
      } catch {
        if (!cancelled) setAccountExists(null);
      } finally {
        if (!cancelled) setExistsLoading(false);
      }
    }
    check();
    return () => { cancelled = true; };
  }, [mode, emailMirror, debouncedLocal, cc]);

  const postRedirect = useMemo(() => {
    const r = searchParams?.get("redirect");
    return r && r.startsWith("/") ? r : "/customer/dashboard";
  }, [searchParams]);

  /* ─────────── API helpers ─────────── */
  async function sendOtpForSignup() {
    // Validate identifier based on mode and build "to"
    let via = channel;
    let to = "";

    if (mode === "email") {
      const e = (emailRef.current?.value || emailMirror || "").trim();
      if (!isEmailish(e)) {
        setMsg({ kind: "error", text: "Enter a valid email address." });
        return false;
      }
      to = e.toLowerCase();
      via = "email";
    } else {
      const e164 = e164FromParts(cc, local);
      if (!e164) {
        setMsg({
          kind: "error",
          text: "Mobile looks incomplete. After +880 enter 10 digits (starts with 1). Example: +880 17XXXXXXXX."
        });
        return false;
      }
      to = e164;
      if (!userTouchedChannel && channel === "email") setChannel("sms"); // safety: default to SMS/WA for phones
      via = channel; // sms or whatsapp
    }

    if (accountExists === true) {
      setMsg({ kind: "error", text: "This email/number is already registered. Please log in or recover your password." });
      return false;
    }

    try {
      setSending(true);
      setOtp("");
      setMsg(null);

      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // STRICT: use `identifier`
        body: JSON.stringify({ identifier: to, channel: via, purpose: "signup", allowNew: true }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const m = data?.error || "Failed to send OTP for signup.";
        setMsg({ kind: "error", text: m });
        return false;
      }

      setSent(true);
      setResendCooldown(30);
      // STRICT: read ttlSeconds
      setExpiresIn(Number(data?.ttlSeconds) || 80);
      setMsg({ kind: "info", text: `We sent a 6-digit code via ${via.toUpperCase()}.` });
      return true;
    } catch {
      setMsg({ kind: "error", text: "Network error. Try again." });
      return false;
    } finally {
      setSending(false);
    }
  }

  async function handleStep1(e) {
    e?.preventDefault();
    setMsg(null);

    if (accountExists === true) {
      setMsg({ kind: "error", text: "This email/number is already registered. Please log in or recover your password." });
      return;
    }

    if (mode === "email") {
      const e = (emailRef.current?.value || emailMirror || "").trim();
      if (!isEmailish(e)) {
        setMsg({ kind: "error", text: "Enter a valid email address." });
        return;
      }
      setStep(2);
      return;
    }

    // mobile mode
    const e164 = e164FromParts(cc, local);
    if (!e164) {
      setMsg({
        kind: "error",
        text: "Mobile looks incomplete. After +880 enter 10 digits (starts with 1). Example: +880 17XXXXXXXX."
      });
      return;
    }
    setStep(2);
  }

  async function handleDetailsContinue(e) {
    e?.preventDefault();
    setMsg(null);

    if (!name.trim()) return setMsg({ kind: "error", text: "Please enter your full name." });
    if (!["Male", "Female", "Other"].includes(gender))
      return setMsg({ kind: "error", text: "Please select gender." });

    const needsPwd = loginPref === "password" || loginPref === "2fa";
    if (needsPwd) {
      if (!password || password.length < 8)
        return setMsg({ kind: "error", text: "Please set a password (min 8 characters)." });
      if (password !== confirm)
        return setMsg({ kind: "error", text: "Passwords do not match." });
    }

    const ok = await sendOtpForSignup();
    if (ok) {
      setOtp("");
      setStep(3);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || sending) return;
    setOtp("");
    await sendOtpForSignup();
  }

  async function handleVerifyAndCreate(e) {
    e?.preventDefault();
    setMsg(null);

    if (!/^\d{6}$/.test(otp)) return setMsg({ kind: "error", text: "Enter the 6-digit OTP." });

    // Build identifier again
    const via = mode === "email" ? "email" : channel;
    const ident = mode === "email"
      ? (emailRef.current?.value || emailMirror || "").trim().toLowerCase()
      : e164FromParts(cc, local);

    try {
      setVerifying(true);

      // 1) Verify OTP (pre-check for TTL/attempts feedback)
      const v = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: ident, channel: via, purpose: "signup", code: otp }),
      });
      const vj = await v.json().catch(() => ({}));
      const verifiedOk = vj?.verified === true || vj?.ok === true;
      if (!v.ok || !verifiedOk) return setMsg({ kind: "error", text: vj?.error || "Verification failed." });

      // 2) 🔐 Mark verified + consume the OTP by signing in via NextAuth (no redirect yet)
      const authRes = await signIn("credentials", {
        redirect: false,
        type: "otp",
        identifier: ident,
        code: otp,
        purpose: "signup",
      });
      if (authRes?.error) {
        return setMsg({ kind: "error", text: authRes.error || "Could not finalize verification." });
      }

      // 3) Complete signup (now the user is verified)
      const c = await fetch("/api/auth/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: vj?.userId, // now provided by verify-otp
          name: name.trim(),
          gender,
          dob: dob || null,
          marriageDay: marriageDay || null,
          phone: mode === "email" ? null : ident,
          email: mode === "email" ? ident : null,
          terms: !!agree,
          loginPreference: loginPref,
          password: loginPref === "password" || loginPref === "2fa" ? password : undefined,
        }),
      });
      const cj = await c.json().catch(() => ({}));
      if (!c.ok) return setMsg({ kind: "error", text: cj?.error || "Could not complete sign up." });

      // 4A) If user chose password/2FA, try password sign-in (kept from your original flow)
      if (loginPref === "password" && password) {
        try {
          const res = await signIn("credentials", {
            redirect: false,
            type: "password",
            identifier: ident,
            password,
          });
          if (res?.ok) {
            // same destination behavior you had
            return router.replace(postRedirect);
          }
        } catch {}
      }

      // 4B) Already signed in via OTP in step 2; just land on the welcome page
      const callbackUrl = withFlags(postRedirect, { welcome: "1", new: "1" });
      return router.replace(callbackUrl);
    } catch {
      setMsg({ kind: "error", text: "Network error. Try again." });
    } finally {
      setVerifying(false);
    }
  }

  /* ────────── Styles ────────── */
  const inputStyle = {
    height: TDLC.FIELD_HEIGHT,
    borderRadius: TDLC.FIELD_RADIUS,
    paddingLeft: TDLC.FIELD_PADDING_X,
    paddingRight: TDLC.FIELD_PADDING_X,
    fontSize: TDLC.FIELD_FONT_SIZE,
    borderWidth: TDLC.FIELD_BORDER_WIDTH,
    borderStyle: "solid",
    borderColor: TDLC.FIELD_BORDER_COLOR,
    background: "rgba(255,255,255,.98)",
    boxShadow: "inset 0 2px 6px rgba(0,0,0,.06)",
    outline: "none",
  };
  const inputFocusStyle = {
    boxShadow: `0 0 0 6px ${TDLC.NAVY}1F`,
    borderColor: TDLC.NAVY,
  };
  const ctaStyle = {
    height: TDLC.CTA_HEIGHT,
    width: `${TDLC.CTA_WIDTH_PERCENT}%`,
    color: TDLC.CTA_TEXT,
    borderRadius: 16,
    fontWeight: 700,
    letterSpacing: ".02em",
    backgroundImage: `linear-gradient(180deg, ${TDLC.NAVY}, ${TDLC.NAVY})`,
    boxShadow: "0 20px 38px -12px rgba(15,33,71,.45)",
    transition: "filter .12s ease, transform .08s ease",
  };
  const containerStyle = { maxWidth: TDLC.CONTAINER_MAX_W, margin: "0 auto" };
  const gapY = { display: "grid", gap: TDLC.STACK_GAP_Y };

  /** Derived UI state for instant feedback in mobile mode */
  const countryCoerced = normalizeCountryCode(cc);
  const localClean = cleanLocal(local);
  const localTooShort = mode === "mobile" && localClean.length > 0 && localClean.length < 10;
  const localTooLong = mode === "mobile" && local.length > 10; // shouldn't happen due slice, but keep UI state
  const localStartsBad = mode === "mobile" && localClean.length > 0 && !localClean.startsWith("1");

  return (
    <main
      className="min-h-[100dvh]"
      style={{
        background:
          "radial-gradient(60% 80% at 50% -20%, rgba(15,33,71,0.10) 0%, rgba(15,33,71,0.05) 45%, #fff 100%)",
      }}
    >
      <section style={{ padding: "72px 24px 120px" }}>
        <div style={containerStyle}>
          {/* Header */}
          <div style={{ marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button
              type="button"
              onClick={() => {
                if (step === 1) router.back();
                else {
                  if (step === 3) resetOtpState();
                  setStep(step - 1);
                }
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, color: "#0b0b0b", opacity: 0.85 }}
            >
              <span aria-hidden>‹</span> Back
            </button>
            <div
              style={{
                borderWidth: 1, borderStyle: "solid", borderColor: "rgba(0,0,0,.1)",
                borderRadius: 999, padding: "6px 12px", fontSize: 12,
                color: "#4b5563", background: "rgba(255,255,255,.7)",
              }}
            >
              TDLC • MEMBERSHIP
            </div>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 6 }}>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.01em", color: "#0b0b0b", margin: 0 }}>
              {step === 1 ? "Enter your email or mobile"
                : step === 2 ? "Create your TDLC account"
                : step === 3 ? "Verify with OTP"
                : "Account created"}
            </h1>

            {step >= 2 && (
              <p style={{ marginTop: 8, fontSize: 14, color: "#4b5563" }}>
                {mode === "email"
                  ? (emailRef.current?.value || emailMirror || "").trim().toLowerCase()
                  : e164FromParts(cc, local) || `${countryCoerced} ${localClean}`}
                <button
                  type="button"
                  onClick={() => { resetOtpState(); setStep(1); }}
                  style={{ textDecoration: "underline", textUnderlineOffset: 3, color: "#0b0b0b", marginLeft: 8 }}>
                  Change
                </button>
              </p>
            )}
          </div>

          {/* STEP 1 */}
          {step === 1 && (
            <form onSubmit={handleStep1} style={{ display: "grid", gap: TDLC.STACK_GAP_Y, marginTop: 24 }}>
              {/* Mode switch */}
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "mobile"}
                    onChange={() => setMode("mobile")}
                  /> Mobile
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "email"}
                    onChange={() => setMode("email")}
                  /> Email
                </label>
              </div>

              {/* MOBILE MODE: separate boxes */}
              {mode === "mobile" && (
                <>
                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                      Mobile number*
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
                      {/* Country code box (locked to +880, but editable to absorb +88, etc.) */}
                      <input
                        aria-label="Country code"
                        value={countryCoerced}
                        onChange={(e) => setCc(e.target.value)}
                        onFocus={() => setFocusId("cc")}
                        onBlur={() => setFocusId("")}
                        style={{
                          ...inputStyle,
                          ...(focusId === "cc" ? inputFocusStyle : null),
                          textAlign: "center",
                          fontWeight: 600,
                          letterSpacing: "0.02em"
                        }}
                      />

                      {/* Local number box */}
                      <input
                        aria-label="Local number (after +880)"
                        placeholder="1XXXXXXXXX"
                        value={local}
                        onChange={(e) => setLocal(cleanLocal(e.target.value))}
                        onFocus={() => setFocusId("local")}
                        onBlur={() => setFocusId("")}
                        inputMode="numeric"
                        pattern="\d*"
                        style={{ ...inputStyle, ...(focusId === "local" ? inputFocusStyle : null) }}
                      />
                    </div>

                    {/* Helper / validation messages */}
                    <div style={{ marginTop: 8, fontSize: 13.5 }}>
                      <span style={{ color: "#4b5563" }}>
                        We’ll send OTP to: <strong>{e164FromParts(cc, local) || `${countryCoerced} ${localClean}`}</strong>
                      </span>
                      {local.startsWith("0") && (
                        <div style={{ color: "#0f2147", marginTop: 6 }}>
                          Tip: removed extra leading 0 — <code>017…</code> becomes <code>17…</code> after <code>+880</code>.
                        </div>
                      )}
                      {localTooShort && (
                        <div style={{ color: "#b91c1c", marginTop: 6 }}>
                          Please enter <strong>10 digits</strong> after <code>+880</code> (e.g., <code>17XXXXXXXX</code>).
                        </div>
                      )}
                      {localTooLong && (
                        <div style={{ color: "#b91c1c", marginTop: 6 }}>
                          Too many digits. Keep it to <strong>10 digits</strong> after <code>+880</code>.
                        </div>
                      )}
                      {localStartsBad && !localTooShort && !localTooLong && (
                        <div style={{ color: "#b45309", marginTop: 6 }}>
                          Bangladesh mobiles after <code>+880</code> start with <strong>1</strong>.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Channel selector for phone */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                      <input type="radio" name="chan" checked={channel === "sms"}
                        onChange={() => { setChannel("sms"); setUserTouchedChannel(true); }} /> SMS
                    </label>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                      <input type="radio" name="chan" checked={channel === "whatsapp"}
                        onChange={() => { setChannel("whatsapp"); setUserTouchedChannel(true); }} /> WhatsApp
                    </label>
                  </div>
                </>
              )}

              {/* EMAIL MODE */}
              {mode === "email" && (
                <div>
                  <label htmlFor="email" style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                    Email address*
                  </label>
                  <input
                    id="email"
                    ref={emailRef}
                    placeholder="you@thednalabstore.com"
                    defaultValue=""
                    autoComplete="username"
                    spellCheck={false}
                    onFocus={() => setFocusId("email")}
                    onBlur={() => setFocusId("")}
                    onInput={(e) => setEmailMirror(e.currentTarget.value)}
                    style={{ ...inputStyle, ...(focusId === "email" ? inputFocusStyle : null) }}
                  />
                </div>
              )}

              {existsLoading && (
                <div style={{ borderRadius: 16, background: "#fafafa", padding: "14px 16px", fontSize: 14, color: "#374151" }}>
                  Checking account…
                </div>
              )}
              {accountExists === true && !existsLoading && (
                <div style={{ borderRadius: 16, background: "#fff7ed", padding: "14px 16px", fontSize: 14, color: "#9a3412" }}>
                  This email/number is already registered.&nbsp;
                  <a href="/login" style={{ fontWeight: 700, textDecoration: "underline" }}>Log in</a>&nbsp;or&nbsp;
                  <a href="/forgot-password" style={{ fontWeight: 700, textDecoration: "underline" }}>recover your password</a>.
                </div>
              )}
              {accountExists === false && !existsLoading && (
                <div style={{ borderRadius: 16, background: "#ecfdf5", padding: "14px 16px", fontSize: 14, color: "#065f46" }}>
                  No account found — perfect. Let’s create one for you.
                </div>
              )}

              <div style={{ marginTop: TDLC.GAP_FIELD_TO_CTA }}>
                <button
                  type="submit"
                  disabled={
                    existsLoading ||
                    (mode === "email" ? !emailMirror.trim() : cleanLocal(local).length === 0)
                  }
                  style={{
                    ...ctaStyle,
                    display: "grid", placeItems: "center", textAlign: "center", margin: "0 auto",
                    opacity:
                      existsLoading ||
                      (mode === "email" ? !emailMirror.trim() : cleanLocal(local).length === 0)
                        ? 0.6 : 1,
                    cursor:
                      existsLoading ||
                      (mode === "email" ? !emailMirror.trim() : cleanLocal(local).length === 0)
                        ? "not-allowed" : "pointer",
                  }}
                  onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.985)")}
                  onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                  onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; e.currentTarget.style.transform = "scale(1)"; }}
                >
                  Continue
                </button>
              </div>

              {msg && (
                <div
                  style={{
                    borderRadius: 16, padding: "14px 16px", fontSize: 14,
                    background: msg.kind === "error" ? "#fef2f2" : msg.kind === "success" ? "#ecfdf5" : "#fafafa",
                    color: msg.kind === "error" ? "#b91c1c" : msg.kind === "success" ? "#065f46" : "#111827",
                  }}
                >
                  {msg.text}
                </div>
              )}
            </form>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <form onSubmit={handleDetailsContinue} style={{ display: "grid", gap: TDLC.STACK_GAP_Y, marginTop: 28 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>Full Name*</label>
                <input
                  style={{ ...inputStyle, ...(focusId === "name" ? inputFocusStyle : null) }}
                  value={name}
                  onFocus={() => setFocusId("name")}
                  onBlur={() => setFocusId("")}
                  onChange={(e) => setName(e.currentTarget.value)}
                  autoComplete="name"
                  spellCheck={false}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>Gender*</label>
                <select
                  style={{ ...inputStyle, ...(focusId === "gender" ? inputFocusStyle : null) }}
                  value={gender}
                  onFocus={() => setFocusId("gender")}
                  onBlur={() => setFocusId("")}
                  onChange={(e) => setGender(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </div>

              <Picker label="Date of Birth (optional)" value={dob} setValue={setDob} inputStyle={inputStyle} refObj={dobRef} />
              <Picker label="Marriage Day (optional)" value={marriageDay} setValue={setMarriageDay} inputStyle={inputStyle} refObj={marriageRef} />

              <div
                style={{
                  borderWidth: 1, borderStyle: "solid", borderColor: "rgba(0,0,0,.08)",
                  borderRadius: 18, padding: "18px 18px 12px",
                  background: "#ffffff", boxShadow: "0 10px 26px rgba(15,33,71,.06)",
                }}
              >
                <div style={{ fontWeight: 800, color: "#0b0b0b", marginBottom: 10, fontSize: 16 }}>
                  Choose how you want to log in
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 15 }}>
                  <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input type="radio" name="loginPref" value="otp"
                      checked={loginPref === "otp"} onChange={() => setLoginPref("otp")} />
                    Only OTP (no password)
                  </label>
                  <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input type="radio" name="loginPref" value="password"
                      checked={loginPref === "password"} onChange={() => setLoginPref("password")} />
                    Only Password
                  </label>
                  <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <input type="radio" name="loginPref" value="2fa"
                      checked={loginPref === "2fa"} onChange={() => setLoginPref("2fa")} />
                    OTP + Password (recommended)
                  </label>
                </div>
                <p style={{ marginTop: 8, fontSize: 13.5, color: "#4b5563" }}>
                  You can change this later from Account &gt; Security.
                </p>
              </div>

              {(loginPref === "password" || loginPref === "2fa") && (
                <>
                  <PasswordField
                    label="Set Password (min 8)*"
                    value={password}
                    onChange={setPassword}
                    visible={pwdVisible}
                    setVisible={setPwdVisible}
                    inputStyle={inputStyle}
                    focusId={focusId}
                    setFocusId={setFocusId}
                    focusKey="pwd"
                  />
                  <PasswordField
                    label="Retype Password*"
                    value={confirm}
                    onChange={setConfirm}
                    visible={cpwdVisible}
                    setVisible={setCpwdVisible}
                    inputStyle={inputStyle}
                    focusId={focusId}
                    setFocusId={setFocusId}
                    focusKey="cpwd"
                  />
                </>
              )}

              <label style={{ display: "inline-flex", alignItems: "start", gap: 14, fontSize: 14 }}>
                <span
                  style={{
                    width: 24, height: 24, borderRadius: 6,
                    borderWidth: 1.5, borderStyle: "solid", borderColor: "rgba(0,0,0,.2)",
                    background: agree ? "#2563eb22" : "#fff",
                    boxShadow: agree ? "inset 0 0 0 12px #2563eb, 0 6px 14px rgba(15,33,71,.12)" : "0 6px 14px rgba(15,33,71,.08)",
                    display: "grid", placeItems: "center", cursor: "pointer",
                  }}
                  onClick={() => setAgree((v) => !v)} role="checkbox" aria-checked={agree}
                />
                <span>
                  By creating an account, you agree to TDLC’s{" "}
                  <a href="/terms" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Terms & Conditions</a>{" "}
                  and{" "}
                  <a href="/privacy" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>Privacy Policy</a>.
                </span>
              </label>

              <button
                type="submit"
                disabled={sending}
                style={{
                  ...ctaStyle, display: "grid", placeItems: "center", textAlign: "center", margin: "0 auto",
                  opacity: sending ? 0.6 : 1, cursor: sending ? "not-allowed" : "pointer",
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.985)")}
                onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
                onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; e.currentTarget.style.transform = "scale(1)"; }}
              >
                {sending ? "Sending code…" : "Continue"}
              </button>

              {msg && (
                <div
                  style={{
                    borderRadius: 16, padding: "14px 16px", fontSize: 14,
                    background: msg.kind === "error" ? "#fef2f2" : msg.kind === "success" ? "#ecfdf5" : "#fafafa",
                    color: msg.kind === "error" ? "#b91c1c" : msg.kind === "success" ? "#065f46" : "#111827",
                  }}
                >
                  {msg.text}
                </div>
              )}
            </form>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <form onSubmit={handleVerifyAndCreate} style={{ display: "grid", gap: TDLC.STACK_GAP_Y, marginTop: 28 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                  Enter 6-digit OTP*
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <input
                    ref={otpRef}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="______"
                    value={otp}
                    onChange={(e) => setOtp(e.currentTarget.value.replace(/[^\d]/g, "").slice(0, 6))}
                    required
                    aria-invalid={!/^\d{6}$/.test(otp)}
                    autoComplete="one-time-code"
                    spellCheck={false}
                    style={{ ...inputStyle, textAlign: "center", letterSpacing: "0.6em" }}
                  />

                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={sending || resendCooldown > 0}
                    style={{
                      fontSize: 14,
                      textDecoration: "underline",
                      textUnderlineOffset: 3,
                      color: "#0b0b0b",
                      opacity: sending || resendCooldown > 0 ? 0.5 : 1,
                    }}
                  >
                    Resend code
                  </button>

                  {expiresIn > 0 && (
                    <span style={{ fontSize: 13.5, color: "#4b5563" }}>
                      Code expires in <strong>{fmtSeconds(expiresIn)}</strong>
                    </span>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={verifying}
                style={{
                  ...ctaStyle, display: "grid", placeItems: "center", textAlign: "center", margin: "0 auto",
                  opacity: verifying ? 0.6 : 1, cursor: verifying ? "not-allowed" : "pointer",
                }}
                onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.985)")}
                onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
                onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; e.currentTarget.style.transform = "scale(1)"; }}
              >
                {verifying ? "Verifying…" : "CREATE ACCOUNT"}
              </button>

              {msg && (
                <div
                  style={{
                    borderRadius: 16, padding: "14px 16px", fontSize: 14,
                    background: msg.kind === "error" ? "#fef2f2" : msg.kind === "success" ? "#ecfdf5" : "#fafafa",
                    color: msg.kind === "error" ? "#b91c1c" : msg.kind === "success" ? "#065f46" : "#111827",
                  }}
                >
                  {msg.text}
                </div>
              )}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

/* ===== Helpers kept inline for drop-in ===== */
function Picker({ label, value, setValue, inputStyle, refObj }) {
  return (
    <div>
      <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>{label}</label>
      <div style={{ position: "relative", display: "inline-block" }}>
        <input
          ref={refObj}
          type="date"
          style={{ ...inputStyle, width: 280, paddingRight: 48 }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button" aria-label="Open calendar" onClick={() => { try { refObj?.current?.showPicker?.(); } catch {} }}
          style={{
            position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
            width: 32, height: 32, borderRadius: 10,
            borderWidth: 1, borderStyle: "solid", borderColor: "rgba(0,0,0,.12)",
            background: "#fff", boxShadow: "0 6px 12px rgba(15,33,71,.08)", display: "grid", placeItems: "center",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="5" width="18" height="16" rx="3" stroke="#516086" />
            <path d="M3 9h18" stroke="#516086" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, visible, setVisible, inputStyle, focusId, setFocusId, focusKey }) {
  return (
    <div style={{ position: "relative" }}>
      <label style={{ display: "block", marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
        {label}
      </label>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={{ ...inputStyle, ...(focusId === focusKey ? { boxShadow: `0 0 0 6px #0f21471F`, borderColor: "#0f2147" } : null), paddingRight: 54 }}
        onFocus={() => setFocusId(focusKey)}
        onBlur={() => setFocusId("")}
        minLength={8}
        required
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((v) => !v)}
        style={{
          position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
          width: 36, height: 36, borderRadius: 10,
          borderWidth: 1, borderStyle: "solid", borderColor: "rgba(0,0,0,.12)",
          background: "#fff", boxShadow: "0 6px 12px rgba(15,33,71,.08)", display: "grid", placeItems: "center",
          cursor: "pointer",
        }}
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 3l18 18" stroke="#516086" strokeWidth="2" />
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="#516086" />
            <circle cx="12" cy="12" r="3" stroke="#516086" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="#516086" />
            <circle cx="12" cy="12" r="3" stroke="#516086" />
          </svg>
        )}
      </button>
    </div>
  );
}
