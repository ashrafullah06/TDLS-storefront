// PATH: src/components/nav/WishlistNavButton.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * CUSTOMER-ONLY WISHLIST NAV BUTTON (NO ADMIN MIXUP)
 *
 * FIXES vs earlier version:
 * - Always routes to /wishlist (alias) to avoid route-detection failures.
 * - Uses /api/wishlist/count for a stable count (fallback to list mode).
 * - Hard hides on /admin/*.
 * - Default behavior: guests do not see wishlist icon.
 */

function isAdminPath(pathname) {
  const p = String(pathname || "");
  return p === "/admin" || p.startsWith("/admin/");
}

function IconWishlist({ filled = false, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s-7.1-4.4-9.5-8.8C.5 8.5 2.2 5.4 5.6 4.6c2-.4 4 .4 5.1 1.9 1.1-1.5 3.1-2.3 5.1-1.9 3.4.8 5.1 3.9 3.1 7.6C19.1 16.6 12 21 12 21z"
        fill={filled ? "#0f2147" : "none"}
        stroke="#0f2147"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 6.2l1.3 1.2 1.5-1.8 1.5 1.8 1.3-1.2"
        stroke="#0f2147"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}

async function fetchJSON(url, init) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...init,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  } finally {
    clearTimeout(t);
  }
}

export default function WishlistNavButton({
  className = "",
  compact = true,
  showWhenGuest = false, // keep false per your rule: guest must not have wishlist
  wishlistHref = "/wishlist", // stable alias
}) {
  const router = useRouter();
  const pathname = usePathname();
  const adminRoute = useMemo(() => isAdminPath(pathname), [pathname]);

  const [sessionChecked, setSessionChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);

  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const checkSession = useCallback(async () => {
    // Customer plane only. Never call /api/admin/session here.
    const res = await fetchJSON("/api/auth/session");
    if (!mounted.current) return false;

    const user = res?.json?.user || res?.json?.session?.user || null;
    const ok = !!user?.id;
    setAuthed(ok);
    setSessionChecked(true);
    return ok;
  }, []);

  const loadCount = useCallback(async () => {
    // stable endpoint first
    const res = await fetchJSON("/api/wishlist/count");
    if (!mounted.current) return;

    if (res.status === 401) {
      setCount(null);
      return;
    }

    const c =
      (typeof res?.json?.count === "number" && res.json.count) ||
      (typeof res?.json?.data?.count === "number" && res.json.data.count) ||
      null;

    if (typeof c === "number") setCount(c);
    else setCount(null);
  }, []);

  useEffect(() => {
    if (adminRoute) return;

    (async () => {
      const ok = await checkSession();
      if (ok) await loadCount();
    })();
  }, [adminRoute, checkSession, loadCount]);

  useEffect(() => {
    if (adminRoute) return;

    const onFocus = async () => {
      const ok = await checkSession();
      if (ok) await loadCount();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [adminRoute, checkSession, loadCount]);

  useEffect(() => {
    if (adminRoute) return;

    const onChanged = async () => {
      const ok = await checkSession();
      if (ok) await loadCount();
    };
    window.addEventListener("tdlc:wishlist:changed", onChanged);
    return () => window.removeEventListener("tdlc:wishlist:changed", onChanged);
  }, [adminRoute, checkSession, loadCount]);

  const handleClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    const ok = authed ? true : await checkSession();

    if (!ok) {
      if (showWhenGuest) {
        const next = encodeURIComponent(wishlistHref || "/wishlist");
        router.push(`/login?next=${next}`);
      }
      if (mounted.current) setBusy(false);
      return;
    }

    router.push(wishlistHref || "/wishlist");
    if (mounted.current) setBusy(false);
  }, [busy, authed, checkSession, router, wishlistHref, showWhenGuest]);

  if (adminRoute) return null;

  if (!showWhenGuest && sessionChecked && !authed) return null;
  if (!showWhenGuest && !sessionChecked) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Wishlist"
      title="Wishlist"
      className={[
        "relative inline-flex items-center gap-2 rounded-full border border-[rgba(15,33,71,.14)] bg-white px-3 py-2 shadow-[0_10px_24px_rgba(15,33,71,.10)]",
        "transition-transform duration-150 hover:-translate-y-[1px] hover:shadow-[0_14px_30px_rgba(15,33,71,.14)]",
        busy ? "opacity-80 cursor-not-allowed" : "cursor-pointer",
        className,
      ].join(" ")}
      disabled={busy}
    >
      <IconWishlist filled={false} size={18} />

      {!compact ? (
        <span className="text-[13px] font-extrabold tracking-tight text-[#0f2147]">Wishlist</span>
      ) : null}

      {typeof count === "number" ? (
        <span
          className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#0f2147] px-[6px] text-[11px] font-black text-white shadow-[0_8px_16px_rgba(15,33,71,.18)]"
          aria-label={`Wishlist items: ${count}`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
