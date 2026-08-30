// ✅ FILE: app/api/menu-index/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

/**
 * TDLS Menu Index API
 * -----------------------------------------------------------------------------
 * Purpose:
 *   Build the ONLY correct menu structure for SlidingMenuBar:
 *     Tier → Audience → Category → Products
 *
 * Root-cause this fixes:
 *   Your current menu logic is trying to infer “audiences in a tier” from
 *   /audience-categories relations that DO NOT actually carry tier membership.
 *   So when you filter by tier, everything becomes empty.
 *
 * Correct approach:
 *   Derive membership from PRODUCTS because products are the only reliable join:
 *     product ↔ tier(s) ↔ audience(s) ↔ category(s)
 *
 * Output:
 *   {
 *     ok: true,
 *     schema: 1,
 *     defaultTierKind: "collection_tiers" | "tiers" | "brand_tiers",
 *     kinds: {
 *       collection_tiers: { tiers:[...], tree:{...} },
 *       tiers: { ... },
 *       brand_tiers: { ... }
 *     },
 *     generatedAt: ISOString,
 *     counts: {...}
 *   }
 *
 * Notes:
 *   - NO placeholders invented.
 *   - If a product is missing tier/audience/category, it is NOT forced into a fake bucket.
 *   - Client chooses which tierKind to use (or use defaultTierKind).
 */

/* ────────────────────────────────────────────────────────────────────────── */
/* Cache (in-memory per runtime instance)                                      */
/* ────────────────────────────────────────────────────────────────────────── */

const G = globalThis;

const MEM = G.__TDLS_MENU_INDEX_MEM__ ?? (G.__TDLS_MENU_INDEX_MEM__ = new Map());
const INFLIGHT = G.__TDLS_MENU_INDEX_INFLIGHT__ ?? (G.__TDLS_MENU_INDEX_INFLIGHT__ = new Map());

const MEM_TTL_MS = (() => {
  const n = Number(process.env.TDLS_MENU_INDEX_TTL_MS ?? 60_000);
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  return Math.min(10 * 60_000, Math.max(5_000, Math.round(n)));
})();

function memGet(key) {
  const v = MEM.get(key);
  if (!v) return null;
  if (v.exp <= Date.now()) {
    MEM.delete(key);
    return null;
  }
  return v.value;
}
function memSet(key, value, ttlMs = MEM_TTL_MS) {
  MEM.set(key, { exp: Date.now() + ttlMs, value });
}

async function runDedupe(key, fn) {
  const existing = INFLIGHT.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      INFLIGHT.delete(key);
    }
  })();
  INFLIGHT.set(key, p);
  return p;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Response helpers                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

const CACHE_CONTROL =
  "public, max-age=20, s-maxage=180, stale-while-revalidate=3600, stale-if-error=86400";

function json(status, obj, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(obj ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": CACHE_CONTROL,
      "CDN-Cache-Control": CACHE_CONTROL,
      "Vercel-CDN-Cache-Control": CACHE_CONTROL,
      Vary: "Accept-Encoding",
      ...extraHeaders,
    },
  });
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cleanStr(v) {
  return String(v ?? "").trim();
}

function cleanSlug(v) {
  return cleanStr(v).toLowerCase();
}

function pickOrder(attrs) {
  // Your Strapi uses both `order` and `priority` in different types.
  const n =
    toNum(attrs?.order) ??
    toNum(attrs?.priority) ??
    toNum(attrs?.sort_order) ??
    toNum(attrs?.position) ??
    toNum(attrs?.rank) ??
    null;
  return Number.isFinite(n) ? n : 9999;
}

function asArrayRel(rel) {
  const data = rel?.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "object") return [data];
  return [];
}

function normalizeTaxItem(row) {
  const attrs = row?.attributes ?? row ?? {};
  const slug = cleanSlug(attrs?.slug);
  if (!slug) return null;
  return {
    id: row?.id ?? attrs?.id ?? null,
    slug,
    name: cleanStr(attrs?.name || slug),
    order: pickOrder(attrs),
  };
}

function extractRelItems(entityAttrs, relKey) {
  const rel = entityAttrs?.[relKey];
  const rows = asArrayRel(rel);
  const out = [];
  for (const r of rows) {
    const it = normalizeTaxItem(r);
    if (it) out.push(it);
  }
  return out;
}

function normalizeProduct(row) {
  const attrs = row?.attributes ?? row ?? {};
  const slug = cleanSlug(attrs?.slug);
  if (!slug) return null;

  // minimal visibility gating (NO guessing)
  const disableFrontend = Boolean(attrs?.disable_frontend);
  const isArchived = Boolean(attrs?.is_archived);
  const status = cleanStr(attrs?.status);

  if (disableFrontend) return null;
  if (isArchived) return null;
  if (status && status.toLowerCase() !== "active") return null;

  return {
    id: row?.id ?? null,
    slug,
    name: cleanStr(attrs?.name || slug),
    attrs,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Upstream fetch via internal Strapi proxy (/api/strapi)                       */
/* ────────────────────────────────────────────────────────────────────────── */

async function fetchViaProxy(req, strapiPath) {
  const base = new URL(req.url);
  const u = new URL("/api/strapi", base.origin);
  u.searchParams.set("path", strapiPath);
  // Keep menu-index stable and fresh; proxy already has its own resilience.
  u.searchParams.set("noCache", "1");

  const res = await fetch(u.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
  const parsed = safeJsonParse(text);

  if (!res.ok) {
    return { ok: false, status: res.status, text, parsed: parsed ?? null };
  }
  if (!parsed?.ok || !parsed?.data) {
    return { ok: false, status: 502, text, parsed: parsed ?? null };
  }

  return { ok: true, status: 200, parsed };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Index builder                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

function makeKindBucket() {
  return {
    // slug -> {slug,name,order}
    tierMap: new Map(),
    // nested Map tier -> aud -> cat -> { products: [], seen:Set }
    tree: new Map(),
    // counts
    counts: {
      tiers: 0,
      audiences: 0,
      categories: 0,
      productLinks: 0, // number of inserted product refs into leaves
      productsUsed: 0,
      productsSkippedMissingTier: 0,
      productsSkippedMissingAudience: 0,
      productsSkippedMissingCategory: 0,
    },
    // global sets (for counts only)
    _audSet: new Set(),
    _catSet: new Set(),
  };
}

function ensureLeaf(kind, tierSlug, audSlug, catSlug) {
  let t = kind.tree.get(tierSlug);
  if (!t) {
    t = new Map();
    kind.tree.set(tierSlug, t);
  }
  let a = t.get(audSlug);
  if (!a) {
    a = new Map();
    t.set(audSlug, a);
  }
  let c = a.get(catSlug);
  if (!c) {
    c = { products: [], seen: new Set() };
    a.set(catSlug, c);
  }
  return c;
}

function sortByOrderThenName(a, b) {
  const ao = toNum(a?.order, 9999);
  const bo = toNum(b?.order, 9999);
  if (ao !== bo) return ao - bo;
  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

function buildPlainTree(kindBucket, taxMaps) {
  // taxMaps: { tiersBySlug, audiencesBySlug, categoriesBySlug }
  const tiersSorted = Array.from(kindBucket.tierMap.values()).sort(sortByOrderThenName);

  const treeOut = {}; // tierSlug -> { audiences:[...], categoriesByAudience:{...}, products:{...} }
  for (const tier of tiersSorted) {
    const tierSlug = tier.slug;
    const tMap = kindBucket.tree.get(tierSlug);
    if (!tMap) continue;

    const audSlugs = Array.from(tMap.keys());
    const audObjs = audSlugs
      .map((s) => taxMaps.audiencesBySlug.get(s))
      .filter(Boolean)
      .sort(sortByOrderThenName);

    const categoriesByAudience = {};
    const productsByAudienceCategory = {};

    for (const aud of audObjs) {
      const aMap = tMap.get(aud.slug);
      if (!aMap) continue;

      const catSlugs = Array.from(aMap.keys());
      const catObjs = catSlugs
        .map((s) => taxMaps.categoriesBySlug.get(s))
        .filter(Boolean)
        .sort(sortByOrderThenName);

      categoriesByAudience[aud.slug] = catObjs.map((c) => ({
        slug: c.slug,
        name: c.name,
        order: c.order,
      }));

      const prodMapByCat = {};
      for (const cat of catObjs) {
        const leaf = aMap.get(cat.slug);
        if (!leaf) continue;
        const prods = leaf.products
          .slice()
          .sort((p1, p2) => String(p1.name).localeCompare(String(p2.name)));

        // strip internal set
        prodMapByCat[cat.slug] = prods.map((p) => ({ slug: p.slug, name: p.name, id: p.id ?? null }));
      }
      productsByAudienceCategory[aud.slug] = prodMapByCat;
    }

    treeOut[tierSlug] = {
      tier: { slug: tier.slug, name: tier.name, order: tier.order },
      audiences: audObjs.map((a) => ({ slug: a.slug, name: a.name, order: a.order })),
      categoriesByAudience,
      productsByAudienceCategory,
    };
  }

  return { tiers: tiersSorted.map((t) => ({ slug: t.slug, name: t.name, order: t.order })), tree: treeOut };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* GET                                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

export async function GET(req) {
  const t0 = Date.now();
  const url = new URL(req.url);

  const refresh = url.searchParams.get("refresh") === "1";
  const debug = url.searchParams.get("debug") === "1";

  // optionally force which tier kind the client wants as default
  const forcedTierKind = cleanSlug(url.searchParams.get("tierKind") || "");

  const pageSize = (() => {
    const n = Number(url.searchParams.get("pageSize") ?? process.env.TDLS_MENU_INDEX_PRODUCTS_PAGESIZE ?? 1500);
    if (!Number.isFinite(n) || n <= 0) return 1500;
    return Math.min(2000, Math.max(50, Math.round(n)));
  })();

  const cacheKey = `menu-index|v1|ps=${pageSize}`;
  if (!refresh) {
    const hit = memGet(cacheKey);
    if (hit) {
      const ms = Date.now() - t0;
      return json(200, { ...hit, ms, cache: "mem" }, { "x-tdls-menu-ms": String(ms), "x-tdls-menu-cache": "1" });
    }
  }

  const result = await runDedupe(cacheKey, async () => {
    // 1) Fetch products list (NO populate specified; /api/strapi will enforce cardlite taxonomy)
    const productsPath =
      `/products?pagination[pageSize]=${encodeURIComponent(String(pageSize))}` +
      `&fields[0]=slug&fields[1]=name&fields[2]=disable_frontend&fields[3]=is_archived&fields[4]=status`;

    const r = await fetchViaProxy(req, productsPath);
    if (!r.ok) {
      return {
        ok: false,
        status: r.status ?? 502,
        error: "UPSTREAM_PRODUCTS_FAILED",
        details: r.parsed ?? r.text ?? null,
      };
    }

    const strapi = r.parsed.data; // {data, meta}
    const rows = Array.isArray(strapi?.data) ? strapi.data : [];

    // 2) Build index from products
    const kinds = {
      collection_tiers: makeKindBucket(),
      tiers: makeKindBucket(),
      brand_tiers: makeKindBucket(),
    };

    // global tax maps (audiences/categories shared regardless of tierKind)
    const audiencesBySlug = new Map();
    const categoriesBySlug = new Map();

    const productsTotal = rows.length;
    let productsUsedAny = 0;

    for (const row of rows) {
      const p = normalizeProduct(row);
      if (!p) continue;

      const a = p.attrs;

      // Audience = product.audience_categories (Strapi relation)
      const audiences = extractRelItems(a, "audience_categories");
      for (const au of audiences) audiencesBySlug.set(au.slug, au);

      // Category = prefer categories; fallback to sub_categories; fallback to super_categories
      let cats = extractRelItems(a, "categories");
      if (cats.length === 0) cats = extractRelItems(a, "sub_categories");
      if (cats.length === 0) cats = extractRelItems(a, "super_categories");
      for (const c of cats) categoriesBySlug.set(c.slug, c);

      // Tier kinds
      const tiers_collection = extractRelItems(a, "collection_tiers");
      const tiers_main = extractRelItems(a, "tiers");
      const tiers_brand = extractRelItems(a, "brand_tiers");

      // Helper to insert into a given kind
      const insert = (kindKey, tierList) => {
        const K = kinds[kindKey];
        if (!K) return;

        if (!tierList || tierList.length === 0) {
          K.counts.productsSkippedMissingTier++;
          return;
        }
        if (!audiences || audiences.length === 0) {
          K.counts.productsSkippedMissingAudience++;
          return;
        }
        if (!cats || cats.length === 0) {
          K.counts.productsSkippedMissingCategory++;
          return;
        }

        // product contributes
        K.counts.productsUsed++;

        for (const t of tierList) {
          K.tierMap.set(t.slug, t);

          for (const au of audiences) {
            K._audSet.add(au.slug);

            for (const c of cats) {
              K._catSet.add(c.slug);

              const leaf = ensureLeaf(K, t.slug, au.slug, c.slug);
              if (leaf.seen.has(p.slug)) continue;

              leaf.seen.add(p.slug);
              leaf.products.push({ id: p.id ?? null, slug: p.slug, name: p.name });

              K.counts.productLinks++;
              productsUsedAny++;
            }
          }
        }
      };

      insert("collection_tiers", tiers_collection);
      insert("tiers", tiers_main);
      insert("brand_tiers", tiers_brand);
    }

    // finalize counts
    for (const k of Object.keys(kinds)) {
      kinds[k].counts.tiers = kinds[k].tierMap.size;
      kinds[k].counts.audiences = kinds[k]._audSet.size;
      kinds[k].counts.categories = kinds[k]._catSet.size;
      delete kinds[k]._audSet;
      delete kinds[k]._catSet;
    }

    // choose default tier kind
    const pickDefault = () => {
      const order = ["collection_tiers", "tiers", "brand_tiers"];
      if (forcedTierKind && kinds[forcedTierKind]?.counts?.tiers > 0) return forcedTierKind;
      for (const k of order) {
        if (kinds[k]?.counts?.tiers > 0) return k;
      }
      // If none have tiers, still return "tiers" as stable default
      return "tiers";
    };

    const defaultTierKind = pickDefault();

    // build plain JSON for each kind
    const taxMaps = {
      audiencesBySlug,
      categoriesBySlug,
    };

    const plainKinds = {};
    for (const k of Object.keys(kinds)) {
      plainKinds[k] = buildPlainTree(kinds[k], taxMaps);
    }

    // payload
    const payload = {
      ok: true,
      schema: 1,
      defaultTierKind,
      kinds: plainKinds,
      generatedAt: new Date().toISOString(),
      counts: {
        productsTotal,
        productsUsedAny, // number of leaf insertions attempted (after gating)
        uniqueAudiences: audiencesBySlug.size,
        uniqueCategories: categoriesBySlug.size,
      },
    };

    if (debug) {
      payload.debug = {
        pageSize,
        forcedTierKind: forcedTierKind || null,
        msBuild: Date.now() - t0,
      };
    }

    return payload;
  });

  if (!result?.ok) {
    const ms = Date.now() - t0;
    return json(
      502,
      {
        ok: false,
        error: result?.error || "MENU_INDEX_FAILED",
        status: result?.status || 502,
        details: result?.details ?? null,
        ms,
      },
      { "x-tdls-menu-ms": String(ms), "x-tdls-menu-cache": "0" }
    );
  }

  // store cache
  memSet(cacheKey, result);

  const ms = Date.now() - t0;
  return json(
    200,
    { ...result, ms, cache: "miss" },
    { "x-tdls-menu-ms": String(ms), "x-tdls-menu-cache": "0" }
  );
}