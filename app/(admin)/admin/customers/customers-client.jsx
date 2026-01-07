// FILE: app/(admin)/admin/customers/customers-client.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* Brand tokens */
const NAVY = "#0F2147";
const NAVY_2 = "#183A7B";
const GOLD = "#D4AF37";
const MUTED = "#6B7280";
const BORDER = "rgba(15,33,71,0.14)";
const BG = "#F6F7FB";

const NEW_ADDRESS_ID = "__new__";

function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}
function safeText(v, fb = "—") {
  const s = String(v ?? "").trim();
  return s ? s : fb;
}
function hasText(v) {
  return !!String(v ?? "").trim();
}
function normId(v) {
  return String(v ?? "").trim();
}
function fmtDT(v) {
  try {
    if (!v) return "—";
    const d = new Date(v);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}
function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function clampNum(v, min, max, fallback = 0) {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}
function moneyBDT(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "BDT",
      maximumFractionDigits: 0,
    }).format(x);
  } catch {
    return `৳${Math.round(x)}`;
  }
}

function shortId(id) {
  const s = String(id || "").trim();
  if (!s) return "—";
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function cleanEmail(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.replace(/\s+/g, "");
}
function cleanPhone(v) {
  // Keep + and digits
  const s = String(v ?? "").trim();
  if (!s) return "";
  const out = s.replace(/[^\d+]/g, "");
  return out;
}
function cleanCountryIso2(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
}

/**
 * Admin-plane networking helpers (admin-only; zero dependency on customer routes).
 *
 * - Calls ONLY /api/admin/* endpoints.
 * - Adds explicit admin-plane headers to help server routes ignore customer cookies.
 * - Warm session + one retry on 401/403 to reduce post-OTP jitter.
 */
let __adminWarmupAt = 0;
async function adminWarmup(signal) {
  const now = Date.now();
  if (now - __adminWarmupAt < 12_000) return;
  __adminWarmupAt = now;

  try {
    const headers = new Headers();
    headers.set("accept", "application/json");
    headers.set("x-tdlc-scope", "admin");
    headers.set("x-tdlc-client", "admin-ui");
    headers.set("x-tdlc-auth-plane", "admin");
    await fetch("/api/admin/session", {
      cache: "no-store",
      credentials: "include",
      headers,
      signal,
    });
  } catch {
    // best-effort only
  }
}

async function readJsonSafe(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function httpErr(res, js) {
  const serverMsg = js?.error || js?.message;
  if (serverMsg) return String(serverMsg);
  if (res?.status === 401) return "unauthorized";
  if (res?.status === 403) return "forbidden";
  if (res?.status) return `HTTP_${res.status}`;
  return "request_failed";
}

async function fetchAdmin(input, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (!headers.has("x-tdlc-scope")) headers.set("x-tdlc-scope", "admin");
  if (!headers.has("x-tdlc-client")) headers.set("x-tdlc-client", "admin-ui");
  if (!headers.has("x-tdlc-auth-plane")) headers.set("x-tdlc-auth-plane", "admin");

  return fetch(input, {
    cache: "no-store",
    credentials: "include",
    ...init,
    headers,
  });
}

async function fetchAdminJSON(input, init = {}) {
  await adminWarmup(init?.signal);

  let res = await fetchAdmin(input, init);
  let js = await readJsonSafe(res);

  if (res.status === 401 || res.status === 403) {
    await adminWarmup(init?.signal);
    res = await fetchAdmin(input, init);
    js = await readJsonSafe(res);
  }

  return { res, js, err: httpErr(res, js) };
}

function formatAddressLine1(a) {
  const l1 = String(a?.line1 ?? "").trim();
  const l2 = String(a?.line2 ?? "").trim();
  if (l1 && l2) return `${l1}, ${l2}`;
  if (l1) return l1;
  if (l2) return l2;
  return "—";
}
function formatAddressLine2(a) {
  const city = String(a?.city ?? "").trim();
  const state = String(a?.state ?? "").trim();
  const country = String(a?.countryIso2 ?? "").trim();
  const postal = String(a?.postalCode ?? "").trim();

  const left = [city, state].filter(Boolean).join(", ");
  const right = [country, postal].filter(Boolean).join(" • ");

  if (left && right) return `${left} • ${right}`;
  if (left) return left;
  if (right) return right;
  return "—";
}

function Pill({ tone = "neutral", children, title }) {
  const style = useMemo(() => {
    const base = {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 900,
      letterSpacing: "0.02em",
      border: `1px solid ${BORDER}`,
      background: "#fff",
      color: NAVY,
      whiteSpace: "nowrap",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
    };
    if (tone === "navy") return { ...base, background: NAVY, borderColor: NAVY, color: "#fff" };
    if (tone === "gold") return { ...base, background: GOLD, borderColor: GOLD, color: NAVY };
    if (tone === "green") return { ...base, background: "#ECFDF5", borderColor: "#A7F3D0", color: "#065F46" };
    if (tone === "yellow") return { ...base, background: "#FFFBEB", borderColor: "#FDE68A", color: "#92400E" };
    if (tone === "red") return { ...base, background: "#FEF2F2", borderColor: "#FECACA", color: "#991B1B" };
    if (tone === "muted") return { ...base, background: "#F8FAFC", borderColor: "rgba(15,33,71,0.10)", color: MUTED };
    return base;
  }, [tone]);

  return (
    <span style={style} title={title}>
      {children}
    </span>
  );
}

function Button({
  variant = "primary",
  size = "md",
  disabled,
  children,
  onClick,
  title,
  style: styleOverride,
  type = "button",
}) {
  const style = useMemo(() => {
    const pad = size === "lg" ? "12px 14px" : size === "sm" ? "8px 10px" : "10px 12px";
    const fs = size === "lg" ? 13 : 12;

    const base = {
      appearance: "none",
      border: `1px solid ${BORDER}`,
      borderRadius: 999,
      padding: pad,
      fontSize: fs,
      fontWeight: 900,
      letterSpacing: "0.02em",
      cursor: disabled ? "not-allowed" : "pointer",
      transition:
        "transform 140ms ease, box-shadow 140ms ease, background 140ms ease, color 140ms ease, border-color 140ms ease",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      userSelect: "none",
      whiteSpace: "nowrap",
      boxShadow: disabled ? "none" : "0 8px 18px rgba(15,33,71,0.10)",
    };

    let v = base;

    if (variant === "primary") {
      v = {
        ...base,
        background: disabled ? "rgba(15,33,71,0.55)" : NAVY,
        color: "#fff",
        borderColor: disabled ? "rgba(15,33,71,0.35)" : NAVY,
      };
    } else if (variant === "accent") {
      v = {
        ...base,
        background: disabled ? "rgba(212,175,55,0.65)" : GOLD,
        color: NAVY,
        borderColor: disabled ? "rgba(212,175,55,0.35)" : GOLD,
      };
    } else if (variant === "ghost") {
      v = {
        ...base,
        background: "#fff",
        color: NAVY,
        borderColor: "rgba(15,33,71,0.18)",
        boxShadow: disabled ? "none" : "0 10px 22px rgba(15,33,71,0.06)",
      };
    } else if (variant === "danger") {
      v = {
        ...base,
        background: disabled ? "rgba(185,28,28,0.55)" : "#B91C1C",
        color: "#fff",
        borderColor: disabled ? "rgba(185,28,28,0.35)" : "#B91C1C",
      };
    }

    return styleOverride ? { ...v, ...styleOverride } : v;
  }, [variant, size, disabled, styleOverride]);

  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={style}
      onMouseDown={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(0px)";
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.boxShadow = "0 14px 30px rgba(15,33,71,0.14)";
        if (variant === "primary") e.currentTarget.style.background = NAVY_2;
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.boxShadow = "0 8px 18px rgba(15,33,71,0.10)";
        if (variant === "primary") e.currentTarget.style.background = NAVY;
        e.currentTarget.style.transform = "translateY(0px)";
      }}
    >
      {children}
    </button>
  );
}

function MiniAction({ label, onClick, disabled, title }) {
  return (
    <button
      type="button"
      title={title || label}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        appearance: "none",
        border: `1px solid rgba(15,33,71,0.18)`,
        borderRadius: 999,
        padding: "6px 10px",
        fontSize: 11,
        fontWeight: 950,
        letterSpacing: "0.02em",
        background: disabled ? "rgba(255,255,255,0.8)" : "#fff",
        color: disabled ? "rgba(15,33,71,0.45)" : NAVY,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : "0 10px 22px rgba(15,33,71,0.06)",
        transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease",
        whiteSpace: "nowrap",
      }}
      onMouseDown={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(1px)";
      }}
      onMouseUp={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(0px)";
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.boxShadow = "0 14px 30px rgba(15,33,71,0.10)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.boxShadow = "0 10px 22px rgba(15,33,71,0.06)";
        e.currentTarget.style.transform = "translateY(0px)";
      }}
    >
      {label}
    </button>
  );
}

function SectionCard({ title, subtitle, right, children }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 18,
        boxShadow: "0 14px 34px rgba(15,33,71,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 14px 10px",
          borderBottom: `1px solid rgba(15,33,71,0.10)`,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 950, color: NAVY, letterSpacing: "0.01em" }}>{title}</div>
          {subtitle ? <div style={{ marginTop: 4, fontSize: 12, color: MUTED, lineHeight: 1.35 }}>{subtitle}</div> : null}
        </div>
        {right ? <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{right}</div> : null}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function KPI({ label, value, hint, tone = "navy" }) {
  return (
    <div
      style={{
        border: `1px solid rgba(15,33,71,0.12)`,
        borderRadius: 16,
        background: "#fff",
        padding: 12,
        boxShadow: "0 10px 26px rgba(15,33,71,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontSize: 12, color: MUTED, fontWeight: 800 }}>{label}</div>
        <Pill tone={tone}>{value}</Pill>
      </div>
      {hint ? <div style={{ marginTop: 8, fontSize: 12, color: MUTED }}>{hint}</div> : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, disabled, inputMode, type = "text" }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        type={type}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 14,
          border: `1px solid rgba(15,33,71,0.16)`,
          fontSize: 13,
          fontWeight: 900,
          color: NAVY,
          background: disabled ? "rgba(248,250,252,0.7)" : "#fff",
          outline: "none",
        }}
      />
    </div>
  );
}

const TABS = [
  { k: "overview", label: "Overview" },
  { k: "addresses", label: "Addresses" },
  { k: "orders", label: "Orders" },
  { k: "wallet", label: "Wallet" },
  { k: "points", label: "Points" },
  { k: "notes", label: "Notes" },
  { k: "risk", label: "Risk & Audit" },
];

const TAG_PRESETS = [
  { k: "VERIFIED", tone: "green" },
  { k: "SAFE", tone: "navy" },
  { k: "WATCHLIST", tone: "yellow" },
  { k: "RISKY", tone: "red" },
  { k: "FRAUD", tone: "red" },
  { k: "FRAUD_SUSPECT", tone: "red" },
  { k: "SUSPICIOUS_ORDERING", tone: "yellow" },
  { k: "COD_NON_PAYER", tone: "red" },
  { k: "FREQUENT_CANCELLER", tone: "yellow" },
  { k: "RETURN_ABUSE", tone: "yellow" },
  { k: "ADDRESS_MISMATCH", tone: "yellow" },
  { k: "MISBEHAVED", tone: "red" },
  { k: "CONTENTIOUS", tone: "yellow" },
];

// -------- Image URL extraction (DB snapshots only; no guessing) --------
function looksLikeUrl(s) {
  const v = String(s || "").trim();
  if (!v) return false;
  return /^https?:\/\//i.test(v);
}
function looksLikeImageUrl(s) {
  const v = String(s || "").trim();
  if (!looksLikeUrl(v)) return false;
  const base = v.split("?")[0].toLowerCase();
  return base.endsWith(".jpg") || base.endsWith(".jpeg") || base.endsWith(".png") || base.endsWith(".webp") || base.endsWith(".gif");
}
function collectImageUrlsFromUnknown(input, maxDepth = 4, maxFound = 8) {
  const out = [];
  const seen = new WeakSet();

  function walk(x, depth) {
    if (out.length >= maxFound) return;
    if (depth > maxDepth) return;

    if (typeof x === "string") {
      if (looksLikeImageUrl(x) && !out.includes(x)) out.push(x);
      return;
    }
    if (!x || typeof x !== "object") return;

    if (seen.has(x)) return;
    seen.add(x);

    if (Array.isArray(x)) {
      for (const it of x) walk(it, depth + 1);
      return;
    }

    for (const k of Object.keys(x)) {
      if (out.length >= maxFound) break;
      walk(x[k], depth + 1);
    }
  }

  walk(input, 0);
  return out;
}

function itemTitle(bundle) {
  const it = bundle?.item || bundle;
  const v = bundle?.variant || null;
  const p = bundle?.product || null;

  const parts = [];

  const pn =
    (typeof p?.name === "string" && p.name.trim()) ||
    (typeof v?.name === "string" && v.name.trim()) ||
    (typeof it?.name === "string" && it.name.trim()) ||
    "";

  if (pn) parts.push(pn);

  const sku = (typeof v?.sku === "string" && v.sku.trim()) || (typeof it?.sku === "string" && it.sku.trim()) || "";
  if (sku) parts.push(`SKU: ${sku}`);

  const size = (typeof v?.size === "string" && v.size.trim()) || (typeof it?.size === "string" && it.size.trim()) || "";
  const color = (typeof v?.color === "string" && v.color.trim()) || (typeof it?.color === "string" && it.color.trim()) || "";
  const opt = [color, size].filter(Boolean).join(" • ");
  if (opt) parts.push(opt);

  return parts.join(" — ") || "Item";
}

/**
 * Cache for faster paint (admin-only UI)
 */
const CACHE_KEY_LIST = "tdlc_admin_customers_dir_v2";
const CACHE_KEY_SUMMARY = "tdlc_admin_customers_summary_v2";

function safeGetSessionJSON(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function safeSetSessionJSON(key, val) {
  try {
    sessionStorage.setItem(key, JSON.stringify(val));
  } catch {
    // ignore
  }
}
function pickFirst(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
function extractTotalFromPayload(js) {
  const fromSummary = js?.summary?.total;
  if (Number.isFinite(Number(fromSummary))) return Number(fromSummary);

  const top = pickFirst(js, ["total", "count"]);
  if (Number.isFinite(Number(top))) return Number(top);

  const meta = js?.pagination || js?.meta || js?.pageInfo || {};
  const fromMeta = pickFirst(meta, ["total", "count"]);
  if (Number.isFinite(Number(fromMeta))) return Number(fromMeta);

  return null;
}
function extractPaging(js) {
  const meta = js?.pagination || js?.meta || js?.pageInfo || {};
  const nextCursor =
    pickFirst(js, ["nextCursor", "cursorNext"]) ??
    pickFirst(meta, ["nextCursor", "cursorNext"]) ??
    pickFirst(js, ["cursor"])?.next ??
    pickFirst(meta, ["cursor"])?.next;

  const nextPage = pickFirst(js, ["nextPage"]) ?? pickFirst(meta, ["nextPage"]);
  const page = pickFirst(js, ["page"]) ?? pickFirst(meta, ["page"]);
  const totalPages = pickFirst(js, ["totalPages"]) ?? pickFirst(meta, ["totalPages"]);
  const hasMore = Boolean(pickFirst(js, ["hasMore"]) ?? pickFirst(meta, ["hasMore"]) ?? nextCursor);

  return {
    nextCursor: nextCursor ? String(nextCursor) : null,
    nextPage: Number.isFinite(Number(nextPage)) ? Number(nextPage) : null,
    page: Number.isFinite(Number(page)) ? Number(page) : null,
    totalPages: Number.isFinite(Number(totalPages)) ? Number(totalPages) : null,
    hasMore,
  };
}
function extractItemsFromPayload(js) {
  // tolerant to API shape differences (no feature deletion; just robust reading)
  const candidates = [
    js?.items,
    js?.customers,
    js?.users,
    js?.data,
    js?.result?.items,
    js?.result?.customers,
    js?.result?.users,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}
function extractCustomerFromPayload(js) {
  return js?.customer || js?.user || js?.data || js?.result?.customer || js?.result?.user || null;
}

function makeEmptyAddressDraft() {
  return {
    type: "HOME",
    isDefault: false,
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    countryIso2: "BD",
    phone: "",
  };
}

export default function CustomersClient({ initialSelectedId = "" }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [banner, setBanner] = useState(null);

  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all"); // all | customers | staff
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, new7d: 0 });

  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("overview");

  const [hoverId, setHoverId] = useState("");
  const [copyToast, setCopyToast] = useState(null);
  const copyTimerRef = useRef(null);

  const [expandedOrders, setExpandedOrders] = useState(() => new Set());

  const listAbortRef = useRef(null);
  const detailAbortRef = useRef(null);

  const searchRef = useRef(null);
  const dirScrollerRef = useRef(null);
  const rowRefs = useRef(new Map()); // id -> element

  const requestedSelectedIdRef = useRef(normId(initialSelectedId));

  // --- Editable states (admin/staff) ---
  const [editIdentity, setEditIdentity] = useState(false);
  const [identityDraft, setIdentityDraft] = useState({ name: "", email: "", phone: "" });

  const [editingAddressId, setEditingAddressId] = useState("");
  const [addressDraft, setAddressDraft] = useState(makeEmptyAddressDraft());

  const [walletDraft, setWalletDraft] = useState({ mode: "credit", amount: "", reason: "" });

  useEffect(() => {
    const cachedItems = safeGetSessionJSON(CACHE_KEY_LIST);
    const cachedSummary = safeGetSessionJSON(CACHE_KEY_SUMMARY);
    if (Array.isArray(cachedItems) && cachedItems.length) setItems(cachedItems);
    if (cachedSummary && typeof cachedSummary === "object") setSummary(cachedSummary);
  }, []);

  useEffect(() => {
    return () => {
      try {
        listAbortRef.current?.abort?.();
      } catch {}
      try {
        detailAbortRef.current?.abort?.();
      } catch {}
      try {
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      } catch {}
    };
  }, []);

  useEffect(() => {
    const id = normId(initialSelectedId);
    if (!id) return;
    requestedSelectedIdRef.current = id;
    setSelectedId(id);
  }, [initialSelectedId]);

  async function loadList() {
    setErr("");
    setLoading(true);
    setBanner(null);

    try {
      listAbortRef.current?.abort?.();
      const ac = new AbortController();
      listAbortRef.current = ac;

      const PAGE_SIZE = 500;
      const MAX_PAGES = 120; // raised: safer for "load all" when server clamps page size
      const HARD_MAX_ITEMS = 50000;

      const baseUrl = new URL("/api/admin/customers", window.location.origin);
      if (q.trim()) baseUrl.searchParams.set("q", q.trim());
      baseUrl.searchParams.set("scope", scope);
      baseUrl.searchParams.set("mode", "directory");

      function buildUrl({ cursor, page, skip }) {
        const u = new URL(baseUrl.toString());
        const t = String(PAGE_SIZE);
        u.searchParams.set("take", t);
        u.searchParams.set("limit", t);
        u.searchParams.set("pageSize", t);
        if (cursor) u.searchParams.set("cursor", String(cursor));
        if (Number.isFinite(page)) u.searchParams.set("page", String(page));
        if (Number.isFinite(skip)) u.searchParams.set("skip", String(skip));
        return u;
      }

      const acc = [];
      const seen = new Set();

      let cursor = null;
      let page = 1;
      let skip = 0;

      let totalExpected = null;
      let lastLen = 0;
      let noProgress = 0;

      for (let i = 0; i < MAX_PAGES; i++) {
        if (ac.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });

        const u = buildUrl({ cursor, page, skip });
        const { res, js } = await fetchAdminJSON(u.toString(), { signal: ac.signal });

        if (!res.ok || !js?.ok) throw new Error(js?.error || `HTTP_${res.status}`);

        if (i === 0) {
          const s = js.summary || { total: 0, new7d: 0 };
          setSummary(s);
          safeSetSessionJSON(CACHE_KEY_SUMMARY, s);

          const maybeTotal = extractTotalFromPayload(js);
          if (maybeTotal != null) totalExpected = maybeTotal;
        }

        const pageItems = extractItemsFromPayload(js);

        for (const it of pageItems) {
          const id = it?.id;
          if (!id) continue;
          if (seen.has(id)) continue;
          seen.add(id);
          acc.push(it);
        }

        setItems(acc.slice(0));
        safeSetSessionJSON(CACHE_KEY_LIST, acc.slice(0));

        // stop only on hard evidence:
        if (!pageItems.length) break;
        if (acc.length >= HARD_MAX_ITEMS) break;
        if (totalExpected != null && acc.length >= totalExpected) break;

        // detect being stuck (server repeating same page)
        if (acc.length === lastLen) noProgress += 1;
        else noProgress = 0;

        lastLen = acc.length;
        if (noProgress >= 2) break;

        const paging = extractPaging(js);

        if (paging.nextCursor) {
          cursor = paging.nextCursor;
        } else if (paging.nextPage != null) {
          page = paging.nextPage;
          skip = 0;
        } else if (paging.page != null && paging.totalPages != null) {
          if (paging.page >= paging.totalPages) break;
          page = paging.page + 1;
          skip = 0;
        } else {
          // fallback: attempt skip-based pagination even if the server clamps the take size
          skip += pageItems.length;
          page += 1;
        }
      }

      const desired = normId(requestedSelectedIdRef.current);
      setSelectedId((prev) => {
        const p = normId(prev);
        if (desired) return desired;
        if (p && acc.some((x) => x.id === p)) return p;
        return acc[0]?.id || "";
      });

      if (totalExpected != null && acc.length < totalExpected) {
        setBanner({
          tone: "error",
          msg: `Directory loaded ${acc.length} of ${totalExpected}. Your /api/admin/customers route is still limiting results. Ensure it supports cursor/page/skip+take pagination or increases its default take.`,
        });
      }
    } catch (e) {
      if (String(e?.name) === "AbortError") return;
      setErr(String(e?.message || e || "Failed to load customers."));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) return;
    setErr("");
    setDetail(null);

    try {
      detailAbortRef.current?.abort?.();
      const ac = new AbortController();
      detailAbortRef.current = ac;

      const url = new URL(`/api/admin/customers/${encodeURIComponent(id)}`, window.location.origin);
      url.searchParams.set("ordersTake", "5000");
      url.searchParams.set("addressesTake", "20000");

      const { res, js } = await fetchAdminJSON(url.toString(), { signal: ac.signal });
      if (!res.ok || !js?.ok) throw new Error(js?.error || `HTTP_${res.status}`);

      const payload = extractCustomerFromPayload(js);
      setDetail(payload);
      setExpandedOrders(new Set());

      // sync editable drafts
      setEditIdentity(false);
      setIdentityDraft({
        name: safeText(payload?.name, ""),
        email: safeText(payload?.email, ""),
        phone: safeText(payload?.phone, ""),
      });

      setEditingAddressId("");
      setAddressDraft(makeEmptyAddressDraft());

      setWalletDraft({ mode: "credit", amount: "", reason: "" });
    } catch (e) {
      if (String(e?.name) === "AbortError") return;
      setErr(String(e?.message || e || "Failed to load customer detail."));
    }
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    const t = setTimeout(() => loadList(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    loadDetail(selectedId);

    const el = rowRefs.current.get(selectedId);
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "nearest" });
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selected = useMemo(() => {
    if (!selectedId) return null;
    const fromList = items.find((x) => x.id === selectedId) || null;
    if (fromList) return fromList;
    if (detail && String(detail?.id || "") === String(selectedId)) return detail;
    return null;
  }, [items, selectedId, detail]);

  async function patchCustomer(id, body) {
    setBusy(true);
    setBanner(null);
    try {
      const { res, js } = await fetchAdminJSON(`/api/admin/customers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok || !js?.ok) throw new Error(js?.error || `HTTP_${res.status}`);

      setBanner({ tone: "success", msg: js?.message || "Saved." });

      await Promise.all([loadDetail(id), loadList()]);
      return { ok: true, js };
    } catch (e) {
      const msg = String(e?.message || e || "Failed.");
      setBanner({ tone: "error", msg });
      return { ok: false, error: msg };
    } finally {
      setBusy(false);
    }
  }

  function riskTone(level) {
    const L = String(level || "").toUpperCase();
    if (L === "HIGH") return "red";
    if (L === "MEDIUM") return "yellow";
    return "green";
  }

  async function copyToClipboard(text, msg, id) {
    const v = String(text ?? "").trim();
    if (!v) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(v);
      } else {
        const ta = document.createElement("textarea");
        ta.value = v;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      setCopyToast({ id, msg, at: Date.now() });
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyToast(null), 1200);
    } catch {
      setCopyToast({ id, msg: "Copy failed", at: Date.now() });
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyToast(null), 1200);
    }
  }

  function handleDirectoryKeyDown(e) {
    if (!items.length) return;

    const key = e.key;

    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "k") {
      e.preventDefault();
      searchRef.current?.focus?.();
      return;
    }
    if (key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      searchRef.current?.focus?.();
      return;
    }
    if (key === "Escape") {
      e.preventDefault();
      searchRef.current?.focus?.();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && key.toLowerCase() === "r") {
      e.preventDefault();
      loadList();
      return;
    }
    if (key === "Enter") {
      e.preventDefault();
      if (!selectedId && items[0]?.id) setSelectedId(items[0].id);
      return;
    }

    const curIdx = Math.max(0, items.findIndex((x) => x.id === selectedId));
    let nextIdx = curIdx;

    if (key === "ArrowDown") nextIdx = Math.min(items.length - 1, curIdx + 1);
    else if (key === "ArrowUp") nextIdx = Math.max(0, curIdx - 1);
    else if (key === "Home") nextIdx = 0;
    else if (key === "End") nextIdx = items.length - 1;
    else return;

    e.preventDefault();
    const nextId = items[nextIdx]?.id;
    if (nextId && nextId !== selectedId) setSelectedId(nextId);
  }

  function toggleOrderExpand(orderId) {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function startEditAddress(a) {
    setEditingAddressId(String(a?.id || ""));
    setAddressDraft({
      type: safeText(a?.type, "HOME"),
      isDefault: Boolean(a?.isDefault),
      line1: safeText(a?.line1, ""),
      line2: safeText(a?.line2, ""),
      city: safeText(a?.city, ""),
      state: safeText(a?.state, ""),
      postalCode: safeText(a?.postalCode, ""),
      countryIso2: safeText(a?.countryIso2, "BD"),
      phone: safeText(a?.phone, ""),
    });
  }

  function startAddAddress() {
    setEditingAddressId(NEW_ADDRESS_ID);
    setAddressDraft(makeEmptyAddressDraft());
  }

  function cancelAddressEdit() {
    setEditingAddressId("");
    setAddressDraft(makeEmptyAddressDraft());
  }

  function normalizedAddressPayloadFromDraft(d) {
    const type = String(d?.type || "").trim() || "HOME";
    const countryIso2 = cleanCountryIso2(d?.countryIso2) || "BD";
    const phone = cleanPhone(d?.phone);

    return {
      type,
      isDefault: Boolean(d?.isDefault),
      line1: String(d?.line1 || "").trim() || null,
      line2: String(d?.line2 || "").trim() || null,
      city: String(d?.city || "").trim() || null,
      state: String(d?.state || "").trim() || null,
      postalCode: String(d?.postalCode || "").trim() || null,
      countryIso2,
      phone: phone || null,
    };
  }

  function validateAddressDraft(d) {
    const line1 = String(d?.line1 || "").trim();
    const line2 = String(d?.line2 || "").trim();
    const city = String(d?.city || "").trim();
    const country = cleanCountryIso2(d?.countryIso2) || "BD";

    // Minimal safety validation (does not block optional fields)
    if (!line1 && !line2) return "Address line is required (Line 1 or Line 2).";
    if (!city) return "City is required.";
    if (!country || country.length !== 2) return "Country must be a 2-letter ISO code (e.g., BD).";
    return "";
  }

  async function saveAddressEdit(userId) {
    if (!editingAddressId || editingAddressId === NEW_ADDRESS_ID) return;

    const payload = {
      action: {
        updateAddress: {
          addressId: editingAddressId,
          ...normalizedAddressPayloadFromDraft(addressDraft),
        },
      },
    };

    await patchCustomer(userId, payload);
    cancelAddressEdit();
  }

  async function createAddress(userId) {
    if (editingAddressId !== NEW_ADDRESS_ID) return;

    const validation = validateAddressDraft(addressDraft);
    if (validation) {
      setBanner({ tone: "error", msg: validation });
      return;
    }

    setBusy(true);
    setBanner(null);

    const body = normalizedAddressPayloadFromDraft(addressDraft);

    // Prefer the dedicated route: /api/admin/customers/[id]/addresses
    try {
      const { res, js } = await fetchAdminJSON(`/api/admin/customers/${encodeURIComponent(userId)}/addresses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok && js?.ok) {
        setBanner({ tone: "success", msg: js?.message || "Address added." });
        cancelAddressEdit();
        await Promise.all([loadDetail(userId), loadList()]);
        return;
      }

      // If route is missing/unimplemented, fall back to PATCH action-based addAddress
      const status = res?.status;
      const isMissing = status === 404 || status === 405;
      if (!isMissing) {
        throw new Error(js?.error || `HTTP_${status}`);
      }
    } catch (e) {
      // fallthrough to PATCH fallback
    } finally {
      setBusy(false);
    }

    // Fallback: PATCH /api/admin/customers/:id  { action: { addAddress: ... } }
    const fallbackPayload = {
      action: {
        addAddress: body,
      },
    };
    const r = await patchCustomer(userId, fallbackPayload);
    if (r.ok) cancelAddressEdit();
  }

  async function setDefaultAddress(userId, addressId) {
    const payload = {
      action: {
        setDefaultAddress: { addressId: String(addressId) },
      },
    };
    await patchCustomer(userId, payload);
  }

  async function archiveAddress(userId, addressId) {
    const payload = {
      action: {
        archiveAddress: { addressId: String(addressId) },
      },
    };
    await patchCustomer(userId, payload);
  }

  async function restoreAddress(userId, addressId) {
    const payload = {
      action: {
        restoreAddress: { addressId: String(addressId) },
      },
    };
    await patchCustomer(userId, payload);
  }

  async function saveIdentity(userId) {
    const payload = {
      identity: {
        name: identityDraft.name || null,
        email: cleanEmail(identityDraft.email) || null,
        phone: cleanPhone(identityDraft.phone) || null,
      },
    };
    await patchCustomer(userId, payload);
    setEditIdentity(false);
  }

  async function adjustWallet(userId) {
    const amt = clampNum(walletDraft.amount, 0, 999999999, 0);
    if (!amt) {
      setBanner({ tone: "error", msg: "Enter a valid wallet amount." });
      return;
    }
    const delta = walletDraft.mode === "debit" ? -Math.abs(amt) : Math.abs(amt);

    const payload = {
      action: {
        walletAdjust: {
          delta,
          reason: String(walletDraft.reason || "").trim() || null,
        },
      },
    };
    await patchCustomer(userId, payload);
    setWalletDraft({ mode: "credit", amount: "", reason: "" });
  }

  const pageStyle = {
    minHeight: "calc(100vh - 120px)",
    background: BG,
    padding: 16,
  };

  const shellStyle = {
    maxWidth: "100%",
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "minmax(480px, 560px) 1fr",
    gap: 14,
    alignItems: "start",
  };

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: "100%", margin: "0 auto", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 1000, color: NAVY, letterSpacing: "-0.02em" }}>Customers</div>
            <div style={{ marginTop: 4, fontSize: 12, color: MUTED, lineHeight: 1.35 }}>
              Clean CRM cockpit: list + detail, addresses, wallet, points, risk flags, suspicious behavior signals and audit — all DB-backed.
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Pill tone="navy">Total: {n(summary.total)}</Pill>
              <Pill tone="muted">New (7d): {n(summary.new7d)}</Pill>
              {loading ? <Pill tone="muted">Loading…</Pill> : <Pill tone="gold">{n(items.length)} loaded</Pill>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              variant="ghost"
              onClick={() => {
                setQ("");
                setScope("all");
                setTab("overview");
                requestedSelectedIdRef.current = "";
                setSelectedId("");
                setDetail(null);
                loadList();
              }}
            >
              Reset
            </Button>
            <Button variant="primary" onClick={() => loadList()}>
              Refresh
            </Button>
          </div>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 12,
              border: "1px solid rgba(185,28,28,0.25)",
              background: "#FEF2F2",
              color: "#991B1B",
              fontWeight: 900,
              borderRadius: 14,
              padding: 12,
            }}
          >
            {err}
          </div>
        ) : null}

        {banner ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 14,
              padding: 12,
              fontWeight: 950,
              border: `1px solid ${banner.tone === "success" ? "rgba(16,185,129,0.35)" : "rgba(185,28,28,0.30)"}`,
              background: banner.tone === "success" ? "#ECFDF5" : "#FEF2F2",
              color: banner.tone === "success" ? "#065F46" : "#991B1B",
            }}
          >
            {banner.msg}
          </div>
        ) : null}
      </div>

      <div style={shellStyle}>
        {/* LEFT: Directory */}
        <div>
          <SectionCard
            title="Directory"
            subtitle="Search, quick risk labeling, and fast open."
            right={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill tone="muted">{String(scope).toUpperCase()}</Pill>
              </div>
            }
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name / email / phone / customer code…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "12px 12px",
                    borderRadius: 14,
                    border: `1px solid ${BORDER}`,
                    outline: "none",
                    fontSize: 13,
                    color: NAVY,
                    fontWeight: 800,
                    background: "#fff",
                  }}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant={scope === "all" ? "primary" : "ghost"} size="sm" onClick={() => setScope("all")}>
                    All
                  </Button>
                  <Button variant={scope === "customers" ? "primary" : "ghost"} size="sm" onClick={() => setScope("customers")}>
                    Customers
                  </Button>
                  <Button variant={scope === "staff" ? "primary" : "ghost"} size="sm" onClick={() => setScope("staff")}>
                    Staff-linked
                  </Button>
                </div>
              </div>

              <div
                style={{
                  border: `1px solid rgba(15,33,71,0.12)`,
                  borderRadius: 16,
                  overflow: "hidden",
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    background: "#fff",
                    padding: "10px 12px",
                    borderBottom: `1px solid rgba(15,33,71,0.10)`,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    boxShadow: "0 8px 18px rgba(15,33,71,0.03)",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 950,
                      color: NAVY,
                      fontSize: 12,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    Customers
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, fontWeight: 800 }}>{items.length} shown</div>
                </div>

                <div
                  ref={dirScrollerRef}
                  tabIndex={0}
                  onKeyDown={handleDirectoryKeyDown}
                  role="listbox"
                  aria-label="Customer directory"
                  style={{
                    maxHeight: "68vh",
                    overflowY: "auto",
                    overflowX: "hidden",
                    outline: "none",
                  }}
                >
                  {items.length ? (
                    items.map((u, idx) => {
                      const active = u.id === selectedId;

                      const sys = u?.risk?.system || {};
                      const manual = u?.risk?.manual || {};

                      const sysLevel = String(sys.level || "LOW").toUpperCase();
                      const manualLevel = manual?.level ? String(manual.level).toUpperCase() : "";

                      const name = safeText(u.name, "Unnamed");
                      const code = safeText(u.customerCode, "—");
                      const email = safeText(u.email, "—");
                      const phone = safeText(u.phone, "—");
                      const kind = safeText(u.kind, "—");
                      const uidShort = shortId(u.id);

                      const chipTone =
                        manualLevel === "HIGH" || sysLevel === "HIGH"
                          ? "red"
                          : manualLevel === "MEDIUM" || sysLevel === "MEDIUM"
                          ? "yellow"
                          : "green";

                      const showActions = hoverId === u.id || active;
                      const toastHere = copyToast?.id === u.id ? copyToast : null;

                      const activeAddr = n(u.counts?.addresses);
                      const totalAddr = n(u.counts?.addressesTotal);

                      const serial = idx + 1;
                      const serialText = `#${String(serial).padStart(4, "0")}`;

                      const isActive = u?.isActive !== false;
                      const staffLinked = Boolean(u?.staffId || u?.staffLinked || u?.counts?.staffLinked);

                      const identityLine = [
                        `Name: ${safeText(u.name, "Unnamed")}`,
                        `Code: ${safeText(u.customerCode, "—")}`,
                        `Phone: ${safeText(u.phone, "—")}`,
                        `Email: ${safeText(u.email, "—")}`,
                        `ID: ${safeText(u.id, "—")}`,
                      ].join(" | ");

                      return (
                        <div
                          key={u.id}
                          ref={(el) => {
                            if (el) rowRefs.current.set(u.id, el);
                            else rowRefs.current.delete(u.id);
                          }}
                          role="option"
                          aria-selected={active ? "true" : "false"}
                          onClick={() => setSelectedId(u.id)}
                          onMouseEnter={() => setHoverId(u.id)}
                          onMouseLeave={() => setHoverId((prev) => (prev === u.id ? "" : prev))}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: active ? "rgba(212,175,55,0.10)" : "#fff",
                            cursor: "pointer",
                            padding: 12,
                            borderBottom: `1px solid rgba(15,33,71,0.08)`,
                            display: "grid",
                            gap: 10,
                            overflow: "hidden",
                            contentVisibility: "auto",
                            containIntrinsicSize: "1000px 210px",
                          }}
                        >
                          {/* Row 1: header */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "flex-start",
                              minWidth: 0,
                            }}
                          >
                            <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 12,
                                  background: NAVY,
                                  color: "#fff",
                                  fontWeight: 1000,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  boxShadow: "0 10px 22px rgba(15,33,71,0.18)",
                                  flex: "0 0 auto",
                                }}
                                title={`S/N ${serialText}`}
                              >
                                {String(name[0] || "C").toUpperCase()}
                              </div>

                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontWeight: 1100,
                                    color: NAVY,
                                    fontSize: 13,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={name}
                                >
                                  {name}
                                </div>
                                <div style={{ marginTop: 4, fontSize: 12, color: MUTED, fontWeight: 850 }}>
                                  Last order: {fmtDT(u.lastOrderAt)}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>
                              <Pill tone={chipTone} title={`${manualLevel || sysLevel} ${manualLevel ? "(manual)" : "(system)"}`}>
                                {manualLevel || sysLevel}
                                {manualLevel ? " (manual)" : " (system)"}
                              </Pill>
                            </div>
                          </div>

                          {/* Row 2: identity (horizontal) */}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
                            <Pill tone="muted" title="Serial number in current directory list">
                              {serialText}
                            </Pill>
                            <Pill tone="gold" title="Customer Code">
                              {code}
                            </Pill>
                            <Pill tone="muted" title="Kind">
                              {kind}
                            </Pill>
                            <Pill tone={isActive ? "green" : "red"} title="Account status">
                              {isActive ? "Active" : "Disabled"}
                            </Pill>
                            {staffLinked ? (
                              <Pill tone="navy" title="This user is linked to staff/admin records">
                                Staff-linked
                              </Pill>
                            ) : null}
                          </div>

                          {/* Row 3: contact (horizontal) */}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
                            <Pill tone="muted" title="Phone">
                              {phone}
                            </Pill>
                            <Pill tone="muted" title="Email">
                              {email}
                            </Pill>
                            <Pill tone="muted" title={`User ID: ${safeText(u.id, "—")}`}>
                              ID: {uidShort}
                            </Pill>
                          </div>

                          {/* Row 4: stats left, actions right (fixed to bottom) */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "center",
                              flexWrap: "wrap",
                              borderTop: "1px dashed rgba(15,33,71,0.12)",
                              paddingTop: 10,
                              marginTop: 2,
                            }}
                          >
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
                              <Pill tone="muted">{n(u.counts?.orders)} orders</Pill>
                              <Pill
                                tone="muted"
                                title={totalAddr !== activeAddr ? `Active ${activeAddr}, Total ${totalAddr}` : `Active ${activeAddr}`}
                              >
                                {activeAddr} addr{totalAddr !== activeAddr ? ` • all ${totalAddr}` : ""}
                              </Pill>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                                flexWrap: "wrap",
                                justifyContent: "flex-end",
                                opacity: showActions ? 1 : 0,
                                transform: showActions ? "translateY(0px)" : "translateY(2px)",
                                pointerEvents: showActions ? "auto" : "none",
                                transition: "opacity 140ms ease, transform 140ms ease",
                              }}
                            >
                              <MiniAction
                                label="Copy identity"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(identityLine, "Identity copied", u.id);
                                }}
                                title="Copies name + code + phone + email + id"
                              />
                              <MiniAction
                                label="Copy phone"
                                disabled={!hasText(u.phone)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(u.phone, "Phone copied", u.id);
                                }}
                              />
                              <MiniAction
                                label="Copy email"
                                disabled={!hasText(u.email)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(u.email, "Email copied", u.id);
                                }}
                              />
                              <MiniAction
                                label="Copy code"
                                disabled={!hasText(u.customerCode)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(u.customerCode, "Code copied", u.id);
                                }}
                              />
                              <MiniAction
                                label="Copy ID"
                                disabled={!hasText(u.id)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  copyToClipboard(u.id, "User ID copied", u.id);
                                }}
                              />
                              {toastHere ? <Pill tone="green">{toastHere.msg}</Pill> : null}
                            </div>
                          </div>

                          {(sys.flags?.length || manual.tags?.length) ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                              {(manual.tags || []).slice(0, 3).map((t) => (
                                <Pill key={`m_${t}`} tone="navy" title={t}>
                                  {t}
                                </Pill>
                              ))}
                              {(sys.flags || [])
                                .filter((t) => !(manual.tags || []).includes(t))
                                .slice(0, 2)
                                .map((t) => (
                                  <Pill key={`s_${t}`} tone="muted" title={t}>
                                    {t}
                                  </Pill>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: 14, fontSize: 13, color: MUTED, fontWeight: 800 }}>
                      No customers matched this search.
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    borderTop: "1px solid rgba(15,33,71,0.08)",
                    background: "#fff",
                    color: MUTED,
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  Keyboard: ↑/↓ navigate, Home/End jump, Enter open, Esc or “/” focus search • Ctrl/Cmd+K search • R refresh
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* RIGHT: Detail */}
        <div>
          <SectionCard
            title="Customer cockpit"
            subtitle="Operational + risk view. System risk is computed from real orders/returns/fraud signals. Manual flags are saved in DB."
            right={
              selected ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill tone={selected?.isActive !== false ? "green" : "red"}>{selected?.isActive !== false ? "Active" : "Disabled"}</Pill>
                  <Pill tone="muted">Login: {safeText(selected?.loginPreference, "—")}</Pill>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTab("risk");
                      setTimeout(() => {
                        const el = document.getElementById("crm-risk-anchor");
                        el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                      }, 20);
                    }}
                  >
                    Risk
                  </Button>
                </div>
              ) : null
            }
          >
            {!selectedId ? (
              <div style={{ padding: 12, color: MUTED, fontWeight: 850 }}>Select a customer from the directory.</div>
            ) : !detail ? (
              <div style={{ padding: 12, color: MUTED, fontWeight: 850 }}>Loading customer…</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    borderRadius: 18,
                    border: `1px solid rgba(15,33,71,0.12)`,
                    background: "linear-gradient(180deg, rgba(15,33,71,0.04), rgba(255,255,255,1))",
                    padding: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 1100, color: NAVY, letterSpacing: "-0.01em" }}>
                        {safeText(detail.name, "Unnamed")}{" "}
                        <span style={{ fontSize: 12, fontWeight: 950, color: MUTED }}>• {safeText(detail.customerCode, "—")}</span>
                      </div>

                      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Pill tone="muted" title={safeText(detail.email, "—")}>{safeText(detail.email, "—")}</Pill>
                        <Pill tone="muted" title={safeText(detail.phone, "—")}>{safeText(detail.phone, "—")}</Pill>
                        <Pill tone="muted" title={`User ID: ${safeText(detail.id, "—")}`}>ID: {shortId(detail.id)}</Pill>
                        <Pill tone="gold">{safeText(detail.kind, "—")}</Pill>
                        <Pill tone={detail.isActive ? "green" : "red"}>{detail.isActive ? "Active" : "Disabled"}</Pill>
                      </div>

                      <div style={{ marginTop: 8, fontSize: 12, color: MUTED, fontWeight: 800 }}>
                        Created: {fmtDT(detail.createdAt)} • Updated: {fmtDT(detail.updatedAt)}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <Button
                        variant={detail.isActive ? "danger" : "primary"}
                        size="sm"
                        disabled={busy}
                        onClick={() => patchCustomer(detail.id, { setActive: !detail.isActive })}
                      >
                        {detail.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button variant="primary" size="sm" disabled={busy} onClick={() => loadDetail(detail.id)}>
                        Refresh detail
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => copyToClipboard(JSON.stringify(detail, null, 2), "Customer JSON copied", detail.id)}
                        title="Copies the full customer payload to clipboard"
                      >
                        Copy customer JSON
                      </Button>
                    </div>
                  </div>

                  {/* Identity edit (admin) */}
                  <div style={{ marginTop: 12, borderTop: "1px dashed rgba(15,33,71,0.12)", paddingTop: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 950, color: NAVY }}>Customer identity (editable)</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {!editIdentity ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditIdentity(true)}>
                            Edit identity
                          </Button>
                        ) : (
                          <>
                            <Button size="sm" variant="primary" disabled={busy} onClick={() => saveIdentity(detail.id)}>
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setEditIdentity(false);
                                setIdentityDraft({
                                  name: safeText(detail?.name, ""),
                                  email: safeText(detail?.email, ""),
                                  phone: safeText(detail?.phone, ""),
                                });
                              }}
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {!editIdentity ? (
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Pill tone="muted">Name: {safeText(detail.name, "—")}</Pill>
                        <Pill tone="muted">Email: {safeText(detail.email, "—")}</Pill>
                        <Pill tone="muted">Phone: {safeText(detail.phone, "—")}</Pill>
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                        <Field
                          label="Name"
                          value={identityDraft.name}
                          onChange={(v) => setIdentityDraft((p) => ({ ...p, name: v }))}
                          placeholder="Customer name"
                          disabled={busy}
                        />
                        <Field
                          label="Email"
                          value={identityDraft.email}
                          onChange={(v) => setIdentityDraft((p) => ({ ...p, email: v }))}
                          placeholder="name@email.com"
                          disabled={busy}
                          inputMode="email"
                        />
                        <Field
                          label="Phone"
                          value={identityDraft.phone}
                          onChange={(v) => setIdentityDraft((p) => ({ ...p, phone: v }))}
                          placeholder="+8801XXXXXXXXX"
                          disabled={busy}
                          inputMode="tel"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                  <KPI label="Orders" value={String(n(detail.metrics?.orders?.total))} hint="Lifetime orders" tone="navy" />
                  <KPI
                    label="Cancellation rate"
                    value={`${Math.round(n(detail.metrics?.orders?.cancelRatePct))}%`}
                    hint="Last 12 months"
                    tone={n(detail.metrics?.orders?.cancelRatePct) >= 25 ? "yellow" : "green"}
                  />
                  <KPI
                    label="COD risk"
                    value={`${Math.round(n(detail.metrics?.risk?.codNonPayRatePct))}%`}
                    hint="Unpaid-cancel ratio (proxy) — last 12 months"
                    tone={n(detail.metrics?.risk?.codNonPayRatePct) >= 20 ? "red" : "muted"}
                  />
                  <KPI
                    label="Returns"
                    value={String(n(detail.metrics?.returns?.count))}
                    hint="Last 12 months"
                    tone={n(detail.metrics?.returns?.count) >= 2 ? "yellow" : "muted"}
                  />
                  <KPI label="Wallet" value={moneyBDT(detail.wallet?.balance)} hint="Live balance" tone="gold" />
                  <KPI
                    label="Tier / Points"
                    value={`${safeText(detail.loyalty?.tier, "MEMBER")} • ${n(detail.loyalty?.currentPoints)} pts`}
                    hint="Loyalty snapshot"
                    tone="muted"
                  />
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: "10px 10px",
                    borderRadius: 18,
                    border: `1px solid rgba(15,33,71,0.12)`,
                    background: "#fff",
                    boxShadow: "0 10px 26px rgba(15,33,71,0.06)",
                  }}
                >
                  {TABS.map((t) => (
                    <Button key={t.k} size="sm" variant={tab === t.k ? "primary" : "ghost"} onClick={() => setTab(t.k)}>
                      {t.label}
                    </Button>
                  ))}
                </div>

                {tab === "overview" ? (
                  <SectionCard
                    title="Overview"
                    subtitle="System risk flags are computed from real order/payment/return/fraud signals. Manual flags are your staff actions."
                    right={
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Pill tone={riskTone(detail.metrics?.risk?.system?.level)}>
                          System: {safeText(detail.metrics?.risk?.system?.level, "LOW")} • {n(detail.metrics?.risk?.system?.score)}
                        </Pill>
                        {detail.risk?.manual?.level ? (
                          <Pill tone={riskTone(detail.risk.manual.level)}>
                            Manual: {safeText(detail.risk.manual.level)} • {n(detail.risk.manual.score)}
                          </Pill>
                        ) : (
                          <Pill tone="muted">Manual: none</Pill>
                        )}
                      </div>
                    }
                  >
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {(detail.risk?.manual?.tags || []).length ? (
                          (detail.risk.manual.tags || []).map((t) => (
                            <Pill key={`mt_${t}`} tone="navy" title={t}>
                              {t}
                            </Pill>
                          ))
                        ) : (
                          <Pill tone="muted">No manual tags</Pill>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {(detail.metrics?.risk?.system?.flags || []).length ? (
                          (detail.metrics.risk.system.flags || []).map((t) => (
                            <Pill key={`sf_${t}`} tone="muted" title={t}>
                              {t}
                            </Pill>
                          ))
                        ) : (
                          <Pill tone="muted">No system flags</Pill>
                        )}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                        <div style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                          <div style={{ fontWeight: 950, color: NAVY, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            Trust signals
                          </div>
                          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Pill tone={detail.trust?.emailVerified ? "green" : "muted"}>
                              Email verified: {detail.trust?.emailVerified ? "Yes" : "No"}
                            </Pill>
                            <Pill tone={detail.trust?.phoneVerified ? "green" : "muted"}>
                              Phone verified: {detail.trust?.phoneVerified ? "Yes" : "No"}
                            </Pill>
                            <Pill tone="muted">Last login: {fmtDT(detail.trust?.lastLoginAt)}</Pill>
                          </div>
                        </div>

                        <div style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                          <div style={{ fontWeight: 950, color: NAVY, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            Commerce signals
                          </div>
                          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Pill tone="muted">Spend (12m): {moneyBDT(detail.metrics?.orders?.paidSpend12m)}</Pill>
                            <Pill tone={n(detail.metrics?.risk?.multiAddressCount) >= 3 ? "yellow" : "muted"}>
                              Addresses used (12m): {n(detail.metrics?.risk?.multiAddressCount)}
                            </Pill>
                            <Pill tone={n(detail.metrics?.risk?.fraudTouches) ? "red" : "muted"}>
                              Fraud touches (12m): {n(detail.metrics?.risk?.fraudTouches)}
                            </Pill>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <Button
                          variant="accent"
                          disabled={busy}
                          onClick={() => {
                            setTab("risk");
                            setTimeout(() => {
                              const el = document.getElementById("crm-risk-anchor");
                              el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                            }, 10);
                          }}
                        >
                          Mark customer / Add flags
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => patchCustomer(detail.id, { action: { clearManualTags: true } })}>
                          Clear manual tags
                        </Button>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {tab === "addresses" ? (
                  <SectionCard
                    title="Addresses"
                    subtitle="Active + archived. Admin can add/edit/verify/default/archive and changes reflect on customer end (DB)."
                    right={
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <Pill tone="muted">Active: {n(detail.metrics?.addresses?.active)}</Pill>
                        <Pill tone="muted">Archived: {n(detail.metrics?.addresses?.archived)}</Pill>
                        <Pill tone="gold">Total: {n(detail.metrics?.addresses?.total)}</Pill>
                        <Button size="sm" variant="primary" disabled={busy} onClick={() => startAddAddress()}>
                          + Add new address
                        </Button>
                      </div>
                    }
                  >
                    {/* New address editor (always available) */}
                    {editingAddressId === NEW_ADDRESS_ID ? (
                      <div style={{ marginBottom: 12, border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <div style={{ fontWeight: 950, color: NAVY }}>Add new address (admin)</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <Button size="sm" variant="primary" disabled={busy} onClick={() => createAddress(detail.id)}>
                              Save new address
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancelAddressEdit()}>
                              Cancel
                            </Button>
                          </div>
                        </div>

                        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                            <Field
                              label="Type"
                              value={addressDraft.type}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, type: v }))}
                              placeholder="HOME / OFFICE / OTHER"
                              disabled={busy}
                            />
                            <Field
                              label="Phone"
                              value={addressDraft.phone}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, phone: v }))}
                              placeholder="+8801XXXXXXXXX"
                              disabled={busy}
                              inputMode="tel"
                            />
                            <div style={{ display: "grid", gap: 6 }}>
                              <div style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>Default</div>
                              <select
                                value={addressDraft.isDefault ? "yes" : "no"}
                                onChange={(e) => setAddressDraft((p) => ({ ...p, isDefault: e.target.value === "yes" }))}
                                style={{
                                  width: "100%",
                                  padding: "10px 12px",
                                  borderRadius: 14,
                                  border: `1px solid rgba(15,33,71,0.16)`,
                                  fontSize: 13,
                                  fontWeight: 900,
                                  color: NAVY,
                                  background: "#fff",
                                  outline: "none",
                                }}
                              >
                                <option value="no">No</option>
                                <option value="yes">Yes</option>
                              </select>
                            </div>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                            <Field
                              label="Line 1"
                              value={addressDraft.line1}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, line1: v }))}
                              placeholder="House / Road / Area"
                              disabled={busy}
                            />
                            <Field
                              label="Line 2"
                              value={addressDraft.line2}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, line2: v }))}
                              placeholder="Landmark / Additional"
                              disabled={busy}
                            />
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                            <Field
                              label="City"
                              value={addressDraft.city}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, city: v }))}
                              placeholder="Dhaka"
                              disabled={busy}
                            />
                            <Field
                              label="State"
                              value={addressDraft.state}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, state: v }))}
                              placeholder="Dhaka"
                              disabled={busy}
                            />
                            <Field
                              label="Postal"
                              value={addressDraft.postalCode}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, postalCode: v }))}
                              placeholder="1207"
                              disabled={busy}
                            />
                            <Field
                              label="Country"
                              value={addressDraft.countryIso2}
                              onChange={(v) => setAddressDraft((p) => ({ ...p, countryIso2: v.toUpperCase() }))}
                              placeholder="BD"
                              disabled={busy}
                            />
                          </div>

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <Pill tone="muted" title="Backend support: prefers POST /api/admin/customers/[id]/addresses; falls back to PATCH action.addAddress">
                              Dual-write: POST preferred, PATCH fallback
                            </Pill>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {(detail.addresses || []).length ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        {(detail.addresses || []).map((a) => {
                          const isEditing = editingAddressId === String(a.id);
                          const addrCopy = [
                            `Type: ${safeText(a.type)}`,
                            a.isDefault ? "Default: YES" : "Default: NO",
                            `Line1: ${safeText(a.line1)}`,
                            `Line2: ${safeText(a.line2)}`,
                            `City: ${safeText(a.city)}`,
                            `State: ${safeText(a.state)}`,
                            `Postal: ${safeText(a.postalCode)}`,
                            `Country: ${safeText(a.countryIso2)}`,
                            `Phone: ${safeText(a.phone)}`,
                          ].join(" | ");

                          return (
                            <div
                              key={a.id}
                              style={{
                                border: `1px solid rgba(15,33,71,0.12)`,
                                borderRadius: 16,
                                padding: 12,
                                background: "#fff",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                  <Pill tone="muted">{safeText(a.type)}</Pill>
                                  {a.isDefault ? <Pill tone="gold">Default</Pill> : null}
                                  {a.phoneVerifiedAt ? <Pill tone="green">Phone verified</Pill> : <Pill tone="muted">Phone not verified</Pill>}
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                  <Pill tone="muted">{fmtDT(a.createdAt)}</Pill>
                                  <MiniAction
                                    label="Copy"
                                    onClick={() => copyToClipboard(addrCopy, "Address copied", String(a.id))}
                                    title="Copy full address snapshot"
                                  />
                                  {!isEditing ? (
                                    <>
                                      <MiniAction label="Edit" onClick={() => startEditAddress(a)} />
                                      {!a.isDefault ? (
                                        <MiniAction
                                          label="Set default"
                                          onClick={() => setDefaultAddress(detail.id, a.id)}
                                          disabled={busy}
                                          title="Set this as default address"
                                        />
                                      ) : null}
                                      <MiniAction
                                        label="Archive"
                                        onClick={() => archiveAddress(detail.id, a.id)}
                                        disabled={busy}
                                        title="Archive this address (won't show in customer checkout)"
                                      />
                                    </>
                                  ) : null}
                                </div>
                              </div>

                              {!isEditing ? (
                                <>
                                  <div style={{ marginTop: 8, fontWeight: 950, color: NAVY }}>{formatAddressLine1(a)}</div>
                                  <div style={{ marginTop: 4, fontSize: 12, color: MUTED, fontWeight: 800 }}>{formatAddressLine2(a)}</div>
                                  <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    <Pill tone="muted">Phone: {safeText(a.phone)}</Pill>
                                    <Pill tone="muted">ID: {shortId(a.id)}</Pill>
                                  </div>
                                </>
                              ) : (
                                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                                    <Field
                                      label="Type"
                                      value={addressDraft.type}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, type: v }))}
                                      placeholder="HOME / OFFICE / OTHER"
                                      disabled={busy}
                                    />
                                    <Field
                                      label="Phone"
                                      value={addressDraft.phone}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, phone: v }))}
                                      placeholder="+8801XXXXXXXXX"
                                      disabled={busy}
                                      inputMode="tel"
                                    />
                                    <div style={{ display: "grid", gap: 6 }}>
                                      <div style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>Default</div>
                                      <select
                                        value={addressDraft.isDefault ? "yes" : "no"}
                                        onChange={(e) => setAddressDraft((p) => ({ ...p, isDefault: e.target.value === "yes" }))}
                                        style={{
                                          width: "100%",
                                          padding: "10px 12px",
                                          borderRadius: 14,
                                          border: `1px solid rgba(15,33,71,0.16)`,
                                          fontSize: 13,
                                          fontWeight: 900,
                                          color: NAVY,
                                          background: "#fff",
                                          outline: "none",
                                        }}
                                      >
                                        <option value="no">No</option>
                                        <option value="yes">Yes</option>
                                      </select>
                                    </div>
                                  </div>

                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                                    <Field
                                      label="Line 1"
                                      value={addressDraft.line1}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, line1: v }))}
                                      placeholder="House / Road / Area"
                                      disabled={busy}
                                    />
                                    <Field
                                      label="Line 2"
                                      value={addressDraft.line2}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, line2: v }))}
                                      placeholder="Landmark / Additional"
                                      disabled={busy}
                                    />
                                  </div>

                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                                    <Field
                                      label="City"
                                      value={addressDraft.city}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, city: v }))}
                                      placeholder="Dhaka"
                                      disabled={busy}
                                    />
                                    <Field
                                      label="State"
                                      value={addressDraft.state}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, state: v }))}
                                      placeholder="Dhaka"
                                      disabled={busy}
                                    />
                                    <Field
                                      label="Postal"
                                      value={addressDraft.postalCode}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, postalCode: v }))}
                                      placeholder="1207"
                                      disabled={busy}
                                    />
                                    <Field
                                      label="Country"
                                      value={addressDraft.countryIso2}
                                      onChange={(v) => setAddressDraft((p) => ({ ...p, countryIso2: v.toUpperCase() }))}
                                      placeholder="BD"
                                      disabled={busy}
                                    />
                                  </div>

                                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                    <Button size="sm" variant="primary" disabled={busy} onClick={() => saveAddressEdit(detail.id)}>
                                      Save address
                                    </Button>
                                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancelAddressEdit()}>
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: MUTED, fontWeight: 850 }}>
                        No active addresses found for this user. You can add one now.
                        <div style={{ marginTop: 10 }}>
                          <Button variant="primary" size="sm" disabled={busy} onClick={() => startAddAddress()}>
                            + Add first address
                          </Button>
                        </div>
                      </div>
                    )}

                    {(detail.addressesArchived || []).length ? (
                      <div style={{ marginTop: 14, borderTop: "1px solid rgba(15,33,71,0.10)", paddingTop: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 950, color: NAVY }}>Archived addresses</div>
                          <Pill tone="muted">{(detail.addressesArchived || []).length} archived</Pill>
                        </div>

                        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                          {(detail.addressesArchived || []).map((a) => (
                            <div
                              key={a.id}
                              style={{
                                border: `1px solid rgba(15,33,71,0.10)`,
                                borderRadius: 16,
                                padding: 12,
                                background: "#fff",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <Pill tone="muted">{safeText(a.type)}</Pill>
                                  <Pill tone="muted">Archived</Pill>
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                  <Pill tone="muted">{fmtDT(a.archivedAt)}</Pill>
                                  <MiniAction label="Restore" disabled={busy} onClick={() => restoreAddress(detail.id, a.id)} />
                                </div>
                              </div>

                              <div style={{ marginTop: 8, fontWeight: 950, color: NAVY }}>{formatAddressLine1(a)}</div>
                              <div style={{ marginTop: 4, fontSize: 12, color: MUTED, fontWeight: 800 }}>{formatAddressLine2(a)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </SectionCard>
                ) : null}

                {tab === "orders" ? (
                  <SectionCard
                    title="Orders"
                    subtitle="All orders (server default up to 5000). Expand an order to see item-level info and images when present in DB."
                    right={
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Pill tone="muted">Loaded: {n(detail.metrics?.orders?.loaded)}</Pill>
                        <Pill tone="muted">Take: {n(detail.metrics?.orders?.take)}</Pill>
                      </div>
                    }
                  >
                    {(detail.orders || []).length ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        {(detail.orders || []).map((o) => {
                          const expanded = expandedOrders.has(o.id);
                          const bundles = Array.isArray(o.items) ? o.items : [];

                          return (
                            <div
                              key={o.id}
                              style={{
                                border: `1px solid rgba(15,33,71,0.12)`,
                                borderRadius: 16,
                                padding: 12,
                                background: "#fff",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <Pill tone="navy">#{safeText(o.orderNumber, safeText(o.id))}</Pill>
                                  <Pill tone="muted">{safeText(o.status)}</Pill>
                                  <Pill tone="muted">{safeText(o.paymentStatus)}</Pill>
                                  <Pill tone="muted">{safeText(o.fulfillmentStatus)}</Pill>
                                  {o.fraudStatus && o.fraudStatus !== "CLEAR" ? (
                                    <Pill tone="red">Fraud: {o.fraudStatus}</Pill>
                                  ) : (
                                    <Pill tone="muted">Fraud: CLEAR</Pill>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                  <Pill tone="gold">{moneyBDT(o.grandTotal)}</Pill>
                                  <Pill tone="muted">{fmtDT(o.createdAt)}</Pill>
                                </div>
                              </div>

                              <div style={{ marginTop: 8, fontSize: 12, color: MUTED, fontWeight: 850 }}>
                                Items: {n(o.itemCount)} • Channel: {safeText(o.channel)} • Source: {safeText(o.source)}
                              </div>

                              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                <Button size="sm" variant={expanded ? "primary" : "ghost"} onClick={() => toggleOrderExpand(o.id)}>
                                  {expanded ? "Hide items" : "Show items"}
                                </Button>

                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => copyToClipboard(JSON.stringify(o, null, 2), "Order JSON copied", o.id)}
                                  title="Copies the full order payload (as returned by DB) to clipboard"
                                >
                                  Copy order JSON
                                </Button>
                              </div>

                              {expanded ? (
                                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                                  {bundles.length ? (
                                    bundles.map((b, bIdx) => {
                                      const imgs = collectImageUrlsFromUnknown(b, 4, 6);
                                      const it = b?.item || b;
                                      const qty = n(it?.quantity, n(it?.qty, 0));
                                      const unit = it?.unitPrice ?? it?.price ?? null;
                                      const line = it?.lineTotal ?? it?.total ?? null;

                                      return (
                                        <div
                                          key={`${o.id}_${b?.item?.id || bIdx}`}
                                          style={{
                                            border: "1px solid rgba(15,33,71,0.10)",
                                            borderRadius: 14,
                                            padding: 10,
                                            background: "rgba(15,33,71,0.02)",
                                            display: "grid",
                                            gap: 10,
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: "flex",
                                              justifyContent: "space-between",
                                              gap: 10,
                                              alignItems: "flex-start",
                                              flexWrap: "wrap",
                                            }}
                                          >
                                            <div style={{ minWidth: 0 }}>
                                              <div style={{ fontWeight: 950, color: NAVY }}>{itemTitle(b)}</div>
                                              <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                                                <Pill tone="muted">Qty: {qty}</Pill>
                                                {unit != null ? <Pill tone="muted">Unit: {moneyBDT(unit)}</Pill> : null}
                                                {line != null ? <Pill tone="muted">Line: {moneyBDT(line)}</Pill> : null}
                                              </div>
                                            </div>

                                            {imgs.length ? (
                                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                                {imgs.slice(0, 3).map((src) => (
                                                  <img
                                                    key={src}
                                                    src={src}
                                                    alt="item"
                                                    referrerPolicy="no-referrer"
                                                    style={{
                                                      width: 56,
                                                      height: 56,
                                                      objectFit: "cover",
                                                      borderRadius: 12,
                                                      border: "1px solid rgba(15,33,71,0.18)",
                                                      background: "#fff",
                                                    }}
                                                    onError={(e) => {
                                                      e.currentTarget.style.display = "none";
                                                    }}
                                                  />
                                                ))}
                                              </div>
                                            ) : null}
                                          </div>

                                          <details style={{ cursor: "pointer" }}>
                                            <summary style={{ fontSize: 12, fontWeight: 900, color: NAVY }}>Raw item snapshot</summary>
                                            <pre
                                              style={{
                                                marginTop: 8,
                                                whiteSpace: "pre-wrap",
                                                wordBreak: "break-word",
                                                fontSize: 12,
                                                color: NAVY,
                                                background: "#fff",
                                                border: "1px solid rgba(15,33,71,0.10)",
                                                borderRadius: 12,
                                                padding: 10,
                                                overflowX: "auto",
                                              }}
                                            >
                                              {JSON.stringify(b, null, 2)}
                                            </pre>
                                          </details>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <div style={{ color: MUTED, fontWeight: 850 }}>No items returned for this order.</div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: MUTED, fontWeight: 850 }}>No orders found for this user.</div>
                    )}
                  </SectionCard>
                ) : null}

                {tab === "wallet" ? (
                  <SectionCard title="Wallet" subtitle="Balance + transactions snapshot. Admin can adjust balance (DB).">
                    <div style={{ display: "grid", gap: 10 }}>
                      <KPI label="Balance" value={moneyBDT(detail.wallet?.balance)} hint="Live wallet balance (DB)" tone="gold" />

                      <div style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12, background: "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <div style={{ fontWeight: 950, color: NAVY }}>Adjust wallet (admin)</div>
                          <Pill tone="muted">Requires PATCH action.walletAdjust</Pill>
                        </div>

                        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "minmax(160px, 200px) minmax(160px, 200px) 1fr", gap: 10 }}>
                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>Mode</div>
                            <select
                              value={walletDraft.mode}
                              onChange={(e) => setWalletDraft((p) => ({ ...p, mode: e.target.value }))}
                              style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 14,
                                border: `1px solid rgba(15,33,71,0.16)`,
                                fontSize: 13,
                                fontWeight: 900,
                                color: NAVY,
                                background: "#fff",
                                outline: "none",
                              }}
                            >
                              <option value="credit">Credit (+)</option>
                              <option value="debit">Debit (-)</option>
                            </select>
                          </div>

                          <Field
                            label="Amount (BDT)"
                            value={walletDraft.amount}
                            onChange={(v) => setWalletDraft((p) => ({ ...p, amount: v.replace(/[^\d]/g, "").slice(0, 9) }))}
                            placeholder="e.g., 500"
                            disabled={busy}
                            inputMode="numeric"
                          />

                          <Field
                            label="Reason"
                            value={walletDraft.reason}
                            onChange={(v) => setWalletDraft((p) => ({ ...p, reason: v }))}
                            placeholder="Reason shown in admin logs (and optionally customer statement if your backend exposes it)"
                            disabled={busy}
                          />
                        </div>

                        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <Button variant="primary" size="sm" disabled={busy} onClick={() => adjustWallet(detail.id)}>
                            Apply adjustment
                          </Button>
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setWalletDraft({ mode: "credit", amount: "", reason: "" })}>
                            Reset
                          </Button>
                        </div>
                      </div>

                      {(detail.wallet?.txns || []).length ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          {(detail.wallet.txns || []).map((t) => (
                            <div key={t.id} style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                <Pill tone={n(t.delta) >= 0 ? "green" : "red"}>{n(t.delta) >= 0 ? `+${moneyBDT(t.delta)}` : moneyBDT(t.delta)}</Pill>
                                <Pill tone="muted">{fmtDT(t.at)}</Pill>
                              </div>
                              <div style={{ marginTop: 8, fontSize: 12, color: MUTED, fontWeight: 850 }}>
                                {safeText(t.reason)} {t.reference ? `• Ref: ${t.reference}` : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: MUTED, fontWeight: 850 }}>No wallet transactions found.</div>
                      )}
                    </div>
                  </SectionCard>
                ) : null}

                {tab === "points" ? (
                  <SectionCard title="Points" subtitle="Loyalty tier + transactions snapshot.">
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Pill tone="gold">Tier: {safeText(detail.loyalty?.tier, "MEMBER")}</Pill>
                        <Pill tone="navy">Points: {n(detail.loyalty?.currentPoints)}</Pill>
                        <Pill tone="muted">Lifetime earned: {n(detail.loyalty?.lifetimeEarned)}</Pill>
                        <Pill tone="muted">Lifetime redeemed: {n(detail.loyalty?.lifetimeRedeemed)}</Pill>
                      </div>

                      {(detail.loyalty?.txns || []).length ? (
                        <div style={{ display: "grid", gap: 10 }}>
                          {(detail.loyalty.txns || []).map((t) => (
                            <div key={t.id} style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                <Pill tone={t.type === "REDEEM" ? "red" : "green"}>
                                  {t.type} • {t.points} pts
                                </Pill>
                                <Pill tone="muted">{fmtDT(t.at)}</Pill>
                              </div>
                              <div style={{ marginTop: 8, fontSize: 12, color: MUTED, fontWeight: 850 }}>
                                {safeText(t.reason)} {t.reference ? `• Ref: ${t.reference}` : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: MUTED, fontWeight: 850 }}>No loyalty transactions found.</div>
                      )}
                    </div>
                  </SectionCard>
                ) : null}

                {tab === "notes" ? (
                  <SectionCard title="Notes" subtitle="CRM notes are stored in UserRiskProfile.notes (DB).">
                    <NotesEditor
                      key={detail.id}
                      busy={busy}
                      initial={detail.risk?.manual?.notes || ""}
                      onSave={(notes) => patchCustomer(detail.id, { risk: { notes } })}
                    />
                  </SectionCard>
                ) : null}

                {tab === "risk" ? (
                  <SectionCard title="Risk & Audit" subtitle="Auto-calculated system risk + manual staff flags. Use manual tags for misbehavior/contentious cases (system cannot infer those reliably).">
                    <div id="crm-risk-anchor" style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                        <Pill tone={riskTone(detail.metrics?.risk?.system?.level)}>
                          System risk: {safeText(detail.metrics?.risk?.system?.level, "LOW")} • score {n(detail.metrics?.risk?.system?.score)}
                        </Pill>
                        <Pill tone="muted">Fraud touches (12m): {n(detail.metrics?.risk?.fraudTouches)}</Pill>
                        <Pill tone="muted">Return count (12m): {n(detail.metrics?.returns?.count)}</Pill>
                        <Pill tone="muted">Unpaid-cancel proxy (12m): {Math.round(n(detail.metrics?.risk?.codNonPayRatePct))}%</Pill>
                      </div>

                      <div style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                        <div style={{ fontWeight: 950, color: NAVY, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          Manual tagging (DB)
                        </div>
                        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {TAG_PRESETS.map((t) => {
                            const tags = detail.risk?.manual?.tags || [];
                            const has = tags.includes(t.k);
                            return (
                              <Button
                                key={t.k}
                                size="sm"
                                variant={has ? "primary" : "ghost"}
                                disabled={busy}
                                onClick={() => patchCustomer(detail.id, { action: { toggleTag: t.k } })}
                              >
                                {has ? "✓" : "+"} {t.k}
                              </Button>
                            );
                          })}
                        </div>

                        <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                          <RiskEditor
                            busy={busy}
                            initialLevel={detail.risk?.manual?.level || ""}
                            initialScore={detail.risk?.manual?.score ?? ""}
                            onSave={(payload) => patchCustomer(detail.id, { risk: payload })}
                          />
                          <div style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                            <div style={{ fontWeight: 950, color: NAVY, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                              System flags (auto)
                            </div>
                            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {(detail.metrics?.risk?.system?.flags || []).length ? (
                                detail.metrics.risk.system.flags.map((f) => (
                                  <Pill key={f} tone="muted" title={f}>
                                    {f}
                                  </Pill>
                                ))
                              ) : (
                                <Pill tone="muted">No auto flags</Pill>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <SectionCard title="Audit trail" subtitle="Recent user-linked audit logs (DB).">
                        {(detail.auditLogs || []).length ? (
                          <div style={{ display: "grid", gap: 10 }}>
                            {(detail.auditLogs || []).map((a) => (
                              <div key={a.id} style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                  <Pill tone="muted">{safeText(a.category)}</Pill>
                                  <Pill tone="muted">{fmtDT(a.at)}</Pill>
                                </div>
                                <div style={{ marginTop: 8, fontWeight: 950, color: NAVY }}>{safeText(a.action)}</div>
                                <div style={{ marginTop: 4, fontSize: 12, color: MUTED, fontWeight: 850 }}>{safeText(a.message)}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ color: MUTED, fontWeight: 850 }}>No audit logs found for this user.</div>
                        )}
                      </SectionCard>

                      <SectionCard title="Fraud checks" subtitle="Recent fraud checks linked to this user (DB).">
                        {(detail.fraudChecks || []).length ? (
                          <div style={{ display: "grid", gap: 10 }}>
                            {(detail.fraudChecks || []).map((f) => (
                              <div key={f.id} style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                  <Pill tone={f.status === "BLOCKED" ? "red" : f.status === "REVIEW" ? "yellow" : "muted"}>{safeText(f.status)}</Pill>
                                  <Pill tone="muted">{fmtDT(f.createdAt)}</Pill>
                                </div>
                                <div style={{ marginTop: 8, fontSize: 12, color: MUTED, fontWeight: 850 }}>
                                  Provider: {safeText(f.provider)} • Score: {n(f.score, 0)} • {safeText(f.reason)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ color: MUTED, fontWeight: 850 }}>No fraud checks found.</div>
                        )}
                      </SectionCard>
                    </div>
                  </SectionCard>
                ) : null}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function NotesEditor({ busy, initial, onSave }) {
  const [v, setV] = useState(String(initial || ""));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Internal CRM notes: fraud context, misbehavior, call outcomes, address verification, COD policy, etc."
        style={{
          width: "100%",
          minHeight: 160,
          padding: 12,
          borderRadius: 16,
          border: `1px solid rgba(15,33,71,0.16)`,
          outline: "none",
          fontSize: 13,
          color: NAVY,
          fontWeight: 800,
          background: "#fff",
          lineHeight: 1.4,
        }}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="primary" disabled={busy} onClick={() => onSave?.(v)}>
          Save notes
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setV(String(initial || ""))}>
          Reset
        </Button>
      </div>
    </div>
  );
}

function RiskEditor({ busy, initialLevel, initialScore, onSave }) {
  const [level, setLevel] = useState(String(initialLevel || ""));
  const [score, setScore] = useState(initialScore === "" || initialScore == null ? "" : String(initialScore));

  return (
    <div style={{ border: `1px solid rgba(15,33,71,0.12)`, borderRadius: 16, padding: 12 }}>
      <div style={{ fontWeight: 950, color: NAVY, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Manual risk override
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>Level</div>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 14,
              border: `1px solid rgba(15,33,71,0.16)`,
              fontSize: 13,
              fontWeight: 900,
              color: NAVY,
              background: "#fff",
              outline: "none",
            }}
          >
            <option value="">(no manual override)</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: MUTED, fontWeight: 900 }}>Score (0–100)</div>
          <input
            value={score}
            onChange={(e) => setScore(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            placeholder="e.g., 75"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 14,
              border: `1px solid rgba(15,33,71,0.16)`,
              fontSize: 13,
              fontWeight: 900,
              color: NAVY,
              background: "#fff",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => onSave?.({ level: level || null, score: score === "" ? null : Number(score) })}
          >
            Save risk
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setLevel("");
              setScore("");
              onSave?.({ level: null, score: null });
            }}
          >
            Clear override
          </Button>
        </div>
      </div>
    </div>
  );
}
