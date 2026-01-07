import React, { useEffect, useState } from "react";
const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

function addToRecentlyViewed(product) {
  if (!product) return;
  try {
    const key = "tdlc_recently_viewed";
    let items = [];
    try {
      items = JSON.parse(localStorage.getItem(key) || "[]");
      items = Array.isArray(items) ? items : [];
    } catch {}
    // Remove duplicates, put latest first
    items = items.filter(p => p.id !== product.id);
    items.unshift(product);
    // Limit to 10
    if (items.length > 10) items = items.slice(0, 10);
    localStorage.setItem(key, JSON.stringify(items));
  } catch {}
}

function getRecentlyViewed() {
  try {
    let items = JSON.parse(localStorage.getItem("tdlc_recently_viewed") || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export default function Recommendations({ productId, userId, currentProduct, showTrending = true }) {
  // Personalized recommendations (from API)
  const [recs, setRecs] = useState([]);
  // Trending products (global, for discovery)
  const [trending, setTrending] = useState([]);
  // Recently viewed (localStorage)
  const [recent, setRecent] = useState([]);

  // Fetch recommendations (user+product based)
  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const url = `${API_BASE}/api/recommendations?product=${productId || ""}${userId ? `&user=${userId}` : ""}`;
        const res = await fetch(url);
        const json = await res.json();
        let result = json.data || json;
        if (!Array.isArray(result)) result = [];
        if (!ignore) setRecs(result);
      } catch {
        if (!ignore) setRecs([]);
      }
    }
    if (productId) load();
    return () => { ignore = true; };
  }, [productId, userId]);

  // Fetch trending products (for cross-discovery)
  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/products/trending`);
        const json = await res.json();
        let arr = json.data || json;
        if (!Array.isArray(arr)) arr = [];
        if (!ignore) setTrending(arr);
      } catch {
        if (!ignore) setTrending([]);
      }
    }
    if (showTrending) load();
    return () => { ignore = true; };
  }, [showTrending]);

  // Add to recently viewed (if in product page)
  useEffect(() => {
    if (currentProduct) addToRecentlyViewed(currentProduct);
    // Always update on mount
    setRecent(getRecentlyViewed());
  }, [currentProduct]);

  // ---- Render horizontal carousel
  function ProductCarousel({ title, products, highlightId }) {
    if (!products || products.length === 0) return null;
    return (
      <div style={{ margin: "34px 0 14px 0" }}>
        <h3 style={{
          fontWeight: 900,
          fontSize: 21,
          color: "#0C2340",
          marginBottom: 12
        }}>{title}</h3>
        <div style={{
          display: "flex",
          gap: 13,
          overflowX: "auto",
          scrollbarWidth: "thin",
          paddingBottom: 3
        }}>
          {products.map(r => (
            <a
              href={`/product/${r.slug || r.id}`}
              key={r.id}
              style={{
                minWidth: 130, maxWidth: 170,
                background: highlightId === r.id ? "#faf4d9" : "#fff",
                borderRadius: 10,
                boxShadow: "0 1px 8px #eee",
                textDecoration: "none",
                color: "#0C2340",
                flex: "0 0 auto"
              }}>
              <img
                src={r.image?.url || r.image || "/img/product-placeholder.png"}
                alt={r.name}
                style={{
                  width: "100%", height: 110, objectFit: "cover", borderRadius: 10
                }}
                loading="lazy"
              />
              <div style={{
                fontWeight: 800, fontSize: 15, margin: "5px 0", textAlign: "center"
              }}>{r.name}</div>
              <div style={{
                color: "#197d33", fontWeight: 700, textAlign: "center", marginBottom: 5
              }}>
                {r.price ? `৳${r.price}` : ""}
              </div>
            </a>
          ))}
        </div>
      </div>
    );
  }

  // Filter out current product and duplicates
  function filterDupes(list, excludeId) {
    const seen = new Set();
    return (list || []).filter(p => {
      if (!p.id || p.id === excludeId || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  // ---- Render
  return (
    <div style={{ margin: "22px 0" }}>
      {/* Personalized recommendations */}
      <ProductCarousel
        title="You Might Also Like"
        products={filterDupes(recs, currentProduct?.id)}
      />
      {/* Trending Now */}
      {showTrending &&
        <ProductCarousel
          title="Trending Now"
          products={filterDupes(trending, currentProduct?.id)}
        />}
      {/* Recently Viewed (local) */}
      {recent && recent.length > 1 && (
        <ProductCarousel
          title="Recently Viewed"
          products={filterDupes(recent, currentProduct?.id)}
          highlightId={currentProduct?.id}
        />
      )}
    </div>
  );
}
