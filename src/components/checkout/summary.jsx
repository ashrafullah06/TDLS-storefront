// FILE: src/components/checkout/summary.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useCart } from "@/components/common/cart_context";

const NAVY = "#0F2147";
const MUTED = "#6B7280";
const BORDER = "#DFE3EC"; // align with checkout page

export default function Summary({
  shipping,
  billing,
  methodSelected,
  onPlaceOrder,
  placing = false,
}) {
  const cartCtx = useCart(); // CartProvider – ONLY source of items

  // Optional snapshot from /api/cart (for shipping/tax/grandTotal when available)
  const [cartFallback, setCartFallback] = useState(null);
  const [showMethodWarning, setShowMethodWarning] = useState(false);
  const [inlineError, setInlineError] = useState(""); // written warning on page
  const liveRef = useRef(null);

  // ───────────────────────── helpers ─────────────────────────
  const toNum = (v) => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  const pickFinite = (...vals) => {
    for (const v of vals) {
      const n = toNum(v);
      if (n !== null) return n;
    }
    return null;
  };

  // CartProvider’s canonical server snapshot (from /api/cart/sync etc.)
  const ctxCart = cartCtx?.cart || null;
  const ctxTotals =
    (cartCtx && (cartCtx.totals || cartCtx.cart?.totals)) || null;

  // ───────────────────────── items: MIRROR CART ONLY ─────────────────────────
  const items = useMemo(() => {
    if (!cartCtx) return [];
    if (Array.isArray(cartCtx.items)) return cartCtx.items;
    if (Array.isArray(cartCtx.cart?.items)) return cartCtx.cart.items;
    return [];
  }, [cartCtx]);

  const hasItems = items.length > 0;

  // Stable signature to refresh /api/cart only when cart items meaningfully change
  const itemsSig = useMemo(() => {
    // Keep this conservative and deterministic (no functions/objects)
    return (items || [])
      .map((it) => {
        const id =
          it?.lineId ??
          it?.id ??
          it?.variantId ??
          it?.variant_id ??
          it?.sku ??
          "";
        const qty = Number(it?.quantity ?? it?.qty ?? 0);
        const unit = Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0);
        return `${String(id)}:${Number.isFinite(qty) ? qty : 0}:${
          Number.isFinite(unit) ? unit : 0
        }`;
      })
      .join("|");
  }, [items]);

  // ───────────────────────── fetch backend cart (optional enrichment) ─────────────────────────
  // FIX: refresh only when itemsSig changes (debounced), instead of only on mount.
  useEffect(() => {
    let alive = true;
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;

    const t = setTimeout(async () => {
      try {
        const r = await fetch("/api/cart", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          signal: ac?.signal,
        });

        if (!alive) return;
        if (!r.ok) return; // don't block UI if this fails

        const json = await r.json().catch(() => null);
        if (!alive) return;
        if (!json || typeof json !== "object") return;

        setCartFallback(json);
      } catch (e) {
        // If aborted, do nothing.
        if (ac?.signal?.aborted) return;
        console.error("[Summary] /api/cart error:", e);
        if (alive) setCartFallback(null);
      }
    }, 250); // small debounce to avoid bursts when user updates qty quickly

    return () => {
      alive = false;
      clearTimeout(t);
      try {
        ac?.abort();
      } catch {}
    };
  }, [itemsSig]);

  // Prefer /api/cart totals if present, fall back to context totals
  const serverTotals = useMemo(() => {
    // 1) If /api/cart has a totals object, use that
    if (cartFallback?.totals && typeof cartFallback.totals === "object") {
      return cartFallback.totals;
    }

    // 2) If /api/cart has flat fields, normalize them to a totals shape
    if (cartFallback) {
      const t = {
        subtotal: cartFallback.subtotal,
        discountTotal:
          cartFallback.discountTotal ??
          cartFallback.discount ??
          cartFallback.pricing?.discount,
        taxTotal:
          cartFallback.taxTotal ??
          cartFallback.tax ??
          cartFallback.pricing?.tax,
        shippingTotal:
          cartFallback.shippingTotal ??
          cartFallback.shipping ??
          cartFallback.shipping_price ??
          cartFallback.pricing?.shipping,
        grandTotal:
          cartFallback.grandTotal ??
          cartFallback.total ??
          cartFallback.pricing?.grandTotal,
        total:
          cartFallback.total ??
          cartFallback.grandTotal ??
          cartFallback.pricing?.grandTotal,
        currency:
          cartFallback.currency ?? cartFallback.pricing?.currency ?? "BDT",
      };
      return t;
    }

    // 3) No /api/cart – fall back to context totals if present
    if (ctxTotals) return ctxTotals;
    if (ctxCart?.totals) return ctxCart.totals;

    return null;
  }, [cartFallback, ctxTotals, ctxCart]);

  // ───────────────────────── currency from any source (prefer /api/cart) ─────────────────────────
  const currency = useMemo(() => {
    const c =
      serverTotals?.currency ||
      cartFallback?.currency ||
      cartFallback?.pricing?.currency ||
      cartCtx?.currency ||
      ctxCart?.currency ||
      ctxTotals?.currency;
    return c || "BDT";
  }, [serverTotals, cartFallback, cartCtx, ctxCart, ctxTotals]);

  // ───────────────────────── compute subtotal DIRECTLY from items ─────────────────────────
  const subtotal = useMemo(() => {
    if (!hasItems) return 0;
    let sum = 0;
    for (const it of items) {
      const qtyRaw = Number(it?.quantity ?? it?.qty ?? 0);
      const quantity = Number.isFinite(qtyRaw) ? qtyRaw : 0;

      const unitRaw =
        typeof it?.unitPrice === "number"
          ? it.unitPrice
          : typeof it?.unit_price === "number"
          ? it.unit_price
          : typeof it?.price === "number"
          ? it.price
          : Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0);
      const unitPrice = Number.isFinite(unitRaw) ? unitRaw : 0;

      sum += quantity * unitPrice;
    }
    return Number(sum.toFixed(2));
  }, [items, hasItems]);

  // ───────────────────────── discount / tax / shipping from server (if present) ─────────────────────────
  const rawDiscount = useMemo(
    () =>
      pickFinite(
        serverTotals?.discountTotal,
        serverTotals?.discount,
        cartFallback?.discountTotal,
        cartFallback?.discount,
        cartFallback?.pricing?.discount,
        ctxTotals?.discountTotal,
        ctxTotals?.discount
      ),
    [serverTotals, cartFallback, ctxTotals]
  );
  const discountAbs =
    rawDiscount != null ? Math.max(0, Math.abs(rawDiscount)) : null;

  const tax = useMemo(
    () =>
      pickFinite(
        serverTotals?.taxTotal,
        serverTotals?.tax,
        cartFallback?.taxTotal,
        cartFallback?.tax,
        cartFallback?.pricing?.tax,
        ctxTotals?.taxTotal,
        ctxTotals?.tax
      ),
    [serverTotals, cartFallback, ctxTotals]
  );

  const shippingTotal = useMemo(
    () =>
      pickFinite(
        serverTotals?.shippingTotal,
        serverTotals?.shipping,
        cartFallback?.shippingTotal,
        cartFallback?.shipping,
        cartFallback?.shipping_price,
        cartFallback?.pricing?.shipping,
        ctxTotals?.shippingTotal,
        ctxTotals?.shipping
      ),
    [serverTotals, cartFallback, ctxTotals]
  );

  // ───────────────────────── grand total: ALWAYS recompute from visible math ─────────────────────────
  const grandTotal = useMemo(() => {
    const sub = subtotal != null ? subtotal : 0;
    const disc = discountAbs != null ? discountAbs : 0;
    const ship = shippingTotal != null ? shippingTotal : 0;
    const t = tax != null ? tax : 0;
    return Number((sub - disc + ship + t).toFixed(2));
  }, [subtotal, discountAbs, shippingTotal, tax]);

  // ───────────────────────── address / payment validation ─────────────────────────
  const hasShip = !!shipping;
  const hasBill = !!billing;

  // FIX: content-based equality (ID match is sufficient but not required)
  const sameSB = addressesEqual(shipping, billing);

  const methodOk = methodSelected
    ? methodSelected === "COD"
      ? sameSB
      : true
    : false;

  // Prefer canonical backend cart for ID, fall back to ctxCart
  const baseCart = cartFallback || ctxCart || {};

  // Central validity for CTA & submit
  const blockingIssues = [];
  if (!hasItems) blockingIssues.push("cart");
  if (!hasShip) blockingIssues.push("shipping");
  if (!methodSelected) blockingIssues.push("method");
  if (methodSelected === "COD" && !sameSB) blockingIssues.push("cod-address");

  // CTA only active when everything is OK
  // FIX: use methodOk (redundant but prevents unused + keeps behavior unchanged)
  const canPlace = blockingIssues.length === 0 && methodOk && !placing;

  function announce(msg) {
    if (liveRef.current) liveRef.current.textContent = msg;
  }

  function focusPaymentTiles() {
    const tiles = document.getElementById("payment-tiles");
    if (tiles) {
      tiles.scrollIntoView({ behavior: "smooth", block: "center" });
      tiles.classList.add("pulse-once");
      setTimeout(() => tiles.classList.remove("pulse-once"), 900);
      const focusable = tiles.querySelector("input,button,[role='button']");
      focusable?.focus({ preventScroll: true });
    }
  }

  // ───────────────────────── place order: snapshot with LOCAL items + server fees ─────────────────────────
  async function handlePlaceOrder() {
    // Re-evaluate conditions at click time
    const reasons = [];

    if (!hasItems) {
      reasons.push(
        "Your cart is empty. Please add at least one item before placing order."
      );
    }

    if (!hasShip) {
      reasons.push("Please add a shipping address before placing order.");
    }

    if (!methodSelected) {
      reasons.push("Please select a payment method.");
    }

    if (methodSelected === "COD" && !sameSB) {
      reasons.push(
        "For Cash on Delivery, shipping and billing addresses must be the same."
      );
    }

    if (reasons.length > 0) {
      const message = reasons.join(" ");
      setInlineError(message);
      announce(message);

      // Only scroll to payment section if the issue is about method
      if (!methodSelected || methodSelected === "COD") {
        focusPaymentTiles();
      }

      setShowMethodWarning(!methodSelected);
      return;
    }

    // All required conditions passed
    setInlineError("");
    setShowMethodWarning(false);

    const lines = items.map(toStableLine);

    const snapshotTotals = {
      subtotal,
      discount: discountAbs ?? 0, // positive, amount to subtract
      tax: tax ?? 0,
      shipping: shippingTotal ?? 0,
      total: grandTotal,
      currency,
    };

    const payload = {
      intent: "PLACE_ORDER",
      methodSelected,
      cartId:
        baseCart.id ||
        baseCart.cartId ||
        baseCart.cart_id ||
        baseCart.cart?.id ||
        undefined,
      cartSnapshot: {
        ...snapshotTotals,
        items,
        source: "cart-context",
      },
      lines,
      totals: snapshotTotals,
      address: {
        shipping: shipping || null,
        billing: billing || null,
        sameAsShipping: sameSB,
      },
      ts: Date.now(),
    };

    if (typeof onPlaceOrder === "function") {
      onPlaceOrder(payload);
      return;
    }

    // Fallbacks if no handler passed
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("checkout:place-order", { detail: payload })
        );
      }
    } catch (e) {
      console.error("[Summary] dispatch checkout:place-order failed:", e);
    }
    try {
      if (
        typeof window !== "undefined" &&
        typeof window.__onPlaceOrder === "function"
      ) {
        window.__onPlaceOrder(payload);
      }
    } catch (e) {
      console.error("[Summary] window.__onPlaceOrder failed:", e);
    }
  }

  // ───────────────────────── render ─────────────────────────
  return (
    <div className="card">
      <div className="card-head">Order Review</div>
      <div className="card-body text-[15px]">
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          ref={liveRef}
        />

        {/* Address block */}
        {hasShip || hasBill ? (
          <div className="space-y-3 mb-4">
            {sameSB ? (
              <InlineAddress
                title="Ship & Bill to"
                addr={shipping || billing}
                strong
              />
            ) : (
              <>
                {hasShip ? (
                  <InlineAddress title="Ship to" addr={shipping} strong />
                ) : null}
                {hasBill ? (
                  <InlineAddress title="Bill to (Default)" addr={billing} />
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div
            className="shipto border rounded-xl p-3 mb-4"
            style={{ borderColor: BORDER, background: "#FAFBFF" }}
          >
            <div className="text-[13px]" style={{ color: MUTED }}>
              No address selected yet.
            </div>
          </div>
        )}

        {/* Items panel – always mirror cart_context items, no blocking on /api/cart */}
        <div className="panel">
          <div className="panel-title">Items</div>

          {!hasItems ? (
            <div className="panel-empty">Your cart is empty.</div>
          ) : (
            <ul className="items">
              {items.map((it, idx) => {
                const md = it.metadata || {};

                const title =
                  it.title ||
                  md.productName ||
                  md.variantTitle ||
                  it.productTitle ||
                  it.name ||
                  it.product?.name ||
                  "Item";

                const qtyRaw = Number(it.quantity ?? it.qty ?? 0);
                const quantity = Number.isFinite(qtyRaw) ? qtyRaw : 0;

                const unitRaw =
                  typeof it.unitPrice === "number"
                    ? it.unitPrice
                    : typeof it.unit_price === "number"
                    ? it.unit_price
                    : typeof it.price === "number"
                    ? it.price
                    : Number(it.unitPrice ?? it.unit_price ?? it.price ?? 0);
                const unitPrice = Number.isFinite(unitRaw) ? unitRaw : 0;

                const originalUnit =
                  typeof it.originalUnitPrice === "number"
                    ? it.originalUnitPrice
                    : typeof it.compareAtPrice === "number"
                    ? it.compareAtPrice
                    : Number(
                        it.originalUnitPrice ??
                          it.compareAtPrice ??
                          md.originalUnitPrice ??
                          unitPrice
                      );

                const hasDiscount = originalUnit > unitPrice + 0.0001;

                const lineTotal =
                  typeof it.lineTotal === "number"
                    ? it.lineTotal
                    : typeof it.line_total === "number"
                    ? it.line_total
                    : typeof it.subtotal === "number"
                    ? it.subtotal
                    : quantity * unitPrice;

                const lineSave = hasDiscount
                  ? Math.max(0, (originalUnit - unitPrice) * quantity)
                  : 0;

                const imgRaw =
                  it.image ||
                  it.imageUrl ||
                  it.image_url ||
                  it.thumbnail ||
                  md.image ||
                  md.imageUrl ||
                  md.thumbnail ||
                  md.thumbnailUrl ||
                  it.variant?.media?.[0]?.media?.url ||
                  it.product?.media?.[0]?.media?.url ||
                  it.media?.[0]?.media?.url ||
                  "";
                const img = ABS(imgRaw);
                const showThumb = !!img;

                const size =
                  it.size ||
                  it.options?.size ||
                  md.size ||
                  md.size_name ||
                  md.selectedSize ||
                  "";
                const color =
                  it.color ||
                  it.options?.color ||
                  md.color ||
                  md.colour ||
                  md.color_name ||
                  md.selectedColor ||
                  "";
                const fabric = it.fabric || md.fabric || md.fabricName || "";
                const gsm = it.gsm || md.gsm || md.gsmValue || "";
                const fit = it.fit || md.fit || md.fitName || "";

                const sku =
                  it.sku ||
                  md.sku ||
                  md.skuCode ||
                  it.variant?.sku ||
                  it.product?.sku ||
                  "";
                const barcode =
                  it.barcode ||
                  it.bar_code ||
                  it.ean13 ||
                  it.ean ||
                  md.barcode ||
                  md.barCode ||
                  md.ean13 ||
                  md.ean ||
                  "";

                const pid =
                  it.pid ||
                  it.productId ||
                  it.product_id ||
                  it.product?.id ||
                  md.pid ||
                  md.productId ||
                  "";
                let vid =
                  it.vid ||
                  it.variantId ||
                  it.variant_id ||
                  it.variant?.id ||
                  md.vid ||
                  md.variantId ||
                  "";
                if (pid && vid && String(pid) === String(vid)) {
                  vid = "";
                }

                // FIX: last-resort uniqueness uses idx to prevent duplicate key collisions
                const key =
                  it.lineId ||
                  it.id ||
                  `${it.variantId || it.variant_id || ""}:${sku || barcode || title}:${idx}`;

                return (
                  <li key={key} className="item-row">
                    {showThumb ? (
                      <div className="thumb-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img}
                          alt={title}
                          width={56}
                          height={56}
                          className="thumb"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="thumb-wrap" />
                    )}
                    <div className="item-main">
                      <div className="item-title" title={title}>
                        {title}
                      </div>

                      {/* Attribute grid – only displays what backend / client provided */}
                      <dl className="meta-grid">
                        <dt>Size</dt>
                        <dd>{size}</dd>
                        <dt>Color</dt>
                        <dd>{color}</dd>
                        <dt>Fabric</dt>
                        <dd>{fabric}</dd>
                        <dt>GSM</dt>
                        <dd>{gsm}</dd>
                        <dt>Fit</dt>
                        <dd>{fit}</dd>
                        <dt>SKU</dt>
                        <dd>{sku}</dd>
                        <dt>Barcode</dt>
                        <dd>{barcode}</dd>
                        <dt>PID</dt>
                        <dd>{pid}</dd>
                        <dt>VID</dt>
                        <dd>{vid}</dd>
                      </dl>

                      <div className="item-meta">
                        Qty: {quantity} • Unit:&nbsp;
                        {hasDiscount ? (
                          <>
                            <s className="opacity-70">
                              {money(originalUnit, currency)}
                            </s>
                            &nbsp;
                            <strong>{money(unitPrice, currency)}</strong>
                          </>
                        ) : (
                          <>{money(unitPrice, currency)}</>
                        )}
                      </div>
                      {hasDiscount ? (
                        <div
                          className="text-[12px] font-bold mt-0.5"
                          style={{ color: "#059669" }}
                        >
                          You save {money(lineSave, currency)} on this item
                        </div>
                      ) : null}
                    </div>
                    <div className="item-amt">
                      {money(lineTotal, currency)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Totals – from ITEMS + server fees only */}
        <div className="mt-2 space-y-1 totals-block">
          <Row k="Subtotal" v={money(subtotal, currency)} />
          <Row
            k="Discounts"
            v={
              discountAbs != null && discountAbs > 0
                ? `- ${money(discountAbs, currency)}`
                : money(0, currency)
            }
          />
          {hasItems ? (
            <Row
              k="Shipping"
              v={shippingTotal != null ? money(shippingTotal, currency) : "—"}
            />
          ) : null}
          <Row k="VAT" v={tax != null ? money(tax, currency) : "—"} />
          <hr className="my-3" style={{ borderColor: "#ECEFF6" }} />
          <Row k="Total" v={money(grandTotal, currency)} bold isTotal />
        </div>

        {/* Payment method warning (only when no method selected) */}
        {showMethodWarning && !methodSelected ? (
          <div className="warn mt-4" role="alert">
            Please select a payment method to continue.
          </div>
        ) : null}

        {/* General inline error for any missing condition */}
        {inlineError ? (
          <div className="warn mt-3" role="alert">
            {inlineError}
          </div>
        ) : null}

        <button
          type="button"
          className="w-full mt-9 cta-primary"
          disabled={!canPlace}
          onClick={handlePlaceOrder}
        >
          {placing ? "Placing order..." : "Place Order"}
        </button>

        <p className="hint mt-3 flex items-center gap-5">
          <LockMini /> Secure checkout • Delivery in 3–5 days
        </p>
      </div>

      <style jsx>{`
        .card {
          border: 1px solid ${BORDER};
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 8px 24px rgba(15, 33, 71, 0.06);
        }
        .card-head {
          padding: 16px 18px;
          border-bottom: 1px solid ${BORDER};
          font-weight: 900;
          color: ${NAVY};
        }
        .card-body {
          padding: 16px;
        }

        .panel {
          border: 1px solid ${BORDER};
          border-radius: 16px;
          background: #fff;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .panel-title {
          padding: 10px 14px;
          border-bottom: 1px solid #eef2f7;
          background: #f4f7fd;
          color: ${NAVY};
          font-weight: 900;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-size: 12px;
        }
        .panel-empty {
          padding: 14px;
          color: ${MUTED};
          font-size: 14px;
        }

        .items {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .item-row {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 25px;
          align-items: center;
          padding: 12px 14px;
          border-top: 1px solid #eef2f7;
        }
        .item-row:first-child {
          border-top: 0;
        }

        .thumb-wrap {
          flex: 0 0 auto;
        }
        .thumb {
          display: block;
          width: 56px;
          height: 56px;
          object-fit: cover;
          border-radius: 10px;
          border: 1px solid #eef2f7;
          background: #fff;
        }

        .item-main {
          min-width: 0;
        }
        .item-title {
          color: #111827;
          font-weight: 750;
          font-size: 18px;
          line-height: 1.2;
          word-break: break-word;
        }

        .meta-grid {
          display: grid;
          grid-template-columns: 90px 1fr;
          gap: 6px 12px;
          margin-top: 6px;
        }
        .meta-grid dt {
          color: ${NAVY};
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.02em;
        }
        .meta-grid dd {
          color: ${MUTED};
          font-size: 12px;
          font-weight: 700;
          margin: 0;
          min-height: 1em;
        }

        .item-meta {
          margin-top: 2px;
          color: ${MUTED};
          font-size: 12px;
        }
        .item-amt {
          color: #111827;
          font-weight: 900;
          white-space: nowrap;
          font-size: 15px;
        }

        .addr-card {
          position: relative;
          border: 1px solid ${BORDER};
          border-radius: 16px;
          background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%);
          padding: 16px 16px 16px 46px;
          box-shadow: 0 6px 18px rgba(15, 33, 71, 0.06);
        }
        .addr-card::before {
          content: "";
          position: absolute;
          left: 12px;
          top: 12px;
          bottom: 12px;
          width: 6px;
          border-radius: 999px;
          background: #1e3a8a;
          opacity: 0.9;
        }
        .addr-head {
          display: flex;
          align-items: center;
          gap: 18px;
          color: ${NAVY};
          font-weight: 900;
          letter-spacing: 0.02em;
        }
        .addr-title {
          font-size: 13px;
          opacity: 0.95;
          font-weight: 900;
        }
        .addr-title-strong {
          font-size: 14px;
        }

        .addr-name {
          color: ${NAVY};
          line-height: 1.18;
          font-weight: 800;
        }
        .addr-name-strong {
          font-size: 21px;
        }
        .addr-name-normal {
          font-size: 17px;
        }

        .addr-lines {
          color: ${NAVY};
        }
        .addr-lines-strong {
          font-size: 16px;
        }
        .addr-lines-normal {
          font-size: 15px;
        }

        .addr-line {
          font-weight: 800;
        }
        .addr-meta {
          color: ${MUTED};
          font-size: 13px;
          font-weight: 800;
        }

        .totals-block {
          margin-bottom: 16px;
        }
        .grand-total {
          color: ${NAVY};
          font-weight: 800;
          font-size: 26px;
          line-height: 1.15;
        }

        .cta-primary {
          background: ${NAVY};
          color: #fff;
          border-radius: 9999px;
          padding: 12px 16px;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.25),
            0 10px 24px rgba(11, 28, 63, 0.35),
            0 2px 4px rgba(11, 28, 63, 0.2);
          font-weight: 800;
        }
        .cta-primary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .warn {
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
          padding: 10px 12px;
          border-radius: 12px;
          font-weight: 800;
        }

        :global(#payment-tiles.pulse-once) {
          animation: pulseBorder 0.8s ease-in-out 1;
        }
        @keyframes pulseBorder {
          0% {
            box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.12);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
          }
        }

        @media (max-width: 480px) {
          .item-row {
            grid-template-columns: 56px 1fr auto;
          }
          .addr-name-strong {
            font-size: 20px;
          }
          .grand-total {
            font-size: 24px;
          }
        }
      `}</style>
    </div>
  );
}

/* ===== subcomponents & helpers ===== */

function InlineAddress({ title, addr, strong = false }) {
  const titleCls = `addr-title ${strong ? "addr-title-strong" : ""}`;
  const nameCls = `addr-name ${
    strong ? "addr-name-strong" : "addr-name-normal"
  }`;
  const linesCls = `addr-lines ${
    strong ? "addr-lines-strong" : "addr-lines-normal"
  }`;

  const phoneEmail = lineJoin(
    [addr?.phone, addr?.email && String(addr.email).toLowerCase()],
    " • ",
    true
  );

  return (
    <div className="addr-card" role="group" aria-label={title}>
      <div className="addr-head">
        <LocationPin aria-hidden="true" />
        <div className={titleCls}>{title}</div>
      </div>

      <div className="mt-1.5">
        <div className={nameCls}>{lineJoin([addr?.name], " • ")}</div>
        {phoneEmail ? (
          <div className="addr-meta mt-0.5">{phoneEmail}</div>
        ) : null}
        <div className={`${linesCls} mt-1`}>{renderAddress(addr)}</div>
      </div>
    </div>
  );
}

function LocationPin(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={NAVY} {...props}>
      <path d="M12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" />
    </svg>
  );
}

function addressesEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  // If IDs match, it's definitely the same record.
  if (a.id && b.id && String(a.id) === String(b.id)) return true;

  // FIX: compare physical address content; do NOT block COD because
  // phone/email/name differ or because IDs differ.
  const norm = (x) =>
    [
      x.line1 || x.address1,
      x.line2 || x.address2,
      x.upazila || x.city,
      x.district || x.state,
      x.postalCode,
      (x.countryIso2 || x.country || "").toString().toUpperCase(),
    ]
      .map((v) => String(v ?? "").trim().toLowerCase())
      .join("|");

  return norm(a) === norm(b);
}

function Row({ k, v, bold, isTotal }) {
  const labelCls = bold
    ? "font-extrabold text-[19px]"
    : "font-bold text-[16px]";
  const valueCls = bold
    ? "font-extrabold text-[22px]"
    : "font-bold text-[18px]";
  return (
    <div className="flex items-baseline justify-between">
      <div className={labelCls}>{k}</div>
      <div className={valueCls}>
        {isTotal ? <span className="grand-total">{v}</span> : v}
      </div>
    </div>
  );
}

function renderAddress(a) {
  const line1 = lineJoin(
    [
      a?.houseName,
      a?.houseNo,
      a?.apartmentNo,
      a?.floorNo,
      a?.line1 || a?.address1,
    ],
    ", "
  );
  const line2 = lineJoin(
    [a?.village, a?.postOffice, a?.union, a?.policeStation],
    ", "
  );
  const line3 = lineJoin(
    [
      a?.upazila || a?.city,
      a?.district || a?.state,
      a?.postalCode,
      (a?.countryIso2 || a?.country || "").toString().toUpperCase(),
    ],
    ", "
  );
  return (
    <>
      <div className="addr-line">{line1 || "—"}</div>
      {line2 ? <div className="addr-line">{line2}</div> : null}
      <div className="addr-line">{line3 || "—"}</div>
    </>
  );
}

function lineJoin(arr, sep = ", ", skipFalsy = false) {
  const parts = (arr || [])
    .map((v) => v ?? "")
    .filter((v) => (skipFalsy ? Boolean(v) : true))
    .map((v) => String(v).trim())
    .filter(Boolean);
  return parts.join(sep);
}

function money(nVal, currency = "BDT") {
  const x = Number(nVal || 0);
  if (!Number.isFinite(x)) return "৳ 0.00";
  if (currency === "BDT") {
    return `৳ ${x.toFixed(2)}`;
  }
  return `${currency} ${x.toFixed(2)}`;
}

function LockMini() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={NAVY}
      aria-hidden="true"
    >
      <path d="M6 10V7a6 6 0 1112 0v3h1a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2h1zm2 0h8V7a4 4 0 10-8 0v3z" />
    </svg>
  );
}

function toStableLine(it) {
  const qtyRaw = Number(it?.quantity ?? it?.qty ?? 0);
  const quantity = Number.isFinite(qtyRaw) ? qtyRaw : 0;

  const unitRaw =
    typeof it?.unitPrice === "number"
      ? it.unitPrice
      : typeof it?.unit_price === "number"
      ? it.unit_price
      : typeof it?.price === "number"
      ? it.price
      : Number(it?.unitPrice ?? it?.unit_price ?? it?.price ?? 0);
  const unitPrice = Number.isFinite(unitRaw) ? unitRaw : 0;

  return {
    id: it?.id ?? null,
    lineId: it?.lineId ?? undefined,
    variantId: it?.variantId ?? it?.variant_id ?? null,
    sku: it?.sku ?? it?.metadata?.sku ?? null,
    title:
      it?.title ??
      it?.metadata?.productName ??
      it?.metadata?.variantTitle ??
      it?.productTitle ??
      it?.name ??
      null,
    quantity,
    unitPrice,
    metadata: it?.metadata ?? undefined,
    pid:
      it?.pid ??
      it?.productId ??
      it?.product_id ??
      it?.metadata?.pid ??
      it?.metadata?.productId ??
      undefined,
    vid:
      it?.vid ??
      it?.variantId ??
      it?.variant_id ??
      it?.metadata?.vid ??
      it?.metadata?.variantId ??
      undefined,
  };
}

function ABS(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const base =
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.STRAPI_API_URL ||
    "";
  return base
    ? `${base.replace(/\/+$/, "")}${u.startsWith("/") ? "" : "/"}${u}`
    : u;
}
