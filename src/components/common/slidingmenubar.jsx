// FILE: src/components/common/slidingmenubar.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * TDLS Sliding Menu Bar — Desktop preserved; Mobile restructured; True preload supported.
 * ----------------------------------------------------------------------------
 * Goals (this task):
 * 1) Preload at website load (NOT on click):
 *    - Keep singleton + localStorage cache for instant open.
 *    - Export <SlidingMenuBarPreloader/> to mount in a root always-mounted place.
 *    - Use requestIdleCallback + visibilitychange to warm/refresh early.
 *
 * 2) Mobile: adaptive, never overflow/break (Android/iOS; portrait/landscape):
 *    - Desktop: same 3-column rail layout.
 *    - Mobile: sectioned view (Audiences / Categories / Products) with a segmented switcher.
 *      All features remain accessible; just organized for small screens.
 */

const NAVBAR_HEIGHT = 96;
const TOP_SAFE_GAP = 44;
const TOP_CLICK_SHIELD_EXTRA = 64;

const MENU_WIDTH_DESKTOP = 1440;
const MENU_MAX_WIDTH = 1760;
const MENU_MIN_WIDTH = 320;

const DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT = 88;
const BOTTOM_GAP = 10;

const Z_OVERLAY = 99998;
const Z_PANEL = 99999;
const Z_CLICK_SHIELD = 100000;

const PANEL_ID = "tdls-slidingmenubar-panel";
const LEGACY_PANEL_ID = "tdlc-slidingmenubar-panel";

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
  return cutSemi
    .replace(/[?#].*$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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
  sub_categories: [
    "sub_categories",
    "sub_category",
    "subCategories",
    "subCategory",
    "product_sub_categories",
    "product_sub_category",
  ],
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
      cache: "default",
    });

    if (!res.ok) return null;
    const raw = await res.json().catch(() => null);

    // keep original intent, but tolerate proxy shapes
    if (raw?.ok && raw.data != null) return raw.data;
    return raw;
  } catch {
    return null;
  }
}

// ✅ SAFETY: unwrap Strapi lists no matter how the proxy wraps the payload
function unwrapStrapiList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  // common Strapi shape: { data: [...] }
  if (Array.isArray(payload?.data)) return payload.data;

  // sometimes proxy returns { data: { data: [...] } }
  if (payload?.data && Array.isArray(payload.data?.data)) return payload.data.data;

  // sometimes proxy returns { ok:true, data:[...] } already handled, but keep safe:
  if (payload?.ok && Array.isArray(payload?.data)) return payload.data;
  if (payload?.ok && payload?.data && Array.isArray(payload.data?.data)) return payload.data.data;

  return [];
}

async function fetchAudienceCategoriesWithProducts() {
  const payload = await fetchFromStrapi(
    "/audience-categories?pagination[pageSize]=500&populate[products][populate]=*&populate[tiers][populate]=*&populate[brand_tiers][populate]=*&populate[collection_tiers][populate]=*&populate[events_products_collections][populate]=*&populate[product_collections][populate]=*"
  );
  const rows = unwrapStrapiList(payload);
  return rows.map(normalizeEntity).filter(Boolean);
}

async function fetchProductsForIndex() {
  const payload = await fetchFromStrapi(
    "/products?pagination[pageSize]=1000&populate=*&populate[tiers]=*&populate[brand_tiers]=*&populate[collection_tiers]=*&populate[categories]=*&populate[audience_categories]=*&populate[sub_categories]=*&populate[gender_groups]=*&populate[age_groups]=*&populate[events_products_collections]=*&populate[product_collections]=*"
  );
  const rows = unwrapStrapiList(payload);
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
    const name =
      (p.name || p.title || "").toString().trim() || (slug ? titleizeSlug(slug) : `Product #${id}`);

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

  const tierSlugs =
    (productIdx?.tierSlugs?.length ? productIdx.tierSlugs : extractRelSlugs(productEntity, "tiers")) || [];
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

function Pill({ children, tone = "neutral", size = "md" }) {
  const tones = {
    neutral: { bg: "rgba(12,35,64,0.06)", fg: "#0c2340", bd: "rgba(12,35,64,0.10)" },
    gold: { bg: "rgba(191,167,80,0.20)", fg: "#0c2340", bd: "rgba(191,167,80,0.36)" },
    ink: { bg: "rgba(12,35,64,0.10)", fg: "#0c2340", bd: "rgba(12,35,64,0.18)" },
  };
  const t = tones[tone] || tones.neutral;
  const sz = size === "sm" ? { pad: "5px 9px", fs: 10 } : { pad: "6px 10px", fs: 11 };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: sz.pad,
        borderRadius: 999,
        border: `1px solid ${t.bd}`,
        background: t.bg,
        color: t.fg,
        fontWeight: 900,
        fontSize: sz.fs,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </span>
  );
}

function TierTabs({ tiers, activeSlug, onPick, isMobile }) {
  const fs = isMobile ? "clamp(10px, 2.7vw, 11px)" : 12;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 8 : 10,
        overflowX: "auto",
        overflowY: "hidden",
        WebkitOverflowScrolling: "touch",
        overscrollBehaviorX: "contain",
        touchAction: "pan-x",
        paddingBottom: 2,
        maxWidth: "100%",
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
              padding: isMobile ? "7px 10px" : "9px 12px",
              border: active ? "1px solid rgba(12,35,64,0.55)" : "1px solid rgba(0,0,0,0.10)",
              background: active
                ? "linear-gradient(135deg, #0c2340 10%, #163060 100%)"
                : "linear-gradient(135deg, #ffffff 55%, #fbf7ec 100%)",
              color: active ? "#fffdf8" : "#0c2340",
              fontWeight: 900,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              boxShadow: active ? "0 14px 26px rgba(12,35,64,0.18)" : "0 10px 18px rgba(0,0,0,0.05)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: fs,
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
        <div
          style={{
            fontWeight: 900,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            fontSize: 12,
            color: "#0c2340",
          }}
        >
          {title}
        </div>
        {right || null}
      </div>
      {children}
    </div>
  );
}

function ScrollBody({ children, compact = false }) {
  return (
    <div
      style={{
        padding: compact ? 8 : 10,
        minHeight: 0,
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        touchAction: "pan-y",
      }}
    >
      <div style={{ display: "grid", gap: compact ? 7 : 8 }}>{children}</div>
    </div>
  );
}

function Select({ value, onChange, options, placeholder, isMobile }) {
  const fs = isMobile ? "clamp(9px, 2.6vw, 10px)" : 11;
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        height: isMobile ? 32 : 34,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.96)",
        boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
        padding: "0 10px",
        fontWeight: 900,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        fontSize: fs,
        color: "#0c2340",
        outline: "none",
        maxWidth: isMobile ? "100%" : "min(220px, 100%)",
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

/* -------------------------- ✅ Preload singleton + localStorage cache -------------------------- */

const LS_KEY = "tdls:slidingmenubar:data:v3";
const LS_TS = "tdls:slidingmenubar:ts:v3";
const LS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let __tdlsMenuPreloadPromise = null;
let __tdlsMenuPreloadData = null;

function canUseLS() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function loadFromLocalStorage() {
  if (!canUseLS()) return null;
  const tsRaw = window.localStorage.getItem(LS_TS);
  const ts = tsRaw ? parseInt(tsRaw, 10) : 0;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (Date.now() - ts > LS_TTL_MS) return null;

  const raw = window.localStorage.getItem(LS_KEY);
  if (!raw) return null;

  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return null;

  const audienceRows = Array.isArray(parsed.audienceRows) ? parsed.audienceRows : [];
  const products = Array.isArray(parsed.products) ? parsed.products : [];
  return {
    audienceRows: audienceRows.map(normalizeEntity).filter(Boolean),
    productIndex: buildProductIndex(products.map(normalizeEntity).filter(Boolean)),
    _fromCache: true,
  };
}

function saveToLocalStorage({ audienceRows, products }) {
  if (!canUseLS()) return;
  try {
    window.localStorage.setItem(LS_TS, String(Date.now()));
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        audienceRows: (audienceRows || []).slice(0, 1200),
        products: (products || []).slice(0, 2000),
      })
    );
  } catch {
    // ignore
  }
}

async function fetchAndBuildFresh() {
  const [aud, prods] = await Promise.all([fetchAudienceCategoriesWithProducts(), fetchProductsForIndex()]);
  const audienceRows = (aud || []).map(normalizeEntity).filter(Boolean);
  const products = (prods || []).map(normalizeEntity).filter(Boolean);

  const built = {
    audienceRows,
    productIndex: buildProductIndex(products),
    _fromCache: false,
  };

  saveToLocalStorage({ audienceRows, products });
  return built;
}

async function preloadMenuDataOnce({ backgroundRefresh = true } = {}) {
  if (__tdlsMenuPreloadData) {
    if (backgroundRefresh && !__tdlsMenuPreloadPromise) {
      __tdlsMenuPreloadPromise = fetchAndBuildFresh()
        .then((fresh) => {
          __tdlsMenuPreloadData = fresh;
          return fresh;
        })
        .catch(() => __tdlsMenuPreloadData)
        .finally(() => {
          __tdlsMenuPreloadPromise = null;
        });
    }
    return __tdlsMenuPreloadData;
  }

  const cached = loadFromLocalStorage();
  if (cached) {
    __tdlsMenuPreloadData = cached;

    if (backgroundRefresh) {
      __tdlsMenuPreloadPromise = fetchAndBuildFresh()
        .then((fresh) => {
          __tdlsMenuPreloadData = fresh;
          return fresh;
        })
        .catch(() => __tdlsMenuPreloadData)
        .finally(() => {
          __tdlsMenuPreloadPromise = null;
        });
    }

    return __tdlsMenuPreloadData;
  }

  if (__tdlsMenuPreloadPromise) return __tdlsMenuPreloadPromise;

  __tdlsMenuPreloadPromise = fetchAndBuildFresh()
    .then((fresh) => {
      __tdlsMenuPreloadData = fresh;
      return fresh;
    })
    .catch(() => {
      __tdlsMenuPreloadData = { audienceRows: [], productIndex: new Map(), _fromCache: false };
      return __tdlsMenuPreloadData;
    })
    .finally(() => {
      __tdlsMenuPreloadPromise = null;
    });

  return __tdlsMenuPreloadPromise;
}

function runIdle(fn, timeout = 900) {
  if (typeof window === "undefined") return;
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => fn(), { timeout });
  } else {
    window.setTimeout(() => fn(), Math.min(250, timeout));
  }
}

// Optional helper: parent can call this on app load; safe no-op if already warmed.
export function warmSlidingMenuBar() {
  return preloadMenuDataOnce({ backgroundRefresh: true });
}

/**
 * ✅ MUST-MOUNT PRELOADER (guarantees preload happens at website load)
 * Place <SlidingMenuBarPreloader/> in an always-mounted component (layout/navbar/bottom bar).
 */
export function SlidingMenuBarPreloader() {
  useEffect(() => {
    runIdle(() => {
      preloadMenuDataOnce({ backgroundRefresh: true }).catch(() => {});
    });

    const onVis = () => {
      if (document.visibilityState === "visible") {
        preloadMenuDataOnce({ backgroundRefresh: true }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis, { passive: true });
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return null;
}

// Start warming as soon as THIS chunk exists (still requires chunk to be loaded by being imported somewhere).
if (typeof window !== "undefined") {
  runIdle(() => {
    preloadMenuDataOnce({ backgroundRefresh: true }).catch(() => {});
  });
}

/* ------------------------------- Component -------------------------------- */

function CompactRowButton({
  active,
  title,
  subLeft,
  badge,
  onClick,
  onNavigateHref,
  onNavigate,
  isDesktop,
  dense,
  onMouseEnter,
  onMouseLeave,
  onFocus,
}) {
  const titleFs = dense ? "clamp(9px, 2.6vw, 10px)" : 11;
  const subFs = dense ? "clamp(8px, 2.4vw, 9px)" : 10;
  const badgeFs = dense ? "clamp(8px, 2.4vw, 9px)" : 10;

  const baseStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dense ? 8 : 10,
    padding: dense ? "9px 9px" : "10px 10px",
    textDecoration: "none",
    borderRadius: 12,
    border: active ? "1px solid rgba(12,35,64,0.32)" : "1px solid rgba(0,0,0,0.06)",
    background: active
      ? "linear-gradient(135deg, rgba(12,35,64,0.10) 10%, rgba(191,167,80,0.14) 100%)"
      : "rgba(255,255,255,0.78)",
    boxShadow: active ? "0 10px 18px rgba(12,35,64,0.10)" : "0 8px 14px rgba(0,0,0,0.04)",
    color: "#0c2340",
    cursor: "pointer",
    minWidth: 0,
    width: "100%",
    textAlign: "left",
  };

  if (isDesktop && onNavigateHref) {
    return (
      <Link
        href={onNavigateHref}
        prefetch
        onClick={onNavigate}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        style={baseStyle}
      >
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontWeight: 900,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              fontSize: titleFs,
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
                fontSize: subFs,
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
              padding: dense ? "4px 7px" : "4px 8px",
              borderRadius: 999,
              border: "1px solid rgba(12,35,64,0.14)",
              background: "rgba(12,35,64,0.06)",
              fontWeight: 900,
              fontSize: badgeFs,
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

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      style={baseStyle}
      aria-pressed={active}
    >
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontWeight: 900,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            fontSize: titleFs,
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
              fontSize: subFs,
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
            padding: dense ? "4px 7px" : "4px 8px",
            borderRadius: 999,
            border: "1px solid rgba(12,35,64,0.14)",
            background: "rgba(12,35,64,0.06)",
            fontWeight: 900,
            fontSize: badgeFs,
            letterSpacing: ".10em",
            textTransform: "uppercase",
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function Segmented({ value, onChange, items }) {
  const btnFs = "clamp(9px, 2.5vw, 10px)";
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.92)",
        boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
        overflow: "hidden",
      }}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            style={{
              flex: 1,
              height: 32,
              border: "none",
              background: active ? "linear-gradient(135deg, #0c2340 10%, #163060 100%)" : "transparent",
              color: active ? "#fffdf8" : "#0c2340",
              fontWeight: 900,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              fontSize: btnFs,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            aria-pressed={active}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function readCssVarPx(vars, fallbackPx) {
  try {
    const root = document.documentElement;
    for (const v of vars) {
      const raw = getComputedStyle(root).getPropertyValue(v);
      const n = parseInt((raw || "").toString().replace("px", "").trim(), 10);
      if (Number.isFinite(n) && n > 40 && n < 240) return n;
    }
  } catch {
    // ignore
  }
  return fallbackPx;
}

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
  const [hydrated, setHydrated] = useState(false);

  const [bottomBarHeight, setBottomBarHeight] = useState(DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT);

  const disabledNodesRef = useRef([]);

  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const searchWrapRef = useRef(null);

  const [mobileSection, setMobileSection] = useState("audiences"); // audiences | categories | products

  const panelRef = useRef(null);

  const anyTierSignals = useMemo(() => computeAnyTierSignals(productIndex, audienceRows), [productIndex, audienceRows]);

  const panelTop = NAVBAR_HEIGHT + TOP_SAFE_GAP;
  const clickShieldHeight = panelTop + TOP_CLICK_SHIELD_EXTRA;

  // ✅ Desktop hover selection: not hypersensitive (small delay)
  const hoverTimersRef = useRef({ aud: null, cat: null });
  const scheduleHoverSelect = useCallback((kind, slug) => {
    if (typeof window === "undefined") return;
    const ms = 110; // subtle delay prevents hypersensitivity
    const key = kind === "aud" ? "aud" : "cat";

    if (hoverTimersRef.current[key]) window.clearTimeout(hoverTimersRef.current[key]);
    hoverTimersRef.current[key] = window.setTimeout(() => {
      if (kind === "aud") {
        setHoverAudienceSlug(slug);
        setHoverCategorySlug(""); // ✅ safety: reset category when audience changes
      } else {
        setHoverCategorySlug(slug);
      }
    }, ms);
  }, []);

  const cancelHoverSelect = useCallback((kind) => {
    if (typeof window === "undefined") return;
    const key = kind === "aud" ? "aud" : "cat";
    if (hoverTimersRef.current[key]) window.clearTimeout(hoverTimersRef.current[key]);
    hoverTimersRef.current[key] = null;
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (hoverTimersRef.current.aud) window.clearTimeout(hoverTimersRef.current.aud);
      if (hoverTimersRef.current.cat) window.clearTimeout(hoverTimersRef.current.cat);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const vv = window.visualViewport;
    const setVH = () => {
      const h = vv?.height || window.innerHeight || 0;
      if (!h) return;
      document.documentElement.style.setProperty("--tdls-vh", `${h * 0.01}px`);
    };

    setVH();
    window.addEventListener("resize", setVH, { passive: true });
    vv?.addEventListener?.("resize", setVH, { passive: true });
    vv?.addEventListener?.("scroll", setVH, { passive: true });

    return () => {
      window.removeEventListener("resize", setVH);
      vv?.removeEventListener?.("resize", setVH);
      vv?.removeEventListener?.("scroll", setVH);
    };
  }, []);

  // ✅ Hydrate immediately from singleton/cache, then refresh in background.
  useEffect(() => {
    let alive = true;

    if (__tdlsMenuPreloadData && alive) {
      setAudienceRows(__tdlsMenuPreloadData.audienceRows || []);
      setProductIndex(__tdlsMenuPreloadData.productIndex || new Map());
      setHydrated(true);
    }

    (async () => {
      const data = await preloadMenuDataOnce({ backgroundRefresh: true });
      if (!alive) return;
      setAudienceRows(data?.audienceRows || []);
      setProductIndex(data?.productIndex || new Map());
      setHydrated(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      setIsDesktop(w >= 980);

      const target =
        w >= 1600
          ? Math.min(MENU_MAX_WIDTH, w - 16)
          : w >= 980
          ? Math.min(MENU_WIDTH_DESKTOP, w - 16)
          : Math.max(MENU_MIN_WIDTH, w - 16);

      setMenuWidth(Math.max(MENU_MIN_WIDTH, Math.min(target, w - 16)));
    }

    handleResize();
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const n = readCssVarPx(
      ["--tdls-bottom-floating-bar-height", "--tdlc-bottom-floating-bar-height", "--bottom-floating-bar-height"],
      DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT
    );
    setBottomBarHeight(n);
  }, [open]);

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
    setMobileSection("audiences");
    onClose?.();
  }, [onClose]);

  /**
   * ✅ Mobile hypersensitivity fix:
   * - Close ONLY on true OUTSIDE "tap" (pointer up) that started outside AND ended outside.
   * - Ignore drags/swipes (movement threshold) so scrolling near edges won't close.
   * - Use composedPath so taps on panel edges/children never count as outside.
   */
  useEffect(() => {
    if (!open) return;

    let active = null;

    const isInsidePanel = (evt) => {
      const panelEl =
        panelRef.current ||
        document.getElementById(PANEL_ID) ||
        document.getElementById(LEGACY_PANEL_ID);

      if (!panelEl) return false;
      const t = evt?.target;
      if (panelEl === t) return true;
      if (t && panelEl.contains(t)) return true;
      const path = typeof evt?.composedPath === "function" ? evt.composedPath() : null;
      if (path && Array.isArray(path) && path.includes(panelEl)) return true;
      return false;
    };

    const onPointerDownCapture = (e) => {
      if (!e?.isPrimary) return;

      const startedInside = isInsidePanel(e);
      active = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        startedInside,
        pointerType: e.pointerType || "mouse",
      };
    };

    const onPointerMoveCapture = (e) => {
      if (!active || e.pointerId !== active.id) return;

      const dx = (e.clientX ?? 0) - active.x;
      const dy = (e.clientY ?? 0) - active.y;

      const movePx = active.pointerType === "touch" ? 16 : 10;
      if (dx * dx + dy * dy >= movePx * movePx) active.moved = true;
    };

    const onPointerUpCapture = (e) => {
      if (!active || e.pointerId !== active.id) return;

      const endedInside = isInsidePanel(e);
      const shouldClose =
        !active.startedInside &&
        !endedInside &&
        !active.moved; // true outside tap only

      active = null;
      if (shouldClose) handleClose();
    };

    const onPointerCancelCapture = () => {
      active = null;
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("pointermove", onPointerMoveCapture, true);
    document.addEventListener("pointerup", onPointerUpCapture, true);
    document.addEventListener("pointercancel", onPointerCancelCapture, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("pointermove", onPointerMoveCapture, true);
      document.removeEventListener("pointerup", onPointerUpCapture, true);
      document.removeEventListener("pointercancel", onPointerCancelCapture, true);
    };
  }, [open, handleClose]);

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
    setMobileSection("audiences");
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

  const filteredAudiences = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return audiencesForTier;
    return audiencesForTier.filter((a) => a.name.toLowerCase().includes(qq) || a.slug.includes(qq));
  }, [q, audiencesForTier]);

  // ✅ SAFETY: ensure selected audience slug always exists
  const flyAudienceSlug = useMemo(() => {
    const list = (filteredAudiences && filteredAudiences.length ? filteredAudiences : audiencesForTier) || [];
    const first = list?.[0]?.slug || "";
    const candidate = hoverAudienceSlug || first;
    if (!candidate) return "";
    return list.some((x) => x.slug === candidate) ? candidate : first;
  }, [hoverAudienceSlug, filteredAudiences, audiencesForTier]);

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

  // ✅ SAFETY: ensure selected category slug always exists
  const flyCategorySlug = useMemo(() => {
    const list = (filteredCategories && filteredCategories.length ? filteredCategories : categories) || [];
    const first = list?.[0]?.slug || "";
    const candidate = hoverCategorySlug || first;
    if (!candidate) return "";
    return list.some((x) => x.slug === candidate) ? candidate : first;
  }, [hoverCategorySlug, filteredCategories, categories]);

  const filters = useMemo(
    () => ({ subCategory: selectedSubCategory, genderGroup: selectedGenderGroup, ageGroup: selectedAgeGroup }),
    [selectedSubCategory, selectedGenderGroup, selectedAgeGroup]
  );

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

  const facetOptions = useMemo(() => buildFacetOptions({ baseProducts: baseProductsForFacets, productIndex }), [
    baseProductsForFacets,
    productIndex,
  ]);

  const products = useMemo(() => {
    if (!flyAudience?.raw) return [];
    return deriveProducts({
      tierSlug,
      audience: flyAudience.raw,
      categorySlug: flyCategorySlug,
      productIndex,
      anyTierSignals,
      filters,
    });
  }, [flyAudience, tierSlug, flyCategorySlug, productIndex, anyTierSignals, filters]);

  const filteredProducts = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return products;
    return products.filter((p) => p.name.toLowerCase().includes(qq) || p.slug.includes(qq));
  }, [q, products]);

  const tierAllProducts = useMemo(() => {
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
    const m = new Map();
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
    return Array.from(m.values()).sort((x, y) =>
      y.count !== x.count ? y.count - x.count : (x.name || "").localeCompare(y.name || "")
    );
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

    return [...aud, ...cat, ...prod].slice(0, 14);
  }, [q, audiencesForTier, tierAllCategories, tierAllProducts, tierSlug]);

  const showRefine =
    (facetOptions.subCategories?.length || 0) > 0 ||
    (facetOptions.genderGroups?.length || 0) > 0 ||
    (facetOptions.ageGroups?.length || 0) > 0;

  // Keep preload mounted behavior when open=false (if parent renders always).
  if (!open) {
    return <span aria-hidden="true" style={{ display: "none" }} />;
  }

  const panelBottom = bottomBarHeight + BOTTOM_GAP;
  const headerIsMobile = !isDesktop;

  const panelMaxHeightStyle = headerIsMobile
    ? { maxHeight: `calc((var(--tdls-vh, 1vh) * 100) - ${panelTop + panelBottom}px)` }
    : null;

  const goViewAllHref =
    flyAudienceSlug
      ? buildCollectionsHref({
          tier: tierSlug,
          audience: flyAudienceSlug,
          category: flyCategorySlug,
          subCategory: selectedSubCategory,
          genderGroup: selectedGenderGroup,
          ageGroup: selectedAgeGroup,
        })
      : "";

  // Mobile “See all” helpers
  const goAudienceAllHref = flyAudienceSlug ? buildCollectionsHref({ tier: tierSlug, audience: flyAudienceSlug }) : "";
  const goCategoryAllHref =
    flyAudienceSlug && flyCategorySlug
      ? buildCollectionsHref({ tier: tierSlug, audience: flyAudienceSlug, category: flyCategorySlug })
      : "";

  return (
    <>
      {/* Click shield kept for compatibility, but MUST NOT block panel interactions */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: clickShieldHeight,
          zIndex: Z_CLICK_SHIELD,
          background: "transparent",
          pointerEvents: "none",
        }}
      />

      <div
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
          touchAction: "manipulation",
        }}
      />

      <div
        id={PANEL_ID}
        data-legacy-id={LEGACY_PANEL_ID}
        ref={panelRef}
        style={{
          position: "fixed",
          top: panelTop,
          left: headerIsMobile ? 8 : "auto",
          right: 8,
          bottom: panelBottom,
          width: headerIsMobile ? "auto" : menuWidth,
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
          touchAction: "pan-x pan-y",
          ...(panelMaxHeightStyle || {}),
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        {/* Header */}
        <div
          style={{
            padding: headerIsMobile ? "8px 10px" : "10px 12px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            background: "linear-gradient(135deg, #ffffff 55%, #f7f3e7 100%)",
            display: "flex",
            flexDirection: headerIsMobile ? "column" : "row",
            gap: headerIsMobile ? 8 : 10,
            alignItems: headerIsMobile ? "stretch" : "center",
            justifyContent: "space-between",
            minWidth: 0,
          }}
        >
          {headerIsMobile ? (
            /* ---------------- Mobile header: NO search bar; more space for products ---------------- */
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 10,
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill tone="gold" size="sm">
                      {tierName}
                    </Pill>
                    <Pill tone="ink" size="sm">
                      {filteredProducts.length}
                    </Pill>
                    {flyAudienceSlug ? <Pill size="sm">{titleizeSlug(flyAudienceSlug)}</Pill> : null}
                    {flyCategorySlug ? <Pill size="sm">{titleizeSlug(flyCategorySlug)}</Pill> : null}
                  </div>
                </div>

                {/* ✅ Mobile Close: reduced sizing; auto-scales down */}
                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    borderRadius: 999,
                    height: 34,
                    minWidth: 82,
                    padding: "0 12px",
                    border: "1px solid rgba(0,0,0,0.10)",
                    background: "rgba(255,255,255,0.92)",
                    boxShadow: "0 10px 18px rgba(0,0,0,0.06)",
                    color: "#0c2340",
                    fontWeight: 900,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontSize: "clamp(9px, 2.6vw, 10px)",
                    lineHeight: "34px",
                    flexShrink: 0,
                    alignSelf: "flex-start",
                  }}
                  aria-label="Close menu"
                >
                  Close
                </button>
              </div>

              <div style={{ minWidth: 0 }}>
                <TierTabs tiers={TIERS} activeSlug={tierSlug} onPick={switchTier} isMobile />
              </div>

              <Segmented
                value={mobileSection}
                onChange={setMobileSection}
                items={[
                  { value: "audiences", label: "Audiences" },
                  { value: "categories", label: "Categories" },
                  { value: "products", label: "Products" },
                ]}
              />
            </div>
          ) : (
            /* ---------------- Desktop header: preserved (includes search) ---------------- */
            <>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Pill tone="gold" size={headerIsMobile ? "sm" : "md"}>
                    {tierName}
                  </Pill>
                  <Pill tone="ink" size={headerIsMobile ? "sm" : "md"}>
                    {filteredProducts.length}
                  </Pill>
                  {flyAudienceSlug ? <Pill size={headerIsMobile ? "sm" : "md"}>{titleizeSlug(flyAudienceSlug)}</Pill> : null}
                  {flyCategorySlug ? <Pill size={headerIsMobile ? "sm" : "md"}>{titleizeSlug(flyCategorySlug)}</Pill> : null}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: headerIsMobile ? "column" : "row",
                    alignItems: headerIsMobile ? "stretch" : "center",
                    gap: 10,
                    marginTop: 8,
                    minWidth: 0,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TierTabs tiers={TIERS} activeSlug={tierSlug} onPick={switchTier} isMobile={headerIsMobile} />
                  </div>

                  <div ref={searchWrapRef} style={{ position: "relative", flexShrink: 0, width: headerIsMobile ? "100%" : "auto" }}>
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
                      placeholder={hydrated ? "Search…" : "Search…"}
                      style={{
                        width: headerIsMobile ? "100%" : "clamp(160px, 18vw, 300px)",
                        maxWidth: "100%",
                        height: headerIsMobile ? 34 : 36,
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

                    {showSuggest && q.trim() && suggestions.length ? (
                      <div
                        style={{
                          position: "absolute",
                          top: headerIsMobile ? 40 : 42,
                          right: 0,
                          width: headerIsMobile ? "min(520px, 92vw)" : 420,
                          maxWidth: "min(520px, 92vw)",
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
                            background:
                              "linear-gradient(135deg, rgba(255,255,255,0.98) 55%, rgba(247,243,231,0.96) 100%)",
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 900,
                              letterSpacing: ".12em",
                              textTransform: "uppercase",
                              fontSize: 11,
                              color: "#0c2340",
                            }}
                          >
                            Suggestions
                          </div>
                          <Pill tone="ink" size="sm">
                            {suggestions.length}
                          </Pill>
                        </div>

                        <div
                          style={{
                            maxHeight: 340,
                            overflow: "auto",
                            padding: 8,
                            WebkitOverflowScrolling: "touch",
                            overscrollBehavior: "contain",
                            touchAction: "pan-y",
                          }}
                        >
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
                                  background: active
                                    ? "linear-gradient(135deg, rgba(12,35,64,0.10) 10%, rgba(191,167,80,0.12) 100%)"
                                    : "rgba(255,255,255,0.78)",
                                  textDecoration: "none",
                                  color: "#0c2340",
                                  boxShadow: active ? "0 10px 18px rgba(12,35,64,0.10)" : "0 8px 14px rgba(0,0,0,0.04)",
                                  cursor: "pointer",
                                  minWidth: 0,
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

                {!isDesktop ? (
                  <div style={{ marginTop: 10 }}>
                    <Segmented
                      value={mobileSection}
                      onChange={setMobileSection}
                      items={[
                        { value: "audiences", label: "Audiences" },
                        { value: "categories", label: "Categories" },
                        { value: "products", label: "Products" },
                      ]}
                    />
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleClose}
                style={{
                  borderRadius: 999,
                  height: 44,
                  minWidth: 92,
                  padding: "0 16px",
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
                  alignSelf: "auto",
                }}
                aria-label="Close menu"
              >
                Close
              </button>
            </>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, padding: 10, overflow: "hidden" }}>
          {isDesktop ? (
            /* ---------------- Desktop: preserved 3-column ---------------- */
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(210px, 260px) minmax(240px, 320px) 1fr",
                gap: 10,
                height: "100%",
                minHeight: 0,
              }}
            >
              <Shell
                title={`Audiences · ${filteredAudiences.length}`}
                right={<Pill tone="ink">{filteredAudiences.reduce((acc, a) => acc + (a.count || 0), 0)}</Pill>}
              >
                <ScrollBody>
                  {filteredAudiences.map((a) => (
                    <CompactRowButton
                      key={a.slug}
                      title={a.name}
                      subLeft={`${a.count} product${a.count === 1 ? "" : "s"}`}
                      badge={a.count}
                      active={a.slug === flyAudienceSlug}
                      isDesktop
                      dense={false}
                      onNavigateHref={buildCollectionsHref({ tier: tierSlug, audience: a.slug })}
                      onNavigate={handleClose}
                      onClick={() => {}}
                      // ✅ Desktop: select on hover/focus (no click navigation change)
                      onMouseEnter={() => scheduleHoverSelect("aud", a.slug)}
                      onMouseLeave={() => cancelHoverSelect("aud")}
                      onFocus={() => scheduleHoverSelect("aud", a.slug)}
                    />
                  ))}
                </ScrollBody>
              </Shell>

              <Shell
                title={
                  flyAudience?.name
                    ? `Categories · ${flyAudience.name} · ${filteredCategories.length}`
                    : `Categories · ${filteredCategories.length}`
                }
              >
                <ScrollBody>
                  {filteredCategories.map((c) => (
                    <CompactRowButton
                      key={c.slug}
                      title={c.name}
                      subLeft={`${c.count} product${c.count === 1 ? "" : "s"}`}
                      badge={c.count}
                      active={c.slug === flyCategorySlug}
                      isDesktop
                      dense={false}
                      onNavigateHref={buildCollectionsHref({ tier: tierSlug, audience: flyAudienceSlug, category: c.slug })}
                      onNavigate={handleClose}
                      onClick={() => {}}
                      // ✅ Desktop: select on hover/focus (no click navigation change)
                      onMouseEnter={() => scheduleHoverSelect("cat", c.slug)}
                      onMouseLeave={() => cancelHoverSelect("cat")}
                      onFocus={() => scheduleHoverSelect("cat", c.slug)}
                    />
                  ))}
                </ScrollBody>
              </Shell>

              {/* Products column */}
              <div style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                    <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 12, color: "#0c2340" }}>
                      Products
                    </div>
                    <Pill tone="ink">{filteredProducts.length}</Pill>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {showRefine ? (
                      <>
                        {facetOptions.subCategories.length ? (
                          <Select
                            value={selectedSubCategory}
                            onChange={(e) => setSelectedSubCategory(e.target.value)}
                            options={facetOptions.subCategories}
                            placeholder="Subcategory"
                            isMobile={false}
                          />
                        ) : null}

                        {facetOptions.genderGroups.length ? (
                          <Select
                            value={selectedGenderGroup}
                            onChange={(e) => setSelectedGenderGroup(e.target.value)}
                            options={facetOptions.genderGroups}
                            placeholder="Gender"
                            isMobile={false}
                          />
                        ) : null}

                        {facetOptions.ageGroups.length ? (
                          <Select
                            value={selectedAgeGroup}
                            onChange={(e) => setSelectedAgeGroup(e.target.value)}
                            options={facetOptions.ageGroups}
                            placeholder="Age"
                            isMobile={false}
                          />
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
                        href={goViewAllHref}
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
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflow: "auto",
                      padding: 10,
                      WebkitOverflowScrolling: "touch",
                      overscrollBehavior: "contain",
                      touchAction: "pan-y",
                    }}
                  >
                    {filteredProducts.length ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))",
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
                              minWidth: 0,
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
            </div>
          ) : (
            /* ---------------- Mobile: sectioned (all features accessible, no overflow) ---------------- */
            <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {mobileSection === "audiences" ? (
                <Shell
                  title={`Audiences · ${filteredAudiences.length}`}
                  right={<Pill tone="ink" size="sm">{filteredAudiences.reduce((acc, a) => acc + (a.count || 0), 0)}</Pill>}
                >
                  <ScrollBody compact>
                    {filteredAudiences.map((a) => {
                      const isActive = a.slug === flyAudienceSlug;
                      const href = buildCollectionsHref({ tier: tierSlug, audience: a.slug });

                      return (
                        <CompactRowButton
                          key={a.slug}
                          title={a.name}
                          subLeft={`${a.count} product${a.count === 1 ? "" : "s"}`}
                          badge={a.count}
                          active={isActive}
                          isDesktop={false}
                          dense
                          onNavigateHref={null}
                          onNavigate={null}
                          onClick={() => {
                            // ✅ Mobile intelligent click:
                            // - First tap: select + go to Categories (browse)
                            // - Second tap (already active): go to Audience "See All" page
                            if (isActive) {
                              router.push(href);
                              handleClose();
                              return;
                            }
                            setHoverAudienceSlug(a.slug);
                            setHoverCategorySlug("");
                            setSelectedSubCategory("");
                            setSelectedGenderGroup("");
                            setSelectedAgeGroup("");
                            setMobileSection("categories");
                          }}
                        />
                      );
                    })}
                  </ScrollBody>
                </Shell>
              ) : null}

              {mobileSection === "categories" ? (
                <Shell
                  title={
                    flyAudience?.name
                      ? `Categories · ${flyAudience.name} · ${filteredCategories.length}`
                      : `Categories · ${filteredCategories.length}`
                  }
                  right={
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {goAudienceAllHref ? (
                        <Link
                          href={goAudienceAllHref}
                          onClick={handleClose}
                          style={{
                            textDecoration: "none",
                            height: 30,
                            padding: "0 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(12,35,64,0.22)",
                            background: "linear-gradient(135deg, #0c2340 10%, #163060 100%)",
                            boxShadow: "0 12px 22px rgba(12,35,64,0.14)",
                            color: "#fffdf8",
                            fontWeight: 900,
                            letterSpacing: ".12em",
                            textTransform: "uppercase",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "clamp(8px, 2.4vw, 9px)",
                            whiteSpace: "nowrap",
                          }}
                          aria-label="See all products in this audience"
                        >
                          See All
                        </Link>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setMobileSection("audiences")}
                        style={{
                          height: 30,
                          padding: "0 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: "rgba(255,255,255,0.92)",
                          boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                          fontWeight: 900,
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          fontSize: "clamp(8px, 2.4vw, 9px)",
                          color: "#0c2340",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Back
                      </button>
                    </div>
                  }
                >
                  <ScrollBody compact>
                    {filteredCategories.map((c) => {
                      const isActive = c.slug === flyCategorySlug;
                      const href = buildCollectionsHref({ tier: tierSlug, audience: flyAudienceSlug, category: c.slug });

                      return (
                        <CompactRowButton
                          key={c.slug}
                          title={c.name}
                          subLeft={`${c.count} product${c.count === 1 ? "" : "s"}`}
                          badge={c.count}
                          active={isActive}
                          isDesktop={false}
                          dense
                          onClick={() => {
                            // ✅ Mobile intelligent click:
                            // - First tap: select + go to Products (browse)
                            // - Second tap (already active): go to Category "See All" page
                            if (isActive) {
                              router.push(href);
                              handleClose();
                              return;
                            }
                            setHoverCategorySlug(c.slug);
                            setSelectedSubCategory("");
                            setSelectedGenderGroup("");
                            setSelectedAgeGroup("");
                            setMobileSection("products");
                          }}
                        />
                      );
                    })}
                  </ScrollBody>
                </Shell>
              ) : null}

              {mobileSection === "products" ? (
                <div style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
                  <div
                    style={{
                      borderRadius: 18,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "linear-gradient(135deg, rgba(255,255,255,0.92) 55%, rgba(247,243,231,0.92) 100%)",
                      boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                        <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 12, color: "#0c2340" }}>
                          Products
                        </div>
                        <Pill tone="ink" size="sm">{filteredProducts.length}</Pill>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {goCategoryAllHref ? (
                          <Link
                            href={goCategoryAllHref}
                            onClick={handleClose}
                            style={{
                              textDecoration: "none",
                              height: 30,
                              padding: "0 10px",
                              borderRadius: 999,
                              border: "1px solid rgba(12,35,64,0.22)",
                              background: "linear-gradient(135deg, #0c2340 10%, #163060 100%)",
                              boxShadow: "0 12px 22px rgba(12,35,64,0.14)",
                              color: "#fffdf8",
                              fontWeight: 900,
                              letterSpacing: ".12em",
                              textTransform: "uppercase",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "clamp(8px, 2.4vw, 9px)",
                              whiteSpace: "nowrap",
                            }}
                            aria-label="See all products in this category"
                          >
                            See All
                          </Link>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => setMobileSection("categories")}
                          style={{
                            height: 30,
                            padding: "0 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.92)",
                            boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                            fontWeight: 900,
                            letterSpacing: ".12em",
                            textTransform: "uppercase",
                            fontSize: "clamp(8px, 2.4vw, 9px)",
                            color: "#0c2340",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Back
                        </button>
                      </div>
                    </div>

                    {showRefine ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                        {facetOptions.subCategories.length ? (
                          <Select
                            value={selectedSubCategory}
                            onChange={(e) => setSelectedSubCategory(e.target.value)}
                            options={facetOptions.subCategories}
                            placeholder="Subcategory"
                            isMobile
                          />
                        ) : null}

                        {facetOptions.genderGroups.length ? (
                          <Select
                            value={selectedGenderGroup}
                            onChange={(e) => setSelectedGenderGroup(e.target.value)}
                            options={facetOptions.genderGroups}
                            placeholder="Gender"
                            isMobile
                          />
                        ) : null}

                        {facetOptions.ageGroups.length ? (
                          <Select
                            value={selectedAgeGroup}
                            onChange={(e) => setSelectedAgeGroup(e.target.value)}
                            options={facetOptions.ageGroups}
                            placeholder="Age"
                            isMobile
                          />
                        ) : null}

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {selectedSubCategory || selectedGenderGroup || selectedAgeGroup ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSubCategory("");
                                setSelectedGenderGroup("");
                                setSelectedAgeGroup("");
                              }}
                              style={{
                                height: 32,
                                padding: "0 10px",
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,0.10)",
                                background: "rgba(255,255,255,0.96)",
                                boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                                fontWeight: 900,
                                letterSpacing: ".10em",
                                textTransform: "uppercase",
                                fontSize: "clamp(9px, 2.6vw, 10px)",
                                cursor: "pointer",
                                color: "#0c2340",
                              }}
                            >
                              Clear Refine
                            </button>
                          ) : null}

                          {goViewAllHref ? (
                            <Link
                              href={goViewAllHref}
                              onClick={handleClose}
                              style={{
                                textDecoration: "none",
                                height: 32,
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
                                fontSize: "clamp(9px, 2.6vw, 10px)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              View All →
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      goViewAllHref ? (
                        <Link
                          href={goViewAllHref}
                          onClick={handleClose}
                          style={{
                            textDecoration: "none",
                            height: 32,
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
                            fontSize: "clamp(9px, 2.6vw, 10px)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          View All →
                        </Link>
                      ) : null
                    )}
                  </div>

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
                      minWidth: 0,
                    }}
                  >
                    {/* ✅ Mobile list: breathing space above + below (inside scroll), keep everything else intact */}
                    <div
                      style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                        padding: 0,
                        WebkitOverflowScrolling: "touch",
                        overscrollBehavior: "contain",
                        touchAction: "pan-y",
                      }}
                    >
                      <div
                        style={{
                          paddingTop: 12,
                          paddingLeft: 10,
                          paddingRight: 10,
                          paddingBottom: `calc(18px + env(safe-area-inset-bottom, 0px))`,
                          minHeight: 0,
                        }}
                      >
                        {/* empty space above the list */}
                        <div aria-hidden="true" style={{ height: 10 }} />

                        {filteredProducts.length ? (
                          <>
                            {/* ✅ Mobile: single-column list + 2-line clamp to show names clearly */}
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr",
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
                                    alignItems: "flex-start",
                                    justifyContent: "space-between",
                                    gap: 10,
                                    minHeight: 50,
                                    minWidth: 0,
                                    contentVisibility: "auto",
                                    containIntrinsicSize: "60px",
                                  }}
                                >
                                  <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                                    <div
                                      style={{
                                        fontWeight: 900,
                                        letterSpacing: ".04em",
                                        textTransform: "uppercase",
                                        fontSize: "clamp(10px, 2.9vw, 11px)",
                                        lineHeight: 1.25,
                                        display: "-webkit-box",
                                        WebkitBoxOrient: "vertical",
                                        WebkitLineClamp: 2,
                                        overflow: "hidden",
                                      }}
                                    >
                                      {p.name}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: "clamp(8px, 2.3vw, 9px)",
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
                                      fontSize: "clamp(8px, 2.3vw, 9px)",
                                      letterSpacing: ".10em",
                                      textTransform: "uppercase",
                                      marginTop: 1,
                                    }}
                                  >
                                    Open
                                  </span>
                                </Link>
                              ))}
                            </div>

                            {/* empty space below the list */}
                            <div aria-hidden="true" style={{ height: 14 }} />

                            {/* extra breathing room at the very bottom */}
                            <div aria-hidden="true" style={{ height: 10 }} />
                          </>
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
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
