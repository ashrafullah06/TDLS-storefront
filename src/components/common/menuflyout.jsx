// FILE: src/components/common/menuflyout.jsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

/**
 * Node shape:
 * { label: string, href?: string, badges?: string[], children?: Node[] }
 *
 * CATCHER PLAN:
 * - Primary path: parent passes `options` (server-cached payload already computed).
 * - Fallback path: if `options` is empty, MenuFlyout fetches audience tree via SAME-ORIGIN proxy (/api/strapi),
 *   caches it in localStorage with TTL, and refreshes in background (no sluggish feel).
 *
 * MOBILE (ULTRA DENSE / RADICAL):
 * - Minimal top rail height (chips), minimal header, maximum content height.
 * - Dense responsive grid (2–4 columns depending on width).
 * - Group headers are “micro” and optional (hidden when only one group).
 * - Viewport-bounded heights + internal scrolling only; NEVER overflow screen.
 * - overflow-x:hidden everywhere.
 *
 * CENTRAL TOKENS (from src/styles/variables.css):
 * - --page-gutter-x, --tap-target-min, --ring-focus, --shadow-soft, --shadow-card
 * - --safe-top/--safe-right/--safe-bottom/--safe-left
 */

const CANONICAL_COLLECTION_PREFIX = "/collections";

/* ===== local cache for fallback tree (only when options not provided) ===== */
const LS_TREE_KEY = "tdls:menuflyout:tree:v1";
const LS_TREE_TS = "tdls:menuflyout:tree_ts:v1";
const TREE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/* ====================== SLUG + LABEL UTIL ====================== */

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

function canonicalHrefFromSlug(slug) {
  const raw = (slug || "").toString().trim();
  const s = slugify(raw.replace(/^\/+/, ""));
  if (!s) return null;
  return `${CANONICAL_COLLECTION_PREFIX}/${s}`;
}

function getAttr(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined) return obj[key];
  if (obj.attributes && obj.attributes[key] !== undefined) return obj.attributes[key];
  return undefined;
}

function normalizeStrapiEntity(entity) {
  if (!entity) return null;
  if (entity.attributes) return entity.attributes;
  return entity;
}

function normalizeStrapiRelation(rel) {
  if (!rel) return [];
  if (Array.isArray(rel)) return rel.map(normalizeStrapiEntity).filter(Boolean);
  if (rel.data) {
    if (Array.isArray(rel.data)) return rel.data.map(normalizeStrapiEntity).filter(Boolean);
    return [normalizeStrapiEntity(rel.data)].filter(Boolean);
  }
  const direct = normalizeStrapiEntity(rel);
  return direct ? [direct] : [];
}

function pickLabel(item) {
  const candidates = [
    getAttr(item, "label"),
    getAttr(item, "name"),
    getAttr(item, "title"),
    getAttr(item, "displayName"),
  ];
  const v = candidates.find((x) => typeof x === "string" && x.trim());
  return (v || "").toString().trim();
}

function pickSlug(item) {
  const candidates = [getAttr(item, "slug"), getAttr(item, "handle"), getAttr(item, "key")];
  const v = candidates.find((x) => typeof x === "string" && x.trim());
  return (v || "").toString().trim();
}

function pickBadges(item) {
  const badges = [];
  const isNew = getAttr(item, "isNew");
  const isHot = getAttr(item, "isHot") ?? getAttr(item, "isTrending");
  const isLimited = getAttr(item, "isLimited") ?? getAttr(item, "limited");
  const badgeText = getAttr(item, "badge") ?? getAttr(item, "badgeText");

  if (badgeText && typeof badgeText === "string") badges.push(badgeText);
  if (isLimited) badges.push("LIMITED");
  if (isHot) badges.push("HOT");
  if (isNew) badges.push("NEW");

  return badges.slice(0, 2);
}

function pickChildren(item) {
  const keys = ["children", "branches", "subcategories", "subCategories", "nodes", "items"];
  for (const k of keys) {
    const rel = getAttr(item, k);
    const children = normalizeStrapiRelation(rel);
    if (children.length) return children;
  }
  return [];
}

function toNode(item, depth = 0, maxDepth = 3) {
  if (!item) return null;

  const label = pickLabel(item) || "";
  const rawSlug = pickSlug(item) || "";
  const slug = rawSlug || slugify(label);

  const href = canonicalHrefFromSlug(slug) || undefined;
  const badges = pickBadges(item);

  const childrenRaw = depth < maxDepth ? pickChildren(item) : [];
  const children = childrenRaw.map((c) => toNode(c, depth + 1, maxDepth)).filter(Boolean);

  if (!label) return null;

  return {
    label,
    href,
    badges: badges.length ? badges : undefined,
    children: children.length ? children : undefined,
  };
}

function dedupeTree(nodes) {
  const seen = new Set();
  const dedupe = (arr) => {
    const out = [];
    for (const n of arr || []) {
      if (!n || !n.label) continue;
      const key = (n.href || `${n.label}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const cleaned = { ...n };
      if (cleaned.children) cleaned.children = dedupe(cleaned.children);
      out.push(cleaned);
    }
    return out;
  };
  return dedupe(nodes);
}

function pinAndSortTopLevel(nodes) {
  const pinnedSlugs = new Set(["limited-edition", "limitededition", "limited"]);
  const score = (n) => {
    const slug = (n?.href || "").split("/").pop() || "";
    if (pinnedSlugs.has(slug)) return -100;
    return 0;
  };
  return [...(nodes || [])].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.label.localeCompare(b.label);
  });
}

/* ====================== DATA FETCH (AUTO) ====================== */

async function fetchViaProxy(path, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const q = encodeURIComponent(normalizedPath);

    const res = await fetch(`/api/strapi?path=${q}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "default",
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

async function fetchAudienceTree() {
  const paths = [
    "/audience-categories?populate[children][populate][children][populate][children]=*&populate=*&pagination[pageSize]=500",
    "/audience-categories?populate=*&pagination[pageSize]=500",
    "/audience-categories?pagination[pageSize]=500",
  ];

  for (const p of paths) {
    const r = await fetchViaProxy(p, 12000);
    if (!r.ok || !r.json) continue;

    const items = Array.isArray(r.json?.data) ? r.json.data.map(normalizeStrapiEntity).filter(Boolean) : [];
    if (items.length) return { items, sourcePath: p };
  }

  throw new Error("audience_categories_fetch_failed");
}

/* ====================== ACTIVE-PATH HELPERS ====================== */

function isNodeActiveBranch(node, pathname) {
  if (!node || !pathname) return false;

  if (node.href && (pathname === node.href || pathname.startsWith(node.href + "/"))) {
    return true;
  }

  if (Array.isArray(node.children)) {
    return node.children.some((child) => isNodeActiveBranch(child, pathname));
  }

  return false;
}

/* ====================== MOBILE DENSITY HELPERS ====================== */

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Build ultra-dense mobile sections:
 * - Keeps a tiny group header (tier-2 label) but minimizes its height.
 * - Shows leaf-ish nodes under each group as a dense responsive grid.
 * - Prefers deepest nodes available (so you “see more items” quickly).
 */
function buildMobileSections(activeNode) {
  const tier2 = safeArr(activeNode?.children);
  const sections = [];

  for (const c2 of tier2) {
    const tier3 = safeArr(c2?.children);

    // If tier-2 has no tier-3, show tier-2 itself as one-item section.
    if (tier3.length === 0) {
      sections.push({
        head: c2,
        items: [c2].filter(Boolean),
      });
      continue;
    }

    const items = [];
    for (const c3 of tier3) {
      const tier4 = safeArr(c3?.children);

      // Prefer deepest; if tier-4 exists, show tier-4 items (more granular).
      if (tier4.length) {
        for (const c4 of tier4) items.push(c4);
      } else {
        items.push(c3);
      }
    }

    // Deduplicate inside section by href/label
    const seen = new Set();
    const deduped = [];
    for (const it of items) {
      if (!it || !it.label) continue;
      const key = (it.href || it.label).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }

    sections.push({ head: c2, items: deduped });
  }

  const single = sections.length === 1;

  return sections.map((s) => ({
    ...s,
    hideHeaderVisual: single,
  }));
}

/* ====================== COMPONENT ====================== */

export default function MenuFlyout({ options = [] }) {
  const pathname = usePathname();
  const [activeIndex, setActiveIndex] = useState(0);

  const [autoOptions, setAutoOptions] = useState([]);
  const [autoError, setAutoError] = useState(null);
  const [autoLoading, setAutoLoading] = useState(false);

  const [isMobile, setIsMobile] = useState(false);

  const usingExternal = Array.isArray(options) && options.length > 0;

  // Detect mobile (no hover). Uses width only (safe + stable).
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 768px)");
    const apply = () => setIsMobile(Boolean(mq?.matches));
    apply();
    if (!mq) return;
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Auto tree: instant from local cache, then refresh if stale.
  useEffect(() => {
    if (usingExternal) return;

    let mounted = true;

    // 1) Instant paint from localStorage (if any)
    try {
      const cached = window.localStorage.getItem(LS_TREE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length) setAutoOptions(parsed);
      }
    } catch {}

    // 2) Background refresh if stale
    const shouldRefresh = () => {
      try {
        const last = Number(window.localStorage.getItem(LS_TREE_TS) || "0");
        const now = Date.now();
        return now - last >= TREE_TTL_MS;
      } catch {
        return true;
      }
    };

    if (!shouldRefresh()) return;

    setAutoLoading(true);
    setAutoError(null);

    fetchAudienceTree()
      .then(({ items }) => {
        if (!mounted) return;

        const nodes = items.map((it) => toNode(it, 0, 3)).filter(Boolean);
        const deduped = dedupeTree(nodes);
        const sorted = pinAndSortTopLevel(deduped);

        setAutoOptions(sorted);

        try {
          window.localStorage.setItem(LS_TREE_KEY, JSON.stringify(sorted));
          window.localStorage.setItem(LS_TREE_TS, String(Date.now()));
        } catch {}
      })
      .catch((e) => {
        if (!mounted) return;
        console.error("[MenuFlyout] auto-fetch failed:", e);
        setAutoError(e?.message || "menu_auto_fetch_failed");
        setAutoOptions((prev) => (Array.isArray(prev) && prev.length ? prev : []));
      })
      .finally(() => {
        if (!mounted) return;
        setAutoLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [usingExternal]);

  const effectiveOptions = usingExternal ? options : autoOptions;

  // Default selection: match current route
  useEffect(() => {
    if (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0) {
      setActiveIndex(0);
      return;
    }
    const idx = effectiveOptions.findIndex((n) => isNodeActiveBranch(n, pathname));
    setActiveIndex(idx === -1 ? 0 : idx);
  }, [effectiveOptions, pathname]);

  // Ensure activeIndex never exceeds length after updates
  useEffect(() => {
    if (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0) return;
    setActiveIndex((i) => Math.max(0, Math.min(i, effectiveOptions.length - 1)));
  }, [Array.isArray(effectiveOptions) ? effectiveOptions.length : 0]);

  // If we have nothing yet, do NOT show "Loading..." text.
  // Show a small skeleton instead (neutral; no bad first impression).
  if (!usingExternal && autoLoading && (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0)) {
    return (
      <div style={{ width: "100%", minHeight: 220, padding: 10, overflow: "hidden" }}>
        <style>{`
          .tdls-skel { display: flex; gap: 12px; min-height: 220px; max-height: min(60dvh, 520px); overflow: hidden; }
          .tdls-skel-rail { flex: 0 0 210px; max-width: 260px; border-right: 1px solid #e7e3da; padding-right: 10px; display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
          .tdls-skel-pill { height: 34px; border-radius: 999px; background: #f1ede3; overflow: hidden; position: relative; }
          .tdls-skel-pill::after {
            content: "";
            position: absolute; inset: 0;
            transform: translateX(-100%);
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
            animation: tdls-shimmer 1.1s infinite;
          }
          @keyframes tdls-shimmer { 100% { transform: translateX(100%); } }
          .tdls-skel-detail { flex: 1 1 auto; border-radius: 16px; border: 1px solid #e7e3da; background: #ffffff; overflow: hidden; }

          @media (max-width: 768px) {
            .tdls-skel { flex-direction: column; gap: 8px; max-height: calc(100dvh - max(var(--safe-top, 0px), 0px) - max(var(--safe-bottom, 0px), 0px) - 10px); }
            .tdls-skel-rail {
              flex: none; max-width: 100%;
              border-right: none; padding-right: 0; padding-bottom: 6px;
              border-bottom: 1px solid #e7e3da;
              flex-direction: row;
              overflow-x: auto; overflow-y: hidden;
              scroll-snap-type: x mandatory;
              -webkit-overflow-scrolling: touch;
            }
            .tdls-skel-rail > * { scroll-snap-align: start; }
            .tdls-skel-pill { flex: 0 0 108px; height: 28px; }
          }
        `}</style>

        <div className="tdls-skel">
          <div className="tdls-skel-rail" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="tdls-skel-pill" />
            ))}
          </div>
          <div className="tdls-skel-detail" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0) {
    return autoError ? (
      <div
        style={{
          width: "100%",
          minHeight: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#8A1F1F",
          fontWeight: 800,
          letterSpacing: ".04em",
          padding: 12,
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        Menu unavailable ({autoError})
      </div>
    ) : null;
  }

  const activeNode = effectiveOptions[activeIndex] || effectiveOptions[0];

  return (
    <>
      <style>{`
        .tdls-flyout-host{
          --tdls-gap: 12px;
          --tdls-rail-w: 210px;
          --tdls-rail-w-max: 260px;
          --tdls-border: #e7e3da;
          --tdls-ink: #201D14;
          --tdls-navy: #163060;
          --tdls-bg: #ffffff;

          /* Desktop panel density */
          --tdls-panel-radius: 16px;

          /* Mobile ultra-density tokens (smaller than before) */
          --tdls-m-rail-h: 34px;
          --tdls-m-chip-h: 28px;
          --tdls-m-chip-px: 10px;
          --tdls-m-chip-font: 11px;

          --tdls-m-head-h: 26px;         /* micro header */
          --tdls-m-sec-h: 14px;          /* micro section label */
          --tdls-m-item-h: 30px;         /* denser items */
          --tdls-m-gap: 6px;
          --tdls-m-pad: 6px;

          width: 100%;
          min-width: 0;
          overflow: hidden;
          padding: 0;
          contain: layout paint style;
        }

        .tdls-focusable:focus{ outline: none; }
        .tdls-focusable:focus-visible{ box-shadow: var(--ring-focus, 0 0 0 2px rgba(36, 31, 68, 0.22)); }

        .tdls-flyout{
          width: 100%;
          display: flex;
          gap: var(--tdls-gap);
          min-height: 220px;
          max-height: min(60dvh, 520px);
          overflow: hidden;
          overflow-x: hidden;
          min-width: 0;
        }

        .tdls-rail{
          flex: 0 0 var(--tdls-rail-w);
          max-width: var(--tdls-rail-w-max);
          border-right: 1px solid var(--tdls-border);
          padding-right: 10px;

          display: flex;
          flex-direction: column;
          gap: 6px;

          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;

          min-width: 0;
        }

        .tdls-detail{
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
        }

        /* Desktop: keep premium structured layout (unchanged behavior) */
        .tdls-detail-scroll{
          overflow: auto;
          overflow-x: hidden;
          max-height: 100%;
          -webkit-overflow-scrolling: touch;
          padding-right: 2px;
        }

        /* ===================== RADICAL MOBILE DENSITY LAYOUT ===================== */
        @media (max-width: 768px){
          .tdls-flyout{
            flex-direction: column;
            gap: 6px;

            /* NEVER overflow the viewport; internal scroll only */
            max-height: calc(100dvh - max(var(--safe-top, 0px), 0px) - max(var(--safe-bottom, 0px), 0px) - 8px);
            min-height: 220px;
          }

          /* Rail becomes a compact chip bar with minimal height */
          .tdls-rail{
            flex: none;
            max-width: 100%;
            border-right: none;
            padding-right: 0;

            border-bottom: 1px solid rgba(15,33,71,0.10);
            padding-bottom: 4px;

            flex-direction: row;
            align-items: center;
            gap: 8px;

            height: var(--tdls-m-rail-h);
            overflow-x: auto;
            overflow-y: hidden;
            white-space: nowrap;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;

            padding-left: max(6px, var(--page-gutter-x, 12px));
            padding-right: max(6px, var(--page-gutter-x, 12px));
          }
          .tdls-rail > * { scroll-snap-align: start; }
          .tdls-rail::-webkit-scrollbar{ height: 0px; }

          .tdls-detail{
            min-width: 0;
            overflow: hidden;
          }
          .tdls-detail-scroll{
            padding: 0;
            height: 100%;
          }

          /* Mobile detail shell */
          .tdls-m-shell{
            height: 100%;
            background: #ffffff;
            border: 1px solid rgba(15,33,71,0.08);
            border-radius: 16px;
            box-shadow: var(--shadow-card, 0 10px 26px rgba(0,0,0,0.05));
            overflow: hidden;
            min-width: 0;
          }

          /* Micro sticky header inside detail (premium + minimal height) */
          .tdls-m-head{
            position: sticky;
            top: 0;
            z-index: 2;
            height: var(--tdls-m-head-h);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 0 8px;

            background: linear-gradient(180deg, rgba(233,241,251,0.55) 0%, rgba(255,255,255,0.96) 100%);
            border-bottom: 1px solid rgba(15,33,71,0.08);
          }
          .tdls-m-title{
            min-width: 0;
            font-weight: 950;
            font-size: 11px;
            letter-spacing: .10em;
            text-transform: uppercase;
            color: rgba(15,33,71,0.78);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .tdls-m-cta{
            flex-shrink: 0;
            font-weight: 900;
            font-size: 10px;
            letter-spacing: .12em;
            text-transform: uppercase;
            text-decoration: none;
            color: rgba(15,33,71,0.78);
            border: 1px solid rgba(15,33,71,0.12);
            background: #fff;
            height: 22px;
            padding: 0 9px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .tdls-m-cta:hover{ background: rgba(233,241,251,0.7); }

          /* Mobile scroll area = full remaining height */
          .tdls-m-body{
            padding: var(--tdls-m-pad);
            overflow: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;

            /* take the remaining height inside the shell */
            max-height: calc(100% - var(--tdls-m-head-h));
          }

          /* Micro section header */
          .tdls-m-sec{
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            height: var(--tdls-m-sec-h);
            padding: 0 6px;
            margin-top: 6px;
            color: rgba(15,33,71,0.64);
            font-weight: 950;
            font-size: 10px;
            letter-spacing: .12em;
            text-transform: uppercase;
            min-width: 0;
          }
          .tdls-m-sec:first-child{ margin-top: 2px; }

          .tdls-m-sec a{
            text-decoration: none;
            color: rgba(15,33,71,0.68);
            flex-shrink: 0;
          }

          /* Dense responsive grid: 2–4 columns depending on space */
          .tdls-m-grid{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
            gap: var(--tdls-m-gap);
            padding: 2px 4px 6px 4px;
            min-width: 0;
          }

          /* Ultra-dense item */
          .tdls-m-item{
            height: var(--tdls-m-item-h);
            border-radius: 12px;
            border: 1px solid rgba(15,33,71,0.10);
            background: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 10px;
            min-width: 0;
            text-decoration: none;
            color: rgba(15,33,71,0.92);
            font-weight: 850;
            font-size: 12px;
            line-height: 1;
          }
          .tdls-m-item:hover{
            background: rgba(233,241,251,0.65);
            border-color: rgba(15,33,71,0.16);
          }
          .tdls-m-item span{
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          /* Badges: minimal footprint */
          .tdls-m-badges{
            margin-left: auto;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
          }
          .tdls-m-dot{
            width: 6px;
            height: 6px;
            border-radius: 999px;
            background: rgba(22,48,96,0.62);
            box-shadow: 0 0 0 1px rgba(22,48,96,0.14);
          }
          .tdls-m-tag{
            font-size: 9px;
            font-weight: 950;
            letter-spacing: .10em;
            text-transform: uppercase;
            padding: 2px 6px;
            border-radius: 999px;
            background: #EEDFB6;
            color: #1B2233;
            border: 1px solid rgba(0,0,0,0.08);
            line-height: 1;
          }

          /* Extreme small screens: keep it dense but safe */
          @media (max-width: 360px){
            .tdls-m-grid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
          }
        }
      `}</style>

      <div className="tdls-flyout-host">
        <div className="tdls-flyout">
          {/* LEFT/TOP rail */}
          <div className="tdls-rail">
            {effectiveOptions.map((node, idx) => {
              const branchActive = isNodeActiveBranch(node, pathname);
              const isCurrent = idx === activeIndex;
              return (
                <RailItem
                  key={node.href || `${node.label}-${idx}`}
                  node={node}
                  isCurrent={isCurrent}
                  branchActive={branchActive}
                  onSelect={() => setActiveIndex(idx)}
                  pathname={pathname}
                  isMobile={isMobile}
                />
              );
            })}
          </div>

          {/* RIGHT/BOTTOM detail */}
          <div className="tdls-detail">
            <div className="tdls-detail-scroll">
              <NodeDetail node={activeNode} pathname={pathname} isMobile={isMobile} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ====================== LEFT RAIL ITEM ====================== */

function RailItem({ node, isCurrent, branchActive, onSelect, isMobile }) {
  const isClickable = Boolean(node.href);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isActive = branchActive;

  const baseBg = isCurrent || isActive ? "#163060" : "transparent";
  const baseColor = isCurrent || isActive ? "#faf9f6" : "#201D14";

  const style = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: isMobile ? "0 var(--tdls-m-chip-px)" : "6px 10px",
    borderRadius: 999,
    background: baseBg,
    color: baseColor,
    cursor: "pointer",
    textDecoration: "none",
    fontFamily: isMobile
      ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      : "'Playfair Display', serif",
    fontWeight: 900,
    fontSize: isMobile ? "var(--tdls-m-chip-font)" : "0.96rem",
    letterSpacing: isMobile ? ".02em" : ".09em",
    textTransform: isMobile ? "none" : "uppercase",
    transition: "background .16s ease, color .16s ease, transform .12s ease, box-shadow .16s ease",
    boxShadow: isCurrent || isActive ? "0 6px 18px rgba(22,48,96,0.26)" : "none",
    maxWidth: "100%",
    whiteSpace: "nowrap",
    height: isMobile ? "var(--tdls-m-chip-h)" : undefined,
    minHeight: isMobile ? "var(--tdls-m-chip-h)" : "var(--tap-target-min, 44px)",
  };

  const onOver = (el) => {
    if (!el) return;
    if (!isMobile) {
      el.style.transform = "translateX(2px) scale(1.01)";
      el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.18)";
      if (!isCurrent && !isActive) {
        el.style.background = "#E9F1FB";
        el.style.color = "#163060";
      }
    }
  };

  const onOut = (el) => {
    if (!el) return;
    el.style.transform = "none";
    el.style.boxShadow = isCurrent || isActive ? "0 6px 18px rgba(22,48,96,0.26)" : "none";
    el.style.background = baseBg;
    el.style.color = baseColor;
  };

  const content = (
    <>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{node.label}</span>

      {!isMobile && Array.isArray(node.badges) && node.badges.length > 0 && (
        <span style={{ marginLeft: 6, display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {node.badges.slice(0, 2).map((b) => (
            <span
              key={b}
              style={{
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: ".08em",
                padding: "2px 6px",
                borderRadius: 999,
                background: "#EEDFB6",
                color: "#1B2233",
                border: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              {b}
            </span>
          ))}
        </span>
      )}

      {!isMobile && (isClickable || hasChildren) && (
        <ChevronRight size={14} style={{ marginLeft: "auto", opacity: 0.6, flexShrink: 0 }} />
      )}
    </>
  );

  /**
   * MOBILE NAV FIX:
   * - If item has children on mobile:
   *   - First tap selects (prevents navigation)
   *   - Second tap (when already current) navigates normally
   */
  const shouldTapSelect = Boolean(isMobile && hasChildren && !isCurrent);

  if (isClickable) {
    return (
      <Link
        className="tdls-focusable"
        href={node.href}
        prefetch
        style={style}
        onMouseEnter={(e) => {
          if (!isMobile) onSelect();
          onOver(e.currentTarget);
        }}
        onMouseLeave={(e) => onOut(e.currentTarget)}
        onPointerDown={(e) => {
          if (shouldTapSelect) {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
          }
        }}
        onClick={(e) => {
          if (shouldTapSelect) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className="tdls-focusable"
      style={style}
      onMouseEnter={(e) => {
        if (!isMobile) onSelect();
        onOver(e.currentTarget);
      }}
      onMouseLeave={(e) => onOut(e.currentTarget)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      {content}
    </div>
  );
}

/* ====================== RIGHT PANE DETAIL ====================== */

function NodeDetail({ node, pathname, isMobile }) {
  const hasChildren = Array.isArray(node?.children) && node.children.length > 0;

  // IMPORTANT: hooks must never be conditional.
  const mobileSections = useMemo(() => {
    if (!isMobile || !node) return [];
    return buildMobileSections(node);
  }, [isMobile, node]);

  if (!node) return null;

  // MOBILE: ultra-dense single scroller + responsive grid sections.
  if (isMobile) {
    return (
      <div className="tdls-m-shell">
        <div className="tdls-m-head">
          <div className="tdls-m-title" title={node.label}>
            {node.label}
          </div>
          {node.href ? (
            <Link className="tdls-focusable tdls-m-cta" href={node.href} prefetch>
              View
            </Link>
          ) : null}
        </div>

        <div className="tdls-m-body">
          {!hasChildren ? (
            <div className="tdls-m-grid" style={{ paddingTop: 4 }}>
              <MobileItem node={node} pathname={pathname} />
            </div>
          ) : (
            mobileSections.map((sec, i) => (
              <div key={sec.head?.href || `${sec.head?.label || "sec"}-${i}`} style={{ minWidth: 0 }}>
                {/* Micro section header (hidden if only one section) */}
                {sec.hideHeaderVisual ? (
                  <div
                    style={{
                      position: "absolute",
                      left: -99999,
                      top: "auto",
                      width: 1,
                      height: 1,
                      overflow: "hidden",
                    }}
                  >
                    {sec.head?.label || "Section"}
                  </div>
                ) : (
                  <div className="tdls-m-sec">
                    <span
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sec.head?.label || "Section"}
                    </span>
                    {sec.head?.href ? (
                      <Link className="tdls-focusable" href={sec.head.href} prefetch>
                        Open
                      </Link>
                    ) : null}
                  </div>
                )}

                <div className="tdls-m-grid">
                  {sec.items.map((it, idx) => (
                    <MobileItem key={it?.href || `${it?.label || "item"}-${idx}`} node={it} pathname={pathname} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // DESKTOP/TABLET: keep premium structured layout (compact but readable).
  if (!hasChildren) {
    return (
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e7e3da",
          borderRadius: 16,
          padding: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "var(--shadow-card, 0 10px 26px rgba(0,0,0,0.05))",
          overflow: "hidden",
        }}
      >
        <LabelLink node={node} depth={0} pathname={pathname} />
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <LabelLink node={node} depth={0} pathname={pathname} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          width: "100%",
          overflow: "hidden",
        }}
      >
        {node.children.map((child, idx) => (
          <DetailColumn key={child.href || `${child.label}-${idx}`} node={child} pathname={pathname} />
        ))}
      </div>
    </>
  );
}

/* ====================== MOBILE ITEM ====================== */

function MobileItem({ node, pathname }) {
  if (!node) return null;

  const isClickable = Boolean(node.href);
  const isSelfActive =
    isClickable && pathname && (pathname === node.href || pathname.startsWith(node.href + "/"));

  const badges = Array.isArray(node.badges) ? node.badges.slice(0, 1) : [];

  const content = (
    <>
      <span title={node.label}>{node.label}</span>
      <span className="tdls-m-badges" aria-hidden="true">
        {badges.length ? <span className="tdls-m-tag">{badges[0]}</span> : <span className="tdls-m-dot" />}
      </span>
    </>
  );

  if (isClickable) {
    return (
      <Link
        className="tdls-focusable tdls-m-item"
        href={node.href}
        prefetch
        style={{
          borderColor: isSelfActive ? "rgba(22,48,96,0.24)" : undefined,
          background: isSelfActive ? "rgba(233,241,251,0.70)" : undefined,
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="tdls-m-item" style={{ opacity: 0.92 }} role="button" tabIndex={0}>
      {content}
    </div>
  );
}

/* ====================== COLUMN CARD (DESKTOP) ====================== */

function DetailColumn({ node, pathname }) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e7e3da",
        borderRadius: 16,
        padding: "10px 12px",
        minHeight: 80,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: "var(--shadow-card, 0 8px 24px rgba(0,0,0,0.04))",
        overflow: "hidden",
      }}
    >
      <LabelLink node={node} depth={1} pathname={pathname} />

      {hasChildren && (
        <div
          style={{
            marginTop: 2,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: "min(36dvh, 340px)",
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
            paddingRight: 2,
          }}
        >
          {node.children.map((child, idx) => {
            const hasGrand = Array.isArray(child.children) && child.children.length > 0;
            return (
              <div
                key={child.href || `${child.label}-${idx}`}
                style={{
                  paddingTop: idx === 0 ? 0 : 6,
                  borderTop: idx === 0 ? "none" : "1px dashed #efe0c7",
                  overflow: "hidden",
                }}
              >
                <LabelLink node={child} depth={2} pathname={pathname} />

                {hasGrand && (
                  <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {child.children.map((grand, gidx) => (
                      <LabelLink
                        key={grand.href || `${grand.label}-${gidx}`}
                        node={grand}
                        depth={3}
                        pathname={pathname}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ====================== LABEL + LINK (Tier styling) ====================== */

function LabelLink({ node, depth, pathname }) {
  const isClickable = Boolean(node.href);
  const isSelfActive =
    isClickable && pathname && (pathname === node.href || pathname.startsWith(node.href + "/"));

  const bgActive = "#163060";
  const fgActive = "#faf9f6";

  const bgBase = depth === 0 ? "#faf7ee" : depth === 1 ? "#f7f3e7" : "transparent";
  const fgBase = depth <= 1 ? "#201D14" : "#163060";

  const background = isSelfActive ? bgActive : bgBase;
  const color = isSelfActive ? fgActive : fgBase;

  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: depth === 0 ? "6px 12px" : depth === 1 ? "6px 10px" : depth === 2 ? "4px 8px" : "4px 8px",
    borderRadius: depth >= 2 ? 999 : 12,
    background,
    color,
    fontFamily:
      depth === 0
        ? "'Playfair Display', serif"
        : "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontWeight: depth === 0 ? 900 : depth === 1 ? 800 : 700,
    fontSize: depth === 0 ? "1.0rem" : depth === 1 ? "0.94rem" : depth === 2 ? "0.88rem" : "0.82rem",
    letterSpacing: depth === 0 ? ".06em" : ".02em",
    textTransform: depth === 0 ? "uppercase" : "none",
    textDecoration: "none",
    cursor: isClickable ? "pointer" : "default",
    maxWidth: "100%",
    transition: "background .16s ease, color .16s ease, transform .12s ease, box-shadow .16s ease",
    boxShadow: isSelfActive ? "0 6px 18px rgba(22,48,96,0.28)" : "none",
    whiteSpace: depth >= 2 ? "nowrap" : "normal",
    overflow: "hidden",
    minHeight: depth <= 1 ? "var(--tap-target-min, 44px)" : undefined,
  };

  const onOver = (el) => {
    if (!el) return;
    el.style.transform = "translateY(-1px)";
    el.style.boxShadow = "0 6px 16px rgba(0,0,0,0.12)";
    if (!isSelfActive) {
      el.style.background = "#E9F1FB";
      el.style.color = "#163060";
    }
  };

  const onOut = (el) => {
    if (!el) return;
    el.style.transform = "none";
    el.style.boxShadow = isSelfActive ? "0 6px 18px rgba(22,48,96,0.28)" : "none";
    el.style.background = background;
    el.style.color = color;
  };

  const content = (
    <>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: depth >= 2 ? 160 : "100%",
        }}
      >
        {node.label}
      </span>
      {isClickable && depth >= 2 && <ChevronRight size={12} style={{ opacity: 0.55, flexShrink: 0 }} />}
    </>
  );

  if (isClickable) {
    return (
      <Link
        className="tdls-focusable"
        href={node.href}
        prefetch
        style={baseStyle}
        onMouseEnter={(e) => onOver(e.currentTarget)}
        onMouseLeave={(e) => onOut(e.currentTarget)}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      className="tdls-focusable"
      style={baseStyle}
      onMouseEnter={(e) => onOver(e.currentTarget)}
      onMouseLeave={(e) => onOut(e.currentTarget)}
    >
      {content}
    </div>
  );
}
