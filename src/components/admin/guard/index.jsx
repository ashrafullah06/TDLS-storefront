// src/components/admin/guard/index.jsx
"use client";

import { useEffect, useState } from "react";
import RequirePermission from "./require-permission";

/**
 * Guard wrapper for admin pages:
 * - fetches /api/admin/session to know user & permissions
 * - renders children when allowed; otherwise shows a concise error
 */
export default function Guard({ need = [], children }) {
  const [state, setState] = useState({ loading: true, user: null, error: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/session", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (alive) setState({ loading: false, user: json?.user || null, error: null });
      } catch (e) {
        if (alive) setState({ loading: false, user: null, error: e.message });
      }
    })();
    return () => (alive = false);
  }, []);

  if (state.loading) return <div className="text-sm text-gray-500">checking access…</div>;
  if (state.error) return <div className="text-sm text-red-600">auth failed: {state.error}</div>;
  if (!state.user) return <div className="text-sm text-red-600">no admin session</div>;

  return (
    <RequirePermission user={state.user} need={need}>
      {children}
    </RequirePermission>
  );
}
