// FILE: src/components/common/account_menu.jsx
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import SignoutButton from "@/components/auth/signout_button";

function initials(name = "") {
  const parts = String(name || "").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "U";
}

export default function AccountMenu() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(null);

  const callback = useMemo(() => {
    const checkout = search.get("checkout");
    if (checkout === "1") return "/checkout";
    if (pathname?.startsWith("/login")) return "/";
    return pathname || "/";
  }, [pathname, search]);

  // Load REAL profile data from your DB via existing /api/user/me
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (status !== "authenticated") {
        setProfile(null);
        return;
      }
      try {
        const res = await fetch("/api/user/me", { credentials: "include" });
        if (!res.ok) throw new Error("load_failed");
        const json = await res.json();
        if (!ignore && json?.ok) setProfile(json.user || null);
      } catch {
        if (!ignore) setProfile(null);
      }
    }
    load();
    return () => { ignore = true; };
  }, [status]);

  // Close dropdown on path change
  useEffect(() => { setOpen(false); }, [pathname]);

  if (status !== "authenticated") {
    return (
      <button
        onClick={() => router.push(`/login?redirect=${encodeURIComponent(callback)}`)}
        className="px-4 py-2 rounded-lg border text-sm"
      >
        Sign in
      </button>
    );
    }

  const name =
    profile?.name ||
    session?.user?.name ||
    session?.user?.email?.split("@")[0] ||
    "User";
  const email = profile?.email || session?.user?.email || "";
  const phone = profile?.phone || "";
  const avatar = session?.user?.image || ""; // /api/user/me doesn’t include image; fall back to session image
  const wallet = profile?.wallet?.balance ?? null;
  const points = profile?.loyaltyAccount?.currentPoints ?? null;
  const tier = profile?.loyaltyAccount?.tier ?? null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm bg-white"
        aria-expanded={open ? "true" : "false"}
        aria-haspopup="menu"
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt="avatar"
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <span className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center text-[11px]">
            {initials(name)}
          </span>
        )}
        <span className="hidden sm:inline">{name}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-72 rounded-xl border bg-white shadow-md z-50"
          role="menu"
        >
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-medium">{name}</p>
            <p className="text-xs text-gray-500 truncate">{email}</p>
            {phone ? (
              <p className="text-xs text-gray-500 truncate">{phone}</p>
            ) : null}
            {(wallet != null || points != null) && (
              <div className="mt-2 flex gap-3 text-xs text-gray-600">
                {wallet != null && <span>Wallet: ৳{Number(wallet).toFixed(2)}</span>}
                {points != null && <span>Points: {points}</span>}
                {tier && <span>· {tier}</span>}
              </div>
            )}
          </div>

          <div className="flex flex-col py-1 text-sm">
            <Link href="/customer/dashboard" className="px-4 py-2 hover:bg-gray-50" role="menuitem">
              My Dashboard
            </Link>
            <Link href="/customer/orders" className="px-4 py-2 hover:bg-gray-50" role="menuitem">
              Orders
            </Link>
            <Link href="/customer/wishlist" className="px-4 py-2 hover:bg-gray-50" role="menuitem">
              Wishlist
            </Link>
            <Link href="/customer/account" className="px-4 py-2 hover:bg-gray-50" role="menuitem">
              Account Settings
            </Link>
          </div>

          <div className="border-t px-4 py-2">
            {/* Robust sign-out: POST + CSRF, no GET to /api/auth/signout */}
            <SignoutButton label="Sign out" redirectTo="/" />
          </div>
        </div>
      )}
    </div>
  );
}
