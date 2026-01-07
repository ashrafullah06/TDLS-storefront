import React, { useEffect, useState } from "react";
const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

export default function ReviewsQA({ productId, userId }) {
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/reviews?product=${productId}`);
        const json = await res.json();

        let arr = json.data || json;
        if (!Array.isArray(arr)) arr = [];
        if (!ignore) setReviews(arr);
      } catch {
        if (!ignore) setReviews([]);
      }
    }
    load();
    return () => { ignore = true; };
  }, [productId]);

  if (!reviews || !Array.isArray(reviews) || reviews.length === 0) return null;

  return (
    <div style={{ margin: "40px 0 18px 0" }}>
      <h3 style={{ fontWeight: 900, fontSize: 20, color: "#0C2340" }}>Customer Reviews</h3>
      {reviews.map((r, i) => (
        <div key={i} style={{
          margin: "13px 0", background: "#f7f9fa",
          borderRadius: 10, padding: "15px 19px"
        }}>
          <div style={{ fontWeight: 800, color: "#1b3150", marginBottom: 5 }}>{r.title || "Review"}</div>
          <div style={{ color: "#777", fontSize: 14 }}>{r.text || r.body}</div>
          <div style={{ fontSize: 13, color: "#137d3a", marginTop: 4 }}>— {r.user?.name || "Customer"}</div>
        </div>
      ))}
    </div>
  );
}
