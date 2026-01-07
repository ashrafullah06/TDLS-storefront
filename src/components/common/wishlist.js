"use client";
import React, { useEffect, useState } from "react";
import Image from "next/image";

const LS_KEY = "premium_wishlist";

// -- Wishlist context for global badge (optional) --
const WishlistContext = React.createContext();

export function useWishlistCount() {
  const ctx = React.useContext(WishlistContext);
  return ctx?.count || 0;
}

function getWishlist() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { return []; }
}
function setWishlist(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

// -- Main Wishlist Modal --
export default function Wishlist({
  open = false,
  onClose = () => {},
  onAddToCart,      // (item) => {}
  user = null       // pass user info or null for guest
}) {
  const [items, setItems] = useState([]);
  const [feedback, setFeedback] = useState(""); // For 'Added!' feedback

  // Load wishlist on open or localStorage change
  useEffect(() => {
    if (open) setItems(getWishlist());
  }, [open]);

  // Update global badge count if using context
  useEffect(() => {
    if (!open) return;
    const evt = new Event("wishlistUpdate");
    window.dispatchEvent(evt);
  }, [items.length, open]);

  // Remove item by id+variant
  function removeItem(item) {
    const updated = items.filter(
      i => !(i.id === item.id && i.variant === item.variant)
    );
    setItems(updated);
    setWishlist(updated);
    showFeedback("Removed!");
  }

  // Move to Bag (Cart)
  function moveToBag(item) {
    if (onAddToCart) onAddToCart(item);
    const updated = items.filter(i => !(i.id === item.id && i.variant === item.variant));
    setItems(updated);
    setWishlist(updated);
    showFeedback("Moved to Bag!");
  }

  // Remove all
  function clearWishlist() {
    setItems([]);
    setWishlist([]);
    showFeedback("Cleared!");
  }

  // Feedback helper (now actually used)
  function showFeedback(msg) {
    setFeedback(msg);
    setTimeout(() => setFeedback(""), 1300);
  }

  if (!open) return null;

  // Guest view
  if (!user) {
    return (
      <div
        className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40"
        aria-modal="true"
        tabIndex={-1}
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl p-8 w-[95vw] max-w-lg min-h-[220px] text-center relative"
          onClick={e => e.stopPropagation()}
          tabIndex={0}
        >
          <h2 className="text-xl font-bold mb-4 text-gray-900 flex items-center justify-center gap-3">
            <svg width="28" height="28"><path d="M14 25s-7-6-10.5-9.7C2 13 2 9.5 4.5 7.6A6.1 6.1 0 0114 8a6.1 6.1 0 019.5-.4C26 9.5 26 13 24.5 15.3 21 19 14 25 14 25z" stroke="#FFD700" strokeWidth="2" fill="none"/></svg>
            Wishlist
          </h2>
          <div className="py-6 text-gray-500">
            <div className="mb-2">Sign in to save your wishlist and access it across devices!</div>
            <button
              className="px-7 py-2 mt-3 bg-black text-[#FFD700] font-semibold rounded-full hover:bg-[#181A1B] transition"
              onClick={onClose}
              autoFocus
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated view
  return (
    <WishlistContext.Provider value={{ count: items.length }}>
      <div
        className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40"
        aria-modal="true"
        tabIndex={-1}
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl p-8 w-[95vw] max-w-lg min-h-[220px] text-center relative"
          onClick={e => e.stopPropagation()}
          tabIndex={0}
        >
          <h2 className="text-xl font-bold mb-3 text-gray-900 flex items-center justify-center gap-3">
            <svg width="28" height="28"><path d="M14 25s-7-6-10.5-9.7C2 13 2 9.5 4.5 7.6A6.1 6.1 0 0114 8a6.1 6.1 0 019.5-.4C26 9.5 26 13 24.5 15.3 21 19 14 25 14 25z" stroke="#FFD700" strokeWidth="2" fill="none"/></svg>
            Wishlist
          </h2>

          {feedback && (
            <div className="absolute right-7 top-7 px-5 py-2 rounded-full bg-[#FFD700]/80 text-black font-bold shadow">
              {feedback}
            </div>
          )}

          {items.length === 0 ? (
            <div className="py-8 text-gray-400 font-medium">
              <svg width="46" height="46" className="mx-auto mb-2"><path d="M23 41s-9.7-8.2-14.7-13.3C3 24.7 3 19.5 7.2 16.3A8.48 8.48 0 0123 16.8a8.48 8.48 0 0115.8-.5C43 19.5 43 24.7 37.7 27.7 32.7 32.8 23 41 23 41z" stroke="#FFD700" strokeWidth="2" fill="none"/></svg>
              Your wishlist is empty.
            </div>
          ) : (
            <div>
              <div className="flex justify-end mb-1">
                <button className="text-xs text-gray-500 hover:underline" onClick={clearWishlist}>
                  Clear All
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {items.map((item) => (
                  <div
                    key={item.id + (item.variant ? `-${item.variant}` : "")}
                    className="flex items-center gap-3 border-b py-2"
                  >
                    <Image
                      src={item.image?.url || "/img/product-placeholder.png"}
                      alt={item.name}
                      width={64}
                      height={64}
                      className="w-16 h-16 object-cover rounded-lg border"
                      unoptimized
                    />
                    <div className="flex-1 text-left">
                      <div className="font-semibold text-base">{item.name}</div>
                      {item.variant && <div className="text-xs text-gray-500">{item.variant}</div>}
                      <div className="text-gray-700 text-sm">{item.price ? `৳${item.price}` : ""}</div>
                    </div>
                    <button
                      className="text-sm px-3 py-1 rounded-full bg-[#FFD700]/10 text-[#FFD700] font-bold border border-[#FFD700] hover:bg-[#FFD700]/20 transition"
                      onClick={() => moveToBag(item)}
                    >
                      Move to Bag
                    </button>
                    <button
                      className="ml-2 text-gray-400 hover:text-red-500 text-lg"
                      onClick={() => removeItem(item)}
                      aria-label="Remove from wishlist"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            className="mt-6 px-8 py-2 bg-black text-[#FFD700] rounded-full font-semibold hover:bg-[#181A1B] transition"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </div>
      </div>
    </WishlistContext.Provider>
  );
}

// -- Add/Remove to wishlist from anywhere --
export function toggleWishlist(product, variant) {
  const items = getWishlist();
  const exists = items.some(i => (i.id === product.id && i.variant === (variant || "")));
  let updated;
  if (exists) {
    updated = items.filter(i => !(i.id === product.id && i.variant === (variant || "")));
  } else {
    const addObj = {
      ...product,
      variant: variant || "",
      addedAt: Date.now()
    };
    updated = [addObj, ...items];
  }
  setWishlist(updated);
  window.dispatchEvent(new Event("wishlistUpdate"));
  return !exists;
}

// -- Hook for nav badge --
export function useWishlistBadge() {
  const [count, setCount] = useState(getWishlist().length);
  useEffect(() => {
    function upd() { setCount(getWishlist().length); }
    window.addEventListener("wishlistUpdate", upd);
    return () => window.removeEventListener("wishlistUpdate", upd);
  }, []);
  return count;
}
