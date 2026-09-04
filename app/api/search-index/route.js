// FILE: app/api/search-index/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

/**
 * TDLS Search Index API
 * -----------------------------------------------------------------------------
 * SEARCH-ONLY endpoint.
 *
 * It does not change menu, collection, product, Strapi-proxy, or sitemap behavior.
 * It builds a complete searchable index from:
 *   1) every visible product (all Strapi pagination pages),
 *   2) real taxonomy relations attached to those products,
 *   3) verified public URLs already exposed by this site's public sitemaps.
 *
 * Navigation is never invented:
 *   - Product -> /product/{real product slug}
 *   - Audience -> /collections?audience={real audience slug}
 *   - Category -> /collections?audience={real audience}&category={real category}
 *   - Tier/collection -> /collections?tier={real tier slug}
 *   - Public page -> exact URL discovered from a real public sitemap
 */

const G = globalThis;

const MEM =
  G.__TDLS_SEARCH_INDEX_MEM__ ??
  (G.__TDLS_SEARCH_INDEX_MEM__ = new Map());

const INFLIGHT =
  G.__TDLS_SEARCH_INDEX_INFLIGHT__ ??
  (G.__TDLS_SEARCH_INDEX_INFLIGHT__ = new Map());

const LAST_GOOD =
  G.__TDLS_SEARCH_INDEX_LAST_GOOD__ ??
  (G.__TDLS_SEARCH_INDEX_LAST_GOOD__ = new Map());

const MEM_TTL_MS = 2 * 60 * 1000;
const LAST_GOOD_TTL_MS = 30 * 60 * 1000;

const PRODUCT_PAGE_SIZE = 500;
const PRODUCT_FETCH_CONCURRENCY = 4;

const FETCH_TIMEOUT_MS = 18000;
const SITEMAP_TIMEOUT_MS = 9000;

const SITEMAP_MAX_FILES = 128;
const SITEMAP_MAX_URLS = 75000;

const CACHE_CONTROL =
  "public, max-age=30, s-maxage=180, stale-while-revalidate=1800, stale-if-error=86400";

/* -------------------------------------------------------------------------- */
/* Response/cache helpers                                                     */
/* -------------------------------------------------------------------------- */

function json(status, body, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(body ?? null), {
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

function memGet(key) {
  const hit = MEM.get(key);

  if (!hit) return null;

  if (hit.exp <= Date.now()) {
    MEM.delete(key);
    return null;
  }

  return hit.value;
}

function memSet(key, value) {
  MEM.set(key, {
    exp: Date.now() + MEM_TTL_MS,
    value,
  });
}

function lastGoodGet(key) {
  const hit = LAST_GOOD.get(key);

  if (!hit) return null;

  if (hit.exp <= Date.now()) {
    LAST_GOOD.delete(key);
    return null;
  }

  return hit.value;
}

function lastGoodSet(key, value) {
  LAST_GOOD.set(key, {
    exp: Date.now() + LAST_GOOD_TTL_MS,
    value,
  });
}

async function runDedupe(key, fn) {
  const existing = INFLIGHT.get(key);

  if (existing) return existing;

  const promise = (async () => {
    try {
      return await fn();
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, promise);

  return promise;
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function cleanStr(v) {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSlug(v) {
  return cleanStr(v)
    .toLowerCase()
    .replace(/[?#].*$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleizeSlug(v) {
  const s = cleanStr(v);

  if (!s) return "";

  return s
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeEntity(row) {
  if (!row || typeof row !== "object") return null;

  if (row.attributes && typeof row.attributes === "object") {
    return {
      id: row.id ?? row.attributes.id ?? null,
      ...row.attributes,
    };
  }

  return row;
}

/* -------------------------------------------------------------------------- */
/* Relation helpers                                                           */
/* -------------------------------------------------------------------------- */

function relationRows(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.data)) {
    return value.data;
  }

  if (value?.data && typeof value.data === "object") {
    return [value.data];
  }

  return [];
}

function normalizeTaxRow(row) {
  const entity = normalizeEntity(row);

  if (!entity) return null;

  const slug = cleanSlug(entity.slug || "");

  if (!slug) return null;

  return {
    id: entity.id ?? null,
    slug,
    name:
      cleanStr(entity.name || entity.title || "") ||
      titleizeSlug(slug),
  };
}

function getTax(entity, key) {
  const out = [];
  const seen = new Set();

  for (const row of relationRows(entity?.[key])) {
    const item = normalizeTaxRow(row);

    if (!item) continue;
    if (seen.has(item.slug)) continue;

    seen.add(item.slug);
    out.push(item);
  }

  /**
   * Compatibility with optimized/flattened proxy shapes.
   *
   * Example:
   *   categories_slugs: ["t-shirt", "polo"]
   */
  const flat = entity?.[`${key}_slugs`];

  if (Array.isArray(flat)) {
    for (const raw of flat) {
      const slug = cleanSlug(
        typeof raw === "string"
          ? raw
          : raw?.slug || raw?.name || ""
      );

      if (!slug) continue;
      if (seen.has(slug)) continue;

      seen.add(slug);

      out.push({
        slug,
        name: titleizeSlug(slug),
        id: null,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Product visibility                                                         */
/* -------------------------------------------------------------------------- */

function productVisible(entity) {
  if (!entity) return false;

  const slug = cleanSlug(entity.slug || "");

  if (!slug) return false;

  if (entity.disable_frontend === true) {
    return false;
  }

  if (entity.is_archived === true) {
    return false;
  }

  const status = cleanStr(entity.status).toLowerCase();

  if (status && status !== "active") {
    return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Public URL helpers                                                         */
/* -------------------------------------------------------------------------- */

function canonicalPathFromUrl(value, origin) {
  try {
    /**
     * Sitemap files are trusted public indexes from this application.
     *
     * We deliberately use only pathname here so a harmless:
     *
     *   www.thednalabstore.com
     *
     * vs:
     *
     *   thednalabstore.com
     *
     * canonical-host difference does not make valid pages disappear
     * from search.
     */
    const u = new URL(String(value || ""), origin);

    let path = u.pathname || "/";

    path = path.replace(/\/{2,}/g, "/");

    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }

    return path || "/";
  } catch {
    return "";
  }
}

function isAssetLike(path) {
  return /\.(?:png|jpe?g|webp|gif|svg|ico|css|js|mjs|map|json|xml|txt|pdf|zip|mp4|mov|woff2?|ttf)$/i.test(
    path
  );
}

function isPublicSearchPath(path) {
  const p = String(path || "");

  if (!p) return false;
  if (!p.startsWith("/")) return false;
  if (isAssetLike(p)) return false;
  if (p.startsWith("/_next/")) return false;

  const denied = [
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
    "/wishlist",
    "/payment",
    "/forgot-password",
    "/signout",
    "/thank-you",
    "/search",
  ];

  return !denied.some(
    (prefix) =>
      p === prefix ||
      p.startsWith(`${prefix}/`)
  );
}

function labelFromPath(path) {
  if (path === "/") {
    return "Home";
  }

  if (path === "/product") {
    return "All Products";
  }

  if (path === "/collections") {
    return "Collections";
  }

  const parts = String(path || "")
    .split("/")
    .filter(Boolean);

  if (!parts.length) {
    return "Home";
  }

  let useful = parts;

  if (
    ["product", "collections", "blog", "lookbook"].includes(
      parts[0]
    ) &&
    parts.length > 1
  ) {
    useful = parts.slice(1);
  }

  return (
    titleizeSlug(useful.join(" ")) ||
    titleizeSlug(parts.join(" ")) ||
    path
  );
}

/* -------------------------------------------------------------------------- */
/* Timeout fetch                                                              */
/* -------------------------------------------------------------------------- */

function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    ms
  );

  return promiseFactory(controller.signal).finally(() =>
    clearTimeout(timer)
  );
}

/* -------------------------------------------------------------------------- */
/* Strapi proxy                                                               */
/* -------------------------------------------------------------------------- */

async function fetchProxy(req, strapiPath) {
  const origin = new URL(req.url).origin;

  const url = new URL(
    "/api/strapi",
    origin
  );

  url.searchParams.set(
    "path",
    strapiPath
  );

  return withTimeout(async (signal) => {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal,
    });

    const text = await response
      .text()
      .catch(() => "");

    const parsed = safeJsonParse(text);

    if (
      !response.ok ||
      !parsed?.ok ||
      !parsed?.data
    ) {
      throw new Error(
        `SEARCH_STRAPI_${response.status || 502}`
      );
    }

    return parsed.data;
  }, FETCH_TIMEOUT_MS);
}

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

function productsPath(page) {
  const params = new URLSearchParams();

  params.set(
    "pagination[page]",
    String(page)
  );

  params.set(
    "pagination[pageSize]",
    String(PRODUCT_PAGE_SIZE)
  );

  params.set(
    "pagination[withCount]",
    "true"
  );

  params.set(
    "fields[0]",
    "slug"
  );

  params.set(
    "fields[1]",
    "name"
  );

  params.set(
    "fields[2]",
    "short_description"
  );

  params.set(
    "fields[3]",
    "disable_frontend"
  );

  params.set(
    "fields[4]",
    "is_archived"
  );

  params.set(
    "fields[5]",
    "status"
  );

  params.set(
    "sort[0]",
    "name:asc"
  );

  /**
   * IMPORTANT:
   *
   * No populate is sent intentionally.
   *
   * Your existing /api/strapi product-list profile already adds
   * its normal lightweight taxonomy population. Therefore this
   * new search route does not alter or duplicate your proxy logic.
   */
  return `/products?${params.toString()}`;
}

async function fetchAllProducts(req) {
  const first = await fetchProxy(
    req,
    productsPath(1)
  );

  const firstRows = Array.isArray(first?.data)
    ? first.data
    : [];

  const pagination =
    first?.meta?.pagination || {};

  const pageCount = Math.max(
    1,
    Number(pagination.pageCount || 1)
  );

  if (pageCount === 1) {
    return firstRows;
  }

  const pages = [];

  for (
    let page = 2;
    page <= pageCount;
    page += 1
  ) {
    pages.push(page);
  }

  const all = [...firstRows];

  let cursor = 0;

  const workerCount = Math.min(
    PRODUCT_FETCH_CONCURRENCY,
    pages.length
  );

  const workers = Array.from(
    { length: workerCount },
    async () => {
      while (true) {
        const index = cursor++;

        if (index >= pages.length) {
          return;
        }

        const page = pages[index];

        const payload =
          await fetchProxy(
            req,
            productsPath(page)
          );

        if (Array.isArray(payload?.data)) {
          all.push(...payload.data);
        }
      }
    }
  );

  await Promise.all(workers);

  return all;
}

/* -------------------------------------------------------------------------- */
/* Sitemap discovery                                                          */
/* -------------------------------------------------------------------------- */

function parseSitemapXml(xml) {
  const text = String(xml || "");

  if (!text) {
    return {
      kind: "bad",
      locs: [],
    };
  }

  const kind =
    /<\s*sitemapindex\b/i.test(text)
      ? "index"
      : "urlset";

  const locs = [];

  const regex =
    /<\s*loc\s*>\s*([^<]+?)\s*<\s*\/\s*loc\s*>/gi;

  let match;

  while ((match = regex.exec(text))) {
    const loc = cleanStr(match[1]);

    if (loc) {
      locs.push(loc);
    }
  }

  return {
    kind,
    locs,
  };
}

async function fetchSitemapText(url) {
  return withTimeout(async (signal) => {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept:
          "application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      return "";
    }

    return response
      .text()
      .catch(() => "");
  }, SITEMAP_TIMEOUT_MS).catch(
    () => ""
  );
}

async function discoverPublicPaths(req) {
  const origin =
    new URL(req.url).origin;

  const queue = [
    new URL(
      "/sitemap.xml",
      origin
    ).toString(),
  ];

  const queued = new Set(queue);
  const visited = new Set();

  /**
   * These are already proven public routes in your app.
   */
  const paths = new Set([
    "/",
    "/product",
    "/collections",
  ]);

  let cursor = 0;

  while (
    cursor < queue.length &&
    visited.size < SITEMAP_MAX_FILES &&
    paths.size < SITEMAP_MAX_URLS
  ) {
    const sitemapUrl =
      queue[cursor++];

    if (visited.has(sitemapUrl)) {
      continue;
    }

    visited.add(sitemapUrl);

    const xml =
      await fetchSitemapText(
        sitemapUrl
      );

    if (!xml) {
      continue;
    }

    const parsed =
      parseSitemapXml(xml);

    for (const loc of parsed.locs) {
      if (parsed.kind === "index") {
        try {
          const nested = new URL(
            loc,
            origin
          );

          if (
            !/sitemap/i.test(
              nested.pathname
            )
          ) {
            continue;
          }

          /**
           * Products are already indexed directly from structured
           * Strapi data.
           *
           * Do not invoke sitemap-products.xml because that route
           * would perform another complete catalog fetch.
           */
          if (
            nested.pathname ===
            "/sitemap-products.xml"
          ) {
            continue;
          }

          const href = new URL(
            `${nested.pathname}${
              nested.search || ""
            }`,
            origin
          ).toString();

          if (
            !queued.has(href) &&
            queued.size <
              SITEMAP_MAX_FILES
          ) {
            queued.add(href);
            queue.push(href);
          }
        } catch {}

        continue;
      }

      const path =
        canonicalPathFromUrl(
          loc,
          origin
        );

      if (
        path &&
        isPublicSearchPath(path)
      ) {
        paths.add(path);
      }

      if (
        paths.size >=
        SITEMAP_MAX_URLS
      ) {
        break;
      }
    }
  }

  return paths;
}

/* -------------------------------------------------------------------------- */
/* Index builders                                                             */
/* -------------------------------------------------------------------------- */

function addItem(map, item) {
  if (!item?.key) return;
  if (!item?.label) return;
  if (!item?.href) return;

  if (map.has(item.key)) {
    return;
  }

  map.set(
    item.key,
    item
  );
}

function addKeyword(list, value) {
  const s = cleanStr(value);

  if (s) {
    list.push(s);
  }
}

function buildIndexFromProducts(rows) {
  const items = new Map();

  const productHrefs =
    new Set();

  const audienceSeen =
    new Set();

  const tierSeen =
    new Set();

  const categoryContextSeen =
    new Set();

  for (const raw of rows) {
    const product =
      normalizeEntity(raw);

    if (!productVisible(product)) {
      continue;
    }

    const slug =
      cleanSlug(product.slug);

    const name =
      cleanStr(product.name) ||
      titleizeSlug(slug);

    /**
     * These keys are already part of your existing product taxonomy
     * architecture / proxy profiles.
     */
    const audiences = getTax(
      product,
      "audience_categories"
    );

    const categories = getTax(
      product,
      "categories"
    );

    const subCategories = getTax(
      product,
      "sub_categories"
    );

    const superCategories = getTax(
      product,
      "super_categories"
    );

    const tiers = [
      ...getTax(
        product,
        "collection_tiers"
      ),
      ...getTax(
        product,
        "tiers"
      ),
      ...getTax(
        product,
        "brand_tiers"
      ),
      ...getTax(
        product,
        "events_products_collections"
      ),
      ...getTax(
        product,
        "product_collections"
      ),
    ];

    /* ---------------------------------------------------------------------- */
    /* Product                                                               */
    /* ---------------------------------------------------------------------- */

    const productKeywords = [];

    addKeyword(
      productKeywords,
      slug
    );

    addKeyword(
      productKeywords,
      product.short_description
    );

    for (const group of [
      audiences,
      categories,
      subCategories,
      superCategories,
      tiers,
    ]) {
      for (const relation of group) {
        addKeyword(
          productKeywords,
          relation.name
        );

        addKeyword(
          productKeywords,
          relation.slug
        );
      }
    }

    const contextBits = [];

    if (audiences[0]?.name) {
      contextBits.push(
        audiences[0].name
      );
    }

    if (categories[0]?.name) {
      contextBits.push(
        categories[0].name
      );
    }

    const productHref =
      `/product/${encodeURIComponent(
        slug
      )}`;

    productHrefs.add(
      productHref
    );

    addItem(items, {
      key: `product:${slug}`,
      type: "product",
      label: name,
      href: productHref,
      meta: contextBits.length
        ? `Product · ${contextBits.join(
            " · "
          )}`
        : "Product",
      keywords: Array.from(
        new Set(
          productKeywords
        )
      ),
    });

    /* ---------------------------------------------------------------------- */
    /* Audience                                                              */
    /* ---------------------------------------------------------------------- */

    for (const audience of audiences) {
      if (
        audienceSeen.has(
          audience.slug
        )
      ) {
        continue;
      }

      audienceSeen.add(
        audience.slug
      );

      addItem(items, {
        key: `audience:${audience.slug}`,
        type: "audience",
        label: audience.name,
        href:
          `/collections?audience=${encodeURIComponent(
            audience.slug
          )}`,
        meta: "Audience",
        keywords: [
          audience.slug,
          audience.name,
          "collection",
          "products",
        ],
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Tier / collection                                                      */
    /* ---------------------------------------------------------------------- */

    for (const tier of tiers) {
      if (
        tierSeen.has(
          tier.slug
        )
      ) {
        continue;
      }

      tierSeen.add(
        tier.slug
      );

      addItem(items, {
        key:
          `collection:${tier.slug}`,
        type: "collection",
        label: tier.name,
        href:
          `/collections?tier=${encodeURIComponent(
            tier.slug
          )}`,
        meta: "Collection",
        keywords: [
          tier.slug,
          tier.name,
          "tier",
          "collection",
          "products",
        ],
      });
    }

    /* ---------------------------------------------------------------------- */
    /* Category                                                              */
    /* ---------------------------------------------------------------------- */

    /**
     * IMPORTANT:
     *
     * In this project's collection routing, the first segment represents
     * audience. Therefore blindly generating:
     *
     *   /collections/{category}
     *
     * would be unsafe.
     *
     * Category destinations are therefore created ONLY with a real
     * product-derived audience context:
     *
     *   /collections?audience=men&category=panjabi
     *
     * Your existing /collections root then canonicalizes that query URL.
     */
    for (const audience of audiences) {
      for (const category of categories) {
        const contextKey =
          `${audience.slug}|${category.slug}`;

        if (
          categoryContextSeen.has(
            contextKey
          )
        ) {
          continue;
        }

        categoryContextSeen.add(
          contextKey
        );

        const params =
          new URLSearchParams();

        params.set(
          "audience",
          audience.slug
        );

        params.set(
          "category",
          category.slug
        );

        addItem(items, {
          key:
            `category:${contextKey}`,
          type: "category",
          label: category.name,
          href:
            `/collections?${params.toString()}`,
          meta:
            `Category · ${audience.name}`,
          keywords: [
            category.slug,
            category.name,
            audience.slug,
            audience.name,
            "category",
            "products",
          ],
        });
      }

      /* -------------------------------------------------------------------- */
      /* Sub-category                                                         */
      /* -------------------------------------------------------------------- */

      for (const category of categories) {
        for (
          const subCategory of subCategories
        ) {
          const contextKey =
            `${audience.slug}|${category.slug}|${subCategory.slug}`;

          const seenKey =
            `sub:${contextKey}`;

          if (
            categoryContextSeen.has(
              seenKey
            )
          ) {
            continue;
          }

          categoryContextSeen.add(
            seenKey
          );

          const params =
            new URLSearchParams();

          params.set(
            "audience",
            audience.slug
          );

          params.set(
            "category",
            category.slug
          );

          params.set(
            "subCategory",
            subCategory.slug
          );

          addItem(items, {
            key:
              `category:sub:${contextKey}`,
            type: "category",
            label:
              subCategory.name,
            href:
              `/collections?${params.toString()}`,
            meta:
              `Category · ${audience.name} · ${category.name}`,
            keywords: [
              subCategory.slug,
              subCategory.name,
              category.slug,
              category.name,
              audience.slug,
              audience.name,
              "subcategory",
              "products",
            ],
          });
        }
      }
    }
  }

  return {
    items,
    productHrefs,
  };
}

/* -------------------------------------------------------------------------- */
/* Final index                                                                */
/* -------------------------------------------------------------------------- */

async function buildSearchIndex(req) {
  const [
    productRows,
    publicPaths,
  ] = await Promise.all([
    fetchAllProducts(req),

    discoverPublicPaths(req).catch(
      () =>
        new Set([
          "/",
          "/product",
          "/collections",
        ])
    ),
  ]);

  const built =
    buildIndexFromProducts(
      productRows
    );

  const items = built.items;

  /**
   * Add sitemap-confirmed public pages.
   *
   * Product URLs are skipped because the structured product item above
   * has the real product name and richer searchable metadata.
   */
  for (const path of publicPaths) {
    if (
      !isPublicSearchPath(path)
    ) {
      continue;
    }

    if (
      built.productHrefs.has(
        path
      )
    ) {
      continue;
    }

    addItem(items, {
      key: `page:${path}`,
      type:
        path.startsWith(
          "/collections/"
        )
          ? "collection"
          : "page",
      label:
        labelFromPath(path),
      href: path,
      meta:
        path.startsWith(
          "/collections/"
        )
          ? "Collection"
          : "Page",
      keywords: [
        path,
        ...path
          .split("/")
          .filter(Boolean),
      ],
    });
  }

  /**
   * Base index is always A-Z.
   *
   * Query-specific ranking happens in the shared client matcher.
   */
  const out = Array.from(
    items.values()
  ).sort((a, b) =>
    String(a.label).localeCompare(
      String(b.label),
      undefined,
      {
        sensitivity: "base",
        numeric: true,
      }
    )
  );

  const counts = out.reduce(
    (acc, item) => {
      acc.total += 1;

      acc[item.type] =
        (acc[item.type] || 0) +
        1;

      return acc;
    },
    {
      total: 0,
    }
  );

  return {
    ok: true,
    schema: 1,
    generatedAt:
      new Date().toISOString(),
    counts,
    items: out,
  };
}

/* -------------------------------------------------------------------------- */
/* GET                                                                        */
/* -------------------------------------------------------------------------- */

export async function GET(req) {
  const started = Date.now();

  const url = new URL(req.url);

  const refresh =
    url.searchParams.get(
      "refresh"
    ) === "1";

  const cacheKey =
    "search-index:v1";

  if (!refresh) {
    const hit =
      memGet(cacheKey);

    if (hit) {
      return json(
        200,
        {
          ...hit,
          ms:
            Date.now() -
            started,
          cache: "mem",
        },
        {
          "x-tdls-search-cache":
            "1",
        }
      );
    }
  }

  try {
    const result =
      await runDedupe(
        cacheKey,
        () =>
          buildSearchIndex(req)
      );

    memSet(
      cacheKey,
      result
    );

    lastGoodSet(
      cacheKey,
      result
    );

    return json(
      200,
      {
        ...result,
        ms:
          Date.now() -
          started,
        cache: "miss",
      },
      {
        "x-tdls-search-cache":
          "0",
      }
    );
  } catch (error) {
    /**
     * If Strapi has a temporary failure, retain the most recent successful
     * search index instead of making the navbar suddenly empty.
     */
    const stale =
      lastGoodGet(
        cacheKey
      );

    if (stale) {
      return json(
        200,
        {
          ...stale,
          ms:
            Date.now() -
            started,
          cache: "stale",
        },
        {
          "x-tdls-search-cache":
            "stale",
        }
      );
    }

    return json(
      502,
      {
        ok: false,
        error:
          "SEARCH_INDEX_FAILED",
        message:
          error instanceof Error
            ? error.message
            : String(
                error ||
                  "Unknown error"
              ),
        items: [],
        counts: {
          total: 0,
        },
        ms:
          Date.now() -
          started,
      },
      {
        "cache-control":
          "no-store",
      }
    );
  }
}