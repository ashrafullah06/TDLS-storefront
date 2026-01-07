import React from "react";
import { FaHeart, FaWhatsapp } from "react-icons/fa";

export default function StickyMobileActionBar({
  product,
  user,
  onAddToCart,
  onBuyNow,
  onWishlist,
  whatsappNumber = "8801700000000"
}) {
  if (typeof window !== "undefined" && window.innerWidth > 768) return null;

  return (
    <div
      aria-label="Quick actions"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        width: "100vw",
        zIndex: 9001,
        background: "#fff",
        boxShadow: "0 -3px 16px #1112",
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
        padding: "10px 0 18px 0"
      }}
      className="stickymobilebar"
    >
      <style>{`
        .stickymobilebar button {
          flex: 1 1 24%;
          margin: 0 4px;
          border: none;
          border-radius: 9px;
          padding: 14px 0;
          font-weight: 900;
          font-size: 1.09rem;
          color: #fff;
          background: linear-gradient(93deg,#0C2340 75%, #26d37a 100%);
          box-shadow: 0 1px 8px #0c234022;
          transition: background .12s, transform .08s;
        }
        .stickymobilebar button:active { transform: scale(.98);}
        .stickymobilebar .wishlist-btn { background: #fff0ee; color: #d13434; border: 1.2px solid #d13434; }
        .stickymobilebar .whatsapp-btn { background: #25d366; color: #fff; }
        @media (min-width: 769px) { .stickymobilebar { display: none !important; } }
      `}</style>
      <button aria-label="Add to Cart" onClick={onAddToCart}>
        Add to Cart
      </button>
      <button
        aria-label="Buy Now"
        onClick={onBuyNow}
        style={{ background: "linear-gradient(92deg, #26d37a 65%, #0C2340 100%)" }}
      >
        Buy Now
      </button>
      <button
        className="wishlist-btn"
        aria-label="Add to Wishlist"
        onClick={onWishlist}
        title="Add to Wishlist"
      >
        <FaHeart size={19} style={{ marginRight: 6, verticalAlign: -3 }} />
        Wishlist
      </button>
      <a
        className="whatsapp-btn"
        aria-label="Chat on WhatsApp"
        href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi, I'm interested in ${product?.name}`)}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          border: "none",
          padding: "0",
          minWidth: 0,
        }}
      >
        <FaWhatsapp size={22} style={{ marginRight: 5, verticalAlign: -3 }} />
        WhatsApp
      </a>
    </div>
  );
}
