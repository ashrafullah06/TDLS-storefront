//my-project/src/components/common/menuflyout.jsx

"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

/**
 * Node shape:
 * { label: string, href?: string, badges?: string[], children?: Node[] }
 *
 * FUTURISTIC MODE:
 * - If `options` prop is empty, MenuFlyout auto-fetches Audience Categories (and their branches)
 *   from Strapi and builds a 4-tier tree.
 * - Canonical routing everywhere: /collections/{slug}
 */

function normalizeStrapiBase(raw) {
  const s = (raw || "").toString().trim().replace(/\/$/, "");
  if (!s) return "";
  // If the env points to /api, strip it so we can safely append /api/<collection>
  return s.replace(/\/api$/i, "");
}

function getStrapiBase() {
  const envBase =
    normalizeStrapiBase(process.env.NEXT_PUBLIC_STRAPI_API_URL) ||
    normalizeStrapiBase(process.env.NEXT_PUBLIC_STRAPI_URL) ||
    normalizeStrapiBase(process.env.NEXT_PUBLIC_STRAPI_BASE_URL) ||
    "";

  if (typeof window !== "undefined") {
    try {
      const local = normalizeStrapiBase(window.localStorage.getItem("tdlc:strapiBase"));
      if (local) return local;
    } catch {}
  }

  return envBase || "http://localhost:1337";
}

async function fetchJsonWithTimeout(url, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

const CANONICAL_COLLECTION_PREFIX = "/collections";

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
  const s = (slug || "").toString().trim().replace(/^\/+/, "");
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
  // Accepts: {id, attributes}, {attributes}, plain object
  if (!entity) return null;
  if (entity.attributes) return entity.attributes;
  return entity;
}

function normalizeStrapiRelation(rel) {
  // Accepts: {data: []}, {data: {}}, array, or direct
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
  const candidates = [
    getAttr(item, "slug"),
    getAttr(item, "handle"),
    getAttr(item, "key"),
  ];
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

  // Cap to keep UI clean
  return badges.slice(0, 2);
}

function pickChildren(item) {
  // Try common branch keys (audience category tree)
  const keys = [
    "children",
    "branches",
    "subcategories",
    "subCategories",
    "nodes",
    "items",
  ];
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
  const children = childrenRaw
    .map((c) => toNode(c, depth + 1, maxDepth))
    .filter(Boolean);

  // If item has no label, skip (avoid broken blanks)
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
    if (pinnedSlugs.has(slug)) return -100; // top
    return 0;
  };
  return [...(nodes || [])].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    // Stable alphabetical
    return a.label.localeCompare(b.label);
  });
}

/* ====================== DATA FETCH (AUTO) ====================== */

async function fetchAudienceTree() {
  // We attempt a safe multi-level populate that works in Strapi v4 without requiring deep plugin.
  // 4-tier menu needs up to 3 nested children expansions.
  const base = getStrapiBase();

  const urls = [
    `${base}/api/audience-categories?populate[children][populate][children][populate][children]=*&populate=*&pagination[pageSize]=500`,
    `${base}/api/audience-categories?populate=*&pagination[pageSize]=500`,
    `${base}/api/audience-categories?pagination[pageSize]=500`,
  ];

  const attempts = [];
  for (const url of urls) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const r = await fetchJsonWithTimeout(url, 12000);
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

    attempts.push({
      url,
      ok: r.ok,
      status: r.status,
      ms: Math.round(t1 - t0),
      hint: r.ok ? "OK" : (r.json?.error?.message || r.text || "").slice(0, 160),
    });

    if (!r.ok || !r.json) continue;

    const items = Array.isArray(r.json?.data)
      ? r.json.data.map(normalizeStrapiEntity).filter(Boolean)
      : [];

    if (items.length) return { items, attempts, sourceUrl: url };
  }

  const last = attempts[attempts.length - 1];
  throw new Error(
    `audience_categories_fetch_failed (${last?.status || "?"}) ${last?.hint || ""}`.trim()
  );
}


/* ====================== COMPONENT ====================== */

export default function MenuFlyout({ options = [] }) {
  const pathname = usePathname();
  const [activeIndex, setActiveIndex] = useState(0);

  // Auto options (Strapi-driven)
  const [autoOptions, setAutoOptions] = useState([]);
  const [autoError, setAutoError] = useState(null);
  const [autoLoading, setAutoLoading] = useState(false);

  const usingExternal = Array.isArray(options) && options.length > 0;

  useEffect(() => {
    if (usingExternal) return;

    let mounted = true;
    setAutoLoading(true);
    setAutoError(null);

    fetchAudienceTree()
      .then(({ items }) => {
        if (!mounted) return;
        const nodes = items.map((it) => toNode(it, 0, 3)).filter(Boolean);
        const deduped = dedupeTree(nodes);
        const sorted = pinAndSortTopLevel(deduped);
        setAutoOptions(sorted);
      })
      .catch((e) => {
        if (!mounted) return;
        console.error("[MenuFlyout] auto-fetch failed:", e);
        setAutoError(e?.message || "menu_auto_fetch_failed");
        setAutoOptions([]);
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

  useEffect(() => {
    if (!Array.isArray(effectiveOptions) || effectiveOptions.length === 0) {
      setActiveIndex(0);
      return;
    }
    // Try to default to the branch that matches the current URL
    const idx = effectiveOptions.findIndex((n) => isNodeActiveBranch(n, pathname));
    setActiveIndex(idx === -1 ? 0 : idx);
  }, [effectiveOptions, pathname]);

  if (autoLoading && !usingExternal && effectiveOptions.length === 0) {
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
    // If Strapi fails, keep UX clean (no crash)
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
        }}
      >
        Menu unavailable ({autoError})
      </div>
    ) : null;
  }

  const activeNode = effectiveOptions[activeIndex] || effectiveOptions[0];

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        minHeight: 220,
        gap: 18,
      }}
    >
      {/* LEFT: primary rail (Audience Categories / Top-level Collections) */}
      <div
        style={{
          flex: "0 0 210px",
          maxWidth: 260,
          borderRight: "1px solid #e7e3da",
          paddingRight: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {effectiveOptions.map((node, idx) => {
          const branchActive = isNodeActiveBranch(node, pathname);
          const isCurrent = idx === activeIndex;
          return (
            <RailItem
              key={node.href || `${node.label}-${idx}`}
              node={node}
              isCurrent={isCurrent}
              branchActive={branchActive}
              onHover={() => setActiveIndex(idx)}
              pathname={pathname}
            />
          );
        })}
      </div>

      {/* RIGHT: detail area for the currently hovered/selected rail item */}
      <div
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <NodeDetail node={activeNode} pathname={pathname} />
      </div>
    </div>
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

function RailItem({ node, isCurrent, branchActive, onHover, pathname }) {
  const isClickable = Boolean(node.href);
  const isActive = branchActive;

  const baseBg = isCurrent || isActive ? "#163060" : "transparent";
  const baseColor = isCurrent || isActive ? "#faf9f6" : "#201D14";

  const style = {
    display: "flex",
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
      <span
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {node.label}
      </span>

      {/* Optional badges (NEW / LIMITED / HOT) */}
      {Array.isArray(node.badges) && node.badges.length > 0 && (
        <span
          style={{
            marginLeft: 6,
            display: "inline-flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
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

      {isClickable && <ChevronRight size={14} style={{ marginLeft: "auto", opacity: 0.6 }} />}
    </>
  );

  if (isClickable) {
    return (
      <Link
        href={node.href}
        prefetch
        style={style}
        onMouseEnter={(e) => {
          onHover();
          onOver(e.currentTarget);
        }}
        onMouseLeave={(e) => onOut(e.currentTarget)}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      style={style}
      onMouseEnter={(e) => {
        onHover();
        onOver(e.currentTarget);
      }}
      onMouseLeave={(e) => onOut(e.currentTarget)}
    >
      {content}
    </div>
  );
}

/* ====================== RIGHT PANE DETAIL ====================== */

function NodeDetail({ node, pathname }) {
  if (!node) return null;

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  // If no children, just show one big link card
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
        }}
      >
        <LabelLink node={node} depth={0} pathname={pathname} />
      </div>
    );
  }

  return (
    <>
      {/* Main branch header (Tier-1) */}
      <div style={{ marginBottom: 6 }}>
        <LabelLink node={node} depth={0} pathname={pathname} />
      </div>

      {/* Tier-2 columns; Tier-3 rows; Tier-4 pills */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 10,
          width: "100%",
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
      }}
    >
      {/* Tier-2 header */}
      <LabelLink node={node} depth={1} pathname={pathname} />

      {/* Tier-3 rows + Tier-4 pills */}
      {hasChildren && (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 260,
            overflowY: "auto",
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
                }}
              >
                {/* Tier-3 */}
                <LabelLink node={child} depth={2} pathname={pathname} />

                {/* Tier-4 pills */}
                {hasGrand && (
                  <div
                    style={{
                      marginTop: 3,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
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

  const bgBase =
    depth === 0 ? "#faf7ee" : depth === 1 ? "#f7f3e7" : "transparent";

  const fgBase = depth <= 1 ? "#201D14" : "#163060";

  const background = isSelfActive ? bgActive : bgBase;
  const color = isSelfActive ? fgActive : fgBase;

  const baseStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: depth === 0 ? "6px 12px" : depth === 1 ? "4px 10px" : depth === 2 ? "3px 8px" : "3px 7px",
    borderRadius: depth >= 2 ? 999 : 10,
    background,
    color,
    fontFamily:
      depth === 0
        ? "'Playfair Display', serif"
        : "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontWeight: depth === 0 ? 800 : depth === 1 ? 700 : 600,
    fontSize: depth === 0 ? "1.0rem" : depth === 1 ? "0.95rem" : depth === 2 ? "0.9rem" : "0.82rem",
    letterSpacing: depth === 0 ? ".06em" : ".02em",
    textTransform: depth === 0 ? "uppercase" : "none",
    textDecoration: "none",
    cursor: isClickable ? "pointer" : "default",
    maxWidth: "100%",
    transition: "background .16s ease, color .16s ease, transform .12s ease, box-shadow .16s ease",
    boxShadow: isSelfActive ? "0 6px 18px rgba(22,48,96,0.35)" : "none",
    whiteSpace: depth >= 2 ? "nowrap" : "normal",
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
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: depth >= 2 ? 120 : "100%" }}>
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
