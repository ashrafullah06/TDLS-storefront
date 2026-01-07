//app/payment/stripe/page.jsx
"use client";

/**
 * Stripe Elements Payment Page (optional; only used if your intent returns client_secret)
 *
 * Route:
 *   /payment/stripe?order=<orderId>
 *
 * What it does:
 *  - If Stripe is in "redirect" mode (Checkout Session), you won't hit this page.
 *  - If Stripe is in "client_secret" mode, this page:
 *      1) Fetches client_secret (via query ?client_secret=... OR /api/payments/intent),
 *      2) Mounts Stripe Elements → PaymentElement,
 *      3) Confirms the payment on-site,
 *      4) On success, sends OTP to the order's shipping phone and verifies it,
 *      5) Redirects to /thank-you?order=<id>&paid=1
 *
 * Safe:
 *  - Fully additive; does not change existing flows.
 *  - If anything’s missing (e.g., key, secret), it falls back to guidance.
 *
 * Requirements:
 *  - NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY set in env.
 *  - /api/payments/intent must accept { orderId, provider: "STRIPE" } and return { mode:"client_secret", client_secret }
 *    when Elements is enabled. If your backend keeps Stripe in redirect mode, this page won’t be used.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/common/navbar";
import Bottomfloatingbar from "@/components/common/bottomfloatingbar";

import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const NAVY = "#0f2147";
const BORDER = "#E6EAF4";
const SUBTEXT = "#6F7890";

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

export default function StripeElementsPage() {
  const params = useSearchParams();
  const orderId = params.get("order") || "";
  const clientSecretFromUrl = params.get("client_secret") || "";

  const [clientSecret, setClientSecret] = useState(clientSecretFromUrl || "");
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Hydrate order preview + fetch client_secret if not in URL
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!orderId) {
        setErr("Missing order identifier.");
        setLoading(false);
        return;
      }

      // 1) Try to read order (for shipping phone)
      const candidate = [
        `/api/orders/${encodeURIComponent(orderId)}`,
        `/api/order?id=${encodeURIComponent(orderId)}`,
        `/api/orders/summary?orderId=${encodeURIComponent(orderId)}`,
      ];
      for (const u of candidate) {
        try {
          const r = await fetch(u, { cache: "no-store", credentials: "include" });
          if (r.ok) {
            const data = await r.json();
            if (!cancelled) setOrder(normalizeOrder(data));
            break;
          }
        } catch {}
      }

      // 2) If we don’t already have a client_secret in URL, ask backend
      if (!clientSecretFromUrl) {
        try {
          const r = await fetch("/api/payments/intent", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId, provider: "STRIPE" }),
          });
          if (r.ok) {
            const data = await r.json();
            if (data?.client_secret) setClientSecret(data.client_secret);
          } else {
            const e = await safeJson(r);
            setErr(e?.code || "Unable to initialize Stripe payment.");
          }
        } catch (e) {
          setErr(e?.message || "Unable to initialize Stripe payment.");
        }
      }

      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, clientSecretFromUrl]);

  const stripePromise = useMemo(() => (STRIPE_PK ? loadStripe(STRIPE_PK) : null), []);

  const ready = !!(stripePromise && clientSecret);
  const shippingPhone = order?.shipping?.phone || "";

  return (
    <div className="bg-[#FAFBFF] min-h-[100dvh]">
      <Navbar />

      <main className="mx-auto" style={{ maxWidth: 900, padding: "calc(var(--nav-h,80px) + 18px) 20px 80px" }}>
        {/* Banner */}
        <div className="rounded-xl p-4 mb-6" style={{ background: "#EFF6FF", color: "#1E3A8A", border: "1px solid #BFDBFE" }}>
          <div className="text-lg font-bold">Complete your card payment</div>
          <div className="text-sm mt-1">
            Enter your card details below to confirm payment for order {order?.orderNumber || orderId}.
          </div>
        </div>

        {/* Body */}
        <div className="rounded-xl p-4 space-y-4" style={{ border: `1px solid ${BORDER}`, background: "#fff" }}>
          {!STRIPE_PK ? (
            <div className="text-sm" style={{ color: "#B91C1C" }}>
              Missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. Set it in your environment to use Stripe Elements.
            </div>
          ) : loading ? (
            <div className="text-sm" style={{ color: SUBTEXT }}>
              Initializing payment…
            </div>
          ) : !clientSecret ? (
            <div className="text-sm" style={{ color: "#B91C1C" }}>
              {err || "Could not get a client_secret for Stripe Elements."}
            </div>
          ) : (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: { theme: "stripe" },
              }}
            >
              <ElementsCheckout
                orderId={orderId}
                shippingPhone={shippingPhone}
                orderNumber={order?.orderNumber}
              />
            </Elements>
          )}

          {/* Minimal order peek */}
          {order ? (
            <div className="rounded-lg p-3" style={{ border: `1px solid ${BORDER}`, background: "#F9FAFF" }}>
              <div className="text-sm font-semibold mb-1" style={{ color: NAVY }}>
                Order preview
              </div>
              <div className="text-xs" style={{ color: SUBTEXT }}>
                {order.items?.length || 0} item(s) • Total {money(order.grandTotal)}
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <Bottomfloatingbar />
    </div>
  );
}

function ElementsCheckout({ orderId, shippingPhone, orderNumber }) {
  const stripe = useStripe();
  const elements = useElements();

  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [msg, setMsg] = useState("");

  async function handlePay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setMsg("");
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        redirect: "if_required", // stay on-site
      });
      if (error) {
        setMsg(error.message || "Card confirmation failed.");
        setBusy(false);
        return;
      }

      // Payment is successful or requires no redirect. Send OTP to finish.
      if (!otpSent) {
        const ok = await sendOtp(shippingPhone, setMsg);
        if (!ok) {
          setBusy(false);
          return;
        }
        setOtpSent(true);
        setBusy(false);
        return;
      }

      const ok = await verifyOtp(shippingPhone, otpCode, setMsg);
      if (!ok) {
        setBusy(false);
        return;
      }

      // Done → Thank you (paid)
      window.location.href = `/thank-you?order=${encodeURIComponent(orderId)}&paid=1`;
    } catch (e) {
      setMsg(e.message || "Payment failed.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium" style={{ color: "#111827" }}>
        Card details
      </div>
      <div className="rounded-md border p-3" style={{ borderColor: BORDER }}>
        <PaymentElement />
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handlePay}
          className="rounded-md px-4 py-2 font-semibold"
          style={{ background: "#0f2147", color: "#fff" }}
          disabled={busy || !stripe || !elements}
        >
          {otpSent ? "Confirm order" : "Pay now"}
        </button>
      </div>

      {/* OTP entry (shown after payment success) */}
      {otpSent ? (
        <div className="space-y-2">
          <div className="text-sm" style={{ color: "#111827" }}>
            Enter the OTP we sent to your phone
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="6-digit code"
              className="rounded-md border px-3 py-2 w-40"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md px-3 py-2 font-semibold"
              style={{ border: "1px solid #0f2147", color: "#0f2147" }}
              onClick={() => sendOtp(shippingPhone, setMsg)}
              disabled={busy}
            >
              Resend OTP
            </button>
          </div>
          <p className="text-xs" style={{ color: SUBTEXT }}>
            We use your shipping phone number to confirm and keep you updated.
          </p>
        </div>
      ) : null}

      {msg ? (
        <div className="text-sm" style={{ color: SUBTEXT }}>
          {msg}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- helpers ---------- */
function money(n) {
  const x = Number(n || 0);
  return `৳ ${x.toFixed(2)}`;
}

async function sendOtp(phone, setMsg) {
  const to = String(phone || "").trim();
  if (!to) {
    setMsg("Mobile number required for OTP.");
    return false;
  }
  try {
    const r = await fetch("/api/auth/otp/send", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: to, purpose: "signup" }),
    });
    if (!r.ok) throw new Error("Failed to send OTP");
    setMsg("OTP sent to your phone.");
    return true;
  } catch (e) {
    setMsg(e.message || "Could not send OTP.");
    return false;
  }
}

async function verifyOtp(phone, code, setMsg) {
  try {
    const r = await fetch("/api/auth/otp/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    if (!r.ok) throw new Error("Invalid OTP");
    return true;
  } catch (e) {
    setMsg(e.message || "OTP verification failed.");
    return false;
  }
}

async function safeJson(r) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}

function normalizeOrder(raw) {
  if (!raw || typeof raw !== "object") return null;

  const items =
    raw.items ||
    raw.lines ||
    raw.orderItems ||
    [];

  const mapped = items.map((it) => ({
    id: it.id,
    title: it.title || it.productTitle || it.variant?.title || "Item",
    sku: it.sku || it.variant?.sku || "",
    quantity: it.quantity || it.qty || 1,
    unitPrice: it.unitPrice || it.price || 0,
    total: it.total || it.subtotal || (Number(it.unitPrice || it.price || 0) * Number(it.quantity || it.qty || 1)),
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
    items: mapped,
    shipping,
    subtotal: raw.subtotal,
    discountTotal: raw.discountTotal,
    taxTotal: raw.taxTotal,
    shippingTotal: raw.shippingTotal,
    grandTotal: raw.grandTotal || raw.total,
  };
}
