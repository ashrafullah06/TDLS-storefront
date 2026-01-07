// FILE: app/(admin)/admin/login/page.jsx
import React from "react";
import AdminLoginForm from "@/components/auth/adminloginform";

function first(v) {
  if (v == null) return "";
  return Array.isArray(v) ? String(v[0] ?? "") : String(v);
}

function isSafeAdminRedirect(p) {
  const s = String(p || "").trim();
  if (!s.startsWith("/admin")) return false;
  if (s.startsWith("//")) return false;
  if (s.includes("://")) return false;
  if (s.includes("\n") || s.includes("\r")) return false;
  return true;
}

function normalizeRedirect(p) {
  const raw = String(p || "").trim();
  if (!raw) return "/admin";

  // Remove ALL whitespace to hard-block hidden chars / newline tricks
  const cleaned = raw.replace(/\s+/g, "");
  return isSafeAdminRedirect(cleaned) ? cleaned : "/admin";
}

export default async function AdminLoginPage(props) {
  // ✅ Next 15: props/searchParams may be async
  const awaitedProps = await props;
  const sp = await awaitedProps?.searchParams;

  // searchParams can be string OR array in Next
  const redirectRaw = first(sp?.redirect) || "/admin";
  const redirect = normalizeRedirect(redirectRaw);

  return (
    <main
      style={{
        minHeight: "100dvh",
        width: "100%",
        display: "grid",
        placeItems: "center",
        padding: "28px 16px",
      }}
    >
      {/* Hard width clamp so it can NEVER stretch full page */}
      <div style={{ width: 420, maxWidth: "calc(100vw - 32px)" }}>
        <AdminLoginForm redirectTo={redirect} />
      </div>
    </main>
  );
}
