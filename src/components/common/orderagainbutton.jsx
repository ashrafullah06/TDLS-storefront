import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

export default function OrderAgainButton({ userId, productId }) {
  const [canOrderAgain, setCanOrderAgain] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // Check eligibility
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    async function check() {
      if (!userId || !productId) {
        setCanOrderAgain(false);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/orders?user=${userId}&product=${productId}`);
        const json = await res.json();
        let orders = json.data || json;
        if (!ignore) setCanOrderAgain(Array.isArray(orders) && orders.length > 0);
      } catch {
        if (!ignore) setCanOrderAgain(false);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    check();
    return () => { ignore = true; };
  }, [userId, productId]);

  // Add to cart action
  async function handleOrderAgain() {
    setAdding(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/cart/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: userId, product: productId })
      });
      if (res.ok) {
        setDone(true);
        // Optionally, redirect to cart or show toast
        setTimeout(() => setDone(false), 1800);
      } else {
        setError("Failed to add to cart. Try again.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setAdding(false);
    }
  }

  if (loading) return null;
  if (!canOrderAgain) return null;

  return (
    <div style={{ margin: "12px 0 6px 0", width: "100%", display: "flex", justifyContent: "flex-start" }}>
      <style>{`
        .orderagain-btn {
          background: linear-gradient(92deg, #1bc262 70%, #0C2340 100%);
          color: #fff;
          font-weight: 900;
          border: none;
          border-radius: 9px;
          font-size: 1.15rem;
          padding: 13px 37px;
          box-shadow: 0 2px 14px #22e15a22;
          cursor: pointer;
          outline: none;
          min-width: 170px;
          transition: background .14s, transform .09s;
          margin-right: 10px;
        }
        .orderagain-btn:active { transform: scale(.96); }
        @media (max-width: 500px) {
          .orderagain-btn {
            font-size: 1rem;
            padding: 11px 17px;
            border-radius: 7px;
            min-width: 120px;
          }
        }
      `}</style>
      <button
        className="orderagain-btn"
        disabled={adding || done}
        onClick={handleOrderAgain}
        aria-label="Order this product again"
        tabIndex={0}
      >
        {adding ? "Adding..." : done ? "Added!" : "Order Again"}
      </button>
      {error && (
        <span style={{
          color: "#e54b0e",
          fontWeight: 700,
          marginLeft: 10,
          fontSize: 14
        }}>{error}</span>
      )}
    </div>
  );
}
