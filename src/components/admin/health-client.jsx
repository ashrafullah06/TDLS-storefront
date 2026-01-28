// FILE: src/components/admin/health-client.jsx
"use client";

/**
 * TDLS — Admin Health (Merged Ultra-Premium Client)
 *
 * Merged from:
 * 1) Website probe + SEO/sitemap auditor client (customer + SEO + internal endpoints)
 * 2) RBAC-aware admin health overview (permissions + /api/health/summary + queue controls)
 *
 * Key behaviors:
 * - RBAC: reads /api/admin/session and gates UI (VIEW_HEALTH / MANAGE_SETTINGS / VIEW_DEV_TOOLS)
 * - Health data: prefers /api/health/summary?include=all, falls back to /api/health
 * - Queues: GET/POST /api/health/queue (snapshot + admin actions when MANAGE_SETTINGS)
 * - Website coverage: probes core pages, SEO surfaces, internal APIs, and admin routes
 * - SEO auditor: parses sitemaps (<loc>), flags leaks (/admin, /health) and host mismatch
 * - Exports: Print-safe PDF, Copy JSON, Download JSON
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* --------------------------------- theme --------------------------------- */
const NAVY = "#0F2147";
const BORDER = "#DFE3EC";
const MUTED = "#6B7280";

const STATUS_COLORS = {
  ok: { bg: "#E8F5E9", text: "#1B5E20", border: "#C8E6C9", icon: "✅", label: "All systems operational" },
  degraded: { bg: "#FFF8E1", text: "#784300", border: "#FFE0B2", icon: "⚠️", label: "Degraded performance" },
  error: { bg: "#FFEBEE", text: "#B71C1C", border: "#FFCDD2", icon: "⛔", label: "System unavailable" },
  unknown: { bg: "#F3F4F6", text: "#111827", border: "#E5E7EB", icon: "ℹ️", label: "Status unknown" },
};

function clampStr(s, n = 80) {
  const x = String(s ?? "");
  if (x.length <= n) return x;
  return x.slice(0, Math.max(0, n - 1)) + "…";
}

function fmtMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return `${Math.round(ms)} ms`;
}

function latencyColor(ms) {
  if (typeof ms !== "number") return "#555";
  if (ms < 250) return "#1B5E20";
  if (ms < 800) return "#7A4E00";
  return "#B71C1C";
}

function statusFromHttp(http) {
  if (typeof http !== "number" || !Number.isFinite(http)) return "unknown";
  if (http >= 200 && http < 300) return "ok";
  if (http >= 300 && http < 400) return "redirect";
  if (http === 401 || http === 403) return "auth";
  if (http === 404) return "notfound";
  if (http >= 400 && http < 500) return "client";
  if (http >= 500) return "server";
  return "unknown";
}

function toneFromStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "ok" || v === "healthy" || v === "pass") return "ok";
  if (["degraded", "warn", "warning", "partial", "unavailable"].includes(v)) return "degraded";
  if (["error", "down", "failed", "fail"].includes(v)) return "error";
  return "neutral";
}

function moneyBDT(n) {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return "৳ 0";
  return `৳ ${x.toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

/* --------------------------------- UI bits -------------------------------- */
function Badge({ tone = "neutral", text }) {
  const map = {
    ok: { bg: "#E8F5E9", fg: "#1B5E20", bd: "#C8E6C9" },
    degraded: { bg: "#FFF8E1", fg: "#784300", bd: "#FFE0B2" },
    error: { bg: "#FFEBEE", fg: "#B71C1C", bd: "#FFCDD2" },
    info: { bg: "#EEF2FF", fg: "#1E3A8A", bd: "#C7D2FE" },
    neutral: { bg: "#F3F4F6", fg: "#111827", bd: "#E5E7EB" },
  };
  const t = map[tone] || map.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        lineHeight: 1.5,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", opacity: 0.7 }} />
      <span>{text}</span>
    </span>
  );
}

function PillButton({ label, onClick, icon, subtle = false, disabled = false, title }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    borderRadius: 999,
    padding: "10px 14px",
    fontSize: 12,
    fontWeight: 800,
    border: "1px solid #E5E7EB",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    userSelect: "none",
    transition: "transform .08s ease, background .2s ease, border-color .2s ease",
  };

  const style = subtle
    ? {
        ...base,
        background: "rgba(255,255,255,0.9)",
        color: "#111827",
        boxShadow: "0 10px 26px rgba(15,23,42,0.06)",
      }
    : {
        ...base,
        background: "linear-gradient(135deg, #0F2147 0%, #111827 55%, #1F2937 100%)",
        color: "#ffffff",
        borderColor: "rgba(15,33,71,0.85)",
        boxShadow: "0 16px 40px rgba(15,33,71,0.30)",
      };

  return (
    <button
      type="button"
      title={title}
      style={style}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseDown={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "translateY(0px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0px)";
      }}
    >
      {icon ? <span aria-hidden style={{ fontSize: 13 }}>{icon}</span> : null}
      <span style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
    </button>
  );
}

/* ------------------------------ data helpers ------------------------------ */
function parseXmlLocs(xmlText = "") {
  const m = String(xmlText || "").match(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi);
  if (!m) return [];
  const locs = [];
  for (const block of m) {
    const mm = block.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i);
    if (mm && mm[1]) locs.push(mm[1].trim());
  }
  return locs;
}

async function fetchJson(url, { timeoutMs = 12000 } = {}) {
  const started = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    });
    const ms = performance.now() - started;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    clearTimeout(t);
    return { ok: res.ok, http: res.status, ms, json, text };
  } catch (e) {
    clearTimeout(t);
    const ms = performance.now() - started;
    return { ok: false, http: 0, ms, json: null, text: "", error: String(e?.message || e) };
  }
}

async function probeUrl(url, { timeoutMs = 12000, readPreview = true } = {}) {
  const started = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    });

    const ms = performance.now() - started;
    const http = res.status;
    const ct = res.headers.get("content-type") || "";

    let preview = "";
    if (readPreview && (ct.includes("text") || ct.includes("xml") || ct.includes("json") || ct.includes("html"))) {
      const raw = await res.text();
      preview = raw.slice(0, 1400);
    }

    clearTimeout(t);
    return { http, ms, ct, preview, error: "" };
  } catch (e) {
    clearTimeout(t);
    const ms = performance.now() - started;
    return { http: 0, ms, ct: "", preview: "", error: String(e?.message || e) };
  }
}

function isAllowedStatus(http, allow = []) {
  if (typeof http !== "number") return false;
  return allow.includes(http);
}

/**
 * Probes cover "entire website surface":
 * - Customer core pages
 * - SEO endpoints
 * - Health endpoints (api)
 * - Admin endpoints (expected auth/redirect)
 * - Public /health is expected NOT to exist (404 OK) to prevent indexing leak
 */
function buildDefaultProbes(origin) {
  const O = String(origin || "").replace(/\/$/, "");
  return [
    // Customer core
    { key: "home", label: "Home", path: "/", expect: "public" },
    { key: "product", label: "Product Landing", path: "/product", expect: "public" },
    { key: "collections", label: "Collections", path: "/collections", expect: "public" },

    // SEO surface
    { key: "robots", label: "robots.txt", path: "/robots.txt", expect: "public" },
    { key: "sitemap_index", label: "sitemap.xml (index)", path: "/sitemap.xml", expect: "public" },
    { key: "sitemap_static", label: "sitemap-static.xml", path: "/sitemap-static.xml", expect: "public" },
    { key: "sitemap_products", label: "sitemap-products.xml", path: "/sitemap-products.xml", expect: "public" },
    { key: "sitemap_collections", label: "sitemap-collections.xml", path: "/sitemap-collections.xml", expect: "public" },
    { key: "sitemap_server", label: "server-sitemap.xml", path: "/server-sitemap.xml", expect: "public" },
    { key: "sitemap_blog", label: "sitemap-blog.xml", path: "/sitemap-blog.xml", expect: "public" },

    // Health APIs
    { key: "api_health", label: "/api/health", path: "/api/health", expect: "internal_api" },
    { key: "api_health_summary", label: "/api/health/summary", path: "/api/health/summary?include=all", expect: "internal_api" },
    { key: "api_health_queue", label: "/api/health/queue", path: "/api/health/queue", expect: "internal_api" },

    // Admin surface: auth/redirect expected (or 200 if already authenticated)
    { key: "admin_root", label: "/admin", path: "/admin", expect: "admin" },
    { key: "admin_health", label: "/admin/health", path: "/admin/health", expect: "admin" },

    // IMPORTANT: public /health should NOT exist (404 is GOOD)
    { key: "public_health_should_404", label: "/health (must not exist)", path: "/health", expect: "must404" },

    // Expanded "website included" checks (safe, non-destructive)
    { key: "cart", label: "Cart", path: "/cart", expect: "public" },
    { key: "checkout", label: "Checkout", path: "/checkout", expect: "public" },
  ].map((p) => ({ ...p, url: O + p.path }));
}

/* ------------------------------ main component ----------------------------- */
export default function HealthClient() {
  const mountedRef = useRef(true);

  // RBAC
  const [perms, setPerms] = useState(null);

  // Health data (merged)
  const [summary, setSummary] = useState(null); // /api/health/summary
  const [health, setHealth] = useState(null); // /api/health
  const [healthLoading, setHealthLoading] = useState(true);

  // Queues
  const [queueSnapshot, setQueueSnapshot] = useState(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueBusyAction, setQueueBusyAction] = useState("");
  const [queueMsg, setQueueMsg] = useState("");

  // Website probes
  const [probes, setProbes] = useState([]);
  const [probing, setProbing] = useState(false);

  // UX state
  const [tab, setTab] = useState("overview"); // overview | probes | seo | queues | raw
  const [filter, setFilter] = useState("");
  const [severity, setSeverity] = useState("all"); // all|ok|degraded|error
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState("");

  /* ---------- permissions ---------- */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetchJson("/api/admin/session", { timeoutMs: 12000 });
        if (!active) return;
        if (!r.ok || !r.json) throw new Error((r.json && r.json.error) || "session failed");
        const p = r.json?.user?.permissions || r.json?.permissions || [];
        setPerms(Array.isArray(p) ? p : []);
      } catch {
        if (active) setPerms([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const permSet = useMemo(() => new Set((perms || []).map((p) => String(p || "").trim().toUpperCase())), [perms]);

  const canView =
    permSet.has("VIEW_HEALTH") ||
    permSet.has("MANAGE_SETTINGS") ||
    permSet.has("VIEW_DEV_TOOLS");

  const canManage = permSet.has("MANAGE_SETTINGS");

  /* ---------- data loaders ---------- */
  const loadHealth = useCallback(async () => {
    setErr("");
    setQueueMsg("");
    setHealthLoading(true);

    try {
      // Prefer /api/health/summary; fall back to /api/health
      const [a, b] = await Promise.all([
        fetchJson("/api/health/summary?include=all", { timeoutMs: 14000 }),
        fetchJson("/api/health", { timeoutMs: 14000 }),
      ]);

      if (!mountedRef.current) return;

      // summary may not exist; keep it nullable
      setSummary(a.ok && a.json ? a.json : null);

      // /api/health is your canonical "legacy" health endpoint in the earlier page
      // keep it nullable too
      setHealth(b.ok && b.json ? b.json : (b.json ? b.json : null));

      // If both failed, surface best error we can
      if ((!a.ok || !a.json) && (!b.ok || !b.json)) {
        const msg =
          a.error ||
          b.error ||
          (a.text && a.text.slice ? a.text.slice(0, 160) : "") ||
          "Failed to load health endpoints.";
        setErr(String(msg));
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(String(e?.message || e));
    } finally {
      if (mountedRef.current) setHealthLoading(false);
    }
  }, []);

  const loadQueues = useCallback(async () => {
    setQueueLoading(true);
    try {
      const r = await fetchJson("/api/health/queue", { timeoutMs: 14000 });
      if (!mountedRef.current) return;
      if (!r.ok || !r.json) throw new Error((r.json && r.json.error) || "queue snapshot failed");
      setQueueSnapshot(r.json);
    } catch {
      if (mountedRef.current) setQueueSnapshot(null);
    } finally {
      if (mountedRef.current) setQueueLoading(false);
    }
  }, []);

  const queueAction = useCallback(
    async (kind, queueName) => {
      if (!canManage) return;
      setErr("");
      setQueueMsg("");
      const key = `${kind}:${queueName || "default"}`;
      setQueueBusyAction(key);

      try {
        const res = await fetch("/api/health/queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: kind, queue: queueName }),
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `${kind} failed`);

        setQueueMsg(j.message || `${kind} executed on ${j.humanLabel || queueName || "queue"}.`);
        await Promise.all([loadHealth(), loadQueues()]);
      } catch (e) {
        setErr(String(e?.message || e));
      } finally {
        if (mountedRef.current) setQueueBusyAction("");
      }
    },
    [canManage, loadHealth, loadQueues]
  );

  /* ---------- probes ---------- */
  const runProbes = useCallback(async () => {
    if (probing) return;
    setProbing(true);

    try {
      const origin = window.location.origin;
      const list = buildDefaultProbes(origin);

      const results = [];
      for (const p of list) {
        // eslint-disable-next-line no-await-in-loop
        const r = await probeUrl(p.url, {
          timeoutMs: 12000,
          readPreview: p.key.startsWith("sitemap") || p.key === "robots",
        });

        const st = statusFromHttp(r.http);

        // "ok" rules by expectation type
        let ok = false;
        let note = "";

        if (p.expect === "must404") {
          ok = r.http === 404;
          note = ok ? "Correct: route not present (prevents public indexing)" : "Unexpected: route exists (should be removed)";
        } else if (p.expect === "admin") {
          // admin is allowed to be 200 (already authed) OR redirect/auth gated
          ok = isAllowedStatus(r.http, [200, 301, 302, 303, 307, 308, 401, 403]);
          note =
            st === "auth"
              ? "Auth-protected (expected)"
              : st === "redirect"
              ? "Redirect (verify target is correct)"
              : st === "ok"
              ? "OK"
              : "Unexpected response";
        } else if (p.expect === "internal_api") {
          // APIs: allow 200 or auth gate (depends on your setup)
          ok = isAllowedStatus(r.http, [200, 401, 403]);
          note =
            st === "auth"
              ? "Auth-protected (expected depending on your setup)"
              : st === "ok"
              ? "OK"
              : st === "server"
              ? "Server error"
              : st === "client"
              ? "Client error"
              : "Unexpected response";
        } else {
          // public pages: allow 2xx/3xx
          ok = r.http >= 200 && r.http < 400;
          note =
            st === "redirect"
              ? "Redirect (verify canonical routing)"
              : st === "ok"
              ? "OK"
              : st === "server"
              ? "Server error"
              : st === "client"
              ? "Client error"
              : "Unexpected response";
        }

        results.push({
          ...p,
          http: r.http,
          ms: r.ms,
          ct: r.ct,
          preview: r.preview,
          error: r.error,
          ok,
          statusKind: st,
          note,
        });

        if (!mountedRef.current) break;
      }

      if (mountedRef.current) setProbes(results);
    } finally {
      if (mountedRef.current) setProbing(false);
    }
  }, [probing]);

  /* ---------- boot ---------- */
  useEffect(() => {
    mountedRef.current = true;
    loadHealth();
    loadQueues();
    runProbes();

    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [loadHealth, loadQueues, runProbes]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      loadHealth();
      loadQueues();
      runProbes();
    }, 30000);
    return () => clearInterval(id);
  }, [autoRefresh, loadHealth, loadQueues, runProbes]);

  /* ---------- canonical merged model ---------- */
  const canonical = useMemo(() => {
    // Prefer summary if present, otherwise health
    const primary = summary || health || {};
    const fallback = health || summary || {};

    const status = primary.status || fallback.status || "unknown";
    const timestamp = primary.timestamp || fallback.timestamp || new Date().toISOString();

    const version = primary.version || fallback.version || {};
    const env = primary.env || fallback.env || {};

    // checks might be map-like; normalize to object
    const checks = primary.checks || fallback.checks || {};
    const suggestions = primary.suggestions || fallback.suggestions || [];

    return { status, timestamp, version, env, checks, suggestions };
  }, [summary, health]);

  const statusKey =
    canonical.status === "ok" ? "ok" : canonical.status === "degraded" ? "degraded" : canonical.status === "error" ? "error" : "unknown";

  const theme = STATUS_COLORS[statusKey] || STATUS_COLORS.unknown;

  const updatedAgo = useMemo(() => {
    if (!canonical.timestamp) return "";
    const seconds = Math.max(0, Math.round((Date.now() - new Date(canonical.timestamp).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s ago`;
  }, [canonical.timestamp, tick]);

  /* ---------- checks table ---------- */
  const rows = useMemo(() => {
    const src = canonical.checks || {};
    const list = Object.entries(src).map(([key, v]) => ({
      key,
      desc: v?.desc || v?.description || key,
      ok: !!v?.ok,
      status: v?.status || (v?.ok ? "ok" : "unknown"),
      ms: v?.ms,
      error: v?.error,
      raw: v,
    }));

    const q = String(filter || "").trim().toLowerCase();
    const sev = String(severity || "all").toLowerCase();

    return list.filter((r) => {
      const matchesText =
        !q ||
        r.key.toLowerCase().includes(q) ||
        String(r.desc || "").toLowerCase().includes(q) ||
        String(r.error || "").toLowerCase().includes(q);

      if (!matchesText) return false;
      if (sev === "all") return true;

      const tone = toneFromStatus(r.status);
      if (sev === "ok") return r.ok || tone === "ok";
      if (sev === "degraded") return tone === "degraded";
      if (sev === "error") return tone === "error" || (!r.ok && tone !== "ok" && tone !== "degraded");
      return true;
    });
  }, [canonical.checks, filter, severity]);

  const checksSummary = useMemo(() => {
    const total = rows.length;
    const pass = rows.filter((r) => !!r.ok).length;
    const fail = total - pass;
    const worst = rows.reduce((acc, r) => (typeof r.ms === "number" && r.ms > (acc || 0) ? r.ms : acc), 0);
    return { total, pass, fail, worst };
  }, [rows]);

  const probeSummary = useMemo(() => {
    const total = probes.length;
    const ok = probes.filter((p) => p.ok).length;
    const bad = total - ok;
    const worst = probes.reduce((acc, p) => (typeof p.ms === "number" && p.ms > (acc || 0) ? p.ms : acc), 0);
    return { total, ok, bad, worst };
  }, [probes]);

  /* ---------- SEO audit (sitemap + robots) ---------- */
  const seoAudit = useMemo(() => {
    const byKey = new Map(probes.map((p) => [p.key, p]));
    const sitemaps = [
      byKey.get("sitemap_index"),
      byKey.get("sitemap_static"),
      byKey.get("sitemap_products"),
      byKey.get("sitemap_collections"),
      byKey.get("sitemap_server"),
      byKey.get("sitemap_blog"),
    ].filter(Boolean);

    const audit = [];
    let leakedAdmin = false;
    let leakedHealth = false;
    let hostMismatch = false;

    let originHost = "";
    try {
      originHost = new URL(window.location.origin).host;
    } catch {
      originHost = "";
    }

    for (const sm of sitemaps) {
      const xml = sm.preview || "";
      const locs = parseXmlLocs(xml);
      const sample = locs.slice(0, 14);

      const containsAdmin = locs.some((u) => /\/admin(\/|$)/i.test(u));
      const containsHealthPublic = locs.some((u) => /\/health(\/|$)/i.test(u)); // should be absent

      if (containsAdmin) leakedAdmin = true;
      if (containsHealthPublic) leakedHealth = true;

      // host mismatch detection
      const abs = locs.filter((u) => /^https?:\/\//i.test(u));
      if (abs.length && originHost) {
        const mismatch = abs.some((u) => {
          try {
            return new URL(u).host !== originHost;
          } catch {
            return false;
          }
        });
        if (mismatch) hostMismatch = true;
      }

      audit.push({
        key: sm.key,
        label: sm.label,
        path: sm.path,
        http: sm.http,
        ok: sm.ok,
        ms: sm.ms,
        locCount: locs.length,
        sample,
        leakAdmin: containsAdmin,
        leakHealth: containsHealthPublic,
      });
    }

    const robots = byKey.get("robots");
    const robotsTxt = robots?.preview || "";
    const robotsHasDisallowAdmin = /Disallow:\s*\/admin\/?/i.test(robotsTxt);
    const robotsHasDisallowApi = /Disallow:\s*\/api\/?/i.test(robotsTxt);

    return {
      sitemaps: audit,
      leakedAdmin,
      leakedHealth,
      hostMismatch,
      robotsHasDisallowAdmin,
      robotsHasDisallowApi,
      robotsTxt,
    };
  }, [probes]);

  /* ---------- queue view ---------- */
  const queues = useMemo(() => (Array.isArray(queueSnapshot?.queues) ? queueSnapshot.queues : []), [queueSnapshot]);

  /* ---------- exports ---------- */
  const copyRaw = useCallback(async () => {
    try {
      const payload = {
        generatedAt: new Date().toISOString(),
        health: { summary, health, canonical },
        probes,
        queues: queueSnapshot,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore
    }
  }, [summary, health, canonical, probes, queueSnapshot]);

  const downloadRaw = useCallback(() => {
    try {
      const payload = {
        generatedAt: new Date().toISOString(),
        health: { summary, health, canonical },
        probes,
        queues: queueSnapshot,
      };
      const txt = JSON.stringify(payload, null, 2);
      const blob = new Blob([txt], { type: "application/json;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tdls-health-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    } catch {
      // ignore
    }
  }, [summary, health, canonical, probes, queueSnapshot]);

  /* ---------- permission gate ---------- */
  if (perms === null) {
    return <div className="text-sm text-slate-600">Checking admin permissions…</div>;
  }

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Admin Health</h1>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800 shadow-sm">
          You do not have permission to view this page. Ask an admin to grant{" "}
          <span className="font-mono text-xs bg-rose-100 px-1.5 py-0.5 rounded-md">VIEW_HEALTH</span> or{" "}
          <span className="font-mono text-xs bg-rose-100 px-1.5 py-0.5 rounded-md">MANAGE_SETTINGS</span>.
        </div>
      </div>
    );
  }

  /* ----------------------------------- UI ---------------------------------- */
  const panel = "rounded-3xl border bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]";
  const h2 = "text-sm md:text-base font-semibold tracking-tight";
  const sub = "text-sm";

  const headerGradient = {
    background: "radial-gradient(1200px 360px at 12% 0%, rgba(15,33,71,0.15) 0%, rgba(255,255,255,0) 55%), linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(248,250,252,0.90) 100%)",
  };

  return (
    <div id="admin-health-root" className="mx-auto max-w-6xl">
      <style>{`
        @media print {
          html, body { height: auto !important; overflow: visible !important; }
          body * { visibility: hidden !important; }
          #admin-health-root, #admin-health-root * { visibility: visible !important; }
          #admin-health-root { position: absolute; left: 0; top: 0; width: 100%; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-break { page-break-inside: avoid; break-inside: avoid; }
          table, thead, tbody, tr, td, th { page-break-inside: avoid; break-inside: avoid; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <div className={`mb-5 ${panel} p-4 md:p-6`} style={{ borderColor: BORDER, ...headerGradient }}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-2xl md:text-3xl font-extrabold" style={{ color: NAVY }}>
                Admin Health
              </div>
              <Badge tone={toneFromStatus(canonical.status)} text={String(canonical.status || "unknown").toUpperCase()} />
              <Badge
                tone={probeSummary.bad === 0 ? "ok" : "degraded"}
                text={`WEBSITE: ${probeSummary.ok}/${probeSummary.total} OK`}
              />
              <Badge
                tone={seoAudit.leakedAdmin ? "error" : "ok"}
                text={seoAudit.leakedAdmin ? "SITEMAP ADMIN LEAK" : "SITEMAP CLEAN"}
              />
            </div>

            <div className="text-sm" style={{ color: MUTED }}>
              as of {canonical.timestamp ? new Date(canonical.timestamp).toLocaleString() : "—"}{" "}
              {updatedAgo ? `(${updatedAgo})` : ""} · Commit{" "}
              <span className="font-mono text-xs">{clampStr(canonical.version?.commit || canonical.version?.sha || "—", 12)}</span>{" "}
              · Region <span className="font-mono text-xs">{canonical.version?.region || "—"}</span>
              {queueSnapshot?.mode ? (
                <>
                  {" "}
                  · Queue mode <span className="font-mono text-xs">{queueSnapshot.mode}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="no-print flex flex-wrap items-center gap-2 md:justify-end">
            <PillButton
              subtle
              icon="⟳"
              label={healthLoading || probing || queueLoading ? "Refreshing…" : "Refresh all"}
              disabled={healthLoading || probing || queueLoading}
              onClick={() => {
                loadHealth();
                loadQueues();
                runProbes();
              }}
              title="Refresh health + queues + probes"
            />
            <PillButton subtle icon="⬇" label="Save PDF" onClick={() => window.print()} title="Print / Save PDF" />
            <PillButton subtle icon="📋" label="Copy JSON" onClick={copyRaw} title="Copy full report JSON" />
            <PillButton subtle icon="💾" label="Download" onClick={downloadRaw} title="Download full report JSON" />
            <label className="ml-1 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "#111827" }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-4 w-4"
              />
              Auto-refresh (30s)
            </label>
          </div>
        </div>

        {/* Status banner */}
        <div
          className="no-break mt-4 rounded-2xl border p-4 md:p-5"
          style={{
            borderColor: theme.border,
            background: theme.bg,
            color: theme.text,
          }}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="text-xl">{theme.icon}</div>
              <div className="font-extrabold">{theme.label}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" text={`Checks: ${checksSummary.pass}/${checksSummary.total} pass`} />
              <Badge tone="neutral" text={`Worst latency: ${checksSummary.worst ? `${Math.round(checksSummary.worst)} ms` : "—"}`} />
              <Badge tone={seoAudit.robotsHasDisallowAdmin ? "ok" : "degraded"} text={seoAudit.robotsHasDisallowAdmin ? "ROBOTS /admin OK" : "ROBOTS /admin MISSING"} />
              <Badge tone={seoAudit.hostMismatch ? "degraded" : "ok"} text={seoAudit.hostMismatch ? "SITEMAP HOST CHECK" : "SITEMAP HOST OK"} />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="no-print mt-4 flex flex-wrap gap-2">
          {[
            ["overview", "Overview"],
            ["probes", "Website Probes"],
            ["seo", "SEO / Sitemaps"],
            ["queues", "Queues"],
            ["raw", "Raw JSON"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="rounded-xl border px-3 py-2 text-sm font-extrabold transition"
              style={{
                borderColor: tab === k ? NAVY : "#E5E7EB",
                background: tab === k ? "#EEF2FF" : "#FFFFFF",
                color: tab === k ? NAVY : "#111827",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {(err || queueMsg) && (
          <div className="mt-4 space-y-2">
            {err && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {clampStr(err, 400)}
              </div>
            )}
            {queueMsg && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {queueMsg}
              </div>
            )}
          </div>
        )}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Build */}
          <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
            <div className={h2} style={{ color: NAVY }}>Build</div>
            <div className="mt-3 grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-sm">
              <div style={{ color: MUTED }}>App Version</div>
              <div className="font-mono text-xs">{canonical.version?.app || canonical.version?.version || "—"}</div>

              <div style={{ color: MUTED }}>Git SHA</div>
              <div className="font-mono text-xs">{canonical.version?.commit || canonical.version?.sha || "—"}</div>

              <div style={{ color: MUTED }}>Build ID</div>
              <div className="font-mono text-xs">{canonical.version?.build || "—"}</div>

              <div style={{ color: MUTED }}>Region</div>
              <div className="font-mono text-xs">{canonical.version?.region || "—"}</div>

              <div style={{ color: MUTED }}>Runtime</div>
              <div className="font-mono text-xs">{canonical.version?.runtime || "—"}</div>

              <div style={{ color: MUTED }}>Node</div>
              <div className="font-mono text-xs">{canonical.env?.node_version || canonical.version?.node || "—"}</div>
            </div>
          </div>

          {/* Environment */}
          <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
            <div className={h2} style={{ color: NAVY }}>Environment</div>
            <div className="mt-3 grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-sm">
              <div style={{ color: MUTED }}>NODE_ENV</div>
              <div className="font-mono text-xs">{canonical.env?.node_env || "—"}</div>

              <div style={{ color: MUTED }}>Site URL</div>
              <div className="font-mono text-xs">{canonical.env?.next_public_site_url || "—"}</div>

              <div style={{ color: MUTED }}>Strapi URL</div>
              <div className="font-mono text-xs">{canonical.env?.strapi_url || "—"}</div>

              <div style={{ color: MUTED }}>Strapi Token Set</div>
              <div className="font-mono text-xs">{String(!!canonical.env?.strapi_token_set)}</div>

              <div style={{ color: MUTED }}>Token Preview</div>
              <div className="font-mono text-xs">{canonical.env?.strapi_token_preview || "—"}</div>

              <div style={{ color: MUTED }}>Database</div>
              <div className="font-mono text-xs">{canonical.env?.database || canonical.env?.db || "—"}</div>
            </div>
          </div>

          {/* Quick Flags */}
          <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
            <div className={h2} style={{ color: NAVY }}>Audit Flags</div>

            <div className="mt-3 flex flex-col gap-2">
              <FlagRow
                label={<>Public sitemap leaking <b>/admin</b></>}
                tone={seoAudit.leakedAdmin ? "error" : "ok"}
                value={seoAudit.leakedAdmin ? "LEAK" : "CLEAN"}
              />
              <FlagRow
                label={<>Public sitemap contains <b>/health</b></>}
                tone={seoAudit.leakedHealth ? "degraded" : "ok"}
                value={seoAudit.leakedHealth ? "FOUND" : "NOT FOUND"}
              />
              <FlagRow
                label={<>robots.txt disallows <b>/admin</b></>}
                tone={seoAudit.robotsHasDisallowAdmin ? "ok" : "degraded"}
                value={seoAudit.robotsHasDisallowAdmin ? "YES" : "NO"}
              />
              <FlagRow
                label={<>robots.txt disallows <b>/api</b></>}
                tone={seoAudit.robotsHasDisallowApi ? "ok" : "degraded"}
                value={seoAudit.robotsHasDisallowApi ? "YES" : "NO"}
              />
              <FlagRow
                label={<>Sitemap host mismatch</>}
                tone={seoAudit.hostMismatch ? "degraded" : "ok"}
                value={seoAudit.hostMismatch ? "CHECK" : "OK"}
              />
            </div>
          </div>

          {/* Checks */}
          <div className={`${panel} p-4 lg:col-span-3`} style={{ borderColor: BORDER }}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className={h2} style={{ color: NAVY }}>
                Service Checks ({checksSummary.pass}/{checksSummary.total} pass)
              </div>

              <div className="no-print flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-wrap items-center gap-2">
                  {["all", "ok", "degraded", "error"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSeverity(k)}
                      className="rounded-full border px-2.5 py-1 text-xs font-extrabold"
                      style={{
                        borderColor: severity === k ? NAVY : "#E5E7EB",
                        background: severity === k ? "#EEF2FF" : "#FFFFFF",
                        color: severity === k ? NAVY : "#111827",
                      }}
                    >
                      {k.toUpperCase()}
                    </button>
                  ))}
                </div>

                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter checks (name, desc, error)…"
                  className="w-full rounded-xl border px-3 py-2 text-sm outline-none sm:w-[360px]"
                  style={{ borderColor: "#E5E7EB" }}
                />
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border" style={{ borderColor: "#EEE" }}>
              <table className="w-full text-left">
                <thead>
                  <tr style={{ background: "#F6F6F6" }}>
                    <th className="px-3 py-3 text-xs font-extrabold" style={{ color: "#111827" }}>Check</th>
                    <th className="px-3 py-3 text-xs font-extrabold" style={{ color: "#111827" }}>Result</th>
                    <th className="px-3 py-3 text-right text-xs font-extrabold" style={{ color: "#111827" }}>Status</th>
                    <th className="px-3 py-3 text-right text-xs font-extrabold" style={{ color: "#111827" }}>Latency</th>
                    <th className="px-3 py-3 text-xs font-extrabold" style={{ color: "#111827" }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const tone = toneFromStatus(r.status);
                    const resultTone = r.ok ? "ok" : tone === "degraded" ? "degraded" : "error";
                    return (
                      <tr key={r.key} className="no-break border-t" style={{ borderColor: "#EEE" }}>
                        <td className="px-3 py-3 text-sm font-semibold" style={{ color: "#111827" }}>
                          {r.desc}
                          <div className="mt-1 font-mono text-[11px]" style={{ color: MUTED }}>
                            {r.key}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={resultTone} text={r.ok ? "PASS" : "FAIL"} />
                        </td>
                        <td className="px-3 py-3 text-right text-sm" style={{ color: "#111827" }}>
                          {String(r.status || "—")}
                        </td>
                        <td className="px-3 py-3 text-right text-sm" style={{ color: latencyColor(r.ms) }}>
                          {fmtMs(r.ms)}
                        </td>
                        <td className="px-3 py-3 text-sm" style={{ color: "#B30000" }}>
                          {r.error ? clampStr(r.error, 240) : ""}
                        </td>
                      </tr>
                    );
                  })}

                  {!rows.length ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-sm" style={{ color: MUTED }}>
                        No checks match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {Array.isArray(canonical.suggestions) && canonical.suggestions.length > 0 ? (
              <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: "#EEE", background: "#FFFFFF" }}>
                <div className="text-sm font-extrabold" style={{ color: NAVY }}>
                  Suggestions
                </div>
                <ol className="mt-2 list-decimal pl-5 text-sm leading-7" style={{ color: "#111827" }}>
                  {canonical.suggestions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* WEBSITE PROBES */}
      {tab === "probes" && (
        <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className={h2} style={{ color: NAVY }}>Website Probes</div>
              <div className={sub} style={{ color: MUTED }}>
                Live route checks across customer pages, SEO, internal APIs, and admin routes.
                Admin endpoints may return <b>3xx/401/403</b> (expected depending on auth). Public <b>/health</b> must be <b>404</b>.
              </div>
            </div>

            <div className="no-print flex items-center gap-2">
              <PillButton
                subtle
                icon="🧪"
                label={probing ? "Probing…" : "Re-run probes"}
                disabled={probing}
                onClick={runProbes}
                title="Re-run route probes"
              />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: "#EEE" }}>
            <table className="w-full text-left">
              <thead>
                <tr style={{ background: "#F6F6F6" }}>
                  <th className="px-3 py-3 text-xs font-extrabold">Endpoint</th>
                  <th className="px-3 py-3 text-xs font-extrabold">Result</th>
                  <th className="px-3 py-3 text-right text-xs font-extrabold">HTTP</th>
                  <th className="px-3 py-3 text-right text-xs font-extrabold">Latency</th>
                  <th className="px-3 py-3 text-xs font-extrabold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {probes.map((p) => {
                  const st = statusFromHttp(p.http);
                  const tone =
                    p.ok ? "ok" : st === "redirect" || st === "auth" || st === "notfound" ? "degraded" : "error";

                  return (
                    <tr key={p.key} className="no-break border-t" style={{ borderColor: "#EEE" }}>
                      <td className="px-3 py-3 text-sm font-semibold" style={{ color: "#111827" }}>
                        {p.label}
                        <div className="mt-1 font-mono text-[11px]" style={{ color: MUTED }}>
                          {p.path}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={tone} text={p.ok ? "OK" : "ISSUE"} />
                      </td>
                      <td className="px-3 py-3 text-right text-sm" style={{ color: "#111827" }}>
                        {p.http || "—"}
                      </td>
                      <td className="px-3 py-3 text-right text-sm" style={{ color: latencyColor(p.ms) }}>
                        {fmtMs(p.ms)}
                      </td>
                      <td className="px-3 py-3 text-sm" style={{ color: MUTED }}>
                        {p.note || (p.error ? clampStr(p.error, 180) : "")}
                      </td>
                    </tr>
                  );
                })}
                {!probes.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-sm" style={{ color: MUTED }}>
                      No probe results yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SEO / SITEMAPS */}
      {tab === "seo" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
            <div className={h2} style={{ color: NAVY }}>Sitemap Auditor</div>
            <div className="mt-1 text-sm" style={{ color: MUTED }}>
              Counts & samples from each sitemap. Flags leaks like <b>/admin</b> or <b>/health</b> and host mismatch.
            </div>

            <div className="mt-4 space-y-3">
              {seoAudit.sitemaps.map((s) => (
                <div key={s.key} className="rounded-2xl border p-3" style={{ borderColor: "#EEE", background: "#FFF" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-extrabold" style={{ color: "#111827" }}>
                      {s.label}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={s.ok ? "ok" : "error"} text={s.ok ? "FETCH OK" : "FETCH FAIL"} />
                      <Badge tone="neutral" text={`HTTP ${s.http || "—"}`} />
                      <Badge tone="neutral" text={`loc ${s.locCount}`} />
                      <Badge tone={s.leakAdmin ? "error" : "ok"} text={s.leakAdmin ? "ADMIN LEAK" : "NO ADMIN"} />
                      <Badge tone={s.leakHealth ? "degraded" : "ok"} text={s.leakHealth ? "HAS /health" : "NO /health"} />
                    </div>
                  </div>

                  <div className="mt-2 text-xs" style={{ color: MUTED }}>
                    Latency: <span style={{ color: latencyColor(s.ms), fontWeight: 900 }}>{fmtMs(s.ms)}</span>
                  </div>

                  {s.sample?.length ? (
                    <div className="mt-2 rounded-xl border p-2" style={{ borderColor: "#EEE", background: "#FAFAFA" }}>
                      <div className="mb-1 text-xs font-extrabold" style={{ color: NAVY }}>Sample URLs</div>
                      <ul className="space-y-1 text-xs font-mono" style={{ color: "#111827" }}>
                        {s.sample.map((u, i) => (
                          <li key={i}>{clampStr(u, 130)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs" style={{ color: MUTED }}>
                      No &lt;loc&gt; entries detected (or sitemap not fetched).
                    </div>
                  )}
                </div>
              ))}
            </div>

            {(seoAudit.leakedAdmin || seoAudit.leakedHealth) && (
              <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "#FFCDD2", background: "#FFEBEE" }}>
                <div className="text-sm font-extrabold" style={{ color: "#B71C1C" }}>Action Required</div>
                <div className="mt-1 text-sm" style={{ color: "#B71C1C" }}>
                  Public sitemap is exposing internal routes.
                  {seoAudit.leakedHealth ? (
                    <div className="mt-2">
                      • <b>/health</b> is present in sitemap. After deleting <code>app/health</code>, remove it from the sitemap generator list too.
                    </div>
                  ) : null}
                  {seoAudit.leakedAdmin ? (
                    <div className="mt-2">
                      • <b>/admin</b> is present in sitemap. Remove immediately (admin must never be indexed).
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
            <div className={h2} style={{ color: NAVY }}>robots.txt Preview</div>
            <div className="mt-1 text-sm" style={{ color: MUTED }}>
              Ensure <b>Disallow: /admin/</b> exists (and ideally <b>/api/</b>). Admin must be excluded from indexing.
            </div>

            <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "#EEE", background: "#FAFAFA" }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-extrabold" style={{ color: NAVY }}>robots.txt</div>
                <div className="flex items-center gap-2">
                  <Badge tone={seoAudit.robotsHasDisallowAdmin ? "ok" : "degraded"} text={seoAudit.robotsHasDisallowAdmin ? "DISALLOW /admin OK" : "MISSING /admin"} />
                  <Badge tone={seoAudit.robotsHasDisallowApi ? "ok" : "degraded"} text={seoAudit.robotsHasDisallowApi ? "DISALLOW /api OK" : "MISSING /api"} />
                </div>
              </div>
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words text-xs" style={{ color: "#111827" }}>
                {seoAudit.robotsTxt || "No robots.txt preview (fetch failed or empty)."}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* QUEUES */}
      {tab === "queues" && (
        <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className={h2} style={{ color: NAVY }}>Job Queues & Background Workers</div>
              <div className="text-sm" style={{ color: MUTED }}>
                Snapshot + controls via <code>/api/health/queue</code>. Actions require <b>MANAGE_SETTINGS</b>.
              </div>
            </div>

            <div className="no-print flex items-center gap-2">
              <PillButton
                subtle
                icon="⟳"
                label={queueLoading ? "Loading…" : "Refresh queues"}
                disabled={queueLoading}
                onClick={loadQueues}
                title="Reload queue snapshot"
              />
            </div>
          </div>

          <div className="mt-4">
            {queues.length === 0 ? (
              <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "#EEE", color: MUTED }}>
                No queues reported yet. Ensure your queue layer reports into <code>/api/health/queue</code>.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {queues.map((q) => (
                  <QueueCard
                    key={q.name}
                    queue={q}
                    canManage={canManage}
                    busyAction={queueBusyAction}
                    onAction={queueAction}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* RAW */}
      {tab === "raw" && (
        <div className={`${panel} p-4`} style={{ borderColor: BORDER }}>
          <div className={h2} style={{ color: NAVY }}>Raw JSON</div>
          <div className="mt-1 text-sm" style={{ color: MUTED }}>
            Full payload from <code>/api/health/summary</code> (if available) and <code>/api/health</code>, plus probes and queues.
          </div>

          <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "#EEE", background: "#0B1220" }}>
            <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap break-words text-xs" style={{ color: "#E5E7EB" }}>
              {JSON.stringify(
                {
                  generatedAt: new Date().toISOString(),
                  health: { summary, health, canonical },
                  probes,
                  queues: queueSnapshot,
                },
                null,
                2
              )}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- subcomponents ------------------------------- */
function FlagRow({ label, tone, value }) {
  const map = {
    ok: "ok",
    degraded: "degraded",
    error: "error",
    neutral: "neutral",
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm" style={{ color: MUTED }}>{label}</div>
      <Badge tone={map[tone] || "neutral"} text={value} />
    </div>
  );
}

function QueueCard({ queue, canManage, busyAction, onAction }) {
  const activeDepth = typeof queue.depth === "number" ? queue.depth : queue.size;

  const actions = [
    { key: "rerun", label: "Rerun" },
    { key: "retry", label: "Retry failed" },
    { key: "drain", label: "Drain" },
    { key: "pause", label: "Pause" },
    { key: "resume", label: "Resume" },
    { key: "clearfailed", label: "Clear failed" },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
            {queue.label || queue.name}
            {queue.paused ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
                Paused
              </span>
            ) : null}
          </div>

          <div className="mt-1 text-[12px] text-slate-700">
            Depth: <b>{activeDepth ?? 0}</b> · Failed: <b>{queue.failed ?? queue.failedCount ?? 0}</b> · Delayed:{" "}
            <b>{queue.delayed ?? 0}</b>
          </div>

          <div className="mt-1 text-[11px] text-slate-600">
            Concurrency: <b>{queue.concurrency ?? "—"}</b> · Last run:{" "}
            <b>{queue.lastRunAt ? new Date(queue.lastRunAt).toLocaleString() : "—"}</b>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {actions.map((a) => {
          const key = `${a.key}:${queue.name}`;
          const busy = busyAction === key;
          return (
            <button
              key={a.key}
              type="button"
              disabled={!canManage || busy}
              onClick={() => onAction(a.key, queue.name)}
              className="rounded-full border px-3 py-1.5 text-[11px] font-extrabold transition"
              style={{
                borderColor: "#E5E7EB",
                background: "rgba(255,255,255,0.95)",
                color: "#111827",
                opacity: !canManage || busy ? 0.6 : 1,
                cursor: !canManage || busy ? "not-allowed" : "pointer",
              }}
              title={!canManage ? "Requires MANAGE_SETTINGS" : a.label}
            >
              {busy ? "…" : a.label}
            </button>
          );
        })}
      </div>

      {!canManage ? (
        <div className="mt-3 text-[11px] text-slate-500">
          Actions are disabled. Grant <b>MANAGE_SETTINGS</b> to use queue controls.
        </div>
      ) : null}
    </div>
  );
}
