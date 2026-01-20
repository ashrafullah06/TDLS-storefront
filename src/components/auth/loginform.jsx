// FILE: src/components/auth/loginform.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { signIn, useSession, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { parsePhoneNumberFromString } from "libphonenumber-js";

/* ===========================
   THEME TOKENS (kept + extended)
   =========================== */
const NAVY = "#0f2147";
const NAVY_2 = "#0B1938";
const NAVY_FADE = "#516086";
const PEARL = "#FAFBFF";
const BORDER = "#E6EAF4";
const BORDER_DARK = "rgba(15,33,71,0.16)";
const ACCENT = "#C7A135";
const SUBTEXT = "#6F7890";

const OK = "#166534";
const OK_BG = "rgba(22,101,52,0.08)";
const WARN = "#92400E";
const WARN_BG = "rgba(146,64,14,0.08)";
const ERR = "#9F1D20";
const ERR_BG = "rgba(159,29,32,0.07)";

/* ===========================
   AUTH MODES / OPTIONS (kept)
   =========================== */
const MODE_OTP = "otp";
const MODE_PASSWORD = "password";
const MODE_2FA = "2fa";

/* ===========================
   HELPERS (kept + improved)
   =========================== */
const isPhoneish = (v) => /^\+?\d[\d\s\-()]*$/.test(String(v || "").trim());
const isEmailish = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

/**
 * Normalize Bangladeshi mobile numbers into E.164:
 * Accepts (examples):
 * - 017XXXXXXXXX
 * - +8801XXXXXXXXX
 * - 8801XXXXXXXXX
 * - 008801XXXXXXXXX
 * - 08801XXXXXXXXX
 * - 0880XXXXXXXXXXX (extra trunk 0 before 880)
 *
 * Returns:
 * - +8801XXXXXXXXX (for BD mobiles) when possible; otherwise best-effort cleaned value.
 *
 * NOTE: This does NOT change auth business logic; it only normalizes the identifier string.
 */
const normalizeBdMobileToE164 = (raw) => {
  const s0 = String(raw || "").trim();
  if (!s0) return "";

  const cleaned = s0.replace(/[^\d+]/g, "");
  const digitsOnly = cleaned.replace(/[^\d]/g, "");

  // Already E.164
  if (cleaned.startsWith("+")) return cleaned;

  // 00 prefix -> +
  if (digitsOnly.startsWith("00")) return `+${digitsOnly.slice(2)}`;

  // Some users prepend an extra '0' before 880 (e.g., 0880...)
  if (digitsOnly.startsWith("0880")) return `+${digitsOnly.slice(1)}`; // drop first 0 => +880...

  // Has country code without '+'
  if (digitsOnly.startsWith("880")) return `+${digitsOnly}`;

  // Local BD mobile (11 digits starting 01)
  if (digitsOnly.startsWith("01") && digitsOnly.length === 11) return `+88${digitsOnly}`;

  // Fallback: try libphonenumber with BD default
  try {
    const p = parsePhoneNumberFromString(s0, "BD");
    if (p?.isValid()) return p.number;
  } catch {}

  // Best-effort fallback: if it's long enough digits, prefix +
  return digitsOnly.length >= 8 ? `+${digitsOnly}` : cleaned;
};

const toE164 = (raw) => {
  try {
    const s = String(raw || "").trim();
    if (!s) return s;

    const t = s.replace(/[^\d+]/g, "");
    const d = t.replace(/[^\d]/g, "");

    // BD-like detection (so desktop + mobile both accept BD formats)
    const maybeBd =
      d.startsWith("01") ||
      d.startsWith("880") ||
      d.startsWith("00880") ||
      d.startsWith("0880") ||
      t.startsWith("+880");

    if (maybeBd) return normalizeBdMobileToE164(s);

    // Otherwise preserve prior behavior.
    const p = parsePhoneNumberFromString(s);
    return p?.isValid()
      ? p.number
      : s?.startsWith("+")
      ? s.replace(/[^\d+]/g, "")
      : s;
  } catch {
    return raw;
  }
};

const bdLike = (e164) => /^\+8801\d{9}$/.test(e164 || "");

function track(event, payload = {}) {
  try {
    if (typeof window !== "undefined") {
      if (window.gtag) window.gtag("event", event, payload);
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event, ...payload });
      if (window.posthog?.capture) window.posthog.capture(event, payload);
    }
  } catch {}
}

/* ===========================
   AUTO WIDTH HELPERS (kept)
   =========================== */
function useAutoChWidth(value, minCh = 26, pad = 6, maxCh = 56) {
  const [w, setW] = useState(`${minCh}ch`);
  useEffect(() => {
    const len = String(value || "").length;
    const calc = Math.max(minCh, Math.min(maxCh, len + pad));
    setW(`${calc}ch`);
  }, [value, minCh, pad, maxCh]);
  return w;
}

/* ===========================
   SMALL UI ATOMS (kept)
   =========================== */
function IconShield({ size = 18, color = NAVY_FADE }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l8 4v6c0 5-3.4 9.4-8 10-4.6-.6-8-5-8-10V6l8-4Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-5"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMail({ size = 18, color = NAVY_FADE }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16v12H4V6Z" stroke={color} strokeWidth="1.6" />
      <path d="M4 8l8 6 8-6" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function IconPhone({ size = 18, color = NAVY_FADE }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3h4l1 5-3 2c1.2 2.6 3.4 4.8 6 6l2-3 5 1v4c0 1.1-.9 2-2 2C10.8 20 4 13.2 4 5c0-1.1.9-2 2-2Z"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner({ size = 16, color = "rgba(255,255,255,0.9)" }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        animation: "tdlcSpin 0.8s linear infinite",
      }}
    />
  );
}

function StatusPill({ kind, children }) {
  const map = {
    ok: { bg: OK_BG, fg: OK, bd: "rgba(22,101,52,0.25)" },
    warn: { bg: WARN_BG, fg: WARN, bd: "rgba(146,64,14,0.25)" },
    error: { bg: ERR_BG, fg: ERR, bd: "rgba(159,29,32,0.22)" },
    info: { bg: "rgba(15,33,71,0.06)", fg: NAVY, bd: BORDER_DARK },
  };
  const s = map[kind] || map.info;

  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      style={{
        borderRadius: 999,
        border: `1px solid ${s.bd}`,
        background: s.bg,
        color: s.fg,
        padding: "10px 14px",
        fontSize: 13,
        fontWeight: 800,
        lineHeight: 1.35,
        boxShadow: "0 10px 24px rgba(15,33,71,0.06)",
        maxWidth: "100%",
      }}
    >
      {children}
    </div>
  );
}

function SegButton({ active, disabled, children, onClick, small = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        border: "1px solid",
        borderColor: active ? "rgba(199,161,53,0.55)" : BORDER,
        background: active
          ? "linear-gradient(180deg, rgba(199,161,53,0.18) 0%, rgba(199,161,53,0.10) 100%)"
          : "rgba(255,255,255,0.98)",
        color: active ? NAVY : NAVY_FADE,
        padding: small ? "9px 10px" : "10px 12px",
        borderRadius: 999,
        fontSize: small ? 11.8 : 12.5,
        fontWeight: 900,
        letterSpacing: "0.06em",
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: active ? "0 14px 34px rgba(15,33,71,0.10)" : "0 10px 22px rgba(15,33,71,0.06)",
        transition: "transform .12s ease, box-shadow .12s ease, border-color .12s ease",
        transform: active ? "translateY(-1px)" : "translateY(0)",
        opacity: disabled ? 0.7 : 1,
        // Mobile overflow fixes:
        maxWidth: "100%",
        whiteSpace: small ? "normal" : "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        lineHeight: small ? 1.15 : 1.2,
        textAlign: "center",
      }}
    >
      {children}
    </button>
  );
}

/* ===========================
   IMPORTANT: AUTH GATE (additive)
   =========================== */
async function assertSessionAuthedOrThrow({ wrongPasswordMessage = "Password incorrect." } = {}) {
  await new Promise((r) => setTimeout(r, 40));
  const s = await getSession().catch(() => null);
  if (!s?.user) throw new Error(wrongPasswordMessage);
  return s;
}

/* ===========================
   IMPORTANT: 2FA PENDING FLAG (additive; fixes redirect race)
   - Prevents redirect to dashboard after password success but before OTP verification.
   - Stored in sessionStorage so it survives back nav / quick rerenders.
   =========================== */
const SS_PENDING_2FA_KEY = "tdls:login:pending2fa:v1";

function readPending2fa() {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(SS_PENDING_2FA_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    // Optional TTL safety (15 minutes)
    const ts = Number(j.ts || 0);
    if (ts && Date.now() - ts > 15 * 60 * 1000) {
      window.sessionStorage.removeItem(SS_PENDING_2FA_KEY);
      return null;
    }
    return j;
  } catch {
    return null;
  }
}

function writePending2fa(payload) {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(SS_PENDING_2FA_KEY, JSON.stringify(payload || { ts: Date.now() }));
  } catch {}
}

function clearPending2fa() {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(SS_PENDING_2FA_KEY);
  } catch {}
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  /* ===========================
     MOBILE/SMALL SCREEN STATE (additive; desktop layout preserved)
     =========================== */
  const [isSmall, setIsSmall] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 980px)");
    const apply = () => setIsSmall(Boolean(mq.matches));
    apply();
    if (mq.addEventListener) mq.addEventListener("change", apply);
    else mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", apply);
      else mq.removeListener(apply);
    };
  }, []);

  /* ===========================
     STATE (kept)
     =========================== */
  const [mode, setMode] = useState(
    () => (typeof window !== "undefined" && localStorage.getItem("login_mode")) || MODE_2FA
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // WhatsApp deactivated: default to SMS and never auto-select WhatsApp.
  const [channel, setChannel] = useState("sms");

  const [rememberDevice, setRememberDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErr, setFieldErr] = useState({ id: "", password: "" });
  const [risk, setRisk] = useState({ level: "low", newDevice: false, newIp: false });
  const [userTouchedChannel, setUserTouchedChannel] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [caps, setCaps] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // WhatsApp selection warning (UI-only; does not change auth logic)
  const [channelWarn, setChannelWarn] = useState("");

  /* ===========================
     2FA PENDING STATE (additive; fixes dashboard-before-otp)
     =========================== */
  const pending2faRef = useRef(false);
  const [pending2fa, setPending2fa] = useState(false);

  // Hydrate pending2fa from sessionStorage once
  useEffect(() => {
    const j = readPending2fa();
    if (j?.pending === true) {
      pending2faRef.current = true;
      setPending2fa(true);
    }
  }, []);

  // Keep ref in sync for immediate checks (no render wait)
  useEffect(() => {
    pending2faRef.current = Boolean(pending2fa);
  }, [pending2fa]);

  // If user switches away from 2FA mode or starts other flows, clear pending flag.
  useEffect(() => {
    if (mode !== MODE_2FA && pending2faRef.current) {
      pending2faRef.current = false;
      setPending2fa(false);
      clearPending2fa();
    }
  }, [mode]);

  // If the user becomes unauthenticated (logout / session cleared), pending 2FA should not linger.
  useEffect(() => {
    if (status === "unauthenticated" && pending2faRef.current) {
      pending2faRef.current = false;
      setPending2fa(false);
      clearPending2fa();
    }
  }, [status]);

  /* ===========================
     DIMENSIONS (kept)
     =========================== */
  const PAGE_MAX_WIDTH = 1180;
  const CARD_MAX = 980;

  const idWidth = useAutoChWidth(identifier, 26, 6, 56);

  // Increase usable password input width on desktop + reduce "blank veil" area before Show/Hide.
  const pwdWidth = useAutoChWidth(password, 30, 8, 64);

  const needsPassword = mode === MODE_PASSWORD || mode === MODE_2FA;
  const involvesOtp = mode === MODE_OTP || mode === MODE_2FA;

  /* ===========================
     IDENTIFIER INPUT KEYBOARD FIX (additive, UI-only)
     - Prevents mobile from defaulting to numeric keypad before email becomes fully "valid".
     =========================== */
  const { idInputType, idInputMode } = useMemo(() => {
    const t = String(identifier || "").trim();

    // Empty/unknown: allow full keyboard so email entry is always possible.
    if (!t) return { idInputType: "text", idInputMode: "text" };

    // If user has typed any letters or '@', prioritize email keyboard immediately.
    const hasAlpha = /[a-zA-Z]/.test(t);
    const hasAt = t.includes("@");
    if (hasAlpha || hasAt) return { idInputType: "email", idInputMode: "email" };

    // Otherwise, if it is phone-like, prefer tel keypad.
    if (isPhoneish(t) && !isEmailish(t)) return { idInputType: "tel", idInputMode: "tel" };

    return { idInputType: "text", idInputMode: "text" };
  }, [identifier]);

  /* ===========================
     REDIRECTS (kept)
     =========================== */
  const redirectTo = useMemo(() => {
    const dest = searchParams?.get("redirect") || "/customer/dashboard";
    const finalDest = searchParams?.get("checkout") ? "/checkout" : String(dest);
    return finalDest.startsWith("/") ? finalDest : "/customer/dashboard";
  }, [searchParams]);

  const signupHref = useMemo(() => {
    const q = identifier ? `?prefill=${encodeURIComponent(identifier)}` : "";
    return (searchParams?.get("checkout") ? "/signup?from=checkout" : "/signup") + q;
  }, [searchParams, identifier]);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("login_mode", mode);
  }, [mode]);

  /* ===========================
     Already authed? redirect (FIXED: 2FA pending must pass OTP first)
     =========================== */
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (redirectedRef.current) return;

    // Default legacy behavior: allow redirect unless explicitly blocked by server flag
    let twoFactorOk = session?.twoFactorPassed !== false;

    // IMPORTANT FIX:
    // If we are in a 2FA-in-progress state (password already accepted, OTP not verified yet),
    // do NOT allow redirect unless OTP has been verified.
    if (pending2faRef.current || pending2fa) {
      twoFactorOk = session?.twoFactorPassed === true;
    }

    if (status === "authenticated" && session?.user && twoFactorOk) {
      redirectedRef.current = true;

      // If OTP has now been verified, clear pending state
      if (pending2faRef.current) {
        pending2faRef.current = false;
        setPending2fa(false);
        clearPending2fa();
      }

      router.replace(redirectTo);
    }
  }, [status, session, router, redirectTo, pending2fa]);

  /* ===========================
     RISK PROBE (kept)
     =========================== */
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const r = await fetch("/api/auth/risk", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (!on) return;
        setRisk(data);
        if (data.level === "high") setMode(MODE_2FA);
      } catch {}
    })();
    return () => {
      on = false;
    };
  }, []);

  /* ===========================
     CHANNEL ENFORCEMENT (WhatsApp disabled)
     =========================== */
  useEffect(() => {
    // If anything tries to set WhatsApp, force SMS and show a warning.
    if (channel === "whatsapp") {
      setChannel("sms");
      setUserTouchedChannel(true);
      setChannelWarn("WhatsApp wiring under processing — try SMS.");
      track("otp_channel_blocked_whatsapp", { surface: "loginform" });
    }
  }, [channel]);

  useEffect(() => {
    if (!channelWarn) return;
    const t = setTimeout(() => setChannelWarn(""), 4200);
    return () => clearTimeout(t);
  }, [channelWarn]);

  /* ===========================
     CHANNEL AUTOPICK (kept; WhatsApp removed)
     =========================== */
  useEffect(() => {
    if (isEmailish(identifier)) {
      if (channel !== "email") setChannel("email");
      return;
    }
    const e164 = toE164(identifier);

    if (isPhoneish(identifier) && !isEmailish(identifier)) {
      // Never auto-select WhatsApp; keep SMS (unless user previously chose email, then correct back).
      if (!userTouchedChannel) {
        if (channel === "email") setChannel("sms");
        else setChannel("sms");
      } else {
        // If user has touched channel and picked something invalid for phone, normalize back to SMS
        if (channel === "email") setChannel("sms");
      }

      // Optional: for BD numbers, keep SMS explicitly (no WhatsApp)
      if (bdLike(e164) && channel !== "sms") setChannel("sms");
    }
  }, [identifier, channel, userTouchedChannel]);

  /* ===========================
     VALIDATIONS (kept; BD formats accepted everywhere)
     =========================== */
  const validEmail = useMemo(() => isEmailish(identifier.trim()), [identifier]);

  const normalizedPhone = useMemo(() => {
    const v = String(identifier || "").trim();
    if (!isPhoneish(v)) return "";
    return toE164(v);
  }, [identifier]);

  const validPhone = useMemo(() => {
    const v = String(identifier || "").trim();
    if (!isPhoneish(v)) return false;
    const e164 = normalizedPhone;
    return /^\+\d{8,}$/.test(e164 || "");
  }, [identifier, normalizedPhone]);

  const idValid = validEmail || validPhone;

  const identifierKind = useMemo(() => {
    if (!identifier?.trim()) return "";
    if (validEmail) return "email";
    if (validPhone) return "phone";
    return "invalid";
  }, [identifier, validEmail, validPhone]);

  const effectiveOtpChannel = useMemo(() => {
    if (!involvesOtp) return "";
    if (validEmail) return "email";
    if (!validPhone) return "";
    // WhatsApp disabled: always SMS for phone OTP from this screen.
    return "sms";
  }, [involvesOtp, validEmail, validPhone]);

  /* ===========================
     API HELPERS (kept)
     =========================== */
  async function requestOtp(to, via) {
    const r = await fetch("/api/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: to,
        channel: via,
        purpose: "login",
        rememberDevice,
      }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const e = j?.error || "OTP send failed";
      throw new Error(e);
    }
  }

  async function requestOtpWithFallback(to) {
    let preferredVia = channel;

    if (isEmailish(to)) {
      preferredVia = "email";
    } else if (!isPhoneish(to)) {
      throw new Error("Enter a valid email or mobile number.");
    } else {
      // Phone: WhatsApp is disabled; always use SMS from this UI.
      preferredVia = "sms";
    }

    try {
      await requestOtp(to, preferredVia);
      track("otp_sent", { channel: preferredVia, to_hint: (to || "").slice(0, 6) + "…" });
      return preferredVia;
    } catch (e) {
      // Keep prior fallback behavior for robustness (though WhatsApp is never selected here)
      if (preferredVia === "whatsapp" && isPhoneish(to)) {
        await requestOtp(to, "sms");
        setChannel("sms");
        setChannelWarn("WhatsApp wiring under processing — try SMS.");
        track("otp_sent", { channel: "sms_fallback", to_hint: (to || "").slice(0, 6) + "…" });
        return "sms";
      }
      throw e;
    }
  }

  /* ===========================
     FLOWS (kept; BD normalization included)
     =========================== */
  async function startOtpLayer() {
    // Starting OTP-only flow must not inherit pending 2FA state
    if (pending2faRef.current) {
      pending2faRef.current = false;
      setPending2fa(false);
      clearPending2fa();
    }

    setErr("");
    setFieldErr({ id: "", password: "" });

    const raw = String(identifier || "").trim();
    const id = isPhoneish(raw) ? toE164(raw) : raw;

    if (!id) {
      setFieldErr((p) => ({ ...p, id: "Enter email or mobile first." }));
      return;
    }

    setLoading(true);
    try {
      const via = await requestOtpWithFallback(id);
      const q = new URLSearchParams({
        to: id,
        via,
        redirect: redirectTo,
        checkout: searchParams?.get("checkout") ? "1" : "",
        remember: rememberDevice ? "1" : "",
      }).toString();
      router.push(`/login/otp?${q}`);
    } catch (e) {
      const msg = e?.message || "Unable to send code.";
      if (msg.includes("ACCOUNT_NOT_FOUND") || msg.includes("USER_NOT_FOUND")) {
        setErr("No account found with this email/number. Please sign up to continue.");
      } else {
        setErr(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function passwordLogin() {
    // Password-only flow must not inherit pending 2FA state
    if (pending2faRef.current) {
      pending2faRef.current = false;
      setPending2fa(false);
      clearPending2fa();
    }

    setErr("");
    setFieldErr({ id: "", password: "" });

    const raw = String(identifier || "").trim();
    const id = isPhoneish(raw) ? toE164(raw) : raw;

    if (!id) {
      setFieldErr((p) => ({ ...p, id: "Enter email or mobile first." }));
      return;
    }
    if (!password) {
      setFieldErr((p) => ({ ...p, password: "Enter your password." }));
      return;
    }

    setLoading(true);
    try {
      const res = await signIn("credentials", {
        redirect: false,
        type: "password",
        identifier: id,
        password,
        rememberDevice,
      });

      if (res && typeof res === "object" && res.error) throw new Error(res.error);

      await assertSessionAuthedOrThrow({ wrongPasswordMessage: "Password incorrect." });

      router.replace(redirectTo);
    } catch (e) {
      const msg = e?.message || "Sign in failed.";
      if (msg.includes("CredentialsSignin")) setErr("Password incorrect.");
      else if (msg.includes("ACCOUNT_NOT_FOUND") || msg.includes("USER_NOT_FOUND"))
        setErr("No account found with this email/number. Please sign up to continue.");
      else setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  async function start2fa() {
    setErr("");
    setFieldErr({ id: "", password: "" });

    const raw = String(identifier || "").trim();
    const id = isPhoneish(raw) ? toE164(raw) : raw;

    if (!id) {
      setFieldErr((p) => ({ ...p, id: "Enter email or mobile first." }));
      return;
    }
    if (!password) {
      setFieldErr((p) => ({ ...p, password: "Enter your password." }));
      return;
    }

    setLoading(true);

    // IMPORTANT FIX: mark 2FA as pending immediately to prevent the auth redirect effect
    // from routing to dashboard right after password sign-in.
    pending2faRef.current = true;
    setPending2fa(true);
    writePending2fa({ pending: true, to: id, ts: Date.now() });

    try {
      const res = await signIn("credentials", {
        redirect: false,
        type: "password",
        identifier: id,
        password,
        rememberDevice,
      });

      if (res && typeof res === "object" && res.error) throw new Error(res.error);

      await assertSessionAuthedOrThrow({ wrongPasswordMessage: "Password incorrect." });

      const via = await requestOtpWithFallback(id);
      const q = new URLSearchParams({
        to: id,
        via,
        mode: "2fa",
        redirect: redirectTo,
        checkout: searchParams?.get("checkout") ? "1" : "",
        remember: rememberDevice ? "1" : "",
      }).toString();
      router.push(`/login/otp?${q}`);
    } catch (e) {
      // If password check fails or OTP request fails, do not keep pending state.
      pending2faRef.current = false;
      setPending2fa(false);
      clearPending2fa();

      const msg = e?.message || "Unable to start verification.";
      if (msg.includes("CredentialsSignin")) setErr("Password incorrect.");
      else if (msg.includes("ACCOUNT_NOT_FOUND") || msg.includes("USER_NOT_FOUND"))
        setErr("No account found with this email/number. Please sign up to continue.");
      else setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  async function socialSignIn(provider) {
    if (loading) return;
    setErr("");
    setFieldErr({ id: "", password: "" });

    // Social sign-in should not inherit pending 2FA state from previous attempts
    if (pending2faRef.current) {
      pending2faRef.current = false;
      setPending2fa(false);
      clearPending2fa();
    }

    setLoading(true);
    try {
      track("social_signin_start", { provider });
      const res = await signIn(provider, { callbackUrl: redirectTo, redirect: true });
      if (res && typeof res === "object" && res.error) throw new Error(res.error);
    } catch (e) {
      const msg = e?.message || `Unable to sign in with ${provider}.`;
      setErr(msg);
      setLoading(false);
      track("social_signin_failed", { provider, err: String(msg).slice(0, 120) });
    }
  }

  const onPrimary = () => {
    if (loading) return;
    if (mode === MODE_OTP) return startOtpLayer();
    if (mode === MODE_PASSWORD) return passwordLogin();
    return start2fa();
  };

  const onEnterKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onPrimary();
    }
  };

  /* ===========================
     STYLES (kept; mobile fixes are additive)
     =========================== */
  const pageStyle = {
    background: `
      radial-gradient(1200px 420px at 50% -10%, rgba(199,161,53,0.16) 0%, rgba(199,161,53,0) 60%),
      radial-gradient(900px 400px at 10% 30%, rgba(15,33,71,0.10) 0%, rgba(15,33,71,0) 55%),
      linear-gradient(180deg, ${PEARL} 0%, #ffffff 100%)
    `,
  };

  const cardShell = {
    borderRadius: isSmall ? 22 : 28,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.92)",
    boxShadow: "0 30px 100px rgba(15,33,71,0.18)",
    overflow: "hidden",
    backdropFilter: "blur(8px)",
  };

  const panelLeft = {
    background: `linear-gradient(180deg, rgba(15,33,71,0.96) 0%, rgba(11,25,56,0.98) 100%)`,
    color: "#fff",
    padding: isSmall ? "18px 16px" : "28px 26px",
    position: "relative",
  };

  const panelRight = {
    padding: isSmall ? "18px 16px" : "28px 26px",
    minWidth: 0,
  };

  const labelStyle = {
    color: NAVY,
    fontWeight: 900,
    fontSize: isSmall ? 11.2 : 12,
    letterSpacing: ".18em",
    textTransform: "uppercase",
    marginBottom: 8,
  };

  const fieldWrap = (hasErr) => ({
    borderRadius: isSmall ? 16 : 18,
    border: `1px solid ${hasErr ? "rgba(159,29,32,0.28)" : BORDER}`,
    background: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(246,248,255,1) 100%)",
    padding: isSmall ? 6 : 8,
    boxShadow: hasErr
      ? "inset 0 10px 24px rgba(159,29,32,0.08), 0 16px 40px rgba(15,33,71,0.08)"
      : "inset 0 10px 24px rgba(15,33,71,0.08), 0 16px 40px rgba(15,33,71,0.08)",
    transition: "box-shadow .16s ease, border-color .16s ease, transform .16s ease",
    minWidth: 0,
  });

  const inputBase = {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: NAVY,
    fontSize: isSmall ? 14 : 15,
    fontWeight: 850,
    padding: isSmall ? "11px 12px" : "12px 12px",
    borderRadius: 14,
    minHeight: isSmall ? 44 : undefined,
    display: "block",
    minWidth: 0,
    WebkitTextSizeAdjust: "100%",
  };

  const subtle = { color: SUBTEXT, fontSize: isSmall ? 12.9 : 13.5, lineHeight: 1.6 };

  const primaryBtn = (disabled) => ({
    width: "100%",
    height: isSmall ? 52 : 58,
    borderRadius: 999,
    border: `1px solid ${disabled ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.28)"}`,
    background: disabled
      ? "linear-gradient(180deg, rgba(15,33,71,0.70) 0%, rgba(15,33,71,0.78) 100%)"
      : "linear-gradient(180deg, rgba(27,45,100,1) 0%, rgba(15,33,71,1) 100%)",
    color: "#fff",
    fontSize: isSmall ? 13.2 : 14.5,
    fontWeight: 950,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    boxShadow: disabled ? "0 14px 36px rgba(15,33,71,0.12)" : "0 18px 60px rgba(15,33,71,0.26)",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "transform .12s ease, box-shadow .12s ease, filter .12s ease",
  });

  const ghostBtn = {
    height: isSmall ? 38 : 44,
    borderRadius: 999,
    border: `1px solid ${BORDER}`,
    background: "rgba(255,255,255,0.98)",
    color: NAVY,
    fontSize: isSmall ? 11.8 : 12.5,
    fontWeight: 900,
    letterSpacing: ".08em",
    padding: isSmall ? "0 12px" : "0 14px",
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(15,33,71,0.06)",
    maxWidth: "100%",
  };

  const canSubmit = useMemo(() => {
    if (loading) return false;
    if (!idValid) return false;
    if (mode === MODE_OTP) return true;
    if (!password) return false;
    return true;
  }, [loading, idValid, mode, password]);

  const primaryCtaText = mode === MODE_OTP ? "Continue" : "Sign In";

  const headerSubtitle =
    mode === MODE_OTP
      ? "One-time code to confirm your identity."
      : mode === MODE_PASSWORD
      ? "Password-only sign in."
      : "Password + OTP for elevated security.";

  const riskBannerKind = risk?.level === "high" || risk?.newDevice || risk?.newIp ? "warn" : "";

  // Reduced reserved space to remove the "blank veil", while still preventing overlap.
  const SHOW_BTN_W_DESKTOP = 72;
  const SHOW_BTN_W_MOBILE = 80;
  const RESERVED_RIGHT = (isSmall ? SHOW_BTN_W_MOBILE : SHOW_BTN_W_DESKTOP) + 18;

  return (
    <main className="tdls-login-root min-h-[100dvh] w-full" style={pageStyle}>
      <section
        className="mx-auto relative"
        style={{
          maxWidth: PAGE_MAX_WIDTH,
          padding: isSmall ? "18px 12px 46px" : "86px 18px 78px",
        }}
      >
        {/* Top right utility link (desktop: absolute; mobile: in-flow to avoid overflow) */}
        <div
          className="tdls-login-utility"
          style={{
            position: isSmall ? "static" : "absolute",
            right: isSmall ? "auto" : 18,
            top: isSmall ? "auto" : 22,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: isSmall ? "flex-start" : "flex-end",
            maxWidth: "100%",
            marginBottom: isSmall ? 12 : 0,
          }}
        >
          <a
            href="/account/security"
            className="rounded-full border"
            style={{
              ...ghostBtn,
              height: isSmall ? 36 : 40,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <IconShield size={16} color={NAVY_FADE} />
            Change login method
          </a>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              ...ghostBtn,
              height: isSmall ? 36 : 40,
              opacity: 0.95,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            aria-expanded={showAdvanced ? "true" : "false"}
          >
            {showAdvanced ? "Hide Advanced" : "Advanced"}
          </button>
        </div>

        {/* Card */}
        <div
          className="mx-auto"
          style={{
            maxWidth: CARD_MAX,
            marginTop: isSmall ? 0 : 12,
            ...cardShell,
          }}
        >
          <div
            className="grid tdlc-login-grid"
            style={{
              gridTemplateColumns: "1.02fr 1.38fr",
              minWidth: 0,
            }}
          >
            {/* Left premium panel */}
            <aside style={panelLeft}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: ACCENT,
                    boxShadow: "0 0 0 7px rgba(199,161,53,0.18)",
                    flex: "0 0 auto",
                  }}
                />
                <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: ".22em", minWidth: 0 }}>
                  TDLS ACCOUNT
                </div>
              </div>

              <h1
                style={{
                  marginTop: 16,
                  fontSize: isSmall ? 26 : 30,
                  fontWeight: 950,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.15,
                }}
              >
                Sign in
              </h1>

              <p
                style={{
                  marginTop: 10,
                  color: "rgba(255,255,255,0.86)",
                  fontSize: isSmall ? 13.5 : 14.5,
                  lineHeight: 1.7,
                  maxWidth: "100%",
                }}
              >
                Seamless checkout, secure sessions, and personalized releases — without friction.
              </p>

              <div
                style={{
                  marginTop: 18,
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  padding: isSmall ? "12px 12px" : "14px 14px",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: ".18em", opacity: 0.92 }}>
                  Current mode
                </div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: 999,
                      padding: "8px 12px",
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "rgba(255,255,255,0.08)",
                      fontSize: 12.5,
                      fontWeight: 900,
                      letterSpacing: ".06em",
                      maxWidth: "100%",
                    }}
                  >
                    {mode === MODE_OTP ? "OTP" : mode === MODE_PASSWORD ? "Password" : "Password + OTP"}
                  </span>

                  <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 13, maxWidth: "100%" }}>
                    {headerSubtitle}
                  </span>
                </div>
              </div>

              {/* Steps */}
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: ".18em", opacity: 0.92 }}>Steps</div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.16)",
                      background: "rgba(255,255,255,0.08)",
                      padding: "8px 12px",
                      fontSize: 12.5,
                      fontWeight: 900,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: ACCENT }} />
                    Identify
                  </span>

                  <span style={{ color: "rgba(255,255,255,0.55)" }}>→</span>

                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 999,
                      border: "1px dashed rgba(255,255,255,0.22)",
                      background: "rgba(255,255,255,0.05)",
                      padding: "8px 12px",
                      fontSize: 12.5,
                      fontWeight: 900,
                      color: "rgba(255,255,255,0.82)",
                    }}
                  >
                    Verify
                  </span>
                </div>
              </div>

              {/* Micro copy */}
              <div style={{ marginTop: 18, color: "rgba(255,255,255,0.74)", fontSize: 13.5, lineHeight: 1.7 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.30)",
                      marginTop: 6,
                      flex: "0 0 auto",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    Redirect protection is enforced. You will be routed only to the intended destination.
                  </div>
                </div>
              </div>
            </aside>

            {/* Right panel: Form */}
            <section style={panelRight}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 14,
                  flexWrap: isSmall ? "wrap" : "nowrap",
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 14,
                        border: `1px solid ${BORDER}`,
                        background: "linear-gradient(180deg,#fff 0%,#f6f8ff 100%)",
                        display: "grid",
                        placeItems: "center",
                        boxShadow: "0 12px 26px rgba(15,33,71,0.08)",
                        flex: "0 0 auto",
                      }}
                      aria-hidden="true"
                    >
                      <IconShield size={18} color={NAVY_FADE} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: NAVY, fontSize: 18, fontWeight: 950, lineHeight: 1.15 }}>Secure sign-in</div>
                      <div style={{ color: SUBTEXT, fontSize: 13.5, marginTop: 2 }}>
                        {searchParams?.get("checkout")
                          ? "Continue to checkout after verification."
                          : "Access your account, orders, and releases."}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: isSmall ? "left" : "right", minWidth: 0, width: isSmall ? "100%" : "auto" }}>
                  <div style={{ color: NAVY_FADE, fontSize: 12.5, fontWeight: 900 }}>Redirect</div>
                  <div
                    title={redirectTo}
                    style={{
                      marginTop: 6,
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: 999,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.98)",
                      padding: "8px 12px",
                      color: NAVY,
                      fontSize: 12,
                      fontWeight: 900,
                      maxWidth: "100%",
                      width: isSmall ? "100%" : "auto",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      boxShadow: "0 10px 22px rgba(15,33,71,0.06)",
                    }}
                  >
                    {redirectTo}
                  </div>
                </div>
              </div>

              {(risk?.newDevice || risk?.newIp) && (
                <div style={{ marginTop: 16 }}>
                  <StatusPill kind={riskBannerKind || "warn"}>
                    New sign-in context detected — temporarily enabling <b>Password + OTP</b>.
                  </StatusPill>
                </div>
              )}

              {err ? (
                <div style={{ marginTop: 14 }}>
                  <StatusPill kind="error">{err}</StatusPill>
                </div>
              ) : null}

              {channelWarn ? (
                <div style={{ marginTop: 12 }}>
                  <StatusPill kind="warn">{channelWarn}</StatusPill>
                </div>
              ) : null}

              {/* Mode selector (kept) */}
              <div style={{ marginTop: 18 }}>
                <div style={labelStyle}>Method</div>

                <select
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setErr("");
                    setFieldErr({ id: "", password: "" });
                  }}
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clip: "rect(0,0,0,0)",
                    border: 0,
                  }}
                  aria-label="Login method"
                >
                  <option value={MODE_OTP}>OTP</option>
                  <option value={MODE_PASSWORD}>Password</option>
                  <option value={MODE_2FA}>Password + OTP (recommended)</option>
                </select>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                  <SegButton
                    small={isSmall}
                    active={mode === MODE_OTP}
                    disabled={loading}
                    onClick={() => {
                      setMode(MODE_OTP);
                      setErr("");
                      setFieldErr({ id: "", password: "" });
                    }}
                  >
                    OTP
                  </SegButton>

                  <SegButton
                    small={isSmall}
                    active={mode === MODE_PASSWORD}
                    disabled={loading}
                    onClick={() => {
                      setMode(MODE_PASSWORD);
                      setErr("");
                      setFieldErr({ id: "", password: "" });
                    }}
                  >
                    Password
                  </SegButton>

                  <SegButton
                    small={isSmall}
                    active={mode === MODE_2FA}
                    disabled={loading}
                    onClick={() => {
                      setMode(MODE_2FA);
                      setErr("");
                      setFieldErr({ id: "", password: "" });
                    }}
                  >
                    Password + OTP
                  </SegButton>
                </div>

                <div style={{ marginTop: 10, ...subtle }}>
                  {mode === MODE_OTP
                    ? "We’ll send a one-time code (SMS for mobile, Email for email identifiers)."
                    : mode === MODE_PASSWORD
                    ? "Password-only sign-in. Best for trusted devices."
                    : "Recommended: password validation first, then OTP verification."}
                </div>
              </div>

              {/* Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onPrimary();
                }}
                style={{ marginTop: 18 }}
              >
                {/* Identifier */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={labelStyle}>Email or Mobile</div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
                      {identifierKind === "email" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: `1px solid ${BORDER}`,
                            background: "rgba(255,255,255,0.98)",
                            color: NAVY,
                            fontSize: 12,
                            fontWeight: 900,
                            maxWidth: "100%",
                          }}
                          title="Identifier recognized as email"
                        >
                          <IconMail size={16} color={NAVY_FADE} />
                          Email
                        </span>
                      ) : identifierKind === "phone" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: `1px solid ${BORDER}`,
                            background: "rgba(255,255,255,0.98)",
                            color: NAVY,
                            fontSize: 12,
                            fontWeight: 900,
                            maxWidth: "100%",
                          }}
                          title={`Mobile (normalized: ${normalizedPhone || "—"})`}
                        >
                          <IconPhone size={16} color={NAVY_FADE} />
                          Mobile
                        </span>
                      ) : identifierKind === "invalid" ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(159,29,32,0.20)",
                            background: ERR_BG,
                            color: ERR,
                            fontSize: 12,
                            fontWeight: 900,
                            maxWidth: "100%",
                          }}
                          title="Identifier format looks invalid"
                        >
                          Invalid
                        </span>
                      ) : null}

                      {involvesOtp && effectiveOtpChannel ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: `1px solid ${BORDER}`,
                            background: "rgba(255,255,255,0.98)",
                            color: NAVY_FADE,
                            fontSize: 12,
                            fontWeight: 950,
                            letterSpacing: "0.05em",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title="OTP delivery channel"
                        >
                          OTP:{" "}
                          <span style={{ color: NAVY, marginLeft: 6 }}>
                            {effectiveOtpChannel === "sms" ? "SMS" : "Email"}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ marginTop: 8, ...fieldWrap(Boolean(fieldErr.id)) }}>
                    <input
                      type={idInputType}
                      inputMode={idInputMode}
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      onKeyDown={onEnterKey}
                      placeholder="you@example.com or 017… / +8801…"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-invalid={Boolean(fieldErr.id)}
                      style={{
                        ...inputBase,
                        // Desktop can keep auto-ch sizing; mobile always 100% to eliminate overflow/masking.
                        width: isSmall ? "100%" : idWidth,
                        maxWidth: "100%",
                      }}
                    />
                  </div>

                  {fieldErr.id ? (
                    <div style={{ marginTop: 8, color: ERR, fontSize: 13.5, fontWeight: 800 }}>{fieldErr.id}</div>
                  ) : (
                    <div style={{ marginTop: 8, ...subtle }}>We never share your contact information.</div>
                  )}

                  {/* Channel selector for phone + OTP */}
                  {involvesOtp && isPhoneish(identifier) && !isEmailish(identifier) ? (
                    <div
                      style={{
                        marginTop: 12,
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                        minWidth: 0,
                      }}
                    >
                      <span style={{ color: NAVY_FADE, fontSize: isSmall ? 12.1 : 12.5, fontWeight: 900 }}>
                        Send code via
                      </span>

                      {/* WhatsApp option visible but blocked: never selectable, never auto-selected */}
                      <button
                        type="button"
                        onClick={() => {
                          setChannel("sms");
                          setUserTouchedChannel(true);
                          setChannelWarn("WhatsApp wiring under processing — try SMS.");
                          track("otp_channel_attempt_whatsapp", { surface: "loginform" });
                        }}
                        style={{
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.96)",
                          color: NAVY_FADE,
                          padding: isSmall ? "9px 10px" : "10px 12px",
                          borderRadius: 999,
                          fontSize: isSmall ? 11.8 : 12.5,
                          fontWeight: 900,
                          letterSpacing: "0.06em",
                          boxShadow: "0 10px 22px rgba(15,33,71,0.06)",
                          opacity: 0.55,
                          cursor: "not-allowed",
                          maxWidth: "100%",
                          whiteSpace: isSmall ? "normal" : "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          lineHeight: isSmall ? 1.15 : 1.2,
                          textAlign: "center",
                        }}
                        aria-label="WhatsApp (under processing)"
                        disabled={loading}
                      >
                        WhatsApp
                      </button>

                      <SegButton
                        small={isSmall}
                        active={channel === "sms"}
                        disabled={loading}
                        onClick={() => {
                          setChannel("sms");
                          setUserTouchedChannel(true);
                          setChannelWarn("");
                        }}
                      >
                        SMS
                      </SegButton>

                      <span style={{ ...subtle, marginLeft: 2 }}>WhatsApp is under processing. SMS is recommended.</span>
                    </div>
                  ) : null}
                </div>

                {/* Password */}
                {needsPassword ? (
                  <div style={{ marginTop: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={labelStyle}>Password</div>

                      <a
                        href="/forgot-password"
                        style={{
                          color: NAVY,
                          fontSize: isSmall ? 12 : 12.5,
                          fontWeight: 950,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                          opacity: 0.92,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Forgot?
                      </a>
                    </div>

                    <div style={{ marginTop: 8, ...fieldWrap(Boolean(fieldErr.password)) }}>
                      <div style={{ position: "relative", minWidth: 0 }}>
                        <input
                          type={showPwd ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.getModifierState) setCaps(e.getModifierState("CapsLock"));
                            onEnterKey(e);
                          }}
                          autoComplete="current-password"
                          aria-invalid={Boolean(fieldErr.password)}
                          placeholder="Your password"
                          style={{
                            ...inputBase,
                            // Wider on desktop to prevent "veil" clipping, still fully safe on small screens.
                            width: isSmall ? "100%" : pwdWidth,
                            maxWidth: "100%",
                            // Reduce blank area before the Show/Hide control, while still preventing overlap.
                            paddingRight: RESERVED_RIGHT,
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => setShowPwd((v) => !v)}
                          disabled={loading}
                          aria-label={showPwd ? "Hide password" : "Show password"}
                          style={{
                            position: "absolute",
                            right: 8,
                            top: "50%",
                            transform: "translateY(-50%)",
                            height: isSmall ? 34 : 38,
                            borderRadius: 999,
                            border: `1px solid ${BORDER}`,
                            background: "rgba(255,255,255,0.96)",
                            color: NAVY_FADE,
                            fontSize: isSmall ? 11.5 : 12,
                            fontWeight: 950,
                            padding: isSmall ? "0 10px" : "0 12px",
                            cursor: loading ? "not-allowed" : "pointer",
                            whiteSpace: "nowrap",
                            maxWidth: isSmall ? "46%" : "auto",
                          }}
                        >
                          {showPwd ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>

                    {caps ? (
                      <div style={{ marginTop: 8, color: WARN, fontSize: 13.5, fontWeight: 800 }}>Caps Lock is ON</div>
                    ) : null}

                    {fieldErr.password ? (
                      <div style={{ marginTop: 8, color: ERR, fontSize: 13.5, fontWeight: 800 }}>{fieldErr.password}</div>
                    ) : (
                      <div style={{ marginTop: 8, ...subtle }}>Strong passwords keep your account secure.</div>
                    )}
                  </div>
                ) : null}

                {/* Remember device */}
                <div
                  style={{
                    marginTop: 18,
                    borderRadius: 18,
                    border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.92)",
                    padding: isSmall ? "10px 10px" : "12px 12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    boxShadow: "0 12px 26px rgba(15,33,71,0.06)",
                    flexWrap: isSmall ? "wrap" : "nowrap",
                    minWidth: 0,
                  }}
                >
                  <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer", minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={rememberDevice}
                      onChange={(e) => setRememberDevice(e.target.checked)}
                      disabled={loading}
                      style={{ width: 16, height: 16, accentColor: NAVY, flex: "0 0 auto" }}
                    />
                    <span style={{ color: NAVY, fontSize: isSmall ? 13.4 : 14, fontWeight: 900 }}>
                      Trust this device for 30 days
                    </span>
                  </label>

                  <span style={{ color: SUBTEXT, fontSize: isSmall ? 12.4 : 13, fontWeight: 700 }}>
                    Reduces OTP prompts on known devices
                  </span>
                </div>

                {/* Advanced panel */}
                {showAdvanced ? (
                  <div
                    style={{
                      marginTop: 14,
                      borderRadius: 18,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.92)",
                      padding: isSmall ? "10px 10px" : "12px 12px",
                      boxShadow: "0 12px 26px rgba(15,33,71,0.06)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ color: NAVY, fontWeight: 950, letterSpacing: ".10em", fontSize: 12.5 }}>ADVANCED</div>
                      <span style={{ color: NAVY_FADE, fontSize: 12.5, fontWeight: 800 }}>
                        Risk level: <span style={{ color: NAVY }}>{risk?.level || "low"}</span>
                      </span>
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "8px 12px",
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.98)",
                          color: NAVY_FADE,
                          fontSize: 12.5,
                          fontWeight: 900,
                        }}
                      >
                        newDevice: <span style={{ color: NAVY }}>{String(Boolean(risk?.newDevice))}</span>
                      </span>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "8px 12px",
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.98)",
                          color: NAVY_FADE,
                          fontSize: 12.5,
                          fontWeight: 900,
                        }}
                      >
                        newIp: <span style={{ color: NAVY }}>{String(Boolean(risk?.newIp))}</span>
                      </span>
                      <span
                        style={{
                          borderRadius: 999,
                          padding: "8px 12px",
                          border: `1px solid ${BORDER}`,
                          background: "rgba(255,255,255,0.98)",
                          color: NAVY_FADE,
                          fontSize: 12.5,
                          fontWeight: 900,
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title="Where you will land after successful sign-in"
                      >
                        redirect: <span style={{ color: NAVY }}>{redirectTo}</span>
                      </span>
                    </div>

                    <div style={{ marginTop: 10, ...subtle }}>
                      This panel does not change behavior; it only surfaces state for QA and support.
                    </div>
                  </div>
                ) : null}

                {/* Primary CTA */}
                <div style={{ marginTop: 16 }}>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    style={primaryBtn(!canSubmit)}
                    onMouseEnter={(e) => {
                      if (!canSubmit) return;
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.filter = "saturate(1.06)";
                      e.currentTarget.style.boxShadow = "0 22px 76px rgba(15,33,71,0.30)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.filter = "saturate(1)";
                      e.currentTarget.style.boxShadow = canSubmit
                        ? "0 18px 60px rgba(15,33,71,0.26)"
                        : "0 14px 36px rgba(15,33,71,0.12)";
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                      {loading ? <Spinner /> : null}
                      {loading
                        ? mode === MODE_OTP
                          ? "Sending…"
                          : mode === MODE_PASSWORD
                          ? "Signing in…"
                          : "Checking…"
                        : primaryCtaText}
                    </span>
                  </button>

                  <div style={{ marginTop: 14, textAlign: "center" }}>
                    <div style={{ color: NAVY, fontSize: isSmall ? 14 : 14.5, fontWeight: 800 }}>
                      Need a customer account?{" "}
                      <a
                        href={signupHref}
                        style={{
                          color: NAVY,
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                          fontWeight: 950,
                        }}
                      >
                        Sign up
                      </a>
                    </div>
                    <div style={{ marginTop: 6, color: SUBTEXT, fontSize: isSmall ? 13 : 13.5 }}>
                      Staff & admins: use the TDLS Control Center login shared with your team lead.
                    </div>
                  </div>
                </div>
              </form>

              {/* Social login (kept) */}
              <div style={{ marginTop: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, color: SUBTEXT, marginBottom: 12 }}>
                  <div style={{ flex: 1, height: 1, background: BORDER }} />
                  <span style={{ fontSize: isSmall ? 13 : 13.5, fontWeight: 800 }}>or continue with</span>
                  <div style={{ flex: 1, height: 1, background: BORDER }} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => socialSignIn("google")}
                    style={{
                      height: isSmall ? 46 : 50,
                      borderRadius: 999,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.98)",
                      color: NAVY,
                      fontSize: isSmall ? 13.2 : 14,
                      fontWeight: 900,
                      boxShadow: "0 10px 22px rgba(15,33,71,0.06)",
                      cursor: "pointer",
                      transition: "transform .12s ease, box-shadow .12s ease, filter .12s ease",
                      minWidth: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 16px 34px rgba(15,33,71,0.12)";
                      e.currentTarget.style.filter = "saturate(1.05)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "0 10px 22px rgba(15,33,71,0.06)";
                      e.currentTarget.style.filter = "saturate(1)";
                    }}
                    aria-label="Continue with Google"
                    disabled={loading}
                  >
                    Google
                  </button>

                  <button
                    type="button"
                    onClick={() => socialSignIn("facebook")}
                    style={{
                      height: isSmall ? 46 : 50,
                      borderRadius: 999,
                      border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.98)",
                      color: NAVY,
                      fontSize: isSmall ? 13.2 : 14,
                      fontWeight: 900,
                      boxShadow: "0 10px 22px rgba(15,33,71,0.06)",
                      cursor: "pointer",
                      transition: "transform .12s ease, box-shadow .12s ease, filter .12s ease",
                      minWidth: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 16px 34px rgba(15,33,71,0.12)";
                      e.currentTarget.style.filter = "saturate(1.05)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "0 10px 22px rgba(15,33,71,0.06)";
                      e.currentTarget.style.filter = "saturate(1)";
                    }}
                    aria-label="Continue with Facebook"
                    disabled={loading}
                  >
                    Facebook
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 18, ...subtle }}>
                By signing in, you agree to TDLS’s standard policies on session security and account protection.
              </div>
            </section>
          </div>
        </div>

        {/* SINGLE styled-jsx block */}
        <style jsx global>{`
          @keyframes tdlcSpin {
            from {
              transform: rotate(0deg);
            }
            to {
              transform: rotate(360deg);
            }
          }

          /* Scope overflow protection to this page only */
          .tdls-login-root {
            overflow-x: clip;
          }
          .tdls-login-root * {
            box-sizing: border-box;
            min-width: 0;
          }

          /* Mobile layout only (desktop unchanged) */
          @media (max-width: 980px) {
            .tdlc-login-grid {
              grid-template-columns: 1fr !important;
              min-width: 0;
            }
          }

          /* Extra-small devices: prevent any stray horizontal overflow */
          @media (max-width: 420px) {
            .tdls-login-root .tdls-login-utility {
              gap: 8px;
            }
          }
        `}</style>
      </section>
    </main>
  );
}
