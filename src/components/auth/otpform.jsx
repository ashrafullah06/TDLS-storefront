// FILE: my-project/src/components/auth/otpform.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const NAVY = "#0f2147";
const NAVY_GRAD = "linear-gradient(135deg,#162a4d 0%,#0b1633 100%)";
const GREY_BORDER = "#E4E7EE";

/* ========= EASY-TO-TUNE SPACING TOKENS ========= */
const PAGE_PADDING_X = "px-4 md:px-8";
const PAGE_PADDING_Y = "py-10";

const CARD_PADDING_X = "px-7 md:px-10 lg:px-12";
const CARD_PADDING_Y_TOP = "pt-8";
const CARD_PADDING_Y_BOTTOM = "pb-10";

const CTA_TO_HELPER_GAP = "pt-4";
const CTA_BLOCK_MARGIN_TOP = "mt-1";
const CTA_BLOCK_MARGIN_BOTTOM = "mb-1";

const RESEND_ROW_GAP = "gap-2";
/* =============================================== */

/* ---------- OTP TTL (HARD LOCK PER FLOW) ---------- */
const OTP_TTL_SECONDS_CUSTOMER = 180; // 3 minutes
const OTP_TTL_SECONDS_ADMIN = 210; // 3.5 minutes (max)

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

function safeDecode(v) {
  try {
    return decodeURIComponent(String(v || ""));
  } catch {
    return String(v || "");
  }
}

/** Allow only safe internal redirects; hard-lock admin flows to /admin; block customer → /admin */
function sanitizeRedirect(raw, isAdminFlow) {
  const v0 = String(raw || "").trim();
  const v = safeDecode(v0).trim();

  if (isAdminFlow) {
    if (v.startsWith("/admin")) return v;
    return "/admin";
  }

  // customer flow
  if (!v) return "/customer/dashboard";
  if (!v.startsWith("/")) return "/customer/dashboard";
  if (v.startsWith("//")) return "/customer/dashboard";

  // IMPORTANT: customer must not end up in /admin routes
  if (v.startsWith("/admin")) return "/customer/dashboard";

  return v;
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

  if (purpose === "rbac_login" || purpose === "rbac_elevate" || purpose === "rbac_sensitive_action") {
    return {
      kind: "admin",
      pill: "Admin verification",
      title: "Enter the 6-digit admin code",
      subtitle: "This protects refunds, inventory, and role-based actions.",
      cta: "Approve & continue",
    };
  }

  return base;
}

/**
 * POST helper with controlled fallback behavior.
 * - For admin flows we will pass a single endpoint (no legacy fallback).
 * - For customer flows we keep legacy fallback behavior.
 */
async function postJsonWithFallback(endpoints, payload, opts) {
  const options = {
    fallbackOn5xx: true,
    ...opts,
  };

  let saw404 = false;
  let lastJson = {};
  let lastStatus = 0;

  for (const ep of endpoints) {
    let r;
    try {
      r = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        credentials: "include",
        signal: options.signal,
        body: JSON.stringify(payload),
      });
    } catch {
      continue;
    }

    lastStatus = r.status;
    const jr = await r.json().catch(() => ({}));
    lastJson = jr || {};

    if (r.status === 404) {
      saw404 = true;
      continue;
    }

    if (r.status >= 500 && r.status <= 599) {
      if (options.fallbackOn5xx) continue;
      return { ok: r.ok, json: lastJson, status: r.status, used: ep };
    }

    return { ok: r.ok, json: lastJson, status: r.status, used: ep };
  }

  return {
    ok: false,
    json: lastJson,
    status: lastStatus || (saw404 ? 404 : 0),
    used: "",
  };
}

/**
 * Suppress duplicate "auto bootstrap" OTP sends that can occur:
 * - When a previous step already sent OTP but the OTP page also auto-sends, and/or
 * - In Next.js dev/Strict Mode where mount can happen twice.
 */
function shouldSuppressBootstrap(key, windowMs = 450) {
  try {
    if (typeof window === "undefined") return false;
    // Use a short-lived, in-memory (window-scoped) guard.
    // This prevents Strict Mode double-mount duplicates without blocking a fresh login attempt
    // after navigating back from the OTP form.
    const w = window;
    if (!w.__tdlcOtpBootstrapGuardV1) w.__tdlcOtpBootstrapGuardV1 = Object.create(null);
    const k = `tdlc_otp_bootstrap_guard_v1:${key}`;
    const last = Number(w.__tdlcOtpBootstrapGuardV1[k] || 0);
    const now = Date.now();
    if (now - last < windowMs) return true;
    w.__tdlcOtpBootstrapGuardV1[k] = now;
    return false;
  } catch {
    return false;
  }
}

/**
 * Persisted "OTP active" guard (no cooldown; prevents accidental double-send)
 * - Prevents auto-bootstrap from re-sending OTP on refresh/re-render while the current OTP is still valid.
 * - Timer stops (and guard clears) on: TTL end, mismatch/fail, success, or close.
 */
function otpActiveKey({ identifier, via, purpose, scope, sessionId }) {
  const id = String(identifier || "").trim().toLowerCase();
  const v = String(via || "").trim().toLowerCase();
  const p = String(purpose || "").trim().toLowerCase();
  const s = scope === "admin" ? "admin" : "customer";
  const sid = String(sessionId || "").trim();
  const sidPart = sid ? `|sid:${sid}` : "";
  return `tdlc_otp_active_v1:${encodeURIComponent(`${s}|${p}|${v}|${id}${sidPart}`)}`;
}

function getActiveRemainingSeconds(key) {
  try {
    if (typeof window === "undefined") return 0;
    const raw = sessionStorage.getItem(key);
    if (!raw) return 0;
    const expiresAtMs = Number(raw);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
      sessionStorage.removeItem(key);
      return 0;
    }
    const diff = Math.ceil((expiresAtMs - Date.now()) / 1000);
    if (diff <= 0) {
      sessionStorage.removeItem(key);
      return 0;
    }
    return diff;
  } catch {
    return 0;
  }
}

function setActiveExpiresAt(key, expiresAtMs) {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(key, String(expiresAtMs));
  } catch {}
}

function clearActiveOtp(key) {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(key);
  } catch {}
}

/**
 * "Force-new once" marker:
 * - When user closes OTP and returns to login, the NEXT login attempt should request a fresh OTP
 *   (even if a previous OTP is still active server-side due to network/provider delays).
 * - This prevents the "OTP not firing again" issue after closing OTP form.
 */
function otpForceNewOnceKey({ identifier, via, purpose, scope }) {
  const id = String(identifier || "").trim().toLowerCase();
  const v = String(via || "").trim().toLowerCase();
  const p = String(purpose || "").trim().toLowerCase();
  const s = scope === "admin" ? "admin" : "customer";
  return `tdlc_otp_force_new_once_v1:${encodeURIComponent(`${s}|${p}|${v}|${id}`)}`;
}

function setForceNewOnce(key) {
  try {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(key, "1");
  } catch {}
}

function takeForceNewOnce(key) {
  try {
    if (typeof window === "undefined") return false;
    const v = sessionStorage.getItem(key);
    if (!v) return false;
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}


/**
 * Admin session stabilization:
 * Prevent "verified → redirect → forbidden" race by confirming /api/admin/session sees the new cookie.
 */
async function confirmAdminSession(sessionEndpoint) {
  const ep = String(sessionEndpoint || "/api/admin/session");
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(ep, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const jr = await r.json().catch(() => null);
      if (jr?.user?.id) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 220));
  }
  return false;
}

/* ---------- TTL/expiry parsing (robust + hard-locked per flow) ---------- */
function clampTtl(n, maxSeconds) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return maxSeconds;
  return Math.min(maxSeconds, Math.max(1, Math.floor(x)));
}

/**
 * Prefer expiresAt/serverNow when available (handles slow API responses),
 * otherwise fallback to ttlSeconds, and in all cases clamp to flow max.
 */
function deriveTtlSecondsFromResponse(json, maxSeconds) {
  const j = json || {};
  const expiresAtMs = Date.parse(String(j.expiresAt || ""));
  const serverNowMs = Date.parse(String(j.serverNow || ""));

  if (Number.isFinite(expiresAtMs)) {
    const baseNow = Number.isFinite(serverNowMs) ? serverNowMs : Date.now();
    const diff = Math.ceil((expiresAtMs - baseNow) / 1000);
    return clampTtl(diff, maxSeconds);
  }

  return clampTtl(j.ttlSeconds, maxSeconds);
}


/**
 * Some deployments send OTP from the previous step (e.g., login form) and then route to this page.
 * In that case, an auto-bootstrap request from this page may be rejected as "already issued / still active".
 * That is not an error for the UI: we must show a fresh ticking timer and keep "Resend code" locked.
 *
 * We treat ONLY explicit "already active/issued" responses as success signals.
 */
function isAlreadyIssuedOtpResponse(out) {
  const status = Number(out?.status || 0);
  const j = out?.json || {};
  const code = String(j.code || j.errorCode || j.error_code || "").toLowerCase();
  const msg = String(j.error || j.message || j.detail || "").toLowerCase();

  // Strong signal
  if (status === 409) return true;

  // Message/code based signals (covers 400/422 variants that say "already sent/active")
  const hasOtpWord = code.includes("otp") || msg.includes("otp") || msg.includes("code");
  const alreadyLike =
    code.includes("already") ||
    code.includes("active") ||
    code.includes("exists") ||
    code.includes("issued") ||
    code.includes("sent") ||
    msg.includes("already") ||
    msg.includes("active") ||
    msg.includes("exists") ||
    msg.includes("issued") ||
    msg.includes("sent");

  if (!hasOtpWord || !alreadyLike) return false;

  // If it's a throttling status, only accept when message explicitly says an OTP already exists/active.
  if (status === 429) {
    return msg.includes("already") || msg.includes("active") || msg.includes("exists") || msg.includes("sent");
  }

  // Other non-OK statuses with explicit "already" semantics
  return true;
}


/* ===========================
   ADMIN-PLANE SIGN-IN (NO /api/auth)
   =========================== */

/**
 * Fetch CSRF token from a specific Auth.js basePath (admin plane uses /api/admin/auth).
 * Works even if global next-auth client config is pointing to /api/auth.
 */
async function getCsrfTokenForBasePath(basePath) {
  const bp = String(basePath || "/api/auth").replace(/\/+$/, "");
  const url = `${bp}/csrf`;
  const r = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const j = await r.json().catch(() => ({}));
  return String(j?.csrfToken || "");
}

/**
 * Directly POST to Auth.js callback endpoint under a specific basePath.
 * This is the key fix to prevent admin OTP from ever touching /api/auth.
 */
async function signInViaBasePath(providerId, params, basePath) {
  const bp = String(basePath || "/api/auth").replace(/\/+$/, "");
  const csrfToken = await getCsrfTokenForBasePath(bp);

  if (!csrfToken) {
    return { ok: false, error: "Missing CSRF token", url: null, status: 0 };
  }

  const callbackUrl = String(params?.callbackUrl || "/").trim() || "/";
  const body = new URLSearchParams();
  body.set("csrfToken", csrfToken);
  body.set("callbackUrl", callbackUrl);
  body.set("json", "true");
  body.set("redirect", "false");

  // Copy credential fields
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    if (k === "callbackUrl") continue; // already set
    body.set(k, String(v));
  }

  const url = `${bp}/callback/${encodeURIComponent(String(providerId || "credentials"))}`;

  const r = await fetch(url, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  // Auth.js typically returns json when json=true
  const j = await r.json().catch(() => ({}));
  return {
    ok: !!(r.ok && (j?.ok !== false) && !j?.error),
    error: j?.error || (r.ok ? null : "Sign-in failed"),
    url: j?.url || callbackUrl || null,
    status: r.status,
    raw: j,
  };
}

/**
 * Props (optional):
 * - scope: "admin" | "customer"
 * - purpose: string (canonical)
 * - redirectTo: string (already sanitized upstream)
 * - authBasePath: "/api/admin/auth" for admin plane, "/api/auth" for customer plane (optional)
 * - sessionEndpoint: "/api/admin/session" for admin plane stabilization (optional)
 */
export default function OtpForm(props) {
  const {
    scope: scopeProp,
    purpose: purposeProp,
    redirectTo: redirectToProp,
    authBasePath: authBasePathProp,
    sessionEndpoint: sessionEndpointProp,
  } = props || {};

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Mark admin auth flow in sessionStorage (admin-only key) to avoid any customer guard interference.
  useEffect(() => {
    const s = String(scopeProp || "").toLowerCase();
    const inferredAdmin =
      s === "admin" ||
      String(pathname || "").startsWith("/admin") ||
      search?.get("admin") === "1" ||
      search?.get("rbac") === "1" ||
      String(search?.get("purpose") || "").toLowerCase().startsWith("rbac_");

    if (!inferredAdmin) return;

    try {
      sessionStorage.setItem("tdlc_admin_auth_flow", "1");
    } catch {}
    return () => {
      try {
        sessionStorage.removeItem("tdlc_admin_auth_flow");
      } catch {}
    };
  }, [scopeProp, pathname, search]);

  const rawViaParam = search?.get("via");
  const hasViaParam = rawViaParam != null && String(rawViaParam).trim() !== "";

  // If upstream (login/checkout) already requested OTP before routing here, it may pass sent=1.
  // In that case, this page must immediately show a timer (and keep resend locked) without re-sending.
  const sentAlready = (() => {
    const v = String(search?.get("sent") || search?.get("otpSent") || "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  })();

  // Accept identifier from identifier/to AND ALSO email/phone passthrough.
  const urlIdentifier =
    search?.get("identifier") ||
    search?.get("to") ||
    search?.get("email") ||
    search?.get("phone") ||
    "";

  const urlVia = (rawViaParam || "sms").toLowerCase();

  const redirectRaw =
    (search?.get("checkout")
      ? "/checkout"
      : search?.get("redirect") || search?.get("callbackUrl") || "") || "";

  const redirectCandidate = useMemo(() => safeDecode(redirectRaw).trim(), [redirectRaw]);

  const purposeParam = search?.get("purpose") || "login";
  const purposeNorm = normalizePurposeClient(purposeParam);

  const adminFlag = search?.get("admin") === "1" || search?.get("rbac") === "1";
  const adminIntentByUrl =
    adminFlag ||
    String(pathname || "").startsWith("/admin") ||
    String(redirectCandidate || "").startsWith("/admin") ||
    String(purposeNorm || "").startsWith("rbac_");

  const adminIntent =
    String(scopeProp || "").toLowerCase() === "admin" ? true : adminIntentByUrl;

  const purpose = useMemo(() => {
    const forced = String(purposeProp || "").trim().toLowerCase();
    if (forced) {
      const p = normalizePurposeClient(forced);
      if (adminIntent) return String(p).startsWith("rbac_") ? p : "rbac_login";
      return String(p).startsWith("rbac_") ? "login" : p;
    }

    if (adminIntent) {
      return String(purposeNorm || "").startsWith("rbac_") ? purposeNorm : "rbac_login";
    }
    return String(purposeNorm || "").startsWith("rbac_") ? "login" : purposeNorm;
  }, [adminIntent, purposeNorm, purposeProp]);

  const context = useMemo(() => buildContext(purpose), [purpose]);
  const isAdminFlow = adminIntent;

  const FLOW_TTL_MAX = isAdminFlow ? OTP_TTL_SECONDS_ADMIN : OTP_TTL_SECONDS_CUSTOMER;

  const redirectTo = useMemo(() => {
    const forced = String(redirectToProp || "").trim();
    if (forced) return sanitizeRedirect(forced, isAdminFlow);
    return sanitizeRedirect(redirectCandidate, isAdminFlow);
  }, [redirectToProp, redirectCandidate, isAdminFlow]);

  const remember = search?.get("remember") === "1";
  const sessionId = search?.get("session") || null;

  const searchFingerprint = useMemo(() => {
    try {
      return search ? String(search.toString?.() || "") : "";
    } catch {
      return "";
    }
  }, [search]);

  const entryFingerprint = useMemo(() => {
    return `${String(pathname || "")}?${searchFingerprint}`;
  }, [pathname, searchFingerprint]);


  const [to, setTo] = useState(urlIdentifier);
  const [via, setVia] = useState(urlVia);

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);

  const [bootstrapping, setBootstrapping] = useState(false);

  const [expires, setExpires] = useState(0);

  // Resend eligibility is NOT the same as expires === 0.
  // It becomes true only when the timer ends naturally OR when verification fails/mismatches.
  const [resendEligible, setResendEligible] = useState(false);

  const endReasonRef = useRef("");
  const prevExpiresRef = useRef(0);

  const abortCtrlRef = useRef(null);
  const lastKeyRef = useRef("");
  const lastSessionIdRef = useRef("");
  const lastEntryFingerprintRef = useRef("");
  const lastArmedEntryRef = useRef("");

  // Detect "new OTP issued" without relying solely on route changes (covers modal/panel flows)
  const prevSentAlreadyRef = useRef(false);
  const inputRefs = useRef([]);
  const autoVerifyRef = useRef(true);
  const sendInFlightRef = useRef(false);
  const timerRef = useRef(null);
  const sendAbortRef = useRef(null);

  // hydrate from sessionStorage if needed (flow-specific keys)
  useEffect(() => {
    if (to) return;
    try {
      const kAdmin = "tdlc_admin_login_identifier_v1";
      const kCust = "tdlc_login_identifier_v1";
      const k = isAdminFlow ? kAdmin : kCust;

      const saved = sessionStorage.getItem(k) || "";
      if (saved) setTo(saved);

      const kViaAdmin = "tdlc_admin_login_via_v1";
      const kViaCust = "tdlc_login_via_v1";
      const kVia = isAdminFlow ? kViaAdmin : kViaCust;

      const savedVia = (sessionStorage.getItem(kVia) || "").toLowerCase();
      if (!hasViaParam && savedVia) setVia(savedVia);
    } catch {}
  }, [to, isAdminFlow, hasViaParam]);

  // persist identifier/via (flow-specific keys)
  useEffect(() => {
    if (!to) return;
    try {
      const k = isAdminFlow ? "tdlc_admin_login_identifier_v1" : "tdlc_login_identifier_v1";
      sessionStorage.setItem(k, String(to));
    } catch {}
  }, [to, isAdminFlow]);

  useEffect(() => {
    if (!via) return;
    try {
      const k = isAdminFlow ? "tdlc_admin_login_via_v1" : "tdlc_login_via_v1";
      sessionStorage.setItem(k, String(via).toLowerCase());
    } catch {}
  }, [via, isAdminFlow]);

  /* ---------- Timer ---------- */
  const stopOtpTimer = React.useCallback(
    (reason = "") => {
      // mark why we ended (distinguish natural tick vs explicit action)
      endReasonRef.current = String(reason || "");

      // stop ticking immediately
      try {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch {}

      setExpires(0);

      // Default: resend is NOT eligible unless explicitly allowed by the reason.
      const r = String(reason || "");
      const allowResend =
        r === "expired_natural" ||
        r === "expired_before_verify" ||
        r.startsWith("verify_failed") ||
        r === "verify_exception";

      setResendEligible(!!allowResend);

      // clear persisted active OTP marker (no cooldown; allows immediate resend only when allowed)
      try {
        if (to && purpose) {
          clearActiveOtp(
            otpActiveKey({
              identifier: to,
              via,
              purpose,
              scope: isAdminFlow ? "admin" : "customer",
              sessionId,
            })
          );
        }
      } catch {}

      // abort any in-flight OTP request so late responses can't re-arm the timer
      try {
        sendAbortRef.current?.abort?.();
      } catch {}

      // Ensure client-side send state never remains locked after navigation/close.
      try {
        sendInFlightRef.current = false;
      } catch {}
      try {
        setSending(false);
        setBootstrapping(false);
      } catch {}


      // rewrite DB so no OTP remains active (best-effort, non-blocking)
      // - close/success: cancel active OTP so it can't keep an old session alive
      // - fail/expired: expire active OTP to allow new request cleanly
      if (r === "close_clicked") {
        // Next time user tries from login again, force a fresh OTP (prevents "not firing" after close).
        try {
          const fkey = otpForceNewOnceKey({ identifier: to, via, purpose, scope: isAdminFlow ? "admin" : "customer" });
          setForceNewOnce(fkey);
        } catch {}
        invalidateOtpServer("cancel");
      } else if (r.startsWith("verify_success")) {
        invalidateOtpServer("cancel");
      } else if (allowResend) {
        invalidateOtpServer("expire");
      }

      void reason;
    },
    [to, via, purpose, isAdminFlow]
  );


  useEffect(() => {
    // Start/stop a single interval when the timer is running.
    const running = expires > 0;

    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch {}

    if (!running) return;

    timerRef.current = setInterval(() => {
      setExpires((s) => (s > 0 ? s - 1 : 0));
    }, 1000);

    return () => {
      try {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch {}
    };
  }, [expires > 0]);

  // Clear persisted active OTP marker when timer ends naturally
  useEffect(() => {
    if (expires !== 0) return;
    if (!to || !purpose) return;
    try {
      clearActiveOtp(otpActiveKey({ identifier: to, via, purpose, scope: isAdminFlow ? "admin" : "customer", sessionId }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expires]);

  // Distinguish natural timer end vs explicit stopOtpTimer calls.
  useEffect(() => {
    const prev = prevExpiresRef.current;
    prevExpiresRef.current = expires;

    // When a running timer reaches 0 by ticking, enable resend (natural expiry).
    if (prev > 0 && expires === 0) {
      const endedBy = String(endReasonRef.current || "");
      if (!endedBy) {
        // Natural expiry (tick)
        endReasonRef.current = "expired_natural";
        setResendEligible(true);
        // Best-effort DB rewrite (do not block UI)
        invalidateOtpServer("expire");
      }
    }

    // Any time a new timer starts, resend should be disabled again.
    if (expires > 0) {
      endReasonRef.current = "";
      setResendEligible(false);
    }
  }, [expires]);


  /* ---------- Android Web OTP (SMS only) ---------- */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("OTPCredential" in window)) return;
    if (via !== "sms") return;

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
          autoVerifyRef.current = true;
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

  const requestEndpoints = useMemo(() => {
    if (isAdminFlow) {
      const base = String(authBasePathProp || "/api/admin/auth").replace(/\/+$/, "");
      return [`${base}/request-otp`];
    }
    const base = String(authBasePathProp || "/api/auth").replace(/\/+$/, "");
    return [`${base}/request-otp`, "/api/request-otp"];
  }, [isAdminFlow, authBasePathProp]);

  // Best-effort: rewrite DB so no OTP remains active (per your rule: "timer off means everything off").
  // Uses the same endpoint list as OTP request to maximize compatibility across deployments.
  async function invalidateOtpServer(action) {
    try {
      const channel = via === "email" ? "EMAIL" : via === "whatsapp" ? "WHATSAPP" : "SMS";
      const payload = {
        identifier: to,
        to,
        purpose,
        channel,
        via: String(via || "").toLowerCase(),
        action: action || "expire",
        scope: isAdminFlow ? "admin" : "customer",
      };

      await postJsonWithFallback(requestEndpoints, payload, {
        // Invalidation should be resilient; fallback is fine.
        fallbackOn5xx: true,
      });
    } catch {}
  }

  /* ---------- Request / bootstrap OTP ---------- */
  async function bootstrapOtp(silent = true, opts = {}) {
    if (!to || !purpose) return;

    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;

    // "Click and fire": start UI timer immediately (no waiting for network)
    // If the request fails, we stop the timer and show error.
    const activeKey = otpActiveKey({
      identifier: to,
      via,
      purpose,
      scope: isAdminFlow ? "admin" : "customer", sessionId });

    try {
      // Abort any previous in-flight send
      try {
        sendAbortRef.current?.abort?.();
      } catch {}
      const ac = new AbortController();
      sendAbortRef.current = ac;

      if (!silent) {
        setErr("");
        setSending(true);
      } else {
        setBootstrapping(true);
      }

      // Optimistically arm the timer and active marker immediately.
      // This makes the UX near-instant even if SMTP/SMS takes time server-side.
      endReasonRef.current = "";
      setResendEligible(false);
      setExpires(FLOW_TTL_MAX);
      setActiveExpiresAt(activeKey, Date.now() + FLOW_TTL_MAX * 1000);

      const channel = via === "email" ? "EMAIL" : via === "whatsapp" ? "WHATSAPP" : "SMS";

      // When explicitly forcing a new OTP (resend or "close → re-login"), best-effort expire any
      // existing OTP server-side so the previous code becomes obsolete immediately.
      if (opts?.forceNew) {
        try {
          void invalidateOtpServer("expire");
        } catch {}
      }

      const payload = {
        identifier: to,
        to,
        purpose,
        channel,
        via: via.toLowerCase(),
        allowNew: purpose === "signup",
        // For explicit user-initiated resend OR a forced-new-once next attempt after closing OTP
        forceNew: opts?.forceNew ? true : silent ? undefined : true,
        sessionId,
        adminLogin: isAdminFlow ? true : undefined,
        scope: isAdminFlow ? "admin" : "customer",
        // Future-proof: server-side idempotency (safe if ignored)
        idempotencyKey: opts?.forceNew ? `${activeKey}|${Date.now()}` : activeKey,
      };

      const out = await postJsonWithFallback(requestEndpoints, payload, { fallbackOn5xx: false, signal: sendAbortRef.current?.signal });

      if (!out.ok) {
        // If OTP was already issued in the previous step (e.g., login requested OTP then routed here),
        // do NOT treat this as a failure. Keep a fresh ticking timer and keep resend locked.
        if (isAlreadyIssuedOtpResponse(out)) {
          const ttl = deriveTtlSecondsFromResponse(out?.json, FLOW_TTL_MAX);
          endReasonRef.current = "";
          setResendEligible(false);
          setExpires(ttl);
          setActiveExpiresAt(activeKey, Date.now() + ttl * 1000);
          return;
        }

        if (!silent) setErr(out?.json?.error || "Unable to send the code right now.");

        // Auto-bootstrap is allowed to fail without breaking the "fresh session" UX.
        // We keep the optimistically armed countdown running so the first appearance is never "Resend code" unlocked.
        // User can still request a new OTP when the timer ends.
        if (silent) return;

        // Stop timer immediately on send failure (no cooldown)
        try {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        } catch {}
        setResendEligible(false);
        setExpires(0);
        try {
          clearActiveOtp(activeKey);
        } catch {}
        return;
      }
      const ttl = deriveTtlSecondsFromResponse(out?.json, FLOW_TTL_MAX);
      setExpires(ttl);
      // Mark OTP as active to prevent accidental double-send on refresh/re-render
      setActiveExpiresAt(activeKey, Date.now() + ttl * 1000);
    } catch (e) {
      if (!silent) setErr(e?.message || "Unable to send the code.");

      // Same principle as above: auto-bootstrap errors should not "unlock resend" on first appearance.
      // Keep the optimistically armed timer running; allow user to resend after expiry.
      if (silent) return;

      // Stop timer on send exception/abort
      try {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch {}
      setExpires(0);
      try {
        clearActiveOtp(activeKey);
      } catch {}
    } finally {
      if (!silent) setSending(false);
      setBootstrapping(false);
      sendInFlightRef.current = false;
    }
  }

  useEffect(() => {
    const key = `${to}|${via}|${purpose}|${isAdminFlow ? "admin" : "customer"}`;
    if (!to) return;

    if (lastKeyRef.current !== key) {
      lastKeyRef.current = key;
      setDigits(["", "", "", "", "", ""]);
      setOtp("");
      setErr("");
      setExpires(0);
      try { endReasonRef.current = ""; prevExpiresRef.current = 0; } catch {}
      setResendEligible(false);
      autoVerifyRef.current = true;

      // If an OTP is already active for this flow (e.g., refresh/back), restore timer and do not re-send
      const activeKey = otpActiveKey({ identifier: to, via, purpose, scope: isAdminFlow ? "admin" : "customer", sessionId });
      const remaining = getActiveRemainingSeconds(activeKey);
      if (remaining > 0) {
        setExpires(Math.min(FLOW_TTL_MAX, remaining));
        return;
      }

      // Upstream already sent an OTP (e.g., login form requested OTP then routed here).
      // Show timer immediately; keep resend locked; do NOT re-send.
      if (sentAlready) {
        endReasonRef.current = "";
        setResendEligible(false);
        setExpires(FLOW_TTL_MAX);
        try {
          setActiveExpiresAt(activeKey, Date.now() + FLOW_TTL_MAX * 1000);
        } catch {}
        return;
      }

      const fkey = otpForceNewOnceKey({ identifier: to, via, purpose, scope: isAdminFlow ? "admin" : "customer" });
      const forceNewOnce = takeForceNewOnce(fkey);

      // Product rule: the first appearance of the OTP form after a login attempt must show a ticking timer,
      // and "Resend code" must remain locked while the timer is running.
      // We optimistically arm the timer immediately. If a bootstrap request runs, it may refine TTL from server.
      endReasonRef.current = "";
      setResendEligible(false);
      setExpires(FLOW_TTL_MAX);
      try {
        setActiveExpiresAt(activeKey, Date.now() + FLOW_TTL_MAX * 1000);
      } catch {}

      // Suppress only duplicate auto-bootstrap NETWORK sends (e.g., Strict Mode double-mount).
      // Never suppress a forced-new attempt (e.g., after Close).
      if (shouldSuppressBootstrap(key, 450) && !forceNewOnce) return;

      bootstrapOtp(true, { forceNew: !!forceNewOnce });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, via, purpose, isAdminFlow]);
  /**
   * NEW-OTP RE-ARM (critical):
   * If the user closes the OTP step and later triggers a fresh OTP for the same identifier/purpose,
   * we MUST hard-reset state so the countdown starts and "Resend code" stays locked again.
   *
   * IMPORTANT: This must work even if OTP/login is implemented as a modal/panel without route changes.
   * Signals we accept as "fresh OTP" include:
   * - sentAlready rising edge (false → true),
   * - entryFingerprint change,
   * - sessionId change (preferred, if server provides it),
   * - a pending force-new-once marker (set on Close).
   */
  useEffect(() => {
    if (!to || !purpose) return;

    const sid = String(sessionId || "").trim();
    const prevSid = String(lastSessionIdRef.current || "").trim();

    const entry = String(entryFingerprint || "");
    const prevEntry = String(lastEntryFingerprintRef.current || "");

    const sessionChanged = !!sid && sid !== prevSid;
    const newEntry = !!entry && entry !== prevEntry;
    const newEntryForArm = newEntry && entry !== String(lastArmedEntryRef.current || "");

    // Close → next attempt should be treated as a fresh OTP flow even if URL doesn't change.
    const fkey = otpForceNewOnceKey({
      identifier: to,
      via,
      purpose,
      scope: isAdminFlow ? "admin" : "customer",
    });
    const forceNewOncePending = takeForceNewOnce(fkey); // consumes marker if present

    // Rising-edge detection for sentAlready (covers cases where URL stays identical but parent toggles view).
    const prevSent = !!prevSentAlreadyRef.current;
    const sentNow = !!sentAlready;
    const sentBecameTrue = sentNow && !prevSent;

    // Update ref immediately so StrictMode double-invoke won't re-trigger.
    prevSentAlreadyRef.current = sentNow;

    // New OTP is considered issued when:
    // - Close marker is present, OR
    // - sentAlready just became true, OR
    // - we entered/re-entered this OTP view with sentAlready and the entry fingerprint changed, OR
    // - the server provided a new sessionId (fresh OTP session).
    const newOtpSignal = forceNewOncePending || sentBecameTrue || sessionChanged || newEntryForArm;

    if (!newOtpSignal) {
      if (newEntry) lastEntryFingerprintRef.current = entry;
      if (sid && !prevSid) lastSessionIdRef.current = sid;
      return;
    }

    // If the session changed, remove any previous session-local marker so we never restore an old timer.
    if (sessionChanged) {
      try {
        clearActiveOtp(
          otpActiveKey({
            identifier: to,
            via,
            purpose,
            scope: isAdminFlow ? "admin" : "customer",
            sessionId: prevSid,
          })
        );
      } catch {}
    }

    // Update refs to current entry/session.
    lastEntryFingerprintRef.current = entry || prevEntry;
    if (entry) lastArmedEntryRef.current = entry;
    if (sid) lastSessionIdRef.current = sid;

    // Reset local UI state and arm a fresh timer immediately.
    setErr("");
    setDigits(["", "", "", "", "", ""]);
    setOtp("");
    autoVerifyRef.current = true;
    endReasonRef.current = "";
    prevExpiresRef.current = 0;
    setResendEligible(false);

    const activeKey = otpActiveKey({
      identifier: to,
      via,
      purpose,
      scope: isAdminFlow ? "admin" : "customer",
      sessionId,
    });

    setExpires(FLOW_TTL_MAX);
    setActiveExpiresAt(activeKey, Date.now() + FLOW_TTL_MAX * 1000);

    // If we came here because of Close marker (and upstream did not already send),
    // request a fresh OTP silently.
    if (forceNewOncePending && !sentAlready) {
      bootstrapOtp(true, { forceNew: true });
    }
  }, [sentAlready, sessionId, entryFingerprint, to, via, purpose, isAdminFlow, FLOW_TTL_MAX]);



  /* ---------- OTP input handlers ---------- */
  const handleDigitChange = (index, value) => {
    const v = value.replace(/[^\d]/g, "").slice(-1);
    const next = [...digits];
    next[index] = v;
    setDigits(next);

    const joined = next.join("");
    setOtp(joined);

    autoVerifyRef.current = true;

    if (v && index < 5) inputRefs.current[index + 1]?.focus();
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

  const handlePaste = (e) => {
    const text = (e.clipboardData?.getData("text") || "").replace(/[^\d]/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const arr = text.split("");
    while (arr.length < 6) arr.push("");
    setDigits(arr);
    setOtp(text);
    autoVerifyRef.current = true;
    inputRefs.current[Math.min(text.length, 6) - 1]?.focus();
  };

  function mapNextAuthErrorToMessage(code) {
    const c = String(code || "").trim();
    if (c === "CredentialsSignin") return "That code didn’t match or has expired. Please try again.";
    if (c === "AccessDenied") return "Access denied for this account.";
    if (c) return c;
    return "Verification failed. Please try again.";
  }

  async function verify() {
    if (verifying) return;
    setErr("");

    if (!/^\d{6}$/.test(otp)) {
      setErr("Enter the 6-digit code.");
      return;
    }

    // If the timer ended naturally (or we already marked expiry), treat the code as expired.
    // If expires===0 but resendEligible is false, the timer was not armed yet (e.g., fast redirect),
    // so we allow the server to validate instead of pre-failing locally.
    const expiryMarked = String(endReasonRef.current || "").startsWith("expired");
    const timerNotArmedYet = expires === 0 && !resendEligible && !expiryMarked;

    if (expires === 0 && !timerNotArmedYet) {
      setErr("This code has expired. Please request a new code.");
      // Ensure any persisted active marker is cleared so resend is immediately available
      stopOtpTimer("expired_before_verify");
      return;
    }

    setVerifying(true);
    try {
      const dest = redirectTo || (isAdminFlow ? "/admin" : "/customer/dashboard");
      const callbackUrl = dest.includes("?") ? `${dest}&login=1` : `${dest}?login=1`;

      // IMPORTANT:
      // - CUSTOMER: use next-auth client signIn() (hits /api/auth)
      // - ADMIN: NEVER touch /api/auth. Post to /api/admin/auth directly.
      const payload = {
        redirect: false,
        type: "otp",
        identifier: to,
        code: otp.trim(),
        purpose,
        callbackUrl,
        rememberDevice: remember,
        sessionId,
        adminLogin: isAdminFlow ? true : undefined,
        scope: isAdminFlow ? "admin" : "customer",
      };

      let res;

      if (isAdminFlow) {
        const adminBase = String(authBasePathProp || "/api/admin/auth").replace(/\/+$/, "");

        // Preferred provider id for admin plane, with safe fallback to alias.
        res = await signInViaBasePath("admin-credentials", payload, adminBase);

        if (!res?.ok) {
          // Fallback if only "credentials" is wired in that environment
          const res2 = await signInViaBasePath("credentials", payload, adminBase);
          if (res2?.ok) res = res2;
        }

        if (!res?.ok) {
          setErr(mapNextAuthErrorToMessage(res?.error || "CredentialsSignin"));
          // Stop timer on OTP failure/mismatch so user can request a fresh OTP immediately
          stopOtpTimer("verify_failed_admin");
          setVerifying(false);
          autoVerifyRef.current = false;
          return;
        }

        // Cookie propagation race guard
        await confirmAdminSession(sessionEndpointProp || "/api/admin/session");

        // Stop timer on success
        stopOtpTimer("verify_success_admin");
        router.replace(res?.url || callbackUrl);
        router.refresh?.();
        return;
      }

      // CUSTOMER FLOW (unchanged)
      res = await signIn("credentials", payload);

      if (!res?.ok || res?.error) {
        setErr(mapNextAuthErrorToMessage(res?.error));
        // Stop timer on OTP failure/mismatch so user can request a fresh OTP immediately
        stopOtpTimer("verify_failed_customer");
        setVerifying(false);
        autoVerifyRef.current = false;
        return;
      }

      // Stop timer on success
      stopOtpTimer("verify_success_customer");
      router.replace(res?.url || callbackUrl);
      router.refresh?.();
      return;
    } catch (e) {
      setErr(e?.message || "Verification failed. Please try again.");
      // Stop timer on verification error
      stopOtpTimer("verify_exception");
      setVerifying(false);
      autoVerifyRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoVerifyRef.current) return;
    if (!/^\d{6}$/.test(otp)) return;
    if (verifying || sending || bootstrapping) return;
    autoVerifyRef.current = false;
    verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, verifying, sending, bootstrapping]);

  async function resend() {
    if (sending || bootstrapping || expires > 0) return;
    autoVerifyRef.current = true;

    try {
      clearActiveOtp(otpActiveKey({ identifier: to, via, purpose, scope: isAdminFlow ? "admin" : "customer", sessionId }));
    } catch {}

    await bootstrapOtp(false, { forceNew: true });

    setDigits(["", "", "", "", "", ""]);
    setOtp("");
    inputRefs.current[0]?.focus();
  }

  const canResend = resendEligible && !sending && !bootstrapping && expires === 0;
  const canVerify = !verifying && /^\d{6}$/.test(otp);

  function handleClose() {
    // Stop timer + clear active OTP guard on close
    stopOtpTimer("close_clicked");
    try {
      abortCtrlRef.current?.abort();
    } catch {}

    // Ensure a fresh attempt can bootstrap even if the same identifier is used again.
    try {
      lastKeyRef.current = "";
      prevExpiresRef.current = 0;
      endReasonRef.current = "";
      setResendEligible(false);
    } catch {}

    // HARD RULE: admin flow must never land on customer login by history/back.
    if (isAdminFlow) {
      router.push("/admin/login");
      return;
    }

    try {
      if (typeof window !== "undefined" && window.history.length > 1) router.back();
      else router.push(redirectTo || "/");
    } catch {
      router.push(redirectTo || "/");
    }
  }

  const backHref = isAdminFlow ? "/admin/login" : "/login";

  // Hard cleanup on unmount (route change / panel unmount)
  useEffect(() => {
    return () => {
      try {
        if (timerRef.current) {
          try {
            setResendEligible(false);
            endReasonRef.current = "";
          } catch {}
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } catch {}
      try {
        sendAbortRef.current?.abort?.();
      } catch {}
      try {
        abortCtrlRef.current?.abort();
      } catch {}
      try {
        if (to && purpose) {
          clearActiveOtp(
            otpActiveKey({
              identifier: to,
              via,
              purpose,
              scope: isAdminFlow ? "admin" : "customer", sessionId })
          );
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={`${PAGE_PADDING_X} ${PAGE_PADDING_Y}`}>
      <div className="mx-auto max-w-4xl">
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute inset-0 rounded-[28px] blur-xl opacity-80"
            style={{ background: NAVY_GRAD }}
          />

          <div
            className="relative rounded-[24px] border shadow-[0_18px_40px_rgba(0,0,0,0.65)] border-[rgba(255,255,255,0.08)] bg-[rgba(8,15,32,0.97)] backdrop-blur-md overflow-hidden"
            style={{ color: "#f9fafb" }}
          >
            <div className={`${CARD_PADDING_X} ${CARD_PADDING_Y_TOP} ${CARD_PADDING_Y_BOTTOM} flex flex-col gap-6`}>
              <div className="flex flex-col items-center text-center gap-3 max-w-xl mx-auto">
                {context.pill && (
                  <span className="inline-flex items-center rounded-full border border-[rgba(226,232,255,0.28)] bg-[rgba(15,23,42,0.85)] px-3 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase text-[rgba(226,232,255,0.9)] whitespace-nowrap">
                    {context.pill}
                  </span>
                )}

                <h1 className="text-[22px] md:text-[24px] font-semibold leading-snug tracking-tight text-[rgba(239,242,255,0.96)]">
                  {context.title || "Enter the 6-digit code"}
                </h1>

                <p className="text-xs md:text-[13px] text-[rgba(209,213,255,0.94)] leading-relaxed">
                  {mask ? (
                    <>
                      We sent a 6-digit code to <span className="font-semibold text-white">{mask}</span> via{" "}
                      <span className="font-semibold text-white">{viaLabel}</span>.
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

                {expires > 0 && (
                  <div className="mt-1 inline-flex items-center rounded-full border border-[rgba(148,163,255,0.45)] bg-[rgba(15,23,42,0.9)] px-3 py-1 text-[11px] font-medium text-[rgba(199,210,254,0.98)]">
                    <span className="opacity-80 pr-1">Code valid for</span>
                    <span className="tabular-nums font-semibold">{fmt(expires)}</span>
                  </div>
                )}
              </div>

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
                        onPaste={handlePaste}
                        className="flex-1 max-w-[48px] aspect-square rounded-[12px] text-center text-[20px] font-semibold outline-none"
                        style={{
                          backgroundColor: "#f9fafb",
                          border: digits[idx] ? "2px solid rgba(30,64,175,0.9)" : `1.5px solid ${GREY_BORDER}`,
                          color: NAVY,
                          boxShadow: digits[idx] ? "0 0 0 1px rgba(59,130,246,0.4)" : "0 0 0 0 rgba(0,0,0,0)",
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${RESEND_ROW_GAP} w-full max-w-[360px] mx-auto`}>
                  <p className="text-[11px] text-slate-300/85 leading-snug">Didn&apos;t get a code?</p>
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
                    {expires > 0 ? `Resend in ${fmt(expires)}` : sending ? "Sending…" : "Resend code"}
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

              <div className={`max-w-[420px] ${CTA_BLOCK_MARGIN_TOP} ${CTA_BLOCK_MARGIN_BOTTOM}`}>
                <button
                  type="button"
                  onClick={() => {
                    autoVerifyRef.current = false;
                    verify();
                  }}
                  disabled={!canVerify}
                  className="w-full inline-flex items-center justify-center rounded-[999px] px-8 py-[13px] md:py-[14px] text-[15px] md:text-[16px] font-semibold tracking-[0.03em] text-slate-950 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    backgroundImage: "linear-gradient(135deg,#fde68a 0%,#fbbf24 40%,#d97706 100%)",
                    boxShadow: canVerify ? "0 14px 32px rgba(0,0,0,0.7)" : "0 10px 24px rgba(0,0,0,0.45)",
                  }}
                >
                  {verifying ? "Verifying…" : context.cta}
                </button>

                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-3 w-full inline-flex items-center justify-center rounded-[999px] border border-[#fbbf24] bg-transparent px-8 py-[11px] text-[13px] font-semibold text-[#fbbf24] hover:bg-[#fbbf24] hover:text-slate-950 transition-all duration-150"
                >
                  Close
                </button>
              </div>

              <div className={`space-y-2 ${CTA_TO_HELPER_GAP}`}>
                <p className="text-center text-[11px] md:text-[12px] text-[rgba(209,213,255,0.9)] leading-snug">
                  Wrong {viaLabel === "email" ? "email address" : "phone number"}?{" "}
                  <a href={backHref} className="underline underline-offset-2 font-medium" style={{ color: "#f9fafb" }}>
                    Go back & change it
                  </a>
                </p>

                {isAdminFlow && (
                  <p className="text-[10.5px] text-center text-[rgba(186,197,255,0.95)] leading-relaxed">
                    For admin/staff accounts, this OTP protects refunds, stock updates and role-based actions.
                  </p>
                )}

                {context.kind === "cod" && (
                  <p className="text-[10.5px] text-center text-[rgba(186,197,255,0.95)] leading-relaxed">
                    For Cash-on-Delivery orders, we only ship after confirming this number. This reduces fake orders.
                  </p>
                )}
              </div>

              <div className="text-[10px] text-center text-[rgba(186,197,255,0.55)]">
                {isAdminFlow ? "Admin OTP" : "Customer OTP"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}