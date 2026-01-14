// FILE: src/components/common/menucontainer.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

/**
 * MenuContainer (full-screen overlay)
 *
 * RELATED TO: BottomFloatingBar / Navbar menu trigger (not MenuFlyout itself).
 *
 * ALIGNMENT:
 * - Canonical routing: /collections/{slug}
 * - CATCHER PLAN: uses SAME-ORIGIN proxy (/api/strapi) to avoid CORS and keep it fast.
 * - Instant open: localStorage cache + TTL, then refresh in background.
 * - Mobile safe: never overflow screen (vertical/horizontal); internal scroll only.
 *
 * CENTRAL TOKENS (from src/styles/variables.css):
 * - --page-gutter-x
 * - --safe-top/--safe-right/--safe-bottom/--safe-left
 * - --shadow-soft
 * - --ring-focus
 * - --tap-target-min
 */

/* ------------------------- constants ------------------------- */
const CANONICAL_PREFIX = "/collections";

/* ------------------------- local cache ------------------------- */
const LS_KEY = "tdls:menucontainer:audiences:v1";
const LS_TS = "tdls:menucontainer:audiences_ts:v1";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

/* ------------------------- slug utils ------------------------- */
function deburr(input) {
  try {
    return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return String(input || "");
  }
}

function slugify(input) {
  const raw = deburr((input ?? "").toString().trim());
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['"’`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function canonicalHref(slugOrLabel) {
  const s = (slugOrLabel || "").toString().trim();
  if (!s) return null;
  const slug = slugify(s.replace(/^\/+/, ""));
  if (!slug) return null;
  return `${CANONICAL_PREFIX}/${slug}`;
}

/* ------------------------- Strapi normalizers ------------------------- */
function normalizeEntity(e) {
  if (!e) return null;
  if (e.attributes && typeof e.id !== "undefined") return { id: e.id, ...e.attributes };
  return e;
}

function normalizeRelation(rel) {
  if (!rel) return [];
  if (Array.isArray(rel)) return rel.map(normalizeEntity).filter(Boolean);
  if (rel.data) {
    if (Array.isArray(rel.data)) return rel.data.map(normalizeEntity).filter(Boolean);
    return [normalizeEntity(rel.data)].filter(Boolean);
  }
  const direct = normalizeEntity(rel);
  return direct ? [direct] : [];
}

function pickLabel(obj) {
  if (!obj) return "";
  const v = obj.name || obj.title || obj.label || obj.displayName || obj.heading || obj.text || "";
  return (v ?? "").toString().trim();
}

function pickSlug(obj) {
  if (!obj) return "";
  const v = obj.slug || obj.handle || obj.key || obj.uid || "";
  return (v ?? "").toString().trim();
}

function pickPriority(obj) {
  if (!obj) return null;
  const v = obj.priority ?? obj.order ?? obj.sort ?? obj.rank ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getRel(obj, key) {
  if (!obj) return undefined;
  const direct = obj[key];
  if (direct !== undefined) return direct;
  if (obj.attributes && obj.attributes[key] !== undefined) return obj.attributes[key];
  return undefined;
}

function pickChildren(obj) {
  if (!obj) return [];
  const rel =
    getRel(obj, "children") ||
    getRel(obj, "branches") ||
    getRel(obj, "items") ||
    getRel(obj, "subcategories") ||
    getRel(obj, "subCategories") ||
    getRel(obj, "sub_categories") ||
    getRel(obj, "nodes") ||
    null;
  return normalizeRelation(rel);
}

function toNode(entity, depth = 0, maxDepth = 4) {
  const e = normalizeEntity(entity);
  if (!e) return null;

  const label = pickLabel(e) || "";
  const slug = pickSlug(e) || slugify(label) || "";
  const href = canonicalHref(slug);

  if (!label || !href) return null;

  const kidsRaw = depth < maxDepth ? pickChildren(e) : [];
  const children = kidsRaw.map((c) => toNode(c, depth + 1, maxDepth)).filter(Boolean);

  return {
    id: e.id ?? `${slug}:${depth}`,
    label,
    slug,
    href,
    priority: pickPriority(e),
    children: children.length ? children : [],
  };
}

function dedupeByHref(nodes) {
  const seen = new Set();
  const out = [];
  for (const n of nodes || []) {
    if (!n?.href) continue;
    if (seen.has(n.href)) continue;
    seen.add(n.href);
    out.push(n);
  }
  return out;
}

function sortNodes(nodes) {
  return [...(nodes || [])].sort((a, b) => {
    const ap = a?.priority;
    const bp = b?.priority;
    if (Number.isFinite(ap) && Number.isFinite(bp) && ap !== bp) return ap - bp;
    if (Number.isFinite(ap) && !Number.isFinite(bp)) return -1;
    if (!Number.isFinite(ap) && Number.isFinite(bp)) return 1;
    const al = (a?.label || "").toLowerCase();
    const bl = (b?.label || "").toLowerCase();
    return al.localeCompare(bl);
  });
}

/* ====================== DATA FETCH (CATCHER / PROXY) ====================== */
/**
 * Your proxy returns: { ok: true, data: <rawStrapiJson> }
 */
async function fetchViaProxy(path, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const q = encodeURIComponent(normalizedPath);

    const res = await fetch(`/api/strapi?path=${q}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "force-cache",
      signal: controller.signal,
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return { ok: false, status: res.status, json };

    const payload = json?.ok ? json.data : json;
    return { ok: true, status: res.status, json: payload };
  } finally {
    clearTimeout(t);
  }
}

async function fetchAudienceCategories() {
  const paths = [
    "/audience-categories?pagination[pageSize]=500&sort=priority:asc&populate[children][populate][children][populate][children]=*&populate=*",
    "/audience-categories?pagination[pageSize]=500&sort=priority:asc&populate=*",
    "/audience-categories?pagination[pageSize]=500&sort=priority:asc",
    "/audience-categories?pagination[pageSize]=500",
  ];

  for (const p of paths) {
    const r = await fetchViaProxy(p, 12000);
    if (!r.ok || !r.json) continue;

    const raw = r.json?.data;
    const list = Array.isArray(raw) ? raw.map(normalizeEntity).filter(Boolean) : [];
    if (list.length) return { items: list, sourcePath: p };
  }

  throw new Error("audience_categories_fetch_failed");
}

/* ------------------------- Fallback (never blank) ------------------------- */
const FALLBACK_AUDIENCES = [
  { name: "Women", slug: "women", priority: 1 },
  { name: "Men", slug: "men", priority: 2 },
  { name: "Kids", slug: "kids", priority: 3 },
  { name: "Young", slug: "young", priority: 4 },
  { name: "Home Décor", slug: "home-decor", priority: 5 },
  { name: "New Arrival", slug: "new-arrival", priority: 6 },
  { name: "On Sale", slug: "on-sale", priority: 7 },
  { name: "Monsoon", slug: "monsoon", priority: 8 },
  { name: "Summer", slug: "summer", priority: 9 },
  { name: "Winter", slug: "winter", priority: 10 },
];

/* ------------------------- 4-tier shell (fixed labels) ------------------------- */
const TIERS = [
  { key: "limited-edition", label: "Limited Edition" },
  { key: "premium-collection", label: "Premium Collection" },
  { key: "signature-series", label: "Signature Series" },
  { key: "heritage-collection", label: "Heritage Collection" },
];

function TierPill({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        border: "1px solid rgba(15,33,71,0.10)",
        background: active
          ? "linear-gradient(180deg, rgba(15,33,71,0.10) 0%, rgba(15,33,71,0.06) 100%)"
          : "#fff",
        color: "#0F2147",
        borderRadius: 16,
        padding: "12px 12px",
        fontWeight: 900,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        cursor: "pointer",
        boxShadow: active ? "0 16px 40px rgba(0,0,0,0.10)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function CategoryCard({ node, onNavigate }) {
  return (
    <div
      style={{
        border: "1px solid rgba(15,33,71,0.10)",
        borderRadius: 18,
        background: "linear-gradient(180deg, #FFFFFF 0%, #FBFCFF 100%)",
        boxShadow: "0 14px 44px rgba(0,0,0,0.08)",
        padding: 14,
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <Link
        href={node.href}
        prefetch
        onClick={onNavigate}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          textDecoration: "none",
          color: "#0F2147",
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontWeight: 950,
            fontSize: 15,
            letterSpacing: ".02em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {node.label}
        </div>
        <div
          style={{
            fontWeight: 900,
            fontSize: 12,
            color: "rgba(15,33,71,0.55)",
            letterSpacing: ".12em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          View
        </div>
      </Link>

      {Array.isArray(node.children) && node.children.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {node.children.slice(0, 12).map((c) => (
            <Link
              key={c.href}
              href={c.href}
              prefetch
              onClick={onNavigate}
              style={{
                textDecoration: "none",
                color: "rgba(15,33,71,0.82)",
                fontWeight: 850,
                fontSize: 13,
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(15,33,71,0.08)",
                background: "rgba(233,241,251,0.55)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------- Component ------------------------- */
export default function MenuContainer({ open: openProp, onClose = null, options = null }) {
  const isControlled = typeof openProp === "boolean";
  const [selfOpen, setSelfOpen] = useState(false);
  const open = isControlled ? openProp : selfOpen;

  const usingExternal = Array.isArray(options) && options.length > 0;

  const [nodes, setNodes] = useState([]);
  const [activeTierIdx, setActiveTierIdx] = useState(0);
  const [query, setQuery] = useState("");

  const [diag, setDiag] = useState({
    loading: false,
    error: null,
    source: null,
    rawCount: 0,
  });

  // ensure we do not update state after close/unmount
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const close = () => {
    if (typeof onClose === "function") {
      onClose();
      return;
    }
    if (!isControlled) setSelfOpen(false);
  };

  // Load nodes (external options OR proxy fetch with cache/TTL)
  useEffect(() => {
    if (!open) return;

    if (usingExternal) {
      const normalized = dedupeByHref(
        (options || [])
          .map((x) => {
            const href = x?.href || canonicalHref(x?.slug || x?.label);
            const children = Array.isArray(x?.children) ? x.children : [];
            return { ...x, href, children };
          })
          .filter((x) => x?.label && x?.href)
      );

      setNodes(sortNodes(normalized));
      setDiag({
        loading: false,
        error: null,
        source: "external-options",
        rawCount: normalized.length,
      });
      return;
    }

    let mounted = true;

    // 1) instant from localStorage
    try {
      const cached = window.localStorage.getItem(LS_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length) setNodes(parsed);
      }
    } catch {}

    const shouldRefresh = () => {
      try {
        const last = Number(window.localStorage.getItem(LS_TS) || "0");
        return Date.now() - last >= TTL_MS;
      } catch {
        return true;
      }
    };

    const refresh = () => {
      setDiag((d) => ({ ...d, loading: true, error: null }));

      fetchAudienceCategories()
        .then(({ items, sourcePath }) => {
          if (!mounted || !openRef.current) return;

          const tree = items.map((it) => toNode(it, 0, 4)).filter(Boolean);
          const deduped = dedupeByHref(tree);
          const sorted = sortNodes(deduped);

          setNodes(sorted);
          setDiag({
            loading: false,
            error: null,
            source: sourcePath,
            rawCount: items.length,
          });

          try {
            window.localStorage.setItem(LS_KEY, JSON.stringify(sorted));
            window.localStorage.setItem(LS_TS, String(Date.now()));
          } catch {}
        })
        .catch((e) => {
          if (!mounted || !openRef.current) return;

          const fb = sortNodes(
            FALLBACK_AUDIENCES.map((x) => ({
              id: x.slug,
              label: x.name,
              slug: x.slug,
              href: canonicalHref(x.slug),
              priority: x.priority,
              children: [],
            }))
          );

          setNodes((prev) => (Array.isArray(prev) && prev.length ? prev : fb));
          setDiag({
            loading: false,
            error: e?.message || "menu_fetch_failed",
            source: null,
            rawCount: 0,
          });
        });
    };

    if (shouldRefresh()) refresh();
    else setDiag((d) => ({ ...d, loading: false, error: null, source: "local-cache" }));

    return () => {
      mounted = false;
    };
  }, [open, usingExternal, options]);

  // Lock scroll + ESC-to-close while open
  useEffect(() => {
    if (!open) return;

    const body = document.body;
    const html = document.documentElement;

    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;

    body.style.overflow = "hidden";
    html.style.overflow = "hidden";

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        try {
          close();
        } catch {}
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const q = query.trim().toLowerCase();

  const filteredNodes = useMemo(() => {
    if (!q) return nodes;
    const match = (s) => (s || "").toLowerCase().includes(q);

    const filterTree = (arr) =>
      (arr || [])
        .map((n) => {
          const kids = Array.isArray(n.children) ? filterTree(n.children) : [];
          const selfMatch = match(n.label) || match(n.slug);
          const childMatch = kids.length > 0;
          if (!selfMatch && !childMatch) return null;
          return { ...n, children: kids };
        })
        .filter(Boolean);

    return filterTree(nodes);
  }, [nodes, q]);

  const safeTierIdx = Math.max(0, Math.min(activeTierIdx, TIERS.length - 1));
  const activeTier = TIERS[safeTierIdx];
  const tierHref = canonicalHref(activeTier?.key) || `${CANONICAL_PREFIX}/${activeTier?.key || "limited-edition"}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            background: "rgba(10, 18, 35, 0.38)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding:
              "max(var(--page-gutter-x), var(--safe-top)) max(var(--page-gutter-x), var(--safe-right)) max(var(--page-gutter-x), var(--safe-bottom)) max(var(--page-gutter-x), var(--safe-left))",
            overflow: "hidden",
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-modal="true"
        >
          <style>{`
            :root{
              /* Overlay sizing tokens (centralized via CSS vars; safe defaults) */
              --overlay-shell-max-w: 1180px;
              --overlay-shell-w: 94vw;
              --overlay-shell-max-h: 860px;
              --overlay-shell-max-dvh: 92dvh;
              --overlay-radius: 26px;

              --overlay-left-col: 280px;
              --overlay-pad: 16px;

              /* Breakpoints (as tokens, for consistency across overlays) */
              --overlay-bp-md: 1024px;
              --overlay-bp-stack: 900px;
              --overlay-bp-sm: 480px;

              /* Header stacking breakpoint (earlier than full body stacking) */
              --overlay-bp-header-stack: 720px;
            }

            .tdls-menu-shell{
              width: min(var(--overlay-shell-max-w), var(--overlay-shell-w));
              max-height: min(var(--overlay-shell-max-dvh), var(--overlay-shell-max-h));
              border-radius: var(--overlay-radius);
              border: 1px solid rgba(255,255,255,0.14);
              background: linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(252,252,255,0.96) 100%);
              box-shadow: var(--shadow-soft, 0 40px 120px rgba(0,0,0,0.25));
              overflow: hidden;
              display: flex;
              flex-direction: column;
              min-width: 0;
              contain: layout paint style;
            }

            .tdls-menu-body{
              display: grid;
              grid-template-columns: var(--overlay-left-col) 1fr;
              gap: 0;
              min-height: 0;
              flex: 1 1 auto;
              overflow: hidden;
            }

            .tdls-left{
              padding: 14px;
              border-right: 1px solid rgba(15,33,71,0.08);
              background: linear-gradient(180deg, rgba(233,241,251,0.65) 0%, rgba(255,255,255,0.88) 100%);
              overflow: auto;
              -webkit-overflow-scrolling: touch;
              min-width: 0;
            }

            .tdls-right{
              padding: var(--overlay-pad);
              overflow: auto;
              -webkit-overflow-scrolling: touch;
              min-width: 0;
            }

            .tdls-grid{
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 12px;
            }

            @media (max-width: var(--overlay-bp-md)){
              .tdls-grid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
            }

            /* Earlier stacking (mobile landscape safe) */
            @media (max-width: var(--overlay-bp-stack)){
              .tdls-menu-body{ grid-template-columns: 1fr; }
              .tdls-left{
                border-right: none;
                border-bottom: 1px solid rgba(15,33,71,0.08);
              }
              .tdls-grid{ grid-template-columns: 1fr; }
            }

            @media (max-width: 768px){
              :root{
                --overlay-shell-w: 96vw;
                --overlay-shell-max-h: 900px;
                --overlay-shell-max-dvh: 94dvh;
                --overlay-radius: 22px;
              }
            }

            @media (max-width: var(--overlay-bp-sm)){
              :root{
                --overlay-shell-w: 96vw;
                --overlay-radius: 20px;
                --overlay-pad: 14px;
              }
              .tdls-left{ padding: 12px; }
            }

            /* Focus ring (premium + accessible), uses central token */
            .tdls-focusable:focus{
              outline: none;
            }
            .tdls-focusable:focus-visible{
              box-shadow: var(--ring-focus, 0 0 0 2px rgba(36, 31, 68, 0.22));
            }

            /* Header: stack earlier to avoid width traps */
            .tdls-header{
              padding: 16px;
              border-bottom: 1px solid rgba(15,33,71,0.08);
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              flex-wrap: wrap;
              min-width: 0;
            }
            .tdls-header-left{
              display: flex;
              flex-direction: column;
              gap: 4px;
              min-width: 0; /* ✅ plan: allow shrink */
              flex: 1 1 auto;
            }
            .tdls-header-right{
              display: flex;
              align-items: center;
              gap: 10px;
              flex: 2 1 auto;
              justify-content: flex-end;
              min-width: 0;
            }
            @media (max-width: var(--overlay-bp-header-stack)){
              .tdls-header{
                align-items: stretch;
              }
              .tdls-header-right{
                width: 100%;
                justify-content: space-between;
              }
            }
          `}</style>

          <motion.div
            className="tdls-menu-shell"
            initial={{ y: 14, scale: 0.985, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 14, scale: 0.985, opacity: 0 }}
            transition={{ duration: 0.22 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="tdls-header">
              {/* ✅ Plan: minWidth 220 → 0 (shrinkable) */}
              <div className="tdls-header-left">
                <div
                  style={{
                    fontFamily: "'Playfair Display', serif",
                    fontWeight: 900,
                    letterSpacing: ".10em",
                    color: "#0F2147",
                    textTransform: "uppercase",
                    fontSize: 16,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  Collections
                </div>
                <div
                  style={{
                    color: "rgba(15,33,71,0.65)",
                    fontWeight: 850,
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  Canonical routing: <span style={{ fontWeight: 950 }}>/collections/&lt;slug&gt;</span>
                </div>
              </div>

              <div className="tdls-header-right">
                {/* ✅ Plan: width responsive base = min(320px, 100%) */}
                <input
                  className="tdls-focusable"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search audience…"
                  style={{
                    width: "min(320px, 100%)",
                    maxWidth: "100%",
                    flex: "1 1 240px",
                    borderRadius: 999,
                    border: "1px solid rgba(15,33,71,0.12)",
                    padding: "10px 14px",
                    fontWeight: 850,
                    outline: "none",
                    background: "#fff",
                    minWidth: 0,
                  }}
                />

                <button
                  className="tdls-focusable"
                  type="button"
                  onClick={close}
                  style={{
                    border: "1px solid rgba(15,33,71,0.14)",
                    borderRadius: 999,
                    padding: "10px 14px",
                    fontWeight: 950,
                    color: "#0F2147",
                    background: "#fff",
                    cursor: "pointer",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    minHeight: "var(--tap-target-min, 44px)",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="tdls-menu-body">
              {/* Left rail: 4 tiers */}
              <div className="tdls-left">
                <div style={{ display: "grid", gap: 10 }}>
                  {TIERS.map((t, idx) => (
                    <TierPill key={t.key} active={idx === safeTierIdx} onClick={() => setActiveTierIdx(idx)}>
                      {t.label}
                    </TierPill>
                  ))}
                </div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  <Link
                    href={tierHref}
                    prefetch
                    onClick={close}
                    className="tdls-focusable"
                    style={{
                      textDecoration: "none",
                      borderRadius: 16,
                      padding: "12px 12px",
                      border: "1px solid rgba(15,33,71,0.10)",
                      background: "linear-gradient(90deg, rgba(212,175,55,0.22) 0%, rgba(212,175,55,0.10) 100%)",
                      color: "#0F2147",
                      fontWeight: 950,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      boxShadow: "0 18px 50px rgba(0,0,0,0.10)",
                      display: "block",
                      minWidth: 0,
                    }}
                  >
                    Explore {activeTier?.label || "Collections"}
                  </Link>

                  <div
                    style={{
                      borderRadius: 16,
                      padding: 12,
                      border: "1px solid rgba(15,33,71,0.08)",
                      background: "#fff",
                      color: "rgba(15,33,71,0.70)",
                      fontWeight: 850,
                      fontSize: 12,
                      lineHeight: 1.35,
                      minWidth: 0,
                    }}
                  >
                    {diag.loading ? "Loading audience categories…" : "Audience categories ready."}
                    {diag.source ? (
                      <div style={{ marginTop: 6, color: "rgba(15,33,71,0.55)", fontWeight: 900 }}>
                        Source: {diag.source}
                      </div>
                    ) : null}
                    {diag.error ? (
                      <div style={{ marginTop: 6, color: "rgba(168, 64, 64, 0.95)", fontWeight: 950 }}>
                        Fallback active
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Right: Audience categories grid */}
              <div className="tdls-right">
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 12,
                    flexWrap: "wrap",
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: "1 1 240px" }}>
                    <div style={{ fontWeight: 950, color: "#0F2147", fontSize: 16 }}>Audience Categories</div>
                    <div style={{ fontWeight: 850, color: "rgba(15,33,71,0.62)", fontSize: 12 }}>
                      Same slug everywhere → same filtered page
                    </div>
                  </div>

                  <div style={{ fontWeight: 900, color: "rgba(15,33,71,0.60)", fontSize: 12, flexShrink: 0 }}>
                    {filteredNodes.length} items
                  </div>
                </div>

                <div className="tdls-grid">
                  {filteredNodes.map((n) => (
                    <CategoryCard key={n.href} node={n} onNavigate={close} />
                  ))}
                </div>

                {filteredNodes.length === 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      borderRadius: 18,
                      border: "1px dashed rgba(15,33,71,0.25)",
                      background: "rgba(233,241,251,0.55)",
                      padding: 16,
                      color: "#0F2147",
                      fontWeight: 950,
                      letterSpacing: ".03em",
                    }}
                  >
                    No audience matched your search.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
