// FILE: app/search/search_client.jsx
"use client";

import Link from "next/link";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  hydrateSearchIndex,
  rankSearchItems,
  readSearchIndexCache,
  writeSearchIndexCache,
} from "@/lib/site-search";

const FETCH_TIMEOUT_MS =
  18000;

/* -------------------------------------------------------------------------- */
/* Fetch                                                                      */
/* -------------------------------------------------------------------------- */

async function fetchSearchIndex() {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      FETCH_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        "/api/search-index",
        {
          method: "GET",

          headers: {
            Accept:
              "application/json",
          },

          cache:
            "no-store",

          signal:
            controller.signal,
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP_${response.status}`
      );
    }

    const payload =
      await response.json();

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

    writeSearchIndexCache(
      hydrated
    );

    return hydrated;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function SearchClient({
  initialQuery = "",
}) {
  const q =
    String(
      initialQuery || ""
    ).trim();

  const [
    index,
    setIndex,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  /* ------------------------------------------------------------------------ */
  /* Cache-first load                                                         */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    let alive = true;

    /**
     * If NavSearchbar has already loaded the index, this produces an immediate
     * result page without another visible loading delay.
     */
    const cached =
      readSearchIndexCache();

    if (cached.length) {
      setIndex(
        cached
      );

      setLoading(
        false
      );
    } else {
      setLoading(
        true
      );
    }

    setError("");

    /**
     * Refresh in background even when cache is available.
     */
    fetchSearchIndex()
      .then((items) => {
        if (!alive) {
          return;
        }

        setIndex(
          items
        );

        setLoading(
          false
        );
      })
      .catch(() => {
        if (!alive) {
          return;
        }

        /**
         * Cached search remains usable during a temporary API failure.
         */
        if (!cached.length) {
          setIndex([]);

          setError(
            "Search is temporarily unavailable. Please try again."
          );
        }

        setLoading(
          false
        );
      });

    return () => {
      alive = false;
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Search                                                                   */
  /* ------------------------------------------------------------------------ */

  const results =
    useMemo(() => {
      if (!q) {
        return [];
      }

      /**
       * No artificial result cap on the full search page.
       *
       * The navbar dropdown remains capped at 28 for usability, but this page
       * can show the full matching index.
       */
      return rankSearchItems(
        index,
        q,
        {
          limit:
            index.length ||
            1,
        }
      );
    }, [index, q]);

  /* ------------------------------------------------------------------------ */
  /* Existing search-page outlook retained                                    */
  /* ------------------------------------------------------------------------ */

  return (
    <main className="min-h-screen px-6 md:px-12 lg:px-16 pt-28 pb-16 bg-[#FFFDF8]">
      <h1 className="text-2xl md:text-3xl font-bold tracking-wide text-[#0c2340]">
        Search results
        {q
          ? ` for “${q}”`
          : ""}
      </h1>

      {!q && (
        <p className="mt-3 text-gray-600">
          Type something in the
          search bar.
        </p>
      )}

      {q &&
        loading && (
          <p className="mt-6 text-gray-600">
            Searching…
          </p>
        )}

      {q &&
        !loading &&
        error && (
          <p className="mt-6 text-gray-600">
            {error}
          </p>
        )}

      {q &&
        !loading &&
        !error &&
        results.length ===
          0 && (
          <p className="mt-6 text-gray-600">
            No products or pages
            matched. Try another
            term.
          </p>
        )}

      {!loading &&
        results.length >
          0 && (
          <ul className="mt-8 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
            {results.map(
              (item) => (
                <li
                  key={
                    item.key ||
                    `${item.type}:${item.href}`
                  }
                  className="group border rounded-xl bg-white p-4 hover:shadow-lg transition"
                >
                  <Link
                    href={
                      item.href
                    }
                    className="block"
                  >
                    {/*
                     * Preserved from your current search page:
                     * same placeholder/image-area footprint.
                     *
                     * Search behavior changes; page outlook is not redesigned.
                     */}
                    <div className="aspect-[4/3] w-full bg-gray-100 rounded-lg overflow-hidden mb-3" />

                    <div
                      className="text-[#0c2340] font-semibold line-clamp-2"
                      title={
                        item.meta
                          ? `${item.label} — ${item.meta}`
                          : item.label
                      }
                    >
                      {
                        item.label
                      }
                    </div>
                  </Link>
                </li>
              )
            )}
          </ul>
        )}
    </main>
  );
}