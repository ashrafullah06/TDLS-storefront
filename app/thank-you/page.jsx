"use client";

/**
 * Thank You page (App Router)
 *
 * URL shape we expect:
 *   /thank-you?order=<orderId>&paid=<0|1>
 *
 * Behavior:
 *  - Reads orderId & paid from query.
 *  - Best-effort fetch of order summary (tries a few common endpoints).
 *  - Shows friendly success banner:
 *      - COD (paid=0): "Payment pending — Cash on Delivery"
 *      - Prepaid (paid=1): "Payment received"
 *  - Renders items (image, title, qty, price) if data is available.
 *  - Shows totals and quick links (View order, Continue shopping, Print invoice).
 *
 * NOTE: No new APIs are required. If your project exposes a different
 *       order read endpoint, add it in `candidateEndpoints`.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/common/navbar";
import Bottomfloatingbar from "@/components/common/bottomfloatingbar";

const NAVY = "#0f2147";
const BORDER = "#E6EAF4";
const SUBTEXT = "#6F7890";

export default function ThankYouPage() {
  const params = useSearchParams();
  const orderId = params.get("order") || "";
  const paidFlag = params.get("paid"); // "0" | "1" | null
  const isPaid = paidFlag === "1";

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  // Try multiple likely endpoints; ignore failures gracefully.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!orderId) {
        setLoading(false);
        return;
      }

      const candidateEndpoints = [
        `/api/orders/${encodeURIComponent(orderId)}`,
        `/api/order?id=${encodeURIComponent(orderId)}`,
        `/api/orders/summary?orderId=${encodeURIComponent(orderId)}`,
      ];

      let hydrated = null;

      for (const url of candidateEndpoints) {
        try {
          const r = await fetch(url, { cache: "no-store", credentials: "include" });
          if (r.ok) {
            const data = await r.json();
            hydrated = normalizeOrder(data);
            break;
          }
        } catch {
          // ignore; try next
        }
      }

      if (!cancelled) {
        setOrder(hydrated);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const banner = useMemo(() => {
    if (!orderId) {
      return {
        title: "Order received",
        sub: "We’ve saved your order. You can review details below.",
        tone: "neutral",
      };
    }
    if (isPaid) {
      return {
        title: "Payment received — order confirmed",
        sub: "Thank you! Your payment was successful and your order is confirmed.",
        tone: "success",
      };
    }
    return {
      title: "Order confirmed — Cash on Delivery",
      sub: "Your order is confirmed. Payment will be collected in cash upon delivery.",
      tone: "cod",
    };
  }, [orderId, isPaid]);

  function money(n) {
    const x = Number(n || 0);
    return `৳ ${x.toFixed(2)}`;
  }

  function toneStyles(tone) {
    if (tone === "success") {
      return {
        bg: "#ECFDF5",
        text: "#065F46",
        border: "#A7F3D0",
      };
    }
    if (tone === "cod") {
      return {
        bg: "#FEF3C7",
        text: "#92400E",
        border: "#FDE68A",
      };
    }
    return {
        bg: "#F3F4F6",
        text: "#111827",
        border: "#E5E7EB",
    };
  }

  const t = toneStyles(banner.tone);

  const items = order?.items || [];
  const totals = order?.totals || {
    subtotal: order?.subtotal ?? 0,
    discountTotal: order?.discountTotal ?? 0,
    taxTotal: order?.taxTotal ?? 0,
    shippingTotal: order?.shippingTotal ?? 0,
    grandTotal: order?.grandTotal ?? order?.total ?? 0,
  };

  const orderNumber = order?.orderNumber || order?.number || orderId;

  return (
    <div className="bg-[#FAFBFF] min-h-[100dvh]">
      <Navbar />

      <main className="mx-auto" style={{ maxWidth: 1100, padding: "calc(var(--nav-h,80px) + 18px) 20px 80px" }}>
        {/* Banner */}
        <div
          className="rounded-xl p-4 mb-6"
          style={{ background: t.bg, color: t.text, border: `1px solid ${t.border}` }}
        >
          <div className="text-lg font-bold">
            {banner.title}
          </div>
          <div className="text-sm mt-1">
            {banner.sub}
          </div>
          {orderNumber ? (
            <div className="text-sm mt-1 opacity-80">
              Order no: <span className="font-semibold">{orderNumber}</span>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8">
          {/* Left: order details */}
          <div className="space-y-8">
            {/* Items */}
            <section
              className="rounded-xl overflow-hidden"
              style={{ border: `1px solid ${BORDER}`, background: "#fff" }}
            >
              <div className="px-3 py-2 border-b font-semibold" style={{ borderColor: BORDER, color: NAVY }}>
                Items
              </div>
              {loading ? (
                <div className="p-4 text-sm" style={{ color: SUBTEXT }}>Loading order…</div>
              ) : items.length ? (
                <div className="divide-y" style={{ borderColor: BORDER }}>
                  {items.map((it, idx) => {
                    const img =
                      it.image ||
                      it.thumbnail ||
                      it.variant?.media?.[0]?.url ||
                      it.product?.media?.[0]?.url ||
                      "/placeholder.png";
                    const title = it.title || it.productTitle || "Item";
                    const sku = it.sku || it.variantSku || "";
                    const qty = Number(it.quantity || it.qty || 1);
                    const unit = Number(it.unitPrice || it.price || 0);
                    const line = Number(it.total || it.subtotal || unit * qty || 0);
                    return (
                      <div key={it.id || idx} className="p-3 flex items-start gap-3">
                        <img
                          src={img}
                          alt={title}
                          width={64}
                          height={64}
                          className="rounded-md border"
                          style={{ borderColor: BORDER }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium" style={{ color: "#111827" }}>
                            {title}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: SUBTEXT }}>
                            {sku ? `SKU: ${sku}` : null}
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: SUBTEXT }}>
                            Qty: {qty} • Unit: {money(unit)}
                          </div>
                        </div>
                        <div className="text-sm font-semibold" style={{ color: "#111827" }}>
                          {money(line)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 text-sm" style={{ color: SUBTEXT }}>
                  We couldn’t load your items, but your order has been saved.
                </div>
              )}
            </section>

            {/* Shipping address (if available) */}
            {order?.shipping ? (
              <section
                className="rounded-xl p-3"
                style={{ border: `1px solid ${BORDER}`, background: "#fff" }}
              >
                <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>
                  Delivery address
                </div>
                <div className="text-sm" style={{ color: "#111827" }}>
                  <div>{order.shipping.name}</div>
                  <div>{[order.shipping.line1, order.shipping.line2].filter(Boolean).join(", ")}</div>
                  <div>
                    {[
                      [order.shipping.city, order.shipping.state].filter(Boolean).join(", "),
                      order.shipping.postalCode,
                      order.shipping.countryIso2 || order.shipping.country,
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                  <div className="mt-1" style={{ color: SUBTEXT }}>
                    {order.shipping.phone}
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          {/* Right: totals & actions */}
          <aside className="lg:sticky lg:top-[calc(var(--nav-h,80px)+16px)] space-y-4">
            <section
              className="rounded-xl p-3"
              style={{ border: `1px solid ${BORDER}`, background: "#fff" }}
            >
              <Row label="Subtotal" value={money(totals.subtotal)} />
              <Row label="Discount" value={`- ${money(totals.discountTotal)}`} />
              <Row label="Tax/VAT" value={money(totals.taxTotal)} />
              <Row label="Shipping" value={money(totals.shippingTotal)} />
              <div className="mt-2 pt-2 border-t flex items-center justify-between" style={{ borderColor: BORDER }}>
                <div className="text-sm font-bold" style={{ color: NAVY }}>Total</div>
                <div className="text-sm font-bold" style={{ color: NAVY }}>
                  {money(totals.grandTotal)}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full rounded-md px-4 py-2 font-semibold"
                  style={{ border: `1px solid ${NAVY}`, color: NAVY }}
                >
                  Print invoice
                </button>

                <a
                  href={orderId ? `/customer/orders/${encodeURIComponent(orderId)}` : "/customer/orders"}
                  className="block text-center rounded-md px-4 py-2 font-semibold"
                  style={{ background: NAVY, color: "#fff" }}
                >
                  {orderId ? "View order" : "Go to my orders"}
                </a>

                <a
                  href="/"
                  className="block text-center rounded-md px-4 py-2 font-semibold"
                  style={{ border: `1px solid ${BORDER}`, color: "#111827", background: "#fff" }}
                >
                  Continue shopping
                </a>
              </div>

              {!isPaid ? (
                <p className="text-xs mt-3" style={{ color: SUBTEXT }}>
                  Payment status: <strong>Pending (Cash on Delivery)</strong>
                </p>
              ) : (
                <p className="text-xs mt-3" style={{ color: SUBTEXT }}>
                  Payment status: <strong>Paid</strong>
                </p>
              )}
            </section>
          </aside>
        </div>
      </main>

      <Bottomfloatingbar />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div style={{ color: "#111827" }}>{label}</div>
      <div style={{ color: "#111827" }}>{value}</div>
    </div>
  );
}

/* ---------- helpers ---------- */

function normalizeOrder(raw) {
  // Attempt to map various possible shapes to a consistent local structure.
  if (!raw || typeof raw !== "object") return null;

  const items =
    raw.items ||
    raw.lines ||
    raw.orderItems ||
    [];

  const mappedItems = items.map((it) => ({
    id: it.id,
    title: it.title || it.productTitle || it.variant?.title || "Item",
    sku: it.sku || it.variant?.sku || "",
    quantity: it.quantity || it.qty || 1,
    unitPrice: it.unitPrice || it.price || 0,
    subtotal: it.subtotal || (Number(it.unitPrice || it.price || 0) * Number(it.quantity || it.qty || 1)),
    image: it.image || it.thumbnail || it.variant?.media?.[0]?.url || it.product?.media?.[0]?.url,
  }));

  const shipping = raw.shipping || raw.shippingAddress || {
    name: raw?.customerName,
    phone: raw?.customerPhone,
    email: raw?.customerEmail,
    line1: raw?.address1,
    line2: raw?.address2,
    city: raw?.city,
    state: raw?.state || raw?.upazila,
    postalCode: raw?.postalCode || raw?.postcode,
    countryIso2: raw?.countryIso2 || raw?.country,
  };

  return {
    id: raw.id || raw.orderId,
    orderNumber: raw.orderNumber || raw.number || raw.no,
    currency: raw.currency || "BDT",
    paymentStatus: raw.paymentStatus,
    fulfillmentStatus: raw.fulfillmentStatus,
    items: mappedItems,
    shipping,
    subtotal: raw.subtotal,
    discountTotal: raw.discountTotal,
    taxTotal: raw.taxTotal,
    shippingTotal: raw.shippingTotal,
    grandTotal: raw.grandTotal || raw.total,
  };
}
