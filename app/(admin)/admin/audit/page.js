// FILE: app/(admin)/admin/audit/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const SUITES = [
  { key: "security", label: "Security & Access" },
  { key: "orders", label: "Orders & Fulfillment" },
  { key: "payments", label: "Payments & Refunds" },
  { key: "inventory", label: "Inventory" },
  { key: "catalog", label: "Catalog" },
  { key: "finance", label: "Finance & Tax" },
  { key: "customer", label: "Customer & CX" },
  { key: "notifications", label: "Notifications" },
  { key: "wallet", label: "Wallet & Loyalty" },
  { key: "health", label: "Platform Health" },
  { key: "compliance", label: "Compliance" },
];

const SEVERITIES = ["debug", "info", "warn", "error", "critical"];
const STATUSES = ["success", "failure", "denied", "partial", "unknown"];

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

function toISODateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function AuditAdminPage() {
  const [perms, setPerms] = useState(null);

  // applied query state (drives fetch)
  const [applied, setApplied] = useState({
    suite: "security",
    q: "",
    severity: "",
    status: "",
    actor: "",
    from: "",
    to: "",
    page: 1,
    pageSize: 20,
    view: "events", // events | alerts | reports
  });

  // draft UI state (does not fetch until Apply)
  const [draft, setDraft] = useState(applied);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  const [kpis, setKpis] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // ETag cache for "refresh only if changed"
  const etagRef = useRef("");

  useEffect(() => {
    (async () => {
      const j = await fetch("/api/admin/session", { cache: "no-store" })
        .then((r) => r.json())
        .catch(() => ({}));
      setPerms(j?.user?.permissions || []);
    })();
  }, []);

  const canView = useMemo(() => perms?.includes("VIEW_AUDIT"), [perms]);
  const canExport = useMemo(
    () => perms?.includes("EXPORT_AUDIT") || perms?.includes("VIEW_AUDIT"),
    [perms]
  );

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("suite", applied.suite);
    if (applied.q) p.set("q", applied.q);
    if (applied.severity) p.set("severity", applied.severity);
    if (applied.status) p.set("status", applied.status);
    if (applied.actor) p.set("actor", applied.actor);
    if (applied.from) p.set("from", applied.from);
    if (applied.to) p.set("to", applied.to);
    p.set("page", String(applied.page));
    p.set("pageSize", String(applied.pageSize));
    p.set("view", applied.view);
    return p.toString();
  }, [applied]);

  async function load({ reason = "load" } = {}) {
    if (!canView) return;
    setErr("");
    setLoading(true);

    try {
      const url =
        applied.view === "alerts"
          ? `/api/admin/audit/alerts?${queryString}`
          : `/api/audit/search?${queryString}`;

      const headers = {};
      // only use conditional request for “Refresh” / repeated loads
      if (reason !== "first" && etagRef.current) {
        headers["If-None-Match"] = etagRef.current;
      }

      const r = await fetch(url, {
        cache: "no-store",
        headers,
      });

      if (r.status === 304) {
        // nothing changed
        setLoading(false);
        return;
      }

      const nextEtag = r.headers.get("ETag");
      if (nextEtag) etagRef.current = nextEtag;

      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "AUDIT_FETCH_FAILED");

      setItems(j.items || []);
      setTotal(j.total || 0);
      setKpis(j.kpis || null);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    // initial load only
    load({ reason: "first" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, applied.view]);

  useEffect(() => {
    if (!canView) return;
    load({ reason: "load" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, queryString]);

  if (perms === null) return <div className="text-sm">Checking permissions…</div>;
  if (!canView)
    return (
      <div className="rounded border bg-white p-4 text-sm text-red-600">
        You need VIEW_AUDIT.
      </div>
    );

  const suiteLabel = SUITES.find((s) => s.key === applied.suite)?.label || "Audit";

  const exportBase =
    applied.view === "alerts"
      ? `/api/admin/audit/alerts/export?${queryString}`
      : `/api/admin/audit/export?${queryString}`;

  const savedViews = [
    {
      name: "Security: Auth failures (7d)",
      apply: {
        view: "events",
        suite: "security",
        status: "failure",
        severity: "warn",
        from: toISODateInput(new Date(Date.now() - 7 * 864e5)),
        to: toISODateInput(new Date()),
      },
    },
    {
      name: "Inventory: Manual adjustments (30d)",
      apply: {
        view: "events",
        suite: "inventory",
        q: "manual_adjust",
        from: toISODateInput(new Date(Date.now() - 30 * 864e5)),
        to: toISODateInput(new Date()),
      },
    },
    {
      name: "Finance: Refund approvals (30d)",
      apply: {
        view: "events",
        suite: "payments",
        q: "refund_approved",
        from: toISODateInput(new Date(Date.now() - 30 * 864e5)),
        to: toISODateInput(new Date()),
      },
    },
    {
      name: "Alerts: Critical unresolved",
      apply: { view: "alerts", suite: "health", severity: "critical" },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Audit Center</h1>
          <div className="mt-1 text-xs text-neutral-600">
            {suiteLabel} — immutable events, alerts, and exportable reports.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => load({ reason: "refresh" })}
            className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Refresh
          </button>

          {canExport && (
            <div className="flex items-center gap-2">
              <a
                href={`${exportBase}&format=csv`}
                className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Export CSV
              </a>
              <a
                href={`${exportBase}&format=jsonl`}
                className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Export JSONL
              </a>
              <a
                href={`${exportBase}&format=pdf`}
                className="rounded border bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Export PDF
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "events", label: "Events" },
          { key: "alerts", label: "Alerts & Warnings" },
          { key: "reports", label: "Reports (Saved Views)" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => {
              etagRef.current = "";
              setApplied((s) => ({ ...s, view: t.key, page: 1 }));
              setDraft((s) => ({ ...s, view: t.key, page: 1 }));
            }}
            className={cx(
              "rounded-full border px-4 py-1.5 text-sm transition",
              applied.view === t.key
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "bg-white hover:bg-neutral-50"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded border bg-white p-3">
          <div className="text-xs text-neutral-600">Total (filtered)</div>
          <div className="mt-1 text-lg font-semibold">{total}</div>
        </div>
        <div className="rounded border bg-white p-3">
          <div className="text-xs text-neutral-600">Last 24h</div>
          <div className="mt-1 text-lg font-semibold">{kpis?.last24h ?? "—"}</div>
        </div>
        <div className="rounded border bg-white p-3">
          <div className="text-xs text-neutral-600">Failures</div>
          <div className="mt-1 text-lg font-semibold">{kpis?.failures ?? "—"}</div>
        </div>
        <div className="rounded border bg-white p-3">
          <div className="text-xs text-neutral-600">Critical</div>
          <div className="mt-1 text-lg font-semibold">{kpis?.critical ?? "—"}</div>
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {/* Filters */}
      {applied.view !== "reports" && (
        <div className="rounded border bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6 lg:gap-4 w-full">
              <div>
                <div className="text-xs text-neutral-600 mb-1">Suite</div>
                <select
                  value={draft.suite}
                  onChange={(e) => setDraft((s) => ({ ...s, suite: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                >
                  {SUITES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <div className="text-xs text-neutral-600 mb-1">Search</div>
                <input
                  value={draft.q}
                  onChange={(e) => setDraft((s) => ({ ...s, q: e.target.value }))}
                  placeholder="action / resource / orderId / productId / email…"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <div className="text-xs text-neutral-600 mb-1">Severity</div>
                <select
                  value={draft.severity}
                  onChange={(e) => setDraft((s) => ({ ...s, severity: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                >
                  <option value="">All</option>
                  {SEVERITIES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs text-neutral-600 mb-1">Status</div>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((s) => ({ ...s, status: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                >
                  <option value="">All</option>
                  {STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="text-xs text-neutral-600 mb-1">Actor (email/id)</div>
                <input
                  value={draft.actor}
                  onChange={(e) => setDraft((s) => ({ ...s, actor: e.target.value }))}
                  placeholder="staff@…"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <div className="text-xs text-neutral-600 mb-1">From</div>
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft((s) => ({ ...s, from: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <div className="text-xs text-neutral-600 mb-1">To</div>
                <input
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft((s) => ({ ...s, to: e.target.value }))}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <div className="text-xs text-neutral-600 mb-1">Page size</div>
                <select
                  value={draft.pageSize}
                  onChange={(e) =>
                    setDraft((s) => ({ ...s, pageSize: Number(e.target.value) }))
                  }
                  className="w-full rounded border px-2 py-1.5 text-sm"
                >
                  {[20, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  etagRef.current = "";
                  setDraft((s) => ({ ...s, page: 1 }));
                  setApplied((s) => ({
                    ...draft,
                    page: 1,
                  }));
                }}
                className="rounded border bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-800"
              >
                Apply
              </button>
              <button
                onClick={() => {
                  etagRef.current = "";
                  const reset = {
                    ...applied,
                    q: "",
                    severity: "",
                    status: "",
                    actor: "",
                    from: "",
                    to: "",
                    page: 1,
                  };
                  setDraft(reset);
                  setApplied(reset);
                }}
                className="rounded border bg-white px-4 py-2 text-sm hover:bg-neutral-50"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="mt-3 text-xs text-neutral-600">
            Tip: This page only refetches when you click <span className="font-medium">Apply</span> or{" "}
            <span className="font-medium">Refresh</span>. With ETag enabled server-side, Refresh does
            nothing if no data changed.
          </div>
        </div>
      )}

      {/* Reports view */}
      {applied.view === "reports" && (
        <div className="rounded border bg-white p-4">
          <div className="font-medium">Saved Views</div>
          <div className="mt-1 text-xs text-neutral-600">
            One-click report presets. You can extend these into server-scheduled reports later.
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {savedViews.map((v) => (
              <button
                key={v.name}
                onClick={() => {
                  etagRef.current = "";
                  const next = { ...applied, ...v.apply, page: 1, pageSize: 50 };
                  setApplied(next);
                  setDraft(next);
                }}
                className="rounded border bg-white p-4 text-left hover:bg-neutral-50"
              >
                <div className="text-sm font-semibold">{v.name}</div>
                <div className="mt-1 text-xs text-neutral-600">
                  Click to load with filters; export from header.
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      {applied.view !== "reports" && (
        <div className="rounded border bg-white overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b">
            <div className="font-medium">
              {applied.view === "alerts" ? "Alerts" : "Events"}{" "}
              <span className="text-neutral-500 font-normal">({total})</span>
            </div>
            <div className="text-xs text-neutral-600">
              {loading ? "Loading…" : "Ready"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Suite</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-3 py-2 text-left">Severity</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Resource</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{e.suite || "—"}</td>
                    <td className="px-3 py-2">{e.actorEmail || e.actorId || "—"}</td>
                    <td className="px-3 py-2">{e.actorRole || "—"}</td>
                    <td className="px-3 py-2">{e.severity || "info"}</td>
                    <td className="px-3 py-2">{e.action}</td>
                    <td className="px-3 py-2">
                      {e.resourceType}/{e.resourceId}
                    </td>
                    <td className="px-3 py-2">{e.status}</td>
                    <td className="px-3 py-2">{e.ip || "—"}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-neutral-600" colSpan={9}>
                      No events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 p-3 border-t text-sm">
            <button
              disabled={applied.page <= 1}
              onClick={() => {
                setApplied((s) => ({ ...s, page: Math.max(1, s.page - 1) }));
                setDraft((s) => ({ ...s, page: Math.max(1, s.page - 1) }));
              }}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Prev
            </button>
            <span>Page {applied.page}</span>
            <button
              disabled={items.length < applied.pageSize}
              onClick={() => {
                setApplied((s) => ({ ...s, page: s.page + 1 }));
                setDraft((s) => ({ ...s, page: s.page + 1 }));
              }}
              className="rounded border px-2 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
