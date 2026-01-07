// src/components/common/menucontainer.jsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

/**
 * MenuContainer (single-file, no flyout)
 * - Canonical routing: /collections/{audienceSlug}
 * - Fetches Strapi audience categories (supports your JSON: { data:[{id, attributes:{name,slug,priority}}] })
 * - Auto-supports branches if Strapi later adds children relations
 * - Premium overlay UI with your fixed 4-tier system:
 *    1) Limited Edition
 *    2) Premium Collection
 *    3) Signature Series
 *    4) Heritage Collection
 * - Strong fallback if Strapi is unreachable (never blank)
 */

const CANONICAL_PREFIX = "/collections";

function normalizeStrapiBase(raw) {
  const s = (raw || "").toString().trim().replace(/\/$/, "");
  if (!s) return "";
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
  const slug = s.includes(" ") ? slugify(s) : s;
  const cleaned = slug.replace(/^\/+/, "");
  if (!cleaned) return null;
  return `${CANONICAL_PREFIX}/${cleaned}`;
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
  return (
    obj.name ||
    obj.title ||
    obj.label ||
    obj.displayName ||
    obj.heading ||
    obj.text ||
    ""
  );
}

function pickSlug(obj) {
  if (!obj) return "";
  return obj.slug || obj.handle || obj.key || obj.uid || "";
}

function pickPriority(obj) {
  if (!obj) return null;
  const v = obj.priority ?? obj.order ?? obj.sort ?? obj.rank ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickChildren(obj) {
  if (!obj) return [];
  // common relation names you might use later:
  const rel =
    obj.children ||
    obj.branches ||
    obj.items ||
    obj.subcategories ||
    obj.subCategories ||
    obj.sub_categories ||
    obj.nodes ||
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
  const children = kidsRaw
    .map((c) => toNode(c, depth + 1, maxDepth))
    .filter(Boolean);

  return {
    id: e.id ?? `${slug}:${depth}`,
    label,
    slug,
    href,
    priority: pickPriority(e),
    children,
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
    const al = (a?.label || "").toLowerCase();
    const bl = (b?.label || "").toLowerCase();
    return al.localeCompare(bl);
  });
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

async function fetchAudienceCategories() {
  const base = getStrapiBase();

  // Deep populate first (for future branches), then simple populate
  const urls = [
    `${base}/api/audience-categories?pagination[pageSize]=500&sort=priority:asc&populate[children][populate][children][populate][children]=*&populate=*`,
    `${base}/api/audience-categories?pagination[pageSize]=500&sort=priority:asc&populate=*`,
    `${base}/api/audience-categories?pagination[pageSize]=500&sort=priority:asc`,
    `${base}/api/audience-categories?pagination[pageSize]=500`,
  ];

  const attempts = [];
  for (const url of urls) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const r = await fetchJsonWithTimeout(url);
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    attempts.push({
      url,
      ok: r.ok,
      status: r.status,
      ms: Math.round(t1 - t0),
      hint: r.ok ? "OK" : (r.json?.error?.message || r.text || "").slice(0, 160),
    });

    if (!r.ok || !r.json) continue;

    const raw = r.json?.data;
    const list = Array.isArray(raw) ? raw.map(normalizeEntity).filter(Boolean) : [];
    if (list.length) return { items: list, attempts, sourceUrl: url };
  }

  const last = attempts[attempts.length - 1];
  throw new Error(
    `audience_categories_fetch_failed (${last?.status || "?"}) ${last?.hint || ""}`.trim()
  );
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
      }}
    >
      <Link
        href={node.href}
        onClick={onNavigate}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          textDecoration: "none",
          color: "#0F2147",
        }}
      >
        <div style={{ fontWeight: 950, fontSize: 15, letterSpacing: ".02em" }}>
          {node.label}
        </div>
        <div
          style={{
            fontWeight: 900,
            fontSize: 12,
            color: "rgba(15,33,71,0.55)",
            letterSpacing: ".12em",
            textTransform: "uppercase",
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

export default function MenuContainer({ open = true, onClose = null, options = null }) {
  const usingExternal = Array.isArray(options) && options.length > 0;

  const [nodes, setNodes] = useState([]);
  const [activeTierIdx, setActiveTierIdx] = useState(0);
  const [query, setQuery] = useState("");

  const [diag, setDiag] = useState({
    loading: false,
    error: null,
    sourceUrl: null,
    rawCount: 0,
  });

  useEffect(() => {
    if (!open) return;

    // If parent provides options, we use them (still canonical href expected)
    if (usingExternal) {
      const normalized = dedupeByHref(
        (options || [])
          .map((x) => ({
            ...x,
            href: x?.href || canonicalHref(x?.slug || x?.label),
            children: Array.isArray(x?.children) ? x.children : [],
          }))
          .filter((x) => x?.label && x?.href)
      );
      setNodes(sortNodes(normalized));
      setDiag({ loading: false, error: null, sourceUrl: "external-options", rawCount: normalized.length });
      return;
    }

    let mounted = true;
    setDiag((d) => ({ ...d, loading: true, error: null }));

    fetchAudienceCategories()
      .then(({ items, sourceUrl }) => {
        if (!mounted) return;
        const flat = items.map((it) => toNode(it, 0, 4)).filter(Boolean);
        const deduped = dedupeByHref(flat);
        const sorted = sortNodes(deduped);
        setNodes(sorted);
        setDiag({
          loading: false,
          error: null,
          sourceUrl,
          rawCount: items.length,
        });
      })
      .catch((e) => {
        if (!mounted) return;
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
        setNodes(fb);
        setDiag({
          loading: false,
          error: e?.message || "menu_fetch_failed",
          sourceUrl: null,
          rawCount: 0,
        });
      });

    return () => {
      mounted = false;
    };
  }, [open, usingExternal, options]);

  // Lock scroll + ESC-to-close while menu is open (prevents “blank page” feeling and keeps UX snappy)
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
          onClose?.();
        } catch {}
      }
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  const q = query.trim().toLowerCase();

  const filteredNodes = useMemo(() => {
    if (!q) return nodes;
    const match = (s) => (s || "").toLowerCase().includes(q);

    // match category label OR any branch label
    return (nodes || []).filter((n) => {
      if (match(n.label)) return true;
      if (Array.isArray(n.children) && n.children.some((c) => match(c.label))) return true;
      return false;
    });
  }, [nodes, q]);

  if (!open) return null;

  const activeTier = TIERS[Math.max(0, Math.min(activeTierIdx, TIERS.length - 1))];
  const tierHref = canonicalHref(activeTier.key) || `${CANONICAL_PREFIX}/${activeTier.key}`;

  const close = () => {
    if (typeof onClose === "function") onClose();
  };

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
            padding: "24px 12px",
          }}
          onMouseDown={(e) => {
            // click outside closes
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ y: 14, scale: 0.985, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 14, scale: 0.985, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{
              width: "min(1180px, 94vw)",
              borderRadius: 26,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(252,252,255,0.96) 100%)",
              boxShadow: "0 40px 120px rgba(0,0,0,0.25)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: 16,
                borderBottom: "1px solid rgba(15,33,71,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    fontFamily: "'Playfair Display', serif",
                    fontWeight: 900,
                    letterSpacing: ".10em",
                    color: "#0F2147",
                    textTransform: "uppercase",
                    fontSize: 16,
                  }}
                >
                  Collections
                </div>
                <div style={{ color: "rgba(15,33,71,0.65)", fontWeight: 850, fontSize: 12 }}>
                  Canonical routing: <span style={{ fontWeight: 950 }}>/collections/&lt;slug&gt;</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search audience…"
                  style={{
                    width: 320,
                    maxWidth: "52vw",
                    borderRadius: 999,
                    border: "1px solid rgba(15,33,71,0.12)",
                    padding: "10px 14px",
                    fontWeight: 850,
                    outline: "none",
                    background: "#fff",
                  }}
                />
                <button
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
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Content */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "280px 1fr",
                gap: 0,
              }}
            >
              {/* Left rail: 4 tiers */}
              <div
                style={{
                  padding: 14,
                  borderRight: "1px solid rgba(15,33,71,0.08)",
                  background: "linear-gradient(180deg, rgba(233,241,251,0.65) 0%, rgba(255,255,255,0.88) 100%)",
                }}
              >
                <div style={{ display: "grid", gap: 10 }}>
                  {TIERS.map((t, idx) => (
                    <TierPill key={t.key} active={idx === activeTierIdx} onClick={() => setActiveTierIdx(idx)}>
                      {t.label}
                    </TierPill>
                  ))}
                </div>

                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  <Link
                    href={tierHref}
                    onClick={close}
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
                    }}
                  >
                    Explore {activeTier.label}
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
                    }}
                  >
                    {diag.loading ? "Loading audience categories…" : "Audience categories loaded."}
                    {diag.error ? (
                      <div style={{ marginTop: 6, color: "rgba(168, 64, 64, 0.95)", fontWeight: 950 }}>
                        Fallback active
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Right: Audience categories grid */}
              <div style={{ padding: 16 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ fontWeight: 950, color: "#0F2147", fontSize: 16 }}>
                      Audience Categories
                    </div>
                    <div style={{ fontWeight: 850, color: "rgba(15,33,71,0.62)", fontSize: 12 }}>
                      Click anywhere (homepage, bottom bar, menu) → same slug → same page
                    </div>
                  </div>

                  <div style={{ fontWeight: 900, color: "rgba(15,33,71,0.60)", fontSize: 12 }}>
                    {filteredNodes.length} items
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 12,
                  }}
                >
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
