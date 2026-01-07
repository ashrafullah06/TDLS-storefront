// src/components/common/floatingsharebuttons.jsx
"use client";

import React from "react";

/**
 * Minimal change:
 * - Removed window.location usage (causes SSR/CSR mismatch).
 * - Build a stable URL using env + product.slug.
 *   - If NEXT_PUBLIC_SITE_URL is set (recommended), it makes an absolute URL.
 *   - Otherwise, falls back to a relative /product/<slug> (still stable on SSR & CSR).
 * No UI change, no other logic change.
 */
export default function FloatingShareButtons({ product }) {
  const title = `Check out this product: ${product?.name || ""}`;

  // Prefer absolute site URL if provided; otherwise use a stable relative path.
  const base =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SITE_URL
      ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "")
      : "") || "";

  const path =
    product?.slug ? `/product/${encodeURIComponent(product.slug)}` : "";

  // Stable on both server and client:
  const url = base ? `${base}${path}` : path;

  const waHref = `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`;
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

  return (
    <div
      style={{
        position: "fixed",
        top: "42%",
        right: 6,
        zIndex: 8001,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <a
        href={waHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on WhatsApp"
        style={{ background: "#25d366", color: "#fff", borderRadius: 20, padding: 8, fontWeight: 900 }}
      >
        WA
      </a>

      <a
        href={fbHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Facebook"
        style={{ background: "#1778f2", color: "#fff", borderRadius: 20, padding: 8, fontWeight: 900 }}
      >
        Fb
      </a>

      <a
        href={xHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on Twitter"
        style={{ background: "#1da1f2", color: "#fff", borderRadius: 20, padding: 8, fontWeight: 900 }}
      >
        X
      </a>
    </div>
  );
}
