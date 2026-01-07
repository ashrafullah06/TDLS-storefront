// FILE: app/(admin)/admin/control-panel-client.jsx
"use client";

import React from "react";
import Link from "next/link";

/** Brand palette */
const NAVY = "#0F2147";
const MUTED = "#6B7280";
const BORDER = "#DFE3EC";
const GOLD = "#D4AF37";

/** Local activity log (client-only) */
const LOG_KEY = "tdlc_admin_controlpanel_log_v1";
const MAX_LOG = 60;

/* ───────────────────────── tiny UI primitives ───────────────────────── */

function Button({
  tone = "primary", // primary | secondary | ghost | danger
  size = "lg", // sm | md | lg | xl
  disabled,
  children,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      className={`cp-btn cp-btn--${tone} cp-btn--${size} ${className}`}
      disabled={!!disabled}
      {...props}
    >
      <span className="cp-btn__inner">{children}</span>
    </button>
  );
}

function Input({
  id,
  value,
  onChange,
  placeholder,
  type = "text",
  minWidth,
  onKeyDown,
}) {
  return (
    <input
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type={type}
      onKeyDown={onKeyDown}
      className="cp-input"
      style={minWidth ? { minWidth } : undefined}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  onKeyDown,
}) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      onKeyDown={onKeyDown}
      className="cp-textarea"
      spellCheck={false}
    />
  );
}

function Row({ children }) {
  return <div className="cp-row">{children}</div>;
}

function CardShell({ title, subtitle, children, right }) {
  return (
    <section className="cp-card">
      <div className="cp-card__top">
        <div className="cp-card__twrap">
          <div className="cp-card__title">{title}</div>
          {subtitle ? <div className="cp-card__sub">{subtitle}</div> : null}
        </div>
        {right ? <div className="cp-card__right">{right}</div> : null}
      </div>
      <div className="cp-card__body">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="cp-field">
      <div className="cp-field__label">
        <div className="cp-field__k">{label}</div>
        {hint ? <div className="cp-field__h">{hint}</div> : null}
      </div>
      <div className="cp-field__control">{children}</div>
    </div>
  );
}

function ArmToggle({ checked, onChange, label, hint }) {
  return (
    <label className="cp-arm">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="cp-arm__box" aria-hidden />
      <span className="cp-arm__text">
        <span className="cp-arm__label">{label}</span>
        {hint ? <span className="cp-arm__hint">{hint}</span> : null}
      </span>
    </label>
  );
}

function Banner({ state, onClose }) {
  if (!state) return null;
  const tone = state.type || "info";
  const colors =
    tone === "success"
      ? { bg: "#ecfdf5", bd: "#34d399", fg: "#065f46" }
      : tone === "error"
      ? { bg: "#fef2f2", bd: "#f87171", fg: "#7f1d1d" }
      : tone === "warn"
      ? { bg: "#fffbeb", bd: "#f59e0b", fg: "#7c2d12" }
      : { bg: "#eff6ff", bd: "#60a5fa", fg: "#1e3a8a" };

  return (
    <div
      role="status"
      className="cp-banner"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.bd}`,
        color: colors.fg,
      }}
    >
      <div className="cp-banner__left">
        <div className="cp-banner__title">
          {state.title ||
            (tone === "success"
              ? "Success"
              : tone === "error"
              ? "Error"
              : "Notice")}
        </div>

        {state.message ? <div className="cp-banner__msg">{state.message}</div> : null}

        {state.meta ? (
          <div className="cp-banner__meta">
            {Object.entries(state.meta).map(([k, v]) => (
              <span key={k} className="cp-chip">
                <span className="cp-chip__k">{k}</span>
                <span className="cp-chip__v">{String(v)}</span>
              </span>
            ))}
          </div>
        ) : null}

        {state.details ? (
          <details className="cp-details">
            <summary>Details</summary>
            <pre className="cp-pre">
              {typeof state.details === "string"
                ? state.details
                : JSON.stringify(state.details, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>

      <button type="button" onClick={onClose} aria-label="Dismiss" className="cp-x">
        ×
      </button>
    </div>
  );
}

/* ───────────────────────── helpers ───────────────────────── */

function safeJsonParse(txt) {
  if (!txt || !String(txt).trim()) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return { __invalid_json__: true, raw: txt };
  }
}

function readLog() {
  try {
    if (typeof window === "undefined") return [];
    const raw = localStorage.getItem(LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(rows) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      LOG_KEY,
      JSON.stringify(Array.isArray(rows) ? rows.slice(0, MAX_LOG) : [])
    );
  } catch {}
}

async function copyText(txt) {
  try {
    await navigator.clipboard.writeText(String(txt || ""));
    return true;
  } catch {
    return false;
  }
}

function NavItem({ active, title, subtitle, kbd, onClick }) {
  return (
    <button
      type="button"
      className={`cp-navitem ${active ? "cp-navitem--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      title={subtitle || title}
    >
      <span className="cp-navitem__mid">
        <span className="cp-navitem__t">{title}</span>
        {subtitle ? <span className="cp-navitem__s">{subtitle}</span> : null}
      </span>
      <span className="cp-navitem__kbd">{kbd}</span>
    </button>
  );
}

/* ───────────────────────── main ───────────────────────── */

export default function ControlPanelClient({ allow, endpoints }) {
  const [banner, setBanner] = React.useState(null);
  const [busyKey, setBusyKey] = React.useState("");
  const [section, setSection] = React.useState("Logistics");
  const [showLog, setShowLog] = React.useState(false);
  const [logRows, setLogRows] = React.useState([]);
  const [safetyMode, setSafetyMode] = React.useState(true);
  const [showEndpoints, setShowEndpoints] = React.useState(false);

  const abortRef = React.useRef(null);

  React.useEffect(() => {
    setLogRows(readLog());
  }, []);

  const pushLog = React.useCallback((row) => {
    setLogRows((prev) => {
      const next = [row, ...(Array.isArray(prev) ? prev : [])].slice(0, MAX_LOG);
      writeLog(next);
      return next;
    });
  }, []);

  const can = (k) => (allow?.[k] === false ? false : true);

  // Manual fields
  const [shipmentProvider, setShipmentProvider] = React.useState("redx");
  const [shipmentId, setShipmentId] = React.useState("");

  const [composeUserId, setComposeUserId] = React.useState("");
  const [composeTitle, setComposeTitle] = React.useState("");
  const [composeBody, setComposeBody] = React.useState("");
  const [composeType, setComposeType] = React.useState("SYSTEM");
  const [composeEmail, setComposeEmail] = React.useState("");

  const [couponCode, setCouponCode] = React.useState("");
  const [bannerKey, setBannerKey] = React.useState("");

  const [taxRulePayload, setTaxRulePayload] = React.useState("");

  // arming toggles
  const [armReconcile, setArmReconcile] = React.useState(false);
  const [armStrapiRebuild, setArmStrapiRebuild] = React.useState(false);
  const [armStrapiPublish, setArmStrapiPublish] = React.useState(false);
  const [armPrismaMigrate, setArmPrismaMigrate] = React.useState(false);

  const [query, setQuery] = React.useState("");

  const sections = React.useMemo(
    () => [
      "Logistics",
      "Payments",
      "Notifications",
      "Promotions",
      "Tax",
      "CMS",
      "Ops Shortcuts",
      "Data & Integrations",
      "Access & Reports",
    ],
    []
  );

  const sectionMeta = React.useMemo(
    () => ({
      Logistics: "Labels, carriers, shipment tools",
      Payments: "Reconcile & integrity checks (armed)",
      Notifications: "In-app/email messages",
      Promotions: "Coupons, banners, controlled rollouts",
      Tax: "Tax rules JSON upserts",
      CMS: "Strapi + Prisma maintenance (armed)",
      "Ops Shortcuts": "Fast links into common admin work",
      "Data & Integrations": "Webhooks, exports, feature flags",
      "Access & Reports": "RBAC, staff, reports, PDFs",
    }),
    []
  );

  const filteredSections = React.useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => s.toLowerCase().includes(q));
  }, [query, sections]);

  // keyboard shortcuts: 1–9, ctrl+k, esc
  React.useEffect(() => {
    function onKey(e) {
      const activeTag = (document?.activeElement?.tagName || "").toLowerCase();
      const isTyping =
        activeTag === "input" || activeTag === "textarea" || activeTag === "select";

      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") {
        e.preventDefault();
        const el = document.getElementById("cp-search");
        el?.focus?.();
        return;
      }
      if (e.key === "Escape") {
        if (banner) setBanner(null);
        if (!isTyping) setShowEndpoints(false);
        return;
      }

      if (isTyping) return;
      const idx = Number(e.key);
      if (idx >= 1 && idx <= sections.length) {
        const next = sections[idx - 1];
        if (next) setSection(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sections, banner]);

  async function runAction(actionKey, path, body, opts = {}) {
    if (!path) {
      setBanner({
        type: "warn",
        title: "Missing endpoint",
        message: "This action has no endpoint configured.",
        meta: { action: actionKey },
      });
      return;
    }

    // Safety mode: slightly discourages destructive actions
    if (safetyMode && opts?.destructive) {
      setBanner({
        type: "warn",
        title: "Safety Mode is On",
        message: "Disable Safety Mode to run destructive operations.",
        meta: { action: actionKey },
      });
      return;
    }

    if (busyKey) return;

    const startedAt = Date.now();
    setBusyKey(actionKey);
    setBanner(null);

    try {
      // abort previous
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const timeoutMs = opts.timeoutMs ?? 25000;
      const timeoutId = setTimeout(() => ac.abort(), timeoutMs);

      const method = opts.method || (body ? "POST" : "POST");
      const r = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });

      const j = await r.json().catch(() => ({}));
      const ms = Date.now() - startedAt;

      if (!r.ok) {
        setBanner({
          type: "error",
          title: `Failed (${r.status})`,
          message: j?.error || "Request failed.",
          details: j,
          meta: { action: actionKey, ms },
        });

        pushLog({
          ts: new Date().toISOString(),
          action: actionKey,
          ok: false,
          status: r.status,
          ms,
          path,
          body: body || null,
          result: j,
        });

        clearTimeout(timeoutId);
        return;
      }

      setBanner({
        type: "success",
        title: "Completed",
        message: "Action executed successfully.",
        details: j,
        meta: { action: actionKey, ms },
      });

      pushLog({
        ts: new Date().toISOString(),
        action: actionKey,
        ok: true,
        status: r.status,
        ms,
        path,
        body: body || null,
        result: j,
      });

      clearTimeout(timeoutId);
    } catch (e) {
      const ms = Date.now() - startedAt;
      const msg =
        e?.name === "AbortError"
          ? "Request timed out / aborted."
          : e?.message || String(e);

      setBanner({
        type: e?.name === "AbortError" ? "warn" : "error",
        title: e?.name === "AbortError" ? "Timeout" : "Network/Server error",
        message: msg,
        meta: { action: actionKey, ms },
      });

      pushLog({
        ts: new Date().toISOString(),
        action: actionKey,
        ok: false,
        status: "ERR",
        ms,
        path,
        body: body || null,
        result: { error: msg },
      });
    } finally {
      setBusyKey("");
    }
  }

  const showSection = filteredSections.includes(section)
    ? section
    : filteredSections[0] || "Logistics";

  const EndpointRow = ({ label, value }) => (
    <button
      type="button"
      className="cp-ep"
      title="Copy endpoint"
      onClick={async () => {
        const ok = await copyText(value);
        setBanner({
          type: ok ? "success" : "warn",
          title: ok ? "Copied" : "Copy failed",
          message: ok
            ? `${label} endpoint copied to clipboard.`
            : "Clipboard permission denied.",
          meta: { endpoint: label },
        });
      }}
    >
      <span className="cp-ep__k">{label}</span>
      <span className="cp-ep__v">{value || "—"}</span>
      <span className="cp-ep__c">Copy</span>
    </button>
  );

  return (
    <div className="cp-wrap">
      <div className="cp-bg" aria-hidden />

      {/* Header */}
      <div className="cp-head">
        <div className="cp-head__left">
          <div className="cp-head__kicker">Admin</div>
          <div className="cp-head__title">Control Panel</div>
          <div className="cp-head__sub">
            High-trust operations with inline results, safety gates, and audit trail.
          </div>
        </div>

        <div className="cp-head__right">
          <div className="cp-head__meta">
            <span className="cp-meta">
              <span className="cp-meta__k">Safety</span>
              <span className="cp-meta__v">{safetyMode ? "On" : "Off"}</span>
            </span>
            <span className="cp-meta">
              <span className="cp-meta__k">Shortcuts</span>
              <span className="cp-meta__v">1–9, Ctrl+K, Esc</span>
            </span>
          </div>

          <div className="cp-head__actions">
            <Button
              tone="secondary"
              size="xl"
              onClick={() => setShowLog((v) => !v)}
              aria-pressed={showLog}
              title="Show/hide action history"
            >
              {showLog ? "Hide History" : "Show History"}
            </Button>

            <Button
              tone="secondary"
              size="xl"
              onClick={() => setSafetyMode((v) => !v)}
              aria-pressed={!safetyMode}
              title="Safety Mode reduces emphasis on destructive actions"
            >
              Safety: {safetyMode ? "On" : "Off"}
            </Button>

            <Button
              tone="ghost"
              size="xl"
              onClick={() => setShowEndpoints((v) => !v)}
              aria-pressed={showEndpoints}
              title="Show/hide endpoints"
            >
              {showEndpoints ? "Hide Endpoints" : "Show Endpoints"}
            </Button>
          </div>

          <div className="cp-head__search">
            <Input
              id="cp-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sections… (Ctrl+K)"
              minWidth={320}
              type="text"
              onKeyDown={(e) => {
                if (e.key === "Enter" && filteredSections?.[0]) {
                  setSection(filteredSections[0]);
                }
              }}
            />
          </div>
        </div>
      </div>

      {showEndpoints ? (
        <div className="cp-endpoints">
          <EndpointRow label="Logistics: labelBase" value={endpoints?.logistics?.labelBase} />
          <EndpointRow label="Payments: reconcile" value={endpoints?.payments?.reconcile} />
          <EndpointRow label="Notifications: send" value={endpoints?.notifications?.send} />
          <EndpointRow label="Promotions: coupons" value={endpoints?.promotions?.coupons} />
          <EndpointRow label="Promotions: banners" value={endpoints?.promotions?.banners} />
          <EndpointRow label="Tax: rules" value={endpoints?.tax?.rules} />
          <EndpointRow label="CMS: Strapi clearCache" value={endpoints?.cms?.strapi?.clearCache} />
          <EndpointRow label="CMS: Strapi rebuild" value={endpoints?.cms?.strapi?.rebuild} />
          <EndpointRow label="CMS: Strapi publish" value={endpoints?.cms?.strapi?.publish} />
          <EndpointRow label="CMS: Prisma migrate" value={endpoints?.cms?.prisma?.migrate} />
          <EndpointRow label="CMS: Prisma generate" value={endpoints?.cms?.prisma?.generate} />
        </div>
      ) : null}

      {/* Banner */}
      <Banner state={banner} onClose={() => setBanner(null)} />

      {/* Layout */}
      <div className="cp-grid">
        {/* Left nav */}
        <aside className="cp-side">
          <div className="cp-side__title">Sections</div>
          <div className="cp-side__list">
            {sections.map((s, i) => (
              <NavItem
                key={s}
                active={showSection === s}
                title={s}
                subtitle={sectionMeta?.[s]}
                kbd={String(i + 1)}
                onClick={() => setSection(s)}
              />
            ))}
          </div>

          {showLog ? (
            <div className="cp-history">
              <div className="cp-history__top">
                <div className="cp-history__title">Recent Actions</div>
                <div className="cp-history__btns">
                  <Button
                    tone="ghost"
                    size="md"
                    onClick={() => {
                      writeLog([]);
                      setLogRows([]);
                      setBanner({
                        type: "info",
                        title: "Cleared",
                        message: "Local action history cleared.",
                      });
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <div className="cp-history__list">
                {logRows?.length ? (
                  logRows.map((r, idx) => (
                    <div key={`${r.ts || "ts"}-${idx}`} className="cp-hrow">
                      <div className="cp-hrow__a">
                        <span className={`cp-dot ${r.ok ? "cp-dot--ok" : "cp-dot--bad"}`} />
                        <span className="cp-hrow__k">{r.action}</span>
                      </div>
                      <div className="cp-hrow__m">
                        <span className="cp-hrow__t">
                          {r.ts ? new Date(r.ts).toLocaleString() : "—"}
                        </span>
                        <span className="cp-hrow__s">
                          {String(r.status)} · {Number(r.ms || 0)}ms
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="cp-empty">No actions yet.</div>
                )}
              </div>
            </div>
          ) : null}
        </aside>

        {/* Main */}
        <main className="cp-main">
          {/* Logistics */}
          {showSection === "Logistics" ? (
            <CardShell
              title="Logistics"
              subtitle="Create labels and operate shipment tools."
              right={
                <span className="cp-pill">
                  {can("logistics") ? "Enabled" : "Blocked by RBAC"}
                </span>
              }
            >
              <Row>
                <Field label="Provider" hint="Carrier key (e.g. redx)">
                  <Input
                    value={shipmentProvider}
                    onChange={(e) => setShipmentProvider(e.target.value)}
                    placeholder="redx"
                  />
                </Field>

                <Field label="Order / Shipment ID" hint="Internal orderId or shipmentId">
                  <Input
                    value={shipmentId}
                    onChange={(e) => setShipmentId(e.target.value)}
                    placeholder="e.g. 12345"
                  />
                </Field>
              </Row>

              <Row>
                <Button
                  tone="primary"
                  size="xl"
                  disabled={!can("logistics") || !shipmentId || busyKey === "logistics.label"}
                  onClick={() =>
                    runAction(
                      "logistics.label",
                      endpoints?.logistics?.labelBase,
                      { provider: shipmentProvider, id: shipmentId },
                      { timeoutMs: 25000 }
                    )
                  }
                >
                  {busyKey === "logistics.label" ? "Generating…" : "Generate Label"}
                </Button>

                <Button
                  tone="secondary"
                  size="xl"
                  disabled={!shipmentId}
                  onClick={async () => {
                    const ok = await copyText(String(shipmentId));
                    setBanner({
                      type: ok ? "success" : "warn",
                      title: ok ? "Copied" : "Copy failed",
                      message: ok ? "ID copied to clipboard." : "Clipboard permission denied.",
                      meta: { id: shipmentId },
                    });
                  }}
                >
                  Copy ID
                </Button>

                <a className="cp-link cp-link--big" href="/admin/logistics">
                  Open Logistics
                </a>
              </Row>
            </CardShell>
          ) : null}

          {/* Payments */}
          {showSection === "Payments" ? (
            <CardShell
              title="Payments"
              subtitle="Run reconciliations and integrity checks (armed)."
              right={
                <span className="cp-pill">
                  {can("payments") ? "Enabled" : "Blocked by RBAC"}
                </span>
              }
            >
              <Row>
                <ArmToggle
                  checked={armReconcile}
                  onChange={setArmReconcile}
                  label="Arm reconciliation"
                  hint="Required before running reconcile."
                />
              </Row>

              <Row>
                <Button
                  tone="primary"
                  size="xl"
                  disabled={
                    !can("payments") ||
                    !armReconcile ||
                    busyKey === "payments.reconcile"
                  }
                  onClick={() =>
                    runAction(
                      "payments.reconcile",
                      endpoints?.payments?.reconcile,
                      { mode: "reconcile" },
                      { timeoutMs: 45000 }
                    )
                  }
                  title={!armReconcile ? "Arm reconciliation first" : undefined}
                >
                  {busyKey === "payments.reconcile" ? "Reconciling…" : "Run Reconcile"}
                </Button>

                <a className="cp-link cp-link--big" href="/admin/payments">
                  Open Payments
                </a>
              </Row>
            </CardShell>
          ) : null}

          {/* Notifications */}
          {showSection === "Notifications" ? (
            <CardShell
              title="Notifications"
              subtitle="Send in-app / email notifications."
              right={
                <span className="cp-pill">
                  {can("notifications") ? "Enabled" : "Blocked by RBAC"}
                </span>
              }
            >
              <Row>
                <Field label="User ID" hint="Optional for in-app targeting">
                  <Input
                    value={composeUserId}
                    onChange={(e) => setComposeUserId(e.target.value)}
                    placeholder="userId"
                  />
                </Field>

                <Field label="Email" hint="Optional email destination">
                  <Input
                    value={composeEmail}
                    onChange={(e) => setComposeEmail(e.target.value)}
                    placeholder="name@email.com"
                    type="email"
                  />
                </Field>

                <Field label="Type" hint="SYSTEM / ORDER / PROMO">
                  <Input
                    value={composeType}
                    onChange={(e) => setComposeType(e.target.value)}
                    placeholder="SYSTEM"
                  />
                </Field>
              </Row>

              <Row>
                <Field label="Title">
                  <Input
                    value={composeTitle}
                    onChange={(e) => setComposeTitle(e.target.value)}
                    placeholder="Notification title"
                  />
                </Field>
              </Row>

              <Row>
                <Field label="Body">
                  <TextArea
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    placeholder="Message body…"
                    rows={4}
                  />
                </Field>
              </Row>

              <Row>
                <Button
                  tone="primary"
                  size="xl"
                  disabled={
                    !can("notifications") ||
                    !composeTitle ||
                    !composeBody ||
                    busyKey === "notifications.send"
                  }
                  onClick={() =>
                    runAction(
                      "notifications.send",
                      endpoints?.notifications?.send,
                      {
                        userId: composeUserId || null,
                        email: composeEmail || null,
                        type: composeType || "SYSTEM",
                        title: composeTitle,
                        body: composeBody,
                      },
                      { timeoutMs: 25000 }
                    )
                  }
                >
                  {busyKey === "notifications.send" ? "Sending…" : "Send Notification"}
                </Button>

                <a className="cp-link cp-link--big" href="/admin/notifications">
                  Open Notifications
                </a>
              </Row>
            </CardShell>
          ) : null}

          {/* Promotions */}
          {showSection === "Promotions" ? (
            <CardShell
              title="Promotions"
              subtitle="Coupons, banners, controlled rollouts."
              right={
                <span className="cp-pill">
                  {can("promotions") ? "Enabled" : "Blocked by RBAC"}
                </span>
              }
            >
              <Row>
                <Field label="Coupon code" hint="e.g. EID25">
                  <Input
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="EID25"
                  />
                </Field>

                <Field label="Banner key" hint="e.g. homepage_hero">
                  <Input
                    value={bannerKey}
                    onChange={(e) => setBannerKey(e.target.value)}
                    placeholder="homepage_hero"
                  />
                </Field>
              </Row>

              <Row>
                <Button
                  tone="primary"
                  size="xl"
                  disabled={
                    !can("promotions") || !couponCode || busyKey === "promotions.coupon"
                  }
                  onClick={() =>
                    runAction(
                      "promotions.coupon",
                      endpoints?.promotions?.coupons,
                      { code: couponCode },
                      { timeoutMs: 25000 }
                    )
                  }
                >
                  {busyKey === "promotions.coupon" ? "Saving…" : "Create/Update Coupon"}
                </Button>

                <Button
                  tone="secondary"
                  size="xl"
                  disabled={
                    !can("promotions") || !bannerKey || busyKey === "promotions.banner"
                  }
                  onClick={() =>
                    runAction(
                      "promotions.banner",
                      endpoints?.promotions?.banners,
                      { key: bannerKey },
                      { timeoutMs: 25000 }
                    )
                  }
                >
                  {busyKey === "promotions.banner" ? "Saving…" : "Create/Update Banner"}
                </Button>

                <a className="cp-link cp-link--big" href="/admin/promotions">
                  Open Promotions
                </a>
              </Row>
            </CardShell>
          ) : null}

          {/* Tax */}
          {showSection === "Tax" ? (
            <CardShell
              title="Tax"
              subtitle="Upsert tax rules from JSON payload."
              right={
                <span className="cp-pill">
                  {can("tax") ? "Enabled" : "Blocked by RBAC"}
                </span>
              }
            >
              <Row>
                <Field
                  label="Tax rule payload (JSON)"
                  hint="Example: { &quot;country&quot;:&quot;BD&quot;, &quot;rate&quot;: 7.5 }"
                >
                  <TextArea
                    value={taxRulePayload}
                    onChange={(e) => setTaxRulePayload(e.target.value)}
                    placeholder='{"country":"BD","rate":7.5}'
                    rows={6}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        const parsed = safeJsonParse(taxRulePayload);
                        if (!parsed) return;
                        runAction("tax.rules", endpoints?.tax?.rules, parsed, { timeoutMs: 25000 });
                      }
                    }}
                  />
                </Field>
              </Row>

              <Row>
                <Button
                  tone="primary"
                  size="xl"
                  disabled={
                    !can("tax") ||
                    !safeJsonParse(taxRulePayload) ||
                    busyKey === "tax.rules"
                  }
                  onClick={() => {
                    const parsed = safeJsonParse(taxRulePayload);
                    if (!parsed) return;
                    runAction("tax.rules", endpoints?.tax?.rules, parsed, { timeoutMs: 25000 });
                  }}
                  title={!safeJsonParse(taxRulePayload) ? "Enter valid JSON" : undefined}
                >
                  {busyKey === "tax.rules" ? "Applying…" : "Apply Tax Rule"}
                </Button>

                <a className="cp-link cp-link--big" href="/admin/tax">
                  Open Tax
                </a>
              </Row>
            </CardShell>
          ) : null}

          {/* CMS */}
          {showSection === "CMS" ? (
            <CardShell
              title="CMS"
              subtitle="Strapi + Prisma maintenance (armed)."
              right={
                <span className="cp-pill">
                  {can("cms") ? "Enabled" : "Blocked by RBAC"}
                </span>
              }
            >
              <Row>
                <ArmToggle
                  checked={armStrapiRebuild}
                  onChange={setArmStrapiRebuild}
                  label="Arm Strapi rebuild"
                  hint="Required before rebuild."
                />
                <ArmToggle
                  checked={armStrapiPublish}
                  onChange={setArmStrapiPublish}
                  label="Arm Strapi publish"
                  hint="Required before publish."
                />
                <ArmToggle
                  checked={armPrismaMigrate}
                  onChange={setArmPrismaMigrate}
                  label="Arm Prisma migrate"
                  hint="Required before migrations."
                />
              </Row>

              <Row>
                <Button
                  tone="secondary"
                  size="xl"
                  disabled={!can("cms") || busyKey === "cms.strapi.clearCache"}
                  onClick={() =>
                    runAction(
                      "cms.strapi.clearCache",
                      endpoints?.cms?.strapi?.clearCache,
                      { action: "clear-cache" },
                      { timeoutMs: 25000 }
                    )
                  }
                >
                  {busyKey === "cms.strapi.clearCache" ? "Working…" : "Strapi: Clear Cache"}
                </Button>

                <Button
                  tone="primary"
                  size="xl"
                  disabled={
                    !can("cms") ||
                    !armStrapiRebuild ||
                    busyKey === "cms.strapi.rebuild"
                  }
                  onClick={() =>
                    runAction(
                      "cms.strapi.rebuild",
                      endpoints?.cms?.strapi?.rebuild,
                      { action: "rebuild" },
                      { timeoutMs: 60000, destructive: true }
                    )
                  }
                >
                  {busyKey === "cms.strapi.rebuild" ? "Rebuilding…" : "Strapi: Rebuild"}
                </Button>

                <Button
                  tone="primary"
                  size="xl"
                  disabled={
                    !can("cms") ||
                    !armStrapiPublish ||
                    busyKey === "cms.strapi.publish"
                  }
                  onClick={() =>
                    runAction(
                      "cms.strapi.publish",
                      endpoints?.cms?.strapi?.publish,
                      { action: "publish" },
                      { timeoutMs: 60000, destructive: true }
                    )
                  }
                >
                  {busyKey === "cms.strapi.publish" ? "Publishing…" : "Strapi: Publish"}
                </Button>
              </Row>

              <Row>
                <Button
                  tone="danger"
                  size="xl"
                  disabled={
                    !can("cms") ||
                    !armPrismaMigrate ||
                    busyKey === "cms.prisma.migrate"
                  }
                  onClick={() =>
                    runAction(
                      "cms.prisma.migrate",
                      endpoints?.cms?.prisma?.migrate,
                      { action: "migrate" },
                      { timeoutMs: 90000, destructive: true }
                    )
                  }
                >
                  {busyKey === "cms.prisma.migrate" ? "Migrating…" : "Prisma: Migrate"}
                </Button>

                <Button
                  tone="secondary"
                  size="xl"
                  disabled={!can("cms") || busyKey === "cms.prisma.generate"}
                  onClick={() =>
                    runAction(
                      "cms.prisma.generate",
                      endpoints?.cms?.prisma?.generate,
                      { action: "generate" },
                      { timeoutMs: 45000 }
                    )
                  }
                >
                  {busyKey === "cms.prisma.generate" ? "Generating…" : "Prisma: Generate"}
                </Button>

                <a className="cp-link cp-link--big" href="/admin/cms">
                  Open CMS
                </a>
              </Row>
            </CardShell>
          ) : null}

          {/* Ops Shortcuts */}
          {showSection === "Ops Shortcuts" ? (
            <CardShell
              title="Ops Shortcuts"
              subtitle="Fast links into common admin work."
            >
              <Row>
                <Link className="cp-link cp-link--big" href="/admin/orders">Orders</Link>
                <Link className="cp-link cp-link--big" href="/admin/inventory">Inventory</Link>
                <Link className="cp-link cp-link--big" href="/admin/products">Catalog</Link>
                <Link className="cp-link cp-link--big" href="/admin/customers">Customers</Link>
                <Link className="cp-link cp-link--big" href="/admin/analytics">Analytics</Link>
                <Link className="cp-link cp-link--big" href="/admin/health">Health</Link>
              </Row>
            </CardShell>
          ) : null}

          {/* Data & Integrations */}
          {showSection === "Data & Integrations" ? (
            <CardShell
              title="Data & Integrations"
              subtitle="Webhooks, exports, feature flags, and integrations."
            >
              <Row>
                <Link className="cp-link cp-link--big" href="/admin/integrations">Integrations</Link>
                <Link className="cp-link cp-link--big" href="/admin/webhooks">Webhooks</Link>
                <Link className="cp-link cp-link--big" href="/admin/feature-flags">Feature Flags</Link>
                <a className="cp-link cp-link--big" href="/api/reports/inventory-aging/summary" target="_blank" rel="noreferrer">
                  Inventory Aging (API)
                </a>
              </Row>
            </CardShell>
          ) : null}

          {/* Access & Reports */}
          {showSection === "Access & Reports" ? (
            <CardShell
              title="Access & Reports"
              subtitle="RBAC, staff access, and reporting."
            >
              <Row>
                <Link className="cp-link cp-link--big" href="/admin/settings">Settings</Link>
                <Link className="cp-link cp-link--big" href="/admin/users">Staff & Access</Link>
                <Link className="cp-link cp-link--big" href="/admin/reports/product-pnl">Product P&L</Link>
                <a className="cp-link cp-link--big" href="/api/reports/pnl/product/pdf" target="_blank" rel="noreferrer">
                  P&L PDF
                </a>
                <a className="cp-link cp-link--big" href="/api/reports/inventory-aging/summary" target="_blank" rel="noreferrer">
                  Inventory Aging
                </a>
              </Row>
            </CardShell>
          ) : null}
        </main>
      </div>

      {/* IMPORTANT: no styled-jsx here (avoids the "client-only" / Server Component import error) */}
      <style>{`
        .cp-bg{
          position:fixed; inset:0; z-index:-1;
          background:
            radial-gradient(1200px 600px at 10% -10%, rgba(12,35,64,0.10), transparent 55%),
            radial-gradient(900px 520px at 100% 0%, rgba(12,35,64,0.08), transparent 52%),
            linear-gradient(180deg, #ffffff 0%, #fbfbfd 45%, #ffffff 100%);
        }

        .cp-wrap{ margin-top:10px; display:grid; gap:14px; }

        /* Header */
        .cp-head{
          border:1px solid ${BORDER};
          border-radius:26px;
          background:rgba(255,255,255,0.88);
          box-shadow: 0 18px 70px rgba(12,35,64,0.10);
          padding:18px;
          display:flex; gap:16px;
          justify-content:space-between;
          flex-wrap:wrap;
          animation: cpFade 160ms ease-out both;
        }
        .cp-head__left{ min-width:280px; flex:1; }
        .cp-head__kicker{
          font-size:11px; font-weight:900;
          letter-spacing:0.14em; text-transform:uppercase;
          color:${NAVY}; opacity:0.92;
        }
        .cp-head__title{
          margin-top:8px; font-size:22px; font-weight:950;
          color:${NAVY}; letter-spacing:0.01em;
        }
        .cp-head__sub{
          margin-top:8px; font-size:12.5px;
          color:${MUTED}; line-height:1.6; font-weight:700;
          max-width:720px;
        }
        .cp-head__right{
          min-width:340px; flex:0.95;
          display:grid; gap:12px; align-content:start;
        }
        .cp-head__meta{ display:flex; flex-wrap:wrap; gap:10px; }
        .cp-head__actions{ display:flex; flex-wrap:wrap; gap:10px; }
        .cp-head__search{ display:flex; justify-content:flex-start; }

        .cp-meta{
          display:inline-flex; gap:10px; align-items:center;
          border:1px solid ${BORDER};
          background:rgba(255,255,255,0.92);
          border-radius:999px;
          padding:10px 14px;
          box-shadow: 0 14px 50px rgba(12,35,64,0.08);
        }
        .cp-meta__k{
          font-size:11px; font-weight:900; color:${NAVY};
          letter-spacing:0.08em; text-transform:uppercase;
        }
        .cp-meta__v{ font-size:11px; color:${MUTED}; font-weight:800; }

        /* Endpoints */
        .cp-endpoints{ display:grid; gap:12px; grid-template-columns:1fr; }
        @media (min-width:1024px){ .cp-endpoints{ grid-template-columns:1fr 1fr; } }
        .cp-ep{
          display:grid;
          grid-template-columns: 190px 1fr auto;
          align-items:center; gap:12px;
          padding:14px 16px;
          border:1px solid ${BORDER};
          border-radius:22px;
          background: rgba(255,255,255,0.88);
          box-shadow: 0 18px 70px rgba(12,35,64,0.10);
          cursor:pointer; text-align:left;
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .cp-ep:hover{ transform: translateY(-2px); box-shadow: 0 24px 80px rgba(12,35,64,0.14); border-color:#cfd6e6; }
        .cp-ep__k{ font-size:12px; font-weight:900; color:${NAVY}; letter-spacing:0.02em; }
        .cp-ep__v{ font-size:12px; color:${MUTED}; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cp-ep__c{
          font-size:12px; font-weight:900;
          color:${NAVY};
          padding:10px 14px;
          border:1px solid ${BORDER};
          border-radius:999px;
          background:#fff;
          box-shadow: 0 10px 25px rgba(12,35,64,0.08);
        }

        /* Grid */
        .cp-grid{
          display:grid;
          grid-template-columns: 320px 1fr;
          gap:14px;
          align-items:start;
        }
        @media (max-width: 980px){
          .cp-grid{ grid-template-columns: 1fr; }
        }

        /* Sidebar */
        .cp-side{
          border:1px solid ${BORDER};
          border-radius:26px;
          background:rgba(255,255,255,0.88);
          box-shadow: 0 18px 70px rgba(12,35,64,0.10);
          padding:14px;
          display:grid; gap:12px;
        }
        .cp-side__title{
          font-size:12px; font-weight:950;
          color:${NAVY}; letter-spacing:0.12em;
          text-transform:uppercase;
          padding:8px 6px 2px;
        }
        .cp-side__list{ display:grid; gap:8px; }

        .cp-navitem{
          width:100%;
          display:flex; justify-content:space-between; align-items:center;
          gap:12px;
          padding:14px 14px;
          border-radius:20px;
          border:1px solid ${BORDER};
          background:#fff;
          cursor:pointer;
          text-align:left;
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
          box-shadow: 0 12px 40px rgba(12,35,64,0.07);
        }
        .cp-navitem:hover{
          transform: translateY(-2px);
          border-color:#cfd6e6;
          box-shadow: 0 20px 60px rgba(12,35,64,0.12);
        }
        .cp-navitem--active{
          border-color: rgba(212,175,55,0.55);
          box-shadow: 0 22px 70px rgba(12,35,64,0.14);
        }
        .cp-navitem__mid{ display:grid; gap:3px; }
        .cp-navitem__t{ font-weight:950; color:${NAVY}; font-size:13px; }
        .cp-navitem__s{ font-weight:800; color:${MUTED}; font-size:12px; }
        .cp-navitem__kbd{
          font-size:11px; font-weight:950; color:${NAVY};
          border:1px solid ${BORDER};
          border-radius:999px;
          padding:8px 10px;
          background: #fff;
        }

        /* Main cards */
        .cp-main{ display:grid; gap:14px; }
        .cp-card{
          border:1px solid ${BORDER};
          border-radius:26px;
          background:rgba(255,255,255,0.90);
          box-shadow: 0 18px 70px rgba(12,35,64,0.10);
          overflow:hidden;
          animation: cpFade 160ms ease-out both;
        }
        .cp-card__top{
          padding:18px 18px 14px;
          border-bottom:1px solid rgba(223,227,236,0.8);
          display:flex; align-items:flex-start; justify-content:space-between;
          gap:14px; flex-wrap:wrap;
        }
        .cp-card__twrap{ display:grid; gap:6px; }
        .cp-card__title{
          font-size:15px; font-weight:950; color:${NAVY};
          letter-spacing:0.01em;
        }
        .cp-card__sub{ font-size:12.5px; color:${MUTED}; font-weight:800; line-height:1.55; max-width:900px; }
        .cp-card__body{ padding:16px 18px 18px; display:grid; gap:12px; }

        /* Rows / fields */
        .cp-row{ display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; }
        .cp-field{ flex:1; min-width: 240px; display:grid; gap:8px; }
        .cp-field__label{ display:flex; justify-content:space-between; gap:10px; align-items:baseline; }
        .cp-field__k{ font-size:12px; font-weight:950; color:${NAVY}; }
        .cp-field__h{ font-size:12px; font-weight:800; color:${MUTED}; }
        .cp-input, .cp-textarea{
          width:100%;
          border:1px solid ${BORDER};
          border-radius:18px;
          padding:14px 16px;
          font-size:13px;
          font-weight:850;
          color:${NAVY};
          background:#fff;
          box-shadow: 0 14px 50px rgba(12,35,64,0.07);
          outline:none;
          transition: box-shadow 140ms ease, border-color 140ms ease, transform 140ms ease;
        }
        .cp-textarea{ resize: vertical; min-height: 110px; }
        .cp-input:focus, .cp-textarea:focus{
          border-color: rgba(212,175,55,0.70);
          box-shadow: 0 22px 70px rgba(12,35,64,0.12);
          transform: translateY(-1px);
        }

        /* Premium CTA buttons (bigger + rounder + cleaner) */
        .cp-btn{
          border:1px solid ${BORDER};
          border-radius:999px;
          cursor:pointer;
          user-select:none;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          text-align:center;
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease, background 140ms ease, opacity 140ms ease;
          box-shadow: 0 14px 55px rgba(12,35,64,0.10);
          font-weight:950;
          letter-spacing:0.01em;
          line-height:1;
        }
        .cp-btn:disabled{ cursor:not-allowed; opacity:0.55; box-shadow:none; }
        .cp-btn:hover:not(:disabled){ transform: translateY(-2px); box-shadow: 0 22px 70px rgba(12,35,64,0.14); border-color:#cfd6e6; }
        .cp-btn:active:not(:disabled){ transform: translateY(-1px); box-shadow: 0 16px 55px rgba(12,35,64,0.12); }
        .cp-btn:focus-visible{ outline: 3px solid rgba(212,175,55,0.35); outline-offset: 2px; }

        .cp-btn__inner{ display:inline-flex; align-items:center; gap:10px; }

        .cp-btn--sm{ padding:10px 14px; font-size:12px; }
        .cp-btn--md{ padding:12px 18px; font-size:12.5px; }
        .cp-btn--lg{ padding:14px 22px; font-size:13px; }
        .cp-btn--xl{ padding:16px 26px; font-size:13.5px; }

        .cp-btn--primary{
          color:#fff;
          border-color: rgba(212,175,55,0.40);
          background: linear-gradient(180deg, ${NAVY} 0%, #0b1a36 100%);
          box-shadow: 0 18px 70px rgba(12,35,64,0.18);
        }
        .cp-btn--primary:hover:not(:disabled){
          box-shadow: 0 26px 90px rgba(12,35,64,0.24);
          border-color: rgba(212,175,55,0.65);
        }

        .cp-btn--secondary{
          color:${NAVY};
          background:#fff;
        }

        .cp-btn--ghost{
          color:${NAVY};
          background: rgba(255,255,255,0.60);
          backdrop-filter: blur(6px);
        }

        .cp-btn--danger{
          color:#fff;
          border-color: rgba(248,113,113,0.55);
          background: linear-gradient(180deg, #b91c1c 0%, #7f1d1d 100%);
        }

        /* Links styled like CTAs */
        .cp-link{
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:10px;
          padding:12px 18px;
          border:1px solid ${BORDER};
          border-radius:999px;
          background:#fff;
          color:${NAVY};
          text-decoration:none;
          font-weight:950;
          box-shadow: 0 14px 55px rgba(12,35,64,0.10);
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .cp-link--big{ padding:16px 26px; font-size:13.5px; }
        .cp-link:hover{ transform: translateY(-2px); box-shadow: 0 22px 70px rgba(12,35,64,0.14); border-color:#cfd6e6; }

        /* Pills / small bits */
        .cp-pill{
          display:inline-flex; align-items:center;
          padding:10px 14px;
          border-radius:999px;
          border:1px solid rgba(212,175,55,0.40);
          background: rgba(255,255,255,0.90);
          color:${NAVY};
          font-weight:950;
          box-shadow: 0 14px 50px rgba(12,35,64,0.08);
          font-size:12px;
        }

        /* Banner */
        .cp-banner{
          border-radius:22px;
          padding:14px 16px;
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:14px;
          box-shadow: 0 18px 70px rgba(12,35,64,0.10);
        }
        .cp-banner__title{ font-weight:950; font-size:13px; }
        .cp-banner__msg{ margin-top:6px; font-weight:800; font-size:12.5px; line-height:1.55; }
        .cp-banner__meta{ margin-top:10px; display:flex; flex-wrap:wrap; gap:8px; }
        .cp-chip{
          display:inline-flex; gap:8px; align-items:center;
          padding:8px 10px;
          border-radius:999px;
          border:1px solid rgba(0,0,0,0.08);
          background: rgba(255,255,255,0.75);
          font-size:11.5px;
          font-weight:900;
        }
        .cp-chip__k{ opacity:0.75; }
        .cp-details{ margin-top:10px; }
        .cp-pre{
          margin-top:8px;
          padding:12px 12px;
          border-radius:16px;
          border:1px solid rgba(0,0,0,0.08);
          background: rgba(255,255,255,0.8);
          overflow:auto;
          max-height: 280px;
          font-size:11.5px;
          font-weight:800;
          color:${NAVY};
        }
        .cp-x{
          width:40px; height:40px;
          border-radius:999px;
          border:1px solid rgba(0,0,0,0.08);
          background: rgba(255,255,255,0.8);
          cursor:pointer;
          font-size:20px;
          line-height:1;
          font-weight:950;
          color: currentColor;
          box-shadow: 0 12px 40px rgba(12,35,64,0.10);
        }
        .cp-x:hover{ transform: translateY(-1px); }

        /* Arm toggle */
        .cp-arm{
          display:flex; align-items:center; gap:12px;
          padding:12px 14px;
          border:1px solid ${BORDER};
          border-radius:20px;
          background:#fff;
          box-shadow: 0 12px 40px rgba(12,35,64,0.08);
        }
        .cp-arm input{ position:absolute; opacity:0; pointer-events:none; }
        .cp-arm__box{
          width:22px; height:22px;
          border-radius:7px;
          border:1px solid ${BORDER};
          background: #fff;
          box-shadow: inset 0 0 0 2px rgba(255,255,255,0.8);
          position:relative;
        }
        .cp-arm input:checked + .cp-arm__box{
          border-color: rgba(212,175,55,0.65);
          background: linear-gradient(180deg, ${NAVY} 0%, #0b1a36 100%);
        }
        .cp-arm input:checked + .cp-arm__box:after{
          content:"";
          position:absolute;
          inset:6px;
          border-radius:4px;
          background: ${GOLD};
        }
        .cp-arm__text{ display:grid; gap:2px; }
        .cp-arm__label{ font-weight:950; color:${NAVY}; font-size:12.5px; }
        .cp-arm__hint{ font-weight:800; color:${MUTED}; font-size:12px; }

        /* History */
        .cp-history{
          border-top:1px solid rgba(223,227,236,0.8);
          padding-top:12px;
          display:grid; gap:10px;
        }
        .cp-history__top{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .cp-history__title{ font-size:12px; font-weight:950; color:${NAVY}; letter-spacing:0.12em; text-transform:uppercase; }
        .cp-history__list{ display:grid; gap:8px; }
        .cp-hrow{
          border:1px solid ${BORDER};
          border-radius:18px;
          background:#fff;
          padding:12px 12px;
          box-shadow: 0 12px 40px rgba(12,35,64,0.07);
          display:flex; align-items:center; justify-content:space-between; gap:12px;
        }
        .cp-hrow__a{ display:flex; align-items:center; gap:10px; }
        .cp-hrow__k{ font-weight:950; color:${NAVY}; font-size:12.5px; }
        .cp-hrow__m{ display:grid; justify-items:end; gap:2px; }
        .cp-hrow__t{ font-weight:800; color:${MUTED}; font-size:11.5px; }
        .cp-hrow__s{ font-weight:900; color:${NAVY}; opacity:0.75; font-size:11.5px; }
        .cp-dot{ width:10px; height:10px; border-radius:999px; background:#9ca3af; }
        .cp-dot--ok{ background:#10b981; }
        .cp-dot--bad{ background:#ef4444; }
        .cp-empty{ padding:10px 6px; color:${MUTED}; font-weight:800; font-size:12.5px; }

        @keyframes cpFade { from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:translateY(0);} }
      `}</style>
    </div>
  );
}
