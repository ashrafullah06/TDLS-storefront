// FILE: src/components/common/whatsappchatbutton.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

const RAW_WHATSAPP_NUMBER =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WHATSAPP_NUMBER) ||
  "+8801638534389";

/** Minimal, stable persistence (no network calls, no heavy state machine) */
const STORAGE_KEY = "tdls_wa_min_v1";
const STORAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Keep conservative to avoid WhatsApp URL issues on some browsers */
const MAX_MESSAGE_CHARS = 1200;

const PORTAL_ID = "tdls-wa-portal-root";

/** Requested “safe distance” */
const SAFE_GAP_INCH = 0.5;

/** User request: move icon 0.8 inch upward from current position */
const FAB_LIFT_INCH = 0.8;

export default function Whatsappchatbutton({ pageProduct, sku, size }) {
  const pathname = usePathname();
  const isAdminRoute = typeof pathname === "string" && pathname.startsWith("/admin");
  if (isAdminRoute) return null;

  const [open, setOpen] = useState(false);
  const openerRef = useRef(null);
  const modalRef = useRef(null);

  const [portalEl, setPortalEl] = useState(null);

  // Lightweight fields (only what actually improves message quality)
  const [topic, setTopic] = useState("sizes"); // sizes | availability | delivery | returns | fabric | other
  const [draft, setDraft] = useState("");
  const [fields, setFields] = useState({
    name: "",
    phone: "",
    area: "",
    orderId: "",
    height: "",
    weight: "",
    preferredSize: "",
    fitPreference: "",
  });

  const [pageUrl, setPageUrl] = useState("");

  const [isOnline, setIsOnline] = useState(true);
  const [isOfflineHours, setIsOfflineHours] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastSendAtRef = useRef(0);
  const copyTimerRef = useRef(null);

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobile =
    typeof navigator !== "undefined" &&
    ((navigator.userAgentData && navigator.userAgentData.mobile) ||
      /Android|webOS|iPhone|iPad|iPod/i.test(ua));

  const WHATSAPP_PHONE = useMemo(() => normalizeWhatsAppPhone(RAW_WHATSAPP_NUMBER), []);
  const topics = useMemo(
    () => [
      { id: "sizes", label: "Sizing" },
      { id: "availability", label: "Availability" },
      { id: "delivery", label: "Delivery" },
      { id: "returns", label: "Return/Exchange" },
      { id: "fabric", label: "Fabric/Care" },
      { id: "other", label: "Other" },
    ],
    []
  );

  /* ---------------- Portal root ---------------- */
  useEffect(() => {
    if (typeof document === "undefined") return;
    let el = document.getElementById(PORTAL_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = PORTAL_ID;
      // Fullscreen overlay root (prevents z-index and transform stacking issues)
      el.style.position = "fixed";
      el.style.inset = "0";
      el.style.zIndex = "2147483647";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
    }
    setPortalEl(el);
  }, []);

  /* ---------------- URL capture ---------------- */
  useEffect(() => {
    try {
      setPageUrl(window.location.href || "");
    } catch {
      setPageUrl("");
    }
  }, []);

  /* ---------------- Online/offline ---------------- */
  useEffect(() => {
    const safeSet = () => {
      try {
        setIsOnline(Boolean(navigator.onLine));
      } catch {
        setIsOnline(true);
      }
    };
    safeSet();
    window.addEventListener("online", safeSet);
    window.addEventListener("offline", safeSet);
    return () => {
      window.removeEventListener("online", safeSet);
      window.removeEventListener("offline", safeSet);
    };
  }, []);

  /* ---------------- Dhaka hours (10:00–20:00) ---------------- */
  useEffect(() => {
    const check = () => {
      const hour = getHourInTimeZone("Asia/Dhaka");
      setIsOfflineHours(!(hour >= 10 && hour < 20));
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  /* ---------------- Restore minimal saved fields when opening ---------------- */
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = safeJsonParse(raw);
      if (!parsed) return;

      const ts = Number(parsed.ts || 0);
      if (ts && Date.now() - ts > STORAGE_TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      if (typeof parsed.topic === "string") setTopic(parsed.topic);
      if (typeof parsed.draft === "string") setDraft(parsed.draft);

      if (parsed.fields && typeof parsed.fields === "object") {
        setFields((prev) => ({
          ...prev,
          ...sanitizeFields(parsed.fields),
        }));
      }
    } catch {
      // ignore
    }
  }, [open]);

  /* ---------------- Persist (minimal + cheap) ---------------- */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            ts: Date.now(),
            topic,
            draft: String(draft || "").slice(0, 1200),
            fields: sanitizeFields(fields),
          })
        );
      } catch {
        // ignore
      }
    }, 180);
    return () => clearTimeout(t);
  }, [open, topic, draft, fields]);

  /* ---------------- Measure navbar & BFBar so nothing is covered ---------------- */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;

    const findBFBarEl = () => {
      const selectors = [
        '[data-tdls-bfbar="1"]',
        "[data-tdls-bfbar]",
        "#tdls-bfbar",
        "#bottomfloatingbar",
        ".tdls-bottomfloatingbar",
        ".tdls-bottom-floating-bar",
        ".tdls-bfbar",
        ".BottomFloatingBar",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    };

    const findNavbarEl = () => {
      const selectors = [
        '[data-tdls-navbar="1"]',
        "[data-tdls-navbar]",
        "#tdls-navbar",
        "#navbar",
        ".tdls-navbar",
        ".Navbar",
        "header[data-tdls-header]",
        "header",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    };

    const readCSSPx = (name) => {
      try {
        const v = getComputedStyle(root).getPropertyValue(name).trim();
        if (!v) return 0;
        const n = Number(String(v).replace("px", "").trim());
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    };

    const apply = () => {
      try {
        // BFBar height
        const bf = findBFBarEl();
        let bfH = 0;
        if (bf) {
          const r = bf.getBoundingClientRect();
          const visible = r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
          bfH = visible ? Math.max(0, Math.round(r.height)) : 0;
        }
        if (!bfH) bfH = readCSSPx("--tdls-bottom-offset") || 0;
        root.style.setProperty("--tdls-wa-bfbar-offset", `${bfH}px`);

        // Navbar height
        const nav = findNavbarEl();
        let navH = 0;
        if (nav) {
          const r = nav.getBoundingClientRect();
          const topish = r.top <= 8 && r.bottom > 0;
          const visible = r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
          navH = topish && visible ? Math.max(0, Math.round(r.height)) : 0;
        }
        if (!navH) navH = readCSSPx("--tdls-navbar-offset") || readCSSPx("--nav-h") || 0;
        root.style.setProperty("--tdls-wa-nav-offset", `${navH}px`);
      } catch {
        // ignore
      }
    };

    apply();

    let raf = 0;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });

    const mo = new MutationObserver(onResize);
    try {
      mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    } catch {
      // ignore
    }

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      try {
        mo.disconnect();
      } catch {
        // ignore
      }
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /* ---------------- Modal open/close behaviors ---------------- */
  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    // prevent layout shift from scrollbar
    const gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    document.body.style.overflow = "hidden";

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);

    const focusTimer = setTimeout(() => {
      const first =
        modalRef.current?.querySelector('button[data-topic="1"]') ||
        modalRef.current?.querySelector("input") ||
        modalRef.current?.querySelector("textarea");
      first?.focus?.();
    }, 40);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      document.removeEventListener("keydown", onKey);
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    }
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [open]);

  /* ---------------- Message composition ---------------- */
  const composedMessage = useMemo(() => {
    const msg = composeMessage({
      topic,
      draft,
      fields,
      pageProduct,
      sku,
      size,
      pageUrl,
      includeOfflineNote: isOfflineHours,
    });
    return ensureLimit(msg, MAX_MESSAGE_CHARS);
  }, [topic, draft, fields, pageProduct, sku, size, pageUrl, isOfflineHours]);

  const canSend = useMemo(() => {
    // allow sending even if draft is empty because topic templates exist
    return Boolean(topic);
  }, [topic]);

  const primaryLabel = useMemo(() => (!isOnline ? "Copy message" : "Open WhatsApp"), [isOnline]);

  const copyToClipboard = useCallback(async () => {
    const text = composedMessage || "";
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }, [composedMessage]);

  const openWhatsApp = useCallback(() => {
    const now = Date.now();
    if (now - lastSendAtRef.current < 2000) return;
    lastSendAtRef.current = now;
    if (!canSend) return;

    const text = encodeURIComponent(composedMessage);
    const phone = WHATSAPP_PHONE;

    if (isMobile) {
      const deepLink = `whatsapp://send?phone=${phone}&text=${text}`;
      const webLink = `https://wa.me/${phone}?text=${text}`;

      let fallbackTimer = null;
      const cleanup = () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallbackTimer = null;
      };

      try {
        window.location.href = deepLink;
        fallbackTimer = setTimeout(() => {
          try {
            window.open(webLink, "_blank", "noopener,noreferrer");
          } finally {
            cleanup();
          }
        }, 800);
      } catch {
        try {
          window.open(webLink, "_blank", "noopener,noreferrer");
        } finally {
          cleanup();
        }
      }

      setOpen(false);
      return;
    }

    const desktopUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${text}`;
    window.open(desktopUrl, "_blank", "noopener,noreferrer");
    setOpen(false);
  }, [WHATSAPP_PHONE, canSend, composedMessage, isMobile]);

  const primaryAction = useCallback(() => {
    if (!isOnline) return copyToClipboard();
    return openWhatsApp();
  }, [isOnline, copyToClipboard, openWhatsApp]);

  const reset = useCallback(() => {
    setTopic("sizes");
    setDraft("");
    setFields({
      name: "",
      phone: "",
      area: "",
      orderId: "",
      height: "",
      weight: "",
      preferredSize: "",
      fitPreference: "",
    });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const modalTree = open ? (
    <div
      className="tdls-wa-backdrop"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tdls-wa-modal"
        ref={modalRef}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="tdls-wa-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <header className="tdls-wa-header">
          <div className="tdls-wa-title">
            Chat with <span className="tdls-wa-brand">TDLS</span>
          </div>

          <div className="tdls-wa-sub">
            Live chat: <strong>10:00–20:00</strong> (BST, GMT+6)
            {!isOnline ? (
              <div className="tdls-wa-status is-warn">You’re offline — copy the message and send later.</div>
            ) : isOfflineHours ? (
              <div className="tdls-wa-status is-warn">We’re away-hours — message now, we’ll reply next day.</div>
            ) : (
              <div className="tdls-wa-status is-ok">We’re online.</div>
            )}
          </div>

          <div className="tdls-wa-headerActions">
            <button type="button" className="tdls-wa-ghost" onClick={reset}>
              Reset
            </button>
          </div>
        </header>

        <section className="tdls-wa-body">
          <div className="tdls-wa-sectionTitle">Topic</div>
          <div className="tdls-wa-topics" role="radiogroup" aria-label="WhatsApp chat topic">
            {topics.map((t) => {
              const active = topic === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-topic="1"
                  className={`tdls-wa-topic ${active ? "is-active" : ""}`}
                  onClick={() => setTopic(t.id)}
                  aria-pressed={active}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="tdls-wa-sectionTitle">Details</div>
          <div className="tdls-wa-grid">
            <label className="tdls-wa-field">
              <span className="tdls-wa-label">Name</span>
              <input
                className="tdls-wa-input"
                value={fields.name}
                onChange={(e) => setFields((p) => ({ ...p, name: e.target.value }))}
                placeholder="Your name"
                autoComplete="name"
              />
            </label>

            <label className="tdls-wa-field">
              <span className="tdls-wa-label">Phone</span>
              <input
                className="tdls-wa-input"
                value={fields.phone}
                onChange={(e) => setFields((p) => ({ ...p, phone: e.target.value }))}
                placeholder="+8801XXXXXXXXX"
                inputMode="tel"
                autoComplete="tel"
              />
              {!isProbablyValidBDPhone(fields.phone) ? (
                <span className="tdls-wa-hint">Use 01XXXXXXXXX or +8801XXXXXXXXX.</span>
              ) : null}
            </label>

            {(topic === "delivery" || topic === "returns") && (
              <label className="tdls-wa-field tdls-wa-span2">
                <span className="tdls-wa-label">Area (optional)</span>
                <input
                  className="tdls-wa-input"
                  value={fields.area}
                  onChange={(e) => setFields((p) => ({ ...p, area: e.target.value }))}
                  placeholder="e.g., Gulshan, Dhaka"
                  autoComplete="address-level2"
                />
              </label>
            )}

            {topic === "returns" && (
              <label className="tdls-wa-field tdls-wa-span2">
                <span className="tdls-wa-label">Order ID (optional)</span>
                <input
                  className="tdls-wa-input"
                  value={fields.orderId}
                  onChange={(e) => setFields((p) => ({ ...p, orderId: e.target.value }))}
                  placeholder="Order number"
                />
              </label>
            )}

            {topic === "sizes" && (
              <>
                <label className="tdls-wa-field">
                  <span className="tdls-wa-label">Height (optional)</span>
                  <input
                    className="tdls-wa-input"
                    value={fields.height}
                    onChange={(e) => setFields((p) => ({ ...p, height: e.target.value }))}
                    placeholder='e.g., 5&#39;9&quot; / 175 cm'
                  />
                </label>
                <label className="tdls-wa-field">
                  <span className="tdls-wa-label">Weight (optional)</span>
                  <input
                    className="tdls-wa-input"
                    value={fields.weight}
                    onChange={(e) => setFields((p) => ({ ...p, weight: e.target.value }))}
                    placeholder="e.g., 72 kg"
                  />
                </label>
                <label className="tdls-wa-field">
                  <span className="tdls-wa-label">Preferred size (optional)</span>
                  <input
                    className="tdls-wa-input"
                    value={fields.preferredSize}
                    onChange={(e) => setFields((p) => ({ ...p, preferredSize: e.target.value }))}
                    placeholder="S / M / L / XL"
                  />
                </label>
                <label className="tdls-wa-field">
                  <span className="tdls-wa-label">Fit preference (optional)</span>
                  <input
                    className="tdls-wa-input"
                    value={fields.fitPreference}
                    onChange={(e) => setFields((p) => ({ ...p, fitPreference: e.target.value }))}
                    placeholder="Slim / Regular / Relaxed"
                  />
                </label>
              </>
            )}
          </div>

          <div className="tdls-wa-sectionTitle">Message</div>
          <textarea
            className="tdls-wa-textarea"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add any extra details… (optional)"
          />

          <div className="tdls-wa-sectionTitle">Preview</div>
          <div className="tdls-wa-preview">
            <div className="tdls-wa-previewMeta">
              <span>{composedMessage.length} chars</span>
              <button type="button" className="tdls-wa-ghost" onClick={copyToClipboard}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="tdls-wa-previewText">{composedMessage}</pre>
          </div>
        </section>

        <footer className="tdls-wa-footer">
          <button type="button" className="tdls-wa-primary" onClick={primaryAction} disabled={!canSend}>
            {primaryLabel}
          </button>
          <button type="button" className="tdls-wa-secondary" onClick={copyToClipboard}>
            Copy
          </button>
          <div className="tdls-wa-alt">
            or email{" "}
            <a href="mailto:support@thednalabstore.com" className="tdls-wa-link">
              support@thednalabstore.com
            </a>
          </div>
        </footer>
      </div>
    </div>
  ) : null;

  const fabTree = (
    <button
      ref={openerRef}
      type="button"
      aria-label="Chat on WhatsApp"
      aria-haspopup="dialog"
      aria-expanded={open ? "true" : "false"}
      className="tdls-wa-fab"
      onClick={onOpen}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="tdls-wa-dot" aria-hidden="true" />
      <svg className="tdls-wa-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12.04 2C6.57 2 2.14 6.3 2.14 11.6c0 1.87.55 3.69 1.6 5.25L2 22l5.33-1.67c1.49.78 3.16 1.2 4.88 1.2 5.47 0 9.9-4.3 9.9-9.6S17.51 2 12.04 2Zm0 17.67c-1.54 0-3.03-.38-4.35-1.1l-.32-.17-3.12.98.96-3.02-.2-.31c-.9-1.41-1.38-3.03-1.38-4.69 0-4.58 3.88-8.31 8.61-8.31 4.74 0 8.61 3.73 8.61 8.31 0 4.58-3.87 8.31-8.61 8.31Zm5.02-6.02c-.21.58-1.05 1.11-1.67 1.24-.43.09-.98.15-3.15-.66-2.79-1.03-4.59-3.7-4.72-3.87-.13-.17-1.14-1.46-1.14-2.8 0-1.33.7-1.98.95-2.25.24-.27.53-.34.7-.34.17 0 .35 0 .5.01.16.01.38-.06.59.45.21.51.72 1.77.78 1.89.06.13.1.28.02.45-.08.17-.13.28-.25.43-.12.15-.26.34-.37.45-.13.13-.26.26-.11.5.15.25.66 1.06 1.43 1.71.99.84 1.83 1.1 2.1 1.21.27.13.42.1.58-.06.16-.16.66-.74.83-.99.17-.25.35-.21.59-.13.24.09 1.54.72 1.8.84.26.13.44.19.5.29.06.1.06.58-.15 1.16Z"
        />
      </svg>
      <span className="tdls-wa-labelFab">Chat</span>
    </button>
  );

  return (
    <>
      {/* FAB is portaled to body-level overlay to avoid being clipped/hidden by BFBar/stacking contexts */}
      {portalEl
        ? createPortal(<div style={{ pointerEvents: "auto" }}>{fabTree}</div>, portalEl)
        : fabTree}

      {portalEl && modalTree ? createPortal(<div style={{ pointerEvents: "auto" }}>{modalTree}</div>, portalEl) : null}

      <style>{styles}</style>
    </>
  );
}

/* ------------------------------ helpers ------------------------------ */

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function cleanLine(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFields(obj) {
  const allowed = ["name", "phone", "area", "orderId", "height", "weight", "preferredSize", "fitPreference"];
  const out = {};
  for (const k of allowed) {
    const v = obj?.[k];
    out[k] = typeof v === "string" ? v.slice(0, 120) : "";
  }
  return out;
}

function normalizeWhatsAppPhone(raw) {
  const s = String(raw || "").trim();
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "8801638534389";
  if (digits.startsWith("0")) return `88${digits}`; // 01... -> 8801...
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("16")) return `880${digits}`;
  return digits;
}

function isProbablyValidBDPhone(input) {
  const s = String(input || "").trim();
  if (!s) return true;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("01")) return true;
  if (digits.length === 13 && digits.startsWith("8801")) return true;
  return false;
}

function ensureLimit(msg, maxChars) {
  const s = String(msg || "");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 18)).trimEnd()}\n\n(Trimmed)`;
}

function composeMessage({ topic, draft, fields, pageProduct, sku, size, pageUrl, includeOfflineNote }) {
  const name = cleanLine(fields?.name);
  const phone = cleanLine(fields?.phone);
  const area = cleanLine(fields?.area);
  const orderId = cleanLine(fields?.orderId);
  const height = cleanLine(fields?.height);
  const weight = cleanLine(fields?.weight);
  const preferredSize = cleanLine(fields?.preferredSize);
  const fitPreference = cleanLine(fields?.fitPreference);
  const extra = cleanLine(draft);

  const topicLabel =
    topic === "sizes"
      ? "Sizing help"
      : topic === "availability"
      ? "Availability"
      : topic === "delivery"
      ? "Delivery"
      : topic === "returns"
      ? "Return/Exchange"
      : topic === "fabric"
      ? "Fabric & care"
      : "Other";

  const lines = [];
  lines.push(name ? `Hi, I’m ${name}.` : "Hi!");
  lines.push(`Topic: ${topicLabel}`);

  if (includeOfflineNote) lines.push("I understand you’re currently away-hours—please reply next business day.");

  if (topic === "sizes") {
    const bits = [];
    if (height) bits.push(`Height: ${height}`);
    if (weight) bits.push(`Weight: ${weight}`);
    if (preferredSize) bits.push(`Preferred size: ${preferredSize}`);
    if (fitPreference) bits.push(`Fit preference: ${fitPreference}`);
    if (bits.length) lines.push(bits.join(" · "));
    lines.push("Please recommend the best size for me.");
  } else if (topic === "availability") {
    lines.push("Please confirm available color/size options for this item.");
  } else if (topic === "delivery") {
    if (area) lines.push(`Area: ${area}`);
    lines.push("Please share delivery charge and ETA.");
  } else if (topic === "returns") {
    if (orderId) lines.push(`Order ID: ${orderId}`);
    if (area) lines.push(`Pickup area: ${area}`);
    lines.push("Please guide me through return/exchange steps.");
  } else if (topic === "fabric") {
    lines.push("Please share fabric composition and care instructions.");
  } else {
    lines.push("I need help with this item/order.");
  }

  if (extra) {
    lines.push("");
    lines.push(extra);
  }

  if (phone) {
    lines.push("");
    lines.push(`Phone: ${phone}`);
  }

  const context = [];
  if (pageProduct) context.push(`Product: ${cleanLine(pageProduct)}`);
  if (sku) context.push(`SKU: ${cleanLine(sku)}`);
  if (size) context.push(`Size (shown): ${cleanLine(size)}`);
  if (pageUrl) context.push(`Page: ${pageUrl}`);
  if (context.length) {
    lines.push("");
    lines.push(...context);
  }

  lines.push("");
  lines.push("— TDLS Support");

  return lines.join("\n").trim();
}

function getHourInTimeZone(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    return Number.isFinite(h) ? h : new Date().getHours();
  } catch {
    return new Date().getHours();
  }
}

/* ------------------------------ Styles ------------------------------ */

const styles = `
  :root{
    --tdls-wa-nav-offset: 0px;
    --tdls-wa-bfbar-offset: 0px;

    --tdls-wa-gap-in: ${SAFE_GAP_INCH}in;
    --tdls-wa-fab-lift-in: ${FAB_LIFT_INCH}in;

    /* derived safe paddings */
    --tdls-wa-safe-top: calc(env(safe-area-inset-top) + var(--tdls-wa-nav-offset) + var(--tdls-wa-gap-in));
    --tdls-wa-safe-bottom: calc(env(safe-area-inset-bottom) + var(--tdls-wa-bfbar-offset) + var(--tdls-wa-gap-in));

    /* FAB bottom: safe bottom + requested extra lift + a small responsive cushion */
    --tdls-wa-fab-bottom: calc(var(--tdls-wa-safe-bottom) + var(--tdls-wa-fab-lift-in) + clamp(10px, 2.4vw, 18px));

    --tdls-wa-safe-x: calc(14px + env(safe-area-inset-left));
    --tdls-wa-safe-xr: calc(14px + env(safe-area-inset-right));
  }

  .tdls-wa-fab{
    position: fixed;
    right: calc(env(safe-area-inset-right) + clamp(14px, 3vw, 22px));
    bottom: var(--tdls-wa-fab-bottom);

    width: clamp(52px, 10vw, 64px);
    height: clamp(52px, 10vw, 64px);

    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.22);
    cursor: pointer;

    z-index: 2147483647;

    display: grid;
    place-items: center;
    padding: 0;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;

    background:
      radial-gradient(120% 120% at 18% 10%, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0) 52%),
      linear-gradient(135deg,#2AD66A 0%,#12B886 100%);

    box-shadow:
      0 18px 56px rgba(8, 74, 42, 0.22),
      0 2px 0 rgba(255,255,255,0.28) inset,
      0 0 0 1px rgba(0,0,0,0.06) inset;

    transition: transform .16s ease, box-shadow .18s ease, filter .18s ease;
  }

  .tdls-wa-fab:hover,
  .tdls-wa-fab:focus-visible{
    transform: translateY(-1px) scale(1.03);
    filter: saturate(1.04);
    box-shadow:
      0 22px 74px rgba(22,204,79,0.26),
      0 0 0 6px rgba(25,230,153,0.12);
  }

  .tdls-wa-icon{
    width: clamp(26px, 5vw, 30px);
    height: clamp(26px, 5vw, 30px);
    color: #ffffff;
  }

  .tdls-wa-dot{
    position: absolute;
    top: 10px;
    right: 10px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: #22c55e;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.98);
  }

  .tdls-wa-labelFab{
    position: absolute;
    right: calc(100% + 10px);
    bottom: 12px;
    padding: 7px 10px;
    background: rgba(255,255,255,0.96);
    border: 1px solid rgba(231,234,231,0.95);
    border-radius: 999px;
    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size: 12px;
    font-weight: 850;
    color: #0F2147;
    box-shadow: 0 14px 38px rgba(0,0,0,0.14);
    user-select: none;
    white-space: nowrap;
    backdrop-filter: blur(8px);
  }
  @media (max-width: 520px){
    .tdls-wa-labelFab{ display:none; }

    /* smaller FAB on mobile */
    .tdls-wa-fab{
      width: 50px;
      height: 50px;
      right: calc(env(safe-area-inset-right) + 14px);
    }
    .tdls-wa-icon{
      width: 24px;
      height: 24px;
    }
    .tdls-wa-dot{
      top: 9px;
      right: 9px;
      width: 9px;
      height: 9px;
    }
  }

  .tdls-wa-backdrop{
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    pointer-events: auto;

    background: rgba(2, 6, 23, 0.74);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);

    display: grid;
    place-items: center;

    padding-top: var(--tdls-wa-safe-top);
    padding-bottom: var(--tdls-wa-safe-bottom);
    padding-left: var(--tdls-wa-safe-x);
    padding-right: var(--tdls-wa-safe-xr);

    isolation: isolate;
  }

  .tdls-wa-modal{
    width: min(560px, 92vw);
    max-height: calc(100dvh - (var(--tdls-wa-safe-top) + var(--tdls-wa-safe-bottom)));
    max-height: calc(100svh - (var(--tdls-wa-safe-top) + var(--tdls-wa-safe-bottom)));
    overflow: hidden;

    background: #ffffff;
    border: 1px solid rgba(231,234,231,0.92);
    border-radius: 22px;
    box-shadow: 0 34px 140px rgba(0,0,0,0.38);

    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    position: relative;

    display: grid;
    grid-template-rows: auto 1fr auto;
  }

  .tdls-wa-close{
    position: absolute;
    top: 12px;
    right: 12px;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(255,255,255,0.96);
    cursor: pointer;
    font-size: 22px;
    color: rgba(15,33,71,0.85);
    display: grid;
    place-items: center;
    box-shadow: 0 14px 34px rgba(0,0,0,0.14);
  }
  .tdls-wa-close:focus-visible{ outline: 2px solid rgba(37,99,235,0.7); outline-offset: 2px; }

  .tdls-wa-header{
    padding: 18px 16px 12px 16px;
    border-bottom: 1px solid rgba(230,233,242,0.9);
    background:
      radial-gradient(120% 120% at 12% 0%, rgba(15,33,71,0.06) 0%, rgba(255,255,255,1) 52%),
      linear-gradient(180deg, rgba(248,250,252,0.92) 0%, rgba(255,255,255,1) 100%);
  }

  .tdls-wa-headerActions{
    position: absolute;
    top: 14px;
    right: 56px;
  }

  .tdls-wa-title{
    font-family: "Playfair Display", Georgia, serif;
    font-weight: 900;
    letter-spacing: 0.02em;
    font-size: clamp(18px, 2.6vw, 22px);
    color: #128C7E;
  }
  .tdls-wa-brand{ color:#0F2147; }

  .tdls-wa-sub{
    margin-top: 8px;
    font-size: 13px;
    color: rgba(15,33,71,0.72);
  }

  .tdls-wa-status{
    margin-top: 8px;
    border-radius: 12px;
    padding: 10px 12px;
    font-weight: 800;
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(248,250,252,1);
    color: rgba(15,33,71,0.85);
  }
  .tdls-wa-status.is-warn{
    background: rgba(255,248,230,1);
    border-color: rgba(255,228,181,0.95);
    color: rgba(138,90,0,0.95);
  }
  .tdls-wa-status.is-ok{
    background: rgba(232,252,243,1);
    border-color: rgba(180,240,214,0.95);
    color: rgba(10,97,61,0.92);
  }

  .tdls-wa-body{
    padding: 12px 16px 16px 16px;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  .tdls-wa-sectionTitle{
    font-size: 12px;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    font-weight: 900;
    color: rgba(15,33,71,0.62);
    margin: 12px 0 10px 0;
  }

  .tdls-wa-topics{
    display:flex;
    flex-wrap:wrap;
    gap:8px;
  }

  .tdls-wa-topic{
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(255,255,255,1);
    border-radius: 999px;
    padding: 9px 12px;
    font-weight: 900;
    font-size: 13px;
    cursor: pointer;
    color: rgba(15,33,71,0.84);
    transition: transform .10s ease, box-shadow .12s ease, background .12s ease;
  }
  .tdls-wa-topic:hover{ transform: translateY(-1px); box-shadow: 0 12px 26px rgba(0,0,0,0.08); }
  .tdls-wa-topic.is-active{
    border-color: rgba(37,211,102,0.55);
    background: rgba(236,253,245,0.9);
    box-shadow: 0 0 0 4px rgba(37,211,102,0.10);
  }

  .tdls-wa-grid{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .tdls-wa-span2{ grid-column: 1 / -1; }
  @media (max-width: 520px){
    .tdls-wa-grid{ grid-template-columns: 1fr; }
  }

  .tdls-wa-field{ display:grid; gap:6px; }
  .tdls-wa-label{
    font-size: 12px;
    font-weight: 850;
    color: rgba(15,33,71,0.70);
  }

  .tdls-wa-input{
    width:100%;
    min-height:44px;
    padding:10px 12px;
    border-radius:12px;
    border:1px solid rgba(223,227,236,0.95);
    background:#fff;
    font-size:14px;
    outline:none;
    transition: box-shadow .12s ease, border-color .12s ease;
  }
  .tdls-wa-input:focus{
    border-color: rgba(37,99,235,0.55);
    box-shadow: 0 0 0 4px rgba(37,99,235,0.10);
  }

  .tdls-wa-hint{
    font-size:12px;
    color: rgba(138,90,0,0.95);
    font-weight:800;
    line-height:1.25;
  }

  .tdls-wa-textarea{
    width:100%;
    padding:10px 12px;
    border-radius:12px;
    border:1px solid rgba(223,227,236,0.95);
    background:#fff;
    font-size:14px;
    outline:none;
    resize: vertical;
    min-height: 96px;
  }
  .tdls-wa-textarea:focus{
    border-color: rgba(37,99,235,0.55);
    box-shadow: 0 0 0 4px rgba(37,99,235,0.10);
  }

  .tdls-wa-preview{
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(248,250,252,1);
    border-radius: 16px;
    padding: 12px;
  }

  .tdls-wa-previewMeta{
    display:flex;
    justify-content: space-between;
    align-items:center;
    gap:10px;
    margin-bottom:10px;
    font-size:12px;
    color: rgba(15,33,71,0.62);
    font-weight:800;
  }

  .tdls-wa-previewText{
    margin:0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(15,33,71,0.88);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  .tdls-wa-footer{
    padding: 12px 16px 14px 16px;
    border-top: 1px solid rgba(230,233,242,0.9);
    background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,1) 100%);
    display:grid;
    grid-template-columns: 1fr auto;
    gap:10px;
    align-items:center;
  }

  .tdls-wa-primary{
    min-height: 46px;
    border: none;
    border-radius: 14px;
    font-weight: 900;
    font-size: 15px;
    cursor: pointer;
    color: #fff;
    background: linear-gradient(90deg,#25D366 0%,#16e18c 100%);
    box-shadow: 0 14px 34px rgba(37,211,102,0.22);
    transition: transform .12s ease, filter .14s ease, opacity .12s ease;
  }
  .tdls-wa-primary:hover{ filter: brightness(1.02); transform: translateY(-1px); }
  .tdls-wa-primary:disabled{ cursor:not-allowed; opacity:0.65; box-shadow:none; transform:none; }

  .tdls-wa-secondary, .tdls-wa-ghost{
    min-height: 46px;
    padding: 0 14px;
    border-radius: 14px;
    font-weight: 900;
    font-size: 14px;
    cursor: pointer;
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(255,255,255,1);
    color: rgba(15,33,71,0.88);
    transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
  }
  .tdls-wa-secondary:hover, .tdls-wa-ghost:hover{
    transform: translateY(-1px);
    box-shadow: 0 12px 26px rgba(0,0,0,0.08);
    background: rgba(249,250,251,1);
  }
  .tdls-wa-ghost{ min-height: 36px; border-radius: 999px; padding: 0 10px; font-size: 12px; }

  .tdls-wa-alt{
    grid-column: 1 / -1;
    font-size: 13px;
    color: rgba(15,33,71,0.70);
  }
  .tdls-wa-link{
    color: rgba(18,140,126,1);
    font-weight: 900;
    text-decoration: none;
  }
  .tdls-wa-link:hover{ text-decoration: underline; }

  @media (prefers-reduced-motion: reduce){
    .tdls-wa-fab, .tdls-wa-topic, .tdls-wa-primary, .tdls-wa-secondary, .tdls-wa-ghost{ transition:none; }
    .tdls-wa-topic:hover, .tdls-wa-primary:hover, .tdls-wa-secondary:hover, .tdls-wa-ghost:hover{ transform:none; }
  }
`;