//✅ FILE: src/components/auth/adminloginform.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * AdminLoginForm (RBAC):
 * Step 1: password -> ADMIN route (NO NextAuth; prevents customer session coupling)
 * Step 2: request OTP via /api/admin/auth/request-otp only (no fallback to customer/universal)
 * Step 3: redirect to /admin/login/otp
 *
 * NOTE: Admin/staff must verify OTP every login (no trust device).
 *
 * Added (no deletions):
 * - Password Recovery mode:
 *    Step A: request recovery OTP via /api/admin/auth/request-otp (purpose=password_change)
 *    Step B: reset password via /api/admin/auth/reset-password
 */

const UI = {
  NAVY: "#0F2147",
  BLACK: "#0B1220",

  BORDER: "rgba(15,33,71,0.14)",
  BORDER2: "rgba(15,33,71,0.20)",

  SURFACE: "rgba(255,255,255,0.96)",
  SURFACE2: "rgba(255,255,255,0.995)",
  FIELD_TOP: "rgba(255,255,255,0.98)",
  FIELD_BOT: "rgba(244,247,255,0.94)",

  PAGE_BG_TOP: "rgba(248,250,255,1)",
  PAGE_BG_BOT: "rgba(238,244,255,1)",

  GOLD: "#D4AF37",
  GOLD_SOFT: "rgba(212,175,55,0.14)",

  ERROR: "#B91C1C",
  ERROR_BG: "rgba(185,28,28,0.06)",
  OK: "#166534",
  OK_BG: "rgba(22,101,52,0.06)",
  INFO_BG: "rgba(15,33,71,0.06)",
};

const STORAGE = {
  ADMIN_LOGIN_NOTE: "tdlc_admin_login_note_v1",
  ADMIN_LOGIN_ID: "tdlc_admin_login_identifier_v1",
  ADMIN_LOGIN_VIA: "tdlc_admin_login_via_v1",
  ADMIN_LOGIN_REDIRECT: "tdlc_admin_login_redirect_v1",
};

const isPhoneish = (v) => /^\+?\d[\d\s\-()]*$/.test(String(v || ""));
const isEmailish = (v) => /\S+@\S+\.\S+/.test(String(v || ""));

function safeAdminPath(p, fallback = "/admin") {
  const s = String(p || "").trim();
  if (!s) return fallback;
  if (!s.startsWith("/")) return fallback;
  if (s.startsWith("//")) return fallback;
  if (!s.startsWith("/admin")) return "/admin";
  return s;
}

function normalizeIdentifier(raw) {
  const r = String(raw || "").trim();
  if (!r) return "";
  if (isEmailish(r)) return r.toLowerCase();
  return r;
}

function toE164(raw) {
  try {
    const s = String(raw || "").trim();
    const p = parsePhoneNumberFromString(s, "BD");
    if (p?.isValid()) return p.number;

    if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
    return s.replace(/[^\d]/g, "");
  } catch {
    const s = String(raw || "").trim();
    return s.startsWith("+") ? s.replace(/[^\d+]/g, "") : s.replace(/[^\d]/g, "");
  }
}

function humanizeError(msg) {
  const m = String(msg || "");
  if (!m) return "Failed. Try again.";
  if (m.includes("CredentialsSignin")) return "Invalid credentials.";
  if (m.includes("ACCOUNT_NOT_FOUND") || m.includes("USER_NOT_FOUND")) return "Account not found.";
  if (m.includes("OTP_NOT_FOUND_OR_EXPIRED")) return "OTP expired. Request again.";
  if (m.toLowerCase().includes("unauthorized")) return "Unauthorized.";
  if (m.includes("NOT_FOUND") || m.includes("Endpoint not found")) return "Service endpoint not found. Please verify server routes.";
  return m;
}

/* ---------- UI atoms ---------- */
function Pill({ children }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        border: `1px solid ${UI.BORDER}`,
        padding: "5px 10px",
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: "0.16em",
        color: UI.NAVY,
        background: UI.SURFACE2,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function LabelRow({ label, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.20em", color: UI.NAVY }}>{label}</div>
      {right ? <div style={{ fontSize: 11, fontWeight: 800, color: UI.BLACK }}>{right}</div> : null}
    </div>
  );
}

function PondField({ error, children }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${error ? "rgba(185,28,28,0.32)" : UI.BORDER}`,
        padding: 8,
        background: `linear-gradient(180deg, ${UI.FIELD_TOP} 0%, ${UI.FIELD_BOT} 100%)`,
        boxShadow: error
          ? "inset 0 2px 10px rgba(185,28,28,0.10), 0 12px 26px rgba(15,33,71,0.10)"
          : "inset 0 2px 10px rgba(15,33,71,0.10), 0 12px 26px rgba(15,33,71,0.10)",
      }}
    >
      {children}
    </div>
  );
}

function FieldError({ children }) {
  if (!children) return null;
  return <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: UI.ERROR }}>{children}</div>;
}

function ChannelChip({ active, children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 999,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 900,
        border: `1px solid ${active ? "rgba(212,175,55,0.45)" : UI.BORDER}`,
        background: active ? "rgba(212,175,55,0.14)" : UI.SURFACE2,
        color: UI.BLACK,
        boxShadow: active ? "0 12px 22px rgba(15,33,71,0.10)" : "0 10px 18px rgba(15,33,71,0.06)",
        opacity: disabled ? 0.65 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function StatusBar({ kind, text }) {
  if (!text) return null;
  const style =
    kind === "error"
      ? { borderColor: "rgba(185,28,28,0.22)", background: UI.ERROR_BG, color: UI.ERROR }
      : kind === "success"
      ? { borderColor: "rgba(22,101,52,0.20)", background: UI.OK_BG, color: UI.OK }
      : { borderColor: UI.BORDER, background: UI.INFO_BG, color: UI.NAVY };

  return (
    <div
      style={{
        marginTop: 14,
        borderRadius: 14,
        border: `1px solid ${style.borderColor}`,
        background: style.background,
        color: style.color,
        padding: "10px 12px",
        fontSize: 13,
        fontWeight: 900,
      }}
    >
      {text}
    </div>
  );
}

/* ---------- Component ---------- */
export default function AdminLoginForm({ redirectTo = "/admin" }) {
  const router = useRouter();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [adminNote, setAdminNote] = useState("");

  const [channel, setChannel] = useState("sms"); // sms | whatsapp
  const [showPw, setShowPw] = useState(false);

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ kind: "", text: "" });
  const [fieldErr, setFieldErr] = useState({ id: "", password: "", adminNote: "" });

  // Recovery (additive)
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState(1); // 1=request OTP, 2=reset password
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryNewPw, setRecoveryNewPw] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [recoveryShowPw, setRecoveryShowPw] = useState(false);
  const [recoveryShowConfirm, setRecoveryShowConfirm] = useState(false);
  const [recoveryVia, setRecoveryVia] = useState("");
  const [recoveryTtl, setRecoveryTtl] = useState(0);

  const lastOtpReqAtRef = useRef(0);

  const redirectSafe = useMemo(() => safeAdminPath(redirectTo || "/admin", "/admin"), [redirectTo]);
  const idRaw = useMemo(() => normalizeIdentifier(identifier), [identifier]);

  const isValidEmail = useMemo(() => isEmailish(idRaw), [idRaw]);
  const isValidPhone = useMemo(() => {
    if (!isPhoneish(idRaw)) return false;
    const e164 = toE164(idRaw);
    return /^\+\d{8,}$/.test(e164 || "");
  }, [idRaw]);

  const idValid = isValidEmail || isValidPhone;

  const effectiveChannel = useMemo(() => {
    if (!idValid) return "";
    if (isValidEmail) return "email";
    return channel;
  }, [idValid, isValidEmail, channel]);

  useEffect(() => {
    router.prefetch?.("/admin/login/otp");
    router.prefetch?.("/admin");
  }, [router]);

  async function postJsonWithFallback(endpoints, body) {
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
          body: JSON.stringify(body),
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
        continue;
      }

      return { ok: r.ok, json: lastJson, status: r.status, used: ep };
    }

    return { ok: false, json: lastJson, status: lastStatus || (saw404 ? 404 : 0), used: "" };
  }

  /**
   * Admin login must not touch NextAuth/customer auth routes.
   * We verify credentials + request OTP via ADMIN route only.
   */
  async function requestAdminOtpAfterPassword({ id, preferredChannel, passwordPlain }) {
    const now = Date.now();
    if (now - lastOtpReqAtRef.current < 900) return preferredChannel;
    lastOtpReqAtRef.current = now;

    const body = {
      identifier: id,
      to: id,
      channel: preferredChannel, // sms | whatsapp | email
      via: preferredChannel,
      purpose: "rbac_login",
      adminLogin: true,
      rememberDevice: false,
      adminNote: String(adminNote || "").trim(),

      // ✅ send password to admin endpoint so it can reject wrong credentials
      password: String(passwordPlain || ""),
      type: "password",
    };

    const endpoints = ["/api/admin/auth/request-otp"]; // ✅ NO fallback to /api/auth/*
    const out = await postJsonWithFallback(endpoints, body);

    if (out.status === 404) throw new Error("Endpoint not found: /api/admin/auth/request-otp");
    if (!out.ok) throw new Error(out?.json?.error || "OTP send failed.");
    return out?.json?.channel || out?.json?.via || preferredChannel;
  }

  // Recovery OTP (admin)
  async function requestAdminRecoveryOtp(id, preferredChannel) {
    const now = Date.now();
    if (now - lastOtpReqAtRef.current < 900) return preferredChannel;
    lastOtpReqAtRef.current = now;

    const body = {
      identifier: id,
      to: id,
      channel: preferredChannel,
      via: preferredChannel,
      purpose: "password_change",
      adminLogin: true,
      rememberDevice: false,
      adminNote: String(adminNote || "").trim(),
    };

    const endpoints = ["/api/admin/auth/request-otp"];
    const out = await postJsonWithFallback(endpoints, body);

    if (out.status === 404) {
      throw new Error("Endpoint not found: /api/admin/auth/request-otp");
    }
    if (!out.ok) throw new Error(out?.json?.error || "OTP send failed.");
    return {
      via: out?.json?.channel || out?.json?.via || preferredChannel,
      ttlSeconds: Number(out?.json?.ttlSeconds || 600),
    };
  }

  async function resetAdminPassword({ identifier: id, code, newPassword }) {
    const body = {
      identifier: id,
      code,
      newPassword,
      purpose: "password_change",
      adminLogin: true,
      adminNote: String(adminNote || "").trim(),
    };

    const endpoints = ["/api/admin/auth/reset-password"];
    const out = await postJsonWithFallback(endpoints, body);

    if (out.status === 404) {
      throw new Error("Endpoint not found: /api/admin/auth/reset-password");
    }
    if (!out.ok) throw new Error(out?.json?.error || "Reset failed.");
    if (!out?.json?.ok) throw new Error(out?.json?.error || "Reset failed.");
    return out.json;
  }

  function persistHandoff({ id, via }) {
    try {
      sessionStorage.setItem(STORAGE.ADMIN_LOGIN_NOTE, String(adminNote || "").trim());
      sessionStorage.setItem(STORAGE.ADMIN_LOGIN_ID, String(id || ""));
      sessionStorage.setItem(STORAGE.ADMIN_LOGIN_VIA, String(via || ""));
      sessionStorage.setItem(STORAGE.ADMIN_LOGIN_REDIRECT, redirectSafe);
    } catch {}
  }

  function openRecovery() {
    setStatusMsg({ kind: "", text: "" });
    setRecoveryOpen(true);
    setRecoveryStep(1);
    setRecoveryCode("");
    setRecoveryNewPw("");
    setRecoveryConfirm("");
    setRecoveryVia("");
    setRecoveryTtl(0);
  }

  function closeRecovery() {
    setRecoveryOpen(false);
    setRecoveryStep(1);
    setRecoveryCode("");
    setRecoveryNewPw("");
    setRecoveryConfirm("");
    setRecoveryVia("");
    setRecoveryTtl(0);
  }

  async function onSubmit(e) {
    e.preventDefault();

    setStatusMsg({ kind: "", text: "" });
    setFieldErr({ id: "", password: "", adminNote: "" });

    const raw = idRaw.trim();
    const id = isPhoneish(raw) ? toE164(raw) : raw;

    // Shared validation (identifier + note always required in this admin form)
    const baseErr = { id: "", password: "", adminNote: "" };
    if (!id) baseErr.id = "Required.";
    else if (!idValid) baseErr.id = "Invalid email/phone.";
    if (!String(adminNote || "").trim()) baseErr.adminNote = "Required.";

    // Branch: recovery vs login
    if (recoveryOpen) {
      setFieldErr({ ...baseErr, password: "" });
      if (baseErr.id || baseErr.adminNote) return;

      setLoading(true);
      try {
        const preferred = isValidEmail ? "email" : channel;

        if (recoveryStep === 1) {
          setStatusMsg({ kind: "info", text: "Sending recovery OTP…" });
          const out = await requestAdminRecoveryOtp(id, preferred);
          setRecoveryVia(String(out?.via || preferred));
          setRecoveryTtl(Number(out?.ttlSeconds || 600));
          setRecoveryStep(2);
          setStatusMsg({ kind: "success", text: "Recovery OTP sent." });
          return;
        }

        const code = String(recoveryCode || "").trim();
        const pw1 = String(recoveryNewPw || "");
        const pw2 = String(recoveryConfirm || "");

        if (!/^\d{6}$/.test(code)) {
          setStatusMsg({ kind: "error", text: "Enter the 6-digit OTP." });
          return;
        }
        if (!pw1 || pw1.length < 8) {
          setStatusMsg({ kind: "error", text: "New password must be at least 8 characters." });
          return;
        }
        if (pw1 !== pw2) {
          setStatusMsg({ kind: "error", text: "Passwords do not match." });
          return;
        }

        setStatusMsg({ kind: "info", text: "Updating password…" });
        await resetAdminPassword({ identifier: id, code, newPassword: pw1 });

        setPassword(pw1);
        closeRecovery();

        setStatusMsg({ kind: "success", text: "Password updated. Please sign in with your new password." });
      } catch (err) {
        setStatusMsg({ kind: "error", text: humanizeError(err?.message) });
      } finally {
        setLoading(false);
      }

      return;
    }

    // Normal login validation (password required)
    if (!password) baseErr.password = "Required.";
    setFieldErr(baseErr);
    if (baseErr.id || baseErr.password || baseErr.adminNote) return;

    setLoading(true);
    try {
      setStatusMsg({ kind: "info", text: "Verifying…" });

      const preferred = isValidEmail ? "email" : channel;

      // ✅ Admin-only password verification + OTP request (no NextAuth)
      setStatusMsg({ kind: "info", text: "Sending OTP…" });
      const via = await requestAdminOtpAfterPassword({ id, preferredChannel: preferred, passwordPlain: password });

      persistHandoff({ id, via });

      const params = new URLSearchParams({
        identifier: id,
        purpose: "rbac_login",
        redirect: redirectSafe,
        via: String(via || preferred),
        mode: "2fa",
        sent: "1",
      });

      setStatusMsg({ kind: "success", text: "OTP sent." });
      router.push(`/admin/login/otp?${params.toString()}`);
    } catch (err) {
      setStatusMsg({ kind: "error", text: humanizeError(err?.message) });
    } finally {
      setLoading(false);
    }
  }

  const ctaLabel = useMemo(() => {
    if (!recoveryOpen) return loading ? "WORKING…" : "CONTINUE";
    if (recoveryStep === 1) return loading ? "WORKING…" : "SEND RECOVERY OTP";
    return loading ? "WORKING…" : "RESET PASSWORD";
  }, [recoveryOpen, recoveryStep, loading]);

  return (
    <section
      data-tdlc-adminloginform-shell="v5"
      style={{
        width: "100%",
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "28px 16px",
        background: `linear-gradient(180deg, ${UI.PAGE_BG_TOP} 0%, ${UI.PAGE_BG_BOT} 100%)`,
      }}
    >
      <div style={{ width: 420, maxWidth: "calc(100vw - 32px)", margin: "0 auto" }}>
        <div
          style={{
            borderRadius: 24,
            border: `1px solid ${UI.BORDER}`,
            background: UI.SURFACE,
            boxShadow: "0 28px 90px rgba(15,33,71,0.16)",
            padding: 18,
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: UI.GOLD,
                  boxShadow: `0 0 0 7px ${UI.GOLD_SOFT}`,
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 950, color: UI.BLACK }}>Admin Sign-In</div>
              <Pill>Password → OTP</Pill>
              {recoveryOpen ? <Pill>Recovery</Pill> : null}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: UI.NAVY }}>Redirect</span>
              <span
                title={redirectSafe}
                style={{
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  borderRadius: 999,
                  border: `1px solid ${UI.BORDER}`,
                  background: UI.SURFACE2,
                  color: UI.BLACK,
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                {redirectSafe}
              </span>
            </div>
          </div>

          <StatusBar kind={statusMsg.kind} text={statusMsg.text} />

          <form onSubmit={onSubmit} style={{ marginTop: 14 }}>
            {/* IDENTIFIER */}
            <div style={{ marginTop: 8 }}>
              <LabelRow
                label="IDENTIFIER"
                right={
                  idValid
                    ? `OTP: ${
                        effectiveChannel === "whatsapp"
                          ? "WhatsApp"
                          : effectiveChannel === "sms"
                          ? "SMS"
                          : effectiveChannel === "email"
                          ? "Email"
                          : ""
                      }`
                    : ""
                }
              />
              <PondField error={fieldErr.id}>
                <input
                  name="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@tdlc.co or +8801…"
                  aria-invalid={fieldErr.id ? "true" : "false"}
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: UI.BLACK,
                    fontSize: 13,
                    fontWeight: 900,
                    padding: "10px 12px",
                    borderRadius: 14,
                  }}
                />
              </PondField>
              <FieldError>{fieldErr.id}</FieldError>

              {idValid && !isValidEmail ? (
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <ChannelChip active={channel === "sms"} onClick={() => setChannel("sms")} disabled={loading}>
                    SMS
                  </ChannelChip>
                  <ChannelChip active={channel === "whatsapp"} onClick={() => setChannel("whatsapp")} disabled={loading}>
                    WhatsApp
                  </ChannelChip>
                </div>
              ) : null}
            </div>

            {/* PASSWORD (unchanged UI) */}
            <div style={{ marginTop: 14 }}>
              <LabelRow
                label="PASSWORD"
                right={
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: UI.BLACK }}>Staff credentials</span>
                    <button
                      type="button"
                      onClick={() => (recoveryOpen ? closeRecovery() : openRecovery())}
                      disabled={loading}
                      style={{
                        border: "none",
                        background: "transparent",
                        padding: 0,
                        margin: 0,
                        fontSize: 11,
                        fontWeight: 950,
                        letterSpacing: "0.10em",
                        color: UI.NAVY,
                        textDecoration: "underline",
                        cursor: loading ? "not-allowed" : "pointer",
                        opacity: loading ? 0.7 : 1,
                      }}
                      title={recoveryOpen ? "Back to sign-in" : "Recover password"}
                    >
                      {recoveryOpen ? "BACK TO SIGN-IN" : "FORGOT PASSWORD?"}
                    </button>
                  </div>
                }
              />
              <PondField error={fieldErr.password}>
                <div style={{ position: "relative" }}>
                  <input
                    name="password"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-invalid={fieldErr.password ? "true" : "false"}
                    style={{
                      width: "100%",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: UI.BLACK,
                      fontSize: 13,
                      fontWeight: 900,
                      padding: "10px 82px 10px 12px",
                      borderRadius: 14,
                    }}
                    disabled={recoveryOpen}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      borderRadius: 999,
                      border: `1px solid ${UI.BORDER2}`,
                      background: UI.SURFACE2,
                      color: UI.BLACK,
                      fontSize: 12,
                      fontWeight: 900,
                      padding: "7px 10px",
                      cursor: "pointer",
                      opacity: recoveryOpen ? 0.6 : 1,
                    }}
                    disabled={recoveryOpen}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </PondField>
              <FieldError>{fieldErr.password}</FieldError>
            </div>

            {/* NOTE (unchanged; required for audit) */}
            <div style={{ marginTop: 14 }}>
              <LabelRow label="NOTE" right="Required for audit" />
              <PondField error={fieldErr.adminNote}>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={2}
                  placeholder="Short note…"
                  aria-invalid={fieldErr.adminNote ? "true" : "false"}
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: UI.BLACK,
                    fontSize: 13,
                    fontWeight: 900,
                    padding: "10px 12px",
                    borderRadius: 14,
                    resize: "none",
                  }}
                />
              </PondField>
              <FieldError>{fieldErr.adminNote}</FieldError>
            </div>

            {/* Recovery panel (unchanged UI) */}
            {recoveryOpen ? (
              <div
                style={{
                  marginTop: 14,
                  borderRadius: 18,
                  border: `1px solid ${UI.BORDER}`,
                  background: UI.SURFACE2,
                  boxShadow: "0 14px 34px rgba(15,33,71,0.07)",
                  padding: "12px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 950, letterSpacing: "0.20em", color: UI.NAVY }}>
                    PASSWORD RECOVERY
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Pill>{recoveryStep === 1 ? "OTP" : "OTP → NEW PASSWORD"}</Pill>
                  </div>
                </div>

                {recoveryStep === 1 ? (
                  <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: UI.BLACK }}>
                    Send a recovery OTP to{" "}
                    <span style={{ color: UI.NAVY }}>
                      {isValidEmail ? "Email" : channel === "whatsapp" ? "WhatsApp" : "SMS"}
                    </span>
                    .
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: UI.BLACK }}>
                    OTP sent via{" "}
                    <span style={{ color: UI.NAVY }}>{String(recoveryVia || (isValidEmail ? "email" : channel))}</span>
                    {recoveryTtl ? (
                      <span style={{ color: "rgba(15,33,71,0.70)" }}>
                        {" "}
                        (valid ~{Math.max(1, Math.round(Number(recoveryTtl) / 60))} min)
                      </span>
                    ) : null}
                    .
                  </div>
                )}

                {recoveryStep === 2 ? (
                  <>
                    <div style={{ marginTop: 12 }}>
                      <LabelRow label="RECOVERY OTP" right="6 digits" />
                      <PondField error={false}>
                        <input
                          value={recoveryCode}
                          onChange={(e) => setRecoveryCode(String(e.target.value || "").replace(/[^\d]/g, "").slice(0, 6))}
                          inputMode="numeric"
                          placeholder="123456"
                          style={{
                            width: "100%",
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            color: UI.BLACK,
                            fontSize: 13,
                            fontWeight: 900,
                            padding: "10px 12px",
                            borderRadius: 14,
                            textAlign: "center",
                            letterSpacing: "0.35em",
                          }}
                        />
                      </PondField>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <LabelRow label="NEW PASSWORD" right="Min 8 chars" />
                      <PondField error={false}>
                        <div style={{ position: "relative" }}>
                          <input
                            type={recoveryShowPw ? "text" : "password"}
                            value={recoveryNewPw}
                            onChange={(e) => setRecoveryNewPw(e.target.value)}
                            autoComplete="new-password"
                            placeholder="••••••••"
                            style={{
                              width: "100%",
                              border: "none",
                              outline: "none",
                              background: "transparent",
                              color: UI.BLACK,
                              fontSize: 13,
                              fontWeight: 900,
                              padding: "10px 82px 10px 12px",
                              borderRadius: 14,
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setRecoveryShowPw((s) => !s)}
                            style={{
                              position: "absolute",
                              right: 8,
                              top: "50%",
                              transform: "translateY(-50%)",
                              borderRadius: 999,
                              border: `1px solid ${UI.BORDER2}`,
                              background: UI.SURFACE2,
                              color: UI.BLACK,
                              fontSize: 12,
                              fontWeight: 900,
                              padding: "7px 10px",
                              cursor: "pointer",
                            }}
                          >
                            {recoveryShowPw ? "Hide" : "Show"}
                          </button>
                        </div>
                      </PondField>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <LabelRow label="CONFIRM PASSWORD" right="" />
                      <PondField error={false}>
                        <div style={{ position: "relative" }}>
                          <input
                            type={recoveryShowConfirm ? "text" : "password"}
                            value={recoveryConfirm}
                            onChange={(e) => setRecoveryConfirm(e.target.value)}
                            autoComplete="new-password"
                            placeholder="••••••••"
                            style={{
                              width: "100%",
                              border: "none",
                              outline: "none",
                              background: "transparent",
                              color: UI.BLACK,
                              fontSize: 13,
                              fontWeight: 900,
                              padding: "10px 82px 10px 12px",
                              borderRadius: 14,
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => setRecoveryShowConfirm((s) => !s)}
                            style={{
                              position: "absolute",
                              right: 8,
                              top: "50%",
                              transform: "translateY(-50%)",
                              borderRadius: 999,
                              border: `1px solid ${UI.BORDER2}`,
                              background: UI.SURFACE2,
                              color: UI.BLACK,
                              fontSize: 12,
                              fontWeight: 900,
                              padding: "7px 10px",
                              cursor: "pointer",
                            }}
                          >
                            {recoveryShowConfirm ? "Hide" : "Show"}
                          </button>
                        </div>
                      </PondField>
                    </div>

                    <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (loading) return;
                          setRecoveryStep(1);
                          setRecoveryCode("");
                          setRecoveryNewPw("");
                          setRecoveryConfirm("");
                          setRecoveryVia("");
                          setRecoveryTtl(0);
                          setStatusMsg({ kind: "", text: "" });
                        }}
                        disabled={loading}
                        style={{
                          borderRadius: 999,
                          border: `1px solid ${UI.BORDER}`,
                          background: UI.SURFACE,
                          color: UI.NAVY,
                          padding: "10px 12px",
                          fontSize: 11,
                          fontWeight: 950,
                          letterSpacing: "0.14em",
                          cursor: loading ? "not-allowed" : "pointer",
                          opacity: loading ? 0.8 : 1,
                        }}
                      >
                        REQUEST NEW OTP
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (loading) return;
                          closeRecovery();
                          setStatusMsg({ kind: "", text: "" });
                        }}
                        disabled={loading}
                        style={{
                          borderRadius: 999,
                          border: `1px solid ${UI.BORDER}`,
                          background: UI.SURFACE,
                          color: UI.ERROR,
                          padding: "10px 12px",
                          fontSize: 11,
                          fontWeight: 950,
                          letterSpacing: "0.14em",
                          cursor: loading ? "not-allowed" : "pointer",
                          opacity: loading ? 0.8 : 1,
                        }}
                      >
                        CANCEL
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* Bottom bar (CTA styling unchanged; label adapts in recovery mode) */}
            <div
              style={{
                marginTop: 14,
                borderRadius: 18,
                border: `1px solid ${UI.BORDER}`,
                background: UI.SURFACE2,
                boxShadow: "0 14px 34px rgba(15,33,71,0.07)",
                padding: "12px 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="submit"
                disabled={loading}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${UI.BORDER}`,
                  background: "linear-gradient(180deg, rgba(15,33,71,0.96) 0%, rgba(15,33,71,1) 100%)",
                  color: "#FFFFFF",
                  padding: "12px 18px",
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: "0.22em",
                  boxShadow: "0 22px 70px rgba(15,33,71,0.22)",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.82 : 1,
                }}
              >
                {ctaLabel}
              </button>
            </div>
          </form>

          <style jsx global>{`
            :where([data-tdlc-adminloginform-shell="v5"]) input::placeholder,
            :where([data-tdlc-adminloginform-shell="v5"]) textarea::placeholder {
              color: rgba(15, 33, 71, 0.55) !important;
              font-weight: 800;
            }
          `}</style>
        </div>
      </div>
    </section>
  );
}
