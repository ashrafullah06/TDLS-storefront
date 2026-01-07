// FILE: src/components/admin/logout-pill.jsx
"use client";

import { signOut } from "next-auth/react";

const NAVY = "#0F2147";

/**
 * Premium logout CTA for admin/staff.
 *
 * IMPORTANT:
 * - Admin logout MUST NOT depend on customer session.
 * - Therefore, we try admin-only logout endpoints first (clears admin cookies),
 *   and only fall back to NextAuth signOut if needed.
 *
 * Props preserved:
 * - onClick (optional): external handler wins
 * - label, size, callbackUrl preserved
 *
 * Additive (non-breaking):
 * - useNextAuthFallback (default true): keep prior behavior as last resort
 */
export default function LogoutPill({
  onClick,
  label = "Logout",
  size = "md", // "sm" | "md" | "lg"
  callbackUrl = "/admin/login",
  useNextAuthFallback = true,
}) {
  const padding =
    size === "lg"
      ? "px-5 py-2.5"
      : size === "sm"
      ? "px-3 py-1.5"
      : "px-4 py-2";

  const textSize =
    size === "lg" ? "text-sm" : size === "sm" ? "text-[11px]" : "text-xs";

  async function adminOnlyLogoutBestEffort() {
    // Try common admin logout routes (no UI/UX change; best-effort cleanup).
    // If your project has a specific route, keep it here.
    const candidates = [
      "/api/admin/auth/logout",
      "/api/admin/logout",
      "/api/admin/session/logout",
    ];

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          credentials: "include",
          body: JSON.stringify({ reason: "admin_logout" }),
        });

        // Treat 200/204 as success; 404 means route not present; other non-2xx means ignore and continue.
        if (res.status === 200 || res.status === 204) return true;
        if (res.status === 404) continue;
      } catch {
        // ignore and continue
      }
    }
    return false;
  }

  async function handleClick() {
    // External handler wins (preserves existing behavior)
    if (typeof onClick === "function") {
      await onClick();
      return;
    }

    // Prefer admin-only logout (decouples admin from customer sessions)
    const ok = await adminOnlyLogoutBestEffort();

    // Always redirect to admin login after logout attempt
    // (keeps UX consistent; avoids rendering “role mismatch” states)
    if (ok) {
      window.location.assign(callbackUrl);
      return;
    }

    // Fallback: prior behavior (may couple if your NextAuth is shared)
    if (useNextAuthFallback) {
      await signOut({ callbackUrl });
      return;
    }

    // If no fallback allowed, still route away (prevents UI dead-end)
    window.location.assign(callbackUrl);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      className={[
        "inline-flex items-center gap-2 rounded-full font-semibold",
        "shadow-md hover:shadow-lg",
        "transition-transform duration-150 ease-out",
        "hover:-translate-y-[1px]",
        "focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-offset-2 focus-visible:ring-[#0F2147]",
        padding,
        textSize,
      ].join(" ")}
      style={{
        background:
          "linear-gradient(135deg, #0F2147 0%, #111827 40%, #1F2937 100%)",
        color: "#ffffff",
        letterSpacing: "0.08em",
        border: "1px solid rgba(15, 33, 71, 0.7)",
        boxShadow:
          "0 8px 24px rgba(15, 33, 71, 0.35), 0 1px 0 rgba(255, 255, 255, 0.12)",
      }}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/10">
        {/* minimal icon so we do not depend on extra icon libraries here */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 20 20"
          aria-hidden="true"
          className="block"
        >
          <path
            d="M8 4L7 5H4v10h7v-3h2v3a2 2 0 0 1-2 2H4.5A2.5 2.5 0 0 1 2 14.5v-9A2.5 2.5 0 0 1 4.5 3H7l1 1Zm4.5 1.5L15 8h-4v2h4l-2.5 2.5L13 14l4-4-4-4-.5.5Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="uppercase tracking-[0.18em]">{label}</span>
    </button>
  );
}
