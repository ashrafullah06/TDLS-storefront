//src/components/auth/signout_button.js
'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

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
  try { sessionStorage.removeItem('tdlc_manual_signout'); } catch {}

  const removeByPrefix = (storage, prefixes) => {
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k) keys.push(k);
      }
      for (const k of keys) {
        const kk = String(k || '');
        if (prefixes.some((p) => kk.startsWith(p))) {
          try { storage.removeItem(kk); } catch {}
        }
      }
    } catch {}
  };

  const customerPrefixes = [
    'tdlc_customer_',
    'tdlc_cart_',
    'tdlc_checkout_',
    'customer_',
    'cart_',
    'checkout_',
  ];

  try { removeByPrefix(localStorage, customerPrefixes); } catch {}
  try { removeByPrefix(sessionStorage, customerPrefixes); } catch {}
}

/** Customer-only hard logout endpoint (server clears customer cookies/session) */
async function callCustomerHardLogout() {
  try {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
    await res.json().catch(() => null);
    return true;
  } catch {
    return false;
  }
}

/** Standards-compliant POST <form> fallback to /api/auth/logout */
function postCustomerLogoutForm(redirectTo) {
  try {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/auth/logout';
    form.style.display = 'none';

    if (redirectTo) {
      const cbInput = document.createElement('input');
      cbInput.type = 'hidden';
      cbInput.name = 'callbackUrl';
      cbInput.value = redirectTo;
      form.appendChild(cbInput);
    }

    document.body.appendChild(form);
    form.submit();
  } catch {
    if (redirectTo) {
      try { window.location.assign(redirectTo); } catch {}
    }
  }
}

export default function SignoutButton({
  label = 'Sign out',
  redirectTo = '/',
  onDone,
  auto = false,
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    if (busy) return;
    setBusy(true);

    try {
      // Mark a manual signout so guards/unload won't send a second POST
      try { sessionStorage.setItem('tdlc_manual_signout', '1'); } catch {}

      // 1) Customer-only server cleanup (NEVER touches admin plane by design)
      const hardOk = await callCustomerHardLogout();

      // 2) Minimal customer-scoped client cleanup (no global clearing)
      clearCustomerClientArtifacts();

      // Optional hook
      try { onDone && onDone(); } catch {}

      // 3) Redirect + refresh (forces UI/session re-evaluation)
      try {
        router.replace(redirectTo);
        router.refresh();
      } catch {
        try { window.location.assign(redirectTo); } catch {}
      }

      // If hard logout failed, do a standards fallback post to ensure cookies clear
      if (!hardOk) {
        postCustomerLogoutForm(redirectTo);
      }
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
        background: '#0f2147',
        color: '#fff',
        border: '1px solid #0f2147',
        letterSpacing: '.07em',
        boxShadow: '0 2px 8px #eaeaea90',
        borderRadius: 9,
        padding: '14px 32px',
        fontSize: 17,
        minWidth: 0,
        cursor: 'pointer',
      }}
      aria-busy={busy ? 'true' : 'false'}
    >
      {busy ? 'Signing out…' : label}
    </button>
  );
}
