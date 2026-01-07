// FILE: app/(admin)/admin/layout.jsx
"use client";

import "@/styles/admin.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Admin Plane Layout (Fully Decoupled)
 * - NO customer auth dependencies
 * - Uses ONLY /api/admin/session + /api/admin/logout
 *
 * REQUIRED BEHAVIOR (per your instruction):
 * - NEVER auto-redirect to /admin/login on mismatches or transient misses.
 * - Dashboard (/admin) MUST still render even if session is missing/indeterminate.
 * - Show an error banner and allow manual Retry/Login actions.
 * - For forbidden/ineligible users: block access (security).
 */

const AUTH_CHANNEL = "tdlc_admin_plane_auth_channel_v3";
const AUTH_EVENT_KEY = "tdlc_admin_plane_auth_event_v3";

function emitAuthEvent(type, payload = {}) {
  const evt = {
    type,
    payload: { scope: "admin", ...payload },
    at: Date.now(),
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    v: 3,
  };

  try {
    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(AUTH_CHANNEL);
      bc.postMessage(evt);
      bc.close();
    }
  } catch {}

  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(AUTH_EVENT_KEY, JSON.stringify(evt));
    }
  } catch {}
}

function titleCase(s) {
  const x = String(s || "");
  return x.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function isAdminAuthPath(pathname) {
  const p = String(pathname || "");
  return (
    p === "/admin/login" ||
    p.startsWith("/admin/login/") ||
    p === "/admin/forgot-password" ||
    p.startsWith("/admin/forgot-password/") ||
    p === "/admin/reset-password" ||
    p.startsWith("/admin/reset-password/") ||
    p === "/admin/otp" ||
    p.startsWith("/admin/otp/") ||
    p === "/admin/signout" ||
    p.startsWith("/admin/signout/")
  );
}

function normalizeRoleNames(payload) {
  const primary =
    payload?.primaryRole ||
    payload?.user?.displayRole ||
    payload?.user?.primaryRole ||
    payload?.user?.role ||
    payload?.role;

  if (primary && typeof primary === "string") {
    const v = primary.trim();
    if (v) return [v];
  }

  const candidates = [
    payload?.roles,
    payload?.user?.roles,
    payload?.user?.rbac?.roles,
    payload?.rbac?.roles,
  ];

  let raw = null;
  for (const c of candidates) {
    if (c != null) {
      raw = c;
      break;
    }
  }

  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const names = arr
    .map((r) => {
      if (!r) return "";
      if (typeof r === "string") return r;
      if (typeof r === "object") return r.name || r.slug || r.code || r.role || "";
      return "";
    })
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  return Array.from(new Set(names));
}

function formatRolesForLabel(roleNames, authed) {
  const list = Array.isArray(roleNames) ? roleNames : [];
  if (list.length === 0) return authed ? "Staff" : "Signed out";
  return list.map(titleCase).join(", ");
}

function isForbiddenReason(reason = "") {
  const r = String(reason || "").toLowerCase();
  return (
    r.includes("forbidden") ||
    r.includes("not_admin_eligible") ||
    r.includes("not_staff_kind") ||
    r.includes("user_kind_customer_only") ||
    r.includes("customer_only") ||
    r.includes("ineligible") ||
    r.includes("insufficient") ||
    r.includes("missing_permission") ||
    r.includes("no_admin_access") ||
    r.includes("not_staff") ||
    r.includes("not_admin")
  );
}

function isSoftMissingReason(reason = "") {
  const r = String(reason || "").toLowerCase();
  if (!r) return true;
  return (
    r.includes("db_degraded") ||
    r.includes("prisma") ||
    r.includes("closed") ||
    r.includes("pool") ||
    r.includes("timeout") ||
    r.includes("network") ||
    r.includes("fetch") ||
    r.includes("non_json") ||
    r.includes("session_check_failed") ||
    r.includes("server") ||
    r.includes("tempor") ||
    r.includes("indeterminate")
  );
}

function loginUrl(pathname) {
  const p = String(pathname || "/admin");
  const safe = p.startsWith("/admin") ? p : "/admin";
  return `/admin/login?reason=logged_out&redirect=${encodeURIComponent(safe)}`;
}

async function fetchAdminSession(signal) {
  const res = await fetch(
    `/api/admin/session?include=roles,permissions,capabilities,policy&ts=${Date.now()}`,
    {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    }
  );

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    const txt = await res.text().catch(() => "");
    throw new Error(`non_json_admin_session:${res.status}:${String(txt).slice(0, 80)}`);
  }

  const data = await res.json();
  return { res, data };
}

function LogoutPill({ onClick, disabled }) {
  return (
    <button
      type="button"
      className="admin-pill admin-pill--danger"
      onClick={onClick}
      title="Sign out"
      disabled={disabled}
      aria-disabled={disabled ? "true" : "false"}
    >
      {disabled ? "Signing out…" : "Sign out"}
    </button>
  );
}

function BackPill({ onClick, disabled }) {
  return (
    <button
      type="button"
      className="admin-pill admin-pill--neutral"
      onClick={onClick}
      title="Go back"
      disabled={disabled}
      aria-disabled={disabled ? "true" : "false"}
      aria-label="Go back"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        paddingInline: 12,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <path
          d="M15 18l-6-6 6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        Back
      </span>
    </button>
  );
}

function RolePill({ label, title }) {
  return (
    <span
      className="admin-pill admin-pill--neutral"
      title={title || label}
      aria-label={label}
      style={{ pointerEvents: "none" }}
    >
      {label}
    </span>
  );
}

function Topbar({
  crumbs,
  onLogout,
  logoutBusy,
  pathname,
  roleLabel,
  roleTitle,
  onBack,
  backDisabled,
}) {
  return (
    <header className="admin-topbar">
      <div className="admin-topbar__inner">
        <div className="admin-topbar__left">
          <BackPill onClick={onBack} disabled={backDisabled} />
          <nav className="admin-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.href} className="admin-crumb">
                <Link href={c.href} className="admin-crumb__link">
                  {c.label}
                </Link>
                {i !== crumbs.length - 1 && (
                  <span className="admin-crumb__sep" aria-hidden>
                    /
                  </span>
                )}
              </span>
            ))}
          </nav>
        </div>

        <div className="admin-topbar__right">
          <span className="admin-env-tag">Control Center</span>
          <RolePill label={roleLabel} title={roleTitle} />

          <Link href="/" className="admin-pill admin-pill--neutral">
            Storefront
          </Link>

          <Link href="/admin" className="admin-pill admin-pill--neutral">
            Dashboard
          </Link>

          <LogoutPill onClick={onLogout} disabled={logoutBusy} />
        </div>
      </div>

      <div className="admin-topbar__sub">
        <span className="admin-topbar__path">{pathname}</span>
      </div>
    </header>
  );
}

function GateShell({ title, subtitle, children }) {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-2xl rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm admin-surface">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {subtitle ? <p className="mt-3 text-neutral-600">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

function BannerShell({ tone = "neutral", title, subtitle, children }) {
  const border =
    tone === "danger"
      ? "rgba(220,38,38,0.22)"
      : tone === "warn"
      ? "rgba(245,158,11,0.28)"
      : "rgba(15,33,71,0.14)";

  const bg =
    tone === "danger"
      ? "rgba(254,242,242,0.92)"
      : tone === "warn"
      ? "rgba(255,251,235,0.92)"
      : "rgba(255,255,255,0.92)";

  const titleColor =
    tone === "danger" ? "#991b1b" : tone === "warn" ? "#92400e" : "#0F2147";

  const subColor =
    tone === "danger" ? "rgba(153,27,27,0.8)" : tone === "warn" ? "rgba(146,64,14,0.8)" : "rgba(15,33,71,0.75)";

  return (
    <div
      style={{
        border: `1px solid ${border}`,
        background: bg,
        borderRadius: 18,
        padding: "12px 14px",
        boxShadow: "0 18px 45px rgba(15,33,71,0.08)",
        marginBottom: 12,
      }}
    >
      <div style={{ fontWeight: 900, color: titleColor }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 4, fontSize: 12, color: subColor }}>{subtitle}</div> : null}
      {children ? <div style={{ marginTop: 10 }}>{children}</div> : null}
    </div>
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();

  const isAuthRoute = useMemo(() => isAdminAuthPath(pathname), [pathname]);
  const isDashboardRoute = useMemo(() => String(pathname || "") === "/admin", [pathname]);

  const [logoutBusy, setLogoutBusy] = useState(false);

  // Gate: checking | ok | missing | forbidden | error
  const [gate, setGate] = useState({ phase: "checking", reason: "", ts: Date.now() });

  // Force re-check
  const [checkTick, setCheckTick] = useState(0);

  // Last-known good identity
  const lastGoodRef = useRef({
    at: 0,
    roleNames: [],
    name: "",
    email: "",
    staffCode: "",
    kind: "",
    authed: false,
  });

  const [adminIdentity, setAdminIdentity] = useState({
    loading: true,
    indeterminate: true,
    authed: false,
    roleNames: [],
    name: "",
    email: "",
    staffCode: "",
    kind: "",
  });

  const GRACE_MS = 45_000;

  const retryCheck = useCallback(() => {
    setGate({ phase: "checking", reason: "", ts: Date.now() });
    setAdminIdentity((s) => ({ ...s, loading: true }));
    setCheckTick((x) => x + 1);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Do not gate on admin auth pages
    if (isAuthRoute) {
      setGate({ phase: "ok", reason: "", ts: Date.now() });
      return;
    }

    const ac = new AbortController();

    (async () => {
      setGate({ phase: "checking", reason: "", ts: Date.now() });

      const MAX_ATTEMPTS = 3;
      const RETRY_MS = [0, 200, 650];

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (ac.signal.aborted) return;

        if (attempt > 0) await sleep(RETRY_MS[attempt]);

        try {
          const { res, data } = await fetchAdminSession(ac.signal);

          const authed = !!data?.user?.id || !!data?.session?.userId;

          const reason =
            data?.session?.reason ||
            data?.security?.risk?.reason ||
            data?.reason ||
            data?.session?.source ||
            "";

          const roleNames = normalizeRoleNames(data);
          const name = data?.user?.name || data?.name || "";
          const email = data?.user?.email || data?.email || "";
          const staffCode =
            data?.user?.staffProfile?.staffCode ||
            data?.staffProfile?.staffCode ||
            "";
          const kind = data?.user?.kind || data?.kind || "";

          // Forbidden/ineligible: block (security)
          if (!authed && (res?.status === 403 || isForbiddenReason(reason))) {
            setAdminIdentity({
              loading: false,
              indeterminate: false,
              authed: false,
              roleNames,
              name,
              email,
              staffCode,
              kind,
            });
            setGate({
              phase: "forbidden",
              reason: String(reason || "forbidden"),
              ts: Date.now(),
            });
            return;
          }

          // Missing session: retry first
          if (!authed && attempt < MAX_ATTEMPTS - 1) continue;

          if (!authed) {
            const lg = lastGoodRef.current;
            const hadRecentGood =
              !!lg?.authed && Date.now() - Number(lg.at || 0) <= GRACE_MS;

            // If we had a recent good OR the reason is soft → error/indeterminate
            if (hadRecentGood || isSoftMissingReason(reason)) {
              setAdminIdentity({
                loading: false,
                indeterminate: true,
                authed: lg.authed,
                roleNames: lg.roleNames,
                name: lg.name,
                email: lg.email,
                staffCode: lg.staffCode,
                kind: lg.kind,
              });

              setGate({
                phase: "error",
                reason: String(reason || "indeterminate_admin_session"),
                ts: Date.now(),
              });
              return;
            }

            // Clear missing (likely real logout): still DO NOT redirect
            setAdminIdentity({
              loading: false,
              indeterminate: false,
              authed: false,
              roleNames,
              name,
              email,
              staffCode,
              kind,
            });

            setGate({
              phase: "missing",
              reason: String(reason || "no_admin_session"),
              ts: Date.now(),
            });
            return;
          }

          // Authed OK
          setAdminIdentity({
            loading: false,
            indeterminate: false,
            authed: true,
            roleNames,
            name,
            email,
            staffCode,
            kind,
          });

          lastGoodRef.current = {
            at: Date.now(),
            authed: true,
            roleNames,
            name,
            email,
            staffCode,
            kind,
          };

          setGate({ phase: "ok", reason: "", ts: Date.now() });
          return;
        } catch (e) {
          // Transient failure: keep last good; do not flip to signed out
          const lg = lastGoodRef.current;

          setAdminIdentity({
            loading: false,
            indeterminate: true,
            authed: lg.authed,
            roleNames: lg.roleNames,
            name: lg.name,
            email: lg.email,
            staffCode: lg.staffCode,
            kind: lg.kind,
          });

          setGate({
            phase: "error",
            reason: String(e?.message || "admin_session_check_failed"),
            ts: Date.now(),
          });
          return;
        }
      }
    })();

    return () => ac.abort();
  }, [isAuthRoute, pathname, checkTick]);

  // Cross-tab logout sync — NEVER auto-redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAuthRoute) return;

    function isValidAdminEvent(evt) {
      if (!evt || typeof evt !== "object") return false;
      if (evt.v !== 3) return false;
      return String(evt?.payload?.scope || "").toLowerCase() === "admin";
    }

    function handleEvt(evt) {
      if (!isValidAdminEvent(evt)) return;
      if (evt.type === "logout") {
        setGate({ phase: "missing", reason: "remote_logout", ts: Date.now() });
        setAdminIdentity((s) => ({
          ...s,
          loading: false,
          indeterminate: false,
          authed: false,
        }));
      }
    }

    let bc = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel(AUTH_CHANNEL);
        bc.onmessage = (m) => handleEvt(m?.data);
      }
    } catch {}

    function onStorage(e) {
      if (e.key !== AUTH_EVENT_KEY) return;
      if (!e.newValue) return;
      try {
        handleEvt(JSON.parse(e.newValue));
      } catch {}
    }

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      try {
        if (bc) bc.close();
      } catch {}
    };
  }, [isAuthRoute]);

  const roleLabel = useMemo(() => {
    if (adminIdentity.loading) return "Logged in as: …";
    if (adminIdentity.indeterminate) return "Logged in as: …";
    return `Logged in as: ${formatRolesForLabel(adminIdentity.roleNames, adminIdentity.authed)}`;
  }, [adminIdentity.loading, adminIdentity.indeterminate, adminIdentity.roleNames, adminIdentity.authed]);

  const roleTitle = useMemo(() => {
    const parts = [];
    if (adminIdentity.name) parts.push(adminIdentity.name);
    if (adminIdentity.email) parts.push(adminIdentity.email);
    if (adminIdentity.staffCode) parts.push(`Staff: ${adminIdentity.staffCode}`);
    if (adminIdentity.kind) parts.push(`Kind: ${adminIdentity.kind}`);
    const meta = parts.length ? ` — ${parts.join(" • ")}` : "";
    return `${roleLabel}${meta}`;
  }, [roleLabel, adminIdentity.name, adminIdentity.email, adminIdentity.staffCode, adminIdentity.kind]);

  const crumbs = useMemo(() => {
    const p = String(pathname || "/admin");
    if (!p.startsWith("/admin")) return [{ href: "/admin", label: "Admin" }];

    const parts = p.replace(/^\/admin\/?/, "").split("/").filter(Boolean);
    const list = [{ href: "/admin", label: "Admin" }];

    let walk = "/admin";
    for (const seg of parts) {
      walk += `/${seg}`;
      list.push({ href: walk, label: titleCase(seg) });
    }
    return list;
  }, [pathname]);

  const backDisabled = useMemo(() => String(pathname || "") === "/admin", [pathname]);

  const handleBack = useCallback(() => {
    try {
      if (typeof window !== "undefined" && window.history && window.history.length > 1) {
        router.back();
        return;
      }
    } catch {}
    router.push("/admin");
  }, [router]);

  const handleLogout = useCallback(async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);

    emitAuthEvent("logout", { by: "user_click" });
    setGate({ phase: "missing", reason: "user_logout", ts: Date.now() });

    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
    } catch {}

    // Explicit user sign-out: allowed to move to login.
    router.replace("/admin/login?reason=logged_out&redirect=/admin");
    setTimeout(() => setLogoutBusy(false), 600);
  }, [logoutBusy, router]);

  // Auth routes render without topbar/gate
  if (isAuthRoute) {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 admin-surface">
        {children}
      </div>
    );
  }

  const shell = (banner) => (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 admin-surface">
      <Topbar
        crumbs={crumbs}
        onLogout={handleLogout}
        logoutBusy={logoutBusy}
        pathname={pathname || "/admin"}
        roleLabel={roleLabel}
        roleTitle={roleTitle}
        onBack={handleBack}
        backDisabled={backDisabled}
      />
      <main className="min-h-screen">
        <div className="admin-page-outer">
          <div className="admin-page-frame">
            <div className="admin-page-padding">
              {banner}
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  );

  // checking: keep original full-screen loader (prevents flicker on protected pages)
  if (gate.phase === "checking") {
    // For dashboard, we can already render children with a lightweight banner if you prefer.
    // But keeping this as-is is safer and consistent.
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 admin-surface">
        <Topbar
          crumbs={crumbs}
          onLogout={handleLogout}
          logoutBusy={logoutBusy}
          pathname={pathname || "/admin"}
          roleLabel={roleLabel}
          roleTitle={roleTitle}
          onBack={handleBack}
          backDisabled={backDisabled}
        />
        <GateShell title="Verifying Admin Session…" subtitle="Checking admin-plane cookie and RBAC scope.">
          <div className="h-10 w-full animate-pulse rounded-2xl bg-neutral-100" />
          <div className="mt-3 h-10 w-2/3 animate-pulse rounded-2xl bg-neutral-100" />
        </GateShell>
      </div>
    );
  }

  // forbidden: block (security)
  if (gate.phase === "forbidden") {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 admin-surface">
        <Topbar
          crumbs={crumbs}
          onLogout={handleLogout}
          logoutBusy={logoutBusy}
          pathname={pathname || "/admin"}
          roleLabel={roleLabel}
          roleTitle={roleTitle}
          onBack={handleBack}
          backDisabled={backDisabled}
        />
        <GateShell
          title="Admin access restricted"
          subtitle="You are signed in, but this account is not eligible for the admin plane."
        >
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            <div className="font-medium text-neutral-900">Reason</div>
            <div className="mt-1">{gate.reason || "forbidden"}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={retryCheck} className="admin-pill admin-pill--neutral">
              Retry
            </button>

            <Link href={loginUrl(pathname || "/admin")} className="admin-pill admin-pill--neutral">
              Switch Admin Account
            </Link>

            <Link href="/" className="admin-pill admin-pill--neutral">
              Back to Store
            </Link>
          </div>
        </GateShell>
      </div>
    );
  }

  // error: for /admin keep dashboard visible with banner; for other routes keep gate (safer)
  if (gate.phase === "error") {
    if (isDashboardRoute) {
      return shell(
        <BannerShell
          tone="warn"
          title="Admin session check failed (dashboard visible)"
          subtitle="Session verification failed or is indeterminate. No customer sign-out occurred."
        >
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            <div className="font-medium text-neutral-900">Details</div>
            <div className="mt-1">{gate.reason || "admin_session_check_failed"}</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="admin-pill admin-pill--neutral" onClick={retryCheck}>
              Retry
            </button>
            <Link href={loginUrl(pathname || "/admin")} className="admin-pill admin-pill--neutral">
              Go to Admin Login
            </Link>
          </div>
        </BannerShell>
      );
    }

    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 admin-surface">
        <Topbar
          crumbs={crumbs}
          onLogout={handleLogout}
          logoutBusy={logoutBusy}
          pathname={pathname || "/admin"}
          roleLabel={roleLabel}
          roleTitle={roleTitle}
          onBack={handleBack}
          backDisabled={backDisabled}
        />
        <GateShell
          title="Admin session check failed"
          subtitle="This is an admin-plane session mismatch or transient server failure. It is not a customer sign-out."
        >
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            <div className="font-medium text-neutral-900">Details</div>
            <div className="mt-1">{gate.reason || "admin_session_check_failed"}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="admin-pill admin-pill--neutral" onClick={retryCheck}>
              Retry
            </button>
            <Link href={loginUrl(pathname || "/admin")} className="admin-pill admin-pill--neutral">
              Go to Admin Login
            </Link>
          </div>
        </GateShell>
      </div>
    );
  }

  // missing: for /admin keep dashboard visible with banner; for other routes show gate
  if (gate.phase === "missing") {
    if (isDashboardRoute) {
      return shell(
        <BannerShell
          tone="danger"
          title="Admin session not available (dashboard visible)"
          subtitle="No automatic redirect. You can retry or go to login manually."
        >
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            <div className="font-medium text-neutral-900">Reason</div>
            <div className="mt-1">{gate.reason || "no_admin_session"}</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="admin-pill admin-pill--neutral" onClick={retryCheck}>
              Retry
            </button>
            <Link href={loginUrl(pathname || "/admin")} className="admin-pill admin-pill--neutral">
              Go to Admin Login
            </Link>
            <Link href="/" className="admin-pill admin-pill--neutral">
              Back to Store
            </Link>
          </div>
        </BannerShell>
      );
    }

    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 admin-surface">
        <Topbar
          crumbs={crumbs}
          onLogout={handleLogout}
          logoutBusy={logoutBusy}
          pathname={pathname || "/admin"}
          roleLabel={roleLabel}
          roleTitle={roleTitle}
          onBack={handleBack}
          backDisabled={backDisabled}
        />
        <GateShell
          title="Admin session not available"
          subtitle="No automatic redirect will occur. You can retry or go to login manually."
        >
          <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
            <div className="font-medium text-neutral-900">Reason</div>
            <div className="mt-1">{gate.reason || "no_admin_session"}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" className="admin-pill admin-pill--neutral" onClick={retryCheck}>
              Retry
            </button>
            <Link href={loginUrl(pathname || "/admin")} className="admin-pill admin-pill--neutral">
              Go to Admin Login
            </Link>
            <Link href="/" className="admin-pill admin-pill--neutral">
              Back to Store
            </Link>
          </div>
        </GateShell>
      </div>
    );
  }

  // ok → normal admin shell
  return shell(null);
}
