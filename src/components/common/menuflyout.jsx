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
 * MOBILE:
 * - No hover dependency (tap-to-select on rail).
 * - Stacked layout to prevent overflow (rail becomes horizontal scroller).
 * - Viewport-bounded heights + internal scrolling only.
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

async function fetchAudienceTree() {
  const paths = [
    "/audience-categories?populate[children][populate][children][populate][children]=*&populate=*&pagination[pageSize]=500",
    "/audience-categories?populate=*&pagination[pageSize]=500",
    "/audience-categories?pagination[pageSize]=500",
  ];

  for (const p of paths) {
    const r = await fetchViaProxy(p, 12000);
    if (!r.ok || !r.json) continue;

    const items = Array.isArray(r.json?.data)
      ? r.json.data.map(normalizeStrapiEntity).filter(Boolean)
      : [];

    if (items.length) return { items, sourcePath: p };
  }

  throw new Error("audience_categories_fetch_failed");
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
        // keep whatever cached we had; do not force empty unless nothing exists
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
  }, [effectiveOptions?.length]);

  if (!usingExternal && autoLoading && (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0)) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#163060",
          fontWeight: 800,
          letterSpacing: ".08em",
          fontFamily: "'Playfair Display', serif",
        }}
      >
        Loading collections…
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
        .tdls-flyout {
          width: 100%;
          display: flex;
          gap: 18px;
          min-height: 220px;
          max-height: min(60dvh, 520px);
          overflow: hidden;
        }
        .tdls-rail {
          flex: 0 0 210px;
          max-width: 260px;
          border-right: 1px solid #e7e3da;
          padding-right: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
        }
        .tdls-detail {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: hidden;
        }
        .tdls-detail-scroll {
          overflow: auto;
          overflow-x: hidden;
          max-height: 100%;
          -webkit-overflow-scrolling: touch;
        }

        /* Mobile: stacked, rail becomes horizontal scroller; no screen overflow */
        @media (max-width: 768px) {
          .tdls-flyout {
            flex-direction: column;
            gap: 10px;
            max-height: min(70dvh, 560px);
          }
          .tdls-rail {
            flex: none;
            max-width: 100%;
            border-right: none;
            padding-right: 0;
            padding-bottom: 6px;
            border-bottom: 1px solid #e7e3da;

            flex-direction: row;
            overflow-x: auto;
            overflow-y: hidden;
            white-space: nowrap;
            scroll-snap-type: x mandatory;
          }
          .tdls-rail > * { scroll-snap-align: start; }
        }
      `}</style>

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
    </>
  );
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
    padding: "6px 10px",
    borderRadius: 999,
    background: baseBg,
    color: baseColor,
    cursor: "pointer",
    textDecoration: "none",
    fontFamily: "'Playfair Display', serif",
    fontWeight: 800,
    fontSize: "0.96rem",
    letterSpacing: ".09em",
    textTransform: "uppercase",
    transition: "background .16s ease, color .16s ease, transform .12s ease, box-shadow .16s ease",
    boxShadow: isCurrent || isActive ? "0 6px 18px rgba(22,48,96,0.45)" : "none",
    maxWidth: "100%",
    whiteSpace: "nowrap",
  };

  const onOver = (el) => {
    if (!el) return;
    el.style.transform = "translateX(2px) scale(1.01)";
    el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.18)";
    if (!isCurrent && !isActive) {
      el.style.background = "#E9F1FB";
      el.style.color = "#163060";
    }
  };

  const onOut = (el) => {
    if (!el) return;
    el.style.transform = "none";
    el.style.boxShadow = isCurrent || isActive ? "0 6px 18px rgba(22,48,96,0.45)" : "none";
    el.style.background = baseBg;
    el.style.color = baseColor;
  };

  const content = (
    <>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
        {node.label}
      </span>

      {Array.isArray(node.badges) && node.badges.length > 0 && (
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

      {(isClickable || hasChildren) && (
        <ChevronRight size={14} style={{ marginLeft: "auto", opacity: 0.6, flexShrink: 0 }} />
      )}
    </>
  );

  // Mobile: if node has children, first tap should select (not navigate immediately).
  const shouldTapSelect = Boolean(isMobile && hasChildren);

  if (isClickable) {
    return (
      <Link
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
            return;
          }
          // otherwise normal nav
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
    >
      {content}
    </div>
  );
}

/* ====================== RIGHT PANE DETAIL ====================== */

function NodeDetail({ node, pathname, isMobile }) {
  if (!node) return null;

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  if (!hasChildren) {
    return (
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e7e3da",
          borderRadius: 18,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 10px 26px rgba(0,0,0,0.05)",
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
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(230px, 1fr))",
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

/* ====================== COLUMN CARD (Tier-2) ====================== */

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
        gap: 4,
        boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
        overflow: "hidden",
      }}
    >
      <LabelLink node={node} depth={1} pathname={pathname} />

      {hasChildren && (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: "min(34dvh, 320px)",
            overflowY: "auto",
            overflowX: "hidden",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {node.children.map((child, idx) => {
            const hasGrand = Array.isArray(child.children) && child.children.length > 0;
            return (
              <div
                key={child.href || `${child.label}-${idx}`}
                style={{
                  paddingTop: idx === 0 ? 0 : 4,
                  borderTop: idx === 0 ? "none" : "1px dashed #efe0c7",
                  overflow: "hidden",
                }}
              >
                <LabelLink node={child} depth={2} pathname={pathname} />

                {hasGrand && (
                  <div style={{ marginTop: 3, display: "flex", flexWrap: "wrap", gap: 4 }}>
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
    padding:
      depth === 0
        ? "6px 12px"
        : depth === 1
        ? "4px 10px"
        : depth === 2
        ? "3px 8px"
        : "3px 7px",
    borderRadius: depth >= 2 ? 999 : 10,
    background,
    color,
    fontFamily:
      depth === 0
        ? "'Playfair Display', serif"
        : "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontWeight: depth === 0 ? 800 : depth === 1 ? 700 : 600,
    fontSize:
      depth === 0 ? "1.0rem" : depth === 1 ? "0.95rem" : depth === 2 ? "0.9rem" : "0.82rem",
    letterSpacing: depth === 0 ? ".06em" : ".02em",
    textTransform: depth === 0 ? "uppercase" : "none",
    textDecoration: "none",
    cursor: isClickable ? "pointer" : "default",
    maxWidth: "100%",
    transition: "background .16s ease, color .16s ease, transform .12s ease, box-shadow .16s ease",
    boxShadow: isSelfActive ? "0 6px 18px rgba(22,48,96,0.35)" : "none",
    whiteSpace: depth >= 2 ? "nowrap" : "normal",
    overflow: "hidden",
  };

  const onOver = (el) => {
    if (!el) return;
    el.style.transform = "translateY(-1px) scale(1.02)";
    el.style.boxShadow = "0 6px 16px rgba(0,0,0,0.15)";
    if (!isSelfActive) {
      el.style.background = "#E9F1FB";
      el.style.color = "#163060";
    }
  };

  const onOut = (el) => {
    if (!el) return;
    el.style.transform = "none";
    el.style.boxShadow = isSelfActive ? "0 6px 18px rgba(22,48,96,0.35)" : "none";
    el.style.background = background;
    el.style.color = color;
  };

  const content = (
    <>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: depth >= 2 ? 140 : "100%" }}>
        {node.label}
      </span>
      {isClickable && depth >= 2 && <ChevronRight size={12} style={{ opacity: 0.6, flexShrink: 0 }} />}
    </>
  );

  if (isClickable) {
    return (
      <Link
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
    <div style={baseStyle} onMouseEnter={(e) => onOver(e.currentTarget)} onMouseLeave={(e) => onOut(e.currentTarget)}>
      {content}
    </div>
  );
}
