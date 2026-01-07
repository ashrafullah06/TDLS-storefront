import React, { useState, useEffect, useRef } from "react";

// Use hardcoded methods as fallback (as in your file, for demo/dev)
const FALLBACK_PAYMENT_METHODS = [
  {
    key: "cod",
    label: "Cash On Delivery",
    tooltip: "Pay when the product arrives.",
    url: "#",
    svg: (
      <svg width="48" height="32" viewBox="0 0 48 32" aria-hidden="true">
        <rect width="48" height="32" rx="7" fill="#F6FFF7" stroke="#21A366" strokeWidth="1.2"/>
        <text x="50%" y="45%" textAnchor="middle" fontSize="10" fontWeight="700" fill="#218837" fontFamily="Arial">CASH ON</text>
        <text x="50%" y="78%" textAnchor="middle" fontSize="10" fontWeight="700" fill="#218837" fontFamily="Arial">DELIVERY</text>
      </svg>
    ),
  },
  {
    key: "visa",
    label: "Visa",
    tooltip: "Pay with your Visa card.",
    url: "https://securepay.sslcommerz.com/gwprocess/v4/bank-payment",
    svg: (
      <svg width="48" height="32" viewBox="0 0 48 32" aria-hidden="true">
        <rect width="48" height="32" rx="7" fill="#fff" />
        <text x="50%" y="60%" textAnchor="middle" fontSize="14" fontWeight="900" fontFamily="Arial" fill="#1A1F71">VISA</text>
      </svg>
    ),
  },
  // ...all your other methods as in your file
];

// Main Component
export default function PaymentMethodsBar({ orderId, initialInvoice, locale = "en" }) {
  const [methods, setMethods] = useState(FALLBACK_PAYMENT_METHODS);
  const [invoice, setInvoice] = useState(initialInvoice || { status: "pending" });
  const [processing, setProcessing] = useState(""); // key of payment method being processed
  const [loading, setLoading] = useState(false);
  const [tooltip, setTooltip] = useState({ visible: false, text: "", x: 0, y: 0 });
  const [error, setError] = useState("");
  const pollTimer = useRef(null);

  // Load payment methods dynamically (Strapi/Backend), fallback to hardcoded
  useEffect(() => {
    async function fetchMethods() {
      try {
        const res = await fetch("/api/payment-methods"); // optional, Strapi/DB endpoint
        if (!res.ok) throw new Error();
        const data = await res.json();
        setMethods(data.length ? data : FALLBACK_PAYMENT_METHODS);
      } catch {
        setMethods(FALLBACK_PAYMENT_METHODS);
      }
    }
    fetchMethods();
  }, []);

  // Poll payment status (never trust only frontend status!)
  useEffect(() => {
    if (!orderId || invoice.status === "paid" || invoice.status === "refunded") {
      clearInterval(pollTimer.current);
      return;
    }
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/invoice/${orderId}/status`);
        if (res.ok) {
          const data = await res.json();
          setInvoice(prev => ({ ...prev, ...data }));
        }
      } catch (_) {}
    }, 5000);
    return () => clearInterval(pollTimer.current);
  }, [orderId, invoice.status]);

  // Analytics stub (matches your file)
  function trackPaymentMethodClick(method) {
    if (window.gtag) {
      window.gtag("event", "payment_method_click", {
        event_category: "Payments",
        event_label: method.label,
        value: method.key,
        order_id: orderId,
      });
    }
    // Also log to backend for fraud/abuse tracing if needed
  }

  // Tooltip (your original logic)
  function handleMouseEnter(e, text) {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ visible: true, text, x: rect.left + rect.width / 2, y: rect.top });
  }
  function handleMouseLeave() { setTooltip({ visible: false, text: "", x: 0, y: 0 }); }

  // Secure payment initiation, invoice-integrated and fraud-proof
  async function handleClick(pm) {
    trackPaymentMethodClick(pm);
    if (loading || processing) return;

    setProcessing(pm.key);
    setError("");
    setLoading(true);

    try {
      // Connect to backend for order/payment logic!
      const res = await fetch("/api/payments/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, method: pm.key }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "Payment failed to start.");

      // COD: Show alert as before (never set paid here)
      if (pm.key === "cod" || pm.label?.toLowerCase().includes("cash") || pm.url === "#") {
        alert(pm.tooltip || (locale === "bn"
          ? "অনুগ্রহ করে ডেলিভারির সময় পেমেন্ট করুন।"
          : "Please pay the delivery agent upon arrival."
        ));
        return;
      }

      // Other payment: open returned payment URL from backend/gateway, not hardcoded!
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else if (pm.url && pm.url !== "#") {
        // fallback if no backend, use static url (not recommended in prod)
        window.open(pm.url, "_blank", "noopener,noreferrer");
      } else {
        throw new Error("No payment URL returned.");
      }
    } catch (err) {
      setError(err.message || "Payment failed.");
    } finally {
      setLoading(false);
      setProcessing("");
    }
  }

  function statusLabel(status) {
    switch (status) {
      case "paid": return <span style={{ color: "#1e8538" }}>✅ Paid</span>;
      case "pending": return <span style={{ color: "#f58220" }}>⏳ Pending</span>;
      case "failed": return <span style={{ color: "#b32d2d" }}>❌ Failed</span>;
      case "refunded": return <span style={{ color: "#225677" }}>💸 Refunded</span>;
      case "review": return <span style={{ color: "#6948ab" }}>🔎 Under Review</span>;
      default: return <span>{status}</span>;
    }
  }

  return (
    <nav aria-label={locale === "bn" ? "পেমেন্ট মেথডস" : "Payment methods"}
      style={{
        width: "100%",
        maxWidth: 650,
        textAlign: "left",
        paddingLeft: 10,
        paddingRight: 10,
        margin: "0 auto",
        position: "relative"
      }}
    >
      <span style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        {locale === "bn" ? "পেমেন্ট মেথডস" : "Available Payment Methods"}
      </span>
      <div style={{
        fontWeight: 800,
        fontSize: 21,
        color: "#143364",
        marginBottom: "13px",
        letterSpacing: ".02em",
        fontFamily: "'Playfair Display', serif"
      }}>
        {locale === "bn" ? "পেমেন্ট মেথডস" : "Payment Methods"}
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#fff",
        borderRadius: 11,
        padding: "14px 8px",
        boxShadow: "0 2px 12px #e4e4e44a",
        minHeight: 60,
        overflowX: "auto",
        whiteSpace: "nowrap",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "thin"
      }}>
        {methods.map(pm => (
          <button
            key={pm.key}
            title={pm.label}
            aria-label={pm.label}
            style={{
              background: (processing === pm.key) ? "#e8f7ea" : "#f9f7ef",
              border: "1.3px solid #e0e0df",
              borderRadius: 7,
              padding: "4px 6px",
              margin: 0,
              minWidth: 48,
              boxShadow: "0 1px 4px #ececec55",
              cursor: (loading || processing) ? "not-allowed" : "pointer",
              transition: "border .15s, box-shadow .17s, background .11s",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              outline: "none",
              height: 44,
              width: 64,
              position: "relative",
              opacity: (loading && processing !== pm.key) ? 0.5 : 1,
              pointerEvents: (loading || processing) ? "none" : "auto"
            }}
            disabled={loading || processing}
            onClick={() => handleClick(pm)}
            onMouseEnter={e => handleMouseEnter(e, pm.tooltip || pm.label)}
            onMouseLeave={handleMouseLeave}
            onFocus={e => handleMouseEnter(e, pm.tooltip || pm.label)}
            onBlur={handleMouseLeave}
            tabIndex={0}
            data-payment-key={pm.key}
            data-testid={`payment-method-${pm.key}`}
          >
            {pm.svg}
            {processing === pm.key && (
              <span style={{
                position: "absolute", left: "50%", top: "65%",
                transform: "translate(-50%, -50%)", fontSize: 12, color: "#999"
              }}>Processing...</span>
            )}
          </button>
        ))}
        {tooltip.visible && (
          <div style={{
            position: "fixed",
            top: tooltip.y - 38,
            left: tooltip.x,
            transform: "translate(-50%, -100%)",
            background: "#143364",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 6,
            padding: "6px 15px",
            pointerEvents: "none",
            zIndex: 9999,
            boxShadow: "0 4px 16px #cce",
            whiteSpace: "pre",
            maxWidth: 210,
            textAlign: "center"
          }}>
            {tooltip.text}
          </div>
        )}
      </div>
      {/* Error/Feedback */}
      {error && <div style={{ color: "#b32d2d", fontWeight: 600, marginTop: 9 }}>{error}</div>}
      {/* Invoice status (fraud-proof!) */}
      {invoice && (
        <div style={{
          marginTop: 24,
          background: "#f6fafd",
          borderRadius: 9,
          padding: "14px 20px",
          fontSize: 16,
          border: `1.2px solid ${invoice.status === "paid" ? "#42b243" : "#f58220"}`,
          color: invoice.status === "paid" ? "#1e8538" : invoice.status === "failed" ? "#b32d2d" : "#143364"
        }}>
          <div>
            <b>Status: </b>{statusLabel(invoice.status)}
          </div>
          {invoice.txnId && (
            <div><b>Txn ID:</b> {invoice.txnId}</div>
          )}
          <div><b>Order #:</b> {orderId}</div>
        </div>
      )}
      <style>{`
        @media (max-width: 850px) {
          nav[aria-label="Payment methods"] div[style*="display: flex"] {
            gap: 8px !important;
            padding: 10px 2vw !important;
          }
        }
        @media (max-width: 500px) {
          nav[aria-label="Payment methods"] div[style*="display: flex"] {
            gap: 4px !important;
            padding: 7px 0.5vw !important;
          }
        }
        nav[aria-label="Payment methods"] div[style*="display: flex"]::-webkit-scrollbar {
          height: 4px;
        }
        nav[aria-label="Payment methods"] div[style*="display: flex"]::-webkit-scrollbar-thumb {
          background: #E4E6EF;
          border-radius: 2px;
        }
        nav[aria-label="Payment methods"] div[style*="display: flex"]:focus-within button {
          box-shadow: 0 0 0 2px #14336499;
        }
        nav[aria-label="Payment methods"] button:active {
          background: #f5efef;
        }
      `}</style>
    </nav>
  );
}
