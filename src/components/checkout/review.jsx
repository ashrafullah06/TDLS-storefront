// FILE: my-project/src/components/checkout/review.jsx
"use client";

/**
 * Review (read-only, airy)
 * - Bigger fonts for item names and amounts (desktop preserved)
 * - Address fields aligned to normalized keys
 * - Shows product thumbnails with decent spacing (no text starting at extreme left)
 * - Compatible with existing cart sources (/lib/cart-source, /api/cart, localStorage)
 * - No unrelated logic removed
 *
 * Update in this revision:
 * - Desktop look/structure preserved.
 * - Mobile/small screens: adaptive sizing (CTA, font, spacing), safe-area padding,
 *   and strict no-horizontal-overflow behavior (portrait + landscape).
 */

import React, { useEffect, useMemo, useState } from "react";

const NAVY = "#0B1C3F";
const BORDER = "#E8ECF4";
const TEXT = "#111827";
const MUTED = "#6B7280";

/* ───────────────── small utils ───────────────── */
const money = (n) => `৳ ${Number(n || 0).toFixed(2)}`;
const safeUUID =
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? () => crypto.randomUUID()
    : () => `id_${Math.random().toString(36).slice(2)}_${Date.now()}`);

function sum(arr) {
  return arr.reduce((a, b) => a + Number(b || 0), 0);
}

function pickImage(it) {
  return (
    it.image ||
    it.thumbnail ||
    it.variant?.media?.[0]?.url ||
    it.product?.media?.[0]?.url ||
    it.media?.[0]?.url ||
    "/placeholder.png"
  );
}

/* ───────────────── component ───────────────── */
export default function Review({ onContinue, shipping }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const snap = await getCartSnapshot();
      if (mounted) {
        setCart(snap);
        setLoading(false);
      }
    })();

    const onChange = async () => {
      const s = await getCartSnapshot();
      setCart(s);
    };
    if (typeof window !== "undefined")
      window.addEventListener("cart:changed", onChange);

    return () => {
      if (typeof window !== "undefined")
        window.removeEventListener("cart:changed", onChange);
      mounted = false;
    };
  }, []);

  const items = cart?.items || [];
  const totals = useMemo(() => {
    const subtotal = sum(
      items.map((it) => (Number(it.quantity) || 1) * (Number(it.price) || 0))
    );
    const discount = Number(cart?.discount || 0);
    const tax = Number(cart?.tax || 0);
    // Shipping can be injected from server later; keep 0 if not available
    const shippingTotal = Number(cart?.shippingTotal || 0);
    const grandTotal = subtotal - discount + tax + shippingTotal;
    return { subtotal, discount, tax, shippingTotal, grandTotal };
  }, [cart?.discount, cart?.tax, cart?.shippingTotal, items]);

  // Normalize the incoming shipping object for display (accepts multiple key styles)
  const ship = normalizeAddress(shipping);

  return (
    <div className="review-wrap">
      {/* Deliver to */}
      {ship ? (
        <div className="panel">
          <div className="panel-head">Deliver to</div>
          <div className="panel-body">
            <div className="ship-name">{ship.name}</div>
            {ship.address1 || ship.address2 ? (
              <div className="ship-line">
                {[ship.address1, ship.address2].filter(Boolean).join(", ")}
              </div>
            ) : null}
            {ship.city || ship.state || ship.postalCode ? (
              <div className="ship-line">
                {[[ship.city, ship.state].filter(Boolean).join(", "), ship.postalCode]
                  .filter(Boolean)
                  .join(" • ")}
              </div>
            ) : null}
            {ship.phone ? <div className="ship-phone">{ship.phone}</div> : null}
          </div>
        </div>
      ) : null}

      {/* Items */}
      <div className="panel no-overflow">
        <div className="panel-section-title">Items</div>

        {loading ? (
          <div className="loading">Loading…</div>
        ) : items.length ? (
          <ul className="items">
            {items.map((it) => {
              const id = it.id || it.lineId || it.variantId || it.sku || safeUUID();
              const title = it.title || it.name || it.productTitle || "Item";
              const qty = Number(it.quantity ?? it.qty ?? 1);
              const unit = Number(it.price ?? it.unitPrice ?? 0);
              const line = qty * unit;
              const img = pickImage(it);

              return (
                <li key={id} className="item">
                  <div className="thumb-wrap">
                    <img
                      src={img}
                      alt={title}
                      width={84}
                      height={84}
                      className="thumb"
                      loading="lazy"
                    />
                  </div>

                  <div className="item-main">
                    <div className="item-title" title={title}>
                      {title}
                    </div>
                    <div className="item-meta">
                      Qty: {qty} • Unit: {money(unit)}
                    </div>
                  </div>

                  <div className="item-total">{money(line)}</div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="loading">Your cart is empty.</div>
        )}
      </div>

      {/* Totals */}
      <div className="panel">
        <Row label="Subtotal" value={money(totals.subtotal)} />
        <Row label="Discount" value={`- ${money(totals.discount)}`} />
        <Row label="VAT" value={money(totals.tax)} />
        <Row label="Shipping" value={money(totals.shippingTotal)} />
        <div className="total-row">
          <div className="total-k">Total</div>
          <div className="total-v">
            <span className="grand-total">{money(totals.grandTotal)}</span>
          </div>
        </div>
      </div>

      <div className="cta-row">
        <PrimaryCTA onClick={onContinue} disabled={!items.length}>
          Continue to payment
        </PrimaryCTA>
      </div>

      <style jsx>{`
        /* Desktop preserved: do not change baseline layout/typography here. */
        .review-wrap {
          display: grid;
          gap: 24px;

          /* Hard guardrails against horizontal overflow on any device. */
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow-x: clip;
          padding-bottom: 4px;
        }

        .panel {
          border: 1px solid ${BORDER};
          border-radius: 16px;
          background: #fff;
          padding: 16px;

          width: 100%;
          max-width: 100%;
          min-width: 0;
        }
        .no-overflow {
          overflow: hidden;
        }

        .panel-head {
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.02em;
          color: ${NAVY};
        }
        .panel-body {
          margin-top: 8px;
          color: ${TEXT};
          padding-left: 2px; /* ensure text not glued to left edge */
          min-width: 0;
        }

        .ship-name {
          font-size: 15px;
          font-weight: 700;
          color: ${TEXT};
          overflow-wrap: anywhere;
        }
        .ship-line {
          margin-top: 4px;
          font-size: 14px;
          color: ${TEXT};
          overflow-wrap: anywhere;
        }
        .ship-phone {
          margin-top: 6px;
          font-size: 13px;
          color: ${MUTED};
          overflow-wrap: anywhere;
        }

        .panel-section-title {
          padding: 12px 16px;
          margin: -16px -16px 0 -16px; /* full-bleed header bar */
          border-bottom: 1px solid #eef2f7;
          background: #f4f7fd;
          color: ${NAVY};
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .loading {
          padding: 20px;
          font-size: 14px;
          color: ${MUTED};
        }

        .items {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .item {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 14px;
          padding: 16px;
          border-top: 1px solid #eef2f7;
          min-width: 0; /* critical for grid overflow control */
        }
        .item:first-child {
          border-top: 0;
        }

        .thumb-wrap {
          flex: 0 0 auto;
          min-width: 0;
        }
        .thumb {
          border-radius: 12px;
          border: 1px solid #eef2f7;
          display: block;
          background: #fff;
        }

        .item-main {
          min-width: 0;
        }
        .item-title {
          font-size: 18px;
          font-weight: 800;
          color: ${TEXT};
          line-height: 1.2;

          /* safer wrapping on narrow screens without affecting desktop readability */
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .item-meta {
          margin-top: 4px;
          font-size: 12px;
          color: ${MUTED};
          overflow-wrap: anywhere;
        }

        .item-total {
          font-size: 20px;
          font-weight: 900;
          color: ${TEXT};
          align-self: center;
          white-space: nowrap;
          max-width: 100%;
        }

        .total-row {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #eef2f7;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
        }
        .total-k {
          font-size: 20px;
          font-weight: 900;
          color: ${NAVY};
        }
        .total-v {
          font-size: 20px;
          font-weight: 900;
          color: ${NAVY};
          min-width: 0;
        }
        .grand-total {
          display: inline-block;
          max-width: 100%;
          overflow-wrap: anywhere;
        }

        .cta-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding-bottom: 2px;
        }

        /* ─────────────────────────────────────────────────────────────
           Mobile + small devices (Android/iOS) — smaller CTAs/text, no overflow
           Desktop/tablet look remains intact (baseline rules above).
        ───────────────────────────────────────────────────────────── */
        @media (max-width: 640px) {
          .review-wrap {
            gap: 14px;
            padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
          }

          .panel {
            border-radius: 14px;
            padding: 12px;
          }

          .panel-section-title {
            padding: 10px 12px;
            margin: -12px -12px 0 -12px;
            font-size: 12px;
            letter-spacing: 0.06em;
          }

          .panel-head {
            font-size: 12px;
          }

          .ship-name {
            font-size: 14px;
          }
          .ship-line {
            font-size: 13px;
          }
          .ship-phone {
            font-size: 12px;
          }

          .loading {
            padding: 16px 12px;
            font-size: 13px;
          }

          .item {
            grid-template-columns: 64px 1fr auto;
            gap: 10px;
            padding: 12px;
          }

          .thumb {
            width: 64px;
            height: 64px;
            object-fit: cover;
          }

          .item-title {
            font-size: 14px;
            line-height: 1.25;
          }
          .item-meta {
            font-size: 11px;
          }
          .item-total {
            font-size: 14px;
          }

          .total-k,
          .total-v {
            font-size: 16px;
          }
        }

        /* Ultra-small widths: stack the price under content to prevent squeeze/overflow. */
        @media (max-width: 380px) {
          .item {
            grid-template-columns: 56px 1fr;
            grid-template-rows: auto auto;
          }
          .thumb {
            width: 56px;
            height: 56px;
          }
          .item-total {
            grid-column: 2 / -1;
            justify-self: start;
            align-self: start;
            margin-top: 6px;
            font-size: 14px;
            white-space: normal;
          }
        }

        /* Landscape phones: reduce vertical padding so the page feels compact. */
        @media (max-width: 860px) and (orientation: landscape) {
          .review-wrap {
            gap: 12px;
          }
          .panel {
            padding: 10px;
          }
          .panel-section-title {
            padding: 8px 10px;
            margin: -10px -10px 0 -10px;
          }
          .item {
            padding: 10px;
          }
        }
      `}</style>
    </div>
  );
}

/* ---------- helpers (browser + API fallbacks) ---------- */
async function getCartSnapshot() {
  // 1) Try internal module if present
  try {
    const mod = await import("@/lib/cart-source").catch(() => null);
    if (mod?.readCartSnapshot) {
      const s = await mod.readCartSnapshot();
      if (s && Array.isArray(s.items)) return normalizeSnap(s);
    }
  } catch {}

  // 2) Try API
  try {
    const r = await fetch("/api/cart", { credentials: "include", cache: "no-store" });
    if (r.ok) {
      const s = await r.json();
      if (s && Array.isArray(s.items)) return normalizeSnap(s);
    }
  } catch {}

  // 3) Try localStorage
  try {
    const raw = localStorage.getItem("cart");
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.items)) return normalizeSnap(s);
    }
  } catch {}

  return { items: [], subtotal: 0, discount: 0, tax: 0, shippingTotal: 0, grandTotal: 0 };
}

function normalizeSnap(s) {
  const items = (s.items || []).map((it) => ({
    id: it.id || it.lineId || it.variantId || it.sku || safeUUID(),
    title: it.title || it.name || it.productTitle || "Item",
    quantity: Number(it.quantity ?? it.qty ?? 1),
    price: Number(it.price ?? it.unitPrice ?? 0),
    image: pickImage(it),
    variant: it.variant,
    product: it.product,
  }));
  const subtotal = items.reduce((a, b) => a + b.quantity * b.price, 0);
  const discount = Number(s.discount || s.discountTotal || 0);
  const tax = Number(s.tax || s.taxTotal || 0);
  const shippingTotal = Number(s.shippingTotal || 0);
  const grandTotal = Number(s.grandTotal ?? subtotal - discount + tax + shippingTotal);
  return { items, subtotal, discount, tax, shippingTotal, grandTotal };
}

function normalizeAddress(a) {
  if (!a) return null;
  const out = {
    name: a.name || a.fullName || "",
    phone: a.phone || a.mobile || "",
    email: a.email || "",
    address1: a.address1 || a.line1 || a.streetAddress || "",
    address2: a.address2 || a.line2 || "",
    city: a.city || a.upazila || "",
    state: a.state || a.district || "",
    postalCode: a.postalCode || a.postcode || "",
    countryIso2: (a.countryIso2 || a.country || "BD").toString().toUpperCase(),
  };
  // if all empty, return null to avoid rendering empty panel
  const hasAny = Object.values(out).some((v) => !!v);
  return hasAny ? out : null;
}

/* ---------- UI atoms ---------- */
function Row({ label, value }) {
  return (
    <div className="row">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <style jsx>{`
        .row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          padding: 4px 2px;
          gap: 12px;
          min-width: 0;
        }
        .k {
          font-size: 16px;
          font-weight: 700;
          color: ${TEXT};
          overflow-wrap: anywhere;
        }
        .v {
          font-size: 18px;
          font-weight: 900;
          color: ${TEXT};
          overflow-wrap: anywhere;
          text-align: right;
        }

        /* Mobile-only downsizing; desktop unchanged. */
        @media (max-width: 640px) {
          .k {
            font-size: 13px;
          }
          .v {
            font-size: 14px;
          }
        }
      `}</style>
    </div>
  );
}

function PrimaryCTA({ children, ...props }) {
  const style = {
    background: NAVY,
    color: "#fff",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,.25), 0 10px 24px rgba(11,28,63,.35), 0 2px 4px rgba(11,28,63,.2)",
    borderRadius: "999px",
  };

  return (
    <>
      <button
        {...props}
        className="cta px-7 py-3 font-semibold transition transform active:scale-[.99] hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
        style={style}
      >
        {children}
      </button>

      <style jsx>{`
        /* Desktop preserved by default classes above. Mobile only overrides below. */
        .cta {
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          max-width: 100%;
        }

        @media (max-width: 640px) {
          .cta {
            padding: 10px 16px; /* smaller CTA on compact screens */
            font-size: 13px;
            letter-spacing: 0.01em;
          }
        }

        @media (max-width: 380px) {
          .cta {
            padding: 9px 14px;
            font-size: 12.5px;
          }
        }

        @media (max-width: 860px) and (orientation: landscape) {
          .cta {
            padding: 9px 14px;
            font-size: 12.5px;
          }
        }
      `}</style>
    </>
  );
}
