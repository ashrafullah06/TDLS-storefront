// FILE: src/components/common/header.jsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMemo } from "react";
import AccountMenu from "@/components/common/account_menu";

export default function Header() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Build a safe redirect back to where the user came from (or checkout)
  const callback = useMemo(() => {
    const checkout = search.get("checkout");
    if (checkout === "1") return "/checkout";
    if (pathname?.startsWith("/login")) return "/";
    return pathname || "/";
  }, [pathname, search]);

  const user = session?.user;

  return (
    <header className="w-full border-b bg-white">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold">
            TDLC
          </Link>
          <nav className="hidden md:flex items-center gap-4 text-sm text-gray-700">
            <Link href="/collections/all">Shop All</Link>
            <Link href="/collections/new">New Arrivals</Link>
            <Link href="/collections/men">Men</Link>
            <Link href="/collections/women">Women</Link>
          </nav>
        </div>

        {/* Right side auth area */}
        <div className="flex items-center gap-3">
          {!user && (
            <button
              onClick={() => router.push(`/login?redirect=${encodeURIComponent(callback)}`)}
              className="px-4 py-2 rounded-lg border text-sm"
            >
              Sign in
            </button>
          )}

          {user && <AccountMenu />}

          <Link href="/cart" aria-label="Cart" className="px-3 py-2 rounded-lg border text-sm">
            Cart
          </Link>
        </div>
      </div>
    </header>
  );
}
