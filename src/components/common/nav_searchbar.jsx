//✅ FULL FILE: src/components/common/nav_searchbar.jsx

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useRouter } from "next/navigation";

import {
  hydrateSearchIndex,
  normalizeSearchText,
  rankSearchItems,
  readSearchIndexCache,
  searchTypeLabel,
  writeSearchIndexCache,
} from "@/lib/site-search";

/**
 * TDLS Nav Search
 * -----------------------------------------------------------------------------
 *
 * Complete catalog/site search while preserving the existing navbar appearance.
 *
 * SEARCH-ONLY changes:
 *
 * 1) Uses /api/search-index rather than browser sitemap/HTML crawling.
 *
 * 2) Index contains every visible product across ALL Strapi pagination pages.
 *
 * 3) Also contains:
 *    - real audiences
 *    - real category+audience destinations
 *    - real tier/collection destinations
 *    - verified public sitemap pages
 *
 * 4) Search priority:
 *
 *    exact
 *      ->
 *    label starts with query
 *      ->
 *    word starts with query
 *      ->
 *    label contains query
 *      ->
 *    contextual relation matches
 *      ->
 *    typo/fuzzy fallback
 *
 *    Inside each normal matching level, results are A-Z.
 *
 * 5) Every clickable suggestion already contains its final verified href.
 *
 * 6) Existing first-suggestion Enter behavior is preserved.
 *
 * 7) If there is no direct suggestion, /search?q=... is used to show the
 *    complete search-result set.
 *
 * UI dimensions/colors/spacing are deliberately unchanged.
 */

const FETCH_TIMEOUT_MS =
  18000;

const RANK_DEBOUNCE_MS =
  45;

const SUGGESTION_LIMIT =
  28;

const MOBILE_MAX_WIDTH_PX =
  640;

const MOBILE_MEDIA =
  `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/* -------------------------------------------------------------------------- */
/* Module-level preload singleton                                             */
/* -------------------------------------------------------------------------- */

let __searchIndexData =
  null;

let __searchIndexPromise =
  null;

/* -------------------------------------------------------------------------- */
/* Fetch helper                                                               */
/* -------------------------------------------------------------------------- */

async function fetchJsonWithTimeout(
  url,
  ms
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      ms
    );

  try {
    const response =
      await fetch(url, {
        method: "GET",

        headers: {
          Accept:
            "application/json",
        },

        cache:
          "no-store",

        signal:
          controller.signal,
      });

    if (!response.ok) {
      throw new Error(
        `HTTP_${response.status}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* True preload                                                               */
/* -------------------------------------------------------------------------- */

export function warmNavSearchIndex({
  force = false,
} = {}) {
  if (
    typeof window ===
    "undefined"
  ) {
    return Promise.resolve(
      []
    );
  }

  /**
   * Already warm in this JS runtime.
   */
  if (
    !force &&
    Array.isArray(
      __searchIndexData
    ) &&
    __searchIndexData.length
  ) {
    return Promise.resolve(
      __searchIndexData
    );
  }

  /**
   * Join an existing request rather than issuing another one.
   */
  if (
    !force &&
    __searchIndexPromise
  ) {
    return __searchIndexPromise;
  }

  /**
   * localStorage allows the search bar to open immediately on subsequent
   * visits while a fresh server index is obtained in the background.
   */
  const cached =
    !force
      ? readSearchIndexCache()
      : [];

  if (cached.length) {
    __searchIndexData =
      cached;
  }

  /**
   * Always start the refresh request even when cached data exists.
   *
   * The function returns cached data immediately below, but this promise
   * still refreshes the singleton/cache in the background.
   */
  const promise =
    fetchJsonWithTimeout(
      `/api/search-index${
        force
          ? "?refresh=1"
          : ""
      }`,
      FETCH_TIMEOUT_MS
    )
      .then((payload) => {
        if (
          !payload?.ok ||
          !Array.isArray(
            payload.items
          )
        ) {
          throw new Error(
            "INVALID_SEARCH_INDEX"
          );
        }

        const hydrated =
          hydrateSearchIndex(
            payload.items
          );

        if (
          !hydrated.length
        ) {
          throw new Error(
            "EMPTY_SEARCH_INDEX"
          );
        }

        __searchIndexData =
          hydrated;

        writeSearchIndexCache(
          hydrated
        );

        return hydrated;
      })
      .catch((error) => {
        /**
         * Search should remain usable if a refresh temporarily fails.
         */
        if (
          __searchIndexData?.length
        ) {
          return __searchIndexData;
        }

        throw error;
      })
      .finally(() => {
        __searchIndexPromise =
          null;
      });

  __searchIndexPromise =
    promise;

  /**
   * Cached data is returned immediately.
   *
   * The refresh promise above has already started.
   */
  return (
    cached.length &&
    !force
  )
    ? Promise.resolve(
        cached
      )
    : promise;
}

/* -------------------------------------------------------------------------- */
/* Mobile detector                                                            */
/* -------------------------------------------------------------------------- */

function useIsMobile() {
  const [
    isMobile,
    setIsMobile,
  ] = useState(false);

  useEffect(() => {
    if (
      typeof window ===
        "undefined" ||
      !window.matchMedia
    ) {
      return;
    }

    const media =
      window.matchMedia(
        MOBILE_MEDIA
      );

    const update = () =>
      setIsMobile(
        !!media.matches
      );

    update();

    if (
      typeof media.addEventListener ===
      "function"
    ) {
      media.addEventListener(
        "change",
        update
      );

      return () =>
        media.removeEventListener(
          "change",
          update
        );
    }

    media.addListener(
      update
    );

    return () =>
      media.removeListener(
        update
      );
  }, []);

  return isMobile;
}

/* -------------------------------------------------------------------------- */
/* Spinner                                                                    */
/* -------------------------------------------------------------------------- */

function Spinner({
  size = 14,
}) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border:
          "2px solid rgba(12,35,64,0.18)",
        borderTopColor:
          "rgba(12,35,64,0.75)",
        display:
          "inline-block",
        animation:
          "tdlsSpin .8s linear infinite",
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function NavSearchbar({
  className = "",
  placeholder =
    "Search products, collections, pages…",
}) {
  const router =
    useRouter();

  /**
   * Preserved:
   *
   * The current navbar already does not mount NavSearchbar on mobile.
   * This internal guard is retained too so this search correction does not
   * change your existing navbar/mobile outlook.
   */
  const isMobile =
    useIsMobile();

  if (isMobile) {
    return null;
  }

  const [q, setQ] =
    useState("");

  const [
    focused,
    setFocused,
  ] = useState(false);

  const [
    indexReady,
    setIndexReady,
  ] = useState(false);

  const [
    isIndexing,
    setIsIndexing,
  ] = useState(true);

  const [
    indexedCount,
    setIndexedCount,
  ] = useState(0);

  /**
   * Because Navbar only mounts this component client-side after its own
   * mounted check, reading the local cache here does not alter SSR markup.
   */
  const [
    pageIndex,
    setPageIndex,
  ] = useState(
    () =>
      readSearchIndexCache()
  );

  const [
    suggestions,
    setSuggestions,
  ] = useState([]);

  const [
    activeIdx,
    setActiveIdx,
  ] = useState(-1);

  const inputRef =
    useRef(null);

  const wrapperRef =
    useRef(null);

  const composingRef =
    useRef(false);

  const rankTimerRef =
    useRef(null);

  const showPanel =
    focused;

  /* ------------------------------------------------------------------------ */
  /* Navigation                                                               */
  /* ------------------------------------------------------------------------ */

  const gotoPage =
    useCallback(
      (href) => {
        const target =
          String(
            href || ""
          ).trim();

        if (
          !target.startsWith(
            "/"
          )
        ) {
          return;
        }

        try {
          router.prefetch?.(
            target
          );
        } catch {}

        router.push(
          target
        );

        setFocused(false);

        setActiveIdx(-1);
      },
      [router]
    );

  const gotoSearchResults =
    useCallback(() => {
      const query =
        q.trim();

      if (!query) {
        setFocused(true);
        return;
      }

      const href =
        `/search?q=${encodeURIComponent(
          query
        )}`;

      try {
        router.prefetch?.(
          href
        );
      } catch {}

      router.push(href);

      setFocused(false);

      setActiveIdx(-1);
    }, [q, router]);

  const clear =
    useCallback(() => {
      setQ("");

      setSuggestions([]);

      setActiveIdx(-1);
    }, []);

  const firstSelectableIdx =
    useCallback(
      (arr) =>
        Array.isArray(arr) &&
        arr.length
          ? 0
          : -1,
      []
    );

  /* ------------------------------------------------------------------------ */
  /* Outside click                                                            */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    const onPointer = (
      event
    ) => {
      const wrapper =
        wrapperRef.current;

      if (!wrapper) {
        return;
      }

      if (
        !wrapper.contains(
          event.target
        )
      ) {
        setFocused(false);

        setActiveIdx(-1);
      }
    };

    const options = {
      capture: true,
      passive: true,
    };

    document.addEventListener(
      "pointerdown",
      onPointer,
      options
    );

    return () =>
      document.removeEventListener(
        "pointerdown",
        onPointer,
        options
      );
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Index preload                                                            */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    let alive = true;

    const cached =
      readSearchIndexCache();

    if (cached.length) {
      __searchIndexData =
        cached;

      setPageIndex(
        cached
      );

      setIndexedCount(
        cached.length
      );

      setIndexReady(
        true
      );

      setIsIndexing(
        false
      );
    }

    setIsIndexing(
      !cached.length
    );

    warmNavSearchIndex({
      force: false,
    })
      .then((items) => {
        if (!alive) {
          return;
        }

        const hydrated =
          Array.isArray(items)
            ? items
            : [];

        setPageIndex(
          hydrated
        );

        setIndexedCount(
          hydrated.length
        );

        setIndexReady(
          true
        );

        setIsIndexing(
          false
        );
      })
      .catch(() => {
        if (!alive) {
          return;
        }

        /**
         * Existing cached data remains visible if available.
         */
        setIndexReady(
          true
        );

        setIsIndexing(
          false
        );
      });

    return () => {
      alive = false;
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Ranking                                                                  */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      rankTimerRef.current
    ) {
      clearTimeout(
        rankTimerRef.current
      );
    }

    if (!showPanel) {
      setSuggestions([]);

      setActiveIdx(-1);

      return;
    }

    rankTimerRef.current =
      setTimeout(() => {
        const ranked =
          rankSearchItems(
            pageIndex,
            q,
            {
              limit:
                SUGGESTION_LIMIT,
            }
          );

        setSuggestions(
          ranked
        );

        /**
         * Preserved existing behavior:
         * first visible result is active by default.
         */
        setActiveIdx(
          firstSelectableIdx(
            ranked
          )
        );
      }, RANK_DEBOUNCE_MS);

    return () => {
      if (
        rankTimerRef.current
      ) {
        clearTimeout(
          rankTimerRef.current
        );
      }
    };
  }, [
    q,
    showPanel,
    pageIndex,
    firstSelectableIdx,
  ]);

  /* ------------------------------------------------------------------------ */
  /* Suggestion selection                                                     */
  /* ------------------------------------------------------------------------ */

  const onPickSuggestion =
    useCallback(
      (item) => {
        if (!item?.href) {
          return;
        }

        setQ(
          item.label || ""
        );

        gotoPage(
          item.href
        );
      },
      [gotoPage]
    );

  /* ------------------------------------------------------------------------ */
  /* Existing visual style                                                    */
  /* ------------------------------------------------------------------------ */

  const containerStyle =
    useMemo(
      () => ({
        display: "flex",

        alignItems:
          "center",

        background:
          "#F8F6EE",

        border:
          "1px solid #ECE9DB",

        margin: 0,

        padding:
          "2px 10px 2px 10px",

        position:
          "relative",

        maxWidth: 340,

        minWidth: 160,

        width:
          "clamp(160px, 26vw, 300px)",

        borderRadius:
          9999,

        boxShadow:
          focused
            ? "0 8px 20px rgba(12,35,64,.06)"
            : "0 2px 6px rgba(12,35,64,.04)",

        transition:
          "box-shadow .15s ease, background .2s ease",
      }),
      [focused]
    );

  /* ------------------------------------------------------------------------ */
  /* Highlight                                                                */
  /* ------------------------------------------------------------------------ */

  const highlight =
    useCallback(
      (
        label,
        query
      ) => {
        const rawLabel =
          String(
            label || ""
          );

        const rawQuery =
          String(
            query || ""
          ).trim();

        if (!rawQuery) {
          return rawLabel;
        }

        const lowerLabel =
          rawLabel.toLocaleLowerCase();

        const lowerQuery =
          rawQuery.toLocaleLowerCase();

        const index =
          lowerLabel.indexOf(
            lowerQuery
          );

        if (
          index < 0 ||
          !normalizeSearchText(
            rawQuery
          )
        ) {
          return rawLabel;
        }

        return (
          <>
            {rawLabel.slice(
              0,
              index
            )}

            <mark className="tdls-mark">
              {rawLabel.slice(
                index,
                index +
                  rawQuery.length
              )}
            </mark>

            {rawLabel.slice(
              index +
                rawQuery.length
            )}
          </>
        );
      },
      []
    );

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div
      suppressHydrationWarning
      className={`${className}`}
      ref={wrapperRef}
      style={{
        position:
          "relative",
      }}
    >
      <form
        role="search"
        aria-label="Site search"
        onSubmit={(event) => {
          event.preventDefault();

          const selected =
            activeIdx >= 0
              ? suggestions[
                  activeIdx
                ]
              : null;

          /**
           * Preserved existing behavior:
           * Enter/search button opens the active first match when one exists.
           */
          if (
            selected?.href
          ) {
            onPickSuggestion(
              selected
            );

            return;
          }

          /**
           * If there is no direct suggestion, use the complete result page.
           */
          gotoSearchResults();
        }}
        className="tdls-search-form"
        style={{
          position:
            "relative",
        }}
      >
        <div
          className="tdls-searchwrap"
          style={
            containerStyle
          }
        >
          <button
            type="submit"
            aria-label="Go"
            className="tdls-search-ico"
            title="Go"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="#0c2340"
              strokeWidth="2"
              aria-hidden
            >
              <circle
                cx="11"
                cy="11"
                r="7"
              />

              <path d="M20 20L17 17" />
            </svg>
          </button>

          <input
            ref={inputRef}
            className="tdls-search-input"
            aria-label="Search site"
            placeholder={
              placeholder
            }
            value={q}
            onChange={(
              event
            ) =>
              setQ(
                event.target
                  .value
              )
            }
            onFocus={() =>
              setFocused(
                true
              )
            }
            onCompositionStart={() => {
              composingRef.current =
                true;
            }}
            onCompositionEnd={() => {
              composingRef.current =
                false;
            }}
            onKeyDown={(
              event
            ) => {
              if (
                event.key ===
                "Escape"
              ) {
                clear();

                inputRef.current?.blur();

                setFocused(
                  false
                );

                return;
              }

              if (
                composingRef.current ||
                !showPanel
              ) {
                return;
              }

              if (
                event.key ===
                "ArrowDown"
              ) {
                event.preventDefault();

                setActiveIdx(
                  (index) => {
                    const count =
                      suggestions.length;

                    if (!count) {
                      return -1;
                    }

                    return index <
                      0
                      ? 0
                      : (index +
                          1) %
                          count;
                  }
                );

                return;
              }

              if (
                event.key ===
                "ArrowUp"
              ) {
                event.preventDefault();

                setActiveIdx(
                  (index) => {
                    const count =
                      suggestions.length;

                    if (!count) {
                      return -1;
                    }

                    return index <
                      0
                      ? count -
                          1
                      : (index -
                          1 +
                          count) %
                          count;
                  }
                );

                return;
              }

              if (
                event.key ===
                "Enter"
              ) {
                const selected =
                  activeIdx >=
                  0
                    ? suggestions[
                        activeIdx
                      ]
                    : null;

                if (
                  selected?.href
                ) {
                  event.preventDefault();

                  onPickSuggestion(
                    selected
                  );
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
              style={{
                display:
                  "flex",

                alignItems:
                  "center",

                gap: 8,

                padding:
                  "0 6px",
              }}
            >
              <Spinner
                size={14}
              />
            </div>
          ) : null}

          {q ? (
            <button
              type="button"
              className="tdls-clear"
              aria-label="Clear"
              onClick={clear}
              title="Clear"
            >
              ×
            </button>
          ) : null}
        </div>
      </form>

      <div
        className={`tdls-hints ${
          showPanel
            ? "show"
            : ""
        }`}
        role="listbox"
        aria-label="Search results"
        aria-hidden={
          !showPanel
        }
        style={{
          display:
            showPanel
              ? "block"
              : "none",
        }}
      >
        <div className="tdls-hints-head">
          <div className="tdls-hints-title">
            {q.trim()
              ? "Verified matches"
              : "Pages (A–Z)"}
          </div>

          <div className="tdls-hints-meta">
            {indexReady &&
            !isIndexing
              ? `Ready · ${
                  indexedCount ||
                  pageIndex.length
                } indexed`
              : "Indexing…"}
          </div>
        </div>

        {suggestions.length ? (
          suggestions.map(
            (
              item,
              index
            ) => {
              const isActive =
                index ===
                activeIdx;

              const typeLabel =
                searchTypeLabel(
                  item.type
                );

              return (
                <div
                  key={
                    item.key ||
                    `${item.type}:${item.href}:${index}`
                  }
                  className={`tdls-hint ${
                    isActive
                      ? "active"
                      : ""
                  }`}
                  role="option"
                  aria-selected={
                    isActive
                  }
                  onMouseEnter={() =>
                    setActiveIdx(
                      index
                    )
                  }
                  onMouseDown={(
                    event
                  ) => {
                    event.preventDefault();

                    onPickSuggestion(
                      item
                    );
                  }}
                >
                  <span
                    className="tdls-hint-main"
                    title={
                      item.meta
                        ? `${item.label} — ${item.meta}`
                        : item.label
                    }
                  >
                    {highlight(
                      item.label,
                      q
                    )}
                  </span>

                  <span className="tdls-hint-sub">
                    {item.meta ||
                      typeLabel}
                  </span>
                </div>
              );
            }
          )
        ) : (
          <div className="tdls-empty">
            {isIndexing
              ? "Building search index…"
              : q.trim()
                ? `No matches found for “${q.trim()}”.`
                : "No pages indexed yet."}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes tdlsSpin {
          0% {
            transform: rotate(
              0deg
            );
          }

          100% {
            transform: rotate(
              360deg
            );
          }
        }

        .tdls-search-ico {
          background: transparent;
          border: none;
          padding: 8px 6px
            8px 4px;
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
          padding: 8px 8px
            8px 6px;
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
          top: calc(
            100% + 6px
          );
          right: 0;
          padding: 8px;
          background: #ffffff;
          border: 1px solid
            #ece9db;
          border-radius: 10px;
          box-shadow: 0 10px
            24px
            rgba(
              12,
              35,
              64,
              0.08
            );
          width: max(
            260px,
            min(
              66vw,
              420px
            )
          );
          max-width: 92vw;
          display: none;
          z-index: 9998;
          max-height: min(
            62vh,
            560px
          );
          overflow: auto;
        }

        .tdls-hints.show {
          display: block;
        }

        .tdls-hints-head {
          display: flex;
          align-items: baseline;
          justify-content:
            space-between;
          gap: 10px;
          padding: 2px 4px
            8px 4px;
          position: sticky;
          top: 0;
          background: #fff;
          z-index: 1;
        }

        .tdls-hints-title {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform:
            uppercase;
          color: #0c2340;
        }

        .tdls-hints-meta {
          font-size: 11px;
          font-weight: 700;
          color: rgba(
            12,
            35,
            64,
            0.55
          );
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
          justify-content:
            space-between;
          gap: 10px;
        }

        .tdls-hint:hover {
          background: #f6f5ee;
        }

        .tdls-hint.active {
          background: #f6f5ee;
          box-shadow: inset 0
            0 0 1px
            rgba(
              12,
              35,
              64,
              0.08
            );
        }

        .tdls-hint-main {
          font-weight: 700;
          min-width: 0;
          overflow: hidden;
          text-overflow:
            ellipsis;
          white-space: nowrap;
        }

        .tdls-hint-sub {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform:
            uppercase;
          color: rgba(
            12,
            35,
            64,
            0.45
          );
          flex: 0 0 auto;
        }

        .tdls-empty {
          padding: 10px 10px;
          color: rgba(
            12,
            35,
            64,
            0.7
          );
          font-size: 13px;
          font-weight: 700;
          line-height: 1.35;
          border-radius: 8px;
          background: #fbfaf6;
          border: 1px solid
            rgba(
              236,
              233,
              219,
              0.9
            );
        }

        .tdls-mark {
          background: rgba(
            255,
            221,
            120,
            0.55
          );
          padding: 0 2px;
          border-radius: 3px;
        }
      `}</style>
    </div>
  );
}