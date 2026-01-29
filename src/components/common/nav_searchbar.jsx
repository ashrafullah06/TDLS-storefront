//✅ FULL FILE: src/components/common/nav_searchbar.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * HARD GUARANTEES (ZERO WRONG DIRECTIONS):
 * 1) NEVER navigates to any “assumed” page.
 * 2) Navigation is allowed ONLY to VERIFIED public pages discovered via:
 *    A) Your REAL public sitemaps (same-origin), OR
 *    B) Real same-origin HTML crawl (internal links actually present),
 *    C) Pinned routes that exist and are public ("/", "/product", "/collections").
 * 3) NO guessing URLs. If nothing matches, we do NOT navigate.
 * 4) NEVER show/navigate to private/user/admin routes (admin/account/cart/checkout/orders/etc).
 *
 * WHY THIS VERSION FIXES "ONLY 2 LINKS":
 * - Previously a tiny cached index (2 items) could persist for TTL (or parsing could fail).
 * - Now: small caches are invalidated automatically + sitemap parsing is namespace-safe
 * - Also: Enter now computes best match synchronously (no stale selection routing).
 */

const LS_POP_KEY = "tdls:navsearch:popularity:v1";

// bump versions (force rebuild; previous caches may contain only 2 pinned items)
const LS_INDEX_KEY = "tdls:navsearch:index:v6_full";
const LS_INDEX_TS_KEY = "tdls:navsearch:index_ts:v6_full";

const LS_TITLE_KEY = "tdls:navsearch:titlecache:v2";
const LS_TITLE_PREFETCH_TS_KEY = "tdls:navsearch:titleprefetch_ts:v1";

// If index is smaller than this, it is considered broken and will rebuild.
const MIN_USABLE_INDEX_ITEMS = 12;

const INDEX_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const TITLE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const TITLE_MAX_ENTRIES = 4000;

// background title prefetch
const TITLE_PREFETCH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h throttle
const TITLE_PREFETCH_MAX_PER_SESSION = 160; // hard cap per tab session
const TITLE_PREFETCH_CONCURRENCY = 2;

const MOBILE_MAX_WIDTH_PX = 640;
const MOBILE_MEDIA = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

const RANK_DEBOUNCE_MS = 60;

// fetch budgets
const FETCH_TIMEOUT_MS = 9000;
const HTML_TITLE_TIMEOUT_MS = 2200;

// sitemap
const SITEMAP_FETCH_CONCURRENCY = 4;
const SITEMAP_MAX_SITEMAPS = 512;
const SITEMAP_MAX_URLS = 75000;

// html crawl fallback (only if sitemap indexing returns too few)
const HTML_CRAWL_CONCURRENCY = 3;
const HTML_CRAWL_TIMEOUT_MS = 5200;
const HTML_CRAWL_MAX_PAGES = 3500;
const HTML_CRAWL_MAX_QUEUE = 14000;

// show more; panel is scrollable
const SUGGESTION_LIMIT = 28;
const ENRICH_VISIBLE_MAX = 8;

/** Pinned safe routes (these exist in your app and are public). */
const SAFE_PINNED_PAGES = [
  { type: "page", label: "Home", href: "/", source: "pinned", _labelSource: "pinned" },
  { type: "page", label: "All Products", href: "/product", source: "pinned", _labelSource: "pinned" },
  { type: "page", label: "Collections", href: "/collections", source: "pinned", _labelSource: "pinned" },
];

/**
 * Sitemap entrypoints (REAL routes, same-origin).
 * We try all of them directly to avoid relying on one index only.
 */
const SITEMAP_ENTRYPOINTS_FALLBACK = [
  "/sitemap.xml",
  "/sitemap-products.xml",
  "/sitemap-collections.xml",
  "/sitemap-static.xml",
  "/server-sitemap.xml",
  "/sitemap-blog.xml",
];

/* ---------------- utils ---------------- */

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (s) => norm(s).split(" ").filter(Boolean);

const stripHashAndQuery = (p) => {
  const s = String(p || "");
  const noHash = s.split("#")[0] || "";
  const noQuery = noHash.split("?")[0] || "";
  return noQuery || "";
};

const canonicalPath = (p) => {
  let x = stripHashAndQuery(String(p || "").trim());
  if (!x.startsWith("/")) return "";
  x = x.replace(/\/{2,}/g, "/");
  if (x.length > 1 && x.endsWith("/")) x = x.slice(0, -1);
  return x;
};

const sanitizeInternalHref = (href) => {
  const h = String(href || "").trim();
  if (!h) return null;
  if (h.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(h)) return null; // any scheme
  if (!h.startsWith("/")) return null;
  const c = canonicalPath(h);
  return c || null;
};

const isAssetLike = (p) =>
  /\.(png|jpg|jpeg|webp|gif|svg|ico|css|js|mjs|map|json|xml|txt|pdf|zip|mp4|mov|woff2?|ttf)$/i.test(p);

/**
 * PUBLIC ROUTE POLICY (no admin/private/account/checkout/etc)
 */
const isPublicNavigablePath = (path) => {
  const p = canonicalPath(path);
  if (!p || !p.startsWith("/")) return false;

  if (p.startsWith("/_next/")) return false;
  if (isAssetLike(p)) return false;

  const denyPrefixes = [
    "/admin",
    "/api",
    "/internal",
    "/draft",
    "/private",
    "/preview",
    "/login",
    "/signin",
    "/signup",
    "/logout",
    "/account",
    "/customer",
    "/profile",
    "/orders",
    "/cart",
    "/checkout",
    "/info",

    // keep these out of nav-search suggestions:
    "/search",
    "/wishlist",
    "/payment",
    "/forgot-password",
    "/signout",
    "/thank-you",
  ];

  for (const pref of denyPrefixes) {
    if (p === pref || p.startsWith(`${pref}/`)) return false;
  }

  return true;
};

const humanizePath = (p) => {
  const path = canonicalPath(p);
  if (!path || path === "/") return "Home";
  const segs = path.split("/").filter(Boolean);
  const tail = segs.slice(-2).join(" / ");
  const s = tail || segs.join(" / ") || path;

  return s
    .replace(/[-_]/g, " ")
    .replace(/\b[a-z]/g, (m) => m.toUpperCase());
};

const pickBestLabelForPath = (href) => {
  const p = canonicalPath(href);
  const segs = p.split("/").filter(Boolean);

  if (segs[0] === "product" && segs[1]) {
    const slug = segs.slice(1).join(" / ");
    const nice = slug.replace(/[-_]/g, " ").replace(/\b[a-z]/g, (m) => m.toUpperCase());
    return nice.length >= 3 ? nice : humanizePath(href);
  }

  if (segs[0] === "collections" && segs[1]) {
    const tail = segs.slice(1).join(" / ");
    const nice = tail.replace(/[-_]/g, " ").replace(/\b[a-z]/g, (m) => m.toUpperCase());
    return nice.length >= 3 ? nice : humanizePath(href);
  }

  return humanizePath(href);
};

const safeParseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const lsGet = (k) => {
  const w = safeWindow();
  if (!w) return null;
  try {
    return w.localStorage.getItem(k);
  } catch {
    return null;
  }
};

const lsSet = (k, v) => {
  const w = safeWindow();
  if (!w) return;
  try {
    w.localStorage.setItem(k, v);
  } catch {}
};

const alphaCompare = (a, b) => {
  const A = String(a || "").trim();
  const B = String(b || "").trim();
  return A.localeCompare(B, undefined, { sensitivity: "base" });
};

/* ---------------- popularity ---------------- */

const readPopularity = () => {
  const raw = lsGet(LS_POP_KEY);
  const obj = raw ? safeParseJson(raw) : null;
  return obj && typeof obj === "object" ? obj : {};
};

const bumpPopularity = (key) => {
  const w = safeWindow();
  if (!w) return;
  try {
    const pop = readPopularity();
    pop[key] = (pop[key] || 0) + 1;
    lsSet(LS_POP_KEY, JSON.stringify(pop));
  } catch {}
};

/* ---------------- cache (index) ---------------- */

const decodeIndexCache = (payload) => {
  // v6 format: { v:6, p:[[href,label,source,labelSource]...], i:[label...] }
  if (payload && typeof payload === "object" && payload.v === 6) {
    const pages = Array.isArray(payload.p) ? payload.p : [];
    const infos = Array.isArray(payload.i) ? payload.i : [];

    const out = [];
    for (const s of infos) {
      const label = String(s || "").trim();
      if (label) out.push({ type: "info", label });
    }

    for (const row of pages) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const href = sanitizeInternalHref(row[0]);
      const label = String(row[1] || "").trim();
      const source = String(row[2] || "sitemap");
      const _labelSource = String(row[3] || "path");
      if (!href) continue;

      out.push({ type: "page", href, label: label || pickBestLabelForPath(href), source, _labelSource });
    }
    return out;
  }

  // legacy: array of objects
  if (Array.isArray(payload)) return payload;
  return null;
};

const readIndexCache = () => {
  const ts = Number(lsGet(LS_INDEX_TS_KEY) || 0);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (Date.now() - ts > INDEX_TTL_MS) return null;

  const raw = lsGet(LS_INDEX_KEY);
  if (!raw) return null;

  const parsed = safeParseJson(raw);
  const decoded = decodeIndexCache(parsed);
  if (!decoded || !Array.isArray(decoded)) return null;

  // 🔥 critical fix: if cache is tiny (e.g., only pinned 2/3), treat as invalid.
  const usablePages = decoded.filter((x) => x?.type === "page" && x.href && isPublicNavigablePath(x.href));
  if (usablePages.length < MIN_USABLE_INDEX_ITEMS) return null;

  return decoded;
};

const writeIndexCache = (items) => {
  try {
    const pages = [];
    const infos = [];

    for (const it of items || []) {
      if (!it) continue;
      if (it.type === "info") {
        const label = String(it.label || "").trim();
        if (label) infos.push(label);
        continue;
      }
      if (it.type === "page") {
        const href = it.href ? sanitizeInternalHref(it.href) : null;
        if (!href) continue;
        if (!isPublicNavigablePath(href)) continue;

        const label = String(it.label || "").trim() || pickBestLabelForPath(href);
        const source = String(it.source || "sitemap");
        const ls = String(it._labelSource || "path");

        pages.push([href, label, source, ls]);
      }
    }

    // Defensive: don’t persist broken tiny indexes
    if (pages.length < MIN_USABLE_INDEX_ITEMS) return;

    // Reduce size by sorting + trimming duplicates (by href)
    const seen = new Set();
    const compact = [];
    for (const row of pages) {
      const href = row[0];
      if (!href || seen.has(href)) continue;
      seen.add(href);
      compact.push(row);
    }

    lsSet(LS_INDEX_KEY, JSON.stringify({ v: 6, p: compact, i: infos }));
    lsSet(LS_INDEX_TS_KEY, String(Date.now()));
  } catch {}
};

/* ---------------- title cache ---------------- */

const readTitleCache = () => {
  const raw = lsGet(LS_TITLE_KEY);
  const obj = raw ? safeParseJson(raw) : null;
  if (!obj || typeof obj !== "object") return { v: 2, items: {} };
  const items = obj.items && typeof obj.items === "object" ? obj.items : {};
  return { v: 2, items };
};

const writeTitleCache = (items) => {
  try {
    lsSet(LS_TITLE_KEY, JSON.stringify({ v: 2, items: items || {} }));
  } catch {}
};

const pruneTitleCache = (items) => {
  const now = Date.now();
  const entries = Object.entries(items || {}).filter(([k, v]) => {
    if (!k || !v) return false;
    const ts = Number(v.ts || 0);
    const label = String(v.label || "").trim();
    if (!label) return false;
    if (!Number.isFinite(ts) || ts <= 0) return false;
    if (now - ts > TITLE_TTL_MS) return false;
    return true;
  });

  entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  const trimmed = entries.slice(0, TITLE_MAX_ENTRIES);

  const out = {};
  for (const [k, v] of trimmed) out[k] = v;
  return out;
};

/* ---------------- index hydrate / dedupe ---------------- */

const dedupeIndex = (items) => {
  const seen = new Set();
  const out = [];

  for (const it of items || []) {
    if (!it) continue;

    if (it.type === "info") {
      const label = String(it.label || "").trim();
      if (!label) continue;
      const key = `info|${norm(label)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...it, label });
      continue;
    }

    if (it.type === "page") {
      const href = it.href ? sanitizeInternalHref(it.href) : null;
      if (!href) continue;
      if (!isPublicNavigablePath(href)) continue;

      const label = String(it.label || "").trim() || pickBestLabelForPath(href);
      const key = `page|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const _labelSource = it._labelSource || "path";

      out.push({
        ...it,
        href,
        label,
        _labelSource,
        _nLabel: norm(label),
        _tokens: tokenize(`${label} ${href}`),
      });
      continue;
    }
  }

  return out;
};

/* ---------------- matching/ranking ---------------- */

// fast trigram similarity (typo tolerance)
const trigrams = (s) => {
  const x = `  ${norm(s)}  `;
  const out = [];
  for (let i = 0; i < x.length - 2; i++) out.push(x.slice(i, i + 3));
  return out;
};

const trigramScore = (a, b) => {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.length || !B.length) return 0;

  const map = new Map();
  for (const t of A) map.set(t, (map.get(t) || 0) + 1);

  let inter = 0;
  for (const t of B) {
    const c = map.get(t) || 0;
    if (c > 0) {
      inter += 1;
      map.set(t, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
};

const scoreItem = (item, qNorm, qTokens, popMap) => {
  const labelNorm = item._nLabel || norm(item.label);
  if (!labelNorm) return -1;

  let score = 0;

  // Popularity weight (light)
  const popKey = item.href ? `href:${item.href}` : `l:${labelNorm}`;
  const pop = popMap?.[popKey] || 0;
  score += Math.min(60, pop * 6);

  // Exact / prefix / substring (label)
  if (labelNorm === qNorm) score += 1200;
  if (labelNorm.startsWith(qNorm)) score += 860;
  if (labelNorm.includes(qNorm)) score += 540;

  // Token overlap
  const tokens = item._tokens || tokenize(item.label);
  let overlap = 0;
  for (const t of tokens) if (qTokens.has(t)) overlap += 1;
  score += overlap * 160;

  // Typos: trigram similarity
  if (qNorm.length >= 3) {
    const sim = trigramScore(labelNorm, qNorm);
    if (sim > 0.25) score += Math.round(sim * 420);
  }

  // Prefer sitemap pages slightly
  if (item.source === "sitemap") score += 20;

  return score;
};

const withTimeout = async (fn, ms) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fn(ac.signal);
  } finally {
    clearTimeout(t);
  }
};

const hrefToInternalPath = (href) => {
  // Resolves absolute OR relative to same-origin. Non-http(s) schemes are rejected.
  try {
    const w = safeWindow();
    if (!w) return null;

    const h = String(href || "").trim();
    if (!h) return null;

    if (h.startsWith("#")) return null;
    if (h.startsWith("//")) return null;

    // Reject non-http(s) schemes (mailto:, tel:, javascript:, data:, etc.)
    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(h) && !/^https?:/i.test(h)) return null;

    const u = new URL(h, w.location.origin);
    if (u.origin !== w.location.origin) return null;

    return `${u.pathname}${u.search || ""}` || null;
  } catch {
    return null;
  }
};

const hrefToInternalPathFromBase = (href, basePath) => {
  // Like hrefToInternalPath but resolves relative links against the CURRENT PAGE path (HTML crawl correctness).
  try {
    const w = safeWindow();
    if (!w) return null;

    const h = String(href || "").trim();
    if (!h) return null;

    if (h.startsWith("#")) return null;
    if (h.startsWith("//")) return null;

    if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(h) && !/^https?:/i.test(h)) return null;

    const base = canonicalPath(basePath || "/") || "/";
    const baseDir = base === "/" ? "/" : `${base}/`;

    const u = new URL(h, `${w.location.origin}${baseDir}`);
    if (u.origin !== w.location.origin) return null;

    return `${u.pathname}${u.search || ""}` || null;
  } catch {
    return null;
  }
};

/**
 * Namespace-safe sitemap parsing:
 * - Extract <loc>...</loc> via regex (works with namespaces/default xmlns)
 * - Detect sitemapindex vs urlset by tags
 */
const parseSitemapXml = (xmlText) => {
  try {
    const s = String(xmlText || "");
    if (!s || s.length < 20) return { kind: "bad", locs: [] };

    const kind =
      /<\s*sitemapindex\b/i.test(s) || /<\s*sitemap\b/i.test(s) ? "index" : /<\s*urlset\b/i.test(s) ? "urlset" : "urlset";

    const locs = [];
    const re = /<\s*loc\s*>\s*([^<\s]+)\s*<\s*\/\s*loc\s*>/gi;
    let m = null;
    while ((m = re.exec(s))) {
      const v = String(m[1] || "").trim();
      if (v) locs.push(v);
      if (locs.length > 200000) break; // safety
    }

    return { kind, locs };
  } catch {
    return { kind: "bad", locs: [] };
  }
};

const parseRobotsSitemaps = (txt) => {
  const lines = String(txt || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out = [];
  for (const line of lines) {
    const m = line.match(/^sitemap:\s*(.+)$/i);
    if (!m) continue;
    const raw = String(m[1] || "").trim();
    if (!raw) continue;
    out.push(raw);
  }
  return out;
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(MOBILE_MEDIA);
    const update = () => setIsMobile(!!mql.matches);

    update();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    } else {
      mql.addListener(update);
      return () => mql.removeListener(update);
    }
  }, []);

  return isMobile;
}

function Spinner({ size = 14 }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid rgba(12,35,64,0.18)",
        borderTopColor: "rgba(12,35,64,0.75)",
        display: "inline-block",
        animation: "tdlsSpin .8s linear infinite",
      }}
    />
  );
}

const extractBestTitleFromHtml = (html) => {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const og =
      (doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || "").trim() ||
      (doc.querySelector('meta[name="twitter:title"]')?.getAttribute("content") || "").trim() ||
      "";

    const h1 = (doc.querySelector("h1")?.textContent || "").replace(/\s+/g, " ").trim();
    const t = (doc.querySelector("title")?.textContent || "").replace(/\s+/g, " ").trim();

    const candidates = [og, h1, t].filter(Boolean);
    const good = candidates.filter((x) => norm(x).length >= 3);

    const clean = (x) =>
      String(x)
        .replace(/\s*\|\s*The DNA Lab Store\s*$/i, "")
        .replace(/\s*-\s*The DNA Lab Store\s*$/i, "")
        .replace(/\s*\|\s*TDLS\s*$/i, "")
        .trim();

    const cleaned = good.map(clean).filter((x) => norm(x).length >= 3);

    cleaned.sort((a, b) => a.length - b.length);
    return cleaned[0] || clean(good[0] || candidates[0] || "");
  } catch {
    return "";
  }
};

export default function NavSearchbar({ className = "", placeholder = "Search products, collections, pages…" }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  if (isMobile) return null;

  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);

  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  const [indexReady, setIndexReady] = useState(false);
  const [isIndexing, setIsIndexing] = useState(true);
  const [indexedCount, setIndexedCount] = useState(0);

  const titleCacheRef = useRef(pruneTitleCache(readTitleCache().items || {}));
  const inFlightTitleRef = useRef(new Set());

  const [pageIndex, setPageIndex] = useState(() => {
    const cached = readIndexCache();
    if (cached && cached.length) {
      const hydrated = dedupeIndex(cached);
      const items = titleCacheRef.current || {};
      const merged = hydrated.map((it) => {
        if (it?.type !== "page") return it;
        const hit = items[it.href];
        if (hit && hit.label && Date.now() - (hit.ts || 0) <= TITLE_TTL_MS) {
          const label = String(hit.label).trim();
          if (label) {
            return {
              ...it,
              label,
              _labelSource: "title",
              _nLabel: norm(label),
              _tokens: tokenize(`${label} ${it.href}`),
            };
          }
        }
        return it;
      });
      return merged;
    }
    return dedupeIndex(SAFE_PINNED_PAGES);
  });

  const popRef = useRef({});
  const [suggestions, setSuggestions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);

  const composingRef = useRef(false);
  const rankTimerRef = useRef(null);

  const navAfterPaint = (fn) => {
    const w = safeWindow();
    if (!w) return fn();
    w.requestAnimationFrame(() => fn());
  };

  const gotoPage = useCallback(
    (href, labelForPop) => {
      const safe = sanitizeInternalHref(href);
      if (!safe) return;
      if (!isPublicNavigablePath(safe)) return;

      navAfterPaint(() => {
        router.push(safe);
        try {
          router.prefetch?.(safe);
        } catch {}
      });

      bumpPopularity(`href:${safe}`);
      if (labelForPop) bumpPopularity(`l:${norm(labelForPop)}`);
      popRef.current = readPopularity();

      setFocused(false);
      setActiveIdx(-1);
    },
    [router]
  );

  const clear = () => {
    setQ("");
    setSuggestions([]);
    setActiveIdx(-1);
  };

  useEffect(() => {
    const onPointer = (e) => {
      const wrap = wrapperRef.current;
      if (!wrap) return;
      if (!wrap.contains(e.target)) {
        setFocused(false);
        setActiveIdx(-1);
      }
    };
    const opts = { capture: true, passive: true };
    document.addEventListener("pointerdown", onPointer, opts);
    return () => document.removeEventListener("pointerdown", onPointer, opts);
  }, []);

  useEffect(() => {
    popRef.current = readPopularity();
  }, []);

  const showPanel = focused;

  const firstSelectableIdx = useCallback((arr) => {
    const n = arr?.length || 0;
    for (let i = 0; i < n; i += 1) {
      if (arr[i]?.type === "page") return i;
    }
    return -1;
  }, []);

  const bestMatchNow = useCallback(
    (query) => {
      const raw = String(query || "").trim();
      if (!raw) return null;
      const qNorm = norm(raw);
      if (!qNorm) return null;

      const qTokens = new Set(tokenize(qNorm));
      const pop = popRef.current || {};

      let best = null;
      let bestScore = -1;

      for (const it of pageIndex || []) {
        if (!it || it.type !== "page" || !it.href) continue;
        const s = scoreItem(it, qNorm, qTokens, pop);
        if (s > bestScore) {
          bestScore = s;
          best = it;
        }
      }

      if (!best || bestScore <= 0) return null;
      return best;
    },
    [pageIndex]
  );

  // ✅ Build index from REAL sitemaps + fallback HTML crawl (no guessing)
  useEffect(() => {
    let alive = true;

    const yieldToMain = () =>
      new Promise((resolve) => {
        const w = safeWindow();
        if (!w) return resolve();
        if (typeof w.requestIdleCallback === "function") {
          w.requestIdleCallback(() => resolve(), { timeout: 140 });
        } else {
          setTimeout(resolve, 0);
        }
      });

    const fetchText = async (path, acceptHeader, timeoutMs, cacheMode = "force-cache") => {
      const p = sanitizeInternalHref(path);
      if (!p) return null;

      const doFetch = async (cache, signal) => {
        const res = await fetch(p, {
          method: "GET",
          signal,
          headers: { accept: acceptHeader },
          cache,
        });
        if (!res.ok) return null;
        const text = await res.text().catch(() => "");
        if (!text || text.length < 10) return null;
        return text;
      };

      return withTimeout(async (signal) => {
        const t1 = await doFetch(cacheMode, signal).catch(() => null);
        if (t1) return t1;
        return await doFetch("no-store", signal).catch(() => null);
      }, timeoutMs);
    };

    const discoverEntrypoints = async () => {
      const entry = new Set();

      // robots.txt Sitemap: lines (real + same-origin)
      const robots = await fetchText("/robots.txt", "text/plain;q=0.9,*/*;q=0.8", 3500, "no-store").catch(
        () => null
      );

      if (robots) {
        const locs = parseRobotsSitemaps(robots);
        for (const loc of locs) {
          const internal = hrefToInternalPath(loc);
          const p = internal ? sanitizeInternalHref(internal) : null;
          if (p && /sitemap/i.test(p)) entry.add(p);
        }
      }

      // always include fallback sitemap endpoints (real routes)
      for (const sm of SITEMAP_ENTRYPOINTS_FALLBACK) {
        const p = sanitizeInternalHref(sm);
        if (p) entry.add(p);
      }

      return Array.from(entry);
    };

    const buildFromSitemaps = async () => {
      // ✅ critical fix: cached index must resolve to a SET of paths (boot expects Set), not an array of items.
      const cached = readIndexCache();
      if (cached && cached.length) {
        const set = new Set();
        for (const it of dedupeIndex(cached)) {
          if (it?.type === "page" && it.href && isPublicNavigablePath(it.href)) set.add(it.href);
        }
        if (set.size >= MIN_USABLE_INDEX_ITEMS) return set;
        // if cache is weirdly small, fall through to rebuild
      }

      const sitemapQueue = [];
      const enqueued = new Set();
      const fetched = new Set();
      const urlPaths = new Set();

      const enqueueSitemap = (maybePathOrAbs) => {
        const internal = hrefToInternalPath(maybePathOrAbs);
        if (!internal) return;

        const p0 = sanitizeInternalHref(internal);
        if (!p0) return;
        if (!/sitemap/i.test(p0)) return;

        if (enqueued.has(p0)) return;
        if (enqueued.size >= SITEMAP_MAX_SITEMAPS) return;

        enqueued.add(p0);
        sitemapQueue.push(p0);
      };

      const entrypoints = await discoverEntrypoints().catch(() => []);
      if (entrypoints?.length) {
        for (const sm of entrypoints) enqueueSitemap(sm);
      } else {
        for (const sm of SITEMAP_ENTRYPOINTS_FALLBACK) enqueueSitemap(sm);
      }

      let ptr = 0;

      const worker = async () => {
        while (alive) {
          const i = ptr++;
          if (i >= sitemapQueue.length) break;

          const smPath = sitemapQueue[i];
          if (!smPath) continue;
          if (fetched.has(smPath)) continue;
          fetched.add(smPath);

          const xml = await fetchText(smPath, "application/xml,text/xml;q=0.9,*/*;q=0.8", FETCH_TIMEOUT_MS).catch(
            () => null
          );
          if (!xml) continue;

          const parsed = parseSitemapXml(xml);
          if (!parsed?.locs?.length) continue;

          if (parsed.kind === "index") {
            for (const loc of parsed.locs) {
              if (enqueued.size >= SITEMAP_MAX_SITEMAPS) break;
              enqueueSitemap(loc);
            }
            continue;
          }

          // urlset
          for (const loc of parsed.locs) {
            if (urlPaths.size >= SITEMAP_MAX_URLS) break;

            const internal = hrefToInternalPath(loc);
            if (!internal) continue;

            const p = sanitizeInternalHref(internal);
            if (!p) continue;
            if (!isPublicNavigablePath(p)) continue;

            urlPaths.add(p);

            if (urlPaths.size % 900 === 0) await yieldToMain();
          }
        }
      };

      while (alive) {
        const startPtr = ptr;
        const workers = Array.from({ length: SITEMAP_FETCH_CONCURRENCY }).map(() => worker());
        await Promise.all(workers);

        if (ptr === startPtr) break;
        if (ptr >= sitemapQueue.length) break;
      }

      return urlPaths;
    };

    const crawlHtmlFallback = async (existingUrlPaths) => {
      const urlPaths = new Set(existingUrlPaths || []);
      const visited = new Set();
      const queue = [];

      const seed = (p) => {
        const x = sanitizeInternalHref(p);
        if (!x) return;
        if (!isPublicNavigablePath(x)) return;
        if (visited.has(x)) return;
        visited.add(x);
        queue.push(x);
      };

      // verified public seeds
      seed("/");
      seed("/product");
      seed("/collections");

      let inflight = 0;
      let processed = 0;

      const parseLinksAndTitle = (html, basePath) => {
        const outLinks = [];
        let title = "";

        try {
          const doc = new DOMParser().parseFromString(html, "text/html");
          const anchors = Array.from(doc.querySelectorAll("a[href]"));
          for (const a of anchors) {
            const h = a.getAttribute("href") || "";
            const internal = hrefToInternalPathFromBase(h, basePath);
            const p = internal ? sanitizeInternalHref(internal) : null;
            if (!p) continue;
            outLinks.push(p);
          }

          // title extraction (real)
          title = extractBestTitleFromHtml(html) || "";

          // If no title, at least use the best path label (still real)
          if (!title) title = pickBestLabelForPath(basePath);
        } catch {
          title = pickBestLabelForPath(basePath);
        }

        return { outLinks, title };
      };

      const takeNext = () => {
        while (queue.length && visited.size < HTML_CRAWL_MAX_QUEUE) {
          const p = queue.shift();
          if (!p) continue;
          if (!isPublicNavigablePath(p)) continue;
          return p;
        }
        return null;
      };

      const storeTitle = (href, label) => {
        const clean = String(label || "").replace(/\s+/g, " ").trim();
        if (!clean || norm(clean).length < 3) return;

        const nextCache = pruneTitleCache({
          ...(titleCacheRef.current || {}),
          [href]: { label: clean, ts: Date.now() },
        });

        titleCacheRef.current = nextCache;
        writeTitleCache(nextCache);
      };

      const worker = async () => {
        while (alive) {
          if (processed >= HTML_CRAWL_MAX_PAGES) break;
          const p = takeNext();
          if (!p) break;

          processed += 1;
          inflight += 1;

          const html = await fetchText(
            p,
            "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            HTML_CRAWL_TIMEOUT_MS,
            "no-store"
          ).catch(() => null);

          inflight -= 1;

          if (!alive) break;
          if (!html) continue;

          // Add the page itself
          if (isPublicNavigablePath(p)) urlPaths.add(p);

          const { outLinks, title } = parseLinksAndTitle(html, p);
          if (title) storeTitle(p, title);

          for (const link of outLinks) {
            const c = canonicalPath(link);
            if (!c) continue;
            if (!isPublicNavigablePath(c)) continue;
            if (visited.has(c)) continue;
            visited.add(c);
            queue.push(c);
          }

          if (processed % 40 === 0) await yieldToMain();
        }
      };

      const workers = Array.from({ length: HTML_CRAWL_CONCURRENCY }).map(() => worker());
      await Promise.all(workers);

      return urlPaths;
    };

    const boot = async () => {
      setIsIndexing(true);
      setIndexReady(false);

      // 1) sitemap-first
      let urlPaths = await buildFromSitemaps().catch(() => new Set());

      // 2) fallback html crawl if sitemap index looks broken/too small
      if (!urlPaths || urlPaths.size < MIN_USABLE_INDEX_ITEMS) {
        urlPaths = await crawlHtmlFallback(urlPaths).catch(() => urlPaths || new Set());
      }

      if (!alive) return;

      const titleItems = titleCacheRef.current || {};
      const pages = [];

      for (const p of urlPaths || []) {
        const hit = titleItems[p];
        const titleLabel =
          hit && hit.label && Date.now() - (hit.ts || 0) <= TITLE_TTL_MS ? String(hit.label || "").trim() : "";

        pages.push({
          type: "page",
          href: p,
          label: titleLabel || pickBestLabelForPath(p),
          source: "sitemap",
          _labelSource: titleLabel ? "title" : "path",
        });
      }

      const merged = dedupeIndex([...SAFE_PINNED_PAGES, ...pages]);

      setPageIndex(merged);
      setIndexedCount(merged.length);
      setIndexReady(true);
      setIsIndexing(false);

      // persist (only if non-broken size)
      writeIndexCache(merged);
    };

    const t = setTimeout(() => {
      boot().catch(() => {
        if (!alive) return;
        const fallback = dedupeIndex(SAFE_PINNED_PAGES);
        setPageIndex(fallback);
        setIndexedCount(fallback.length);
        setIndexReady(true);
        setIsIndexing(false);
      });
    }, 30);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  // ✅ Alphabetical default list + relevance list for query
  useEffect(() => {
    const query = q.trim();
    if (rankTimerRef.current) clearTimeout(rankTimerRef.current);

    if (!showPanel) {
      setSuggestions([]);
      setActiveIdx(-1);
      return;
    }

    rankTimerRef.current = setTimeout(() => {
      const pop = popRef.current || {};

      // No query => A–Z (pinned always on top)
      if (!query) {
        const pinned = dedupeIndex(SAFE_PINNED_PAGES);

        const others = pageIndex
          .filter((x) => x?.type === "page")
          .filter((x) => x && x.href !== "/" && x.href !== "/product" && x.href !== "/collections")
          .slice()
          .sort((a, b) => {
            const c = alphaCompare(a.label, b.label);
            if (c !== 0) return c;
            return alphaCompare(a.href, b.href);
          });

        const merged = dedupeIndex([...pinned, ...others.slice(0, SUGGESTION_LIMIT)]);
        setSuggestions(merged);
        setActiveIdx(firstSelectableIdx(merged));
        return;
      }

      const qNorm = norm(query);
      const qTokens = new Set(tokenize(qNorm));

      const scored = [];
      for (const it of pageIndex) {
        if (!it || it.type !== "page") continue;
        const s = scoreItem(it, qNorm, qTokens, pop);
        if (s > 0) scored.push({ it, s });
      }

      scored.sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        const c = alphaCompare(a.it.label, b.it.label);
        if (c !== 0) return c;
        return alphaCompare(a.it.href, b.it.href);
      });

      const pages = scored.slice(0, SUGGESTION_LIMIT).map((x) => x.it);

      if (!pages.length) {
        const info = {
          type: "info",
          label: `No verified public page found for “${query}”. We will not guess a destination.`,
        };
        const safe = dedupeIndex([info, ...SAFE_PINNED_PAGES]);
        setSuggestions(safe);
        setActiveIdx(-1);
        return;
      }

      const merged = dedupeIndex(pages);
      setSuggestions(merged);
      setActiveIdx(firstSelectableIdx(merged));
    }, RANK_DEBOUNCE_MS);

    return () => {
      if (rankTimerRef.current) clearTimeout(rankTimerRef.current);
    };
  }, [q, showPanel, pageIndex, firstSelectableIdx]);

  // ✅ Fetch HTML title (used by visible enrich + background prefetch)
  const fetchHtmlTitle = useCallback(async (href) => {
    const p = sanitizeInternalHref(href);
    if (!p) return "";

    return withTimeout(async (signal) => {
      const res = await fetch(p, {
        method: "GET",
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "x-tdls-navsearch": "1",
        },
        cache: "no-store",
      });
      if (!res.ok) return "";

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return "";

      const html = await res.text().catch(() => "");
      if (!html || html.length < 80) return "";

      return extractBestTitleFromHtml(html);
    }, HTML_TITLE_TIMEOUT_MS);
  }, []);

  // ✅ Enrich visible results fast (real data only)
  useEffect(() => {
    let alive = true;

    const needsEnrich = (it) => {
      if (!it || it.type !== "page") return false;
      if (!it.href) return false;
      if (!isPublicNavigablePath(it.href)) return false;
      if (it.source === "pinned") return false;

      if (it._labelSource && it._labelSource !== "path") return false;

      const p = canonicalPath(it.href);
      return p.startsWith("/product/") || p.startsWith("/collections/") || p === "/collections";
    };

    const run = async () => {
      if (!showPanel) return;

      const candidates = (suggestions || []).filter(needsEnrich).slice(0, ENRICH_VISIBLE_MAX);
      if (!candidates.length) return;

      const cache = titleCacheRef.current || {};
      const updates = {};

      for (const it of candidates) {
        const href = it.href;
        if (!href) continue;

        const existing = cache[href];
        if (existing && existing.label && Date.now() - (existing.ts || 0) <= TITLE_TTL_MS) continue;
        if (inFlightTitleRef.current.has(href)) continue;

        inFlightTitleRef.current.add(href);

        const title = await fetchHtmlTitle(href).catch(() => "");
        inFlightTitleRef.current.delete(href);

        if (!alive) return;

        const clean = String(title || "").replace(/\s+/g, " ").trim();
        if (!clean || norm(clean).length < 3) continue;

        updates[href] = clean;
      }

      const keys = Object.keys(updates);
      if (!keys.length) return;

      const nextCache = pruneTitleCache({
        ...(titleCacheRef.current || {}),
        ...keys.reduce((acc, k) => {
          acc[k] = { label: updates[k], ts: Date.now() };
          return acc;
        }, {}),
      });

      titleCacheRef.current = nextCache;
      writeTitleCache(nextCache);

      setPageIndex((prev) => {
        const next = (prev || []).map((it) => {
          if (!it || it.type !== "page") return it;
          const hit = updates[it.href];
          if (!hit) return it;

          const label = String(hit).trim();
          return {
            ...it,
            label,
            _labelSource: "title",
            _nLabel: norm(label),
            _tokens: tokenize(`${label} ${it.href}`),
          };
        });

        writeIndexCache(next);
        return next;
      });
    };

    run().catch(() => {});

    return () => {
      alive = false;
    };
  }, [showPanel, suggestions, fetchHtmlTitle]);

  /**
   * ✅ WHOLE-SITE TITLE PREFETCH (background):
   * - Makes search work by real names across sitemap URLs.
   * - Throttled + idle-based + capped.
   */
  useEffect(() => {
    let alive = true;

    const w = safeWindow();
    if (!w) return;

    if (!indexReady || isIndexing) return;

    const lastTs = Number(lsGet(LS_TITLE_PREFETCH_TS_KEY) || 0);
    if (Number.isFinite(lastTs) && lastTs > 0 && Date.now() - lastTs < TITLE_PREFETCH_MIN_INTERVAL_MS) {
      return;
    }

    const cache = titleCacheRef.current || {};
    const now = Date.now();

    const candidates = (pageIndex || [])
      .filter((it) => it?.type === "page" && it.href && isPublicNavigablePath(it.href))
      .filter((it) => {
        const hit = cache[it.href];
        if (hit && hit.label && now - (hit.ts || 0) <= TITLE_TTL_MS) return false;
        return (it._labelSource || "path") === "path";
      })
      .sort((a, b) => {
        const ap = canonicalPath(a.href);
        const bp = canonicalPath(b.href);

        const aPri = ap.startsWith("/product/") ? 0 : ap.startsWith("/collections/") || ap === "/collections" ? 1 : 2;
        const bPri = bp.startsWith("/product/") ? 0 : bp.startsWith("/collections/") || bp === "/collections" ? 1 : 2;

        if (aPri !== bPri) return aPri - bPri;
        return alphaCompare(a.label, b.label);
      });

    if (!candidates.length) return;

    lsSet(LS_TITLE_PREFETCH_TS_KEY, String(Date.now()));

    const queue = candidates.slice(0, TITLE_PREFETCH_MAX_PER_SESSION);
    let idx = 0;

    const applyTitle = (href, label) => {
      if (!href || !label) return;

      const nextCache = pruneTitleCache({
        ...(titleCacheRef.current || {}),
        [href]: { label, ts: Date.now() },
      });

      titleCacheRef.current = nextCache;
      writeTitleCache(nextCache);

      setPageIndex((prev) => {
        const next = (prev || []).map((it) => {
          if (!it || it.type !== "page") return it;
          if (it.href !== href) return it;

          return {
            ...it,
            label,
            _labelSource: "title",
            _nLabel: norm(label),
            _tokens: tokenize(`${label} ${it.href}`),
          };
        });

        writeIndexCache(next);
        return next;
      });
    };

    const runOne = async (href) => {
      if (!href) return;
      if (inFlightTitleRef.current.has(href)) return;

      inFlightTitleRef.current.add(href);
      const title = await fetchHtmlTitle(href).catch(() => "");
      inFlightTitleRef.current.delete(href);

      if (!alive) return;

      const clean = String(title || "").replace(/\s+/g, " ").trim();
      if (!clean || norm(clean).length < 3) return;
      applyTitle(href, clean);
    };

    const pump = async () => {
      if (!alive) return;

      const batch = [];
      while (idx < queue.length && batch.length < TITLE_PREFETCH_CONCURRENCY) {
        const it = queue[idx++];
        if (!it?.href) continue;
        batch.push(runOne(it.href));
      }

      if (batch.length) await Promise.all(batch);
      if (!alive) return;
      if (idx >= queue.length) return;

      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(() => pump().catch(() => {}), { timeout: 300 });
      } else {
        setTimeout(() => pump().catch(() => {}), 60);
      }
    };

    const t = setTimeout(() => {
      pump().catch(() => {});
    }, 450);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [indexReady, isIndexing, pageIndex, fetchHtmlTitle]);

  const onPickSuggestion = useCallback(
    (item) => {
      if (!item) return;
      if (item.type === "info") return;
      if (item.type !== "page") return;

      const href = item.href;
      if (!href) return;

      setQ(item.label || "");
      gotoPage(href, item.label);
    },
    [gotoPage]
  );

  const containerStyle = useMemo(
    () => ({
      display: "flex",
      alignItems: "center",
      background: "#F8F6EE",
      border: "1px solid #ECE9DB",
      margin: 0,
      padding: "2px 10px 2px 10px",
      position: "relative",
      maxWidth: 340,
      minWidth: 160,
      width: "clamp(160px, 26vw, 300px)",
      borderRadius: 9999,
      boxShadow: focused ? "0 8px 20px rgba(12,35,64,.06)" : "0 2px 6px rgba(12,35,64,.04)",
      transition: "box-shadow .15s ease, background .2s ease",
    }),
    [focused]
  );

  const highlight = (label, query) => {
    const qn = norm(query);
    if (!qn) return label;

    const ln = String(label || "");
    const lower = norm(ln);

    const idx = lower.indexOf(qn);
    if (idx < 0) return ln;

    const rawLower = ln.toLowerCase();
    const rawIdx = rawLower.indexOf(String(query || "").toLowerCase());
    const start = rawIdx >= 0 ? rawIdx : idx;
    const end = start + (String(query || "").length || qn.length);

    return (
      <>
        {ln.slice(0, start)}
        <mark className="tdls-mark">{ln.slice(start, end)}</mark>
        {ln.slice(end)}
      </>
    );
  };

  return (
    <div suppressHydrationWarning className={`${className}`} ref={wrapperRef} style={{ position: "relative" }}>
      <form
        role="search"
        aria-label="Site search"
        onSubmit={(e) => {
          e.preventDefault();

          const query = q.trim();

          // If user has actively selected a suggestion, respect it.
          const selected = activeIdx >= 0 ? suggestions[activeIdx] : null;
          if (selected && selected.type === "page" && selected.href) {
            onPickSuggestion(selected);
            return;
          }

          // ✅ Critical fix: compute best match NOW (no stale routing to pinned).
          if (query) {
            const best = bestMatchNow(query);
            if (best) onPickSuggestion(best);
            else setFocused(true); // no navigation if no verified match
            return;
          }

          setFocused(true);
        }}
        className="tdls-search-form"
        style={{ position: "relative" }}
      >
        <div className="tdls-searchwrap" style={containerStyle}>
          <button type="submit" aria-label="Go" className="tdls-search-ico" title="Go">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#0c2340" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20L17 17" />
            </svg>
          </button>

          <input
            ref={inputRef}
            className="tdls-search-input"
            aria-label="Search site"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                clear();
                inputRef.current?.blur();
                setFocused(false);
                return;
              }
              if (composingRef.current) return;
              if (!showPanel) return;

              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => {
                  const n = suggestions.length;
                  if (!n) return -1;
                  let next = i < 0 ? 0 : (i + 1) % n;
                  for (let k = 0; k < n; k++) {
                    if (suggestions[next]?.type === "page") return next;
                    next = (next + 1) % n;
                  }
                  return -1;
                });
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => {
                  const n = suggestions.length;
                  if (!n) return -1;
                  let next = i < 0 ? n - 1 : (i - 1 + n) % n;
                  for (let k = 0; k < n; k++) {
                    if (suggestions[next]?.type === "page") return next;
                    next = (next - 1 + n) % n;
                  }
                  return -1;
                });
              } else if (e.key === "Enter") {
                const selected = activeIdx >= 0 ? suggestions[activeIdx] : null;
                if (selected && selected.type === "page" && selected.href) {
                  e.preventDefault();
                  onPickSuggestion(selected);
                  return;
                }

                // ✅ same "best match now" fix for Enter
                const query = q.trim();
                if (query) {
                  const best = bestMatchNow(query);
                  if (best) {
                    e.preventDefault();
                    onPickSuggestion(best);
                  } else {
                    e.preventDefault();
                  }
                } else {
                  e.preventDefault();
                }
              }
            }}
            inputMode="search"
            autoComplete="off"
          />

          {isIndexing ? (
            <div
              className="tdls-loading"
              aria-label="Indexing"
              title="Indexing"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 6px" }}
            >
              <Spinner size={14} />
            </div>
          ) : null}

          {q ? (
            <button type="button" className="tdls-clear" aria-label="Clear" onClick={clear} title="Clear">
              ×
            </button>
          ) : null}
        </div>
      </form>

      <div
        className={`tdls-hints ${showPanel ? "show" : ""}`}
        role="listbox"
        aria-label="Verified public pages"
        aria-hidden={!showPanel}
        style={{ display: showPanel ? "block" : "none" }}
      >
        <div className="tdls-hints-head">
          <div className="tdls-hints-title">{q.trim() ? "Verified matches" : "Pages (A–Z)"}</div>
          <div className="tdls-hints-meta">
            {indexReady && !isIndexing ? `Ready · ${indexedCount || pageIndex.length} indexed` : "Indexing…"}
          </div>
        </div>

        {suggestions.length ? (
          suggestions.map((item, i) => {
            if (item.type === "info") {
              return (
                <div key={`info:${i}`} className="tdls-empty" role="note" aria-live="polite">
                  {item.label}
                </div>
              );
            }

            const isActive = i === activeIdx;
            const isPinned = item.source === "pinned";
            const labelSource = item._labelSource === "title" ? "Title" : isPinned ? "Safe" : "Verified";

            return (
              <div
                key={`page:${item.href}:${i}`}
                className={`tdls-hint ${isActive ? "active" : ""}`}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPickSuggestion(item);
                }}
              >
                <span className="tdls-hint-main" title={item.label}>
                  {highlight(item.label, q)}
                </span>
                <span className="tdls-hint-sub">{labelSource}</span>
              </div>
            );
          })
        ) : (
          <div className="tdls-empty">No verified pages indexed yet.</div>
        )}
      </div>

      <style jsx>{`
        @keyframes tdlsSpin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        .tdls-search-ico {
          background: transparent;
          border: none;
          padding: 8px 6px 8px 4px;
          display: flex;
          align-items: center;
          cursor: pointer;
        }

        .tdls-search-input {
          flex: 1 1 auto;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          padding: 8px 8px 8px 6px;
          font-size: 14px;
          letter-spacing: 0.03em;
          color: #0c2340;
        }
        .tdls-search-input::placeholder {
          color: #6b7280;
        }

        .tdls-clear {
          background: transparent;
          border: none;
          padding: 6px 4px;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          color: #0c2340;
        }

        .tdls-hints {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          padding: 8px;
          background: #ffffff;
          border: 1px solid #ece9db;
          border-radius: 10px;
          box-shadow: 0 10px 24px rgba(12, 35, 64, 0.08);
          width: max(260px, min(66vw, 420px));
          max-width: 92vw;
          display: none;
          z-index: 9998;

          max-height: min(62vh, 560px);
          overflow: auto;
        }
        .tdls-hints.show {
          display: block;
        }

        .tdls-hints-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          padding: 2px 4px 8px 4px;
          position: sticky;
          top: 0;
          background: #fff;
          z-index: 1;
        }
        .tdls-hints-title {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #0c2340;
        }
        .tdls-hints-meta {
          font-size: 11px;
          font-weight: 700;
          color: rgba(12, 35, 64, 0.55);
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        .tdls-hint {
          padding: 9px 10px;
          font-size: 14px;
          color: #0c2340;
          cursor: pointer;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .tdls-hint:hover {
          background: #f6f5ee;
        }
        .tdls-hint.active {
          background: #f6f5ee;
          box-shadow: inset 0 0 0 1px rgba(12, 35, 64, 0.08);
        }
        .tdls-hint-main {
          font-weight: 700;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tdls-hint-sub {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(12, 35, 64, 0.45);
          flex: 0 0 auto;
        }

        .tdls-empty {
          padding: 10px 10px;
          color: rgba(12, 35, 64, 0.7);
          font-size: 13px;
          font-weight: 700;
          line-height: 1.35;
          border-radius: 8px;
          background: #fbfaf6;
          border: 1px solid rgba(236, 233, 219, 0.9);
        }

        .tdls-mark {
          background: rgba(255, 221, 120, 0.55);
          padding: 0 2px;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}
