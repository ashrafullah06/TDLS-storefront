// src/components/common/whatsappchatbutton.jsx
"use client";

import React, { useState, useRef, useEffect } from "react";

const whatsappNumber =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WHATSAPP_NUMBER) || "+8801638534389";

/**
 * Optional props:
 * - pageProduct (string)
 * - sku (string)
 * - size (string)
 */
export default function Whatsappchatbutton({ pageProduct, sku, size }) {
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [customMessage, setCustomMessage] = useState("");
  const [isOfflineHours, setIsOfflineHours] = useState(false);
  const modalRef = useRef(null);
  const textareaRef = useRef(null);
  const lastSendAtRef = useRef(0);
  const openerRef = useRef(null);

  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const currentUrl = typeof window !== "undefined" ? window.location.href : "";

  const topics = [
    { id: "sizes", label: "Sizing help", message: "Hi! Can you help with sizing?" },
    { id: "availability", label: "Color/size availability", message: "Is this color/size available?" },
    { id: "delivery", label: "Delivery cost & time", message: "What’s the delivery cost & time to my area?" },
    { id: "returns", label: "Return / exchange", message: "How do I return or exchange this item?" },
    { id: "fabric", label: "Fabric & care", message: "Tell me more about fabric & care." },
    { id: "human", label: "Talk to a human", message: "Please connect me to a human agent." },
    { id: "custom", label: "Something else", message: "" },
  ];

  // --- Dhaka live/offline hours ---
  useEffect(() => {
    const check = () => {
      const now = new Date();
      const hour = Number(
        new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dhaka", hour12: false })).getHours()
      );
      setIsOfflineHours(!(hour >= 10 && hour < 20));
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // --- Restore draft + topic on open ---
  useEffect(() => {
    if (showModal) {
      try {
        const draft = localStorage.getItem("tdlc_wa_draft");
        const topic = localStorage.getItem("tdlc_wa_topic");
        if (draft) setCustomMessage(draft);
        if (topic) setSelected(topic);
      } catch {}
    }
  }, [showModal]);

  // --- Persist draft as user types / picks ---
  useEffect(() => {
    try {
      localStorage.setItem("tdlc_wa_draft", customMessage || "");
    } catch {}
  }, [customMessage]);

  useEffect(() => {
    try {
      if (selected) localStorage.setItem("tdlc_wa_topic", selected);
    } catch {}
  }, [selected]);

  // --- Focus trap + return focus to opener + ESC ---
  useEffect(() => {
    if (!showModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setShowModal(false);
      } else if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll(
          'button,[href],input,textarea,[tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);

    // focus first focusable
    setTimeout(() => {
      const focusables = modalRef.current?.querySelectorAll(
        'button,[href],input,textarea,[tabindex]:not([tabindex="-1"])'
      );
      focusables && focusables[0]?.focus();
      if (selected === "custom" && textareaRef.current) textareaRef.current.focus();
    }, 30);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
      // return focus
      openerRef.current?.focus?.();
    };
  }, [showModal, selected]);

  // --- Analytics helpers (dispatch browser custom events) ---
  const track = (name, payload = {}) => {
    try {
      window.dispatchEvent(new CustomEvent("tdlc-analytics", { detail: { name, payload } }));
    } catch {}
  };

  const getPrefill = () => {
    const t = topics.find((x) => x.id === selected);
    let msg = t ? t.message : "";
    if (selected === "custom" && customMessage) msg = customMessage.trim();

    // Contextual lines (only if present)
    if (pageProduct) msg += `\nProduct — ${pageProduct}`;
    if (sku) msg += `\nSKU — ${sku}`;
    if (size) msg += `\nSize — ${size}`;

    // Always include URL + signature
    if (currentUrl) msg += `\nPage — ${currentUrl}`;
    msg += `\n— TDLC Support`;

    return encodeURIComponent(msg);
  };

  const openWhatsapp = () => {
    // prevent misclick spamming
    const now = Date.now();
    if (now - lastSendAtRef.current < 2000) return;
    lastSendAtRef.current = now;

    if (!selected || (selected === "custom" && !customMessage.trim())) return;

    const url = isMobile
      ? `https://wa.me/${whatsappNumber}?text=${getPrefill()}`
      : `https://web.whatsapp.com/send?phone=${whatsappNumber}&text=${getPrefill()}`;

    window.open(url, "_blank", "noopener,noreferrer");
    track("whatsapp_message_sent", {
      page_url: currentUrl,
      mode: selected === "custom" ? "custom" : "topic",
      topic: selected === "custom" ? null : selected,
    });
    setShowModal(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        ref={openerRef}
        aria-label="Chat on WhatsApp"
        onClick={() => {
          setShowModal(true);
          track("whatsapp_opened", {
            page_url: currentUrl,
            is_offline: isOfflineHours,
          });
        }}
        className="tdlc-whatsapp-btn"
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#36c03d 0%,#14b789 100%)",
          boxShadow: "0 6px 28px 0 #176d2e1c",
          border: "none",
          outline: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "box-shadow .19s,transform .17s",
        }}
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setShowModal(true)}
      >
        <svg width="32" height="32" viewBox="0 0 38 38" aria-hidden="true">
          <circle cx="19" cy="19" r="19" fill="#fff" />
          <path
            d="M19 7.4a11.6 11.6 0 0 0-9.8 17.6l-1 3.9 4-1A11.6 11.6 0 1 0 19 7.4Zm0 21.2a9.6 9.6 0 0 1-5-1.4l-.3-.2-2.4.7.6-2.3-.2-.3A9.6 9.6 0 1 1 19 28.6Zm5.1-7.1-.7-.3c-.3-.1-1.7-.8-1.9-.9-.2-.1-.4-.1-.6.1-.2.3-.6.8-.7.9-.1.2-.3.2-.5.1-1.3-.5-2.4-1.6-3-2.9-.1-.2 0-.4.1-.5l.7-.8c.1-.1.1-.2.1-.3l-.3-.9c-.1-.2-.3-.5-.5-.5h-.4c-.1 0-.4.1-.6.3-.8.9-1.2 2.2-.8 3.4.4 1 1.2 2.1 2.4 3.2 1.3 1.2 2.5 1.7 3.5 1.8.3 0 .7 0 1-.2 1-.6 1.4-1.2 1.5-1.7.1-.3.1-.5 0-.6Z"
            fill="#25d366"
          />
        </svg>
      </button>

      <style>{`
        .tdlc-whatsapp-btn:focus, .tdlc-whatsapp-btn:hover {
          box-shadow: 0 12px 48px #16cc4f33, 0 0 0 6px #19e69913;
          transform: scale(1.08);
        }
      `}</style>

      {/* Modal */}
      {showModal && (
        <div
          tabIndex={-1}
          aria-modal="true"
          role="dialog"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(30,36,45,.33)",
            backdropFilter: "blur(1.5px)",
            zIndex: 2147483647,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "fadein .19s",
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            ref={modalRef}
            style={{
              background: "rgba(255,255,255,0.94)",
              borderRadius: 16,
              padding: "32px 22px 20px 22px",
              minWidth: 295,
              maxWidth: 360,
              boxShadow: "0 8px 38px #2221",
              border: "1px solid #e7eae7",
              fontFamily: "'Inter', Arial, sans-serif",
              textAlign: "center",
              position: "relative",
              width: "93vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowModal(false)}
              aria-label="Close"
              style={{
                position: "absolute",
                top: 13,
                right: 13,
                background: "rgba(238,241,235,0.8)",
                border: "none",
                borderRadius: "50%",
                width: 30,
                height: 30,
                fontSize: 22,
                color: "#646",
                cursor: "pointer",
                boxShadow: "0 2px 8px #3332",
              }}
            >
              ×
            </button>

            <div
              style={{
                fontFamily: "'Playfair Display', serif",
                fontWeight: 900,
                fontSize: "1.32rem",
                color: "#128C7E",
                marginBottom: 9,
                letterSpacing: ".03em",
              }}
            >
              Chat with <span style={{ color: "#121" }}>THE DNA LAB</span>
            </div>

            <div style={{ fontSize: ".98rem", color: "#333", marginBottom: 8, fontWeight: 500 }}>
              We reply within business hours.
              <div style={{ color: "#128C7E", fontWeight: 600, marginTop: 6 }}>
                Live chat: 10:00–20:00 Bangladesh Standard Time (GMT+6)
              </div>
              {isOfflineHours && (
                <div
                  style={{
                    marginTop: 8,
                    background: "#fff8e6",
                    color: "#8a5a00",
                    border: "1px solid #ffe4b5",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: ".9rem",
                  }}
                >
                  We’re offline now (outside 10:00–20:00 GMT+6). Message us anyway—We’ll reply next business day.
                </div>
              )}
            </div>

            <div style={{ textAlign: "left", margin: "0 auto", maxWidth: 300 }}>
              {topics.map((t) => (
                <label
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    marginBottom: 8,
                    cursor: "pointer",
                    fontWeight: 600,
                    color: "#262",
                  }}
                >
                  <input
                    type="radio"
                    name="wa-topic"
                    value={t.id}
                    checked={selected === t.id}
                    onChange={() => {
                      setSelected(t.id);
                      track("whatsapp_topic_selected", { page_url: currentUrl, topic: t.id });
                    }}
                    style={{ accentColor: "#25D366" }}
                  />
                  {t.label}
                </label>
              ))}
            </div>

            {selected === "custom" && (
              <textarea
                ref={textareaRef}
                rows={3}
                placeholder="Type your message…"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 8,
                  marginBottom: 10,
                  padding: 9,
                  border: "1.4px solid #d7efe4",
                  borderRadius: 8,
                  fontSize: "1.01rem",
                  resize: "vertical",
                  fontFamily: "'Inter', Arial, sans-serif",
                }}
              />
            )}

            <button
              onClick={openWhatsapp}
              disabled={!selected || (selected === "custom" && !customMessage.trim())}
              style={{
                marginTop: 2,
                marginBottom: 6,
                background: "linear-gradient(90deg,#25D366 92%,#16e18c 120%)",
                color: "#fff",
                fontWeight: 700,
                border: "none",
                borderRadius: 7,
                padding: "10px 18px",
                fontSize: "1.05rem",
                cursor:
                  !selected || (selected === "custom" && !customMessage.trim()) ? "not-allowed" : "pointer",
                boxShadow: "0 4px 14px #25d3661c",
                opacity: !selected || (selected === "custom" && !customMessage.trim()) ? 0.7 : 1,
              }}
            >
              Open WhatsApp
            </button>

            <div style={{ fontSize: ".92em", color: "#6a8", marginTop: 12 }}>
              <span>or email </span>
              <a
                href="mailto:support@thednalabstore.com"
                onClick={() => track("whatsapp_email_fallback_clicked", { page_url: currentUrl })}
                style={{ color: "#128C7E", fontWeight: 600 }}
              >
                support@thednalabstore.com
              </a>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadein {
          0% { opacity: 0; transform: scale(.96); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}
