// FILE: app/(admin)/admin/login/otp/page.jsx
import React from "react";
import { redirect } from "next/navigation";
import OtpForm from "@/components/auth/otpform"; // shared OTP UI (admin hints passed via props)

function first(v) {
  if (v == null) return "";
  return Array.isArray(v) ? String(v[0] ?? "") : String(v);
}

function isSafeAdminRedirect(p) {
  const s = String(p || "").trim();
  if (!s) return false;
  if (!s.startsWith("/admin")) return false;
  if (s.startsWith("//")) return false;
  if (s.includes("://")) return false;
  if (s.includes("\n") || s.includes("\r")) return false;
  return true;
}

function normalizeRedirect(redirectRaw, callbackUrlRaw) {
  const r = String(redirectRaw || "").trim();
  const cb = String(callbackUrlRaw || "").trim();

  // remove all whitespace to prevent hidden chars
  const rClean = r.replace(/\s+/g, "");
  const cbClean = cb.replace(/\s+/g, "");

  if (isSafeAdminRedirect(rClean)) return rClean;
  if (isSafeAdminRedirect(cbClean)) return cbClean;
  return "/admin";
}

export default async function AdminLoginOtpPage({ searchParams }) {
  // ✅ Next.js 15: searchParams must be awaited before property access
  const sp = await searchParams;

  const currentAdmin = first(sp?.admin);
  const currentRbac = first(sp?.rbac);
  const currentPurpose = first(sp?.purpose);

  const currentRedirect = first(sp?.redirect);
  const currentCallbackUrl = first(sp?.callbackUrl);

  // Preserve anything already provided by the previous step (identifier/to/via/etc.)
  const qp = new URLSearchParams();

  // Carry through common otp params (keep legacy + modern)
  const passthroughKeys = [
    "identifier",
    "to",
    "via",
    "remember",
    "session",
    "sent",
    "checkout",
    "callbackUrl",
    "email",
    "phone",
    "country",
    "mode",
  ];

  for (const k of passthroughKeys) {
    const val = first(sp?.[k]);
    if (val) qp.set(k, val);
  }

  // ✅ CRITICAL WIRING FIX:
  // If caller used email= or phone= but did not provide identifier/to,
  // force identifier so the shared OtpForm can bootstrap and show timer.
  if (!qp.get("identifier") && !qp.get("to")) {
    const email = first(sp?.email);
    const phone = first(sp?.phone);
    const fallback = email || phone;
    if (fallback) qp.set("identifier", fallback);
  }

  // Force admin intent flags (idempotent)
  qp.set("admin", "1");
  qp.set("rbac", "1");

  // Force an admin-purpose if missing/invalid for admin
  const purpose = String(currentPurpose || "")
    .trim()
    .toLowerCase()
    .startsWith("rbac_")
    ? String(currentPurpose).trim()
    : "rbac_login";
  qp.set("purpose", purpose);

  // Force redirect to admin-only internal path (never external, never customer)
  const desiredRedirect = normalizeRedirect(currentRedirect, currentCallbackUrl);
  qp.set("redirect", desiredRedirect);

  // Normalize URL once if missing required admin params / unsafe redirect.
  const needsNormalize =
    currentAdmin !== "1" ||
    currentRbac !== "1" ||
    !String(currentPurpose || "")
      .trim()
      .toLowerCase()
      .startsWith("rbac_") ||
    !isSafeAdminRedirect(
      String(currentRedirect || "").trim() || String(currentCallbackUrl || "").trim()
    );

  if (needsNormalize) {
    redirect(`/admin/login/otp?${qp.toString()}`);
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        width: "100%",
        display: "grid",
        placeItems: "center",
        padding: "0",
      }}
    >
      {/* IMPORTANT: admin-plane hints to OtpForm */}
      <OtpForm
        scope="admin"
        purpose={purpose}
        redirectTo={desiredRedirect}
        authBasePath="/api/admin/auth"
        sessionEndpoint="/api/admin/session"
      />
    </main>
  );
}
