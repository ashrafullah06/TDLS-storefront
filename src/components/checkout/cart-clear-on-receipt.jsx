// FILE: src/components/checkout/cart-clear-on-receipt.jsx
"use client";

import { useEffect, useRef } from "react";

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers: network
   - Best-effort server clear (supports DELETE /api/cart). Falls back to legacy
     endpoints if present so we don’t leave stale server state in edge cases.
   - Keeps credentials so the server can identify the active cart/session.
   ──────────────────────────────────────────────────────────────────────────── */

async function clearServerCartIfAny() {
  const headers = { "cache-control": "no-store" };

  // Primary: the new canonical endpoint
  try {
    const r = await fetch(`/api/cart?_t=${Date.now()}`, {
      method: "DELETE",
      credentials: "include",
      headers,
      // keepalive helps on page unload navigations
      keepalive: true,
    });
    if (r.ok) return;
  } catch {}

  // Fallback #1: optional explicit "clear" action (if your API exposes it)
  try {
    const r2 = await fetch(`/api/cart/clear?_t=${Date.now()}`, {
      method: "POST",
      credentials: "include",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ reason: "receipt" }),
      keepalive: true,
    });
    if (r2.ok) return;
  } catch {}

  // Fallback #2: try marking active cart CONVERTED if an alternate route exists
  try {
    const r3 = await fetch(`/api/cart/active?_t=${Date.now()}`, {
      method: "DELETE",
      credentials: "include",
      headers,
      keepalive: true,
    });
    if (r3.ok) return;
  } catch {}
}

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers: cookies
   - Proactively expire any cart/buy-now/session cookies on the client to avoid
     sticky state if the server route is missing or fails.
   - We attempt multiple domain variants to cover apps deployed on subdomains.
   ──────────────────────────────────────────────────────────────────────────── */

function expireCookie(name) {
  try {
    const past = "Thu, 01 Jan 1970 00:00:00 GMT";
    const base = `${encodeURIComponent(name)}=; Expires=${past}; Path=/; SameSite=Lax`;
    // Current host
    document.cookie = base;
    // With explicit domain (current)
    const host = location.hostname;
    if (host && host !== "localhost") {
      document.cookie = `${base}; Domain=${host}`;
      // With leading dot (covers subdomains)
      const dot = host.startsWith(".") ? host : `.${host}`;
      document.cookie = `${base}; Domain=${dot}`;
    }
  } catch {}
}

function clearCartRelatedCookies() {
  // Common keys we’ve used across flows
  const keys = [
    // buy-now flags
    "BUY_NOW_ACTIVE",
    "buy_now_active",
    "BUY_NOW",
    "buy_now",
    "TDLC_BUY_NOW",
    "tdlc_buy_now",

    // cart session identifiers
    "cart_session_id",
    "cartSession",
    "cart_session",
    "cartId",
    "cart_id",
    "cart",
    "TDLC_CART_ID",
    "next-cart",

    // misc checkout helpers
    "checkout_session_id",
    "checkoutSessionId",
  ];
  keys.forEach(expireCookie);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers: storage + events
   - Bulletproof client clear across globals, localStorage, and sessionStorage.
   - Emit a single cart:changed event so any listeners can refresh UI.
   ──────────────────────────────────────────────────────────────────────────── */

function clearClientCartEverywhere() {
  try {
    if (typeof window !== "undefined") {
      // In-memory globals some integrations use
      window.__CART__ = { items: [] };
      window.__SHOP_CART__ = { items: [] };
      window.__CART_STR__ = JSON.stringify({ items: [] });

      // LocalStorage keys we’ve used historically
      const lsKeys = [
        "TDLC_CART",
        "tdlc_cart_v1",
        "cart",
        "shop_cart",
        "TDLC_CART_STR",
        "tdlc_buy_now",
        "buy_now",
        "TDLC_BUY_NOW",
        "tdlc_cart_id",
        "cart_id",
        "cartId",
        "cart_token",
        "cartToken",
        "TDLC_CART_ID",
        "checkout_session_id",
        "checkoutSessionId",
      ];
      for (const k of lsKeys) localStorage.removeItem(k);

      // SessionStorage duplicates (if any)
      const ssKeys = [
        "TDLC_CART",
        "tdlc_cart_v1",
        "cart",
        "cartId",
        "checkout_session_id",
        "checkoutSessionId",
      ];
      for (const k of ssKeys) sessionStorage.removeItem(k);

      // Single, predictable event for any subscribers
      window.dispatchEvent(new Event("cart:changed"));
    }
  } catch {}
}

/* ──────────────────────────────────────────────────────────────────────────────
   Component
   - Clears server + client cart once on mount, then stays inert.
   - Do NOT render anything; purely side-effect and idempotent.
   ──────────────────────────────────────────────────────────────────────────── */

export default function CartClearOnReceipt() {
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;

    (async () => {
      // 1) Ask server to drop cart (DELETE /api/cart or fallbacks)
      await clearServerCartIfAny();

      // 2) Proactively expire “buy now” & cart cookies (covers BUY_NOW_ACTIVE)
      clearCartRelatedCookies();

      // 3) Clear all client-side caches + broadcast one change event
      clearClientCartEverywhere();
    })();
  }, []);

  return null;
}
