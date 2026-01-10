// FILE: app/(admin)/admin/catalog/page.js
"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function str(v) {
  return String(v ?? "").trim();
}
function int(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/* -------------------- Key helpers (no missing keys, no duplicate keys) -------------------- */

function keyPart(v) {
  const s = str(v);
  return s ? s : "";
}

/**
 * Bulletproof React keys:
 * Always suffix with index to avoid collisions even when payload duplicates exist.
 */
function stableKey(base, idx, fallbackPrefix) {
  const b = keyPart(base);
  if (b) return `${b}|i:${idx}`;
  return `${fallbackPrefix}-${idx}`;
}

function productKey(p, idx) {
  const id = p?.id ?? p?.strapiId ?? p?.app?.strapiId ?? p?.app?.id;
  const slug = p?.slug;
  const title = p?.title;
  return stableKey(`${keyPart(id)}|${keyPart(slug)}|${keyPart(title)}`, idx, "p");
}
function mediaKey(prefix, m, idx) {
  const id = m?.id;
  const url = m?.url;
  const alt = m?.alternativeText;
  return stableKey(`${prefix}|${keyPart(id)}|${keyPart(url)}|${keyPart(alt)}`, idx, prefix);
}
function variantKey(v, idx) {
  const id = v?.id;
  const color = v?.color;
  const colorKey = v?.color_key;
  const sku = v?.generated_sku;
  return stableKey(`${keyPart(id)}|${keyPart(color)}|${keyPart(colorKey)}|${keyPart(sku)}`, idx, "v");
}
function sizeStockKey(v, s, idx) {
  const sid = s?.id;
  const size = s?.size_name ?? s?.primary_value ?? s?.secondary_value;
  const vId = v?.id;
  const vColor = v?.color ?? v?.color_key;
  const sSku = s?.generated_sku ?? s?.barcode;
  return stableKey(`${keyPart(sid)}|${keyPart(vId)}|${keyPart(vColor)}|${keyPart(size)}|${keyPart(sSku)}`, idx, "ss");
}
function taxKey(prefix, c, idx) {
  const id = c?.id;
  const slug = c?.slug;
  const name = c?.name;
  return stableKey(`${prefix}|${keyPart(id)}|${keyPart(slug)}|${keyPart(name)}`, idx, prefix);
}
function invKey(ii, idx) {
  const id = ii?.id;
  const code = ii?.warehouseCode;
  const name = ii?.warehouseName;
  return stableKey(`${keyPart(id)}|${keyPart(code)}|${keyPart(name)}`, idx, "inv");
}

function parseDateMs(v) {
  const s = str(v);
  if (!s) return 0;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Deduplicate products to avoid duplicate UI entries.
 * Keeps the most recently updated record when duplicates are found.
 */
function dedupeProducts(items) {
  const arr = Array.isArray(items) ? items : [];
  const map = new Map();

  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    const id = p?.id ?? p?.strapiId ?? p?.slug ?? `idx:${i}`;
    const k = String(id);

    if (!map.has(k)) {
      map.set(k, p);
      continue;
    }

    const prev = map.get(k);
    const prevMs = parseDateMs(prev?.timestamps?.updatedAt ?? prev?.updatedAt);
    const nextMs = parseDateMs(p?.timestamps?.updatedAt ?? p?.updatedAt);
    if (nextMs >= prevMs) map.set(k, p);
  }

  return Array.from(map.values());
}

/* -------------------- Media URL normalization -------------------- */

function normalizeBaseUrl(base) {
  const b = str(base);
  if (!b) return "";
  return b.endsWith("/") ? b.slice(0, -1) : b;
}

function normalizeMediaUrl(url, baseUrl) {
  const u = str(url);
  if (!u) return null;

  if (u.startsWith("http://") || u.startsWith("https://")) return u;

  if (u.startsWith("//")) {
    const proto = typeof window !== "undefined" ? window.location.protocol : "https:";
    return `${proto}${u}`;
  }

  const base = normalizeBaseUrl(baseUrl);

  if (u.startsWith("/")) {
    if (base) return `${base}${u}`;
    return u;
  }

  if (base) return `${base}/${u}`;
  return u;
}

/* -------------------- Premium UI primitives -------------------- */

const NAVY = "#0F2147";

function NavyCard({ title, sub, right, children, className = "" }) {
  return (
    <section
      className={[
        "rounded-[30px] border border-white/10 bg-[var(--navy)] text-white",
        "shadow-[0_18px_60px_rgba(15,33,71,0.22)]",
        "transition-transform duration-300 will-change-transform",
        className,
      ].join(" ")}
      style={{ ["--navy"]: NAVY }}
    >
      {title || sub || right ? (
        <header className="border-b border-white/10 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              {title ? <div className="text-[13px] font-extrabold tracking-tight">{title}</div> : null}
              {sub ? <div className="mt-1 text-xs text-white/70">{sub}</div> : null}
            </div>
            {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
          </div>
        </header>
      ) : null}
      <div className="p-6">{children}</div>
    </section>
  );
}

function NavyBadge({ tone = "neutral", children }) {
  const cls =
    tone === "ok"
      ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
      : tone === "warn"
      ? "border-amber-300/30 bg-amber-400/10 text-amber-100"
      : tone === "bad"
      ? "border-red-300/30 bg-red-400/10 text-red-100"
      : tone === "info"
      ? "border-sky-300/30 bg-sky-400/10 text-sky-100"
      : "border-white/15 bg-white/10 text-white";

  return <span className={["inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-extrabold", cls].join(" ")}>{children}</span>;
}

function NavyButton({ children, onClick, disabled, className = "", title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "rounded-full px-4 py-2 text-sm font-extrabold transition",
        "border border-white/15 bg-white text-[var(--navy)] hover:brightness-105 active:brightness-95",
        "active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      ].join(" ")}
      style={{ ["--navy"]: NAVY }}
    >
      {children}
    </button>
  );
}

function SoftNavyButton({ children, onClick, disabled, className = "", title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "rounded-full px-4 py-2 text-sm font-extrabold transition",
        "border border-white/15 bg-white/10 text-white hover:bg-white/15",
        "active:scale-[0.98]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function InlineStatus({ tone = "neutral", text }) {
  if (!str(text)) return null;
  const cls =
    tone === "ok"
      ? "text-emerald-200"
      : tone === "warn"
      ? "text-amber-200"
      : tone === "bad"
      ? "text-red-200"
      : "text-white/80";

  return <div className={["mt-4 text-sm font-extrabold", cls].join(" ")}>{text}</div>;
}

function Skeleton({ className = "" }) {
  return <div className={["animate-pulse rounded-2xl bg-gradient-to-r from-white/10 via-white/5 to-white/10", className].join(" ")} />;
}

/* -------------------- Animated Tab Strip (distinctive + premium) -------------------- */

function TabStrip({ value, onChange, items }) {
  const rootRef = useRef(null);
  const btnRefs = useRef(new Map());
  const [rail, setRail] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const activeBtn = btnRefs.current.get(value);
    if (!activeBtn) return;

    const rootRect = root.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();

    setRail({
      left: Math.max(0, btnRect.left - rootRect.left),
      width: Math.max(0, btnRect.width),
    });
  }, [value, items?.length]);

  useEffect(() => {
    const onResize = () => {
      const root = rootRef.current;
      if (!root) return;
      const activeBtn = btnRefs.current.get(value);
      if (!activeBtn) return;
      const rootRect = root.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      setRail({
        left: Math.max(0, btnRect.left - rootRect.left),
        width: Math.max(0, btnRect.width),
      });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [value]);

  return (
    <div
      ref={rootRef}
      className={[
        "relative inline-flex flex-wrap items-center gap-2",
        "rounded-full border border-white/15 bg-white/10 p-2",
        "shadow-[0_10px_30px_rgba(0,0,0,0.18)]",
      ].join(" ")}
    >
      {/* active rail */}
      <span
        className="pointer-events-none absolute top-2 h-[calc(100%-16px)] rounded-full bg-white shadow-[0_10px_28px_rgba(255,255,255,0.22)] transition-all duration-300"
        style={{ left: rail.left, width: rail.width }}
      />
      {items.map((it, idx) => {
        const active = it.value === value;
        return (
          <button
            key={stableKey(`tab|${it.value}`, idx, "tab")}
            ref={(el) => {
              if (!el) return;
              btnRefs.current.set(it.value, el);
            }}
            type="button"
            onClick={() => onChange(it.value)}
            className={[
              "relative z-10 rounded-full px-4 py-2 text-sm font-extrabold transition",
              active ? "text-[#0F2147]" : "text-white hover:bg-white/10",
              "active:scale-[0.99]",
            ].join(" ")}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------- Domain helpers -------------------- */

function statusTone(status) {
  const s = str(status).toLowerCase();
  if (s === "active") return "ok";
  if (s === "draft") return "warn";
  if (s === "archived") return "bad";
  return "neutral";
}

function money(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
function formatPrice(pricing) {
  const cur = str(pricing?.currency) || "";
  const sell = money(pricing?.sellingPrice ?? pricing?.selling_price);
  if (sell == null) return null;
  return `${sell}${cur ? ` ${cur}` : ""}`;
}
function safeImgAlt(title, slug) {
  const t = str(title);
  const s = str(slug);
  return t || s || "Product image";
}

/* -------------------- State + URL sync -------------------- */

function buildInitialState(searchParams) {
  const q = str(searchParams.get("q"));
  const status = str(searchParams.get("status"));
  const stock = str(searchParams.get("stock"));
  const bridge = str(searchParams.get("bridge")); // all | bridged | unbridged
  const media = str(searchParams.get("media")); // all | has | none
  const lowThreshold = clamp(int(searchParams.get("lowThreshold"), 3), 1, 999);
  const sort = str(searchParams.get("sort")) || "updatedAt:desc";
  const page = Math.max(1, int(searchParams.get("page"), 1));
  const pageSize = clamp(int(searchParams.get("pageSize"), 24), 1, 100);
  const view = str(searchParams.get("view")) || "grid"; // grid | table
  const tab = str(searchParams.get("tab")) || "browse"; // browse | diagnostics | launch
  return { q, status, stock, bridge, media, lowThreshold, sort, page, pageSize, view, tab };
}

const FILTER_KEYS = new Set(["q", "status", "stock", "bridge", "media", "lowThreshold", "sort", "page", "pageSize", "view", "tab"]);

function CatalogPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState(() => buildInitialState(searchParams));
  const debouncedQ = useDebouncedValue(filters.q, 250);

  const [exec, setExec] = useState({ tone: "neutral", text: "" });

  // IMPORTANT: force refresh even if listQuery doesn’t change
  const [refreshTick, setRefreshTick] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshTick((x) => x + 1), []);

  const [list, setList] = useState({
    loading: false,
    error: "",
    items: [],
    pagination: { page: 1, pageSize: 24, total: 0, totalPages: 0 },
    meta: null,
  });

  const [selected, setSelected] = useState({
    open: false,
    id: null,
    loading: false,
    error: "",
    product: null,
    variantsMatrix: [],
    warehouseMode: false,
  });

  const [diagnostics, setDiagnostics] = useState({ loading: false, error: "", data: null });
  const [launch, setLaunch] = useState({ loading: false, error: "", drafts: [], meta: null });

  // Preserve unknown params (e.g., focus) so router.replace doesn't wipe them out
  const preservedParamsRef = useRef("");
  useEffect(() => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const k of Array.from(sp.keys())) {
      if (FILTER_KEYS.has(k)) sp.delete(k);
    }
    preservedParamsRef.current = sp.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state -> URL (no loops; preserve non-filter params)
  const didInitUrlSync = useRef(false);
  useEffect(() => {
    const next = {
      q: filters.q || null,
      status: filters.status || null,
      stock: filters.stock || null,
      bridge: filters.bridge || null,
      media: filters.media || null,
      lowThreshold: str(filters.stock).toLowerCase() === "low" ? filters.lowThreshold : null,
      sort: filters.sort || "updatedAt:desc",
      page: filters.page || 1,
      pageSize: filters.pageSize || 24,
      view: filters.view || "grid",
      tab: filters.tab || "browse",
    };

    const baseQs = buildQuery(next);
    const preserved = preservedParamsRef.current ? preservedParamsRef.current : "";

    let merged = baseQs;
    if (preserved) merged = merged ? `${merged}&${preserved}` : `?${preserved}`;

    if (!didInitUrlSync.current) {
      didInitUrlSync.current = true;
      const current = `?${searchParams.toString()}`;
      if ((current === "?" ? "" : current) !== merged) router.replace(`${pathname}${merged}`, { scroll: false });
      return;
    }

    const currentNow = `?${searchParams.toString()}`;
    if ((currentNow === "?" ? "" : currentNow) !== merged) {
      router.replace(`${pathname}${merged}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.q,
    filters.status,
    filters.stock,
    filters.bridge,
    filters.media,
    filters.lowThreshold,
    filters.sort,
    filters.page,
    filters.pageSize,
    filters.view,
    filters.tab,
  ]);

  const listQuery = useMemo(() => {
    return buildQuery({
      q: debouncedQ || null,
      status: filters.status || null,
      stock: filters.stock || null,
      bridge: filters.bridge || null,
      media: filters.media || null,
      lowThreshold: str(filters.stock).toLowerCase() === "low" ? filters.lowThreshold : null,
      sort: filters.sort || "updatedAt:desc",
      page: filters.page || 1,
      pageSize: filters.pageSize || 24,
      // force refetch on demand without mutating filters
      _t: refreshTick ? String(refreshTick) : null,
    });
  }, [
    debouncedQ,
    filters.status,
    filters.stock,
    filters.bridge,
    filters.media,
    filters.lowThreshold,
    filters.sort,
    filters.page,
    filters.pageSize,
    refreshTick,
  ]);

  // Fetch list (only when Browse tab is active)
  useEffect(() => {
    if (filters.tab !== "browse") return;
    const ac = new AbortController();

    const run = async () => {
      setList((s) => ({ ...s, loading: true, error: "" }));
      try {
        const res = await fetch(`/api/admin/catalog/products${listQuery}`, {
          method: "GET",
          signal: ac.signal,
          headers: { "cache-control": "no-store" },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const err = data?.error || `HTTP_${res.status}`;
          setList((s) => ({ ...s, loading: false, error: err }));
          return;
        }

        const rawItems = Array.isArray(data.items) ? data.items : [];
        const items = dedupeProducts(rawItems);

        setList({
          loading: false,
          error: "",
          items,
          pagination: data.pagination || { page: 1, pageSize: 24, total: 0, totalPages: 0 },
          meta: data.meta || null,
        });
      } catch (e) {
        if (ac.signal.aborted) return;
        setList((s) => ({ ...s, loading: false, error: "SERVER_ERROR" }));
      }
    };

    run();
    return () => ac.abort();
  }, [filters.tab, listQuery]);

  const openDrawer = useCallback((id) => {
    const pid = Number(id);
    if (!Number.isFinite(pid) || pid <= 0) return;

    setSelected((s) => ({
      ...s,
      open: true,
      id: pid,
      loading: true,
      error: "",
      product: null,
      variantsMatrix: [],
    }));
  }, []);

  const closeDrawer = useCallback(() => {
    setSelected((s) => ({
      ...s,
      open: false,
      id: null,
      loading: false,
      error: "",
      product: null,
      variantsMatrix: [],
    }));
  }, []);

  // Support deep-link: ?focus=123 opens the drawer
  const didFocusOpenRef = useRef(false);
  useEffect(() => {
    if (didFocusOpenRef.current) return;
    const focus = str(searchParams.get("focus"));
    const pid = Number(focus);
    if (Number.isFinite(pid) && pid > 0) {
      didFocusOpenRef.current = true;
      openDrawer(pid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, openDrawer]);

  // Fetch detail when drawer opens or warehouse mode toggles
  useEffect(() => {
    if (!selected.open || !selected.id) return;

    const ac = new AbortController();
    const run = async () => {
      setSelected((s) => ({ ...s, loading: true, error: "" }));
      try {
        const qs = buildQuery({ warehouse: selected.warehouseMode ? 1 : 0 });
        const res = await fetch(`/api/admin/catalog/products/${selected.id}${qs}`, {
          method: "GET",
          signal: ac.signal,
          headers: { "cache-control": "no-store" },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          const err = data?.error || `HTTP_${res.status}`;
          setSelected((s) => ({ ...s, loading: false, error: err }));
          return;
        }
        setSelected((s) => ({
          ...s,
          loading: false,
          error: "",
          product: data.product || null,
          variantsMatrix: Array.isArray(data.variantsMatrix) ? data.variantsMatrix : [],
        }));
      } catch (e) {
        if (ac.signal.aborted) return;
        setSelected((s) => ({ ...s, loading: false, error: "SERVER_ERROR" }));
      }
    };

    run();
    return () => ac.abort();
  }, [selected.open, selected.id, selected.warehouseMode]);

  // ESC closes drawer
  useEffect(() => {
    if (!selected.open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected.open, closeDrawer]);

  const onFilter = (patch) => {
    setFilters((s) => {
      const next = { ...s, ...patch };
      if ("q" in patch || "status" in patch || "stock" in patch || "bridge" in patch || "media" in patch || "sort" in patch || "pageSize" in patch) {
        next.page = 1;
      }
      return next;
    });
  };

  const totals = useMemo(() => {
    const total = int(list.pagination?.total, 0);
    const pageItems = Array.isArray(list.items) ? list.items.length : 0;
    const bridgedThisPage = (Array.isArray(list.items) ? list.items : []).filter((x) => x?.app?.hasBridge).length;
    const unbridgedThisPage = pageItems - bridgedThisPage;

    const inStockThisPage = (Array.isArray(list.items) ? list.items : []).filter((x) => Number(x?.availability?.totalAvailable ?? 0) > 0).length;
    const outStockThisPage = (Array.isArray(list.items) ? list.items : []).filter((x) => x?.availability && Number(x?.availability?.totalAvailable ?? 0) <= 0).length;

    const hasMediaThisPage = (Array.isArray(list.items) ? list.items : []).filter((x) => Boolean(str(x?.thumbnail || x?.media?.thumbnail))).length;
    const noMediaThisPage = pageItems - hasMediaThisPage;

    return { total, pageItems, bridgedThisPage, unbridgedThisPage, inStockThisPage, outStockThisPage, hasMediaThisPage, noMediaThisPage };
  }, [list.items, list.pagination]);

  const appliedChips = useMemo(() => {
    const chips = [];
    if (str(filters.q)) chips.push({ label: `Search: ${filters.q}`, clear: () => onFilter({ q: "" }) });
    if (str(filters.status)) chips.push({ label: `Status: ${filters.status}`, clear: () => onFilter({ status: "" }) });
    if (str(filters.stock)) {
      const t = str(filters.stock).toLowerCase();
      const label = t === "in" ? "Stock: In stock" : t === "out" ? "Stock: Out of stock" : t === "low" ? "Stock: Low stock" : `Stock: ${filters.stock}`;
      chips.push({ label, clear: () => onFilter({ stock: "" }) });
    }
    if (str(filters.bridge)) {
      const b = str(filters.bridge).toLowerCase();
      const label = b === "bridged" ? "Bridge: Bridged only" : b === "unbridged" ? "Bridge: Unbridged only" : `Bridge: ${filters.bridge}`;
      chips.push({ label, clear: () => onFilter({ bridge: "" }) });
    }
    if (str(filters.media)) {
      const m = str(filters.media).toLowerCase();
      const label = m === "has" ? "Media: Has media" : m === "none" ? "Media: No media" : `Media: ${filters.media}`;
      chips.push({ label, clear: () => onFilter({ media: "" }) });
    }
    if (str(filters.stock).toLowerCase() === "low") chips.push({ label: `Low ≤ ${filters.lowThreshold}`, clear: () => onFilter({ lowThreshold: 3 }) });
    if (str(filters.sort) && filters.sort !== "updatedAt:desc") chips.push({ label: `Sort: ${filters.sort}`, clear: () => onFilter({ sort: "updatedAt:desc" }) });
    if (filters.pageSize !== 24) chips.push({ label: `Page size: ${filters.pageSize}`, clear: () => onFilter({ pageSize: 24 }) });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const canReset =
    Boolean(str(filters.q)) ||
    Boolean(str(filters.status)) ||
    Boolean(str(filters.stock)) ||
    Boolean(str(filters.bridge)) ||
    Boolean(str(filters.media)) ||
    filters.lowThreshold !== 3 ||
    filters.sort !== "updatedAt:desc" ||
    filters.page !== 1 ||
    filters.pageSize !== 24;

  const totalPages = Math.max(1, int(list.pagination?.totalPages, 1));
  const hasItems = Array.isArray(list.items) && list.items.length > 0;

  const strapiBaseForList = useMemo(() => {
    const metaBase = list.meta?.strapiBaseUrl || list.meta?.strapiBase || list.meta?.cmsBaseUrl || "";
    const envBase = process.env.NEXT_PUBLIC_STRAPI_URL || "";
    return normalizeBaseUrl(metaBase || envBase);
  }, [list.meta]);

  /* -------------------- Diagnostics + Launch wiring -------------------- */

  const loadDiagnostics = useCallback(async () => {
    setExec({ tone: "neutral", text: "" });
    setDiagnostics({ loading: true, error: "", data: null });
    try {
      const res = await fetch(`/api/admin/catalog/diagnostics`, { method: "GET", headers: { "cache-control": "no-store" } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const err = data?.error || `HTTP_${res.status}`;
        setDiagnostics({ loading: false, error: err, data: null });
        return;
      }
      setDiagnostics({ loading: false, error: "", data });
      setExec({ tone: "ok", text: "Diagnostics loaded." });
    } catch {
      setDiagnostics({ loading: false, error: "SERVER_ERROR", data: null });
      setExec({ tone: "bad", text: "Diagnostics failed: SERVER_ERROR" });
    }
  }, []);

  const loadLaunchDrafts = useCallback(async () => {
    setExec({ tone: "neutral", text: "" });
    setLaunch({ loading: true, error: "", drafts: [], meta: null });
    try {
      const res = await fetch(`/api/admin/catalog/launch-drafts`, { method: "GET", headers: { "cache-control": "no-store" } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const err = data?.error || `HTTP_${res.status}`;
        setLaunch({ loading: false, error: err, drafts: [], meta: null });
        return;
      }
      setLaunch({
        loading: false,
        error: "",
        drafts: Array.isArray(data.items) ? data.items : Array.isArray(data.drafts) ? data.drafts : [],
        meta: data.meta || null,
      });
      setExec({ tone: "ok", text: "Launch drafts loaded." });
    } catch {
      setLaunch({ loading: false, error: "SERVER_ERROR", drafts: [], meta: null });
      setExec({ tone: "bad", text: "Launch drafts failed: SERVER_ERROR" });
    }
  }, []);

  useEffect(() => {
    if (filters.tab === "diagnostics") loadDiagnostics();
    if (filters.tab === "launch") loadLaunchDrafts();
  }, [filters.tab, loadDiagnostics, loadLaunchDrafts]);

  const createDraftFromSelected = useCallback(async () => {
    const product = selected.product;
    const sid = product?.id;
    if (!sid) {
      setExec({ tone: "warn", text: "Open a product first, then create a draft from the drawer." });
      return;
    }

    setExec({ tone: "neutral", text: "Creating draft…" });
    try {
      const res = await fetch(`/api/admin/catalog/launch-drafts`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        body: JSON.stringify({ sourceStrapiProductId: sid }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const err = data?.error || `HTTP_${res.status}`;
        setExec({ tone: "bad", text: `Create draft failed: ${err}` });
        return;
      }
      setExec({ tone: "ok", text: "Draft created." });
      if (filters.tab !== "launch") onFilter({ tab: "launch" });
      else loadLaunchDrafts();
    } catch {
      setExec({ tone: "bad", text: "Create draft failed: SERVER_ERROR" });
    }
  }, [selected.product, filters.tab, loadLaunchDrafts]);

  /* -------------------- Render -------------------- */

  const TAB_ITEMS = useMemo(
    () => [
      { value: "browse", label: "Browse" },
      { value: "diagnostics", label: "Diagnostics" },
      { value: "launch", label: "Launch" },
    ],
    []
  );

  const VIEW_ITEMS = useMemo(
    () => [
      { value: "grid", label: "Grid" },
      { value: "table", label: "Table" },
    ],
    []
  );

  return (
    <div className="min-h-[calc(100vh-40px)] bg-gradient-to-b from-[#0F2147]/12 via-[#0F2147]/[0.04] to-white">
      <div className="mx-auto max-w-[1520px] space-y-6 px-4 pb-14 pt-7 md:px-7">
        {/* Top shell: title + tabs */}
        <NavyCard
          title="Catalog"
          sub="Premium admin catalog: Strapi content + appDb availability join. All via API routes."
          right={
            <div className="flex flex-wrap items-center gap-2">
              {list.meta?.source ? <NavyBadge tone="neutral">Source: {list.meta.source}</NavyBadge> : null}
              {filters.tab === "browse" && list.loading ? <NavyBadge tone="info">Loading…</NavyBadge> : null}
              {filters.tab === "browse" && list.error ? <NavyBadge tone="bad">{list.error}</NavyBadge> : null}
              <NavyButton
                disabled={filters.tab !== "browse" || list.loading}
                onClick={() => {
                  setExec({ tone: "neutral", text: "" });
                  bumpRefresh();
                }}
                title="Force reload current page"
              >
                Refresh
              </NavyButton>
            </div>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <TabStrip value={filters.tab} onChange={(v) => onFilter({ tab: v })} items={TAB_ITEMS} />
              {filters.tab === "browse" ? (
                <div className="hidden md:block">
                  <div className="h-10 w-px bg-white/15" />
                </div>
              ) : null}
              {filters.tab === "browse" ? <TabStrip value={filters.view} onChange={(v) => onFilter({ view: v })} items={VIEW_ITEMS} /> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <NavyButton
                onClick={createDraftFromSelected}
                disabled={!selected.product?.id}
                title="Create launch draft from the currently open product"
                className="shadow-[0_16px_40px_rgba(255,255,255,0.12)]"
              >
                Create Draft From Open Product
              </NavyButton>
            </div>
          </div>

          <InlineStatus tone={exec.tone} text={exec.text} />

          {/* Applied filter chips */}
          {filters.tab === "browse" && appliedChips.length ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {appliedChips.map((c, i) => (
                <button
                  key={stableKey(`chip|${c.label}`, i, "chip")}
                  type="button"
                  onClick={c.clear}
                  className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-extrabold text-white hover:bg-white/15 active:scale-[0.98]"
                  title="Click to clear this filter"
                >
                  {c.label}
                </button>
              ))}
              {canReset ? (
                <button
                  type="button"
                  onClick={() =>
                    setFilters({
                      q: "",
                      status: "",
                      stock: "",
                      bridge: "",
                      media: "",
                      lowThreshold: 3,
                      sort: "updatedAt:desc",
                      page: 1,
                      pageSize: 24,
                      view: filters.view || "grid",
                      tab: filters.tab || "browse",
                    })
                  }
                  className="rounded-full border border-white/15 bg-white px-4 py-2 text-xs font-extrabold text-[#0F2147] hover:brightness-105 active:scale-[0.98]"
                >
                  Reset all
                </button>
              ) : null}
            </div>
          ) : null}
        </NavyCard>

        {/* -------------------- BROWSE TAB -------------------- */}
        {filters.tab === "browse" ? (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-8">
              <NavyCard title="Matching" sub="Server pagination total">
                <div className="text-3xl font-extrabold">{totals.total}</div>
              </NavyCard>
              <NavyCard title="This page" sub="Loaded rows/cards">
                <div className="text-3xl font-extrabold">{totals.pageItems}</div>
              </NavyCard>
              <NavyCard title="Bridged" sub="Has appDb bridge">
                <div className="text-3xl font-extrabold">{totals.bridgedThisPage}</div>
              </NavyCard>
              <NavyCard title="Unbridged" sub="No appDb bridge">
                <div className="text-3xl font-extrabold">{totals.unbridgedThisPage}</div>
              </NavyCard>
              <NavyCard title="In stock" sub="totalAvailable > 0">
                <div className="text-3xl font-extrabold">{totals.inStockThisPage}</div>
              </NavyCard>
              <NavyCard title="Out of stock" sub="totalAvailable ≤ 0">
                <div className="text-3xl font-extrabold">{totals.outStockThisPage}</div>
              </NavyCard>
              <NavyCard title="Has media" sub="Thumbnail resolved">
                <div className="text-3xl font-extrabold">{totals.hasMediaThisPage}</div>
              </NavyCard>
              <NavyCard title="No media" sub="Missing thumbnail">
                <div className="text-3xl font-extrabold">{totals.noMediaThisPage}</div>
              </NavyCard>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Filters rail */}
              <aside className="lg:col-span-3">
                <div className="sticky top-5 space-y-5">
                  <NavyCard
                    title="Filters"
                    sub="Premium controls — fast scanning with one-click quick filters."
                    right={
                      canReset ? (
                        <SoftNavyButton
                          onClick={() =>
                            setFilters({
                              q: "",
                              status: "",
                              stock: "",
                              bridge: "",
                              media: "",
                              lowThreshold: 3,
                              sort: "updatedAt:desc",
                              page: 1,
                              pageSize: 24,
                              view: filters.view || "grid",
                              tab: filters.tab || "browse",
                            })
                          }
                          title="Reset all filters"
                        >
                          Reset
                        </SoftNavyButton>
                      ) : null
                    }
                  >
                    <div className="grid gap-4">
                      <div className="flex flex-wrap gap-2">
                        <SoftNavyButton
                          onClick={() => onFilter({ bridge: str(filters.bridge).toLowerCase() === "bridged" ? "" : "bridged" })}
                          className={str(filters.bridge).toLowerCase() === "bridged" ? "bg-white text-[#0F2147]" : ""}
                          title="Show only bridged products"
                        >
                          Bridged
                        </SoftNavyButton>
                        <SoftNavyButton
                          onClick={() => onFilter({ bridge: str(filters.bridge).toLowerCase() === "unbridged" ? "" : "unbridged" })}
                          className={str(filters.bridge).toLowerCase() === "unbridged" ? "bg-white text-[#0F2147]" : ""}
                          title="Show only unbridged products"
                        >
                          Unbridged
                        </SoftNavyButton>
                        <SoftNavyButton
                          onClick={() => onFilter({ stock: str(filters.stock).toLowerCase() === "in" ? "" : "in" })}
                          className={str(filters.stock).toLowerCase() === "in" ? "bg-white text-[#0F2147]" : ""}
                          title="Show only in-stock products"
                        >
                          In stock
                        </SoftNavyButton>
                        <SoftNavyButton
                          onClick={() => onFilter({ stock: str(filters.stock).toLowerCase() === "out" ? "" : "out" })}
                          className={str(filters.stock).toLowerCase() === "out" ? "bg-white text-[#0F2147]" : ""}
                          title="Show only out-of-stock products"
                        >
                          Out
                        </SoftNavyButton>
                        <SoftNavyButton
                          onClick={() => onFilter({ media: str(filters.media).toLowerCase() === "has" ? "" : "has" })}
                          className={str(filters.media).toLowerCase() === "has" ? "bg-white text-[#0F2147]" : ""}
                          title="Show only products with media"
                        >
                          Has media
                        </SoftNavyButton>
                        <SoftNavyButton
                          onClick={() => onFilter({ media: str(filters.media).toLowerCase() === "none" ? "" : "none" })}
                          className={str(filters.media).toLowerCase() === "none" ? "bg-white text-[#0F2147]" : ""}
                          title="Show only products missing media"
                        >
                          No media
                        </SoftNavyButton>
                      </div>

                      <label className="block">
                        <div className="text-xs font-extrabold text-white/80">Search</div>
                        <input
                          value={filters.q}
                          onChange={(e) => onFilter({ q: e.target.value })}
                          placeholder="Name / slug / product code / base SKU"
                          className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white placeholder:text-white/60 outline-none focus:border-white/30"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <div className="text-xs font-extrabold text-white/80">Status</div>
                          <select
                            value={filters.status}
                            onChange={(e) => onFilter({ status: e.target.value })}
                            className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                          >
                            <option value="" className="text-black">
                              All
                            </option>
                            <option value="Active" className="text-black">
                              Active
                            </option>
                            <option value="Draft" className="text-black">
                              Draft
                            </option>
                            <option value="Archived" className="text-black">
                              Archived
                            </option>
                          </select>
                        </label>

                        <label className="block">
                          <div className="text-xs font-extrabold text-white/80">Stock</div>
                          <select
                            value={filters.stock}
                            onChange={(e) => onFilter({ stock: e.target.value })}
                            className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                          >
                            <option value="" className="text-black">
                              All
                            </option>
                            <option value="in" className="text-black">
                              In stock
                            </option>
                            <option value="out" className="text-black">
                              Out of stock
                            </option>
                            <option value="low" className="text-black">
                              Low stock
                            </option>
                          </select>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <div className="text-xs font-extrabold text-white/80">Bridge</div>
                          <select
                            value={filters.bridge}
                            onChange={(e) => onFilter({ bridge: e.target.value })}
                            className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                          >
                            <option value="" className="text-black">
                              All
                            </option>
                            <option value="bridged" className="text-black">
                              Bridged only
                            </option>
                            <option value="unbridged" className="text-black">
                              Unbridged only
                            </option>
                          </select>
                        </label>

                        <label className="block">
                          <div className="text-xs font-extrabold text-white/80">Media</div>
                          <select
                            value={filters.media}
                            onChange={(e) => onFilter({ media: e.target.value })}
                            className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                          >
                            <option value="" className="text-black">
                              All
                            </option>
                            <option value="has" className="text-black">
                              Has media
                            </option>
                            <option value="none" className="text-black">
                              No media
                            </option>
                          </select>
                        </label>
                      </div>

                      {str(filters.stock).toLowerCase() === "low" ? (
                        <label className="block">
                          <div className="text-xs font-extrabold text-white/80">Low threshold</div>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={filters.lowThreshold}
                            onChange={(e) => onFilter({ lowThreshold: clamp(int(e.target.value, 3), 1, 999) })}
                            className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                          />
                          <div className="mt-1 text-[11px] text-white/60">Applies only when Stock = Low stock</div>
                        </label>
                      ) : null}

                      <label className="block">
                        <div className="text-xs font-extrabold text-white/80">Sort</div>
                        <select
                          value={filters.sort}
                          onChange={(e) => onFilter({ sort: e.target.value })}
                          className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                        >
                          <option value="updatedAt:desc" className="text-black">
                            Updated (new → old)
                          </option>
                          <option value="updatedAt:asc" className="text-black">
                            Updated (old → new)
                          </option>
                          <option value="createdAt:desc" className="text-black">
                            Created (new → old)
                          </option>
                          <option value="createdAt:asc" className="text-black">
                            Created (old → new)
                          </option>
                          <option value="name:asc" className="text-black">
                            Name (A → Z)
                          </option>
                          <option value="name:desc" className="text-black">
                            Name (Z → A)
                          </option>
                          <option value="selling_price:desc" className="text-black">
                            Price (high → low)
                          </option>
                          <option value="selling_price:asc" className="text-black">
                            Price (low → high)
                          </option>
                        </select>
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <div className="text-xs font-extrabold text-white/80">Page size</div>
                          <select
                            value={filters.pageSize}
                            onChange={(e) => onFilter({ pageSize: clamp(int(e.target.value, 24), 1, 100) })}
                            className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                          >
                            <option value={12} className="text-black">
                              12
                            </option>
                            <option value={24} className="text-black">
                              24
                            </option>
                            <option value={36} className="text-black">
                              36
                            </option>
                            <option value={48} className="text-black">
                              48
                            </option>
                            <option value={72} className="text-black">
                              72
                            </option>
                            <option value={100} className="text-black">
                              100
                            </option>
                          </select>
                        </label>

                        <label className="block">
                          <div className="text-xs font-extrabold text-white/80">Page</div>
                          <input
                            type="number"
                            min={1}
                            max={totalPages}
                            value={filters.page}
                            onChange={(e) => onFilter({ page: clamp(int(e.target.value, 1), 1, totalPages) })}
                            className="mt-2 w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-semibold text-white outline-none focus:border-white/30"
                          />
                          <div className="mt-1 text-[11px] text-white/60">
                            {filters.page} / {totalPages}
                          </div>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <SoftNavyButton disabled={filters.page <= 1 || list.loading} onClick={() => onFilter({ page: Math.max(1, filters.page - 1) })}>
                          Prev
                        </SoftNavyButton>
                        <SoftNavyButton disabled={filters.page >= totalPages || list.loading} onClick={() => onFilter({ page: clamp(filters.page + 1, 1, totalPages) })}>
                          Next
                        </SoftNavyButton>
                      </div>
                    </div>
                  </NavyCard>

                  <NavyCard title="System" sub="UI never reads DB directly. All via API routes.">
                    <div className="flex flex-wrap gap-2">
                      <NavyBadge tone="neutral">No-store</NavyBadge>
                      <NavyBadge tone="info">RBAC guarded</NavyBadge>
                      {strapiBaseForList ? <NavyBadge tone="neutral">Media base: {strapiBaseForList}</NavyBadge> : null}
                    </div>
                  </NavyCard>
                </div>
              </aside>

              {/* Results */}
              <main className="lg:col-span-9">
                <NavyCard
                  title="Results"
                  sub="Browse products and open details without leaving the page."
                  right={
                    <div className="flex flex-wrap items-center gap-2">
                      <NavyBadge tone="neutral">
                        {totals.total} total • {totals.pageItems} on page
                      </NavyBadge>
                      <NavyBadge tone="info">{filters.view === "grid" ? "Grid" : "Table"}</NavyBadge>
                    </div>
                  }
                >
                  {/* Loading skeleton */}
                  {list.loading && !hasItems ? (
                    filters.view === "grid" ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: Math.min(filters.pageSize, 12) }).map((_, i) => (
                          <div key={`sk-${i}`} className="rounded-3xl border border-white/10 bg-white/10 p-5">
                            <div className="flex gap-4">
                              <Skeleton className="h-20 w-20 flex-none" />
                              <div className="min-w-0 flex-1 space-y-3">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/2" />
                                <div className="flex gap-2">
                                  <Skeleton className="h-7 w-24" />
                                  <Skeleton className="h-7 w-28" />
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 flex items-center justify-between">
                              <Skeleton className="h-3 w-32" />
                              <Skeleton className="h-3 w-14" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <div key={`row-${i}`} className="rounded-3xl border border-white/10 bg-white/10 p-5">
                            <div className="flex items-center gap-4">
                              <Skeleton className="h-10 w-10" />
                              <div className="flex-1 space-y-2">
                                <Skeleton className="h-3 w-1/3" />
                                <Skeleton className="h-3 w-1/2" />
                              </div>
                              <Skeleton className="h-9 w-24" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  ) : null}

                  {/* Empty */}
                  {!list.loading && !hasItems ? (
                    <div className="rounded-3xl border border-white/10 bg-white/10 p-10 text-center">
                      <div className="text-lg font-extrabold">No results found</div>
                      <div className="mt-2 text-sm text-white/70">Adjust filters or reset to view more products.</div>
                      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                        <NavyButton
                          onClick={() =>
                            setFilters({
                              q: "",
                              status: "",
                              stock: "",
                              bridge: "",
                              media: "",
                              lowThreshold: 3,
                              sort: "updatedAt:desc",
                              page: 1,
                              pageSize: 24,
                              view: filters.view || "grid",
                              tab: "browse",
                            })
                          }
                        >
                          Reset filters
                        </NavyButton>
                        <SoftNavyButton onClick={() => bumpRefresh()}>Refresh</SoftNavyButton>
                      </div>
                    </div>
                  ) : null}

                  {/* Grid */}
                  {filters.view === "grid" && hasItems ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {(Array.isArray(list.items) ? list.items : []).map((p, idx) => {
                        const priceLabel = formatPrice(p?.pricing);
                        const totalAvail = p?.availability?.totalAvailable;
                        const hasAvail = p?.availability != null;
                        const hasBridge = Boolean(p?.app?.hasBridge);

                        const thumbRaw = p?.thumbnail || p?.media?.thumbnail || null;
                        const thumb = normalizeMediaUrl(thumbRaw, strapiBaseForList);

                        const availTone = hasAvail ? (Number(totalAvail ?? 0) > 0 ? "ok" : "bad") : "neutral";

                        return (
                          <button
                            key={productKey(p, idx)}
                            type="button"
                            onClick={() => openDrawer(p?.id ?? p?.strapiId)}
                            className={[
                              "group text-left",
                              "rounded-3xl border border-white/10 bg-white/10 p-5",
                              "transition duration-200",
                              "hover:bg-white/15 hover:-translate-y-[2px]",
                              "focus:outline-none focus:ring-4 focus:ring-white/10",
                            ].join(" ")}
                          >
                            <div className="flex gap-4">
                              <div className="relative h-20 w-20 flex-none overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                                {thumb ? (
                                  <img
                                    src={thumb}
                                    alt={safeImgAlt(p?.title, p?.slug)}
                                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-xs font-extrabold text-white/70">No media</div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-extrabold">{p?.title || p?.slug || `#${p?.id ?? "—"}`}</div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {p?.status ? <NavyBadge tone={statusTone(p.status)}>{p.status}</NavyBadge> : null}
                                  {!hasBridge ? <NavyBadge tone="warn">No app bridge</NavyBadge> : <NavyBadge tone="ok">Bridged</NavyBadge>}
                                  <NavyBadge tone={availTone}>
                                    {hasAvail ? (Number(totalAvail ?? 0) > 0 ? `Available: ${Number(totalAvail ?? 0)}` : "Out of stock") : "Availability: —"}
                                  </NavyBadge>
                                  {priceLabel ? <NavyBadge tone="neutral">{priceLabel}</NavyBadge> : null}
                                </div>

                                <div className="mt-2 text-xs font-semibold text-white/70">
                                  ID: {p?.id ?? "—"}
                                  {p?.slug ? ` • ${p.slug}` : ""}
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 flex items-center justify-between">
                              <div className="text-xs font-semibold text-white/60">
                                {p?.timestamps?.updatedAt ? `Updated: ${new Date(p.timestamps.updatedAt).toLocaleString()}` : "—"}
                              </div>
                              <div className="text-xs font-extrabold text-white/80 opacity-0 transition group-hover:opacity-100">Open →</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Table */}
                  {filters.view === "table" && hasItems ? (
                    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white">
                      <div className="max-h-[70vh] overflow-auto">
                        <table className="min-w-full border-separate border-spacing-0">
                          <thead className="sticky top-0 z-10 bg-neutral-50">
                            <tr className="text-left text-xs font-extrabold text-neutral-700">
                              <th className="px-4 py-3">Product</th>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3">Bridge</th>
                              <th className="px-4 py-3">Available</th>
                              <th className="px-4 py-3">Price</th>
                              <th className="px-4 py-3">Updated</th>
                              <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white">
                            {(Array.isArray(list.items) ? list.items : []).map((p, idx) => {
                              const totalAvail = p?.availability?.totalAvailable;
                              const hasAvail = p?.availability != null;
                              const hasBridge = Boolean(p?.app?.hasBridge);
                              const priceLabel = formatPrice(p?.pricing);
                              const thumb = normalizeMediaUrl(p?.thumbnail || p?.media?.thumbnail, strapiBaseForList);

                              return (
                                <tr key={productKey(p, idx)} className="border-t border-neutral-200 hover:bg-neutral-50/60">
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                      <div className="h-12 w-12 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
                                        {thumb ? (
                                          <img src={thumb} alt={safeImgAlt(p?.title, p?.slug)} className="h-full w-full object-cover" loading="lazy" />
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center text-[10px] font-extrabold text-neutral-500">No media</div>
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-extrabold text-neutral-900">{p?.title || p?.slug || `#${p?.id ?? "—"}`}</div>
                                        <div className="truncate text-xs text-neutral-600">
                                          ID: {p?.id ?? "—"}
                                          {p?.slug ? ` • ${p.slug}` : ""}
                                        </div>
                                      </div>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    {p?.status ? (
                                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-extrabold text-neutral-700">
                                        {p.status}
                                      </span>
                                    ) : (
                                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-extrabold text-neutral-700">—</span>
                                    )}
                                  </td>

                                  <td className="px-4 py-3">
                                    {hasBridge ? (
                                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-700">
                                        Bridged
                                      </span>
                                    ) : (
                                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-800">
                                        No bridge
                                      </span>
                                    )}
                                  </td>

                                  <td className="px-4 py-3">
                                    {hasAvail ? (
                                      Number(totalAvail ?? 0) > 0 ? (
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-700">
                                          {Number(totalAvail ?? 0)}
                                        </span>
                                      ) : (
                                        <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-extrabold text-red-700">0</span>
                                      )
                                    ) : (
                                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-extrabold text-neutral-700">—</span>
                                    )}
                                  </td>

                                  <td className="px-4 py-3">
                                    {priceLabel ? (
                                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-extrabold text-neutral-700">
                                        {priceLabel}
                                      </span>
                                    ) : (
                                      <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-extrabold text-neutral-700">—</span>
                                    )}
                                  </td>

                                  <td className="px-4 py-3 text-xs text-neutral-700">{p?.timestamps?.updatedAt ? new Date(p.timestamps.updatedAt).toLocaleString() : "—"}</td>

                                  <td className="px-4 py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={() => openDrawer(p?.id ?? p?.strapiId)}
                                      className="rounded-full bg-[#0F2147] px-4 py-2 text-sm font-extrabold text-white hover:brightness-110 active:scale-[0.98]"
                                    >
                                      Open
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {/* Bottom pagination */}
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/10 p-4">
                    <div className="text-xs font-extrabold text-white/80">
                      Page <span className="text-white">{filters.page}</span> of <span className="text-white">{totalPages}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <SoftNavyButton disabled={filters.page <= 1 || list.loading} onClick={() => onFilter({ page: Math.max(1, filters.page - 1) })}>
                        Prev
                      </SoftNavyButton>
                      <SoftNavyButton disabled={filters.page >= totalPages || list.loading} onClick={() => onFilter({ page: clamp(filters.page + 1, 1, totalPages) })}>
                        Next
                      </SoftNavyButton>
                    </div>
                  </div>
                </NavyCard>
              </main>
            </div>
          </>
        ) : null}

        {/* -------------------- DIAGNOSTICS TAB -------------------- */}
        {filters.tab === "diagnostics" ? (
          <NavyCard
            title="Diagnostics"
            sub="Drift detection: missing bridges, missing media, missing mappings, pricing mismatches."
            right={
              <div className="flex flex-wrap items-center gap-2">
                <NavyButton onClick={loadDiagnostics} disabled={diagnostics.loading}>
                  Reload
                </NavyButton>
                {diagnostics.loading ? <NavyBadge tone="info">Loading…</NavyBadge> : null}
                {diagnostics.error ? <NavyBadge tone="bad">{diagnostics.error}</NavyBadge> : null}
              </div>
            }
          >
            {!diagnostics.loading && !diagnostics.error && diagnostics.data ? (
              <div className="space-y-5">
                <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
                  <div className="text-sm font-extrabold">Summary</div>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/20 p-4 text-xs font-semibold text-white/80">
                    {JSON.stringify(diagnostics.data.summary ?? diagnostics.data.meta ?? diagnostics.data, null, 2)}
                  </pre>
                </div>

                {Array.isArray(diagnostics.data.items) && diagnostics.data.items.length ? (
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
                    <div className="text-sm font-extrabold">Items</div>
                    <div className="mt-4 space-y-3">
                      {diagnostics.data.items.map((it, idx) => (
                        <div
                          key={stableKey(`diag|${it?.id ?? it?.strapiId ?? it?.slug ?? ""}|${it?.type ?? ""}`, idx, "diag")}
                          className="rounded-2xl border border-white/10 bg-black/20 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-extrabold">{it?.title || it?.slug || it?.type || "Issue"}</div>
                            {it?.severity ? (
                              <NavyBadge tone={it.severity === "HIGH" ? "bad" : it.severity === "MEDIUM" ? "warn" : "neutral"}>{it.severity}</NavyBadge>
                            ) : null}
                          </div>
                          {it?.message ? <div className="mt-2 text-xs text-white/75">{it.message}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-white/10 bg-white/10 p-7 text-sm font-extrabold text-white/85">No diagnostic items returned.</div>
                )}
              </div>
            ) : null}

            {!diagnostics.loading && (diagnostics.error || !diagnostics.data) ? (
              <div className="rounded-3xl border border-white/10 bg-white/10 p-7 text-sm font-extrabold text-white/85">
                {diagnostics.error ? `Diagnostics error: ${diagnostics.error}` : "No diagnostics data."}
              </div>
            ) : null}
          </NavyCard>
        ) : null}

        {/* -------------------- LAUNCH TAB -------------------- */}
        {filters.tab === "launch" ? (
          <NavyCard
            title="Launch Drafts"
            sub="Draft → validate → push → publish workflow (server enforced)."
            right={
              <div className="flex flex-wrap items-center gap-2">
                <NavyButton onClick={loadLaunchDrafts} disabled={launch.loading}>
                  Reload
                </NavyButton>
                {launch.loading ? <NavyBadge tone="info">Loading…</NavyBadge> : null}
                {launch.error ? <NavyBadge tone="bad">{launch.error}</NavyBadge> : null}
              </div>
            }
          >
            {Array.isArray(launch.drafts) && launch.drafts.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {launch.drafts.map((d, idx) => (
                  <div
                    key={stableKey(`draft|${d?.id ?? ""}|${d?.title ?? ""}|${d?.slug ?? ""}`, idx, "draft")}
                    className="rounded-3xl border border-white/10 bg-white/10 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold">{d?.title || d?.name || d?.slug || `Draft ${d?.id ?? idx + 1}`}</div>
                        <div className="mt-2 text-xs text-white/70">
                          {d?.state ? `State: ${d.state}` : null}
                          {d?.targetStrapiId ? ` • Target Strapi: ${d.targetStrapiId}` : null}
                        </div>
                      </div>
                      {d?.state ? (
                        <NavyBadge tone={String(d.state).includes("FAIL") ? "bad" : String(d.state).includes("VALID") ? "ok" : "neutral"}>{d.state}</NavyBadge>
                      ) : null}
                    </div>

                    {d?.updatedAt || d?.createdAt ? (
                      <div className="mt-3 text-[11px] font-semibold text-white/60">
                        {d?.updatedAt ? `Updated: ${new Date(d.updatedAt).toLocaleString()}` : null}
                        {d?.createdAt && !d?.updatedAt ? `Created: ${new Date(d.createdAt).toLocaleString()}` : null}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {d?.id ? (
                        <NavyButton onClick={() => window.open(`/admin/catalog?tab=launch&draft=${encodeURIComponent(String(d.id))}`, "_blank", "noopener,noreferrer")}>
                          Open
                        </NavyButton>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-white/10 bg-white/10 p-7 text-sm font-extrabold text-white/85">
                {launch.loading ? "Loading drafts…" : launch.error ? `Launch error: ${launch.error}` : "No drafts found."}
              </div>
            )}
          </NavyCard>
        ) : null}

        {/* -------------------- Drawer (Browse tab only) -------------------- */}
        {filters.tab === "browse" && selected.open ? (
          <div className="fixed inset-0 z-[80]">
            <button type="button" onClick={closeDrawer} className="absolute inset-0 bg-black/55" aria-label="Close" />

            <div className="absolute right-0 top-0 h-full w-full max-w-[980px] overflow-hidden rounded-l-[30px] border-l border-white/10 bg-[#0F2147] text-white shadow-2xl">
              <div className="flex h-full flex-col">
                <div className="border-b border-white/10 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-extrabold">
                        {selected.product?.title || selected.product?.slug || (selected.id ? `Product #${selected.id}` : "Product")}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {selected.product?.status ? <NavyBadge tone={statusTone(selected.product.status)}>{selected.product.status}</NavyBadge> : null}
                        {selected.loading ? <NavyBadge tone="info">Loading…</NavyBadge> : null}
                        {selected.error ? <NavyBadge tone="bad">{selected.error}</NavyBadge> : null}
                        {selected.product?.app?.hasBridge === false ? <NavyBadge tone="warn">No appDb bridge</NavyBadge> : null}
                      </div>
                      <div className="mt-2 text-xs font-semibold text-white/70">
                        {selected.product?.id ? `ID: ${selected.product.id}` : null}
                        {selected.product?.slug ? ` • Slug: ${selected.product.slug}` : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-extrabold text-white">
                        <input type="checkbox" checked={Boolean(selected.warehouseMode)} onChange={(e) => setSelected((s) => ({ ...s, warehouseMode: e.target.checked }))} />
                        Warehouse mode
                      </label>

                      <NavyButton onClick={closeDrawer}>Close</NavyButton>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-6">
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                    {/* Media */}
                    <div className="lg:col-span-5">
                      <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-extrabold">Media</div>
                          <NavyBadge tone="neutral">Images</NavyBadge>
                        </div>

                        <div className="mt-4">
                          {selected.product?.media?.thumbnail ? (
                            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                              <img
                                src={normalizeMediaUrl(selected.product.media.thumbnail, selected.product?.media?.baseUrl || strapiBaseForList)}
                                alt={safeImgAlt(selected.product?.title, selected.product?.slug)}
                                className="h-72 w-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          ) : (
                            <div className="flex h-72 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-sm font-extrabold text-white/70">No media</div>
                          )}

                          <div className="mt-4 grid grid-cols-4 gap-2">
                            {(Array.isArray(selected.product?.media?.images) ? selected.product.media.images : []).slice(0, 8).map((m, idx) => (
                              <div key={mediaKey("img", m, idx)} className="overflow-hidden rounded-xl border border-white/10 bg-white/10">
                                <img
                                  src={normalizeMediaUrl(m?.url, selected.product?.media?.baseUrl || strapiBaseForList)}
                                  alt={m?.alternativeText || "Image"}
                                  className="h-16 w-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            ))}

                            {(Array.isArray(selected.product?.media?.gallery) ? selected.product.media.gallery : []).slice(0, 8).map((m, idx) => (
                              <div key={mediaKey("gal", m, idx)} className="overflow-hidden rounded-xl border border-white/10 bg-white/10">
                                <img
                                  src={normalizeMediaUrl(m?.url, selected.product?.media?.baseUrl || strapiBaseForList)}
                                  alt={m?.alternativeText || "Gallery"}
                                  className="h-16 w-full object-cover"
                                  loading="lazy"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Availability + Variants */}
                    <div className="lg:col-span-7">
                      <div className="rounded-3xl border border-white/10 bg-white/10 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-extrabold">Availability</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {selected.product?.availability ? (
                              <>
                                <NavyBadge tone="neutral">
                                  Mapped size stocks: {selected.product.availability.mappedSizeStocks}/{selected.product.availability.totalSizeStocks}
                                </NavyBadge>
                                <NavyBadge tone={Number(selected.product.availability.totalAvailable ?? 0) > 0 ? "ok" : "bad"}>
                                  Total available: {Number(selected.product.availability.totalAvailable ?? 0)}
                                </NavyBadge>
                                {selected.warehouseMode ? <NavyBadge tone="info">Computed: {Number(selected.product.availability.computedTotalAvailable ?? 0)}</NavyBadge> : null}
                              </>
                            ) : (
                              <NavyBadge tone="neutral">—</NavyBadge>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-white/80">
                          <span className="font-extrabold text-white">Price: </span>
                          <span className="font-extrabold text-white">
                            {selected.product?.pricing?.selling_price != null
                              ? `${selected.product.pricing.selling_price}${selected.product.pricing.currency ? ` ${selected.product.pricing.currency}` : ""}`
                              : "—"}
                          </span>
                          {selected.product?.pricing?.compare_price != null ? (
                            <span className="ml-2 text-white/70">
                              Compare:{" "}
                              <span className="font-extrabold text-white">
                                {selected.product.pricing.compare_price}
                                {selected.product.pricing.currency ? ` ${selected.product.pricing.currency}` : ""}
                              </span>
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-6">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-extrabold">Variants</div>
                            <NavyBadge tone="neutral">{Array.isArray(selected.variantsMatrix) ? selected.variantsMatrix.length : 0}</NavyBadge>
                          </div>

                          <div className="mt-4 space-y-5">
                            {(Array.isArray(selected.variantsMatrix) ? selected.variantsMatrix : []).map((v, vIdx) => (
                              <div key={variantKey(v, vIdx)} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-sm font-extrabold">{v?.color || v?.color_key || "Variant"}</div>
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    {v?.generated_sku ? <NavyBadge tone="neutral">SKU: {v.generated_sku}</NavyBadge> : null}
                                    {v?.barcode ? <NavyBadge tone="neutral">Barcode: {v.barcode}</NavyBadge> : null}
                                  </div>
                                </div>

                                <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-white">
                                  <table className="min-w-full border-separate border-spacing-0">
                                    <thead className="bg-neutral-50">
                                      <tr className="text-left text-xs font-extrabold text-neutral-700">
                                        <th className="px-3 py-2">Size</th>
                                        <th className="px-3 py-2">Active</th>
                                        <th className="px-3 py-2">Strapi SKU</th>
                                        <th className="px-3 py-2">App SKU</th>
                                        <th className="px-3 py-2">App Available</th>
                                        {selected.warehouseMode ? <th className="px-3 py-2">Computed</th> : null}
                                        <th className="px-3 py-2">Price</th>
                                        <th className="px-3 py-2">Barcode</th>
                                        {selected.warehouseMode ? <th className="px-3 py-2">Warehouses</th> : null}
                                      </tr>
                                    </thead>
                                    <tbody className="bg-white">
                                      {(Array.isArray(v?.size_stocks) ? v.size_stocks : []).map((s, sIdx) => {
                                        const app = s?.app || null;
                                        const appAvail = app?.stockAvailable;
                                        const computed = app?.computedAvailable;
                                        const mapped = Boolean(app);
                                        const active = s?.is_active;

                                        return (
                                          <tr key={sizeStockKey(v, s, sIdx)} className="border-t border-neutral-200">
                                            <td className="px-3 py-2 text-xs font-extrabold text-neutral-900">
                                              {s?.size_name || s?.primary_value || s?.secondary_value || "—"}
                                            </td>
                                            <td className="px-3 py-2">
                                              {active === true ? (
                                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-700">
                                                  Yes
                                                </span>
                                              ) : active === false ? (
                                                <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-extrabold text-red-700">
                                                  No
                                                </span>
                                              ) : (
                                                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-extrabold text-neutral-700">
                                                  —
                                                </span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-neutral-800">{s?.generated_sku || "—"}</td>
                                            <td className="px-3 py-2 text-xs">
                                              {mapped ? (
                                                <span className="font-extrabold text-neutral-900">{app?.sku || "—"}</span>
                                              ) : (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-800">Unmapped</span>
                                              )}
                                            </td>
                                            <td className="px-3 py-2 text-xs">
                                              {mapped ? (
                                                Number(appAvail ?? 0) > 0 ? (
                                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-700">
                                                    {Number(appAvail ?? 0)}
                                                  </span>
                                                ) : (
                                                  <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-extrabold text-red-700">
                                                    {Number(appAvail ?? 0)}
                                                  </span>
                                                )
                                              ) : (
                                                <span className="text-neutral-600">—</span>
                                              )}
                                            </td>
                                            {selected.warehouseMode ? (
                                              <td className="px-3 py-2 text-xs">
                                                {mapped ? (
                                                  Number(computed ?? 0) > 0 ? (
                                                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-extrabold text-sky-700">
                                                      {Number(computed ?? 0)}
                                                    </span>
                                                  ) : (
                                                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-extrabold text-neutral-700">
                                                      {Number(computed ?? 0)}
                                                    </span>
                                                  )
                                                ) : (
                                                  <span className="text-neutral-600">—</span>
                                                )}
                                              </td>
                                            ) : null}
                                            <td className="px-3 py-2 text-xs text-neutral-800">
                                              {s?.price != null ? <span className="font-extrabold text-neutral-900">{s.price}</span> : <span className="text-neutral-600">—</span>}
                                              {s?.compare_at_price != null ? <span className="ml-2 text-neutral-600">({s.compare_at_price})</span> : null}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-neutral-800">{s?.barcode || app?.barcode || "—"}</td>
                                            {selected.warehouseMode ? (
                                              <td className="px-3 py-2 text-xs text-neutral-800">
                                                {mapped && Array.isArray(app?.inventory) && app.inventory.length ? (
                                                  <div className="space-y-1">
                                                    {app.inventory.slice(0, 8).map((ii, iiIdx) => (
                                                      <div key={invKey(ii, iiIdx)} className="rounded-xl border border-neutral-200 bg-neutral-50 px-2 py-1">
                                                        <div className="font-extrabold text-neutral-900">
                                                          {ii?.warehouseName || "Warehouse"}
                                                          {ii?.warehouseCode ? ` (${ii.warehouseCode})` : ""}
                                                        </div>
                                                        <div className="text-[11px] text-neutral-700">
                                                          OnHand: {Number(ii?.onHand ?? 0)} • Reserved: {Number(ii?.reserved ?? 0)} • Safety: {Number(ii?.safetyStock ?? 0)}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                ) : (
                                                  <span className="text-neutral-600">—</span>
                                                )}
                                              </td>
                                            ) : null}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}

                            {!selected.loading && Array.isArray(selected.variantsMatrix) && selected.variantsMatrix.length === 0 ? (
                              <div className="rounded-3xl border border-white/10 bg-white/10 p-5 text-sm font-extrabold text-white/80">No variants found in Strapi for this product.</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Taxonomy */}
                  <div className="mt-5 rounded-3xl border border-white/10 bg-white/10 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-extrabold">Taxonomy</div>
                      <NavyBadge tone="neutral">Tags</NavyBadge>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs font-extrabold text-white/85">Categories</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(Array.isArray(selected.product?.taxonomy?.categories) ? selected.product.taxonomy.categories : []).length ? (
                            selected.product.taxonomy.categories.map((c, idx) => (
                              <NavyBadge key={taxKey("cat", c, idx)} tone="neutral">
                                {c?.name || c?.slug || `#${c?.id ?? "—"}`}
                              </NavyBadge>
                            ))
                          ) : (
                            <span className="text-xs text-white/70">—</span>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="text-xs font-extrabold text-white/85">Collections</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(Array.isArray(selected.product?.collections?.events_products_collections) ? selected.product.collections.events_products_collections : []).length ? (
                            selected.product.collections.events_products_collections.map((c, idx) => (
                              <NavyBadge key={taxKey("col", c, idx)} tone="neutral">
                                {c?.name || c?.slug || `#${c?.id ?? "—"}`}
                              </NavyBadge>
                            ))
                          ) : (
                            <span className="text-xs text-white/70">—</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  {selected.product?.short_description || selected.product?.description ? (
                    <div className="mt-5 rounded-3xl border border-white/10 bg-white/10 p-5">
                      <div className="text-sm font-extrabold">Description</div>
                      {selected.product?.short_description ? <p className="mt-3 whitespace-pre-wrap text-sm font-semibold text-white/85">{selected.product.short_description}</p> : null}
                      {selected.product?.description ? <p className="mt-3 whitespace-pre-wrap text-sm font-semibold text-white/80">{selected.product.description}</p> : null}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-white/10 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-white/70">
                      {selected.product?.timestamps?.updatedAt ? `Updated: ${new Date(selected.product.timestamps.updatedAt).toLocaleString()}` : "—"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <NavyButton
                        onClick={() => {
                          const sid = selected.product?.id;
                          if (!sid) return;
                          window.open(`/admin/catalog?focus=${encodeURIComponent(String(sid))}`, "_blank", "noopener,noreferrer");
                        }}
                        disabled={!selected.product?.id}
                      >
                        Open in new tab
                      </NavyButton>
                      <NavyButton onClick={closeDrawer}>Close</NavyButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CatalogPage() {
  return (
    <React.Suspense fallback={null}>
      <CatalogPageInner />
    </React.Suspense>
  );
}
