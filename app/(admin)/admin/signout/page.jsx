// FILE: app/(admin)/admin/signout/page.jsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export default function AdminSignoutPage() {
  const router = useRouter();

  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const didRunRef = useRef(false);

  const doLogout = useCallback(async () => {
    setBusy(true);
    setError("");

    let redirectTo = "/admin/login";
    try {
      const sp = new URLSearchParams(window.location.search || "");
      const redirectRaw = sp.get("redirect") || "/admin/login";
      redirectTo = redirectRaw.startsWith("/admin") ? redirectRaw : "/admin/login";
    } catch {
      redirectTo = "/admin/login";
    }

    try {
      // IMPORTANT: credentials: "include" ensures admin cookies are sent.
      const res = await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      // Even if it fails, we still redirect to login to avoid being stuck
      await res.json().catch(() => null);
    } catch (e) {
      setError("Logout request failed. Redirecting to login…");
    } finally {
      setBusy(false);
      router.replace(redirectTo);
      // In App Router, refresh helps ensure any cached admin session UI is invalidated.
      try {
        if (typeof router.refresh === "function") router.refresh();
      } catch {}
    }
  }, [router]);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;
    doLogout();
  }, [doLogout]);

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 pt-12">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 text-center">
          Admin Sign out
        </h1>

        <p className="mt-3 text-center text-neutral-600">
          You’re being signed out securely from the Admin Panel. If nothing happens, use the button
          below.
        </p>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={doLogout}
            disabled={busy}
            className="rounded-full px-5 py-3 font-semibold border border-neutral-200 shadow-sm hover:shadow disabled:opacity-60"
          >
            {busy ? "Signing out…" : "Sign out now"}
          </button>
        </div>

        {error ? <p className="mt-4 text-xs text-red-600 text-center">{error}</p> : null}

        <p className="mt-6 text-xs text-neutral-500 text-center">
          This clears only admin cookies (RBAC/OTP/admin session). Customer login is not affected.
        </p>
      </div>
    </main>
  );
}
