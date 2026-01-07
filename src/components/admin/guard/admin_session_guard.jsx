// FILE: src/components/admin/guard/admin_session_guard.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const NAVY = "#0F2147";

function toStr(v) {
  return v == null ? "" : String(v);
}

function isAdminPath(p) {
  const s = toStr(p).toLowerCase();
  return s === "/admin" || s.startsWith("/admin/");
}

function safeAdminRedirect(p) {
  const s = toStr(p).trim();
  if (!s) return "/admin";
  if (!s.startsWith("/admin")) return "/admin";
  if (s.startsWith("//")) return "/admin";
  if (s.includes("://")) return "/admin";
  if (s.includes("\n") || s.includes("\r")) return "/admin";
  return s;
}

function buildLoginUrl(pathname) {
  const redirect = encodeURIComponent(safeAdminRedirect(pathname));
  return `/admin/login?reason=logged_out&redirect=${redirect}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractReason(payload) {
  const s = payload || {};
  const reason =
    toStr(s?.session?.reason) ||
    toStr(s?.security?.risk?.reason) ||
    toStr(s?.session?.source) ||
    toStr(s?.error) ||
    "";
  return reason.trim();
}

function isForbiddenReason(reason) {
  const r = toStr(reason).toLowerCase();
  if (!r) return false;
  return (
    r.includes("not_staff") ||
    r.includes("not_staff_kind") ||
    r.includes("not_admin") ||
    r.includes("ineligible") ||
    r.includes("user_kind") ||
    r.includes("customer_only") ||
    r.includes("staff_only_required") ||
    r.includes("forbidden")
  );
}

/**
 * Reasons that should NOT force a login redirect.
 * These are often transient or indicate backend degradation rather than logout.
 */
function isSoftFailureReason(reason) {
  const r = toStr(reason).toLowerCase();
  if (!r) return false;
  return (
    r.includes("db_degraded") ||
    r.includes("ok_db_degraded") ||
    r.includes("prisma") ||
    r.includes("closed") ||
    r.includes("pool") ||
    r.includes("timeout") ||
    r.includes("fetch") ||
    r.includes("network") ||
    r.includes("server") ||
    r.includes("non_json") ||
    r.includes("session_check_failed")
  );
}

async function fetchAdminSession(signal) {
  const u = `/api/admin/session?include=roles,permissions,capabilities,policy&ts=${Date.now()}`;

  const res = await fetch(u, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  });

  const status = res.status;
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  if (!ct.includes("application/json")) {
    return {
      okHttp: false,
      status,
      json: null,
      nonJson: true,
    };
  }

  const json = await res.json().catch(() => null);
  return { okHttp: res.ok, status, json, nonJson: false };
}

function SessionShell({ title, subtitle, children }) {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: NAVY }}>
              {title}
            </h1>
            {subtitle ? <p className="mt-2 text-sm text-neutral-600">{subtitle}</p> : null}
          </div>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export default function AdminSessionGuard({
  children,
  allowUnauthedPaths = ["/admin/login", "/admin/login/otp", "/admin/signout"],
}) {
  const router = useRouter();
  const pathname = usePathname();

  const allowSet = useMemo(() => {
    return new Set((allowUnauthedPaths || []).map((p) => toStr(p).trim()).filter(Boolean));
  }, [allowUnauthedPaths]);

  const [state, setState] = useState({
    phase: "loading", // loading | authed | missing | forbidden | error
    session: null,
    reason: "",
  });

  // Prevent double redirects
  const redirectedRef = useRef(false);

  // Cache last known good session to avoid “logout on transient backend hiccup”
  const lastGoodRef = useRef({
    at: 0,
    session: null,
  });

  // Tunables (kept conservative to avoid UI changes)
  const CACHE_TTL_MS = 8_000; // avoid refetching on rapid tile navigation
  const GRACE_MS = 35_000; // allow short backend/db wobble without forcing login

  useEffect(() => {
    const p = toStr(pathname);
    if (!p || !isAdminPath(p)) return;

    // Do not guard auth pages
    for (const allowed of allowSet) {
      if (p === allowed || p.startsWith(`${allowed}/`)) return;
    }

    // Prefetch login route for faster redirect if truly needed
    try {
      router.prefetch?.("/admin/login");
    } catch {}

    let mounted = true;
    const ac = new AbortController();

    async function run() {
      try {
        // If we recently had a good session, reuse it immediately to prevent flicker
        const now = Date.now();
        const cached = lastGoodRef.current;
        const cacheFresh = cached?.session && now - (cached.at || 0) <= CACHE_TTL_MS;

        if (cacheFresh) {
          setState({ phase: "authed", session: cached.session, reason: "" });
          return;
        }

        setState({ phase: "loading", session: null, reason: "" });

        const MAX_ATTEMPTS = 3;
        const DELAYS = [0, 250, 750];

        let lastPayload = null;
        let lastStatus = 0;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          if (ac.signal.aborted) return;
          if (attempt > 0) await sleep(DELAYS[attempt] || 0);

          const r = await fetchAdminSession(ac.signal);
          lastPayload = r?.json || null;
          lastStatus = Number(r?.status) || 0;

          // Non-JSON response means middleware/proxy error or route mismatch
          if (r?.nonJson) {
            if (!mounted) return;

            // If we had a good session recently, do not hard-fail; allow grace
            const hadRecent =
              lastGoodRef.current?.session &&
              now - (lastGoodRef.current.at || 0) <= GRACE_MS;

            if (hadRecent) {
              setState({ phase: "authed", session: lastGoodRef.current.session, reason: "" });
              return;
            }

            setState({
              phase: "error",
              session: null,
              reason: "Admin session endpoint returned a non-JSON response.",
            });
            return;
          }

          const s = r?.json;
          const hasAdminUser = Boolean(s?.user?.id) || Boolean(s?.session?.userId);
          const reason = extractReason(s);

          // Respect HTTP status
          if (lastStatus === 403 || isForbiddenReason(reason)) {
            if (!mounted) return;
            setState({ phase: "forbidden", session: s, reason: reason || "forbidden" });
            return;
          }

          // 5xx should be error, not logout
          if (lastStatus >= 500) {
            const hadRecent =
              lastGoodRef.current?.session &&
              now - (lastGoodRef.current.at || 0) <= GRACE_MS;

            if (hadRecent) {
              if (!mounted) return;
              setState({ phase: "authed", session: lastGoodRef.current.session, reason: "" });
              return;
            }

            if (!mounted) return;
            setState({
              phase: "error",
              session: s,
              reason: reason || "Server error while checking admin session.",
            });
            return;
          }

          // Authed (best outcome)
          if (hasAdminUser) {
            if (!mounted) return;
            lastGoodRef.current = { at: Date.now(), session: s };
            setState({ phase: "authed", session: s, reason: "" });
            return;
          }

          // If the backend indicates a soft failure (db degraded), do not force login
          if (isSoftFailureReason(reason)) {
            const hadRecent =
              lastGoodRef.current?.session &&
              Date.now() - (lastGoodRef.current.at || 0) <= GRACE_MS;

            if (hadRecent) {
              if (!mounted) return;
              setState({ phase: "authed", session: lastGoodRef.current.session, reason: "" });
              return;
            }

            if (!mounted) return;
            setState({
              phase: "error",
              session: s,
              reason: reason || "Temporary admin session verification issue.",
            });
            return;
          }

          // If 401 explicitly, we can redirect after retries (below)
          // Otherwise: looks missing; retry until attempts exhausted
        }

        // After retries, treat as missing session
        if (!mounted) return;

        const finalReason = extractReason(lastPayload) || "no_admin_session";

        // Grace handling: if we recently had a good session, do NOT redirect
        const hadRecent =
          lastGoodRef.current?.session &&
          Date.now() - (lastGoodRef.current.at || 0) <= GRACE_MS;

        if (hadRecent) {
          setState({ phase: "authed", session: lastGoodRef.current.session, reason: "" });
          return;
        }

        setState({ phase: "missing", session: lastPayload, reason: finalReason });

        // Redirect once only when truly missing (no grace)
        if (!redirectedRef.current) {
          redirectedRef.current = true;
          router.replace(buildLoginUrl(p));
        }
      } catch (e) {
        if (!mounted) return;

        // Network errors should not force login if we had a good session recently
        const hadRecent =
          lastGoodRef.current?.session &&
          Date.now() - (lastGoodRef.current.at || 0) <= GRACE_MS;

        if (hadRecent) {
          setState({ phase: "authed", session: lastGoodRef.current.session, reason: "" });
          return;
        }

        setState({
          phase: "error",
          session: null,
          reason: toStr(e?.message || "Admin session check failed"),
        });
      }
    }

    run();

    return () => {
      mounted = false;
      ac.abort();
    };
  }, [pathname, router, allowSet]);

  if (!isAdminPath(pathname)) return <>{children}</>;

  if (state.phase === "loading") {
    return (
      <SessionShell title="Loading Admin Session…" subtitle="Verifying RBAC + admin session scope.">
        <div className="h-10 w-full animate-pulse rounded-2xl bg-neutral-100" />
        <div className="mt-3 h-10 w-2/3 animate-pulse rounded-2xl bg-neutral-100" />
      </SessionShell>
    );
  }

  if (state.phase === "forbidden") {
    return (
      <SessionShell
        title="Admin access restricted"
        subtitle="You are signed in, but this account is not eligible for the admin plane."
      >
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
          <div className="font-medium text-neutral-900">Reason</div>
          <div className="mt-1">{state.reason || "not_admin_eligible"}</div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={() => router.replace("/")}
            className="rounded-2xl border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Back to Store
          </button>
          <button
            onClick={() => router.replace("/admin/login")}
            className="rounded-2xl px-4 py-2 text-sm text-white"
            style={{ background: NAVY }}
          >
            Switch Admin Account
          </button>
        </div>
      </SessionShell>
    );
  }

  if (state.phase === "error") {
    return (
      <SessionShell title="Admin session check failed" subtitle="This is usually a server/cookie mismatch.">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {state.reason}
        </div>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-2xl px-4 py-2 text-sm text-white"
            style={{ background: NAVY }}
          >
            Retry
          </button>
          <button
            onClick={() => router.replace("/admin/login")}
            className="rounded-2xl border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            Go to Admin Login
          </button>
        </div>
      </SessionShell>
    );
  }

  // missing -> we already redirected; render nothing to avoid flash
  if (state.phase === "missing") return null;

  return <>{children}</>;
}
