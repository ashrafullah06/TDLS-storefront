// src/components/auth/signout_button.js
"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

/**
 * IMPORTANT (Decoupling):
 * Customer logout must not invoke NextAuth's client signOut() here because:
 * - signOut() calls /api/auth/signout and clears default NextAuth cookies
 * - if admin plane still shares those cookie names, admin gets signed out too
 *
 * We rely on our customer-only hard logout endpoint (/api/auth/logout),
 * then do a refresh/navigation to update any UI state.
 */

function clearCustomerClientArtifacts() {
  // Keep manual marker briefly; do not remove immediately here.
  const removeByPrefix = (storage, prefixes) => {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        const kk = String(k || "");
        if (prefixes.some((p) => kk.startsWith(p))) {
          try {
            storage.removeItem(kk);
          } catch {}
        }
      }
    } catch {}
  };

  // Clear BOTH historical naming families (TDLC + TDLS)
  const customerPrefixes = [
    "tdlc_customer_",
    "tdlc_cart_",
    "tdlc_checkout_",
    "tdlc_nav_",
    "tdls_customer_",
    "tdls_cart_",
    "tdls_checkout_",
    "tdls_nav_",
    "customer_",
    "cart_",
    "checkout_",
  ];

  try {
    removeByPrefix(localStorage, customerPrefixes);
  } catch {}
  try {
    removeByPrefix(sessionStorage, customerPrefixes);
  } catch {}
}

/** Customer-only hard logout endpoint (server clears customer cookies/session) */
async function callCustomerHardLogout(redirectTo) {
  const url = "/api/auth/logout";

  const safeDrain = async (res) => {
    try {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) await res.json().catch(() => null);
      else await res.text().catch(() => null);
    } catch {}
  };

  // Attempt #1: JSON
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ok: true, redirectTo: redirectTo || null }),
    });
    await safeDrain(res);
    if (res.ok) return true;

    // Attempt #2: form-encoded
    const body = new URLSearchParams();
    if (redirectTo) body.set("callbackUrl", String(redirectTo));
    const res2 = await fetch(url, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
      body: body.toString(),
    });
    await safeDrain(res2);
    return res2.ok;
  } catch {
    // Attempt #3: bare POST (some handlers reject bodies)
    try {
      const res3 = await fetch(url, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      await safeDrain(res3);
      return res3.ok;
    } catch {
      return false;
    }
  }
}

/** Standards-compliant POST <form> fallback to /api/auth/logout */
function postCustomerLogoutForm(redirectTo) {
  try {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/logout";
    form.style.display = "none";

    if (redirectTo) {
      const cbInput = document.createElement("input");
      cbInput.type = "hidden";
      cbInput.name = "callbackUrl";
      cbInput.value = redirectTo;
      form.appendChild(cbInput);
    }

    document.body.appendChild(form);
    form.submit();
  } catch {
    if (redirectTo) {
      try {
        window.location.assign(redirectTo);
      } catch {}
    }
  }
}

async function verifySessionIsCleared() {
  try {
    const res = await fetch(`/api/auth/session?__ts=${Date.now()}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const txt = await res.text().catch(() => "");
    let j = null;
    try {
      j = txt ? JSON.parse(txt) : null;
    } catch {
      j = null;
    }
    // NextAuth-compatible: null means signed out
    return j === null;
  } catch {
    // If we can't verify, don't block logout flow; treat as "unknown"
    return false;
  }
}

export default function SignoutButton({
  label = "Sign out",
  redirectTo = "/",
  onDone,
  auto = false,
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const hardNavigate = (to) => {
    try {
      window.location.replace(to);
      return true;
    } catch {
      try {
        window.location.assign(to);
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);

    try {
      // Mark manual signout (both naming families)
      try {
        const t = String(Date.now());
        sessionStorage.setItem("tdlc_manual_signout", t);
        sessionStorage.setItem("tdls_manual_signout", t);
        setTimeout(() => {
          try {
            sessionStorage.removeItem("tdlc_manual_signout");
            sessionStorage.removeItem("tdls_manual_signout");
          } catch {}
        }, 15000);
      } catch {}

      // 1) Server cookie/session clear
      const hardOk = await callCustomerHardLogout(redirectTo);

      // 2) Client cached customer artifacts clear
      clearCustomerClientArtifacts();

      // Optional hook
      try {
        onDone && onDone();
      } catch {}

      // 3) Verify logout actually took effect (prevents “2–3 seconds then logged in again”)
      const cleared = hardOk ? await verifySessionIsCleared() : false;

      // If server logout failed OR verification shows still signed-in,
      // do standards-based form POST (now supported by route redirect behavior).
      if (!hardOk || !cleared) {
        postCustomerLogoutForm(redirectTo);
        return;
      }

      // 4) Final navigation (hard nav prevents stale in-memory providers)
      if (hardNavigate(redirectTo)) return;

      // Fallback
      try {
        router.replace(redirectTo);
        router.refresh();
      } catch {}
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (auto) void handleSignOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      style={{
        background: "#0f2147",
        color: "#fff",
        border: "1px solid #0f2147",
        letterSpacing: ".07em",
        boxShadow: "0 2px 8px #eaeaea90",
        borderRadius: 9,
        padding: "14px 32px",
        fontSize: 17,
        minWidth: 0,
        cursor: "pointer",
      }}
      aria-busy={busy ? "true" : "false"}
    >
      {busy ? "Signing out…" : label}
    </button>
  );
}
