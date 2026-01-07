//FILE: src/components/admin/health-client.jsx
"use client";

/**
 * Admin Health Overview (client)
 * - RBAC-aware (VIEW_HEALTH to view; MANAGE_SETTINGS for actions)
 * - Uses /api/admin/session for permissions
 * - Fetches live data from /api/health/summary
 * - Queue snapshot + actions via /api/health/queue
 * - Premium “pond-depth pillow” CTAs and clean management layout
 */

import { useEffect, useMemo, useState } from "react";

// ---------- Small UI primitives ----------

function Badge({ tone = "neutral", children }) {
  const tones = {
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
    degraded: "bg-amber-50 text-amber-800 border-amber-200",
    error: "bg-rose-50 text-rose-700 border-rose-200",
    neutral: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
        tones[tone] || tones.neutral
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current/70 mr-1" />
      {children}
    </span>
  );
}

/** Pond-depth pillow CTA (used for all main actions) */
function PondButton({
  label,
  onClick,
  subtle = false,
  size = "md", // "sm" | "md"
  icon,
  disabled,
}) {
  const padding =
    size === "sm"
      ? "px-3 py-1.5"
      : "px-4 py-2"; // md

  const textSize = size === "sm" ? "text-[11px]" : "text-xs";

  const baseClasses = [
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold",
    padding,
    textSize,
    "tracking-[0.14em] uppercase",
    "transition-transform duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0F2147]",
    disabled ? "opacity-60 cursor-not-allowed" : "hover:-translate-y-[1px]",
  ];

  const style = subtle
    ? {
        background: "rgba(255,255,255,0.9)",
        color: "#0F2147",
        border: "1px solid rgba(148,163,184,0.6)",
        boxShadow:
          "0 8px 22px rgba(148,163,184,0.25), 0 0 0 1px rgba(255,255,255,0.8)",
      }
    : {
        background:
          "linear-gradient(135deg, #0F2147 0%, #111827 40%, #1F2937 100%)",
        color: "#ffffff",
        border: "1px solid rgba(15,33,71,0.85)",
        boxShadow:
          "0 10px 32px rgba(15,33,71,0.45), 0 1px 0 rgba(255,255,255,0.16)",
      };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={baseClasses.join(" ")}
      style={style}
    >
      {icon && (
        <span className="inline-flex h-4 w-4 items-center justify-center">
          {icon}
        </span>
      )}
      <span>{label}</span>
    </button>
  );
}

// ---------- Main Health Client ----------

export default function HealthClient() {
  const [perms, setPerms] = useState(null);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [queueSnapshot, setQueueSnapshot] = useState(null);
  const [queueLoading, setQueueLoading] = useState(true);

  const [err, setErr] = useState("");
  const [queueMsg, setQueueMsg] = useState("");

  const [filter, setFilter] = useState("all"); // all|ok|degraded|error|unavailable
  const [queueBusyAction, setQueueBusyAction] = useState("");

  // ---------- RBAC: fetch canonical permissions ----------
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/session", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "session failed");
        if (active) setPerms(j?.user?.permissions || j?.permissions || []);
      } catch {
        if (active) setPerms([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const permSet = useMemo(
    () =>
      new Set(
        (perms || []).map((p) => String(p || "").trim().toUpperCase())
      ),
    [perms]
  );

  const canView =
    permSet.has("VIEW_HEALTH") ||
    permSet.has("MANAGE_SETTINGS") ||
    permSet.has("VIEW_DEV_TOOLS");

  const canManage = permSet.has("MANAGE_SETTINGS");

  // ---------- Load health summary ----------
  async function loadSummary() {
    setErr("");
    setSummaryLoading(true);
    try {
      const r = await fetch("/api/health/summary?include=all", {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "health summary failed");
      setSummary(j);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSummaryLoading(false);
    }
  }

  // ---------- Load queue snapshot ----------
  async function loadQueues() {
    setQueueLoading(true);
    try {
      const r = await fetch("/api/health/queue", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "queue snapshot failed");
      setQueueSnapshot(j);
    } catch (e) {
      setQueueSnapshot(null);
    } finally {
      setQueueLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    loadQueues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Queue actions ----------
  async function queueAction(kind, queue) {
    if (!canManage) return;
    setErr("");
    setQueueMsg("");
    setQueueBusyAction(`${kind}:${queue || "default"}`);
    try {
      const r = await fetch("/api/health/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: kind, queue }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${kind} failed`);
      setQueueMsg(j.message || `${kind} executed on ${j.humanLabel || queue}.`);
      await Promise.all([loadSummary(), loadQueues()]);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setQueueBusyAction("");
    }
  }

  // ---------- Helpers ----------
  function toneFromStatus(s) {
    if (!s) return "neutral";
    const v = String(s).toLowerCase();
    if (v === "ok" || v === "healthy") return "ok";
    if (["degraded", "warn", "warning", "unavailable"].includes(v))
      return "degraded";
    if (["error", "down", "failed"].includes(v)) return "error";
    return "neutral";
  }

  const checks = useMemo(() => {
    const list = Object.entries(summary?.checks || {}).map(([k, v]) => ({
      key: k,
      ...(v || {}),
    }));
    if (filter === "all") return list;
    if (filter === "ok") return list.filter((c) => c.ok || c.status === "ok");
    if (filter === "error")
      return list.filter((c) =>
        ["error", "down", "failed"].includes(
          String(c.status || "").toLowerCase()
        )
      );
    if (filter === "degraded")
      return list.filter((c) =>
        ["degraded", "warn", "warning"].includes(
          String(c.status || "").toLowerCase()
        )
      );
    if (filter === "unavailable")
      return list.filter(
        (c) => String(c.status || "").toLowerCase() === "unavailable"
      );
    return list;
  }, [summary, filter]);

  // Quick metrics cards
  const quick = {
    db: summary?.db ?? "fail",
    providerCount: summary?.checks?.providers?.count ?? 0,
    shipmentCount:
      summary?.shipments ?? summary?.checks?.shipments?.total ?? 0,
    ordersLast30d: summary?.checks?.orders_30d?.count ?? 0,
    revenueLast30d: summary?.checks?.orders_30d?.revenue ?? 0,
    lowStock: summary?.checks?.inventory?.lowCount ?? 0,
  };

  // Queue cards
  const queues = Array.isArray(queueSnapshot?.queues)
    ? queueSnapshot.queues
    : [];

  // ---------- Permission gate ----------
  if (perms === null) {
    return (
      <div className="text-sm text-slate-600">Checking admin permissions…</div>
    );
  }

  if (!canView) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          System Health
        </h1>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800 shadow-sm">
          You do not have permission to view this page. Ask an admin to grant{" "}
          <span className="font-mono text-xs bg-rose-100 px-1.5 py-0.5 rounded-md">
            VIEW_HEALTH
          </span>{" "}
          or{" "}
          <span className="font-mono text-xs bg-rose-100 px-1.5 py-0.5 rounded-md">
            MANAGE_SETTINGS
          </span>
          .
        </div>
      </div>
    );
  }

  // ---------- Layout ----------
  const lastUpdated = summary?.timestamp
    ? new Date(summary.timestamp)
    : null;

  return (
    <div className="space-y-6">
      {/* Header & global actions */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-slate-900">
              System Health &amp; Queues
            </h1>
            <Badge tone={toneFromStatus(summary?.status || "degraded")}>
              {summary?.status || "unknown"}
            </Badge>
          </div>
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
            {lastUpdated ? (
              <span>
                Last updated:{" "}
                {lastUpdated.toLocaleString(undefined, {
                  hour12: false,
                })}
              </span>
            ) : (
              <span>Last updated: &mdash;</span>
            )}
            <span className="text-slate-400">•</span>
            <span>
              Commit:{" "}
              <span className="font-mono text-[11px]">
                {summary?.version?.commit?.slice?.(0, 7) || "—"}
              </span>
            </span>
            <span className="text-slate-400">•</span>
            <span>Region: {summary?.version?.region || "—"}</span>
            {queueSnapshot?.mode && (
              <>
                <span className="text-slate-400">•</span>
                <span className="text-slate-500">
                  Queue mode:{" "}
                  <span className="font-mono text-[11px]">
                    {queueSnapshot.mode}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <PondButton
            label="Refresh"
            subtle
            size="sm"
            icon={
              <span className="text-[11px]" aria-hidden>
                ⟳
              </span>
            }
            onClick={() => {
              loadSummary();
              loadQueues();
            }}
          />
          <PondButton
            label="Save PDF"
            subtle
            size="sm"
            icon={
              <span className="text-[11px]" aria-hidden>
                ⬇
              </span>
            }
            onClick={() => window.print()}
          />
        </div>
      </div>

      {/* Error + queue feedback */}
      {(err || queueMsg) && (
        <div className="space-y-2">
          {err && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {err}
            </div>
          )}
          {queueMsg && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {queueMsg}
            </div>
          )}
        </div>
      )}

      {/* Quick metrics */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Database"
          value={quick.db === "ok" ? "Connected" : "Error"}
          tone={quick.db === "ok" ? "ok" : "error"}
          hint={
            quick.db === "ok"
              ? "Primary app_db connection healthy"
              : "Check Neon / Prisma connectivity"
          }
        />
        <MetricCard
          label="Payment providers"
          value={quick.providerCount}
          tone="neutral"
          hint="Configured gateways"
        />
        <MetricCard
          label="Shipments (lifetime / recent)"
          value={quick.shipmentCount}
          tone="neutral"
          hint="Processed via logistics layer"
        />
        <MetricCard
          label="Orders (last 30 days)"
          value={quick.ordersLast30d}
          tone="neutral"
          hint="Placed across all channels"
        />
        <MetricCard
          label="Revenue (30d, BDT)"
          value={quick.revenueLast30d}
          tone="ok"
          money
          hint="Gross order value in BDT"
        />
        <MetricCard
          label="Low-stock variants"
          value={quick.lowStock}
          tone={quick.lowStock > 0 ? "degraded" : "ok"}
          hint="Variants below safety stock"
        />
      </section>

      {/* Queues control panel */}
      <section className="rounded-3xl border border-slate-200 bg-white/90 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm md:text-base font-semibold tracking-tight text-slate-900">
              Job Queues &amp; Background Workers
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 max-w-xl">
              Monitor and control background work such as sync jobs, notification
              sends and internal cleanups.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={toneFromStatus(summary?.status || "degraded")}>
              {summary?.status || "unknown"}
            </Badge>
            {queueLoading && (
              <span className="text-[11px] text-slate-500">
                Loading queue snapshot…
              </span>
            )}
          </div>
        </div>

        <div className="px-4 py-4 sm:px-5 sm:py-5 space-y-4">
          {queues.length === 0 ? (
            <div className="text-xs text-slate-500">
              No queues reported yet. Once you plug in BullMQ/Inngest/custom
              workers, expose them via{" "}
              <span className="font-mono text-[11px]">/api/health/queue</span>.
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
      </section>

      {/* Environment block */}
      <section className="rounded-3xl border border-slate-200 bg-white/90 shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-[0.18em] text-slate-700 uppercase">
            Runtime Environment
          </h2>
        </div>
        <div className="grid gap-3 px-4 py-4 text-xs sm:grid-cols-3 md:text-sm">
          <EnvRow label="App" value={summary?.version?.app} />
          <EnvRow label="Commit" value={summary?.version?.commit} mono />
          <EnvRow label="Region" value={summary?.version?.region} />
          <EnvRow label="Node" value={summary?.version?.node} />
          <EnvRow label="Runtime" value={summary?.version?.runtime} />
          <EnvRow
            label="Deployed at"
            value={summary?.version?.deployedAt}
          />
        </div>
      </section>

      {/* Filter & checks table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Checks filter:</span>
            {["all", "ok", "degraded", "error", "unavailable"].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                  filter === k
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          {summaryLoading && (
            <span className="text-[11px] text-slate-500">
              Refreshing checks…
            </span>
          )}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white/95 overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-800">
            Service Checks
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs md:text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Latency</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {(checks || []).map((c, idx) => (
                  <tr
                    key={c.key}
                    className={`border-t border-slate-100 ${
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                    }`}
                  >
                    <td className="px-3 py-2 align-top font-medium text-slate-800">
                      {c.key}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Badge tone={toneFromStatus(c.status)}>
                        {c.status || (c.ok ? "ok" : "unknown")}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-top text-slate-700">
                      {typeof c.ms === "number" ? `${c.ms} ms` : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-[11px] md:text-xs text-slate-700">
                      {c.desc || c.error || (c.ok ? "OK" : "—")}
                    </td>
                  </tr>
                ))}
                {(!checks || checks.length === 0) && (
                  <tr>
                    <td
                      className="px-3 py-4 text-slate-600 text-xs"
                      colSpan={4}
                    >
                      No checks reported in the current summary.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------- Subcomponents ----------

function MetricCard({ label, value, tone = "neutral", money = false, hint }) {
  const toneClasses =
    tone === "ok"
      ? "border-emerald-100 bg-emerald-50/60"
      : tone === "degraded"
      ? "border-amber-100 bg-amber-50/70"
      : tone === "error"
      ? "border-rose-100 bg-rose-50/70"
      : "border-slate-100 bg-white";

  const formattedValue =
    value == null
      ? "—"
      : money
      ? Number(value || 0).toLocaleString("en-BD", {
          maximumFractionDigits: 2,
        })
      : value;

  return (
    <div
      className={`rounded-3xl border px-4 py-3 text-sm shadow-[0_10px_26px_rgba(15,23,42,0.05)] ${toneClasses}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-[0.16em] uppercase text-slate-600">
          {label}
        </span>
      </div>
      <div className="mt-1 text-lg font-semibold text-slate-900">
        {formattedValue}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-slate-500 leading-snug">
          {hint}
        </div>
      )}
    </div>
  );
}

function EnvRow({ label, value, mono = false }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs md:text-[13px]">
      <span className="text-slate-500">{label}</span>
      <span
        className={`${
          mono ? "font-mono" : "font-medium"
        } text-slate-800 break-all`}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function QueueCard({ queue, canManage, busyAction, onAction }) {
  const activeDepth =
    typeof queue.depth === "number" ? queue.depth : queue.size;

  const actions = [
    { key: "rerun", label: "Rerun" },
    { key: "retry", label: "Retry failed" },
    { key: "drain", label: "Drain" },
    { key: "pause", label: "Pause" },
    { key: "resume", label: "Resume" },
    { key: "clearfailed", label: "Clear failed" },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            {queue.label || queue.name}
            {queue.paused && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                Paused
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600">
            Depth: {activeDepth ?? 0} · Failed:{" "}
            {queue.failed ?? queue.failedCount ?? 0} · Delayed:{" "}
            {queue.delayed ?? 0}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Concurrency: {queue.concurrency ?? "—"} · Last run:{" "}
            {queue.lastRunAt
              ? new Date(queue.lastRunAt).toLocaleString()
              : "—"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {actions.map((a) => {
          const key = `${a.key}:${queue.name}`;
          const busy = busyAction === key;
          return (
            <PondButton
              key={a.key}
              label={a.label}
              size="sm"
              subtle
              disabled={!canManage || busy}
              onClick={() => onAction(a.key, queue.name)}
            />
          );
        })}
      </div>
    </div>
  );
}
