//src/lib/site-search.js
/*
 * TDLS shared site-search matcher.
 * Search-only utility: no UI, routing, menu, collection, or product behavior is changed here.
 */

const TYPE_ORDER = {
  product: 0,
  audience: 1,
  category: 2,
  collection: 3,
  page: 4,
};

export const SEARCH_INDEX_CACHE_KEY =
  "tdls:navsearch:index:v7_catalog";

export const SEARCH_INDEX_TS_KEY =
  "tdls:navsearch:index_ts:v7_catalog";

export const SEARCH_INDEX_CACHE_TTL_MS =
  30 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readSearchIndexCache(
  ttlMs = SEARCH_INDEX_CACHE_TTL_MS
) {
  if (
    typeof window === "undefined"
  ) {
    return [];
  }

  try {
    const ts = Number(
      window.localStorage.getItem(
        SEARCH_INDEX_TS_KEY
      ) || 0
    );

    if (
      !Number.isFinite(ts) ||
      ts <= 0
    ) {
      return [];
    }

    if (
      Date.now() - ts >
      ttlMs
    ) {
      return [];
    }

    const raw =
      window.localStorage.getItem(
        SEARCH_INDEX_CACHE_KEY
      );

    if (!raw) {
      return [];
    }

    const parsed =
      safeParseJson(raw);

    const rows =
      Array.isArray(
        parsed?.items
      )
        ? parsed.items
        : Array.isArray(parsed)
          ? parsed
          : [];

    return hydrateSearchIndex(
      rows
    );
  } catch {
    return [];
  }
}

export function writeSearchIndexCache(
  items
) {
  if (
    typeof window === "undefined"
  ) {
    return;
  }

  try {
    const compact = (
      Array.isArray(items)
        ? items
        : []
    ).map((item) => ({
      key: item.key,
      type: item.type,
      label: item.label,
      href: item.href,
      meta: item.meta,
      keywords: item.keywords,
    }));

    window.localStorage.setItem(
      SEARCH_INDEX_CACHE_KEY,
      JSON.stringify({
        v: 7,
        items: compact,
      })
    );

    window.localStorage.setItem(
      SEARCH_INDEX_TS_KEY,
      String(Date.now())
    );
  } catch {
    /**
     * Search must continue even if localStorage is full/disabled.
     * The active in-memory index still works.
     */
  }
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                              */
/* -------------------------------------------------------------------------- */

export function normalizeSearchText(
  value
) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^\p{L}\p{N}\s\-_/]+/gu,
      " "
    )
    .replace(
      /[\-_/]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

export function alphaCompare(
  a,
  b
) {
  return String(a ?? "").localeCompare(
    String(b ?? ""),
    undefined,
    {
      sensitivity: "base",
      numeric: true,
    }
  );
}

function tokensOf(value) {
  return normalizeSearchText(
    value
  )
    .split(" ")
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Typo tolerance                                                             */
/* -------------------------------------------------------------------------- */

function trigrams(value) {
  const normalized =
    normalizeSearchText(value);

  const s =
    `  ${normalized}  `;

  if (
    s.trim().length < 3
  ) {
    return [];
  }

  const out = [];

  for (
    let i = 0;
    i < s.length - 2;
    i += 1
  ) {
    out.push(
      s.slice(i, i + 3)
    );
  }

  return out;
}

function trigramSimilarity(
  a,
  b
) {
  const A = trigrams(a);
  const B = trigrams(b);

  if (
    !A.length ||
    !B.length
  ) {
    return 0;
  }

  const counts =
    new Map();

  for (const token of A) {
    counts.set(
      token,
      (counts.get(token) || 0) +
        1
    );
  }

  let intersection = 0;

  for (const token of B) {
    const n =
      counts.get(token) || 0;

    if (n > 0) {
      intersection += 1;

      counts.set(
        token,
        n - 1
      );
    }
  }

  return (
    (2 * intersection) /
    (A.length + B.length)
  );
}

/* -------------------------------------------------------------------------- */
/* Index hydration                                                            */
/* -------------------------------------------------------------------------- */

export function hydrateSearchItem(
  raw
) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const label =
    String(
      raw.label ||
        raw.name ||
        ""
    ).trim();

  const href =
    String(
      raw.href || ""
    ).trim();

  if (
    !label ||
    !href ||
    !href.startsWith("/")
  ) {
    return null;
  }

  const type =
    String(
      raw.type || "page"
    ).toLowerCase();

  const meta =
    String(
      raw.meta || ""
    ).trim();

  const keywordList =
    Array.isArray(
      raw.keywords
    )
      ? raw.keywords
      : raw.keywords
        ? [raw.keywords]
        : [];

  const keywords =
    keywordList
      .map((value) =>
        String(
          value || ""
        ).trim()
      )
      .filter(Boolean);

  const labelNorm =
    normalizeSearchText(
      label
    );

  const keywordNorm =
    normalizeSearchText(
      keywords.join(" ")
    );

  const hrefNorm =
    normalizeSearchText(
      href
    );

  return {
    ...raw,

    type,
    label,
    href,
    meta,
    keywords,

    _labelNorm:
      labelNorm,

    _keywordNorm:
      keywordNorm,

    _hrefNorm:
      hrefNorm,

    _labelTokens:
      tokensOf(label),

    _allNorm: [
      labelNorm,
      keywordNorm,
      hrefNorm,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function hydrateSearchIndex(
  items
) {
  const seen =
    new Set();

  const out = [];

  for (
    const raw of
      Array.isArray(items)
        ? items
        : []
  ) {
    const item =
      hydrateSearchItem(raw);

    if (!item) {
      continue;
    }

    const key =
      String(
        item.key ||
          `${item.type}|${item.href}|${item.label}`
      );

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    out.push(item);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Ranking                                                                    */
/* -------------------------------------------------------------------------- */

function matchRank(
  item,
  queryNorm,
  queryTokens
) {
  const label =
    item._labelNorm ||
    normalizeSearchText(
      item.label
    );

  const keywords =
    item._keywordNorm ||
    normalizeSearchText(
      (
        item.keywords ||
        []
      ).join(" ")
    );

  const href =
    item._hrefNorm ||
    normalizeSearchText(
      item.href
    );

  const all =
    item._allNorm ||
    [
      label,
      keywords,
      href,
    ]
      .filter(Boolean)
      .join(" ");

  /**
   * Empty query:
   * everything is valid and final sorting becomes A-Z.
   */
  if (!queryNorm) {
    return {
      bucket: 0,
      fuzzy: 0,
    };
  }

  /**
   * 0. Exact label:
   * "Men" searched as "men"
   */
  if (
    label === queryNorm
  ) {
    return {
      bucket: 0,
      fuzzy: 1,
    };
  }

  /**
   * 1. Label begins with query:
   * "Maroon Shirt" searched as "m"
   */
  if (
    label.startsWith(
      queryNorm
    )
  ) {
    return {
      bucket: 1,
      fuzzy: 1,
    };
  }

  /**
   * 2. Any label word begins with query:
   * "Premium Men Shirt" searched as "men"
   */
  const labelTokens =
    item._labelTokens ||
    tokensOf(
      item.label
    );

  if (
    labelTokens.some(
      (token) =>
        token.startsWith(
          queryNorm
        )
    )
  ) {
    return {
      bucket: 2,
      fuzzy: 1,
    };
  }

  /**
   * 3. Label contains query.
   */
  if (
    label.includes(
      queryNorm
    )
  ) {
    return {
      bucket: 3,
      fuzzy: 1,
    };
  }

  /**
   * 4-7. Contextual matches.
   *
   * This allows a product called:
   *
   *   Classic Oxford Shirt
   *
   * to appear for:
   *
   *   men
   *
   * when Men is a real audience relation on that product.
   */
  if (
    keywords === queryNorm
  ) {
    return {
      bucket: 4,
      fuzzy: 1,
    };
  }

  if (
    keywords.startsWith(
      queryNorm
    )
  ) {
    return {
      bucket: 5,
      fuzzy: 1,
    };
  }

  const keywordTokens =
    tokensOf(keywords);

  if (
    keywordTokens.some(
      (token) =>
        token.startsWith(
          queryNorm
        )
    )
  ) {
    return {
      bucket: 6,
      fuzzy: 1,
    };
  }

  if (
    keywords.includes(
      queryNorm
    ) ||
    href.includes(
      queryNorm
    )
  ) {
    return {
      bucket: 7,
      fuzzy: 1,
    };
  }

  /**
   * 8. Multi-word query where every word exists in combined searchable data.
   */
  if (
    queryTokens.length > 1 &&
    queryTokens.every(
      (token) =>
        all.includes(token)
    )
  ) {
    return {
      bucket: 8,
      fuzzy: 1,
    };
  }

  /**
   * 9. Typo tolerance only after all deterministic matching modes.
   *
   * It deliberately comes last so fuzzy matching cannot disturb
   * normal alphabetic/prefix search.
   */
  if (
    queryNorm.length >= 3
  ) {
    const similarity =
      trigramSimilarity(
        label,
        queryNorm
      );

    if (
      similarity >= 0.34
    ) {
      return {
        bucket: 9,
        fuzzy:
          similarity,
      };
    }
  }

  return null;
}

export function rankSearchItems(
  items,
  query,
  options = {}
) {
  const source =
    Array.isArray(items)
      ? items
      : [];

  const queryNorm =
    normalizeSearchText(
      query
    );

  const queryTokens =
    tokensOf(
      queryNorm
    );

  const requestedLimit =
    Number(
      options.limit
    );

  const limit =
    Number.isFinite(
      requestedLimit
    ) &&
    requestedLimit > 0
      ? Math.floor(
          requestedLimit
        )
      : source.length;

  /**
   * No query:
   * show the whole index in true A-Z order.
   */
  if (!queryNorm) {
    return source
      .slice()
      .sort((a, b) => {
        const byLabel =
          alphaCompare(
            a.label,
            b.label
          );

        if (
          byLabel !== 0
        ) {
          return byLabel;
        }

        const aType =
          TYPE_ORDER[
            a.type
          ] ?? 99;

        const bType =
          TYPE_ORDER[
            b.type
          ] ?? 99;

        if (
          aType !== bType
        ) {
          return (
            aType - bType
          );
        }

        return alphaCompare(
          a.href,
          b.href
        );
      })
      .slice(
        0,
        limit
      );
  }

  const matched = [];

  for (const item of source) {
    const match =
      matchRank(
        item,
        queryNorm,
        queryTokens
      );

    if (match) {
      matched.push({
        item,
        ...match,
      });
    }
  }

  matched.sort(
    (a, b) => {
      /**
       * Matching quality first.
       */
      if (
        a.bucket !==
        b.bucket
      ) {
        return (
          a.bucket -
          b.bucket
        );
      }

      /**
       * Fuzzy bucket only:
       * stronger fuzzy similarity wins before A-Z.
       */
      if (
        a.bucket === 9 &&
        b.fuzzy !==
          a.fuzzy
      ) {
        return (
          b.fuzzy -
          a.fuzzy
        );
      }

      /**
       * Within every normal matching level:
       * true alphabetic A-Z ordering.
       */
      const byLabel =
        alphaCompare(
          a.item.label,
          b.item.label
        );

      if (
        byLabel !== 0
      ) {
        return byLabel;
      }

      const aType =
        TYPE_ORDER[
          a.item.type
        ] ?? 99;

      const bType =
        TYPE_ORDER[
          b.item.type
        ] ?? 99;

      if (
        aType !== bType
      ) {
        return (
          aType -
          bType
        );
      }

      return alphaCompare(
        a.item.href,
        b.item.href
      );
    }
  );

  return matched
    .slice(
      0,
      limit
    )
    .map(
      ({ item }) =>
        item
    );
}

/* -------------------------------------------------------------------------- */
/* Display labels                                                             */
/* -------------------------------------------------------------------------- */

export function searchTypeLabel(
  type
) {
  switch (
    String(
      type || ""
    ).toLowerCase()
  ) {
    case "product":
      return "Product";

    case "audience":
      return "Audience";

    case "category":
      return "Category";

    case "collection":
      return "Collection";

    default:
      return "Page";
  }
}