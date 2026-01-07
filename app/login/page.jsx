// FILE: app/login/page.jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import LoginForm from "@/components/auth/loginform.jsx";
import Navbar from "@/components/common/navbar";
import BottomFloatingBar from "@/components/common/bottomfloatingbar";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const redirectToRaw = searchParams.get("redirect") || "/customer/dashboard";

  // Internal-only redirect safety
  const redirectTo = useMemo(() => {
    const v = String(redirectToRaw || "/customer/dashboard");
    return v.startsWith("/") ? v : "/customer/dashboard";
  }, [redirectToRaw]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    router.prefetch("/login");
    router.prefetch("/login/otp");
    router.prefetch("/customer/dashboard");
  }, [router]);

  useEffect(() => {
    if (status === "loading") return;

    const authed = status === "authenticated" && !!session?.user;

    const providerRaw =
      session?.authProvider ||
      session?.user?.authProvider ||
      session?.user?.provider ||
      session?.user?.loginProvider ||
      session?.user?.loginMethod ||
      "";

    const provider = String(providerRaw || "").toLowerCase();
    const isOAuth = provider === "google" || provider === "facebook";

    // RULE:
    // - OAuth (google/facebook): allow without 2FA
    // - Non-OAuth: require 2FA === true
    const canEnter = authed && (isOAuth ? true : session?.twoFactorPassed === true);

    if (canEnter) {
      router.replace(redirectTo);
      return;
    }

    setLoading(false);
  }, [status, session, router, redirectTo]);

  if (loading) {
    return (
      <>
        <Navbar />
        <main
          className="min-h-[100dvh] flex items-center justify-center px-3 md:px-6"
          style={{ paddingTop: 24, paddingBottom: 24 }}
        >
          <p className="text-neutral-600">Loading…</p>
        </main>
        <BottomFloatingBar />
      </>
    );
  }

  return (
    <>
      <Navbar />
      {/*
        Keep structure intact; only tighten page margins.
        LoginForm already handles its internal layout; we only constrain the outer container.
      */}
      <div className="w-full max-w-[1180px] mx-auto px-2 md:px-4" style={{ marginTop: -18 }}>
        <LoginForm />
      </div>
      <BottomFloatingBar />
    </>
  );
}
