//✅ FULL FILE: src/components/common/nav_searchbar.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

/**
 * HARD GUARANTEES (ZERO WRONG DIRECTIONS):
 * 1) This component NEVER navigates to any “assumed” page.
 * 2) Navigation is allowed ONLY to:
 *    A) Pages discovered by crawling your own site (same-origin HTML crawl), OR
 *    B) Two 100%-certain pinned routes: "/" and "/product"
 * 3) No “search route” navigation. No /search push. No guessed category/product URLs.
 * 4) If “T-shirt / Trouser / …” does not map to a discovered page, we DO NOT navigate.
 *    We show a helpful, non-clickable message + safe CTAs (Home / All Products).
 * 5) Loading spinner remains visible while crawling + indexing.
 *
 * What “word-by-word” means in practice (without guessing URLs):
 * - We index discovered pages using:
 *   - Link labels (anchor text/aria-label/title),
 *   - Page text signals from fetched HTML (title, meta description, headings),
 *   - The URL path itself.
 * - We still ONLY navigate to discovered hrefs.
 *
 * IMPORTANT REALITY CHECK:
 * - A client-side crawler cannot discover pages that are not reachable via:
 *   - sitemap(s), OR
 *   - links present in fetched HTML.
 * - If your product detail pages are not in sitemap AND are not linked anywhere in HTML,
 *   then they are not discoverable here without introducing a server-side index endpoint.
 */

const LS_POP_KEY = "tdls:navsearch:popularity:v1";
const LS_INDEX_KEY = "tdls:navsearch:index:v2";
const LS_INDEX_TS_KEY = "tdls:navsearch:index_ts:v2";

const INDEX_TTL_MS = 12 * 60 * 60 * 1000; // 12h cache TTL (safe; avoids recrawling every page load)

const MOBILE_MAX_WIDTH_PX = 640;
const MOBILE_MEDIA = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

const FOCUS_ARM_WINDOW_MS = 1200;
const RANK_DEBOUNCE_MS = 70;

/** Only two “pinned safe” routes (100% certain). */
const SAFE_PINNED_PAGES = [
  { type: "page", label: "Home", href: "/", source: "pinned" },
  { type: "page", label: "All Products", href: "/product", source: "pinned" },
];

/** Crawl seeds: start here, then discover internal links. */
const CRAWL_SEEDS = ["/", "/product"];

/** Crawl budgets (keep fast + safe). */
const CRAWL_MAX_PAGES = 160; // maximum HTML pages fetched
const CRAWL_MAX_LINKS_PER_PAGE = 240; // maximum links parsed per fetched page
const CRAWL_TIMEOUT_MS = 1400; // per request
const CRAWL_CONCURRENCY = 4; // parallel fetches
const SITEMAP_MAX_URLS = 2500; // cap total sitemap URL candidates (budget safety)
const TEXT_TOKEN_BUDGET_CHARS = 2600; // cap text extracted per page for tokenization (memory safety)

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (s) => norm(s).split(" ").filter(Boolean);

const sanitizeInternalHref = (href) => {
  const h = String(href || "").trim();
  if (!h) return null;
  if (h.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(h)) return null; // any scheme
  if (!h.startsWith("/")) return null;
  return h;
};

const readPopularity = () => {
  try {
    const raw = localStorage.getItem(LS_POP_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
};

const bumpPopularity = (key) => {
  try {
    const pop = readPopularity();
    pop[key] = (pop[key] || 0) + 1;
    localStorage.setItem(LS_POP_KEY, JSON.stringify(pop));
  } catch {}
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
  try {
    const h = String(href || "").trim();
    if (!h) return null;

    // absolute -> internal if same-origin
    if (/^https?:\/\//i.test(h)) {
      const u = new URL(h, window.location.origin);
      if (u.origin !== window.location.origin) return null;
      return `${u.pathname}${u.search || ""}` || null;
    }

    // internal
    if (h.startsWith("/")) return h;

    return null;
  } catch {
    return null;
  }
};

const stripHashAndQuery = (p) => {
  const s = String(p || "");
  const noHash = s.split("#")[0] || "";
  const noQuery = noHash.split("?")[0] || "";
  return noQuery || "";
};

const isLikelyHtmlPagePath = (path) => {
  const p = stripHashAndQuery(path);
  if (!p || !p.startsWith("/")) return false;

  // deny obvious non-pages
  if (p.startsWith("/api/")) return false;
  if (p.startsWith("/_next/")) return false;
  if (p.startsWith("/admin")) return false;

  // deny file extensions (assets)
  if (
    /\.(png|jpg|jpeg|webp|gif|svg|ico|css|js|mjs|map|json|xml|txt|pdf|zip|mp4|mov|woff2?|ttf)$/i.test(
      p
    )
  )
    return false;

  return true;
};

const humanizePath = (p) => {
  const path = stripHashAndQuery(String(p || ""));
  if (!path || path === "/") return "Home";
  const seg = path
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join(" / ");
  if (!seg) return path;

  return seg
    .replace(/[-_]/g, " ")
    .replace(/\b[a-z]/g, (m) => m.toUpperCase());
};

const pickBestLabel = (labelsSet, href) => {
  const labels = Array.from(labelsSet || [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  if (!labels.length) return humanizePath(href);

  // Prefer the longest non-generic label
  const bad = new Set(["click here", "view", "open", "more", "details", "shop", "menu", "home"]);
  labels.sort((a, b) => b.length - a.length);

  const best =
    labels.find((l) => {
      const n = norm(l);
      if (!n) return false;
      if (bad.has(n)) return false;
      if (n.length < 3) return false;
      return true;
    }) || labels[0];

  return best || humanizePath(href);
};

const safeParseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const readIndexCache = () => {
  try {
    const ts = Number(localStorage.getItem(LS_INDEX_TS_KEY) || 0);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > INDEX_TTL_MS) return null;

    const raw = localStorage.getItem(LS_INDEX_KEY);
    if (!raw) return null;

    const data = safeParseJson(raw);
    if (!data || !Array.isArray(data)) return null;

    return data;
  } catch {
    return null;
  }
};

const writeIndexCache = (arr) => {
  try {
    localStorage.setItem(LS_INDEX_KEY, JSON.stringify(arr || []));
    localStorage.setItem(LS_INDEX_TS_KEY, String(Date.now()));
  } catch {}
};

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
      const href = it.href ? sanitizeInternalHref(stripHashAndQuery(it.href)) : null;
      if (!href) continue;

      const label = String(it.label || "").trim() || humanizePath(href);
      const key = `page|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const content = String(it._content || "").slice(0, TEXT_TOKEN_BUDGET_CHARS);

      out.push({
        ...it,
        href,
        label,
        _nLabel: norm(label),
        _content: content,
        _tokens: tokenize(`${label} ${href} ${content}`),
      });
      continue;
    }
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

const scoreItem = (item, qNorm, qTokens, popMap) => {
  const label = item._nLabel || norm(item.label);
  if (!label) return -1;

  let score = 0;

  // Popularity weight
  const popKey = item.href ? `href:${item.href}` : `l:${label}`;
  const pop = popMap?.[popKey] || 0;
  score += Math.min(60, pop * 6);

  // Phrase / prefix matching (label)
  if (label === qNorm) score += 980;
  if (label.startsWith(qNorm)) score += 720;
  if (label.includes(qNorm)) score += 520;

  // Also match against extracted page text signals (title/meta/headings)
  const content = norm(item._content || "");
  if (content) {
    if (content === qNorm) score += 520;
    if (content.includes(qNorm)) score += 260;
  }

  // Token overlap
  const tokens = item._tokens || tokenize(item.label);
  let overlap = 0;
  for (const t of tokens) if (qTokens.has(t)) overlap++;
  score += overlap * 140;

  // Prefer crawled pages over pinned (only when matching)
  if (item.source === "crawl") score += 40;

  return score;
};

export default function NavSearchbar({ className = "", placeholder = "Find pages…" }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  if (isMobile) return null;

  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);

  const [interacted, setInteracted] = useState(false);
  const lastArmAtRef = useRef(0);

  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  const [indexReady, setIndexReady] = useState(false);
  const [isIndexing, setIsIndexing] = useState(true);

  const [indexedCount, setIndexedCount] = useState(0);

  const [pageIndex, setPageIndex] = useState(() => {
    const cached = readIndexCache();
    if (cached && cached.length) return dedupeIndex(cached);
    return dedupeIndex(SAFE_PINNED_PAGES);
  });

  const popRef = useRef({});

  const [suggestions, setSuggestions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);

  const composingRef = useRef(false);
  const rankTimerRef = useRef(null);

  const navAfterPaint = (fn) => {
    if (typeof window === "undefined") return fn();
    window.requestAnimationFrame(() => fn());
  };

  const gotoPage = useCallback(
    (href, labelForPop) => {
      const safe = sanitizeInternalHref(stripHashAndQuery(href));
      if (!safe) return;

      navAfterPaint(() => router.push(safe));

      try {
        bumpPopularity(`href:${safe}`);
        if (labelForPop) bumpPopularity(`l:${norm(labelForPop)}`);
        popRef.current = readPopularity();
      } catch {}

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
    try {
      popRef.current = readPopularity();
    } catch {
      popRef.current = {};
    }
  }, []);

  // ✅ Site crawler (same-origin HTML): crawls sitemap(s) + links discovered in HTML.
  useEffect(() => {
    let alive = true;

    const yieldToMain = () =>
      new Promise((resolve) => {
        if (typeof window === "undefined") return resolve();
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => resolve(), { timeout: 120 });
        } else {
          setTimeout(resolve, 0);
        }
      });

    const fetchHtml = async (path) => {
      const p = stripHashAndQuery(path);
      if (!isLikelyHtmlPagePath(p)) return null;

      return withTimeout(async (signal) => {
        const res = await fetch(p, {
          method: "GET",
          signal,
          headers: {
            accept: "text/html,application/xhtml+xml",
            "x-tdls-crawl": "1",
          },
          cache: "no-store",
        });

        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!res.ok) return null;
        if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;

        const text = await res.text();
        if (!text || text.length < 64) return null;
        return text;
      }, CRAWL_TIMEOUT_MS);
    };

    const extractSignalsFromHtml = (html) => {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const title = (doc.querySelector("title")?.textContent || "").trim();

        const metaDesc =
          (doc.querySelector('meta[name="description"]')?.getAttribute("content") || "").trim() ||
          (doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || "").trim() ||
          "";

        const h = Array.from(doc.querySelectorAll("h1,h2,h3"))
          .map((n) => (n?.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 16)
          .join(" ");

        const combined = `${title} ${metaDesc} ${h}`.replace(/\s+/g, " ").trim();
        return combined.slice(0, TEXT_TOKEN_BUDGET_CHARS);
      } catch {
        return "";
      }
    };

    const parseLinksFromHtml = (html, basePath) => {
      const links = [];
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const anchors = Array.from(doc.querySelectorAll("a[href]")).slice(0, CRAWL_MAX_LINKS_PER_PAGE);

        for (const a of anchors) {
          const rawHref = a.getAttribute("href") || "";
          const internal = hrefToInternalPath(rawHref);
          if (!internal) continue;

          const base = stripHashAndQuery(internal);
          const safe = sanitizeInternalHref(base);
          if (!safe) continue;
          if (!isLikelyHtmlPagePath(safe)) continue;

          const label =
            (a.getAttribute("aria-label") || "").trim() ||
            (a.getAttribute("title") || "").trim() ||
            (a.textContent || "").replace(/\s+/g, " ").trim() ||
            "";

          links.push({ href: safe, label, from: basePath });
        }
      } catch {}
      return links;
    };

    const fetchXmlText = async (path) => {
      return withTimeout(async (signal) => {
        const res = await fetch(path, {
          method: "GET",
          signal,
          headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" },
          cache: "no-store",
        });
        if (!res.ok) return null;
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("xml") && !ct.includes("text/")) return null;
        return (await res.text()) || null;
      }, 1000);
    };

    const parseSitemapLocs = (xmlText) => {
      const urls = [];
      try {
        const doc = new DOMParser().parseFromString(xmlText, "application/xml");
        const parseErrors = doc.getElementsByTagName("parsererror");
        if (parseErrors && parseErrors.length) return urls;

        const urlLocs = Array.from(doc.getElementsByTagName("url"))
          .map((u) => u.getElementsByTagName("loc")?.[0]?.textContent || "")
          .map((s) => String(s || "").trim())
          .filter(Boolean);

        const sitemapLocs = Array.from(doc.getElementsByTagName("sitemap"))
          .map((u) => u.getElementsByTagName("loc")?.[0]?.textContent || "")
          .map((s) => String(s || "").trim())
          .filter(Boolean);

        if (sitemapLocs.length) return { kind: "index", locs: sitemapLocs };
        if (urlLocs.length) return { kind: "urlset", locs: urlLocs };

        const anyLocs = Array.from(doc.getElementsByTagName("loc"))
          .map((n) => (n.textContent || "").trim())
          .filter(Boolean);

        const looksIndex = anyLocs.some((x) => /sitemap/i.test(x));
        return { kind: looksIndex ? "index" : "urlset", locs: anyLocs };
      } catch {
        return { kind: "urlset", locs: [] };
      }
    };

    const crawlSitemapsDeep = async () => {
      const out = [];
      const seenSitemaps = new Set();

      // ✅ Hardened: also try known sitemap endpoints directly (no guessing; you already have these)
      const startCandidates = [
        "/sitemap.xml",
        "/sitemap_index.xml",
        "/server-sitemap.xml",
        "/sitemap-0.xml",
        "/sitemap-products.xml",
        "/sitemap-collections.xml",
        "/sitemap-blog.xml",
      ];

      const enqueueSitemap = (loc) => {
        const internal = hrefToInternalPath(loc);
        if (!internal) return null;
        const safe = sanitizeInternalHref(stripHashAndQuery(internal));
        if (!safe) return null;
        if (!/sitemap/i.test(safe)) return null;
        if (seenSitemaps.has(safe)) return null;
        seenSitemaps.add(safe);
        return safe;
      };

      const sitemapQueue = [];
      for (const c of startCandidates) {
        const next = enqueueSitemap(c);
        if (next) sitemapQueue.push(next);
      }

      while (sitemapQueue.length && out.length < SITEMAP_MAX_URLS) {
        const sm = sitemapQueue.shift();
        if (!sm) break;

        const xmlText = await fetchXmlText(sm).catch(() => null);
        if (!xmlText) continue;

        const parsed = parseSitemapLocs(xmlText);
        const locs = Array.isArray(parsed?.locs) ? parsed.locs : [];

        if (parsed?.kind === "index") {
          for (const loc of locs) {
            const next = enqueueSitemap(loc);
            if (next) sitemapQueue.push(next);
          }
          continue;
        }

        for (const loc of locs) {
          const internal = hrefToInternalPath(loc);
          if (!internal) continue;
          const safe = sanitizeInternalHref(stripHashAndQuery(internal));
          if (!safe) continue;
          if (!isLikelyHtmlPagePath(safe)) continue;
          out.push({ href: safe, label: humanizePath(safe), from: sm });
          if (out.length >= SITEMAP_MAX_URLS) break;
        }
      }

      return out;
    };

    const boot = async () => {
      setIsIndexing(true);
      setIndexReady(false);

      const cached = readIndexCache();
      if (cached && cached.length) {
        const merged = dedupeIndex(cached);
        if (!alive) return;
        setPageIndex(merged);
        setIndexedCount(merged.length);
        setIndexReady(true);
        setIsIndexing(false);
        return;
      }

      const labelMap = new Map();
      const contentMap = new Map();

      const discovered = new Set();
      const visited = new Set();

      for (const p of SAFE_PINNED_PAGES) {
        const href = sanitizeInternalHref(stripHashAndQuery(p.href));
        if (!href) continue;
        discovered.add(href);
        if (!labelMap.has(href)) labelMap.set(href, new Set());
        labelMap.get(href).add(p.label);
        if (!contentMap.has(href)) contentMap.set(href, "");
      }

      const sitemapUrls = await crawlSitemapsDeep().catch(() => []);
      for (const it of sitemapUrls || []) {
        const href = sanitizeInternalHref(stripHashAndQuery(it.href));
        if (!href) continue;
        discovered.add(href);
        if (!labelMap.has(href)) labelMap.set(href, new Set());
        if (it.label) labelMap.get(href).add(it.label);
        if (!contentMap.has(href)) contentMap.set(href, "");
      }

      const queue = [];
      const push = (p) => {
        const s = sanitizeInternalHref(stripHashAndQuery(p));
        if (!s) return;
        if (!isLikelyHtmlPagePath(s)) return;
        if (visited.has(s)) return;
        queue.push(s);
      };

      for (const seed of CRAWL_SEEDS) push(seed);
      for (const it of (sitemapUrls || []).slice(0, Math.min(300, SITEMAP_MAX_URLS))) push(it.href);

      const inFlight = new Set();

      const runOne = async (href) => {
        try {
          const html = await fetchHtml(href);
          if (!html) return;

          const signals = extractSignalsFromHtml(html);
          if (signals) {
            const prev = contentMap.get(href) || "";
            if (!prev || prev.length < signals.length) contentMap.set(href, signals);
          }

          const links = parseLinksFromHtml(html, href);
          for (const l of links) {
            const nextHref = sanitizeInternalHref(stripHashAndQuery(l.href));
            if (!nextHref) continue;
            if (!isLikelyHtmlPagePath(nextHref)) continue;

            discovered.add(nextHref);

            if (!labelMap.has(nextHref)) labelMap.set(nextHref, new Set());
            if (l.label) labelMap.get(nextHref).add(l.label);

            if (!contentMap.has(nextHref)) contentMap.set(nextHref, "");

            if (!visited.has(nextHref) && queue.length < CRAWL_MAX_PAGES * 8) {
              queue.push(nextHref);
            }
          }
        } catch {}
      };

      while (alive && visited.size < CRAWL_MAX_PAGES && queue.length) {
        while (alive && visited.size < CRAWL_MAX_PAGES && queue.length && inFlight.size < CRAWL_CONCURRENCY) {
          const href = queue.shift();
          if (!href) break;
          if (visited.has(href)) continue;

          visited.add(href);
          const p = runOne(href).finally(() => inFlight.delete(p));
          inFlight.add(p);
        }

        await Promise.race([Promise.allSettled(Array.from(inFlight)), yieldToMain()]).catch(() => {});
      }

      await Promise.allSettled(Array.from(inFlight)).catch(() => {});

      const crawledPages = [];
      for (const href of discovered) {
        const labels = labelMap.get(href) || new Set();
        const label = pickBestLabel(labels, href);

        const isPinned = href === "/" || href === "/product";
        const content = contentMap.get(href) || "";

        crawledPages.push({
          type: "page",
          href,
          label,
          source: isPinned ? "pinned" : "crawl",
          _content: content,
        });
      }

      const merged = dedupeIndex(crawledPages);

      if (!alive) return;

      setPageIndex(merged);
      setIndexedCount(merged.length);
      setIndexReady(true);
      setIsIndexing(false);

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
    }, 40);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  const showPanel = focused && interacted;

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

      if (!query) {
        const top = pageIndex
          .slice()
          .sort((a, b) => {
            const ap = a.source === "pinned" ? 1 : 0;
            const bp = b.source === "pinned" ? 1 : 0;
            if (ap !== bp) return bp - ap;
            return (a.label || "").localeCompare(b.label || "");
          })
          .slice(0, 12);

        const merged = dedupeIndex(top);
        setSuggestions(merged);
        setActiveIdx(merged.length ? 0 : -1);
        return;
      }

      const qNorm = norm(query);
      const qTokens = new Set(tokenize(qNorm));

      const scored = [];
      for (const it of pageIndex) {
        const s = scoreItem(it, qNorm, qTokens, pop);
        if (s > 0) scored.push({ it, s });
      }
      scored.sort((a, b) => b.s - a.s);

      const pages = scored.slice(0, 12).map((x) => x.it);

      if (!pages.length) {
        const info = {
          type: "info",
          label: `No verified page link found for “${query}” in the site’s discovered pages. Use “All Products” and filters/search inside that page. We will not guess a destination.`,
        };
        const safe = dedupeIndex([info, ...SAFE_PINNED_PAGES]);
        setSuggestions(safe);
        setActiveIdx(-1);
        return;
      }

      const merged = dedupeIndex(pages);
      setSuggestions(merged);
      setActiveIdx(merged.length ? 0 : -1);
    }, RANK_DEBOUNCE_MS);

    return () => {
      if (rankTimerRef.current) clearTimeout(rankTimerRef.current);
    };
  }, [q, showPanel, pageIndex]);

  const onPickSuggestion = useCallback(
    (item) => {
      if (!item) return;
      if (item.type === "info") return;

      if (item.type === "page") {
        setQ(item.label || "");
        try {
          if (item.href) bumpPopularity(`href:${item.href}`);
          if (item.label) bumpPopularity(`l:${norm(item.label)}`);
          popRef.current = readPopularity();
        } catch {}
        if (item.href) return gotoPage(item.href, item.label);
      }
    },
    [gotoPage]
  );

  const armInteraction = () => {
    lastArmAtRef.current = Date.now();
    if (!interacted) setInteracted(true);
  };

  const canOpenFromFocus = () => {
    const now = Date.now();
    return now - (lastArmAtRef.current || 0) <= FOCUS_ARM_WINDOW_MS;
  };

  const containerStyle = useMemo(
    () => ({
      display: "flex",
      alignItems: "center",
      background: "#F8F6EE",
      border: "1px solid #ECE9DB",
      margin: 0,
      padding: "2px 10px 2px 10px",
      position: "relative",
      maxWidth: 320,
      minWidth: 128,
      width: "clamp(140px, 24vw, 260px)",
      borderRadius: 9999,
      boxShadow: focused ? "0 8px 20px rgba(12,35,64,.06)" : "0 2px 6px rgba(12,35,64,.04)",
      transition: "box-shadow .15s ease, background .2s ease",
    }),
    [focused]
  );

  return (
    <div
      suppressHydrationWarning
      className={`${className}`}
      ref={wrapperRef}
      onPointerDown={armInteraction}
      onKeyDown={armInteraction}
    >
      <form
        role="search"
        aria-label="Page finder"
        onSubmit={(e) => {
          e.preventDefault();
          const item = activeIdx >= 0 ? suggestions[activeIdx] : null;
          if (item && item.type === "page" && item.href) onPickSuggestion(item);
          else {
            setFocused(true);
            if (!interacted) setInteracted(true);
          }
        }}
        className="tdls-search-form"
        style={{ position: "relative" }}
      >
        <div className="tdls-searchwrap" style={containerStyle}>
          <button
            type="submit"
            aria-label="Go"
            className="tdls-search-ico"
            title="Go"
            onMouseDown={() => {
              lastArmAtRef.current = Date.now();
              if (!interacted) setInteracted(true);
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#0c2340" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20L17 17" />
            </svg>
          </button>

          <input
            ref={inputRef}
            className="tdls-search-input"
            aria-label="Find pages"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => {
              setFocused(true);
              if (!canOpenFromFocus()) return;
              if (!interacted) setInteracted(true);
            }}
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
                const item = activeIdx >= 0 ? suggestions[activeIdx] : null;
                if (item && item.type === "page" && item.href) {
                  e.preventDefault();
                  onPickSuggestion(item);
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
              aria-label="Crawling website"
              title="Crawling website"
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
        aria-label="Discovered pages"
        aria-hidden={!showPanel}
        style={{ display: showPanel ? "block" : "none" }}
      >
        <div className="tdls-hints-head">
          <div className="tdls-hints-title">{q.trim() ? "Verified pages" : "Pages"}</div>
          <div className="tdls-hints-meta">
            {indexReady && !isIndexing ? `Ready · ${indexedCount || pageIndex.length} indexed` : "Crawling…"}
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
                  {item.label}
                </span>
                <span className="tdls-hint-sub">{isPinned ? "Safe" : "Verified"}</span>
              </div>
            );
          })
        ) : (
          <div className="tdls-empty">No verified pages discovered yet.</div>
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
          margin-top: 6px;
          padding: 8px;
          background: #ffffff;
          border: 1px solid #ece9db;
          border-radius: 10px;
          box-shadow: 0 10px 24px rgba(12, 35, 64, 0.08);
          width: max(240px, min(66vw, 340px));
          max-width: 92vw;
          display: none;
          z-index: 9998;
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
      `}</style>
    </div>
  );
}
