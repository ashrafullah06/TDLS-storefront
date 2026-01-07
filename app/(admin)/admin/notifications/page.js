// FILE: app/(admin)/admin/notifications/page.js
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const NAVY = "#0F2147";
const GOLD = "#D4AF37";

const CHANNELS = ["all", "IN_APP", "EMAIL", "SMS", "WHATSAPP", "PUSH"];
const TIERS = ["MEMBER", "BRONZE", "SILVER", "GOLD", "PLATINUM", "VIP"];
const TYPES = [
  "SYSTEM",
  "CAMPAIGN",
  "PROMOTION",
  "SECURITY_ALERT",
  "SUPPORT_REPLY",
  "ORDER_PLACED",
  "ORDER_PAID",
  "ORDER_FULFILLED",
  "ORDER_DELIVERED",
  "ORDER_CANCELLED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_REJECTED",
  "EXCHANGE_REQUESTED",
  "EXCHANGE_APPROVED",
  "EXCHANGE_REJECTED",
  "REFUND_INITIATED",
  "REFUND_COMPLETED",
  "WALLET_CREDIT",
  "WALLET_DEBIT",
  "REWARD_EARNED",
  "REWARD_REDEEMED",
];

function clsx(...a) {
  return a.filter(Boolean).join(" ");
}

function Badge({ tone = "neutral", children }) {
  const map = {
    neutral: "bg-neutral-100 text-neutral-700 border-neutral-200",
    good: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warn: "bg-amber-50 text-amber-800 border-amber-200",
    bad: "bg-rose-50 text-rose-700 border-rose-200",
    navy: "bg-[#0F2147] text-white border-[#0F2147]",
  };
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", map[tone] || map.neutral)}>
      {children}
    </span>
  );
}

function PillButton({ children, onClick, disabled, tone = "navy", type = "button" }) {
  const base =
    "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const tones = {
    navy: `bg-[${NAVY}] text-white hover:brightness-110 focus:ring-[${NAVY}] shadow-[0_10px_30px_rgba(15,33,71,0.22)]`,
    ghost: "bg-white text-neutral-800 hover:bg-neutral-50 border border-neutral-200 shadow-sm focus:ring-neutral-300",
    danger: "bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-600 shadow-[0_10px_30px_rgba(225,29,72,0.22)]",
    gold: `bg-[${GOLD}] text-[#0b1220] hover:brightness-105 focus:ring-[${GOLD}] shadow-[0_10px_30px_rgba(212,175,55,0.22)]`,
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={clsx(base, tones[tone])}>
      {children}
    </button>
  );
}

function Card({ title, subtitle, right, children }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <div>
            {title && <div className="text-base font-semibold text-neutral-900">{title}</div>}
            {subtitle && <div className="mt-1 text-xs text-neutral-600">{subtitle}</div>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function StatusLine({ kind, children }) {
  const tone = kind === "success" ? "good" : kind === "error" ? "bad" : kind === "warning" ? "warn" : "neutral";
  const color =
    kind === "success"
      ? "text-emerald-700"
      : kind === "error"
      ? "text-rose-700"
      : kind === "warning"
      ? "text-amber-800"
      : "text-neutral-700";
  return (
    <div className={clsx("rounded-xl border px-4 py-3 text-sm font-semibold", color, tone === "good" ? "bg-emerald-50 border-emerald-200" : tone === "bad" ? "bg-rose-50 border-rose-200" : tone === "warn" ? "bg-amber-50 border-amber-200" : "bg-neutral-50 border-neutral-200")}>
      {children}
    </div>
  );
}

export default function NotificationsAdminPage() {
  const [perms, setPerms] = useState(null);

  const canView = useMemo(() => (perms || []).includes("VIEW_NOTIFICATIONS"), [perms]);
  const canSend = useMemo(() => (perms || []).includes("MANAGE_NOTIFICATIONS"), [perms]);

  const [tab, setTab] = useState("compose"); // compose | console | history

  // console filters
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all"); // all|QUEUED|DELIVERED|FAILED
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // compose state
  const [audMode, setAudMode] = useState("tier"); // all | tier | recipients
  const [tier, setTier] = useState("GOLD");
  const [recipientsText, setRecipientsText] = useState("");
  const [picked, setPicked] = useState([]); // customer objects from search
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchRes, setSearchRes] = useState([]);
  const [msgType, setMsgType] = useState("SYSTEM");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaHref, setCtaHref] = useState("");
  const [campaignKey, setCampaignKey] = useState("");
  const [note, setNote] = useState("");
  const [scheduleAt, setScheduleAt] = useState(""); // datetime-local
  const [sending, setSending] = useState(false);
  const [statusLine, setStatusLine] = useState(null); // {kind, text}
  const [targetInfo, setTargetInfo] = useState(null);
  const lastSearchReq = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/session", { cache: "no-store" });
        const j = await r.json();
        setPerms(j?.user?.permissions || []);
      } catch {
        setPerms([]);
      }
    })();
  }, []);

  async function loadSummary() {
    setLoadingSummary(true);
    try {
      const u = new URL(window.location.href);
      u.pathname = "/api/admin/notifications/summary";
      u.searchParams.set("channel", channel);
      u.searchParams.set("status", status);
      u.searchParams.set("type", type);
      if (q) u.searchParams.set("q", q);

      const r = await fetch(u.toString(), { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Summary failed");
      setSummary(j);
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadHistory(page = 1) {
    setLoadingHistory(true);
    try {
      const u = new URL(window.location.href);
      u.pathname = "/api/admin/notifications/history";
      u.searchParams.set("page", String(page));
      u.searchParams.set("pageSize", "50");
      u.searchParams.set("channel", channel);
      u.searchParams.set("status", status);
      u.searchParams.set("type", type);
      if (q) u.searchParams.set("q", q);

      const r = await fetch(u.toString(), { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "History failed");
      setHistory(j);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    if (!canView) return;
    if (tab === "console") loadSummary();
    if (tab === "history") loadHistory(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, tab]);

  // Debounced search for customers
  useEffect(() => {
    if (!canSend) return;
    const qq = searchQ.trim();
    if (!qq || qq.length < 2) {
      setSearchRes([]);
      return;
    }

    const reqId = ++lastSearchReq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const u = new URL(window.location.href);
        u.pathname = "/api/admin/notifications/customers/search";
        u.searchParams.set("q", qq);
        u.searchParams.set("limit", "10");

        const r = await fetch(u.toString(), { cache: "no-store" });
        const j = await r.json();
        if (reqId !== lastSearchReq.current) return;
        if (!r.ok) throw new Error(j?.error || "Search failed");
        setSearchRes(Array.isArray(j?.items) ? j.items : []);
      } catch {
        if (reqId === lastSearchReq.current) setSearchRes([]);
      } finally {
        if (reqId === lastSearchReq.current) setSearching(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [searchQ, canSend]);

  function addPicked(c) {
    setPicked((prev) => {
      if (prev.some((x) => x.id === c.id)) return prev;
      return [...prev, c];
    });
  }
  function removePicked(id) {
    setPicked((prev) => prev.filter((x) => x.id !== id));
  }

  function normalizeRecipientsPayload() {
    const manual = recipientsText.trim();
    const ids = picked.map((p) => p.id);
    // mix: user can add both manual text and picked users
    const mergedText = [manual, ...ids].filter(Boolean).join("\n");
    return mergedText;
  }

  async function checkTarget() {
    setStatusLine(null);
    setTargetInfo(null);

    const payload = {
      audience:
        audMode === "all"
          ? { all: true }
          : audMode === "tier"
          ? { tier }
          : { recipients: normalizeRecipientsPayload() },
    };

    const r = await fetch("/api/admin/notifications/target-count", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setStatusLine({ kind: "error", text: j?.error || "Target check failed" });
      return;
    }
    setTargetInfo(j);
    setStatusLine({ kind: "success", text: `Targets: ${j.count}` });
  }

  async function sendInApp() {
    setStatusLine(null);

    if (!canSend) {
      setStatusLine({ kind: "error", text: "You do not have MANAGE_NOTIFICATIONS." });
      return;
    }

    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setStatusLine({ kind: "warning", text: "Title and body are required." });
      return;
    }

    const href = ctaHref.trim();
    if (href && !href.startsWith("/")) {
      setStatusLine({ kind: "warning", text: "CTA href must be a relative path like /account/orders." });
      return;
    }

    const idempotencyKey = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).toString();

    const sendAtIso =
      scheduleAt && scheduleAt.trim()
        ? new Date(scheduleAt).toISOString()
        : null;

    const payload = {
      idempotencyKey,
      audience:
        audMode === "all"
          ? { all: true }
          : audMode === "tier"
          ? { tier }
          : { recipients: normalizeRecipientsPayload() },
      message: {
        type: msgType,
        title: t,
        body: b,
        ctaLabel: ctaLabel.trim() || null,
        ctaHref: href || null,
        campaignKey: campaignKey.trim() || null,
      },
      schedule: { sendAt: sendAtIso },
      audit: { note: note.trim() || null },
    };

    setSending(true);
    try {
      const r = await fetch("/api/admin/notifications/send-in-app", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Send failed");

      const when = j?.scheduled ? "scheduled" : "sent";
      setStatusLine({
        kind: "success",
        text: `${when.toUpperCase()}: ${j.sent} notifications (targets: ${j.targets}).`,
      });

      // refresh console/history if open
      if (tab === "console") loadSummary();
      if (tab === "history") loadHistory(1);
    } catch (e) {
      setStatusLine({ kind: "error", text: String(e?.message || e) });
    } finally {
      setSending(false);
    }
  }

  if (perms === null) return <div className="text-sm">Checking permissions…</div>;
  if (!canView)
    return (
      <div className="rounded-2xl border bg-white p-5 text-sm text-rose-700 border-rose-200">
        You need <b>VIEW_NOTIFICATIONS</b>.
      </div>
    );

  const header = (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-5 bg-gradient-to-br from-[#0F2147] to-[#132a5c] text-white">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#D4AF37]" />
              <span className="text-xs font-semibold tracking-wide opacity-90">TDLC CONTROL CENTER</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold">Notifications</h1>
            <div className="mt-1 text-sm text-white/80">
              In-App Inbox (customers) + Delivery Console (all channels).
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PillButton tone={tab === "compose" ? "gold" : "ghost"} onClick={() => setTab("compose")}>
              Compose
            </PillButton>
            <PillButton tone={tab === "console" ? "gold" : "ghost"} onClick={() => setTab("console")}>
              Console
            </PillButton>
            <PillButton tone={tab === "history" ? "gold" : "ghost"} onClick={() => setTab("history")}>
              History
            </PillButton>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 bg-white">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-semibold text-neutral-700">Filters</div>

            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-full border border-neutral-200 px-3 py-2 text-sm bg-white">
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-full border border-neutral-200 px-3 py-2 text-sm bg-white">
              {["all", "QUEUED", "DELIVERED", "FAILED"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-full border border-neutral-200 px-3 py-2 text-sm bg-white">
              <option value="all">all types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title/body/to"
              className="w-full sm:w-[320px] rounded-full border border-neutral-200 px-4 py-2 text-sm bg-white"
            />
          </div>

          <div className="flex items-center gap-2">
            <PillButton
              tone="ghost"
              onClick={() => {
                if (tab === "console") loadSummary();
                if (tab === "history") loadHistory(1);
              }}
              disabled={tab === "compose"}
            >
              Refresh
            </PillButton>
            {tab !== "compose" && (
              <PillButton
                onClick={() => {
                  if (tab === "console") loadSummary();
                  if (tab === "history") loadHistory(1);
                }}
              >
                Apply
              </PillButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const compose = (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div className="xl:col-span-2 space-y-5">
        <Card
          title="In-App Composer"
          subtitle="Send a notification that appears in the customer dashboard inbox (NotificationChannel.IN_APP)."
          right={
            canSend ? (
              <Badge tone="good">MANAGE_NOTIFICATIONS</Badge>
            ) : (
              <Badge tone="bad">Read-only</Badge>
            )
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-semibold text-neutral-700">Audience</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAudMode("all")}
                  className={clsx(
                    "rounded-full border px-3 py-2 text-sm font-semibold transition",
                    audMode === "all" ? `bg-[${NAVY}] text-white border-[${NAVY}]` : "bg-white text-neutral-800 border-neutral-200 hover:bg-neutral-50"
                  )}
                >
                  All active customers
                </button>
                <button
                  type="button"
                  onClick={() => setAudMode("tier")}
                  className={clsx(
                    "rounded-full border px-3 py-2 text-sm font-semibold transition",
                    audMode === "tier" ? `bg-[${NAVY}] text-white border-[${NAVY}]` : "bg-white text-neutral-800 border-neutral-200 hover:bg-neutral-50"
                  )}
                >
                  By tier
                </button>
                <button
                  type="button"
                  onClick={() => setAudMode("recipients")}
                  className={clsx(
                    "rounded-full border px-3 py-2 text-sm font-semibold transition",
                    audMode === "recipients" ? `bg-[${NAVY}] text-white border-[${NAVY}]` : "bg-white text-neutral-800 border-neutral-200 hover:bg-neutral-50"
                  )}
                >
                  Explicit recipients
                </button>
              </div>

              {audMode === "tier" && (
                <div className="mt-3">
                  <div className="text-xs text-neutral-600">Select Loyalty tier</div>
                  <select value={tier} onChange={(e) => setTier(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm">
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {audMode === "recipients" && (
                <div className="mt-3 space-y-3">
                  <div className="text-xs text-neutral-600">
                    Add customers by searching (recommended) and/or paste identifiers (email / phone / userId).
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {picked.map((p) => (
                      <span key={p.id} className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs">
                        <span className="font-semibold">{p.name || p.customerCode || p.email || p.phone || p.id}</span>
                        <button
                          type="button"
                          onClick={() => removePicked(p.id)}
                          className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-neutral-50"
                        >
                          Remove
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="relative">
                    <input
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder="Search customer (name / email / phone / customer code)"
                      className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
                    />
                    {(searching || searchRes.length > 0) && (
                      <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg">
                        <div className="px-3 py-2 text-xs font-semibold text-neutral-600 border-b border-neutral-200">
                          {searching ? "Searching…" : "Results"}
                        </div>
                        <div className="max-h-[260px] overflow-auto">
                          {searchRes.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => addPicked(c)}
                              className="w-full text-left px-3 py-2 hover:bg-neutral-50 border-b border-neutral-100"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-neutral-900">
                                    {c.name || c.customerCode || "Customer"}{" "}
                                    {c.tier ? <span className="ml-2"><Badge tone="navy">{c.tier}</Badge></span> : null}
                                  </div>
                                  <div className="text-xs text-neutral-600 mt-0.5">
                                    {c.email || "—"} · {c.phone || "—"} · {c.customerCode || "—"}
                                  </div>
                                </div>
                                <Badge tone="good">Add</Badge>
                              </div>
                            </button>
                          ))}
                          {!searching && searchRes.length === 0 && (
                            <div className="px-3 py-3 text-sm text-neutral-600">No results.</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <textarea
                    value={recipientsText}
                    onChange={(e) => setRecipientsText(e.target.value)}
                    placeholder={"Paste recipients (one per line):\nemail@example.com\n+8801XXXXXXXXX\ncuid_user_id"}
                    className="w-full min-h-[120px] rounded-2xl border border-neutral-200 px-3 py-3 text-sm"
                  />
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold text-neutral-700">Message</div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-neutral-600">Type</div>
                  <select value={msgType} onChange={(e) => setMsgType(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm">
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-xs text-neutral-600">Campaign key (optional)</div>
                  <input
                    value={campaignKey}
                    onChange={(e) => setCampaignKey(e.target.value)}
                    placeholder="e.g. winter_drop_2025"
                    className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-neutral-600">Title</div>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" />
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-neutral-600">Body</div>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className="mt-2 w-full min-h-[140px] rounded-2xl border border-neutral-200 px-3 py-3 text-sm"
                    placeholder="Write a clear customer-facing message."
                  />
                </div>

                <div>
                  <div className="text-xs text-neutral-600">CTA label (optional)</div>
                  <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" placeholder="View order" />
                </div>

                <div>
                  <div className="text-xs text-neutral-600">CTA href (optional)</div>
                  <input value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" placeholder="/account/orders" />
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-neutral-600">Schedule (optional)</div>
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
                  />
                  <div className="mt-1 text-[11px] text-neutral-500">
                    If set in the future, notifications are stored as QUEUED and will be delivered automatically when the dispatcher runs.
                  </div>
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-neutral-600">Internal note (audit)</div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm" placeholder="Visible only to staff (AuditLog metadata)." />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <PillButton tone="ghost" onClick={checkTarget} disabled={!canSend}>
                  Check targets
                </PillButton>
                <PillButton onClick={sendInApp} disabled={!canSend || sending}>
                  {sending ? "Sending…" : "Send In-App"}
                </PillButton>
              </div>

              {statusLine?.text ? (
                <div className="mt-4">
                  <StatusLine kind={statusLine.kind}>{statusLine.text}</StatusLine>
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        <Card title="Preview (customer inbox)" subtitle="Exactly how it will look inside the customer dashboard.">
          <div className="rounded-2xl border border-neutral-200 bg-gradient-to-br from-neutral-50 to-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge tone="navy">{msgType}</Badge>
                {campaignKey.trim() ? <Badge tone="neutral">campaign: {campaignKey.trim()}</Badge> : null}
              </div>
              <div className="text-xs text-neutral-500">{new Date().toLocaleString()}</div>
            </div>

            <div className="mt-3 text-lg font-semibold text-neutral-900">{title.trim() || "Title preview"}</div>
            <div className="mt-2 text-sm text-neutral-700 whitespace-pre-wrap">{body.trim() || "Body preview…"}</div>

            {(ctaLabel.trim() && ctaHref.trim()) ? (
              <div className="mt-4">
                <span className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: NAVY }}>
                  {ctaLabel.trim()}
                  <span className="text-white/70 text-xs">{ctaHref.trim()}</span>
                </span>
              </div>
            ) : (
              <div className="mt-4 text-xs text-neutral-500">CTA optional (set label + href to show).</div>
            )}

            {targetInfo?.count != null ? (
              <div className="mt-4 text-xs text-neutral-600">
                Targeted customers: <b>{targetInfo.count}</b>
                {Array.isArray(targetInfo.sample) && targetInfo.sample.length > 0 ? (
                  <>
                    <div className="mt-2 text-[11px] text-neutral-500">Sample:</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {targetInfo.sample.map((s) => (
                        <Badge key={s.id} tone="neutral">
                          {s.customerCode || s.email || s.phone || s.id}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="Safety & rules" subtitle="Production-grade guardrails (no accidental customer leakage).">
          <ul className="space-y-2 text-sm text-neutral-700">
            <li className="flex gap-2">
              <span className="mt-1 inline-block h-2 w-2 rounded-full" style={{ background: GOLD }} />
              IN_APP send is restricted to <b>customer kinds</b> only.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 inline-block h-2 w-2 rounded-full" style={{ background: GOLD }} />
              CTA href must be a <b>relative path</b> (prevents open redirects).
            </li>
            <li className="flex gap-2">
              <span className="mt-1 inline-block h-2 w-2 rounded-full" style={{ background: GOLD }} />
              Idempotency key prevents accidental double-send.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 inline-block h-2 w-2 rounded-full" style={{ background: GOLD }} />
              Every send writes an <b>AuditLog</b> entry (best-effort).
            </li>
          </ul>
        </Card>

        <Card
          title="Quick links"
          subtitle="Operations shortcuts (use with your customer dashboard inbox)."
          right={<Badge tone="neutral">IN_APP</Badge>}
        >
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
              Customer Inbox API: <span className="font-semibold">/api/customers/notifications</span>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
              Mark read API: <span className="font-semibold">/api/customers/notifications/mark-read</span>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
              Hide API: <span className="font-semibold">/api/customers/notifications/hide</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );

  const consoleTab = (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Deliveries (24h)" subtitle="DELIVERED in last 24 hours">
          <div className="text-3xl font-semibold text-neutral-900">{loadingSummary ? "—" : (summary?.deliveries24h ?? "—")}</div>
        </Card>
        <Card title="Failures (24h)" subtitle="FAILED in last 24 hours">
          <div className="text-3xl font-semibold text-neutral-900">{loadingSummary ? "—" : (summary?.failed24h ?? "—")}</div>
        </Card>
        <Card title="Queued" subtitle="Currently queued">
          <div className="text-3xl font-semibold text-neutral-900">{loadingSummary ? "—" : (summary?.queued ?? "—")}</div>
        </Card>
      </div>

      <Card
        title="Recent activity"
        subtitle="Filtered by the controls above."
        right={loadingSummary ? <Badge tone="neutral">Loading…</Badge> : <Badge tone="good">Live</Badge>}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Channel</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">To</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.recent || []).map((n) => (
                <tr key={n.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <Badge tone="neutral">{n.channel}</Badge>
                  </td>
                  <td className="px-3 py-2">{n.type}</td>
                  <td className="px-3 py-2">{n.to || n.userId || "—"}</td>
                  <td className="px-3 py-2">{n.title}</td>
                  <td className="px-3 py-2">
                    <Badge tone={n.status === "DELIVERED" ? "good" : n.status === "FAILED" ? "bad" : "warn"}>{n.status}</Badge>
                  </td>
                </tr>
              ))}
              {(!summary?.recent || summary.recent.length === 0) && (
                <tr>
                  <td className="px-3 py-3 text-neutral-600" colSpan={6}>
                    No recent notifications.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const historyTab = (
    <div className="space-y-5">
      <Card
        title="History"
        subtitle="Paginated. Use filters above."
        right={loadingHistory ? <Badge tone="neutral">Loading…</Badge> : <Badge tone="good">Ready</Badge>}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-neutral-700">
            Total: <b>{history?.total ?? "—"}</b> · Page: <b>{history?.page ?? "—"}</b>
          </div>
          <div className="flex items-center gap-2">
            <PillButton tone="ghost" onClick={() => loadHistory(Math.max(1, (history?.page || 1) - 1))} disabled={loadingHistory || (history?.page || 1) <= 1}>
              Prev
            </PillButton>
            <PillButton tone="ghost" onClick={() => loadHistory((history?.page || 1) + 1)} disabled={loadingHistory || (history?.items || []).length === 0}>
              Next
            </PillButton>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Channel</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">To/User</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {(history?.items || []).map((n) => (
                <tr key={n.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(n.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <Badge tone="neutral">{n.channel}</Badge>
                  </td>
                  <td className="px-3 py-2">{n.type}</td>
                  <td className="px-3 py-2">{n.to || n.userId || "—"}</td>
                  <td className="px-3 py-2">{n.title}</td>
                  <td className="px-3 py-2">
                    <Badge tone={n.status === "DELIVERED" ? "good" : n.status === "FAILED" ? "bad" : "warn"}>{n.status}</Badge>
                  </td>
                </tr>
              ))}
              {(!history?.items || history.items.length === 0) && (
                <tr>
                  <td className="px-3 py-3 text-neutral-600" colSpan={6}>
                    No rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  return (
    <div className="space-y-5">
      {header}
      {!canSend && tab === "compose" ? (
        <StatusLine kind="warning">You can view notifications, but cannot send. (Missing MANAGE_NOTIFICATIONS.)</StatusLine>
      ) : null}
      {tab === "compose" ? compose : tab === "console" ? consoleTab : historyTab}
    </div>
  );
}
