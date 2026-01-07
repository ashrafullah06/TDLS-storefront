"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useMemo } from "react";

const STRAPI_BASE =
  process.env.NEXT_PUBLIC_STRAPI_API_URL?.replace(/\/+$/, "") || "http://localhost:1337";

export default function SearchClient() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const queryUrl = useMemo(() => {
    if (!q) return null;
    return `${STRAPI_BASE}/api/products?filters[name][$containsi]=${encodeURIComponent(q)}&populate=*`;
  }, [q]);

  useEffect(() => {
    if (!queryUrl) {
      setResults([]);
      return;
    }
    setLoading(true);

    fetch(queryUrl)
      .then((res) => res.json())
      .then((data) => {
        setResults(Array.isArray(data?.data) ? data.data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [queryUrl]);

  return (
    <div style={{ padding: 32 }}>
      <h2>Search Results{q && ` for “${q}”`}</h2>
      {loading && <div>Loading...</div>}
      {!loading && results.length === 0 && q && <div>No results found.</div>}
      {!loading && results.length > 0 && (
        <ul>
          {results.map((item) => (
            <li key={item.id}>{item.attributes?.name || "No name"}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
