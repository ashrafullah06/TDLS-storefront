//app/payment/[provider]/page.jsx
"use client";

/**
 * Payment Resume Page (App Router)
 *
 * Route:
 *   /payment/[provider]?order=<orderId>
 *
 * Purpose:
 * - Handles "client_secret" or redirect returns from gateways.
 * - Polls the order/payment status until it's PAID (best effort).
 * - When payment is PAID, asks for OTP on the shipping phone to confirm the order.
 * - After OTP verification, sends the user to Thank You with paid=1:
 *      /thank-you?order=<orderId>&paid=1
 *
 * Notes:
 * - Does not modify any server logic. Uses your existing endpoints.
 * - If your provider SDK needs a client_secret, this page can mount it as needed.
 * - If polling can't fetch the order, we still show helpful guidance.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Navbar from "@/components/common/navbar";
import Bottomfloatingbar from "@/components/common/bottomfloatingbar";

const NAVY = "#0f2147";
const BORDER = "#E6EAF4";
const SUBTEXT = "#6F7890";

export default function PaymentResumePage() {
  const { provider } = useParams(); // e.g., "stripe", "sslcommerz", "bkash", "nagad"
  const params = useSearchParams();
  const orderId = params.get("order") || "";
  const [order, setOrder] = useState(null);
  const [phase, setPhase] = useState("initial"); // initial | polling | paid | otp | done | error
  const [message, setMessage] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState(false);

  const pollTimer = useRef(null);
  const maxPollMs = 60_000; // 60s
  const pollStart = useRef(0);

  // Try to mount / integrate provider SDK here if needed (e.g., Stripe Elements).
  // We keep this generic; if your provider uses client_secret, you can read it via
  // /api/payments/intent or query params and mount the SDK. This page won't block on it.

  useEffect(() => {
    if (!orderId) {
      setPhase("error");
      setMessage("Missing order identifier.");
      return;
    }
    setPhase("polling");
    pollStart.current = Date.now();

    // start polling order payment status
    pollOnce(); // first attempt
    pollTimer.current = setInterval(pollOnce, 2000);

    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function pollOnce() {
    if (Date.now() - pollStart.current > maxPollMs) {
      if (pollTimer.current) clearInterval(pollTimer.current);
      setPhase("error");
      setMessage("We couldn't confirm your payment yet. If you already paid, please check your orders.");
      return;
    }
    try {
      const candidateEndpoints = [
        `/api/orders/${encodeURIComponent(orderId)}`,
        `/api/order?id=${encodeURIComponent(orderId)}`,
        `/api/orders/summary?orderId=${encodeURIComponent(orderId)}`,
      ];
      let o = null;
      for (const url of candidateEndpoints) {
        try {
          const r = await fetch(url, { cache: "no-store", credentials: "include" });
          if (r.ok) {
            const data = await r.json();
            o = normalizeOrder(data);
            break;
          }
        } catch {
          // try next
        }
      }
      if (!o) return; // keep polling quietly

      setOrder(o);

      // if provider already settled (PAID), move to OTP phase
      if (String(o.paymentStatus || "").toUpperCase() === "PAID") {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setPhase("paid");
      }
    } catch {
      // ignore; keep polling
    }
  }

  async function sendOtp(targetPhone) {
    const to = String(targetPhone || "").trim();
    if (!to) {
      setMessage("Mobile number required for OTP.");
      return false;
    }
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/auth/otp/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: to, purpose: "signup" }),
      });
      if (!r.ok) throw new Error("Failed to send OTP");
      setOtpSent(true);
      setPhase("otp");
      setMessage("We sent an OTP to your phone.");
      return true;
    } catch (e) {
      setMessage(e.message || "Could not send OTP.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(phone) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/auth/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otpCode }),
      });
      if (!r.ok) throw new Error("Invalid OTP");

      // success → go to Thank You (paid=1)
      setPhase("done");
      window.location.href = `/thank-you?order=${encodeURIComponent(orderId)}&paid=1`;
    } catch (e) {
      setMessage(e.message || "OTP verification failed.");
    } finally {
      setBusy(false);
    }
  }

  const shippingPhone = order?.shipping?.phone || "";

  const banner = useMemo(() => {
    if (phase === "error") {
      return { title: "Payment status unknown", sub: message || "Please check your orders page.", tone: "warn" };
    }
    if (phase === "paid" || phase === "otp") {
      return { title: "Payment received", sub: "Just one last step to confirm your order.", tone: "success" };
    }
    return { title: `Finishing ${prettyProvider(provider)} payment`, sub: "Please wait while we confirm your payment…", tone: "info" };
  }, [phase, message, provider]);

  const t = toneStyles(banner.tone);

  return (
    <div className="bg-[#FAFBFF] min-h-[100dvh]">
      <Navbar />

      <main className="mx-auto" style={{ maxWidth: 900, padding: "calc(var(--nav-h,80px) + 18px) 20px 80px" }}>
        <div className="rounded-xl p-4 mb-6" style={{ background: t.bg, color: t.text, border: `1px solid ${t.border}` }}>
          <div className="text-lg font-bold">{banner.title}</div>
          <div className="text-sm mt-1">{banner.sub}</div>
          {order?.orderNumber ? (
            <div className="text-sm mt-1 opacity-80">
              Order no: <span className="font-semibold">{order.orderNumber}</span>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl p-4 space-y-4" style={{ border: `1px solid ${BORDER}`, background: "#fff" }}>
          {/* Phase content */}
          {phase === "polling" || phase === "initial" ? (
            <div className="text-sm" style={{ color: SUBTEXT }}>
              Checking payment state… If this takes too long, you can safely refresh this page.
            </div>
          ) : null}

          {phase === "paid" && (
            <div className="space-y-3">
              <div className="text-sm font-medium" style={{ color: "#111827" }}>
                We’ll verify your phone to confirm the order.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => sendOtp(shippingPhone)}
                  className="rounded-md px-3 py-2 font-semibold"
                  style={{ border: `1px solid ${NAVY}`, color: NAVY }}
                  disabled={busy}
                >
                  Send OTP to {maskPhone(shippingPhone)}
                </button>
              </div>
              <p className="text-xs" style={{ color: SUBTEXT }}>
                We use your shipping phone number for order confirmation and delivery updates.
              </p>
            </div>
          )}

          {phase === "otp" && (
            <div className="space-y-3">
              <div className="text-sm font-medium" style={{ color: "#111827" }}>
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
                  onClick={() => verifyOtp(shippingPhone)}
                  className="rounded-md px-3 py-2 font-semibold"
                  style={{ background: NAVY, color: "#fff" }}
                  disabled={busy || !otpCode}
                >
                  Confirm order
                </button>
              </div>
              <div className="text-xs" style={{ color: SUBTEXT }}>
                Didn’t receive it?{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => sendOtp(shippingPhone)}
                  disabled={busy}
                >
                  Resend OTP
                </button>
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <div className="text-sm" style={{ color: "#B45309" }}>{message}</div>
              <div className="flex items-center gap-2">
                <a
                  href={orderId ? `/customer/orders/${encodeURIComponent(orderId)}` : "/customer/orders"}
                  className="rounded-md px-4 py-2 font-semibold"
                  style={{ background: NAVY, color: "#fff" }}
                >
                  View my order
                </a>
                <a
                  href="/"
                  className="rounded-md px-4 py-2 font-semibold"
                  style={{ border: `1px solid ${BORDER}`, color: "#111827", background: "#fff" }}
                >
                  Continue shopping
                </a>
              </div>
            </div>
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

          {message && phase !== "error" ? (
            <div className="text-sm" style={{ color: SUBTEXT }}>{message}</div>
          ) : null}
        </div>
      </main>

      <Bottomfloatingbar />
    </div>
  );
}

/* ------------ helpers ------------ */

function prettyProvider(p) {
  if (!p) return "online";
  switch (String(p).toLowerCase()) {
    case "sslcommerz":
      return "SSLCommerz";
    case "bkash":
      return "bKash";
    case "nagad":
      return "Nagad";
    case "stripe":
      return "Stripe";
    default:
      return p;
  }
}

function toneStyles(tone) {
  if (tone === "success") return { bg: "#ECFDF5", text: "#065F46", border: "#A7F3D0" };
  if (tone === "warn") return { bg: "#FEF3C7", text: "#92400E", border: "#FDE68A" };
  if (tone === "info") return { bg: "#EFF6FF", text: "#1E3A8A", border: "#BFDBFE" };
  return { bg: "#F3F4F6", text: "#111827", border: "#E5E7EB" };
}

function money(n) {
  const x = Number(n || 0);
  return `৳ ${x.toFixed(2)}`;
}

function maskPhone(p) {
  const s = String(p || "");
  if (s.length < 6) return s;
  return s.slice(0, 3) + "****" + s.slice(-3);
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
