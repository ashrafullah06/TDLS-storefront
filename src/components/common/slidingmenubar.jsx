// FILE: src/components/common/slidingmenubar.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * TDLC Sliding Menu Bar — Outlook redesign only (logic unchanged)
 * ------------------------------------------------------------------
 * Keeps: all routing/filtering/derivation logic exactly as-is.
 * Improves: space usage for 15–30 audiences, 50+ categories, 100+ products.
 * Fixes:
 * 1) Panel never goes under bottom floating bar (panel + overlay stop above it).
 * 2) Navbar cannot steal clicks (top click-shield + selective pointer-events disable).
 * 3) Dense list + dense product grid. Independent scroll columns. Minimal wasted space.
 * 4) Refine section: shows only if options exist; otherwise hidden (no dead UI).
 *
 * Update (requested):
 * - Increase distance between navbar and panel clickable options to avoid click stealing.
 *
 * NEW (requested):
 * - Close button: increase clickable space.
 * - Close menu when clicking: hamburger again (second click), anywhere on navbar, anywhere on bottom floating bar.
 * - Search: live suggestions + searches across audiences, categories, and products (global in-tier), not just current rail.
 */

const NAVBAR_HEIGHT = 96;

// ✅ Increased: push panel further down away from navbar hit-zone
const TOP_SAFE_GAP = 44;

// ✅ Increased: extend the top click-shield / pointer-events-disable zone
const TOP_CLICK_SHIELD_EXTRA = 64;

const MENU_WIDTH_DESKTOP = 1440;
const MENU_MAX_WIDTH = 1760;
const MENU_MIN_WIDTH = 360;

const DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT = 88;
// Optional override from CSS: :root { --tdlc-bottom-floating-bar-height: 96px; }
const BOTTOM_GAP = 10;

const Z_OVERLAY = 99998;
const Z_PANEL = 99999;
const Z_CLICK_SHIELD = 100000;

const TIERS = [
  { name: "Limited Edition", slug: "limited-edition" },
  { name: "Premium Collection", slug: "premium-collection" },
  { name: "Signature Series", slug: "signature-series" },
  { name: "Heritage Collection", slug: "heritage-collection" },
];

const isArr = (v) => Array.isArray(v);

function unwrapStrapiArray(v) {
  if (!v) return [];
  if (isArr(v)) return v;
  if (isArr(v?.data)) return v.data;
  if (v?.data && !isArr(v?.data)) return [v.data];
  return [];
}

function normalizeEntity(e) {
  if (!e) return null;
  if (e.attributes) return { id: e.id, ...e.attributes, attributes: e.attributes };
  return e;
}

function normSlug(input) {
  const raw = (input ?? "").toString().trim().toLowerCase();
  if (!raw) return "";
  const cutSemi = raw.split(";")[0];
  return cutSemi.replace(/[?#].*$/g, "").replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function titleizeSlug(slug) {
  const s = (slug || "").toString().trim();
  if (!s) return "";
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function pickTextForSlug(x) {
  const e = normalizeEntity(x) || {};
  return e.slug || e.handle || e.key || e.uid || e.code || e.name || e.title || e.label || "";
}

function pickName(x) {
  const e = normalizeEntity(x) || {};
  return (e.name || e.title || e.label || e.slug || "").toString().trim();
}

function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

const FIELD_ALIASES = {
  tiers: [
    "tiers",
    "tier",
    "brand_tiers",
    "brand_tier",
    "collection_tiers",
    "collection_tier",
    "events_products_collections",
    "events_products_collection",
    "product_collections",
    "product_collection",
    "collections",
    "collection",
  ],
  categories: ["categories", "category", "product_categories", "product_category"],
  audience_categories: ["audience_categories", "audience_category", "audiences", "audience", "audienceCategories"],
  sub_categories: ["sub_categories", "sub_category", "subCategories", "subCategory", "product_sub_categories", "product_sub_category"],
  gender_groups: ["gender_groups", "gender_group", "genderGroups", "genderGroup"],
  age_groups: ["age_groups", "age_group", "ageGroups", "ageGroup"],
};

function pickSlugs(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.map((x) => normSlug(pickTextForSlug(x))).filter(Boolean);
  if (obj?.data) {
    const d = obj.data;
    if (Array.isArray(d)) return d.map((x) => normSlug(pickTextForSlug(x))).filter(Boolean);
    return [normSlug(pickTextForSlug(d))].filter(Boolean);
  }
  if (typeof obj === "string" || typeof obj === "number") return [normSlug(obj)].filter(Boolean);
  return [normSlug(pickTextForSlug(obj))].filter(Boolean);
}

function extractRelSlugs(entity, canonicalKey) {
  const p = entity || {};
  const aliases = FIELD_ALIASES[canonicalKey] || [canonicalKey];

  const out = [];
  for (const k of aliases) pickSlugs(p?.[k]).forEach((s) => out.push(s));
  return uniq(out);
}

/* ------------------------------ Strapi proxy IO ------------------------------ */

async function fetchFromStrapi(path) {
  try {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const q = encodeURIComponent(normalizedPath);
    const res = await fetch(`/api/strapi?path=${q}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);
    return raw?.ok ? raw.data : raw;
  } catch {
    return null;
  }
}

async function fetchAudienceCategoriesWithProducts() {
  const payload = await fetchFromStrapi(
    "/audience-categories?pagination[pageSize]=500&populate[products][populate]=*&populate[tiers][populate]=*&populate[brand_tiers][populate]=*&populate[collection_tiers][populate]=*&populate[events_products_collections][populate]=*&populate[product_collections][populate]=*"
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map(normalizeEntity).filter(Boolean);
}

async function fetchProductsForIndex() {
  const payload = await fetchFromStrapi(
    "/products?pagination[pageSize]=1000&populate=*&populate[tiers]=*&populate[brand_tiers]=*&populate[collection_tiers]=*&populate[categories]=*&populate[audience_categories]=*&populate[sub_categories]=*&populate[gender_groups]=*&populate[age_groups]=*&populate[events_products_collections]=*&populate[product_collections]=*"
  );
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map(normalizeEntity).filter(Boolean);
}

/* ------------------------------- Derivations -------------------------------- */

function buildProductIndex(products) {
  const m = new Map();
  for (const pRaw of products || []) {
    const p = normalizeEntity(pRaw) || {};
    const id = p.id;
    if (!id) continue;

    const slug = normSlug(p.slug || "");
    const name = (p.name || p.title || "").toString().trim() || (slug ? titleizeSlug(slug) : `Product #${id}`);

    m.set(id, {
      id,
      slug,
      name,
      tierSlugs: extractRelSlugs(p, "tiers"),
      categorySlugs: extractRelSlugs(p, "categories"),
      audienceSlugs: extractRelSlugs(p, "audience_categories"),
      subCategorySlugs: extractRelSlugs(p, "sub_categories"),
      genderGroupSlugs: extractRelSlugs(p, "gender_groups"),
      ageGroupSlugs: extractRelSlugs(p, "age_groups"),
      raw: p,
    });
  }
  return m;
}

function computeAnyTierSignals(productIndex, audienceRows) {
  const productHasTiers = Array.from(productIndex.values()).some((p) => (p?.tierSlugs || []).length > 0);
  const audienceHasTiers = (audienceRows || []).some((a) => extractRelSlugs(a, "tiers").length > 0);
  return productHasTiers || audienceHasTiers;
}

function productBelongsToTier({ tier, productIdx, productEntity, audienceTierMatch, anyTierSignals }) {
  const t = normSlug(tier);

  const tierSlugs = (productIdx?.tierSlugs?.length ? productIdx.tierSlugs : extractRelSlugs(productEntity, "tiers")) || [];
  if (tierSlugs.length) return tierSlugs.includes(t);

  if (audienceTierMatch) return true;

  if (anyTierSignals) return false;
  return false;
}

function audienceTierVerdict({ audience, tierSlug, productIndex, anyTierSignals }) {
  const tier = normSlug(tierSlug);
  const a = normalizeEntity(audience) || {};
  const prodRel = unwrapStrapiArray(a?.products);
  if (!prodRel.length) return { ok: false, count: 0 };

  const audienceTierSlugs = extractRelSlugs(a, "tiers");
  const audienceTierMatch = audienceTierSlugs.length ? audienceTierSlugs.includes(tier) : false;

  let count = 0;
  for (const pr of prodRel) {
    const p = normalizeEntity(pr) || {};
    const pid = p.id;
    const idx = pid ? productIndex?.get(pid) : null;

    if (productBelongsToTier({ tier, productIdx: idx, productEntity: p, audienceTierMatch, anyTierSignals })) {
      count += 1;
    }
  }
  return { ok: count > 0, count };
}

function deriveCategories({ tierSlug, audience, productIndex, anyTierSignals }) {
  const tier = normSlug(tierSlug);
  const a = normalizeEntity(audience) || {};
  const prodRel = unwrapStrapiArray(a?.products);

  const audienceTierSlugs = extractRelSlugs(a, "tiers");
  const audienceTierMatch = audienceTierSlugs.length ? audienceTierSlugs.includes(tier) : false;

  const counts = new Map();
  for (const pr of prodRel) {
    const p = normalizeEntity(pr) || {};
    const pid = p.id;
    const idx = pid ? productIndex?.get(pid) : null;

    if (!productBelongsToTier({ tier, productIdx: idx, productEntity: p, audienceTierMatch, anyTierSignals })) continue;

    const cats = (idx?.categorySlugs?.length ? idx.categorySlugs : extractRelSlugs(p, "categories")) || [];
    for (const c of cats) counts.set(c, (counts.get(c) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([slug, count]) => ({ slug, name: titleizeSlug(slug), count }))
    .filter((x) => x.slug && x.count > 0)
    .sort((a2, b2) => (b2.count !== a2.count ? b2.count - a2.count : a2.name.localeCompare(b2.name)));
}

function deriveProducts({ tierSlug, audience, categorySlug, productIndex, anyTierSignals, filters }) {
  const tier = normSlug(tierSlug);
  const cat = categorySlug ? normSlug(categorySlug) : "";
  const a = normalizeEntity(audience) || {};
  const prodRel = unwrapStrapiArray(a?.products);

  const audienceTierSlugs = extractRelSlugs(a, "tiers");
  const audienceTierMatch = audienceTierSlugs.length ? audienceTierSlugs.includes(tier) : false;

  const sc = normSlug(filters?.subCategory);
  const gg = normSlug(filters?.genderGroup);
  const ag = normSlug(filters?.ageGroup);

  const out = [];
  for (const pr of prodRel) {
    const p = normalizeEntity(pr) || {};
    const pid = p.id;
    const idx = pid ? productIndex?.get(pid) : null;

    if (!productBelongsToTier({ tier, productIdx: idx, productEntity: p, audienceTierMatch, anyTierSignals })) continue;

    const cats = (idx?.categorySlugs?.length ? idx.categorySlugs : extractRelSlugs(p, "categories")) || [];
    if (cat && !cats.includes(cat)) continue;

    const subCats = idx?.subCategorySlugs?.length ? idx.subCategorySlugs : extractRelSlugs(p, "sub_categories");
    const genders = idx?.genderGroupSlugs?.length ? idx.genderGroupSlugs : extractRelSlugs(p, "gender_groups");
    const ages = idx?.ageGroupSlugs?.length ? idx.ageGroupSlugs : extractRelSlugs(p, "age_groups");

    if (sc && !subCats.includes(sc)) continue;
    if (gg && !genders.includes(gg)) continue;
    if (ag && !ages.includes(ag)) continue;

    const slug = idx?.slug || normSlug(p.slug);
    const name = idx?.name || (p.name || p.title || "").toString().trim() || titleizeSlug(slug);
    if (!slug) continue;

    out.push({ id: pid || p.id, slug, name });
  }

  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * CANONICAL ROUTE SHAPE:
 * - Path is audience-first (matches `[...segments]` parser)
 * - Tier stays in query only
 */
function buildCollectionsHref({ tier, audience, category, subCategory, genderGroup, ageGroup }) {
  const t = normSlug(tier);
  const a = audience ? normSlug(audience) : "";
  const c = category ? normSlug(category) : "";
  const sc = subCategory ? normSlug(subCategory) : "";
  const gg = genderGroup ? normSlug(genderGroup) : "";
  const ag = ageGroup ? normSlug(ageGroup) : "";

  const segments = [a, c, sc, gg, ag].filter(Boolean);
  const base = segments.length ? `/collections/${segments.map(encodeURIComponent).join("/")}` : "/collections";

  const qs = new URLSearchParams();
  if (t) qs.set("tier", t);
  return `${base}${qs.toString() ? `?${qs.toString()}` : ""}`;
}

/* ------------------------------- UI helpers -------------------------------- */

function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: "rgba(12,35,64,0.06)", fg: "#0c2340", bd: "rgba(12,35,64,0.10)" },
    gold: { bg: "rgba(191,167,80,0.20)", fg: "#0c2340", bd: "rgba(191,167,80,0.36)" },
    ink: { bg: "rgba(12,35,64,0.10)", fg: "#0c2340", bd: "rgba(12,35,64,0.18)" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${t.bd}`,
        background: t.bg,
        color: t.fg,
        fontWeight: 900,
        fontSize: 11,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function TierTabs({ tiers, activeSlug, onPick }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        overflowX: "auto",
        overflowY: "hidden",
        WebkitOverflowScrolling: "touch",
        paddingBottom: 2,
      }}
    >
      {tiers.map((t) => {
        const active = normSlug(activeSlug) === normSlug(t.slug);
        return (
          <button
            key={t.slug}
            type="button"
            onClick={() => onPick(t.slug)}
            style={{
              flex: "0 0 auto",
              borderRadius: 999,
              padding: "9px 12px",
              border: active ? "1px solid rgba(12,35,64,0.55)" : "1px solid rgba(0,0,0,0.10)",
              background: active ? "linear-gradient(135deg, #0c2340 10%, #163060 100%)" : "linear-gradient(135deg, #ffffff 55%, #fbf7ec 100%)",
              color: active ? "#fffdf8" : "#0c2340",
              fontWeight: 900,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              boxShadow: active ? "0 14px 26px rgba(12,35,64,0.18)" : "0 10px 18px rgba(0,0,0,0.05)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: 12,
            }}
            aria-pressed={active}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

function Shell({ title, right, children }) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.70)",
        boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
        overflow: "hidden",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "10px 10px",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "linear-gradient(135deg, rgba(255,255,255,0.92) 55%, rgba(247,243,231,0.92) 100%)",
        }}
      >
        <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 12, color: "#0c2340" }}>{title}</div>
        {right || null}
      </div>
      {children}
    </div>
  );
}

function CompactListItemLink({ href, onClick, onMouseEnter, active, title, subLeft, badge }) {
  return (
    <Link
      href={href}
      prefetch
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 10px",
        textDecoration: "none",
        borderRadius: 12,
        border: active ? "1px solid rgba(12,35,64,0.32)" : "1px solid rgba(0,0,0,0.06)",
        background: active ? "linear-gradient(135deg, rgba(12,35,64,0.10) 10%, rgba(191,167,80,0.14) 100%)" : "rgba(255,255,255,0.78)",
        boxShadow: active ? "0 10px 18px rgba(12,35,64,0.10)" : "0 8px 14px rgba(0,0,0,0.04)",
        color: "#0c2340",
        cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontWeight: 900,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            fontSize: 11,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={title}
        >
          {title}
        </div>
        {subLeft ? (
          <div
            style={{
              fontWeight: 800,
              fontSize: 10,
              color: "rgba(12,35,64,0.62)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={subLeft}
          >
            {subLeft}
          </div>
        ) : null}
      </div>

      {badge ? (
        <span
          style={{
            flexShrink: 0,
            padding: "4px 8px",
            borderRadius: 999,
            border: "1px solid rgba(12,35,64,0.14)",
            background: "rgba(12,35,64,0.06)",
            fontWeight: 900,
            fontSize: 10,
            letterSpacing: ".10em",
            textTransform: "uppercase",
          }}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function ScrollBody({ children }) {
  return (
    <div style={{ padding: 10, minHeight: 0, overflow: "auto" }}>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </div>
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        height: 34,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.96)",
        boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
        padding: "0 10px",
        fontWeight: 900,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        fontSize: 11,
        color: "#0c2340",
        outline: "none",
        maxWidth: 220,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.slug} value={o.slug}>
          {o.name} ({o.count})
        </option>
      ))}
    </select>
  );
}

/* ------------------------------ Facet options ------------------------------ */

function buildFacetOptions({ baseProducts, productIndex }) {
  const sub = new Map();
  const gg = new Map();
  const ag = new Map();

  for (const p of baseProducts || []) {
    const idx = p?.id ? productIndex.get(p.id) : null;
    if (!idx) continue;

    for (const s of idx.subCategorySlugs || []) sub.set(s, (sub.get(s) || 0) + 1);
    for (const s of idx.genderGroupSlugs || []) gg.set(s, (gg.get(s) || 0) + 1);
    for (const s of idx.ageGroupSlugs || []) ag.set(s, (ag.get(s) || 0) + 1);
  }

  const toArr = (m) =>
    Array.from(m.entries())
      .map(([slug, count]) => ({ slug, name: titleizeSlug(slug), count }))
      .filter((x) => x.slug && x.count > 0)
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));

  return { subCategories: toArr(sub), genderGroups: toArr(gg), ageGroups: toArr(ag) };
}

/* -------------------------- Search (global suggestions) -------------------------- */

function scoreMatch({ q, text }) {
  const qq = (q || "").trim().toLowerCase();
  const tt = (text || "").trim().toLowerCase();
  if (!qq || !tt) return -1;
  if (tt === qq) return 1000;
  if (tt.startsWith(qq)) return 900;
  const idx = tt.indexOf(qq);
  if (idx >= 0) return 700 - idx;
  return -1;
}

function makeSearchKey(name, slug) {
  return `${(name || "").toString()} ${(slug || "").toString()}`.trim();
}

/* ------------------------------- Component -------------------------------- */

export default function Slidingmenubar({ open, onClose }) {
  const router = useRouter();

  const [menuWidth, setMenuWidth] = useState(MENU_WIDTH_DESKTOP);
  const [isDesktop, setIsDesktop] = useState(false);

  const [tierSlug, setTierSlug] = useState(TIERS[0].slug);
  const [tierName, setTierName] = useState(TIERS[0].name);

  const [hoverAudienceSlug, setHoverAudienceSlug] = useState("");
  const [hoverCategorySlug, setHoverCategorySlug] = useState("");

  const [selectedSubCategory, setSelectedSubCategory] = useState("");
  const [selectedGenderGroup, setSelectedGenderGroup] = useState("");
  const [selectedAgeGroup, setSelectedAgeGroup] = useState("");

  const [q, setQ] = useState("");

  const [audienceRows, setAudienceRows] = useState([]);
  const [productIndex, setProductIndex] = useState(() => new Map());
  const [loading, setLoading] = useState(false);

  const [bottomBarHeight, setBottomBarHeight] = useState(DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT);

  const disabledNodesRef = useRef([]);

  // Search UX
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const searchWrapRef = useRef(null);

  const anyTierSignals = useMemo(() => computeAnyTierSignals(productIndex, audienceRows), [productIndex, audienceRows]);

  const panelTop = NAVBAR_HEIGHT + TOP_SAFE_GAP;
  const clickShieldHeight = panelTop + TOP_CLICK_SHIELD_EXTRA;

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      setIsDesktop(w >= 980);
      const target =
        w >= 1600 ? Math.min(MENU_MAX_WIDTH, w - 16) : w >= 980 ? Math.min(MENU_WIDTH_DESKTOP, w - 16) : Math.max(MENU_MIN_WIDTH, w);
      setMenuWidth(Math.max(MENU_MIN_WIDTH, Math.min(target, w)));
    }
    handleResize();
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Read bottom bar height from CSS var (optional). Default remains 88.
  useEffect(() => {
    if (!open) return;
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue("--tdlc-bottom-floating-bar-height");
      const n = parseInt((v || "").toString().replace("px", "").trim(), 10);
      if (Number.isFinite(n) && n > 40 && n < 240) setBottomBarHeight(n);
      else setBottomBarHeight(DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT);
    } catch {
      setBottomBarHeight(DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT);
    }
  }, [open]);

  // Auto-load every time open (kept)
  useEffect(() => {
    if (!open) return;
    let alive = true;

    setLoading(true);
    (async () => {
      try {
        const [aud, prods] = await Promise.all([fetchAudienceCategoriesWithProducts(), fetchProductsForIndex()]);
        if (!alive) return;
        setAudienceRows(aud || []);
        setProductIndex(buildProductIndex(prods || []));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  // Jump fix: lock body scroll + scrollbar compensation (kept)
  useEffect(() => {
    if (!open) return;

    const body = document.body;
    const html = document.documentElement;

    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyPadRight = body.style.paddingRight;

    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;

    body.style.overflow = "hidden";
    html.style.overflow = "hidden";

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.paddingRight = prevBodyPadRight;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  // Navbar click-steal fix (kept)
  useEffect(() => {
    if (!open) return;

    const selectors = [
      "nav",
      "header",
      "#navbar",
      ".navbar",
      ".topbar",
      ".site-header",
      ".header",
      ".sticky-header",
      ".fixed-header",
      "[data-navbar]",
      "[data-header]",
      "[role='navigation']",
      "#__next > header",
      "body > header",
      "body > nav",
    ];

    const nodes = [];
    for (const sel of selectors) document.querySelectorAll(sel).forEach((el) => el && nodes.push(el));
    const uniqNodes = Array.from(new Set(nodes));

    const stored = [];
    for (const el of uniqNodes) {
      try {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < clickShieldHeight) {
          stored.push({ el, prev: el.style.pointerEvents });
          el.style.pointerEvents = "none";
        }
      } catch {
        // ignore
      }
    }
    disabledNodesRef.current = stored;

    return () => {
      for (const it of disabledNodesRef.current || []) {
        if (!it?.el) continue;
        it.el.style.pointerEvents = it.prev || "";
      }
      disabledNodesRef.current = [];
    };
  }, [open, clickShieldHeight]);

  const handleClose = useCallback(() => {
    setShowSuggest(false);
    setSuggestIndex(0);

    setQ("");
    setHoverAudienceSlug("");
    setHoverCategorySlug("");
    setSelectedSubCategory("");
    setSelectedGenderGroup("");
    setSelectedAgeGroup("");
    onClose?.();
  }, [onClose]);

  // Close when clicking navbar area (shield) and bottom floating bar area
  useEffect(() => {
    if (!open) return;

    const onPointerDownCapture = (e) => {
      // If click happens inside the panel itself: do nothing
      // (Allow panel interactions)
      const panel = document.getElementById("tdlc-slidingmenubar-panel");
      if (panel && panel.contains(e.target)) return;

      // Close on navbar area (top zone)
      const y = e?.clientY ?? 0;
      if (y >= 0 && y <= clickShieldHeight) {
        handleClose();
        return;
      }

      // Close on bottom floating bar zone (bottom zone)
      const bottomZoneStart = window.innerHeight - bottomBarHeight;
      if (y >= bottomZoneStart) {
        handleClose();
      }
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => document.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [open, handleClose, clickShieldHeight, bottomBarHeight]);

  const switchTier = useCallback((nextTierSlug) => {
    const s = normSlug(nextTierSlug);
    const t = TIERS.find((x) => x.slug === s) || TIERS[0];

    setTierSlug(t.slug);
    setTierName(t.name);

    setShowSuggest(false);
    setSuggestIndex(0);

    setQ("");
    setHoverAudienceSlug("");
    setHoverCategorySlug("");
    setSelectedSubCategory("");
    setSelectedGenderGroup("");
    setSelectedAgeGroup("");
  }, []);

  const audiencesForTier = useMemo(() => {
    const tier = normSlug(tierSlug);
    const out = [];

    for (const row of audienceRows || []) {
      const a = normalizeEntity(row) || {};
      const slug = normSlug(a.slug || pickTextForSlug(a));
      const name = pickName(a) || titleizeSlug(slug);
      if (!slug) continue;

      const verdict = audienceTierVerdict({ audience: a, tierSlug: tier, productIndex, anyTierSignals });
      if (!verdict.ok) continue;

      out.push({ slug, name, count: verdict.count, raw: a });
    }

    return out.sort((x, y) => (y.count !== x.count ? y.count - x.count : x.name.localeCompare(y.name)));
  }, [audienceRows, tierSlug, productIndex, anyTierSignals]);

  // Current rail filtering (kept)
  const filteredAudiences = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return audiencesForTier;
    return audiencesForTier.filter((a) => a.name.toLowerCase().includes(qq) || a.slug.includes(qq));
  }, [q, audiencesForTier]);

  const flyAudienceSlug = hoverAudienceSlug || filteredAudiences?.[0]?.slug || "";
  const flyAudience = useMemo(() => {
    if (!flyAudienceSlug) return null;
    return audiencesForTier.find((a) => a.slug === flyAudienceSlug) || null;
  }, [audiencesForTier, flyAudienceSlug]);

  const categories = useMemo(() => {
    if (!flyAudience?.raw) return [];
    return deriveCategories({ tierSlug, audience: flyAudience.raw, productIndex, anyTierSignals });
  }, [flyAudience, tierSlug, productIndex, anyTierSignals]);

  const filteredCategories = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(qq) || c.slug.includes(qq));
  }, [q, categories]);

  const flyCategorySlug = hoverCategorySlug || filteredCategories?.[0]?.slug || "";

  const filters = useMemo(
    () => ({ subCategory: selectedSubCategory, genderGroup: selectedGenderGroup, ageGroup: selectedAgeGroup }),
    [selectedSubCategory, selectedGenderGroup, selectedAgeGroup]
  );

  // Base products (tier + audience + category only) for showing refine options.
  const baseProductsForFacets = useMemo(() => {
    if (!flyAudience?.raw) return [];
    return deriveProducts({
      tierSlug,
      audience: flyAudience.raw,
      categorySlug: flyCategorySlug,
      productIndex,
      anyTierSignals,
      filters: { subCategory: "", genderGroup: "", ageGroup: "" },
    });
  }, [flyAudience, tierSlug, flyCategorySlug, productIndex, anyTierSignals]);

  const facetOptions = useMemo(() => buildFacetOptions({ baseProducts: baseProductsForFacets, productIndex }), [baseProductsForFacets, productIndex]);

  const products = useMemo(() => {
    if (!flyAudience?.raw) return [];
    return deriveProducts({ tierSlug, audience: flyAudience.raw, categorySlug: flyCategorySlug, productIndex, anyTierSignals, filters });
  }, [flyAudience, tierSlug, flyCategorySlug, productIndex, anyTierSignals, filters]);

  const filteredProducts = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return products;
    return products.filter((p) => p.name.toLowerCase().includes(qq) || p.slug.includes(qq));
  }, [q, products]);

  // ✅ GLOBAL (in-tier) search universe for suggestions: audiences + categories + products
  const tierAllProducts = useMemo(() => {
    // Aggregate products across all active audiences for the tier using existing deriveProducts logic
    const map = new Map();
    for (const a of audiencesForTier || []) {
      if (!a?.raw) continue;
      const list = deriveProducts({
        tierSlug,
        audience: a.raw,
        categorySlug: "",
        productIndex,
        anyTierSignals,
        filters: { subCategory: "", genderGroup: "", ageGroup: "" },
      });
      for (const p of list || []) {
        if (!p?.slug) continue;
        if (!map.has(p.slug)) map.set(p.slug, p);
      }
    }
    return Array.from(map.values()).sort((x, y) => (x.name || "").localeCompare(y.name || ""));
  }, [audiencesForTier, tierSlug, productIndex, anyTierSignals]);

  const tierAllCategories = useMemo(() => {
    // Aggregate categories across all active audiences; track best audience for a category.
    const m = new Map(); // slug -> {slug,name,count,bestAudienceSlug,bestAudienceCount}
    for (const a of audiencesForTier || []) {
      if (!a?.raw) continue;
      const cats = deriveCategories({ tierSlug, audience: a.raw, productIndex, anyTierSignals });
      for (const c of cats || []) {
        if (!c?.slug) continue;
        const prev = m.get(c.slug);
        if (!prev) {
          m.set(c.slug, {
            slug: c.slug,
            name: c.name || titleizeSlug(c.slug),
            count: c.count || 0,
            bestAudienceSlug: a.slug,
            bestAudienceCount: c.count || 0,
          });
        } else {
          prev.count += c.count || 0;
          if ((c.count || 0) > (prev.bestAudienceCount || 0)) {
            prev.bestAudienceCount = c.count || 0;
            prev.bestAudienceSlug = a.slug;
          }
        }
      }
    }
    return Array.from(m.values()).sort((x, y) => (y.count !== x.count ? y.count - x.count : (x.name || "").localeCompare(y.name || "")));
  }, [audiencesForTier, tierSlug, productIndex, anyTierSignals]);

  const suggestions = useMemo(() => {
    const qq = q.trim();
    if (!qq) return [];

    const ql = qq.toLowerCase();

    const aud = (audiencesForTier || [])
      .map((a) => ({
        type: "AUDIENCE",
        slug: a.slug,
        name: a.name,
        href: buildCollectionsHref({ tier: tierSlug, audience: a.slug }),
        score: Math.max(scoreMatch({ q: ql, text: makeSearchKey(a.name, a.slug) }), 0) + (a.count || 0) * 0.5,
        meta: `${a.count || 0} products`,
      }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 6);

    const cat = (tierAllCategories || [])
      .map((c) => {
        const audSlug = c.bestAudienceSlug || audiencesForTier?.[0]?.slug || "";
        return {
          type: "CATEGORY",
          slug: c.slug,
          name: c.name || titleizeSlug(c.slug),
          href: buildCollectionsHref({ tier: tierSlug, audience: audSlug, category: c.slug }),
          score: Math.max(scoreMatch({ q: ql, text: makeSearchKey(c.name, c.slug) }), 0) + (c.count || 0) * 0.25,
          meta: `${c.count || 0} products`,
        };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 6);

    const prod = (tierAllProducts || [])
      .map((p) => ({
        type: "PRODUCT",
        slug: p.slug,
        name: p.name || titleizeSlug(p.slug),
        href: `/product/${p.slug}`,
        score: Math.max(scoreMatch({ q: ql, text: makeSearchKey(p.name, p.slug) }), 0),
        meta: p.slug,
      }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 10);

    // Merge (audiences first, then categories, then products)
    const merged = [...aud, ...cat, ...prod].slice(0, 14);
    return merged;
  }, [q, audiencesForTier, tierAllCategories, tierAllProducts, tierSlug]);

  const showRefine =
    (facetOptions.subCategories?.length || 0) > 0 || (facetOptions.genderGroups?.length || 0) > 0 || (facetOptions.ageGroups?.length || 0) > 0;

  if (!open) return null;

  const panelBottom = bottomBarHeight + BOTTOM_GAP;

  // Layout: narrow filter rails + wide products
  const railA = isDesktop ? "minmax(210px, 260px)" : "1fr";
  const railB = isDesktop ? "minmax(240px, 320px)" : "1fr";
  const productCol = "1fr";

  return (
    <>
      {/* Click shield: blocks any navbar overlays from stealing clicks
          ✅ Now also closes menu when clicked (navbar/hamburger 2nd click behavior) */}
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: clickShieldHeight,
          zIndex: Z_CLICK_SHIELD,
          background: "transparent",
          pointerEvents: "auto",
        }}
      />

      {/* Backdrop stops above bottom floating bar so bar stays usable */}
      <div
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: bottomBarHeight,
          zIndex: Z_OVERLAY,
          background: "rgba(10, 14, 24, 0.38)",
          backdropFilter: "blur(7px)",
          WebkitBackdropFilter: "blur(7px)",
        }}
      />

      {/* Panel */}
      <div
        id="tdlc-slidingmenubar-panel"
        style={{
          position: "fixed",
          top: panelTop,
          right: 8,
          bottom: panelBottom,
          width: menuWidth,
          maxWidth: "calc(100vw - 16px)",
          zIndex: Z_PANEL,
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #fffdf8 55%, #fbf6ea 100%)",
          border: "1px solid rgba(255,255,255,0.26)",
          boxShadow: "0 32px 90px rgba(0,0,0,0.32)",
          borderRadius: 28,
          overflow: "hidden",
          pointerEvents: "auto",
          isolation: "isolate",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        {/* Header (compact) */}
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            background: "linear-gradient(135deg, #ffffff 55%, #f7f3e7 100%)",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Pill tone="gold">{tierName}</Pill>
              {loading ? <Pill>Loading</Pill> : null}
              <Pill tone="ink">{filteredProducts.length}</Pill>
              {flyAudienceSlug ? <Pill>{titleizeSlug(flyAudienceSlug)}</Pill> : null}
              {flyCategorySlug ? <Pill>{titleizeSlug(flyCategorySlug)}</Pill> : null}
            </div>

            {/* tiers + search on same line */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TierTabs tiers={TIERS} activeSlug={tierSlug} onPick={switchTier} />
              </div>

              {/* Search wrapper (for suggestions popover) */}
              <div ref={searchWrapRef} style={{ position: "relative", flexShrink: 0 }}>
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setShowSuggest(true);
                    setSuggestIndex(0);
                  }}
                  onFocus={() => {
                    if (q.trim()) setShowSuggest(true);
                  }}
                  onBlur={() => {
                    // Let clicks on suggestions register before hiding
                    window.setTimeout(() => setShowSuggest(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (!q.trim()) return;

                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setShowSuggest(true);
                      setSuggestIndex((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setShowSuggest(true);
                      setSuggestIndex((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      const top = suggestions[suggestIndex] || suggestions[0];
                      if (top?.href) {
                        e.preventDefault();
                        router.push(top.href);
                        handleClose();
                      }
                    } else if (e.key === "Escape") {
                      setShowSuggest(false);
                    }
                  }}
                  placeholder="Search…"
                  style={{
                    width: "clamp(160px, 18vw, 300px)",
                    height: 36,
                    borderRadius: 14,
                    padding: "0 12px",
                    border: "1px solid rgba(0,0,0,0.10)",
                    outline: "none",
                    background: "#ffffff",
                    boxShadow: "0 10px 20px rgba(0,0,0,0.05)",
                    fontWeight: 800,
                    letterSpacing: ".04em",
                    color: "#0c2340",
                  }}
                />

                {/* Suggestions */}
                {showSuggest && q.trim() && suggestions.length ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 42,
                      right: 0,
                      width: 420,
                      maxWidth: "min(420px, 70vw)",
                      borderRadius: 16,
                      border: "1px solid rgba(0,0,0,0.10)",
                      background: "rgba(255,255,255,0.96)",
                      boxShadow: "0 22px 40px rgba(0,0,0,0.14)",
                      overflow: "hidden",
                      zIndex: Z_PANEL + 2,
                    }}
                  >
                    <div
                      style={{
                        padding: "10px 12px",
                        borderBottom: "1px solid rgba(0,0,0,0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        background: "linear-gradient(135deg, rgba(255,255,255,0.98) 55%, rgba(247,243,231,0.96) 100%)",
                      }}
                    >
                      <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 11, color: "#0c2340" }}>
                        Suggestions
                      </div>
                      <Pill tone="ink">{suggestions.length}</Pill>
                    </div>

                    <div style={{ maxHeight: 340, overflow: "auto", padding: 8 }}>
                      {suggestions.map((s, idx) => {
                        const active = idx === suggestIndex;
                        const tag = s.type === "PRODUCT" ? "Product" : s.type === "CATEGORY" ? "Category" : "Audience";
                        return (
                          <Link
                            key={`${s.type}-${s.slug}-${idx}`}
                            href={s.href}
                            prefetch
                            onMouseEnter={() => setSuggestIndex(idx)}
                            onMouseDown={() => {
                              // onMouseDown ensures navigation click isn't lost by input blur
                              handleClose();
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: "10px 10px",
                              borderRadius: 12,
                              border: active ? "1px solid rgba(12,35,64,0.28)" : "1px solid rgba(0,0,0,0.06)",
                              background: active ? "linear-gradient(135deg, rgba(12,35,64,0.10) 10%, rgba(191,167,80,0.12) 100%)" : "rgba(255,255,255,0.78)",
                              textDecoration: "none",
                              color: "#0c2340",
                              boxShadow: active ? "0 10px 18px rgba(12,35,64,0.10)" : "0 8px 14px rgba(0,0,0,0.04)",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                              <div
                                style={{
                                  fontWeight: 900,
                                  letterSpacing: ".07em",
                                  textTransform: "uppercase",
                                  fontSize: 11,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                title={s.name}
                              >
                                {s.name}
                              </div>
                              <div
                                style={{
                                  fontWeight: 800,
                                  fontSize: 10,
                                  color: "rgba(12,35,64,0.62)",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                                title={s.meta || ""}
                              >
                                {s.meta || ""}
                              </div>
                            </div>

                            <span
                              style={{
                                flexShrink: 0,
                                padding: "5px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(12,35,64,0.14)",
                                background: "rgba(12,35,64,0.06)",
                                fontWeight: 900,
                                fontSize: 10,
                                letterSpacing: ".10em",
                                textTransform: "uppercase",
                              }}
                            >
                              {tag}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* ✅ Close CTA: bigger clickable area */}
          <button
            type="button"
            onClick={handleClose}
            style={{
              borderRadius: 999,
              height: 44, // bigger
              minWidth: 92,
              padding: "0 16px", // bigger hit-area
              border: "1px solid rgba(0,0,0,0.10)",
              background: "rgba(255,255,255,0.92)",
              boxShadow: "0 10px 18px rgba(0,0,0,0.06)",
              color: "#0c2340",
              fontWeight: 900,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: 11,
              lineHeight: "44px",
            }}
            aria-label="Close menu"
          >
            Close
          </button>
        </div>

        {/* Body: 3-column, product-dominant. Independent scroll. */}
        <div style={{ flex: 1, minHeight: 0, padding: 10, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isDesktop ? `${railA} ${railB} ${productCol}` : "1fr",
              gap: 10,
              height: "100%",
              minHeight: 0,
            }}
          >
            {/* Audience list (narrow rail) */}
            <Shell title={`Audiences · ${filteredAudiences.length}`} right={<Pill tone="ink">{filteredAudiences.reduce((acc, a) => acc + (a.count || 0), 0)}</Pill>}>
              <ScrollBody>
                {filteredAudiences.map((a) => (
                  <CompactListItemLink
                    key={a.slug}
                    title={a.name}
                    subLeft={`${a.count} product${a.count === 1 ? "" : "s"}`}
                    badge={a.count}
                    active={a.slug === flyAudienceSlug}
                    href={buildCollectionsHref({ tier: tierSlug, audience: a.slug })}
                    onClick={handleClose}
                    onMouseEnter={() => {
                      setHoverAudienceSlug(a.slug);
                      setHoverCategorySlug("");
                      setSelectedSubCategory("");
                      setSelectedGenderGroup("");
                      setSelectedAgeGroup("");
                    }}
                  />
                ))}
              </ScrollBody>
            </Shell>

            {/* Category list (narrow rail) */}
            <Shell title={flyAudience?.name ? `Categories · ${flyAudience.name} · ${filteredCategories.length}` : `Categories · ${filteredCategories.length}`}>
              <ScrollBody>
                {filteredCategories.map((c) => (
                  <CompactListItemLink
                    key={c.slug}
                    title={c.name}
                    subLeft={`${c.count} product${c.count === 1 ? "" : "s"}`}
                    badge={c.count}
                    active={c.slug === flyCategorySlug}
                    href={buildCollectionsHref({ tier: tierSlug, audience: flyAudienceSlug, category: c.slug })}
                    onClick={handleClose}
                    onMouseEnter={() => {
                      setHoverCategorySlug(c.slug);
                      setSelectedSubCategory("");
                      setSelectedGenderGroup("");
                      setSelectedAgeGroup("");
                    }}
                  />
                ))}
              </ScrollBody>
            </Shell>

            {/* Products (dominant) */}
            <div style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Products toolbar */}
              <div
                style={{
                  borderRadius: 18,
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: "linear-gradient(135deg, rgba(255,255,255,0.92) 55%, rgba(247,243,231,0.92) 100%)",
                  boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
                  padding: "10px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 12, color: "#0c2340" }}>Products</div>
                  <Pill tone="ink">{filteredProducts.length}</Pill>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {showRefine ? (
                    <>
                      {facetOptions.subCategories.length ? (
                        <Select value={selectedSubCategory} onChange={(e) => setSelectedSubCategory(e.target.value)} options={facetOptions.subCategories} placeholder="Subcategory" />
                      ) : null}

                      {facetOptions.genderGroups.length ? (
                        <Select value={selectedGenderGroup} onChange={(e) => setSelectedGenderGroup(e.target.value)} options={facetOptions.genderGroups} placeholder="Gender" />
                      ) : null}

                      {facetOptions.ageGroups.length ? (
                        <Select value={selectedAgeGroup} onChange={(e) => setSelectedAgeGroup(e.target.value)} options={facetOptions.ageGroups} placeholder="Age" />
                      ) : null}

                      {selectedSubCategory || selectedGenderGroup || selectedAgeGroup ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSubCategory("");
                            setSelectedGenderGroup("");
                            setSelectedAgeGroup("");
                          }}
                          style={{
                            height: 34,
                            padding: "0 10px",
                            borderRadius: 12,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.96)",
                            boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                            fontWeight: 900,
                            letterSpacing: ".10em",
                            textTransform: "uppercase",
                            fontSize: 11,
                            cursor: "pointer",
                            color: "#0c2340",
                          }}
                        >
                          Clear Refine
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {flyAudienceSlug ? (
                    <Link
                      href={buildCollectionsHref({
                        tier: tierSlug,
                        audience: flyAudienceSlug,
                        category: flyCategorySlug,
                        subCategory: selectedSubCategory,
                        genderGroup: selectedGenderGroup,
                        ageGroup: selectedAgeGroup,
                      })}
                      onClick={handleClose}
                      style={{
                        textDecoration: "none",
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 999,
                        border: "1px solid rgba(12,35,64,0.22)",
                        background: "linear-gradient(135deg, #0c2340 10%, #163060 100%)",
                        boxShadow: "0 14px 24px rgba(12,35,64,0.14)",
                        color: "#fffdf8",
                        fontWeight: 900,
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                      }}
                    >
                      View All →
                    </Link>
                  ) : null}
                </div>
              </div>

              {/* Dense products grid */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  borderRadius: 18,
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.70)",
                  boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
                  {filteredProducts.length ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      {filteredProducts.map((p) => (
                        <Link
                          key={p.slug}
                          href={`/product/${p.slug}`}
                          onClick={handleClose}
                          title={p.name}
                          style={{
                            textDecoration: "none",
                            borderRadius: 14,
                            padding: "10px 10px",
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: "rgba(255,255,255,0.82)",
                            boxShadow: "0 8px 14px rgba(0,0,0,0.04)",
                            color: "#0c2340",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            minHeight: 50,
                          }}
                        >
                          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                            <div
                              style={{
                                fontWeight: 900,
                                letterSpacing: ".06em",
                                textTransform: "uppercase",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                fontSize: 12,
                                lineHeight: 1.15,
                              }}
                            >
                              {p.name}
                            </div>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                color: "rgba(12,35,64,0.60)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {p.slug}
                            </div>
                          </div>

                          <span
                            style={{
                              flexShrink: 0,
                              padding: "5px 8px",
                              borderRadius: 999,
                              border: "1px solid rgba(12,35,64,0.14)",
                              background: "rgba(12,35,64,0.06)",
                              fontWeight: 900,
                              fontSize: 10,
                              letterSpacing: ".10em",
                              textTransform: "uppercase",
                            }}
                          >
                            Open
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 12 }}>
                      <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#0c2340" }}>
                        No pieces match these filters right now.
                      </div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "rgba(12,35,64,0.70)" }}>
                        Try a different audience/category, clear refine, or clear search.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Mobile tip (kept) */}
            {!isDesktop ? (
              <div style={{ marginTop: 10, color: "rgba(12,35,64,0.55)", fontWeight: 800, fontSize: 12, letterSpacing: ".02em" }}>
                Tip: On mobile, scroll within each section to browse large lists.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
