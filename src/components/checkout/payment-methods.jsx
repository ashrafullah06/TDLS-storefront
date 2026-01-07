// FILE: my-project/src/components/checkout/payment-methods.jsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/** Palette */
const NAVY = "#0F2147";
const MUTED = "#6B7280";
const BORDER = "#E6E9F2";
const RING = "#2563EB";

/** Real brand assets */
const ICONS = {
  STRIPE: "https://brand.stripe.com/img/v3/brand-mark/stripe-brand-mark_blue.svg",
  SSL_COMMERZ: "https://sslcommerz.com/wp-content/uploads/2020/03/SSLCOMMERZ-Logo-1.png",
  BKASH: "https://upload.wikimedia.org/wikipedia/en/7/79/BKash_logo.svg",
  NAGAD: "https://upload.wikimedia.org/wikipedia/en/3/32/Nagad_Logo.svg",
  VISA: "https://upload.wikimedia.org/wikipedia/commons/0/04/Visa.svg",
  MASTERCARD: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg",
  AMEX: "https://upload.wikimedia.org/wikipedia/commons/3/30/American_Express_logo_%282018%29.svg",
  DISCOVER: "https://upload.wikimedia.org/wikipedia/commons/5/5a/Discover_Card_logo.svg",
  JCB: "https://upload.wikimedia.org/wikipedia/commons/1/1b/JCB_logo.svg",
  DINERS: "https://upload.wikimedia.org/wikipedia/commons/0/0c/Diners_Club_Logo3.svg",
  UNIONPAY: "https://upload.wikimedia.org/wikipedia/commons/0/0c/UnionPay_logo.svg",
  RUPAY: "https://upload.wikimedia.org/wikipedia/commons/b/bb/RuPay.svg",
};

/** Public env flags (client-side). If absent → not available. */
const ENV = {
  STRIPE: Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
  SSL: Boolean(process.env.NEXT_PUBLIC_SSLC_STORE_ID),
  BKASH: Boolean(process.env.NEXT_PUBLIC_BKASH_APP_KEY),
  NAGAD: Boolean(process.env.NEXT_PUBLIC_NAGAD_MERCHANT_ID),
};

/**
 * PaymentMethods
 * Props:
 *  - methodSelected?: "COD"|"STRIPE"|"SSL"|"BKASH"|"NAGAD"|null  (controlled)
 *  - onChangeMethod?: (id|null) => void
 *  - showGatewayWarning?: boolean
 */
export default function PaymentMethods({ methodSelected, onChangeMethod, showGatewayWarning = false }) {
  const [internal, setInternal] = useState(null);
  const selected = methodSelected ?? internal;

  const availability = useMemo(
    () => ({
      COD: true,
      STRIPE: !!ENV.STRIPE,
      SSL: !!ENV.SSL,
      BKASH: !!ENV.BKASH,
      NAGAD: !!ENV.NAGAD,
    }),
    []
  );

  useEffect(() => {
    if (methodSelected === undefined) onChangeMethod?.(internal ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internal]);

  function pick(id, enabled) {
    if (!enabled) return;
    if (methodSelected === undefined) setInternal(id);
    onChangeMethod?.(id);
  }

  const allMethods = useMemo(
    () => [
      { id: "COD", group: "Cash on Delivery", label: "Cash on Delivery", desc: "Pay with cash on delivery", iconSrc: null, brands: [] },
      {
        id: "STRIPE",
        group: "Online Cards",
        label: "Pay by Card (Stripe)",
        desc: "Visa, Mastercard, AmEx, Discover, JCB, Diners, UnionPay, RuPay",
        iconSrc: ICONS.STRIPE,
        brands: ["VISA","MASTERCARD","AMEX","DISCOVER","JCB","DINERS","UNIONPAY","RUPAY"],
      },
      { id: "SSL", group: "Local Gateway", label: "Online (SSLCommerz)", desc: "Local cards & wallets", iconSrc: ICONS.SSL_COMMERZ, brands: ["VISA","MASTERCARD","AMEX"] },
      { id: "BKASH", group: "Mobile Wallet", label: "bKash", desc: "Bangladesh mobile wallet", iconSrc: ICONS.BKASH, brands: [] },
      { id: "NAGAD", group: "Mobile Wallet", label: "Nagad", desc: "Bangladesh mobile wallet", iconSrc: ICONS.NAGAD, brands: [] },
    ],
    []
  );

  function BrandStrip({ ids }) {
    if (!ids?.length) return null;
    return (
      <div className="badge-row">
        {ids.map((id) => (
          <span key={id} className="badge"><img src={ICONS[id]} alt={id} /></span>
        ))}
        <style jsx>{`
          .badge-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:8px; }
          .badge { display:inline-flex; align-items:center; justify-content:center; height:24px; width:auto; }
          .badge img { max-height:20px; max-width:60px; width:auto; height:auto; object-fit:contain; object-position:center; display:block; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="head">
        <div className="ttl">Payment methods</div>
        <div className="sub">COD orders are confirmed with an OTP after you click Place Order.</div>
      </div>

      <div className="grid" id="payment-tiles">
        {allMethods.map((m) => {
          const enabled = availability[m.id];
          const active = selected === m.id;
          return (
            <label
              key={m.id}
              className={`tile ${active ? "active" : ""} ${enabled ? "" : "disabled"}`}
              aria-pressed={active}
              aria-disabled={!enabled}
              onClick={() => pick(m.id, enabled)}
            >
              <input
                type="radio"
                name="payment-method"
                value={m.id}
                checked={active}
                onChange={() => pick(m.id, enabled)}
                className="hidden-radio"
                aria-label={`Select ${m.label}`}
                disabled={!enabled}
              />
              <span className={`tick ${active ? "on" : ""}`} aria-hidden="true">{active ? "✓" : ""}</span>

              <div className="icon">
                {m.id === "COD" ? <span className="cod">COD</span> : <img src={m.iconSrc} alt={`${m.label} logo`} />}
              </div>

              <div className="content">
                <div className="row1">
                  <div className="label">{m.label}</div>
                  <div className="group">{m.group}</div>
                </div>
                <div className="desc">{m.desc}</div>
                <BrandStrip ids={m.brands} />
                {!enabled && m.id !== "COD" && (
                  <div className="unavailable">
                    <strong>Not available yet</strong> — Please choose Cash on Delivery.
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {showGatewayWarning && !selected ? (
        <div className="warn mt-3" role="alert">
          Please select a payment method to continue.
        </div>
      ) : null}

      <style jsx>{`
        .wrap { border:1px solid ${BORDER}; border-radius:16px; background:#fff; }
        .head { padding:16px 18px; border-bottom:1px solid ${BORDER}; }
        .ttl { font-size:15px; font-weight:800; color:${NAVY}; }
        .sub { font-size:12px; color:${MUTED}; margin-top:4px; }

        .grid { display:grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap:12px; padding:14px; }
        @media (min-width: 768px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

        .tile { display:grid; grid-template-columns: 28px 56px 1fr; gap:12px; align-items:center; border:1px solid ${BORDER};
          border-radius:14px; background:linear-gradient(180deg, #fff 0%, #FAFBFF 100%); padding:14px 16px; cursor:pointer;
          transition: box-shadow .15s, border-color .15s, background .15s; overflow:hidden; }
        .tile:hover { border-color:#D2D8E6; }
        .tile.active { border-color:${RING}; box-shadow:0 0 0 3px rgba(37,99,235,.12); background:#F7FAFF; }
        .tile.disabled { opacity:.55; cursor:not-allowed; }
        .hidden-radio { display:none; }
        .tick { width:24px; height:24px; border:2px solid ${RING}; border-radius:999px; display:flex; align-items:center; justify-content:center; font-weight:800;
          color:#fff; background:#fff; transition: background .15s, color .15s; flex-shrink:0; }
        .tick.on { background:${RING}; color:#fff; }
        .icon { width:56px; height:56px; border-radius:12px; background:#fff; border:1px solid #EEF2F7; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; }
        .icon img { max-width:48px; max-height:26px; object-fit:contain; object-position:center; display:block; }
        .cod { font-weight:900; color:${NAVY}; }
        .content { min-width:0; }
        .row1 { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .label { font-weight:800; color:#111827; }
        .group { font-size:11px; color:${MUTED}; font-weight:700; text-transform:uppercase; letter-spacing:.3px; }
        .desc { font-size:12px; color:${MUTED}; margin-top:2px; }
        .unavailable { margin-top:8px; font-size:12px; color:#8a1a1a; background:#fff1f2; border:1px solid #fecaca; padding:8px 10px; border-radius:10px; }

        .warn {
          background:#fff7ed; border:1px solid #fed7aa; color:#9a3412;
          padding:10px 12px; border-radius:12px; font-weight:800; margin:0 14px 14px;
        }
      `}</style>
    </div>
  );
}
