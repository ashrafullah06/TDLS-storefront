// FILE: app/(admin)/admin/orders/page.js
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** TDLC admin palette (premium) */
const NAVY = "#0F2147";
const GOLD = "#D4AF37";

const STATUS_LABELS = {
  DRAFT: "Draft",
  // Synonyms seen in many TDLC flows / integrations
  PENDING: "Pending",
  PENDING_CONFIRMATION: "Pending",
  PENDING_APPROVAL: "Pending",

  PLACED: "Placed",
  CONFIRMED: "Confirmed",
  APPROVED: "Confirmed",

  // Synonyms for completion/delivery
  DELIVERED: "Delivered",
  COMPLETED: "Completed",

  // Synonyms for cancellation/rejection
  CANCELLED: "Cancelled",
  CANCELED: "Cancelled",
  REJECTED: "Rejected",

  ARCHIVED: "Archived",
};

const PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  PENDING: "Pending",
  AUTHORIZED: "Authorized",
  PAID: "Paid",
  INITIATED: "Initiated",
  SETTLED: "Settled",
  PARTIALLY_REFUNDED: "Partially Refunded",
  REFUNDED: "Refunded",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

const FULFILLMENT_STATUS_LABELS = {
  UNFULFILLED: "Unfulfilled",
  PARTIAL: "Partially Fulfilled",
  FULFILLED: "Fulfilled",
  DELIVERED: "Delivered",
};

const DEFAULT_PAGE_SIZE = 20;

/** Rejection reasons (stored into events + cancel transition + customer apology message) */
const REJECTION_REASONS = [
  "Out of stock / insufficient stock",
  "Pricing / discount issue",
  "Payment risk / verification failed",
  "Address incomplete / unreachable",
  "Customer request / duplicate order",
  "Courier service unavailable",
  "Fraud / suspicious activity",
  "Other operational issue",
];

const REJECTION_REASON_CODES = Object.freeze(
  REJECTION_REASONS.reduce((acc, r, idx) => {
    acc[r] = `R${String(idx + 1).padStart(2, "0")}`;
    return acc;
  }, {})
);

/* ---------------- utils ---------------- */

function formatDateTime(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-BD", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function money(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "৳0";
  return v.toLocaleString("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2,
  });
}

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Normalizes status strings coming from different sources (Prisma, legacy APIs, Strapi, etc.)
 * so lifecycle gating remains bulletproof.
 */
function normalizeOrderStatus(v) {
  const raw = String(v ?? "").trim();
  const s = raw.toUpperCase();

  // Pre-confirm buckets
  if (["PENDING", "PENDING_CONFIRMATION", "PENDING_APPROVAL"].includes(s)) return "PLACED";

  // Confirmation synonyms
  if (["APPROVED"].includes(s)) return "CONFIRMED";

  // Delivery / completion synonyms
  if (["DELIVERED", "FULFILLED"].includes(s)) return "COMPLETED";

  // Rejection synonyms
  if (["REJECTED"].includes(s)) return "CANCELLED";

  // Cancellation spelling variants
  if (["CANCELED"].includes(s)) return "CANCELLED";

  return s || "";
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Tries to read summary fields from multiple plausible API shapes */
function normalizeSummary(body) {
  if (!body || typeof body !== "object") return null;

  const s =
    body.summary ||
    body.data?.summary ||
    body.meta?.summary ||
    body.totals ||
    body.data?.totals ||
    null;

  if (!s || typeof s !== "object") return null;

  const breakdowns =
    s.breakdowns ||
    s.data?.breakdowns ||
    body.breakdowns ||
    body.data?.breakdowns ||
    null;

  const countsByStatus =
    s.countsByStatus || breakdowns?.byStatus || breakdowns?.by_status || null;

  const out = {
    orders: safeNum(s.orders ?? s.totalOrders ?? s.count ?? s.totalCount),
    amount: safeNum(s.amount ?? s.totalAmount ?? s.gross ?? s.grandTotal ?? s.revenue),
    items: safeNum(s.items ?? s.totalItems ?? s.lineItems),
    qty: safeNum(s.qty ?? s.totalQty ?? s.quantity ?? s.totalQuantity),
    paidAmount: safeNum(s.paidAmount ?? s.paid ?? s.collected ?? s.receivedAmount),
    unpaidAmount: safeNum(s.unpaidAmount ?? s.unpaid ?? s.due ?? s.codDue ?? s.dueAmount),
    aov: safeNum(s.aov ?? s.avgOrderValue),
    medianConfirmMins: safeNum(s.medianConfirmMins ?? s.medianTimeToConfirmMins),
    medianDeliverMins: safeNum(s.medianDeliverMins ?? s.medianTimeToDeliverMins),
    countsByStatus:
      countsByStatus && typeof countsByStatus === "object" ? countsByStatus : null,
    breakdowns: breakdowns && typeof breakdowns === "object" ? breakdowns : null,
  };

  return out;
}

function sameSet(a = [], b = []) {
  const A = new Set((a || []).map((x) => String(x || "").trim()).filter(Boolean));
  const B = new Set((b || []).map((x) => String(x || "").trim()).filter(Boolean));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

function uuidLite(prefix = "k") {
  try {
    const c = typeof crypto !== "undefined" ? crypto : null;
    if (c?.randomUUID) return `${prefix}:${c.randomUUID()}`;
  } catch {}
  return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

/** Small fetch helper (robust JSON) */
async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { res, body, ok: res.ok && !(body && body.ok === false) };
}

/** Try multiple endpoints (first successful wins). */
async function tryMany(attempts = []) {
  let last = null;
  for (const a of attempts) {
    if (!a?.url) continue;
    try {
      const { res, body, ok } = await fetchJson(a.url, {
        method: a.method || "POST",
        headers: a.headers || {},
        body: a.body ? JSON.stringify(a.body) : undefined,
      });

      if (ok) return { ok: true, res, body, used: a };
      last = { ok: false, res, body, used: a };

      // If it's not a 404, stop early (it exists but errored).
      if (res.status && res.status !== 404) return last;
    } catch (e) {
      last = { ok: false, error: e?.message || "NETWORK_ERROR", used: a };
    }
  }
  return last || { ok: false, error: "NO_ATTEMPTS" };
}

/* ---------------- premium UI atoms ---------------- */

function Card({ className, children }) {
  return (
    <div
      className={cn(
        "rounded-[34px] border border-slate-200 bg-white/92 backdrop-blur",
        "shadow-[0_14px_52px_rgba(15,33,71,0.11)]",
        "transition-all duration-200 ease-out",
        "hover:shadow-[0_28px_96px_rgba(15,33,71,0.16)]",
        className
      )}
    >
      {children}
    </div>
  );
}

function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <div className="text-[26px] md:text-[30px] font-black tracking-tight text-slate-900">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-1.5 text-[14px] md:text-[15px] text-slate-600 max-w-5xl leading-relaxed">
            {subtitle}
          </div>
        ) : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-3">{right}</div> : null}
    </div>
  );
}

function KpiCard({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "accent"
      ? "bg-amber-50 border-amber-200"
      : tone === "danger"
      ? "bg-rose-50 border-rose-200"
      : tone === "navy"
      ? "bg-slate-900 border-slate-900"
      : "bg-slate-50 border-slate-200";

  const labelC =
    tone === "accent"
      ? "text-amber-800"
      : tone === "danger"
      ? "text-rose-800"
      : tone === "navy"
      ? "text-slate-200"
      : "text-slate-500";

  const valueC =
    tone === "accent"
      ? "text-amber-950"
      : tone === "danger"
      ? "text-rose-900"
      : tone === "navy"
      ? "text-white"
      : "text-slate-900";

  return (
    <div
      className={cn(
        "rounded-[28px] border px-7 py-6",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-[2px] hover:shadow-[0_22px_62px_rgba(15,33,71,0.14)]",
        toneClass
      )}
    >
      <div className={cn("text-[11px] font-extrabold uppercase tracking-wide", labelC)}>
        {label}
      </div>
      <div className={cn("mt-2 text-[22px] md:text-[24px] font-black leading-tight", valueC)}>
        {value}
      </div>
    </div>
  );
}

function Chip({ children, tone = "neutral" }) {
  const cls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-900 border-emerald-200"
      : tone === "danger"
      ? "bg-rose-50 text-rose-900 border-rose-200"
      : tone === "info"
      ? "bg-blue-50 text-blue-900 border-blue-200"
      : tone === "warn"
      ? "bg-amber-50 text-amber-950 border-amber-200"
      : "bg-slate-100 text-slate-900 border-slate-200";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-4 py-2 text-[12px] font-black border",
        cls
      )}
    >
      {children}
    </span>
  );
}

/**
 * Premium tabs (REPORT CTA):
 * - Deep navy background + white text (idle + hover + active)
 * - Active gets GOLD edge + glow
 */
function TabPill({ active, label, count }) {
  const base =
    "relative inline-flex items-center gap-3 rounded-full border px-8 py-[18px] text-[16px] md:text-[17px] font-black tracking-tight select-none overflow-hidden";
  const fill =
    active
      ? "bg-[linear-gradient(135deg,var(--navy)_0%,#0B1A36_62%,var(--navy)_100%)] border-amber-300"
      : "bg-[linear-gradient(135deg,#173774_0%,#0F2147_74%,#0B1A36_100%)] border-[rgba(15,33,71,0.85)]";
  const fx =
    active
      ? "shadow-[0_24px_90px_rgba(15,33,71,0.28)] ring-1 ring-amber-200/40"
      : "shadow-[0_18px_66px_rgba(15,33,71,0.22)] ring-1 ring-white/10 hover:shadow-[0_28px_98px_rgba(15,33,71,0.30)]";

  return (
    <span
      className={cn(
        base,
        "text-white",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-[2px] hover:scale-[1.01] active:translate-y-0 active:scale-100",
        fill,
        fx,
        "tdlc-pill-shine"
      )}
    >
      <span className="relative z-10">{label}</span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "relative z-10 inline-flex items-center justify-center min-w-[42px] h-[30px] px-3 rounded-full text-[12px] font-black border",
            active
              ? "bg-amber-200/15 text-white border-amber-200/40"
              : "bg-white/12 text-white border-white/18"
          )}
        >
          {count}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Unified CTA system (STRICT):
 * - Deep navy background + white text for ALL CTAs (visibility guaranteed)
 * - Hover/active/focus NEVER changes text to navy or near-navy
 * - “Pillow” look via shadow + subtle inset highlight
 */
function Button({
  children,
  variant = "primary",
  size = "md",
  disabled,
  onClick,
  title,
  className,
  type = "button",
}) {
  const sizes =
    size === "xxl"
      ? "px-10 py-[18px] text-[16px] md:text-[17px] min-h-[60px]"
      : size === "xl"
      ? "px-9 py-[16px] text-[16px] min-h-[56px]"
      : size === "lg"
      ? "px-7 py-[14px] text-[15px] min-h-[50px]"
      : size === "sm"
      ? "px-5 py-[10px] text-[14px] min-h-[44px]"
      : "px-6 py-[12px] text-[14px] min-h-[46px]";

  const base =
    "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full font-black border " +
    "transition-all duration-200 ease-out will-change-transform " +
    "hover:-translate-y-[2px] hover:scale-[1.01] active:translate-y-0 active:scale-[1.0] " +
    "focus:outline-none focus:ring-2 focus:ring-slate-200 " +
    "shadow-[0_22px_70px_rgba(15,33,71,0.22)]";

  const navyFill =
    variant === "soft"
      ? "bg-[linear-gradient(135deg,#1A3A7A_0%,#0F2147_72%)] text-white border-[rgba(15,33,71,0.92)]"
      : "bg-[linear-gradient(135deg,var(--navy)_0%,#0B1A36_62%,var(--navy)_100%)] text-white border-[rgba(15,33,71,0.92)]";

  const pillow =
    "shadow-[0_22px_70px_rgba(15,33,71,0.22)] " +
    "ring-1 ring-white/10 " +
    "before:absolute before:inset-0 before:rounded-full " +
    "before:bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.22),rgba(255,255,255,0)_52%)] " +
    "before:opacity-100";

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        base,
        sizes,
        navyFill,
        pillow,
        "tdlc-btn-shine",
        disabled ? "opacity-40 cursor-not-allowed hover:translate-y-0 hover:scale-100" : "",
        className
      )}
    >
      <span className="relative z-10">{children}</span>
    </button>
  );
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-6 py-5">
        <div className="h-4 w-28 rounded bg-slate-200" />
        <div className="mt-2 h-3 w-56 rounded bg-slate-100" />
      </td>
      <td className="px-6 py-5">
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="mt-2 h-3 w-40 rounded bg-slate-100" />
      </td>
      <td className="px-6 py-5">
        <div className="h-8 w-28 rounded-full bg-slate-200" />
      </td>
      <td className="px-6 py-5">
        <div className="h-4 w-20 rounded bg-slate-200" />
      </td>
      <td className="px-6 py-5">
        <div className="h-4 w-24 rounded bg-slate-200" />
      </td>
      <td className="px-6 py-5">
        <div className="h-4 w-28 rounded bg-slate-200" />
      </td>
    </tr>
  );
}

/**
 * INLINE action status line (NOT a panel / NOT a popup):
 * - Big bold text, anchored near CTA area
 * - success: green
 * - error: red
 * - warn: yellow
 * - info: deep navy
 */
function ActionStatusLine({ report, onClear }) {
  if (!report) return null;

  const t = report.type || "info";
  const color =
    t === "success"
      ? "text-emerald-700"
      : t === "error"
      ? "text-rose-700"
      : t === "warn"
      ? "text-amber-700"
      : "text-slate-900";

  // Deep navy for info
  const infoStyle = t === "info" ? { color: NAVY } : undefined;

  return (
    <div className="mt-3">
      <div
        className={cn("text-[20px] md:text-[22px] font-black leading-snug tracking-tight", color)}
        style={infoStyle}
      >
        {report.title || "Update"}
      </div>
      {report.message ? (
        <div
          className={cn(
            "mt-1 text-[17px] md:text-[18px] font-black whitespace-pre-wrap leading-relaxed",
            color
          )}
          style={infoStyle}
        >
          {report.message}
        </div>
      ) : null}
      {report.details ? (
        <div className="mt-2 text-[13px] font-semibold text-slate-600 whitespace-pre-wrap leading-relaxed">
          {report.details}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onClear}
        className="mt-2 text-[12px] font-black underline text-slate-600 hover:text-slate-900"
      >
        Dismiss
      </button>
    </div>
  );
}

function ToggleRow({ label, description, value, onChange, disabled }) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-[26px] border px-5 py-4",
        disabled ? "opacity-60" : "bg-white border-slate-200"
      )}
    >
      <div className="min-w-0">
        <div className="text-[14px] font-black text-slate-900">{label}</div>
        {description ? (
          <div className="mt-1 text-[12px] font-semibold text-slate-600 leading-relaxed">
            {description}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={cn(
          "relative w-[64px] h-[34px] rounded-full border transition-all duration-200",
          value
            ? "bg-[linear-gradient(135deg,var(--navy)_0%,#0B1A36_62%,var(--navy)_100%)] border-[rgba(15,33,71,0.92)]"
            : "bg-slate-100 border-slate-200",
          disabled
            ? "cursor-not-allowed"
            : "cursor-pointer hover:shadow-[0_14px_40px_rgba(15,33,71,0.18)]"
        )}
        aria-pressed={!!value}
        title={value ? "On" : "Off"}
      >
        <span
          className={cn(
            "absolute top-[4px] w-[26px] h-[26px] rounded-full bg-white shadow transition-all duration-200",
            value ? "left-[34px]" : "left-[4px]"
          )}
        />
      </button>
    </div>
  );
}

/* ---------------- page ---------------- */

export default function AdminOrdersPage() {
  const canUseDOM = typeof window !== "undefined" && typeof document !== "undefined";

  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageCount, setPageCount] = useState(1);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("");
  const [paymentStatusIn, setPaymentStatusIn] = useState([]);

  const [dateFrom, setDateFrom] = useState(""); // yyyy-mm-dd
  const [dateTo, setDateTo] = useState(""); // yyyy-mm-dd
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState(null);

  // Selection is now single-source-of-truth (prevents effect loops)
  const [selectedId, setSelectedId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [loadingOrder, setLoadingOrder] = useState(false);

  const [shipForm, setShipForm] = useState({
    courierCode: "pathao",
    serviceCode: "standard",
  });

  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  /** KPI summary per active filter/tab (server truth only) */
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  /** Reject modal state */
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReasons, setRejectReasons] = useState(() => new Set());
  const [rejectNote, setRejectNote] = useState("");
  const [rejectErr, setRejectErr] = useState("");

  /** Apology letter (customer-facing) */
  const [apologyText, setApologyText] = useState("");
  const [sendApology, setSendApology] = useState(true);
  const [sendInApp, setSendInApp] = useState(true);
  const [apologyBusy, setApologyBusy] = useState(false);

  // Auto-generate apology until user edits
  const [apologyAuto, setApologyAuto] = useState(true);

  /** Advanced filter toggle */
  const [showAdvanced, setShowAdvanced] = useState(false);

  /**
   * Admin override (your rule):
   * - After confirmation, Reject is OFF by default
   * - Admin can explicitly enable it per-order if needed
   */
  const [adminRejectOverride, setAdminRejectOverride] = useState(false);

  /**
   * Double-click safe: action locks (orderId+action) so you cannot trigger the same mutation twice.
   */
  const actionLocksRef = useRef(new Set());
  const [busyKey, setBusyKey] = useState(""); // UI display only

  /**
   * CTA executed work report (INLINE TEXT, anchored near CTA):
   * anchor: "lifecycle" | "payment" | "shipment" | "notes" | "docs"
   */
  const [actionReport, setActionReport] = useState(null);
  const [actionReportAnchor, setActionReportAnchor] = useState("");

  const showReport = useCallback((r, anchor = "") => {
    setActionReport(
      r
        ? {
            type: r.type || "info",
            title: r.title || "Update",
            message: r.message || "",
            details: r.details || "",
            ts: Date.now(),
          }
        : null
    );
    setActionReportAnchor(anchor || "");
  }, []);

  const withActionLock = useCallback(
    async (lockKey, fn, anchor = "") => {
      if (!lockKey) return { ok: false, error: "LOCK_KEY_MISSING" };
      const locks = actionLocksRef.current;
      if (locks.has(lockKey)) {
        showReport(
          {
            type: "warn",
            title: "Already running",
            message: "This action is already in progress for this order.",
          },
          anchor
        );
        return { ok: false, error: "ALREADY_RUNNING" };
      }
      locks.add(lockKey);
      setBusyKey(lockKey);
      try {
        const result = await fn();
        return result;
      } finally {
        locks.delete(lockKey);
        setBusyKey((cur) => (cur === lockKey ? "" : cur));
      }
    },
    [showReport]
  );

  /* ───────── load admin session (permissions) ───────── */

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setLoadingSession(true);
      try {
        const res = await fetch("/api/admin/session", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setSession(data || null);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Normalize permissions from session (supports multiple legacy shapes)
  const permissions = useMemo(() => {
    const raw = Array.isArray(session?.permissions)
      ? session.permissions
      : Array.isArray(session?.user?.permissions)
      ? session.user.permissions
      : Array.isArray(session?.user?.perms)
      ? session.user.perms
      : [];
    return new Set(raw.map((p) => String(p).toUpperCase()));
  }, [session]);

  const roleLower = useMemo(() => {
    const r = session?.user?.role ?? session?.role ?? session?.user?.roleName ?? "";
    return String(r || "").toLowerCase();
  }, [session]);

  const hasExplicitPerms = useMemo(() => permissions.size > 0, [permissions]);

  const isAdminRole = useMemo(() => {
    if (["superadmin", "admin", "owner", "root"].includes(roleLower)) return true;
    if (roleLower.includes("manager")) return true;
    return false;
  }, [roleLower]);

  // Broader staff detection (prevents “staff can’t confirm/reject” surprises)
  const isStaffRole = useMemo(() => {
    const r = roleLower;
    return (
      r.includes("staff") ||
      r.includes("support") ||
      r.includes("ops") ||
      r.includes("operation") ||
      r.includes("fulfillment") ||
      r.includes("agent") ||
      r.includes("moderator")
    );
  }, [roleLower]);

  const canViewOrders = hasExplicitPerms ? permissions.has("VIEW_ORDERS") : true;

  // Full manage (deliver/payment/shipment/cancel/etc.)
  const canManageOrders = hasExplicitPerms ? permissions.has("MANAGE_ORDERS") : isAdminRole;

  /**
   * Confirm permission (YOUR RULE):
   * Confirm must be available to admin + staff for pending orders.
   */
  const canConfirmOrders = hasExplicitPerms
    ? permissions.has("MANAGE_ORDERS") || permissions.has("CONFIRM_ORDERS") || isAdminRole
    : isAdminRole || isStaffRole;

  /**
   * Reject capability FIX:
   * - If explicit perms exist, admin role should still be able to reject (UI gating),
   *   even if REJECT_ORDERS/CANCEL_ORDERS were not included in the permissions payload.
   * - Server remains authoritative; this prevents a “dead CTA” in UI.
   */
  const canRejectOrders = hasExplicitPerms
    ? permissions.has("MANAGE_ORDERS") ||
      permissions.has("REJECT_ORDERS") ||
      permissions.has("CANCEL_ORDERS") ||
      isAdminRole
    : isAdminRole || isStaffRole;

  // Reset admin override when changing selection
  useEffect(() => {
    setAdminRejectOverride(false);
  }, [selectedId]);

  /* ───────── debounce search ───────── */

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  /* ───────── tabs (mapped to filters) ───────── */

  const PAYMENT_RECEIVED_SET = useMemo(() => ["PAID", "SETTLED"], []);

  const TAB_DEFS = useMemo(
    () => [
      {
        key: "all",
        label: "All",
        apply: () => {
          setStatus("");
          setPaymentStatus("");
          setPaymentStatusIn([]);
          setFulfillmentStatus("");
          setPage(1);
        },
      },
      {
        key: "pending",
        label: "Pending",
        apply: () => {
          setStatus("PLACED");
          setPaymentStatus("");
          setPaymentStatusIn([]);
          setFulfillmentStatus("");
          setPage(1);
        },
      },
      {
        key: "confirmed",
        label: "Confirmed",
        apply: () => {
          setStatus("CONFIRMED");
          setPaymentStatus("");
          setPaymentStatusIn([]);
          setFulfillmentStatus("");
          setPage(1);
        },
      },
      {
        key: "delivered",
        label: "Delivered",
        apply: () => {
          setStatus("COMPLETED");
          setPaymentStatus("");
          setPaymentStatusIn([]);
          setFulfillmentStatus("");
          setPage(1);
        },
      },
      {
        key: "paid",
        label: "Payment received",
        apply: () => {
          setStatus("");
          setPaymentStatus("");
          setPaymentStatusIn(PAYMENT_RECEIVED_SET);
          setFulfillmentStatus("");
          setPage(1);
        },
      },
      {
        key: "cancelled",
        label: "Cancelled / Rejected",
        apply: () => {
          setStatus("CANCELLED");
          setPaymentStatus("");
          setPaymentStatusIn([]);
          setFulfillmentStatus("");
          setPage(1);
        },
      },
    ],
    [PAYMENT_RECEIVED_SET]
  );

  const activeTabKey = useMemo(() => {
    const payInKey = sameSet(paymentStatusIn, PAYMENT_RECEIVED_SET);

    if (status === "" && paymentStatus === "" && !payInKey && fulfillmentStatus === "") return "all";
    if (status === "PLACED" && !paymentStatus && !payInKey && !fulfillmentStatus) return "pending";
    if (status === "CONFIRMED" && !paymentStatus && !payInKey && !fulfillmentStatus) return "confirmed";
    if (status === "COMPLETED" && !paymentStatus && !payInKey && !fulfillmentStatus) return "delivered";
    if (!status && !paymentStatus && payInKey && !fulfillmentStatus) return "paid";
    if (status === "CANCELLED" && !paymentStatus && !payInKey && !fulfillmentStatus) return "cancelled";
    return "custom";
  }, [status, paymentStatus, paymentStatusIn, fulfillmentStatus, PAYMENT_RECEIVED_SET]);

  const tabCounts = useMemo(() => {
    const s = summary;
    const counts = s?.countsByStatus;
    if (!counts || typeof counts !== "object") return {};
    return {
      all: typeof s?.orders === "number" ? s.orders : undefined,
      pending:
        (typeof counts.PLACED === "number" ? counts.PLACED : 0) +
        (typeof counts.PENDING === "number" ? counts.PENDING : 0) +
        (typeof counts.PENDING_CONFIRMATION === "number" ? counts.PENDING_CONFIRMATION : 0) +
        (typeof counts.PENDING_APPROVAL === "number" ? counts.PENDING_APPROVAL : 0),
      confirmed:
        (typeof counts.CONFIRMED === "number" ? counts.CONFIRMED : 0) +
        (typeof counts.APPROVED === "number" ? counts.APPROVED : 0),
      delivered:
        (typeof counts.COMPLETED === "number" ? counts.COMPLETED : 0) +
        (typeof counts.DELIVERED === "number" ? counts.DELIVERED : 0) +
        (typeof counts.FULFILLED === "number" ? counts.FULFILLED : 0),
      cancelled:
        (typeof counts.CANCELLED === "number" ? counts.CANCELLED : 0) +
        (typeof counts.CANCELED === "number" ? counts.CANCELED : 0) +
        (typeof counts.REJECTED === "number" ? counts.REJECTED : 0),
    };
  }, [summary]);

  /* ───────── stable params builder (prevents render-loop patterns) ───────── */

  const buildOrdersParamsStable = useCallback((f, overrides = {}) => {
    const params = new URLSearchParams();
    const p = overrides.page ?? f.page;
    const ps = overrides.pageSize ?? f.pageSize;

    params.set("page", String(p));
    params.set("pageSize", String(ps));

    const q = String(overrides.q ?? f.q ?? "").trim();
    if (q) params.set("q", q);

    const st = String(overrides.status ?? f.status ?? "").trim();
    if (st) {
      const sts = new Set([st].filter(Boolean));
      if (st === "PLACED") ["PENDING", "PENDING_CONFIRMATION", "PENDING_APPROVAL"].forEach((x) => sts.add(x));
      if (st === "CONFIRMED") ["APPROVED"].forEach((x) => sts.add(x));
      if (st === "COMPLETED") ["DELIVERED", "FULFILLED"].forEach((x) => sts.add(x));
      if (st === "CANCELLED") ["CANCELED", "REJECTED"].forEach((x) => sts.add(x));

      let first = true;
      for (const x of sts) {
        if (first) {
          params.set("status", x);
          first = false;
        } else {
          params.append("status", x);
        }
      }
    }

    const pay = String(overrides.paymentStatus ?? f.paymentStatus ?? "").trim();
    if (pay) params.set("paymentStatus", pay);

    const payIn = overrides.paymentStatusIn ?? f.paymentStatusIn ?? [];
    if (Array.isArray(payIn) && payIn.length > 0) {
      payIn
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .forEach((s) => params.append("paymentStatus", s));
    }

    const full = String(overrides.fulfillmentStatus ?? f.fulfillmentStatus ?? "").trim();
    if (full) params.set("fulfillmentStatus", full);

    const from = String(overrides.dateFrom ?? f.dateFrom ?? "").trim();
    const to = String(overrides.dateTo ?? f.dateTo ?? "").trim();
    if (from) params.set("dateFrom", from);
    if (to) params.set("dateTo", to);

    if (overrides.summary) params.set("summary", "1");

    return params;
  }, []);

  const filtersRef = useRef({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    q: "",
    status: "",
    paymentStatus: "",
    paymentStatusIn: [],
    fulfillmentStatus: "",
    dateFrom: "",
    dateTo: "",
  });

  useEffect(() => {
    filtersRef.current = {
      page,
      pageSize,
      q: debouncedQuery,
      status,
      paymentStatus,
      paymentStatusIn,
      fulfillmentStatus,
      dateFrom,
      dateTo,
    };
  }, [
    page,
    pageSize,
    debouncedQuery,
    status,
    paymentStatus,
    paymentStatusIn,
    fulfillmentStatus,
    dateFrom,
    dateTo,
  ]);

  /* ───────── load orders list (single trigger path) ───────── */

  const loadOrders = useCallback(async () => {
    if (!canViewOrders) return;

    const f = filtersRef.current;
    setLoadingOrders(true);
    setOrdersError(null);

    try {
      const params = buildOrdersParamsStable(f);
      const res = await fetch(`/api/admin/orders?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        setOrdersError("You do not have permission to view orders.");
        setItems([]);
        setTotal(0);
        setPageCount(1);
        setSelectedId(null);
        setSelectedOrder(null);
        showReport(
          { type: "error", title: "Permission denied", message: "Access denied by server." },
          "docs"
        );
        return;
      }

      const body = await res.json().catch(() => null);
      if (!body) {
        setOrdersError("Unexpected empty response from server.");
        showReport({ type: "error", title: "Server error", message: "Empty response." }, "docs");
        return;
      }

      if (body.ok === false) {
        setOrdersError(body.error || "Failed to load orders.");
        showReport(
          { type: "error", title: "Failed to load orders", message: body.error || "Unknown error." },
          "docs"
        );
      }

      const rows = body.items || body.orders || body.data?.items || body.data?.orders || [];
      setItems(rows);

      const totalFromApi =
        typeof body.total === "number"
          ? body.total
          : typeof body.data?.total === "number"
          ? body.data.total
          : rows.length;

      const pageCountFromApi =
        typeof body.pageCount === "number"
          ? body.pageCount
          : typeof body.totalPages === "number"
          ? body.totalPages
          : typeof body.data?.pageCount === "number"
          ? body.data.pageCount
          : Math.max(1, Math.ceil((totalFromApi || rows.length || 0) / f.pageSize));

      setTotal(totalFromApi);
      setPageCount(pageCountFromApi);

      // Selection stabilization (prevents selection oscillation loops):
      // - Keep selectedId if present in current rows
      // - Otherwise select first row (or null)
      setSelectedId((cur) => {
        if (cur && rows.some((r) => r?.id === cur)) return cur;
        return rows?.[0]?.id || null;
      });
    } catch (err) {
      setOrdersError(err?.message || "Failed to load orders due to a network error.");
      showReport(
        { type: "error", title: "Network error", message: err?.message || "Failed to fetch." },
        "docs"
      );
    } finally {
      setLoadingOrders(false);
    }
  }, [canViewOrders, buildOrdersParamsStable, showReport]);

  const loadSummary = useCallback(async () => {
    if (!canViewOrders) return;

    setLoadingSummary(true);
    try {
      const f = filtersRef.current;
      const params = buildOrdersParamsStable(
        { ...f, page: 1, pageSize: 1 },
        { summary: true, page: 1, pageSize: 1 }
      );

      const res = await fetch(`/api/admin/orders?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        setSummary(null);
        return;
      }

      const body = await res.json().catch(() => null);
      const s = normalizeSummary(body);
      setSummary(s);
    } catch {
      setSummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }, [canViewOrders, buildOrdersParamsStable]);

  // Single, dependency-driven fetch triggers (no duplicated effects)
  useEffect(() => {
    if (!canViewOrders) return;
    loadOrders();
    loadSummary();
  }, [
    canViewOrders,
    loadOrders,
    loadSummary,
    page,
    debouncedQuery,
    status,
    paymentStatus,
    paymentStatusIn,
    fulfillmentStatus,
    dateFrom,
    dateTo,
  ]);

  const currentPageLabel = useMemo(() => {
    if (!total) return `Page ${page} of ${pageCount}`;
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    return `${from}–${to} of ${total}`;
  }, [page, pageSize, total, pageCount]);

  /* ───────── load single order (runs ONLY when selectedId changes) ───────── */

  const loadOrder = useCallback(
    async (id) => {
      if (!id) return;
      setLoadingOrder(true);
      try {
        const res = await fetch(`/api/admin/orders/${id}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || body?.ok === false) {
          const msg = body?.error || body?.message || `Failed to load order (HTTP ${res.status}).`;
          showReport({ type: "error", title: "Failed to load order", message: msg }, "docs");
          setSelectedOrder(null);
          return;
        }
        setSelectedOrder(body.order || body.data || null);
      } catch (err) {
        const msg = err?.message || "Failed to load order details.";
        showReport({ type: "error", title: "Network error", message: msg }, "docs");
      } finally {
        setLoadingOrder(false);
      }
    },
    [showReport]
  );

  useEffect(() => {
    if (!selectedId) {
      setSelectedOrder(null);
      return;
    }
    loadOrder(selectedId);
  }, [selectedId, loadOrder]);

  /* ───────── order actions (double-click safe) ───────── */

  const refreshAfterMutation = useCallback(
    async (idMaybe) => {
      await Promise.allSettled([loadOrders(), loadSummary()]);
      if (idMaybe) await loadOrder(idMaybe);
    },
    [loadOrders, loadSummary, loadOrder]
  );

  async function runStatusAction(action, labelForReport = null, anchor = "lifecycle") {
    if (!selectedId) return false;

    const lockKey = `status:${selectedId}:${action}`;
    const res = await withActionLock(
      lockKey,
      async () => {
        showReport(
          {
            type: "info",
            title: "Working…",
            message: `Executing: ${labelForReport || action}`,
          },
          anchor
        );

        const r = await fetchJson(`/api/admin/orders/${selectedId}`, {
          method: "PATCH",
          body: JSON.stringify({ action }),
          headers: { "content-type": "application/json" },
        });

        if (!r.ok) {
          const msg =
            r.body?.error ||
            r.body?.message ||
            `Failed to update order (HTTP ${r.res?.status || "?"}).`;
          showReport({ type: "error", title: "Action failed", message: msg }, anchor);
          return { ok: false };
        }

        showReport(
          {
            type: "success",
            title: "SUCCESS",
            message: `${labelForReport || action} executed successfully.`,
          },
          anchor
        );

        setSelectedOrder(r.body?.order || null);
        await refreshAfterMutation(selectedId);
        return { ok: true };
      },
      anchor
    );

    return !!res.ok;
  }

  async function runCapturePayment() {
    if (!selectedId || !canManageOrders) return false;

    const anchor = "payment";
    const lockKey = `pay:${selectedId}:capture`;
    const res = await withActionLock(
      lockKey,
      async () => {
        showReport(
          { type: "info", title: "Working…", message: "Capturing / marking payment as paid…" },
          anchor
        );

        const r = await fetchJson(`/api/admin/orders/${selectedId}/payments/capture`, {
          method: "POST",
        });

        if (!r.ok) {
          const msg =
            r.body?.error ||
            r.body?.message ||
            `Failed to capture payment (HTTP ${r.res?.status || "?"}).`;
          showReport({ type: "error", title: "FAILED", message: msg }, anchor);
          return { ok: false };
        }

        showReport(
          { type: "success", title: "SUCCESS", message: "Payment status updated successfully." },
          anchor
        );

        await refreshAfterMutation(selectedId);
        return { ok: true };
      },
      anchor
    );

    return !!res.ok;
  }

  async function runBookShipment() {
    if (!selectedId || !canManageOrders) return false;

    const anchor = "shipment";
    const lockKey = `ship:${selectedId}:book`;
    const res = await withActionLock(
      lockKey,
      async () => {
        showReport({ type: "info", title: "Working…", message: "Booking shipment…" }, anchor);

        const r = await fetchJson(`/api/admin/orders/${selectedId}/shipments`, {
          method: "POST",
          body: JSON.stringify({
            courierCode: shipForm.courierCode || "pathao",
            serviceCode: shipForm.serviceCode || "standard",
          }),
          headers: { "content-type": "application/json" },
        });

        if (!r.ok) {
          const msg =
            r.body?.error ||
            r.body?.message ||
            `Failed to book shipment (HTTP ${r.res?.status || "?"}).`;
          showReport({ type: "error", title: "FAILED", message: msg }, anchor);
          return { ok: false };
        }

        showReport(
          { type: "success", title: "SUCCESS", message: "Shipment booking created successfully." },
          anchor
        );

        await refreshAfterMutation(selectedId);
        return { ok: true };
      },
      anchor
    );

    return !!res.ok;
  }

  async function runAddNote(kind = "NOTE", messageOverride = null, reportLabel = "Note") {
    if (!selectedId || !canManageOrders) return false;

    const anchor = "notes";
    const msg = (messageOverride ?? noteText).trim();
    if (!msg) return false;

    const lockKey = `note:${selectedId}:${kind}:${msg.slice(0, 24)}`;
    const res = await withActionLock(
      lockKey,
      async () => {
        setNoteBusy(true);
        showReport({ type: "info", title: "Working…", message: `Saving ${reportLabel}…` }, anchor);

        try {
          const r = await fetchJson(`/api/admin/orders/${selectedId}/events`, {
            method: "POST",
            body: JSON.stringify({ kind, message: msg }),
            headers: { "content-type": "application/json" },
          });

          if (!r.ok) {
            const emsg =
              r.body?.error ||
              r.body?.message ||
              `Failed to add note (HTTP ${r.res?.status || "?"}).`;
            showReport({ type: "error", title: "FAILED", message: emsg }, anchor);
            return { ok: false };
          }

          if (!messageOverride) setNoteText("");
          showReport(
            { type: "success", title: "SUCCESS", message: `${reportLabel} saved to order timeline.` },
            anchor
          );

          await refreshAfterMutation(selectedId);
          return { ok: true };
        } finally {
          setNoteBusy(false);
        }
      },
      anchor
    );

    return !!res.ok;
  }

  const customerEmail = useMemo(() => {
    return selectedOrder?.user?.email || selectedOrder?.userEmail || "";
  }, [selectedOrder]);

  const customerPhone = useMemo(() => {
    return selectedOrder?.user?.phone || selectedOrder?.userPhone || "";
  }, [selectedOrder]);

  const customerUserId = useMemo(() => {
    return (
      selectedOrder?.user?.id ||
      selectedOrder?.userId ||
      selectedOrder?.customerId ||
      selectedOrder?.customer?.id ||
      null
    );
  }, [selectedOrder]);

  /**
   * IMPORTANT FIX:
   * Build apology text WITHOUT depending on rejectReasons state (Set).
   * We pass reasons in as an argument instead, so modal-open effects cannot loop.
   */
  const buildApologyFromReasons = useCallback(
    (reasonsArr = []) => {
      const name = selectedOrder?.user?.name || selectedOrder?.userName || "Customer";
      const orderNo = selectedOrder?.orderNumber ?? "—";

      const reasons = Array.isArray(reasonsArr) ? reasonsArr.filter(Boolean) : [];
      const reasonCodes = reasons.map((r) => REJECTION_REASON_CODES[r] || "RXX");
      const reasonBlock = reasons.length ? `Reason(s): ${reasons.join("; ")}.` : "";
      const reasonCodeBlock = reasons.length ? `Reference: ${reasonCodes.join(", ")}.` : "";

      return (
        `Dear ${name},\n\n` +
        `We sincerely apologize — we are unable to process your order #${orderNo} at this time.\n` +
        (reasonBlock ? `${reasonBlock}\n` : "") +
        (reasonCodeBlock ? `${reasonCodeBlock}\n\n` : "\n") +
        `If you have already made a payment, our team will review and proceed according to our policy.\n` +
        `You may place the order again after updating any required details, or contact support for help.\n\n` +
        `Thank you for choosing TDLC.\n` +
        `— The DNA Lab Team`
      );
    },
    [selectedOrder]
  );

  /**
   * Modal init: run ONLY when modal transitions closed -> open.
   * Prevents any accidental setState loop.
   */
  const rejectOpenPrevRef = useRef(false);
  useEffect(() => {
    const wasOpen = rejectOpenPrevRef.current;
    rejectOpenPrevRef.current = rejectOpen;

    if (!rejectOpen || wasOpen) return;

    setRejectErr("");
    setRejectReasons(new Set());
    setRejectNote("");

    setSendApology(true);
    setSendInApp(true);

    setApologyAuto(true);
    setApologyText(buildApologyFromReasons([]));
  }, [rejectOpen, buildApologyFromReasons]);

  /**
   * Auto-update apology as reasons change, but ONLY if:
   * - modal is open AND
   * - auto mode is on
   */
  useEffect(() => {
    if (!rejectOpen) return;
    if (!apologyAuto) return;
    const reasons = Array.from(rejectReasons);
    const next = buildApologyFromReasons(reasons);
    // avoid pointless setState churn
    setApologyText((cur) => (cur === next ? cur : next));
  }, [rejectOpen, apologyAuto, rejectReasons, buildApologyFromReasons]);

  // Scroll lock for modal (with guaranteed cleanup)
  useEffect(() => {
    if (!canUseDOM) return;
    if (!rejectOpen) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [rejectOpen, canUseDOM]);

  async function sendApologyLetterToCustomer(message, reasons, reasonCodes) {
    if (!selectedId || !message?.trim()) return { ok: false, error: "MESSAGE_REQUIRED" };

    const payload = {
      orderId: selectedId,
      orderNumber: selectedOrder?.orderNumber ?? undefined,
      userId: customerUserId || undefined,
      toEmail: customerEmail || undefined,
      toPhone: customerPhone || undefined,

      message: message.trim(),
      reasons: reasons,
      rejectReasons: reasons,
      reasonTexts: reasons,
      reasonCodes: reasonCodes,

      note: rejectNote.trim() || "",
      subject: `Order #${selectedOrder?.orderNumber ?? "—"} update from TDLC`,
      kind: "ORDER_REJECTED_APOLOGY",
      channel: "EMAIL",
      meta: {
        reasons,
        reasonCodes,
      },
    };

    const attempt = await tryMany([
      { url: `/api/admin/orders/${selectedId}/apology`, method: "POST", body: payload },
      { url: `/api/admin/orders/${selectedId}/notify-apology`, method: "POST", body: payload },
      { url: `/api/admin/orders/${selectedId}/notifications/apology`, method: "POST", body: payload },
      { url: `/api/admin/orders/${selectedId}/notifications`, method: "POST", body: payload },
      { url: `/api/admin/notifications`, method: "POST", body: payload },
    ]);

    if (!attempt?.ok) {
      const status = attempt?.res?.status;
      const msg =
        attempt?.body?.error ||
        attempt?.body?.message ||
        attempt?.error ||
        `Failed to send apology${status ? ` (HTTP ${status})` : ""}.`;
      return { ok: false, error: msg };
    }

    return { ok: true, data: attempt.body };
  }

  async function sendCustomerDashboardNotification({ title, message, reasons, reasonCodes }) {
    if (!selectedId) return { ok: false, error: "ORDER_ID_REQUIRED" };

    const payload = {
      orderId: selectedId,
      orderNumber: selectedOrder?.orderNumber ?? undefined,
      userId: customerUserId || undefined,

      title: title || "Order update",
      message: (message || "").trim(),
      reasons: Array.isArray(reasons) ? reasons : undefined,
      reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : undefined,

      kind: "ORDER_REJECTED",
      channel: "IN_APP",
      meta: { reasons: Array.isArray(reasons) ? reasons : undefined, reasonCodes },
    };

    const attempt = await tryMany(
      [
        { url: `/api/admin/orders/${selectedId}/customer-notification`, method: "POST", body: payload },
        { url: `/api/admin/orders/${selectedId}/notifications`, method: "POST", body: payload },
        { url: `/api/admin/orders/${selectedId}/notify`, method: "POST", body: payload },
        { url: `/api/admin/notifications`, method: "POST", body: payload },
        { url: `/api/admin/notifications/create`, method: "POST", body: payload },
        { url: `/api/admin/customer-notifications`, method: "POST", body: payload },
        customerUserId
          ? { url: `/api/admin/customers/${customerUserId}/notifications`, method: "POST", body: payload }
          : null,
      ].filter(Boolean)
    );

    if (!attempt?.ok) {
      const status = attempt?.res?.status;
      const msg =
        attempt?.body?.error ||
        attempt?.body?.message ||
        attempt?.error ||
        `Customer notification failed${status ? ` (HTTP ${status})` : ""}.`;
      return { ok: false, error: msg };
    }

    return { ok: true };
  }

  async function rejectOrderServerSide(reasons, reasonCodes) {
    const idempotencyKey = uuidLite(`reject:${selectedId}`);

    const payload = {
      reasons,
      rejectReasons: reasons,
      reasonTexts: reasons,
      reasonCodes,
      note: rejectNote.trim() || "",
      idempotencyKey,
    };

    const attempt = await tryMany([
      {
        url: `/api/admin/orders/${selectedId}/reject`,
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey },
        body: payload,
      },
      {
        url: `/api/admin/orders/${selectedId}`,
        method: "PATCH",
        body: { action: "reject", ...payload },
      },
      {
        url: `/api/admin/orders/${selectedId}`,
        method: "PATCH",
        body: { action: "cancel", ...payload },
      },
    ]);

    if (!attempt?.ok) {
      const status = attempt?.res?.status;
      const msg =
        attempt?.body?.error ||
        attempt?.body?.message ||
        attempt?.error ||
        `Reject failed${status ? ` (HTTP ${status})` : ""}.`;
      return { ok: false, error: msg };
    }

    return { ok: true, data: attempt.body, used: attempt.used };
  }

  async function logRejectReasonsEvent(reasons, reasonCodes) {
    try {
      await fetchJson(`/api/admin/orders/${selectedId}/events`, {
        method: "POST",
        body: JSON.stringify({
          kind: "REJECT",
          message: `Rejected by admin/staff.\nReasons: ${reasons.join("; ")}\nCodes: ${reasonCodes.join(", ")}`,
          metadata: { reasons, reasonCodes, note: rejectNote.trim() || "" },
        }),
        headers: { "content-type": "application/json" },
      });
    } catch {}
  }

  async function runRejectFlow() {
    if (!selectedId || !canRejectOrders) return;

    setRejectErr("");

    const reasons = Array.from(rejectReasons);
    const reasonCodes = reasons.map((r) => REJECTION_REASON_CODES[r] || "RXX");

    if (reasons.length === 0) {
      setRejectErr("Select at least one rejection reason.");
      showReport(
        { type: "warn", title: "WARNING", message: "Select at least one rejection reason." },
        "lifecycle"
      );
      return;
    }

    const anchor = "lifecycle";
    const lockKey = `reject:${selectedId}:${reasonCodes.join(",")}:${String(rejectNote || "").trim()}`;

    await withActionLock(
      lockKey,
      async () => {
        showReport(
          {
            type: "info",
            title: "PROCESSING",
            message: "Rejecting order with reasons + customer communication…",
          },
          anchor
        );

        // A) Authoritative reject (this should succeed even if optional steps fail)
        const rejectRes = await rejectOrderServerSide(reasons, reasonCodes);
        if (!rejectRes?.ok) {
          const err = rejectRes?.error || rejectRes?.message || "Reject failed.";
          setRejectErr(err);
          showReport({ type: "error", title: "FAILED", message: err }, anchor);
          return { ok: false };
        }

        // B) Optional: Apology EMAIL (admin/manage only).
        let apologyOk = true;
        let apologyWarn = "";
        if (sendApology) {
          if (!canManageOrders) {
            apologyOk = false;
            apologyWarn = "Apology email skipped: insufficient permission (requires MANAGE_ORDERS).";
          } else if (!customerEmail) {
            apologyOk = false;
            apologyWarn = "Apology email skipped: customer email missing.";
          } else if (!apologyText.trim() || apologyText.trim().length < 10) {
            apologyOk = false;
            apologyWarn = "Apology email skipped: message too short.";
          } else {
            setApologyBusy(true);
            try {
              const res = await sendApologyLetterToCustomer(apologyText, reasons, reasonCodes);
              if (!res?.ok) {
                apologyOk = false;
                apologyWarn = res?.error || res?.message || "Apology email failed to send.";
              }
            } catch (e) {
              apologyOk = false;
              apologyWarn = String(e?.message || e || "Apology email failed to send.");
            } finally {
              setApologyBusy(false);
            }
          }
        }

        // C) Optional: Extra in-app notification (admin/manage only).
        let inAppOk = true;
        let inAppWarn = "";
        if (sendInApp) {
          if (!canManageOrders) {
            inAppOk = false;
            inAppWarn = "Extra in-app message skipped: insufficient permission (requires MANAGE_ORDERS).";
          } else {
            try {
              const title = "Order rejected";
              const msg =
                (apologyText?.trim()
                  ? apologyText.trim()
                  : "We’re sorry — your order has been rejected. Please contact support if needed.") +
                (rejectNote?.trim() ? `\n\nAdmin note: ${rejectNote.trim()}` : "");
              const res = await sendCustomerDashboardNotification({
                title,
                message: msg,
                reasons,
                reasonCodes,
              });
              if (!res?.ok) {
                inAppOk = false;
                inAppWarn = res?.error || res?.message || "Extra in-app message failed.";
              }
            } catch (e) {
              inAppOk = false;
              inAppWarn = String(e?.message || e || "Extra in-app message failed.");
            }
          }
        }

        // D) Optional: Add an extra audit event with full reasons/codes (admin/manage only).
        let auditOk = true;
        let auditWarn = "";
        if (canManageOrders) {
          try {
            await logRejectReasonsEvent(reasons, reasonCodes);
          } catch (e) {
            auditOk = false;
            auditWarn = String(e?.message || e || "Audit event logging failed.");
          }
        }

        // Close modal + refresh UI
        setRejectOpen(false);
        setRejectReasons(new Set());
        setRejectNote("");
        setRejectErr("");

        await refreshAfterMutation(selectedId);

        const lines = [];
        lines.push(`Order rejected. Reason(s): ${reasons.join("; ")}.`);
        lines.push(`Reference: ${reasonCodes.join(", ")}.`);
        if (sendApology) lines.push(apologyOk ? "Apology email: SENT." : `Apology email: NOT SENT. ${apologyWarn}`);
        if (sendInApp)
          lines.push(inAppOk ? "Extra in-app message: SENT." : `Extra in-app message: NOT SENT. ${inAppWarn}`);
        if (!auditOk) lines.push(`Audit note: ${auditWarn}`);

        const hasWarn = (sendApology && !apologyOk) || (sendInApp && !inAppOk) || !auditOk;

        showReport(
          {
            type: hasWarn ? "warn" : "success",
            title: hasWarn ? "WARNING" : "SUCCESS",
            message: lines.join("\n"),
          },
          anchor
        );

        return { ok: true };
      },
      anchor
    );
  }

  function resetFilters() {
    setQuery("");
    setDebouncedQuery("");
    setStatus("");
    setPaymentStatus("");
    setPaymentStatusIn([]);
    setFulfillmentStatus("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setSelectedId(null);
    setSelectedOrder(null);
    setActionReport(null);
    setActionReportAnchor("");
  }

  /* ───────── derived UI helpers ───────── */

  const isBusy = !!busyKey || loadingOrders || loadingOrder || apologyBusy;

  /**
   * DOC ROUTE RESOLVER (receipt/invoice):
   * Fixes “Page Not Found” when the project route differs from hardcoded /orders/:id/receipt.
   * UI is unchanged; clicking "Download receipt" will open the first working URL.
   */
  const buildDocCandidates = useCallback((id) => {
    if (!id) return [];
    const base = String(id);

    /**
     * ADMIN RECEIPT/INVOICE CANONICAL ROUTES (HARD):
     * - Admin must NEVER depend on customer routes (/orders/* or /customer/*).
     * - Route-group segments like /(admin) are NOT part of the URL and must never be used.
     */
    return [
      // Canonical admin routes (preferred)
      `/admin/orders/${base}/receipt`,
      `/admin/orders/${base}/invoice`,

      // Common variants (legacy / alternate patterns)
      `/admin/order/${base}/receipt`,
      `/admin/order/${base}/invoice`,
      `/admin/orders/receipt/${base}`,
      `/admin/orders/invoice/${base}`,
    ];
  }, []);

  const resolveAndOpenDoc = useCallback(
    async ({ id, preferred = "receipt" }) => {
      if (!canUseDOM || !id) return;

      const candidates = buildDocCandidates(id);

      // If a route returns 200 but is actually a login/access-gate HTML, treat it as NOT usable.
      const looksLikeAccessGate = (html) => {
        const t = String(html || "");
        const a = /Customer\s+Login/i.test(t);
        const b = /don['’]t\s+have\s+access\s+to\s+this\s+receipt/i.test(t);
        const c = /Please\s+log\s+in/i.test(t) && /receipt/i.test(t);
        return a && (b || c);
      };

      // Prefer receipt/invoice ordering
      const ordered =
        preferred === "invoice"
          ? [
              ...candidates.filter((u) => u.toLowerCase().includes("invoice")),
              ...candidates.filter((u) => !u.toLowerCase().includes("invoice")),
            ]
          : [
              ...candidates.filter((u) => u.toLowerCase().includes("receipt")),
              ...candidates.filter((u) => !u.toLowerCase().includes("receipt")),
            ];

      showReport(
        { type: "info", title: "Working…", message: `Finding ${preferred} route…` },
        "docs"
      );

      // Probe URLs (GET is used because many Next routes don’t implement HEAD reliably)
      for (const url of ordered) {
        try {
          const res = await fetch(url, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });

          if (res.ok) {
            // Some protected routes respond 200 with an HTML gate. Do not treat those as success.
            const ct = String(res.headers.get("content-type") || "").toLowerCase();
            if (ct.includes("text/html")) {
              const html = await res.text().catch(() => "");
              if (looksLikeAccessGate(html)) {
                continue;
              }
            }

            window.open(url, "_blank", "noopener,noreferrer");
            showReport(
              { type: "success", title: "SUCCESS", message: `${preferred} opened successfully.` },
              "docs"
            );
            return true;
          }
        } catch {
          // continue
        }
      }

      showReport(
        {
          type: "error",
          title: "FAILED",
          message:
            `No working ${preferred} route was found for this order.\n` +
            `This means the receipt/invoice page route is missing or protected by middleware.\n` +
            `Paste the receipt/invoice route file so I can align it exactly.`,
        },
        "docs"
      );

      return false;
    },
    [buildDocCandidates, canUseDOM, showReport]
  );

  async function confirmAndReceipt() {
    if (!selectedId || !canConfirmOrders) return;

    const lockKey = `combo:${selectedId}:confirm+receipt`;
    await withActionLock(
      lockKey,
      async () => {
        const ok = await runStatusAction("confirm", "Confirm", "lifecycle");
        if (ok) {
          await resolveAndOpenDoc({ id: selectedId, preferred: "receipt" });
        }
        return { ok };
      },
      "lifecycle"
    );
  }

  const kpi = summary || {};
  const unpaidIsPositive = typeof kpi.unpaidAmount === "number" && kpi.unpaidAmount > 0;

  const listEmpty = !loadingOrders && items.length === 0;
  const isLoadingInitial = loadingOrders && items.length === 0;

  // Workflow gating (your requested rules)
  const orderStatusRaw = String(selectedOrder?.status ?? selectedOrder?.orderStatus ?? "");
  const orderStatus = normalizeOrderStatus(orderStatusRaw);
  const payStatus = String(selectedOrder?.paymentStatus || "");

  const isCancelled = orderStatus === "CANCELLED";
  const isCompleted = orderStatus === "COMPLETED";

  const isPreConfirm = ["DRAFT", "PLACED"].includes(orderStatus) || (!orderStatus && !!selectedId);
  const isPostConfirm = orderStatus === "CONFIRMED";

  /**
   * TDLC RULES (bulletproof):
   * - Pending / Pre-confirm: ONLY Confirm + Reject are actionable; all other lifecycle CTAs must be inactive.
   * - After confirm: Confirm becomes inactive; receipt/payment/shipment/delivered unlock.
   * - After confirm: Reject stays inactive for staff; Admin may unlock Reject (safety override).
   */
  const canConfirmNow =
    !!selectedId && canConfirmOrders && isPreConfirm && !isCancelled && !isCompleted;

  const canRejectNow =
    !!selectedId &&
    canRejectOrders &&
    !isCancelled &&
    !isCompleted &&
    (isPreConfirm ? true : isPostConfirm ? isAdminRole && !!adminRejectOverride : false);

  const canDeliverNow =
    !!selectedId && canManageOrders && isPostConfirm && !isCancelled && !isCompleted;

  const canDownloadReceipt =
    !!selectedId &&
    (orderStatus === "CONFIRMED" || orderStatus === "COMPLETED" || orderStatus === "CANCELLED");

  const paymentFinal = ["PAID", "SETTLED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payStatus);
  const canCapturePayment =
    !!selectedId && canManageOrders && isPostConfirm && !paymentFinal && !isCancelled && !isCompleted;

  const hasShipment = !!(
    selectedOrder?.shipment?.id ||
    selectedOrder?.shipmentId ||
    selectedOrder?.trackingCode ||
    selectedOrder?.trackingNumber ||
    (Array.isArray(selectedOrder?.shipments) && selectedOrder.shipments.length > 0)
  );
  const canBookShipment =
    !!selectedId && canManageOrders && isPostConfirm && !hasShipment && !isCancelled && !isCompleted;

  // Cancel remains (admin only after confirm)
  const canCancelNow =
    !!selectedId && canManageOrders && isAdminRole && isPostConfirm && !isCancelled && !isCompleted;

  /* ───────── modal lifecycle ───────── */

  useEffect(() => {
    if (!rejectOpen) return;

    function onKeyDown(e) {
      if (e.key === "Escape") {
        setRejectOpen(false);
        setRejectErr("");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rejectOpen]);

  /* ───────── render ───────── */

  if (loadingSession) {
    return <div className="p-6 text-sm text-neutral-600">Loading admin session…</div>;
  }

  const RejectModal = rejectOpen ? (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setRejectOpen(false);
          setRejectErr("");
        }
      }}
      style={{
        background:
          "radial-gradient(900px 520px at 40% 18%, rgba(212,175,55,0.18), rgba(0,0,0,0.62) 62%), rgba(0,0,0,0.62)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="w-full max-w-3xl rounded-[36px] bg-white shadow-[0_44px_140px_rgba(0,0,0,0.40)] border border-slate-200 overflow-hidden">
        <div className="px-8 py-7 border-b border-slate-100 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[20px] font-black text-slate-900">
                Reject order (select reasons)
              </div>
              <div className="mt-1.5 text-[14px] text-slate-600">
                Select reasons, optionally edit the apology letter, then reject (and notify customer dashboard with exact reasons + codes).
              </div>
            </div>
            <Button
              variant="soft"
              size="xl"
              disabled={isBusy}
              onClick={() => {
                setRejectOpen(false);
                setRejectErr("");
              }}
            >
              Close
            </Button>
          </div>

          {selectedOrder ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Chip tone="neutral">Order #{selectedOrder.orderNumber ?? "—"}</Chip>
              <Chip tone={customerEmail ? "info" : "danger"}>{customerEmail || "No email"}</Chip>
              <Chip tone={customerPhone ? "info" : "warn"}>{customerPhone || "No phone"}</Chip>
            </div>
          ) : null}
        </div>

        <div className="px-8 py-7 space-y-5">
          {rejectErr ? (
            <div className="rounded-[26px] border border-rose-200 bg-rose-50 px-6 py-5 text-[15px] font-black text-rose-900">
              {rejectErr}
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {REJECTION_REASONS.map((r) => {
              const checked = rejectReasons.has(r);
              const code = REJECTION_REASON_CODES[r] || "RXX";
              return (
                <label
                  key={r}
                  className={cn(
                    "flex items-start gap-3 rounded-[26px] border px-6 py-5 text-[16px] cursor-pointer transition-all duration-200",
                    "hover:-translate-y-[2px] hover:shadow-[0_22px_52px_rgba(15,33,71,0.14)]",
                    checked ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1.5"
                    checked={checked}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      setRejectReasons((prev) => {
                        const next = new Set(prev);
                        if (isChecked) next.add(r);
                        else next.delete(r);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-slate-900 font-black leading-snug">{r}</div>
                    <div className="mt-1 text-[12px] font-black text-slate-600 tracking-wide">CODE: {code}</div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                Optional note (internal only)
              </label>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={4}
                className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-5 text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-200"
                placeholder="Internal context for your team (not sent to customer)…"
              />
              <div className="mt-2 text-[12px] font-semibold text-slate-600">
                Saved internally to the order timeline — not included in customer messages.
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide">
                  Customer communications
                </label>

                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={sendApology}
                      onChange={(e) => setSendApology(e.target.checked)}
                    />
                    Email apology
                  </label>

                  <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={sendInApp}
                      onChange={(e) => setSendInApp(e.target.checked)}
                    />
                    IN_APP notify
                  </label>

                  <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={apologyAuto}
                      onChange={(e) => setApologyAuto(e.target.checked)}
                    />
                    Auto
                  </label>
                </div>
              </div>

              <textarea
                value={apologyText}
                onChange={(e) => {
                  setApologyText(e.target.value);
                  setApologyAuto(false);
                }}
                rows={8}
                className={cn(
                  "w-full rounded-[26px] border bg-white px-6 py-5 text-[15px] shadow-sm focus:outline-none",
                  sendApology ? "border-slate-200 focus:ring-2 focus:ring-slate-200" : "border-slate-200 opacity-70"
                )}
                placeholder="Apology letter to customer…"
                disabled={!sendApology}
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="soft"
                  size="sm"
                  disabled={!sendApology || isBusy}
                  onClick={() => {
                    setApologyAuto(true);
                    setApologyText(buildApologyFromReasons(Array.from(rejectReasons)));
                  }}
                >
                  Regenerate
                </Button>

                {sendApology && !customerEmail ? (
                  <span className="text-[12px] font-black text-rose-900">
                    No customer email — apology email cannot be delivered.
                  </span>
                ) : null}
              </div>

              <div className="mt-2 text-[12px] font-semibold text-slate-600">
                IN_APP notification includes reasons + codes for the customer dashboard (when enabled).
              </div>
            </div>
          </div>
        </div>

        <div className="px-8 py-7 border-t border-slate-100 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2">
            <Button
              variant="soft"
              size="xl"
              disabled={isBusy}
              onClick={() => {
                setRejectReasons(new Set());
                setRejectNote("");
                setRejectErr("");
                setSendApology(true);
                setSendInApp(true);
                setApologyAuto(true);
                setApologyText(buildApologyFromReasons([]));
              }}
            >
              Reset
            </Button>
          </div>

          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <Button
              variant="primary"
              size="xxl"
              disabled={isBusy || !selectedId}
              onClick={runRejectFlow}
              className="min-w-[340px]"
            >
              {apologyBusy ? "Sending…" : "Send + Reject (final)"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      className="p-4 md:p-6 space-y-5 min-h-[calc(100vh-40px)]"
      style={{
        ["--navy"]: NAVY,
        ["--gold"]: GOLD,
      }}
    >
      <style jsx global>{`
        /* Shine layers */
        .tdlc-pill-shine::before,
        .tdlc-btn-shine::before {
          content: "";
          position: absolute;
          inset: -40% -30%;
          background: radial-gradient(circle at 30% 30%, rgba(212, 175, 55, 0.18), rgba(255, 255, 255, 0) 55%);
          transform: translateX(-20%);
          opacity: 0;
          transition: opacity 200ms ease, transform 240ms ease;
          pointer-events: none;
        }
        .tdlc-btn-shine::after {
          content: "";
          position: absolute;
          inset: -60% -40%;
          background: radial-gradient(circle at 70% 20%, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 50%);
          transform: translateX(10%);
          opacity: 0;
          transition: opacity 220ms ease, transform 240ms ease;
          pointer-events: none;
        }
        .tdlc-pill-shine:hover::before,
        .tdlc-btn-shine:hover::before {
          opacity: 1;
          transform: translateX(0%);
        }
        .tdlc-btn-shine:hover::after {
          opacity: 1;
          transform: translateX(0%);
        }

        /* HARD GUARANTEE: CTA/TAB text stays WHITE */
        .tdlc-btn-shine {
          color: #fff !important;
        }
        .tdlc-btn-shine * {
          color: inherit !important;
        }
        .tdlc-btn-shine:visited {
          color: #fff !important;
        }
        .tdlc-pill-shine {
          color: #fff !important;
        }
        .tdlc-pill-shine * {
          color: inherit !important;
        }
      `}</style>

      {/* Soft premium background */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 600px at 18% 10%, rgba(212,175,55,0.14), rgba(255,255,255,0) 55%), radial-gradient(900px 520px at 82% 0%, rgba(15,33,71,0.14), rgba(255,255,255,0) 62%), linear-gradient(to bottom, rgba(248,250,252,1), rgba(255,255,255,1))",
        }}
      />

      {/* Constrain overall width (prevents stretched look) */}
      <div className="mx-auto w-full max-w-[1320px] space-y-5">
        {/* ===== HEADER / CONTROL STRIP ===== */}
        <Card className="px-7 py-6 md:px-8 md:py-7">
          <SectionTitle
            title="Orders"
            subtitle="Pending → Confirmed → Delivered. Payment posture, shipment actions, receipt access, and audit trail — in one premium cockpit."
            right={
              <>
                <Button variant="primary" size="xl" disabled={isBusy} onClick={loadOrders}>
                  Refresh
                </Button>
                <Button variant="soft" size="xl" disabled={isBusy} onClick={resetFilters}>
                  Clear filters
                </Button>
              </>
            }
          />

          {/* Tabs */}
          <div className="mt-6 max-w-[1180px] mx-auto">
            <div className="flex flex-wrap items-center justify-center gap-4">
              {TAB_DEFS.map((t) => {
                const active = activeTabKey === t.key;
                const count = t.key === "paid" ? undefined : tabCounts[t.key];

                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => t.apply()}
                    className={cn(
                      "transition-transform duration-200 ease-out",
                      "hover:-translate-y-[1px] active:translate-y-0"
                    )}
                  >
                    <TabPill
                      active={active}
                      label={t.label}
                      count={typeof count === "number" ? count : undefined}
                    />
                  </button>
                );
              })}

              {activeTabKey === "custom" ? (
                <span className="ml-1">
                  <TabPill active label="Custom filters" />
                </span>
              ) : null}

              <div className="flex items-center gap-3">
                <Button
                  variant={showAdvanced ? "primary" : "soft"}
                  size="xl"
                  disabled={isBusy}
                  onClick={() => setShowAdvanced((s) => !s)}
                >
                  {showAdvanced ? "Hide filters" : "More filters"}
                </Button>
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="mt-6 max-w-[1180px] mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
              <KpiCard label="Total orders" value={loadingSummary ? "…" : kpi.orders ?? "—"} tone="neutral" />
              <KpiCard
                label="Total amount"
                value={loadingSummary ? "…" : kpi.amount == null ? "—" : money(kpi.amount)}
                tone="navy"
              />
              <KpiCard label="Total items" value={loadingSummary ? "…" : kpi.items ?? "—"} tone="neutral" />
              <KpiCard label="Total quantity" value={loadingSummary ? "…" : kpi.qty ?? "—"} tone="neutral" />
              <KpiCard
                label="Paid amount"
                value={loadingSummary ? "…" : kpi.paidAmount == null ? "—" : money(kpi.paidAmount)}
                tone="accent"
              />
              <KpiCard
                label="Due / unpaid"
                value={loadingSummary ? "…" : kpi.unpaidAmount == null ? "—" : money(kpi.unpaidAmount)}
                tone={unpaidIsPositive ? "danger" : "neutral"}
              />
            </div>
          </div>

          {/* Filters + Pagination */}
          <div className="mt-6 max-w-[1180px] mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
              <div className="rounded-[30px] border border-slate-200 bg-white/92 backdrop-blur px-6 py-6">
                <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                  Search
                </label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by name, email, phone, order #, or ID…"
                  className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                />

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                      From
                    </label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => {
                        setDateFrom(e.target.value);
                        setPage(1);
                      }}
                      className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                      To
                    </label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => {
                        setDateTo(e.target.value);
                        setPage(1);
                      }}
                      className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                </div>

                {showAdvanced ? (
                  <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                        Status
                      </label>
                      <select
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setPage(1);
                        }}
                        className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="">All statuses</option>
                        {Object.entries(STATUS_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                        Payment
                      </label>
                      <select
                        value={paymentStatus}
                        onChange={(e) => {
                          setPaymentStatusIn([]);
                          setPaymentStatus(e.target.value);
                          setPage(1);
                        }}
                        className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="">All payments</option>
                        {Object.entries(PAYMENT_STATUS_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {paymentStatusIn.length > 0 ? (
                        <div className="mt-2 text-[12px] font-semibold text-slate-600">
                          Active: {paymentStatusIn.join(", ")}
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                        Fulfillment
                      </label>
                      <select
                        value={fulfillmentStatus}
                        onChange={(e) => {
                          setFulfillmentStatus(e.target.value);
                          setPage(1);
                        }}
                        className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      >
                        <option value="">All fulfillment</option>
                        {Object.entries(FULFILLMENT_STATUS_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Pagination */}
              <div className="rounded-[30px] border border-slate-200 bg-white/92 backdrop-blur px-6 py-6 flex flex-col justify-between">
                <div>
                  <div className="text-[11px] font-black text-slate-500 uppercase tracking-wide">
                    Pagination
                  </div>
                  <div className="mt-2 text-[16px] font-black text-slate-900">
                    {currentPageLabel}
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Button
                      variant="soft"
                      size="xxl"
                      disabled={page <= 1 || isBusy}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </Button>
                    <Button
                      variant="soft"
                      size="xxl"
                      disabled={page >= pageCount || isBusy}
                      onClick={() => setPage((p) => (p >= pageCount ? p : p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>

                <div className="mt-5">
                  <Button variant="primary" size="xxl" disabled={isBusy} onClick={loadOrders} className="w-full">
                    Reload list
                  </Button>
                </div>
              </div>
            </div>

            {ordersError ? (
              <div className="mt-5 rounded-[26px] border border-rose-200 bg-rose-50 px-6 py-5 text-[15px] font-black text-rose-900">
                {ordersError}
              </div>
            ) : null}
          </div>
        </Card>

        {/* ===== MAIN: LIST + DETAIL ===== */}
        <div className="grid gap-5 lg:grid-cols-[560px_minmax(0,1fr)]">
          {/* Orders list */}
          <Card className="overflow-hidden">
            <div className="px-7 py-6 border-b border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[16px] font-black text-slate-900">Orders list</div>
                {busyKey ? <div className="text-[13px] font-semibold text-slate-600">Working…</div> : null}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-[15px]">
                <thead className="sticky top-0 z-[1]">
                  <tr className="bg-[linear-gradient(180deg,rgba(15,33,71,0.07),rgba(15,33,71,0.02))] text-[12px] uppercase tracking-wide text-slate-700">
                    <th className="px-7 py-5 text-left font-black">Order</th>
                    <th className="px-7 py-5 text-left font-black">Customer</th>
                    <th className="px-7 py-5 text-left font-black">Status</th>
                    <th className="px-7 py-5 text-left font-black">Payment</th>
                    <th className="px-7 py-5 text-left font-black">Total</th>
                    <th className="px-7 py-5 text-left font-black">Created</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {isLoadingInitial ? (
                    <>
                      <SkeletonRow />
                      <SkeletonRow />
                      <SkeletonRow />
                      <SkeletonRow />
                      <SkeletonRow />
                    </>
                  ) : null}

                  {listEmpty ? (
                    <tr>
                      <td colSpan={6} className="px-7 py-16 text-center text-[15px] text-slate-500">
                        No orders found.
                      </td>
                    </tr>
                  ) : null}

                  {!isLoadingInitial &&
                    items.map((o) => {
                      const isSelected = selectedId === o.id;
                      const statusLabel = STATUS_LABELS[o.status] || o.status || "—";
                      const paymentLabel = PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus || "—";

                      const statusTone =
                        o.status === "COMPLETED"
                          ? "success"
                          : o.status === "CANCELLED"
                          ? "danger"
                          : o.status === "CONFIRMED"
                          ? "info"
                          : o.status === "PLACED"
                          ? "warn"
                          : "neutral";

                      return (
                        <tr
                          key={o.id}
                          onClick={() => setSelectedId(o.id)}
                          className={cn(
                            "cursor-pointer transition-all duration-200",
                            isSelected ? "bg-slate-50" : "hover:bg-slate-50/70"
                          )}
                        >
                          <td
                            className={cn(
                              "px-7 py-6 align-top",
                              isSelected ? "border-l-4 border-amber-400" : "border-l-4 border-transparent"
                            )}
                          >
                            <div className="font-black text-slate-900 text-[16px]">#{o.orderNumber ?? "—"}</div>
                            <div className="text-[12px] text-slate-500">ID: {o.id}</div>
                          </td>

                          <td className="px-7 py-6 align-top">
                            <div className="font-bold text-slate-900 text-[15px]">{o.userName || "—"}</div>
                            <div className="text-[12px] text-slate-500">{o.userEmail || o.userPhone || "—"}</div>
                          </td>

                          <td className="px-7 py-6 align-top">
                            <Chip tone={statusTone}>{statusLabel}</Chip>
                          </td>

                          <td className="px-7 py-6 align-top">
                            <span className="text-[15px] font-semibold text-slate-800">{paymentLabel}</span>
                          </td>

                          <td className="px-7 py-6 align-top font-black text-slate-900 whitespace-nowrap">
                            {money(o.grandTotal)}
                          </td>

                          <td className="px-7 py-6 align-top text-[15px] text-slate-700 whitespace-nowrap">
                            {formatDateTime(o.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Order detail */}
          <Card className="p-7 md:p-8">
            <SectionTitle
              title="Order detail"
              subtitle="Actions, shipment, receipt, and timeline — with server-logged events."
              right={loadingOrder ? <div className="text-[14px] font-semibold text-slate-500">Loading…</div> : null}
            />

            {!selectedOrder && !loadingOrder ? (
              <div className="mt-6 rounded-[30px] border border-slate-200 bg-slate-50 px-6 py-10 text-[15px] text-slate-600">
                Select an order from the list to view details.
              </div>
            ) : null}

            {selectedOrder ? (
              <>
                {/* Summary block */}
                <div className="mt-6 rounded-[30px] border border-slate-200 bg-slate-50 px-6 py-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[20px] font-black text-slate-900">#{selectedOrder.orderNumber ?? "—"}</div>
                      <div className="mt-1 text-[12px] text-slate-600">{selectedOrder.id}</div>
                      <div className="mt-3 text-[15px] text-slate-700">
                        {selectedOrder.user?.name || selectedOrder.userName || "—"} ·{" "}
                        {selectedOrder.user?.email ||
                          selectedOrder.user?.phone ||
                          selectedOrder.userEmail ||
                          selectedOrder.userPhone ||
                          "—"}
                      </div>
                    </div>

                    <div className="text-[13px] font-semibold text-slate-600 whitespace-nowrap">
                      {formatDateTime(selectedOrder.createdAt)}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2.5">
                    <Chip tone="neutral">Status: {STATUS_LABELS[selectedOrder.status] || selectedOrder.status}</Chip>
                    <Chip tone="neutral">
                      Payment: {PAYMENT_STATUS_LABELS[selectedOrder.paymentStatus] || selectedOrder.paymentStatus}
                    </Chip>
                    <Chip tone="neutral">
                      Fulfillment:{" "}
                      {FULFILLMENT_STATUS_LABELS[selectedOrder.fulfillmentStatus] || selectedOrder.fulfillmentStatus}
                    </Chip>
                    <Chip tone="warn">Total: {money(selectedOrder.grandTotal)}</Chip>
                    {hasShipment ? <Chip tone="info">Shipment: booked</Chip> : <Chip tone="neutral">Shipment: none</Chip>}
                  </div>

                  <div className="mt-4 text-[12px] font-semibold text-slate-600">
                    Workflow: <span className="font-black">Before confirmation:</span> only{" "}
                    <span className="font-black">Confirm + Reject</span>.{" "}
                    <span className="font-black">After confirmation:</span> receipt/payment/shipment/delivered unlock.
                    Reject stays locked unless an <span className="font-black">Admin explicitly unlocks</span>.
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-6 rounded-[30px] border border-slate-200 bg-white px-6 py-6">
                  <div className="flex items-center justify-between mb-5">
                    <div className="text-[16px] font-black text-slate-900">Actions</div>
                    {busyKey ? <span className="text-[14px] font-semibold text-slate-500">Working…</span> : null}
                  </div>

                  {!canConfirmOrders && !canManageOrders && !canRejectOrders ? (
                    <div className="rounded-[30px] bg-slate-50 px-6 py-5 text-[15px] text-slate-700 border border-slate-200">
                      You have read-only access. Ask the owner to grant permissions.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                      {/* Lifecycle */}
                      <div className="rounded-[30px] border border-slate-200 bg-slate-50 px-6 py-6">
                        <div className="text-[11px] font-black text-slate-500 uppercase tracking-wide mb-5">
                          Lifecycle
                        </div>

                        {/* Admin unlock for reject-after-confirm */}
                        {isPostConfirm && isAdminRole ? (
                          <div className="mb-5">
                            <ToggleRow
                              label="Unlock Reject after confirmation (Admin)"
                              description="By default, Reject is disabled after confirmation. Turn this ON only if the order was mistakenly confirmed and must be rejected."
                              value={adminRejectOverride}
                              onChange={setAdminRejectOverride}
                              disabled={isBusy}
                            />
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-4">
                          <Button
                            variant="primary"
                            size="xxl"
                            className="min-w-[240px]"
                            disabled={isBusy || !canConfirmNow}
                            onClick={() => runStatusAction("confirm", "Confirm", "lifecycle")}
                            title={canConfirmNow ? "Confirm this order" : "Only available for pending orders"}
                          >
                            Confirm
                          </Button>

                          <Button
                            variant="primary"
                            size="xxl"
                            className="min-w-[240px]"
                            disabled={isBusy || !canDeliverNow}
                            onClick={() => runStatusAction("complete", "Delivered", "lifecycle")}
                            title={canDeliverNow ? "Mark as delivered/completed" : "Only confirmed orders can be delivered"}
                          >
                            Delivered
                          </Button>

                          <Button
                            variant="primary"
                            size="xxl"
                            className="min-w-[240px]"
                            disabled={isBusy || !canConfirmNow}
                            onClick={confirmAndReceipt}
                            title="Confirm and open receipt in a new tab"
                          >
                            Confirm + Receipt
                          </Button>

                          <Button
                            variant="primary"
                            size="xxl"
                            className="min-w-[240px]"
                            disabled={isBusy || !canRejectNow}
                            onClick={() => {
                              setRejectOpen(true);
                              setRejectErr("");
                            }}
                            title={
                              canRejectNow
                                ? "Reject with reasons"
                                : isPostConfirm
                                ? "Reject is disabled after confirmation. Admin can unlock it above if needed."
                                : "Unavailable"
                            }
                          >
                            Reject (reasons)
                          </Button>

                          <Button
                            variant="primary"
                            size="xxl"
                            className="min-w-[240px]"
                            disabled={isBusy || !canCancelNow}
                            onClick={() => runStatusAction("cancel", "Cancel (Admin)", "lifecycle")}
                            title={canCancelNow ? "Cancel after confirmation (admin only)" : "Admin only after confirm"}
                          >
                            Cancel
                          </Button>
                        </div>

                        {actionReportAnchor === "lifecycle" ? (
                          <ActionStatusLine
                            report={actionReport}
                            onClear={() => {
                              setActionReport(null);
                              setActionReportAnchor("");
                            }}
                          />
                        ) : null}
                      </div>

                      {/* Documents & Customer */}
                      <div className="rounded-[30px] border border-slate-200 bg-slate-50 px-6 py-6">
                        <div className="text-[11px] font-black text-slate-500 uppercase tracking-wide mb-5">
                          Documents & Customer
                        </div>

                        <div className="flex flex-wrap gap-3">
                          {selectedId ? (
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                if (!selectedId || !canDownloadReceipt || isBusy) return;
                                resolveAndOpenDoc({ id: selectedId, preferred: "receipt" });
                              }}
                              className={cn(
                                "relative inline-flex items-center justify-center overflow-hidden rounded-full border",
                                "bg-[linear-gradient(135deg,var(--navy)_0%,#0B1A36_62%,var(--navy)_100%)] text-white border-[rgba(15,33,71,0.92)]",
                                "px-10 py-[18px] text-[16px] font-black min-h-[60px]",
                                "shadow-[0_22px_70px_rgba(15,33,71,0.22)]",
                                "transition-all duration-200 ease-out hover:-translate-y-[2px] hover:scale-[1.01]",
                                "ring-1 ring-white/10",
                                "tdlc-btn-shine",
                                canDownloadReceipt && !isBusy ? "" : "opacity-40 pointer-events-none"
                              )}
                              title={canDownloadReceipt ? "Download receipt" : "Receipt unlocks after confirmation"}
                            >
                              <span className="relative z-10">Download receipt</span>
                            </a>
                          ) : null}

                          <Button
                            variant="soft"
                            size="xxl"
                            disabled={!selectedOrder}
                            onClick={() => {
                              const txt = `${selectedOrder?.id || ""}`.trim();
                              if (!txt) return;
                              navigator.clipboard?.writeText(txt).catch(() => {});
                              showReport({ type: "success", title: "SUCCESS", message: "Order ID copied." }, "docs");
                            }}
                            className="min-w-[240px]"
                          >
                            Copy Order ID
                          </Button>

                          <Button
                            variant="soft"
                            size="xxl"
                            disabled={!customerEmail}
                            onClick={() => {
                              const txt = `${customerEmail || ""}`.trim();
                              if (!txt) return;
                              navigator.clipboard?.writeText(txt).catch(() => {});
                              showReport({ type: "success", title: "SUCCESS", message: "Customer email copied." }, "docs");
                            }}
                            className="min-w-[240px]"
                          >
                            Copy Email
                          </Button>

                          <Button
                            variant="soft"
                            size="xxl"
                            disabled={!customerPhone}
                            onClick={() => {
                              const txt = `${customerPhone || ""}`.trim();
                              if (!txt) return;
                              navigator.clipboard?.writeText(txt).catch(() => {});
                              showReport({ type: "success", title: "SUCCESS", message: "Customer phone copied." }, "docs");
                            }}
                            className="min-w-[240px]"
                          >
                            Copy Phone
                          </Button>
                        </div>

                        {actionReportAnchor === "docs" ? (
                          <ActionStatusLine
                            report={actionReport}
                            onClear={() => {
                              setActionReport(null);
                              setActionReportAnchor("");
                            }}
                          />
                        ) : null}

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Chip tone={customerEmail ? "info" : "danger"}>{customerEmail || "No email"}</Chip>
                          <Chip tone={customerPhone ? "info" : "warn"}>{customerPhone || "No phone"}</Chip>
                          <Chip tone={customerUserId ? "info" : "warn"}>User ID: {customerUserId || "—"}</Chip>
                        </div>

                        <div className="mt-4 text-[12px] font-semibold text-slate-600">
                          Reject flow attempts BOTH: (1) apology email (optional) and (2) customer dashboard IN_APP notification with exact reasons + codes.
                        </div>
                      </div>

                      {/* Payment */}
                      <div className="rounded-[30px] border border-slate-200 bg-slate-50 px-6 py-6">
                        <div className="text-[11px] font-black text-slate-500 uppercase tracking-wide mb-5">
                          Payment
                        </div>

                        <div className="flex flex-wrap gap-4">
                          <Button
                            variant="primary"
                            size="xxl"
                            className="min-w-[260px]"
                            disabled={isBusy || !canCapturePayment}
                            onClick={runCapturePayment}
                            title={canCapturePayment ? "Capture/mark paid" : "Unlocks after confirm; disabled if final/closed"}
                          >
                            Capture / Mark Paid
                          </Button>
                        </div>

                        {actionReportAnchor === "payment" ? (
                          <ActionStatusLine
                            report={actionReport}
                            onClear={() => {
                              setActionReport(null);
                              setActionReportAnchor("");
                            }}
                          />
                        ) : null}
                      </div>

                      {/* Shipment */}
                      <div className="rounded-[30px] border border-slate-200 bg-slate-50 px-6 py-6">
                        <div className="text-[11px] font-black text-slate-500 uppercase tracking-wide mb-5">
                          Shipment booking
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                                Courier Code
                              </label>
                              <input
                                type="text"
                                value={shipForm.courierCode}
                                onChange={(e) =>
                                  setShipForm((prev) => ({
                                    ...prev,
                                    courierCode: e.target.value,
                                  }))
                                }
                                className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                                disabled={!isPostConfirm || isBusy}
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-wide mb-2">
                                Service Code
                              </label>
                              <input
                                type="text"
                                value={shipForm.serviceCode}
                                onChange={(e) =>
                                  setShipForm((prev) => ({
                                    ...prev,
                                    serviceCode: e.target.value,
                                  }))
                                }
                                className="w-full rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                                disabled={!isPostConfirm || isBusy}
                              />
                            </div>
                          </div>

                          <div className="flex justify-start">
                            <Button
                              variant="primary"
                              size="xxl"
                              className="min-w-[260px]"
                              disabled={isBusy || !canBookShipment}
                              onClick={runBookShipment}
                              title={canBookShipment ? "Book shipment" : "Unlocks after confirm; disabled if shipment exists/closed"}
                            >
                              Book Shipment
                            </Button>
                          </div>
                        </div>

                        {actionReportAnchor === "shipment" ? (
                          <ActionStatusLine
                            report={actionReport}
                            onClear={() => {
                              setActionReport(null);
                              setActionReportAnchor("");
                            }}
                          />
                        ) : null}

                        {hasShipment ? (
                          <div className="mt-4 text-[12px] font-semibold text-slate-600">
                            Shipment already exists — booking CTA disabled.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                {/* Events & notes */}
                <div className="mt-6 rounded-[30px] border border-slate-200 bg-white px-6 py-6">
                  <div className="flex items-center justify-between mb-5">
                    <div className="text-[16px] font-black text-slate-900">Events & Notes</div>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-3 mb-5 pr-1">
                    {(selectedOrder.events || [])
                      .slice()
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                      .map((ev) => {
                        const meta = ev?.metadata && typeof ev.metadata === "object" ? ev.metadata : null;
                        const metaReasons = Array.isArray(meta?.reasons) ? meta.reasons : null;
                        const metaReasonCodes = Array.isArray(meta?.reasonCodes) ? meta.reasonCodes : null;
                        const metaNote = typeof meta?.note === "string" ? meta.note : null;

                        return (
                          <div key={ev.id} className="border border-slate-200 rounded-[30px] px-5 py-4 bg-slate-50">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[15px] font-black text-slate-900">{ev.kind || "EVENT"}</span>
                              <span className="text-[12px] font-semibold text-slate-600">{formatDateTime(ev.createdAt)}</span>
                            </div>

                            {ev.message ? (
                              <div className="mt-3 whitespace-pre-wrap text-[15px] text-slate-800 leading-relaxed">
                                {ev.message}
                              </div>
                            ) : null}

                            {metaReasons?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="text-[12px] font-black text-slate-600">Reasons:</span>
                                {metaReasons.slice(0, 12).map((r, i) => (
                                  <Chip key={`${ev.id}-r-${i}`} tone="warn">
                                    {String(r)}
                                  </Chip>
                                ))}
                              </div>
                            ) : null}

                            {metaReasonCodes?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="text-[12px] font-black text-slate-600">Codes:</span>
                                {metaReasonCodes.slice(0, 12).map((c, i) => (
                                  <Chip key={`${ev.id}-c-${i}`} tone="info">
                                    {String(c)}
                                  </Chip>
                                ))}
                              </div>
                            ) : null}

                            {metaNote ? (
                              <div className="mt-3 text-[13px] font-semibold text-slate-700 whitespace-pre-wrap leading-relaxed">
                                <span className="font-black text-slate-700">Note:</span> {metaNote}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}

                    {(selectedOrder.events || []).length === 0 ? (
                      <div className="text-[15px] text-slate-600">No events logged yet.</div>
                    ) : null}
                  </div>

                  {canManageOrders ? (
                    <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add internal note…"
                        className="flex-1 rounded-[26px] border border-slate-200 bg-white px-6 py-[18px] text-[16px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                      />
                      <Button
                        variant="primary"
                        size="xxl"
                        className="min-w-[260px]"
                        disabled={isBusy || noteBusy || !noteText.trim() || !selectedId}
                        onClick={() => runAddNote("NOTE", null, "Note")}
                      >
                        {noteBusy ? "Adding…" : "Add note"}
                      </Button>
                    </div>
                  ) : null}

                  {actionReportAnchor === "notes" ? (
                    <ActionStatusLine
                      report={actionReport}
                      onClear={() => {
                        setActionReport(null);
                        setActionReportAnchor("");
                      }}
                    />
                  ) : null}
                </div>
              </>
            ) : null}
          </Card>
        </div>

        {/* ===== Reject Modal via Portal (always visible) ===== */}
        {canUseDOM && RejectModal ? createPortal(RejectModal, document.body) : null}
      </div>
    </div>
  );
}
