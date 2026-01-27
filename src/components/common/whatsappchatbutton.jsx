//src/components/common/whatsappchatbutton.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

const RAW_WHATSAPP_NUMBER =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WHATSAPP_NUMBER) ||
  "+8801638534389";

const STORAGE_KEY = "tdls_wa_state_v4"; // bump version to avoid legacy UI-state collisions
const STORAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Practical WhatsApp URL/message safety limit (varies by browser); keep conservative.
const MAX_MESSAGE_CHARS = 1400;

const PORTAL_ID = "tdls-wa-portal-root";

export default function Whatsappchatbutton({ pageProduct, sku, size }) {
  const pathname = usePathname();
  const isAdminRoute = typeof pathname === "string" && pathname.startsWith("/admin");
  if (isAdminRoute) return null;

  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState(null); // topic id
  const [draft, setDraft] = useState("");
  const [isOfflineHours, setIsOfflineHours] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedAdmin, setCopiedAdmin] = useState(false);

  // Smart-assist fields (optional, topic-dependent)
  const [fields, setFields] = useState({
    name: "",
    phone: "",
    district: "",
    upazila: "",
    orderId: "",
    preferredSize: "",
    height: "",
    weight: "",
    fitPreference: "",
    question: "",
  });

  // Refs (avoid stale closures + ensure abort-safe hydration)
  const modalRef = useRef(null);
  const openerRef = useRef(null);
  const textareaRef = useRef(null);
  const lastSendAtRef = useRef(0);
  const copyToastTimerRef = useRef(null);
  const copyToastTimerAdminRef = useRef(null);
  const hydrateAbortRef = useRef(null);
  const hasHydratedIdentityRef = useRef(false);

  // Portal target (escapes transforms / z-index wars)
  const [portalEl, setPortalEl] = useState(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    let el = document.getElementById(PORTAL_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = PORTAL_ID;
      // Highest-level portal container; do not rely on app layout stacking contexts.
      el.style.position = "relative";
      el.style.zIndex = "2147483647";
      document.body.appendChild(el);
    }
    setPortalEl(el);
  }, []);

  const fieldsRef = useRef(fields);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const [pageUrl, setPageUrl] = useState("");

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobile =
    typeof navigator !== "undefined" &&
    ((navigator.userAgentData && navigator.userAgentData.mobile) ||
      /Android|webOS|iPhone|iPad|iPod/i.test(ua));

  const WHATSAPP_PHONE = useMemo(
    () => normalizeWhatsAppPhone(RAW_WHATSAPP_NUMBER),
    [RAW_WHATSAPP_NUMBER]
  );

  const topics = useMemo(
    () => [
      { id: "sizes", label: "Sizing help" },
      { id: "availability", label: "Color/size availability" },
      { id: "delivery", label: "Delivery cost & time" },
      { id: "returns", label: "Return / exchange" },
      { id: "fabric", label: "Fabric & care" },
      { id: "human", label: "Talk to a human" },
      { id: "custom", label: "Something else" },
    ],
    []
  );

  const quickPrompts = useMemo(() => {
    return {
      sizes: [
        { id: "size_fit", label: "Fit recommendation", add: "Please recommend the best fit for my body type." },
        { id: "size_compare", label: "Compare sizes", add: "If between two sizes, please advise which one to pick." },
        { id: "size_shrink", label: "Shrinkage info", add: "Please confirm shrinkage after wash and how to care." },
      ],
      availability: [
        { id: "avail_alt", label: "Suggest alternative", add: "If unavailable, please suggest the closest alternative." },
        { id: "avail_restock", label: "Restock ETA", add: "If out of stock, please share expected restock time." },
        { id: "avail_color", label: "Other colors", add: "Please share available color options for this item." },
      ],
      delivery: [
        { id: "del_urgent", label: "Urgent delivery", add: "I need this urgently—please advise fastest option." },
        { id: "del_cod", label: "COD availability", add: "Is Cash on Delivery available for my area?" },
        { id: "del_charge", label: "Delivery charge breakdown", add: "Please confirm delivery charge and ETA clearly." },
      ],
      returns: [
        { id: "ret_exchange", label: "Exchange size", add: "I want to exchange for a different size—please guide me." },
        { id: "ret_policy", label: "Policy confirmation", add: "Please confirm return eligibility and timeline." },
        { id: "ret_pickup", label: "Pickup scheduling", add: "Please advise pickup schedule and any fees." },
      ],
      fabric: [
        { id: "fab_comp", label: "Composition details", add: "Please confirm fabric composition and GSM if applicable." },
        { id: "fab_care", label: "Care instructions", add: "Please share exact wash & care instructions." },
        { id: "fab_skin", label: "Skin comfort", add: "Is it comfortable for sensitive skin and humid weather?" },
      ],
      human: [
        { id: "hum_call", label: "Call-back request", add: "If possible, please assign an agent to assist me." },
        { id: "hum_fast", label: "Urgent help", add: "This is urgent—please respond as soon as possible." },
      ],
      custom: [],
    };
  }, []);

  const [extraNotes, setExtraNotes] = useState([]); // selected quick prompts (stable order)

  /**
   * Layout safety:
   * - Keep FAB above BFBar (already handled)
   * - When modal opens: enforce safe top/bottom clearance from Navbar & BFBar
   */
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
        ".bottomfloatingbar",
        ".BottomFloatingBar",
        ".tdls-bfbar",
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

    const applyOffsets = () => {
      try {
        // BFBar height (visible only)
        const bf = findBFBarEl();
        let bfH = 0;
        if (bf) {
          const rect = bf.getBoundingClientRect();
          const isVisible = rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
          bfH = isVisible ? Math.max(0, Math.round(rect.height)) : 0;
        }
        if (!bfH) {
          const fallback = readCSSPx("--tdls-bottom-offset");
          if (fallback) bfH = fallback;
        }
        root.style.setProperty("--tdls-wa-bfbar-offset", `${bfH}px`);

        // Navbar height (only count when it effectively occupies the top)
        const nav = findNavbarEl();
        let navH = 0;
        if (nav) {
          const rect = nav.getBoundingClientRect();
          const topish = rect.top <= 8 && rect.bottom > 0;
          const isVisible = rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
          navH = topish && isVisible ? Math.max(0, Math.round(rect.height)) : 0;
        }
        if (!navH) {
          const fallback = readCSSPx("--tdls-navbar-offset");
          if (fallback) navH = fallback;
        }
        root.style.setProperty("--tdls-wa-nav-offset", `${navH}px`);

        // Modal safe paddings
        root.style.setProperty("--tdls-wa-modal-pad-top", `calc(1.2in + ${navH}px)`);
        root.style.setProperty("--tdls-wa-modal-pad-bottom", `calc(1.2in + ${bfH}px)`);
      } catch {
        // ignore
      }
    };

    applyOffsets();

    let raf = 0;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyOffsets);
    };

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });

    const mo = new MutationObserver(() => onResize());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });

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

  // --- Online/offline ---
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

  // --- Dhaka live/offline hours (10:00–20:00 Asia/Dhaka) ---
  useEffect(() => {
    const check = () => {
      const hour = getHourInTimeZone("Asia/Dhaka");
      setIsOfflineHours(!(hour >= 10 && hour < 20));
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // --- Capture URL (client-safe) ---
  useEffect(() => {
    try {
      setPageUrl(window.location.href || "");
    } catch {
      setPageUrl("");
    }
  }, []);

  // --- Restore state on open (with TTL) ---
  useEffect(() => {
    if (!open) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = safeJsonParse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const ts = Number(parsed.ts || 0);
      if (ts && Number.isFinite(ts) && Date.now() - ts > STORAGE_TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      if (parsed.intent) setIntent(String(parsed.intent));
      if (typeof parsed.draft === "string") setDraft(parsed.draft);

      if (Array.isArray(parsed.extraNotes)) {
        const clean = parsed.extraNotes
          .filter((x) => typeof x === "string")
          .map((x) => x.slice(0, 48))
          .slice(0, 8);
        setExtraNotes(clean);
      }

      if (parsed.fields && typeof parsed.fields === "object") {
        setFields((prev) => ({ ...prev, ...sanitizeFields(parsed.fields) }));
      }
    } catch {
      // ignore
    }
  }, [open]);

  // --- Persist state (debounced + idle-friendly) ---
  useEffect(() => {
    if (!open) return;

    const write = () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            intent,
            draft: draft || "",
            fields,
            extraNotes,
            ts: Date.now(),
          })
        );
      } catch {
        // ignore
      }
    };

    let t = null;
    let idleId = null;

    t = setTimeout(() => {
      try {
        if (typeof window !== "undefined" && "requestIdleCallback" in window) {
          idleId = window.requestIdleCallback(write, { timeout: 450 });
        } else {
          write();
        }
      } catch {
        write();
      }
    }, 220);

    return () => {
      if (t) clearTimeout(t);
      if (idleId && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        try {
          window.cancelIdleCallback(idleId);
        } catch {
          // ignore
        }
      }
    };
  }, [open, intent, draft, fields, extraNotes]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setCopiedAdmin(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current);
      if (copyToastTimerAdminRef.current) clearTimeout(copyToastTimerAdminRef.current);
      if (hydrateAbortRef.current) hydrateAbortRef.current.abort();
    };
  }, []);

  // --- Body scroll lock + focus trap + ESC (with scrollbar-gap compensation) ---
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarGap > 0) document.body.style.paddingRight = `${scrollbarGap}px`;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll(
          'button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
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

    const focusTimer = setTimeout(() => {
      const topicFirst = modalRef.current?.querySelector('input[name="tdls-wa-topic"]');
      if (topicFirst) topicFirst.focus();
      if (intent === "custom" && textareaRef.current) textareaRef.current.focus();
    }, 40);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      document.removeEventListener("keydown", onKeyDown);
      openerRef.current?.focus?.();
    };
  }, [open, intent]);

  const track = useCallback((name, payload = {}) => {
    try {
      window.dispatchEvent(new CustomEvent("tdls-analytics", { detail: { name, payload } }));
    } catch {
      // ignore
    }
  }, []);

  // --- Advanced: hydrate identity from session/customer (only-if-empty, abort-safe) ---
  const hydrateIdentity = useCallback(async () => {
    if (!open) return;
    if (hasHydratedIdentityRef.current) return;

    const current = fieldsRefSnapshot(fieldsRef.current);
    const needName = !cleanLine(current.name);
    const needPhone = !cleanLine(current.phone);
    const needUpazila = !cleanLine(current.upazila);
    const needDistrict = !cleanLine(current.district);

    if (!needName && !needPhone && !needUpazila && !needDistrict) {
      hasHydratedIdentityRef.current = true;
      return;
    }

    if (hydrateAbortRef.current) hydrateAbortRef.current.abort();
    const ac = new AbortController();
    hydrateAbortRef.current = ac;

    const applyIfEmpty = (patch) => {
      setFields((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(patch || {})) {
          const nowVal = cleanLine(prev?.[k] || "");
          const newVal = cleanLine(v || "");
          if (!nowVal && newVal) next[k] = newVal;
        }
        return next;
      });
    };

    try {
      const sessionRes = await fetch("/api/auth/session", { cache: "no-store", signal: ac.signal });
      const session = await safeReadJson(sessionRes);
      const sUser = session?.user || null;

      if (sUser && typeof sUser === "object") {
        applyIfEmpty({
          name: cleanLine(sUser.name || ""),
          phone: cleanLine(sUser.phone || ""),
        });
      }

      if (sUser?.id) {
        const meRes = await fetch("/api/customers/me", { cache: "no-store", signal: ac.signal });
        const me = await safeReadJson(meRes);

        applyIfEmpty({
          name: cleanLine(me?.name || ""),
          phone: cleanLine(me?.phone || ""),
          upazila: cleanLine(me?.defaultAddress?.city || ""),
          district: cleanLine(me?.defaultAddress?.state || ""),
        });
      }

      hasHydratedIdentityRef.current = true;
    } catch {
      // ignore
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    hydrateIdentity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      hasHydratedIdentityRef.current = false;
      if (hydrateAbortRef.current) hydrateAbortRef.current.abort();
    }
  }, [open]);

  const selectedPromptsText = useMemo(() => {
    if (!intent) return [];
    const list = quickPrompts[intent] || [];
    const chosen = new Set(extraNotes);
    return list.filter((p) => chosen.has(p.id)).map((p) => p.add);
  }, [intent, extraNotes, quickPrompts]);

  const smartPreview = useMemo(() => {
    const msg = composeMessage({
      intent,
      draft,
      fields,
      pageProduct,
      sku,
      size,
      pageUrl,
      brandSignature: "— TDLS Support",
      includeOfflineNote: isOfflineHours,
      extraLines: selectedPromptsText,
    });

    return ensureMessageLimit(msg, MAX_MESSAGE_CHARS);
  }, [intent, draft, fields, pageProduct, sku, size, pageUrl, isOfflineHours, selectedPromptsText]);

  // “Admin auto reply” preview (topic-aware)
  const adminReplyPreview = useMemo(() => {
    const msg = composeAdminAutoReply({
      intent,
      fields,
      pageProduct,
      sku,
      size,
      pageUrl,
      isOfflineHours,
      isOnline,
    });
    return ensureMessageLimit(msg, MAX_MESSAGE_CHARS);
  }, [intent, fields, pageProduct, sku, size, pageUrl, isOfflineHours, isOnline]);

  const canSend = useMemo(() => {
    if (!intent) return false;
    if (intent === "custom") return Boolean((draft || "").trim());
    return true;
  }, [intent, draft]);

  const phoneHint = useMemo(() => {
    const p = cleanLine(fields.phone);
    if (!p) return "";
    return isProbablyValidBDPhone(p) ? "" : "Phone looks invalid. Use 01XXXXXXXXX or +8801XXXXXXXXX.";
  }, [fields.phone]);

  const remainingChars = useMemo(() => {
    const n = smartPreview.length;
    return Math.max(0, MAX_MESSAGE_CHARS - n);
  }, [smartPreview]);

  const isTrimmed = useMemo(() => smartPreview.includes("(Trimmed for WhatsApp)"), [smartPreview]);

  const copyToClipboard = useCallback(async () => {
    const text = smartPreview || "";
    if (!text) return;

    track("whatsapp_copy_clicked", { page_url: pageUrl, topic: intent });

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
      if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current);
      copyToastTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }, [smartPreview, track, pageUrl, intent]);

  const copyAdminReplyToClipboard = useCallback(async () => {
    const text = adminReplyPreview || "";
    if (!text) return;

    track("whatsapp_admin_reply_copy_clicked", { page_url: pageUrl, topic: intent });

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

      setCopiedAdmin(true);
      if (copyToastTimerAdminRef.current) clearTimeout(copyToastTimerAdminRef.current);
      copyToastTimerAdminRef.current = setTimeout(() => setCopiedAdmin(false), 1400);
    } catch {
      setCopiedAdmin(false);
    }
  }, [adminReplyPreview, track, pageUrl, intent]);

  const openWhatsApp = useCallback(() => {
    const now = Date.now();
    if (now - lastSendAtRef.current < 2500) return;
    lastSendAtRef.current = now;

    if (!canSend) return;

    const text = encodeURIComponent(smartPreview);

    if (isMobile) {
      const deepLink = `whatsapp://send?phone=${WHATSAPP_PHONE}&text=${text}`;
      const webLink = `https://wa.me/${WHATSAPP_PHONE}?text=${text}`;

      track("whatsapp_message_sent", {
        page_url: pageUrl,
        mode: intent === "custom" ? "custom" : "topic",
        topic: intent === "custom" ? null : intent,
        channel: "mobile",
      });

      let fallbackTimer = null;

      const cleanup = () => {
        try {
          document.removeEventListener("visibilitychange", onVis);
        } catch {
          // ignore
        }
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      };

      const onVis = () => {
        if (document.visibilityState === "hidden") cleanup();
      };

      try {
        document.addEventListener("visibilitychange", onVis);
        window.location.href = deepLink;

        fallbackTimer = setTimeout(() => {
          try {
            window.open(webLink, "_blank", "noopener,noreferrer");
          } catch {
            // ignore
          } finally {
            cleanup();
          }
        }, 850);
      } catch {
        try {
          window.open(webLink, "_blank", "noopener,noreferrer");
        } catch {
          // ignore
        } finally {
          cleanup();
        }
      }

      setOpen(false);
      return;
    }

    const desktopUrl = `https://web.whatsapp.com/send?phone=${WHATSAPP_PHONE}&text=${text}`;

    track("whatsapp_message_sent", {
      page_url: pageUrl,
      mode: intent === "custom" ? "custom" : "topic",
      topic: intent === "custom" ? null : intent,
      channel: "desktop",
    });

    window.open(desktopUrl, "_blank", "noopener,noreferrer");
    setOpen(false);
  }, [WHATSAPP_PHONE, canSend, intent, isMobile, pageUrl, smartPreview, track]);

  const onOpen = useCallback(() => {
    setOpen(true);
    track("whatsapp_opened", { page_url: pageUrl, is_offline: isOfflineHours, is_online: isOnline });
  }, [isOfflineHours, isOnline, pageUrl, track]);

  const onClose = useCallback(() => setOpen(false), []);

  const resetAll = useCallback(() => {
    setIntent(null);
    setDraft("");
    setExtraNotes([]);
    setFields({
      name: "",
      phone: "",
      district: "",
      upazila: "",
      orderId: "",
      preferredSize: "",
      height: "",
      weight: "",
      fitPreference: "",
      question: "",
    });
    track("whatsapp_reset_clicked", { page_url: pageUrl });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [track, pageUrl]);

  const togglePrompt = useCallback((promptId) => {
    setExtraNotes((prev) => {
      const cleanPrev = Array.isArray(prev) ? prev.filter((x) => typeof x === "string") : [];
      const idx = cleanPrev.indexOf(promptId);
      if (idx >= 0) {
        const next = cleanPrev.slice();
        next.splice(idx, 1);
        return next;
      }
      return cleanPrev.concat([promptId]).slice(0, 8);
    });
  }, []);

  const primaryCtaLabel = useMemo(() => {
    if (!isOnline) return "Copy message";
    return "Open WhatsApp";
  }, [isOnline]);

  const primaryCtaAction = useCallback(() => {
    if (!isOnline) return copyToClipboard();
    return openWhatsApp();
  }, [isOnline, copyToClipboard, openWhatsApp]);

  const fabStatus = useMemo(() => {
    if (!isOnline) return "offline";
    if (isOfflineHours) return "away";
    return "online";
  }, [isOnline, isOfflineHours]);

  const ariaTitleId = "tdls-wa-title";
  const ariaDescId = "tdls-wa-desc";

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
        aria-labelledby={ariaTitleId}
        aria-describedby={ariaDescId}
      >
        <button
          type="button"
          className="tdls-wa-close"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close"
        >
          <span aria-hidden="true">×</span>
        </button>

        <header className="tdls-wa-header">
          <div className="tdls-wa-title" id={ariaTitleId}>
            Chat with <span className="tdls-wa-title__brand">THE DNA LAB</span>
          </div>

          <div className="tdls-wa-sub" id={ariaDescId}>
            <div className="tdls-wa-hours">
              Live chat: <strong>10:00–20:00</strong> Bangladesh Standard Time (GMT+6)
            </div>

            {!isOnline ? (
              <div className="tdls-wa-offline" role="status">
                You appear to be offline. You can still copy the message and send when connected.
              </div>
            ) : isOfflineHours ? (
              <div className="tdls-wa-offline" role="status">
                We’re offline now. Message us anyway—We’ll reply next business day.
              </div>
            ) : (
              <div className="tdls-wa-online" role="status">
                We’re online. Typical response: within business hours.
              </div>
            )}
          </div>

          <div className="tdls-wa-headerActions">
            <button type="button" className="tdls-wa-ghost" onClick={resetAll}>
              Reset
            </button>
          </div>
        </header>

        <section className="tdls-wa-body">
          <div className="tdls-wa-sectionTitle">Choose a topic</div>
          <div className="tdls-wa-topics" role="radiogroup" aria-label="WhatsApp chat topic">
            {topics.map((t) => (
              <label key={t.id} className={`tdls-wa-topic ${intent === t.id ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="tdls-wa-topic"
                  value={t.id}
                  checked={intent === t.id}
                  onChange={() => {
                    setIntent(t.id);
                    setExtraNotes([]); // topic changed → reset add-ons
                    track("whatsapp_topic_selected", { page_url: pageUrl, topic: t.id });
                  }}
                />
                <span className="tdls-wa-topic__label">{t.label}</span>
                <span className="tdls-wa-topic__chev" aria-hidden="true">
                  →
                </span>
              </label>
            ))}
          </div>

          {!!intent && (quickPrompts[intent]?.length || 0) > 0 && (
            <>
              <div className="tdls-wa-sectionTitle">AI add-ons</div>
              <div className="tdls-wa-chips" aria-label="AI add-ons">
                {quickPrompts[intent].map((p) => {
                  const active = extraNotes.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={active}
                      className={`tdls-wa-chip ${active ? "is-active" : ""}`}
                      onClick={() => {
                        togglePrompt(p.id);
                        track("whatsapp_prompt_toggled", { page_url: pageUrl, topic: intent, prompt: p.id });
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="tdls-wa-sectionTitle">Smart Assist</div>
          <div className="tdls-wa-grid">
            <Field
              label="Name"
              value={fields.name}
              onChange={(v) => setFields((p) => ({ ...p, name: v }))}
              placeholder="Your name"
              inputMode="text"
              autoComplete="name"
            />
            <Field
              label="Phone"
              value={fields.phone}
              onChange={(v) => setFields((p) => ({ ...p, phone: v }))}
              placeholder="+8801XXXXXXXXX"
              inputMode="tel"
              autoComplete="tel"
              hint={phoneHint}
            />

            {(intent === "delivery" || intent === "returns") && (
              <>
                <Field
                  label="District"
                  value={fields.district}
                  onChange={(v) => setFields((p) => ({ ...p, district: v }))}
                  placeholder="e.g., Dhaka"
                  inputMode="text"
                />
                <Field
                  label="Upazila/Area"
                  value={fields.upazila}
                  onChange={(v) => setFields((p) => ({ ...p, upazila: v }))}
                  placeholder="e.g., Gulshan"
                  inputMode="text"
                />
              </>
            )}

            {intent === "returns" && (
              <Field
                label="Order ID (if available)"
                value={fields.orderId}
                onChange={(v) => setFields((p) => ({ ...p, orderId: v }))}
                placeholder="Order number"
                inputMode="text"
              />
            )}

            {intent === "sizes" && (
              <>
                <Field
                  label="Preferred size"
                  value={fields.preferredSize}
                  onChange={(v) => setFields((p) => ({ ...p, preferredSize: v }))}
                  placeholder="e.g., M / L"
                  inputMode="text"
                />
                <Field
                  label="Height"
                  value={fields.height}
                  onChange={(v) => setFields((p) => ({ ...p, height: v }))}
                  placeholder='e.g., 5&#39;9&quot; or 175 cm'
                  inputMode="text"
                />
                <Field
                  label="Weight"
                  value={fields.weight}
                  onChange={(v) => setFields((p) => ({ ...p, weight: v }))}
                  placeholder="e.g., 72 kg"
                  inputMode="text"
                />
                <Field
                  label="Fit preference"
                  value={fields.fitPreference}
                  onChange={(v) => setFields((p) => ({ ...p, fitPreference: v }))}
                  placeholder="Slim / Regular / Relaxed"
                  inputMode="text"
                />
              </>
            )}

            {intent && intent !== "custom" && (
              <FieldLong
                label="Question (optional)"
                value={fields.question}
                onChange={(v) => setFields((p) => ({ ...p, question: v }))}
                placeholder="Add any specific detail you want us to address…"
              />
            )}
          </div>

          {intent === "custom" && (
            <div className="tdls-wa-custom">
              <div className="tdls-wa-sectionTitle">Your message</div>
              <textarea
                ref={textareaRef}
                rows={3}
                className="tdls-wa-textarea"
                placeholder="Type your message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </div>
          )}

          <div className="tdls-wa-previewWrap">
            <div className="tdls-wa-previewHead">
              <div className="tdls-wa-sectionTitle" style={{ margin: 0 }}>
                Conversation preview
              </div>
              <div className="tdls-wa-counter" aria-label="Character count">
                {smartPreview.length} chars · {remainingChars} left
              </div>
            </div>

            {isTrimmed ? (
              <div className="tdls-wa-pill" role="status">
                Preview trimmed to fit WhatsApp safe length.
              </div>
            ) : null}

            <div className="tdls-wa-chat">
              <div className="tdls-wa-bubbleRow is-customer">
                <div className="tdls-wa-avatar is-customer" aria-hidden="true">
                  {cleanLine(fields?.name || "").slice(0, 1).toUpperCase() || "U"}
                </div>
                <div className="tdls-wa-bubble is-customer" aria-label="Customer message preview">
                  <div className="tdls-wa-bubbleLabel">You</div>
                  <div className="tdls-wa-bubbleText">{smartPreview}</div>
                </div>
              </div>

              <div className="tdls-wa-bubbleRow is-admin">
                <div className="tdls-wa-avatar is-admin" aria-hidden="true">
                  TD
                </div>
                <div className="tdls-wa-bubble is-admin" aria-label="Admin auto reply preview">
                  <div className="tdls-wa-bubbleLabel">TDLS Support (Auto Reply)</div>
                  <div className="tdls-wa-bubbleText">{adminReplyPreview}</div>
                </div>
              </div>
            </div>

            <div className="tdls-wa-previewActions">
              <button type="button" className="tdls-wa-ghost" onClick={copyToClipboard} disabled={!intent}>
                {copied ? "Copied" : "Copy customer message"}
              </button>

              <button
                type="button"
                className="tdls-wa-ghost"
                onClick={copyAdminReplyToClipboard}
                disabled={!intent}
              >
                {copiedAdmin ? "Copied" : "Copy admin reply"}
              </button>

              <span className="tdls-wa-srOnly" aria-live="polite">
                {copied ? "Message copied to clipboard." : ""}
                {copiedAdmin ? "Admin reply copied to clipboard." : ""}
              </span>
            </div>
          </div>
        </section>

        <footer className="tdls-wa-footer">
          <div className="tdls-wa-footerRow">
            <button type="button" className="tdls-wa-primary" onClick={primaryCtaAction} disabled={!canSend}>
              {primaryCtaLabel}
            </button>

            <button type="button" className="tdls-wa-secondary" onClick={copyToClipboard} disabled={!intent}>
              Copy
            </button>
          </div>

          <div className="tdls-wa-alt">
            <span>or email </span>
            <a
              href="mailto:support@thednalabstore.com"
              onClick={() => track("whatsapp_email_fallback_clicked", { page_url: pageUrl })}
            >
              support@thednalabstore.com
            </a>
          </div>
        </footer>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        aria-label="Chat on WhatsApp"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        className={`tdls-wa-fab is-${fabStatus}`}
        onClick={onOpen}
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
      >
        <span className={`tdls-wa-fab__status is-${fabStatus}`} aria-hidden="true" />
        <svg className="tdls-wa-fab__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12.04 2C6.57 2 2.14 6.3 2.14 11.6c0 1.87.55 3.69 1.6 5.25L2 22l5.33-1.67c1.49.78 3.16 1.2 4.88 1.2 5.47 0 9.9-4.3 9.9-9.6S17.51 2 12.04 2Zm0 17.67c-1.54 0-3.03-.38-4.35-1.1l-.32-.17-3.12.98.96-3.02-.2-.31c-.9-1.41-1.38-3.03-1.38-4.69 0-4.58 3.88-8.31 8.61-8.31 4.74 0 8.61 3.73 8.61 8.31 0 4.58-3.87 8.31-8.61 8.31Zm5.02-6.02c-.21.58-1.05 1.11-1.67 1.24-.43.09-.98.15-3.15-.66-2.79-1.03-4.59-3.7-4.72-3.87-.13-.17-1.14-1.46-1.14-2.8 0-1.33.7-1.98.95-2.25.24-.27.53-.34.7-.34.17 0 .35 0 .5.01.16.01.38-.06.59.45.21.51.72 1.77.78 1.89.06.13.1.28.02.45-.08.17-.13.28-.25.43-.12.15-.26.34-.37.45-.13.13-.26.26-.11.5.15.25.66 1.06 1.43 1.71.99.84 1.83 1.1 2.1 1.21.27.13.42.1.58-.06.16-.16.66-.74.83-.99.17-.25.35-.21.59-.13.24.09 1.54.72 1.8.84.26.13.44.19.5.29.06.1.06.58-.15 1.16Z"
          />
        </svg>
        <span className="tdls-wa-fab__badge" aria-hidden="true">
          Chat
        </span>
      </button>

      {/* Portal modal to body to eliminate stacking-context / z-index interference */}
      {portalEl && modalTree ? createPortal(modalTree, portalEl) : null}

      <style>{styles}</style>
    </>
  );
}

/* ------------------------------ UI helpers ------------------------------ */

function Field({ label, value, onChange, placeholder, inputMode, autoComplete, hint }) {
  return (
    <label className="tdls-wa-field">
      <span className="tdls-wa-field__label">{label}</span>
      <input
        className="tdls-wa-input"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
      />
      {hint ? <span className="tdls-wa-hint">{hint}</span> : null}
    </label>
  );
}

function FieldLong({ label, value, onChange, placeholder }) {
  return (
    <label className="tdls-wa-field tdls-wa-field--span2">
      <span className="tdls-wa-field__label">{label}</span>
      <textarea
        className="tdls-wa-textarea tdls-wa-textarea--compact"
        rows={2}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

/* ------------------------------ Message logic ------------------------------ */

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function safeReadJson(res) {
  try {
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeWhatsAppPhone(raw) {
  const s = String(raw || "").trim();
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "8801638534389";
  if (digits.startsWith("0")) return `88${digits}`; // 01... -> 8801...
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("16")) return `880${digits}`; // 16... -> 88016...
  return digits;
}

function sanitizeFields(obj) {
  const safe = {};
  const allowed = [
    "name",
    "phone",
    "district",
    "upazila",
    "orderId",
    "preferredSize",
    "height",
    "weight",
    "fitPreference",
    "question",
  ];
  for (const k of allowed) {
    const v = obj?.[k];
    safe[k] = typeof v === "string" ? v.slice(0, 220) : "";
  }
  return safe;
}

function cleanLine(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureMessageLimit(msg, maxChars) {
  const s = String(msg || "");
  if (s.length <= maxChars) return s;
  const trimmed = s.slice(0, Math.max(0, maxChars - 18)).trimEnd();
  return `${trimmed}\n\n(Trimmed for WhatsApp)`;
}

function composeMessage({
  intent,
  draft,
  fields,
  pageProduct,
  sku,
  size,
  pageUrl,
  brandSignature,
  includeOfflineNote,
  extraLines = [],
}) {
  const topic = String(intent || "");
  const name = cleanLine(fields?.name);
  const phone = cleanLine(fields?.phone);
  const district = cleanLine(fields?.district);
  const upazila = cleanLine(fields?.upazila);
  const orderId = cleanLine(fields?.orderId);
  const preferredSize = cleanLine(fields?.preferredSize);
  const height = cleanLine(fields?.height);
  const weight = cleanLine(fields?.weight);
  const fitPreference = cleanLine(fields?.fitPreference);
  const question = cleanLine(fields?.question);

  const header = name ? `Hi, I’m ${name}.` : "Hi!";
  const phoneLine = phone ? `Phone: ${phone}` : "";

  const contextLines = [];
  if (pageProduct) contextLines.push(`Product: ${cleanLine(pageProduct)}`);
  if (sku) contextLines.push(`SKU: ${cleanLine(sku)}`);
  if (size) contextLines.push(`Size (shown): ${cleanLine(size)}`);
  if (pageUrl) contextLines.push(`Page: ${pageUrl}`);

  const assist = [];

  if (topic === "sizes") {
    assist.push("I need sizing guidance.");
    if (preferredSize) assist.push(`Preferred size: ${preferredSize}`);
    if (height) assist.push(`Height: ${height}`);
    if (weight) assist.push(`Weight: ${weight}`);
    if (fitPreference) assist.push(`Fit preference: ${fitPreference}`);
    assist.push("Please suggest the best size for me.");
  } else if (topic === "availability") {
    assist.push("Could you confirm color/size availability for this item?");
  } else if (topic === "delivery") {
    assist.push("I want delivery cost & ETA.");
    if (district || upazila) assist.push(`Location: ${[upazila, district].filter(Boolean).join(", ")}`);
    assist.push("Please share delivery charge and expected delivery time.");
  } else if (topic === "returns") {
    assist.push("I need return/exchange support.");
    if (orderId) assist.push(`Order ID: ${orderId}`);
    if (district || upazila) assist.push(`Pickup location: ${[upazila, district].filter(Boolean).join(", ")}`);
    assist.push("Please guide me through the steps and requirements.");
  } else if (topic === "fabric") {
    assist.push("Please share fabric composition and care instructions.");
  } else if (topic === "human") {
    assist.push("Please connect me to a human agent.");
  } else if (topic === "custom") {
    const d = cleanLine(draft);
    assist.push(d || "I have a question.");
  } else {
    assist.push("I need help with my order/product.");
  }

  if (question && topic !== "custom") {
    assist.push(`Question: ${question}`);
  }

  const lines = [];
  lines.push(header);

  if (includeOfflineNote) {
    lines.push("I understand you’re currently offline—please reply next business day.");
  }

  lines.push(...assist);

  for (const x of extraLines) {
    const v = cleanLine(x);
    if (v) lines.push(v);
  }

  if (phoneLine) lines.push(phoneLine);

  if (contextLines.length) {
    lines.push("");
    lines.push(...contextLines);
  }

  lines.push("");
  lines.push(brandSignature || "— Support");

  return lines.join("\n").trim();
}

function composeAdminAutoReply({ intent, fields, pageProduct, sku, size, pageUrl, isOfflineHours, isOnline }) {
  const topic = String(intent || "");
  const name = cleanLine(fields?.name);
  const phone = cleanLine(fields?.phone);
  const district = cleanLine(fields?.district);
  const upazila = cleanLine(fields?.upazila);
  const orderId = cleanLine(fields?.orderId);
  const preferredSize = cleanLine(fields?.preferredSize);
  const height = cleanLine(fields?.height);
  const weight = cleanLine(fields?.weight);
  const fitPreference = cleanLine(fields?.fitPreference);
  const question = cleanLine(fields?.question);

  const hello = name ? `Assalamu Alaikum ${name}!` : "Assalamu Alaikum!";
  const awayLine = isOnline && isOfflineHours ? "We’re currently away-hours, but we received your message." : "";
  const context = [];

  if (pageProduct) context.push(`Item: ${cleanLine(pageProduct)}`);
  if (sku) context.push(`SKU: ${cleanLine(sku)}`);
  if (size) context.push(`Size shown: ${cleanLine(size)}`);

  const loc = [upazila, district].filter(Boolean).join(", ");
  const lines = [];

  lines.push(hello);
  if (awayLine) lines.push(awayLine);

  if (topic === "sizes") {
    lines.push("Sizing help — here’s the fastest way we confirm the right size:");
    if (height || weight)
      lines.push(
        `Your details: ${[height && `Height ${height}`, weight && `Weight ${weight}`].filter(Boolean).join(" · ")}`
      );
    if (fitPreference) lines.push(`Fit preference: ${fitPreference}`);
    if (preferredSize) lines.push(`Preferred size: ${preferredSize}`);
    lines.push(
      "Please share your chest measurement (in inches/cm) if possible. If not, we can still recommend based on height/weight and fit preference."
    );
    lines.push("If you prefer a clean fitted look, choose the closer size. For comfort/relaxed feel, go one size up.");
  } else if (topic === "availability") {
    lines.push("Availability — we’ll confirm stock for you right now.");
    if (context.length) lines.push(context.join(" · "));
    lines.push(
      "Please tell us your preferred color and size. If it’s out of stock, we’ll suggest the closest available alternative."
    );
  } else if (topic === "delivery") {
    lines.push("Delivery cost & time — here’s what we need to confirm the exact charge and ETA:");
    if (loc) lines.push(`Your area: ${loc}`);
    lines.push("1) Your city/area (Upazila)  2) Full address landmark (optional)  3) Payment method (COD / Online).");
    lines.push("Once confirmed, we’ll share delivery charge and estimated delivery time clearly.");
  } else if (topic === "returns") {
    lines.push("Return / exchange — we can help you quickly.");
    if (orderId) lines.push(`Order ID: ${orderId}`);
    if (loc) lines.push(`Pickup location: ${loc}`);
    lines.push(
      "Please confirm: (1) issue type (size / defect / wrong item), (2) package condition, (3) preferred exchange size (if any)."
    );
    lines.push("After confirmation, we’ll schedule pickup (where applicable) and guide you step-by-step.");
  } else if (topic === "fabric") {
    lines.push("Fabric & care — here are the standard care steps for best longevity:");
    lines.push("• Wash inside-out  • Mild detergent  • Avoid harsh bleach  • Low/medium iron (inside-out)  • Dry in shade");
    lines.push("If you tell us your skin sensitivity or climate concern, we’ll advise the best wear/care approach.");
  } else if (topic === "human") {
    lines.push("Understood — we’ll connect you to a human agent.");
    if (phone) lines.push(`Contact: ${phone}`);
    lines.push("Please share your best time to respond (today) and your exact concern in one line for fastest help.");
  } else if (topic === "custom") {
    lines.push("Thanks for reaching out. We received your message and will respond shortly.");
    if (question) lines.push(`Your note: ${question}`);
    lines.push("If this is about an order, please share your Order ID and phone number used at checkout.");
  } else {
    lines.push("Thanks for messaging TDLS Support.");
    lines.push("Please share your key details (topic + order id if any), and we’ll assist immediately.");
  }

  if (question && topic !== "custom") {
    lines.push("");
    lines.push(`Your question: ${question}`);
  }

  if (pageUrl) {
    lines.push("");
    lines.push(`Reference: ${pageUrl}`);
  }

  lines.push("");
  lines.push("— TDLS Support");

  return lines.filter(Boolean).join("\n").trim();
}

/* ------------------------------ Time/phone utilities ------------------------------ */

function getHourInTimeZone(tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === "hour")?.value;
    const hour = Number(hourPart);
    return Number.isFinite(hour) ? hour : new Date().getHours();
  } catch {
    return new Date().getHours();
  }
}

function isProbablyValidBDPhone(input) {
  const s = String(input || "").trim();
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return true;
  if (digits.length === 11 && digits.startsWith("01")) return true;
  if (digits.length === 13 && digits.startsWith("8801")) return true;
  return false;
}

function fieldsRefSnapshot(fields) {
  return {
    name: fields?.name || "",
    phone: fields?.phone || "",
    district: fields?.district || "",
    upazila: fields?.upazila || "",
  };
}

/* ------------------------------ Styles ------------------------------ */

const styles = `
  :root{
    /* defaults (JS will overwrite with measured heights) */
    --tdls-wa-nav-offset: 0px;
    --tdls-wa-bfbar-offset: 0px;

    /* Requested safe clearance: > 1.2in from top navbar and bottom BFBar */
    --tdls-wa-modal-pad-top: calc(1.2in + 0px);
    --tdls-wa-modal-pad-bottom: calc(1.2in + 0px);
  }

  .tdls-wa-fab {
    position: fixed;

    /* EXACT REQUEST:
       - 1.5 inch from right edge
       - 1 inch above BFBar (dynamic height)
    */
    right: calc(1.5in + env(safe-area-inset-right));
    bottom: calc(
      max(16px, 1in) +
      env(safe-area-inset-bottom) +
      var(--tdls-wa-bfbar-offset, var(--tdls-bottom-offset, 0px))
    );

    width: 58px;
    height: 58px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.22);
    cursor: pointer;
    z-index: 2147483000;
    display: grid;
    place-items: center;
    outline: none;
    -webkit-tap-highlight-color: transparent;

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
  .tdls-wa-fab:focus-visible {
    transform: translateY(-1px) scale(1.04);
    filter: saturate(1.04);
    box-shadow:
      0 22px 74px rgba(22,204,79,0.26),
      0 0 0 6px rgba(25,230,153,0.12);
  }

  .tdls-wa-fab__icon { width: 30px; height: 30px; color: #ffffff; }

  .tdls-wa-fab__badge {
    position: absolute;
    right: 66px;
    bottom: 12px;
    padding: 7px 10px;
    background: rgba(255,255,255,0.96);
    border: 1px solid rgba(231,234,231,0.95);
    border-radius: 999px;
    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.01em;
    color: #0F2147;
    box-shadow: 0 14px 38px rgba(0,0,0,0.14);
    user-select: none;
    white-space: nowrap;
    backdrop-filter: blur(8px);
  }

  .tdls-wa-fab__status {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 10px;
    height: 10px;
    border-radius: 999px;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.98);
  }
  .tdls-wa-fab__status.is-online { background: #22c55e; }
  .tdls-wa-fab__status.is-away { background: #f59e0b; }
  .tdls-wa-fab__status.is-offline { background: #ef4444; }

  /* Portal-backed modal layer (no stacking-context leaks) */
  .tdls-wa-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;

    /* Stronger scrim so underlying “TDLS” / watermarks cannot bleed through */
    background: rgba(2, 6, 23, 0.74);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);

    display: grid;
    place-items: center;

    padding:
      calc(14px + env(safe-area-inset-top) + var(--tdls-wa-modal-pad-top))
      calc(14px + env(safe-area-inset-right))
      calc(14px + env(safe-area-inset-bottom) + var(--tdls-wa-modal-pad-bottom))
      calc(14px + env(safe-area-inset-left));

    animation: tdlsWaFade .16s ease;
    isolation: isolate;
  }

  .tdls-wa-modal {
    width: min(520px, 92vw);

    max-height: calc(100dvh - (28px + env(safe-area-inset-top) + env(safe-area-inset-bottom) + var(--tdls-wa-modal-pad-top) + var(--tdls-wa-modal-pad-bottom)));
    max-height: calc(100svh - (28px + env(safe-area-inset-top) + env(safe-area-inset-bottom) + var(--tdls-wa-modal-pad-top) + var(--tdls-wa-modal-pad-bottom)));

    overflow: hidden;

    /* OPAQUE modal to eliminate background bleed */
    background: #ffffff;
    border: 1px solid rgba(231,234,231,0.92);
    border-radius: 22px;
    box-shadow: 0 34px 140px rgba(0,0,0,0.38);

    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr auto;

    isolation: isolate;
  }

  .tdls-wa-close {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 50;

    width: 40px;
    height: 40px;
    border-radius: 999px;
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(255,255,255,0.94);
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
    color: rgba(15,33,71,0.84);
    box-shadow: 0 14px 34px rgba(0,0,0,0.14);

    display: grid;
    place-items: center;
    user-select: none;
  }
  .tdls-wa-close:hover { filter: brightness(0.99); }
  .tdls-wa-close:focus-visible { outline: 2px solid rgba(37,99,235,0.7); outline-offset: 2px; }

  .tdls-wa-header {
    padding: 18px 16px 12px 16px;
    border-bottom: 1px solid rgba(230,233,242,0.9);
    position: relative;
    z-index: 1;
    background:
      radial-gradient(120% 120% at 12% 0%, rgba(15,33,71,0.06) 0%, rgba(255,255,255,1) 52%),
      linear-gradient(180deg, rgba(248,250,252,0.92) 0%, rgba(255,255,255,1) 100%);
  }

  .tdls-wa-headerActions {
    position: absolute;
    top: 14px;
    right: 56px;
    z-index: 2;
  }

  .tdls-wa-title {
    font-family: "Playfair Display", Georgia, serif;
    font-weight: 900;
    letter-spacing: 0.02em;
    font-size: clamp(18px, 2.6vw, 22px);
    color: #128C7E;
  }
  .tdls-wa-title__brand { color: #0F2147; }

  .tdls-wa-sub {
    margin-top: 8px;
    font-size: 13px;
    color: rgba(15,33,71,0.72);
  }
  .tdls-wa-hours strong { color: rgba(15,33,71,0.92); }

  .tdls-wa-offline {
    margin-top: 8px;
    background: rgba(255,248,230,1);
    border: 1px solid rgba(255,228,181,0.95);
    color: rgba(138,90,0,0.95);
    border-radius: 12px;
    padding: 10px 12px;
    font-weight: 750;
  }
  .tdls-wa-online {
    margin-top: 8px;
    background: rgba(232,252,243,1);
    border: 1px solid rgba(180,240,214,0.95);
    color: rgba(10,97,61,0.92);
    border-radius: 12px;
    padding: 10px 12px;
    font-weight: 750;
  }

  .tdls-wa-body {
    padding: 12px 16px;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 18px;
  }

  .tdls-wa-sectionTitle {
    font-size: 12px;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    font-weight: 900;
    color: rgba(15,33,71,0.62);
    margin: 10px 0 10px 0;
  }

  .tdls-wa-topics {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    margin-bottom: 14px;
  }

  .tdls-wa-topic {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(255,255,255,1);
    border-radius: 14px;
    cursor: pointer;
    min-height: 46px;
    transition: transform .12s ease, box-shadow .14s ease, background .14s ease;
  }
  .tdls-wa-topic:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 30px rgba(0,0,0,0.08);
    background: rgba(249,250,251,1);
  }
  .tdls-wa-topic.is-selected {
    border-color: rgba(37,211,102,0.40);
    box-shadow: 0 0 0 4px rgba(37,211,102,0.10);
    background: rgba(236, 253, 245, 0.78);
  }
  .tdls-wa-topic input { accent-color: #25D366; }
  .tdls-wa-topic__label {
    font-size: 14px;
    font-weight: 850;
    color: rgba(15,33,71,0.92);
  }
  .tdls-wa-topic__chev {
    color: rgba(15,33,71,0.55);
    font-weight: 900;
  }

  .tdls-wa-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .tdls-wa-chip {
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(255,255,255,1);
    border-radius: 999px;
    padding: 8px 10px;
    font-weight: 900;
    font-size: 12px;
    cursor: pointer;
    color: rgba(15,33,71,0.84);
    transition: transform .10s ease, box-shadow .12s ease, background .12s ease;
  }
  .tdls-wa-chip:hover { transform: translateY(-1px); }
  .tdls-wa-chip.is-active {
    border-color: rgba(37,211,102,0.55);
    background: rgba(236,253,245,0.9);
    box-shadow: 0 0 0 4px rgba(37,211,102,0.10);
  }

  .tdls-wa-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  @media (max-width: 520px) {
    .tdls-wa-grid { grid-template-columns: 1fr; }
    .tdls-wa-fab__badge { display: none; }
    .tdls-wa-modal { width: min(520px, 94vw); }
  }

  .tdls-wa-field { display: grid; gap: 6px; }
  .tdls-wa-field--span2 { grid-column: 1 / -1; }

  .tdls-wa-field__label {
    font-size: 12px;
    font-weight: 850;
    color: rgba(15,33,71,0.70);
  }

  .tdls-wa-input {
    width: 100%;
    min-height: 44px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(223,227,236,0.95);
    background: rgba(255,255,255,1);
    font-size: 14px;
    outline: none;
    transition: box-shadow .12s ease, border-color .12s ease, background .12s ease;
  }
  .tdls-wa-input:focus {
    border-color: rgba(37,99,235,0.55);
    box-shadow: 0 0 0 4px rgba(37,99,235,0.10);
    background: rgba(255,255,255,1);
  }

  .tdls-wa-hint {
    font-size: 12px;
    color: rgba(138,90,0,0.95);
    font-weight: 800;
    line-height: 1.25;
  }

  .tdls-wa-custom { margin-top: 10px; }

  .tdls-wa-textarea {
    width: 100%;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(223,227,236,0.95);
    background: rgba(255,255,255,1);
    font-size: 14px;
    resize: vertical;
    outline: none;
    min-height: 96px;
    transition: box-shadow .12s ease, border-color .12s ease, background .12s ease;
  }
  .tdls-wa-textarea:focus {
    border-color: rgba(37,99,235,0.55);
    box-shadow: 0 0 0 4px rgba(37,99,235,0.10);
    background: rgba(255,255,255,1);
  }
  .tdls-wa-textarea--compact { min-height: 64px; resize: none; }

  .tdls-wa-previewWrap {
    margin-top: 14px;
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(248,250,252,1);
    border-radius: 16px;
    padding: 12px;
  }
  .tdls-wa-previewHead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .tdls-wa-counter {
    font-size: 12px;
    color: rgba(15,33,71,0.62);
    font-weight: 800;
  }
  .tdls-wa-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 900;
    color: rgba(15,33,71,0.78);
    background: rgba(255,255,255,1);
    border: 1px solid rgba(230,233,242,0.95);
    padding: 8px 10px;
    border-radius: 999px;
    margin-bottom: 10px;
  }

  .tdls-wa-chat {
    display: grid;
    gap: 12px;
    margin-top: 6px;
  }
  .tdls-wa-bubbleRow {
    display: grid;
    grid-template-columns: 36px 1fr;
    gap: 10px;
    align-items: flex-start;
  }
  .tdls-wa-avatar {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-weight: 900;
    font-size: 12px;
    user-select: none;
    border: 1px solid rgba(230,233,242,0.95);
    box-shadow: 0 10px 22px rgba(0,0,0,0.08);
  }
  .tdls-wa-avatar.is-customer {
    background: rgba(255,255,255,1);
    color: rgba(15,33,71,0.90);
  }
  .tdls-wa-avatar.is-admin {
    background: linear-gradient(135deg, rgba(37,211,102,0.22) 0%, rgba(20,183,137,0.18) 100%);
    color: rgba(15,33,71,0.92);
  }

  .tdls-wa-bubble {
    border-radius: 16px;
    padding: 10px 12px;
    border: 1px solid rgba(230,233,242,0.95);
    background: rgba(255,255,255,1);
    box-shadow: 0 14px 28px rgba(0,0,0,0.06);
    overflow: hidden;
  }
  .tdls-wa-bubbleLabel {
    font-size: 12px;
    font-weight: 900;
    color: rgba(15,33,71,0.60);
    margin-bottom: 6px;
    letter-spacing: 0.02em;
  }
  .tdls-wa-bubbleText {
    white-space: pre-wrap;
    font-size: 13px;
    line-height: 1.5;
    color: rgba(15,33,71,0.88);
  }
  .tdls-wa-bubble.is-admin {
    background:
      radial-gradient(120% 140% at 10% 0%, rgba(37,211,102,0.10) 0%, rgba(255,255,255,1) 55%),
      rgba(255,255,255,1);
  }

  .tdls-wa-previewActions {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
  }

  .tdls-wa-footer {
    padding: 12px 16px 14px 16px;
    border-top: 1px solid rgba(230,233,242,0.9);
    background: linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(248,250,252,1) 100%);
    display: grid;
    gap: 10px;
  }

  .tdls-wa-footerRow {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: center;
  }

  .tdls-wa-primary {
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
  .tdls-wa-primary:hover { filter: brightness(1.02); transform: translateY(-1px); }
  .tdls-wa-primary:disabled {
    cursor: not-allowed;
    opacity: 0.65;
    box-shadow: none;
    transform: none;
  }
  .tdls-wa-primary:focus-visible { outline: 2px solid rgba(37,99,235,0.7); outline-offset: 2px; }

  .tdls-wa-secondary, .tdls-wa-ghost {
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
  .tdls-wa-secondary:hover, .tdls-wa-ghost:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 26px rgba(0,0,0,0.08);
    background: rgba(249,250,251,1);
  }
  .tdls-wa-secondary:disabled, .tdls-wa-ghost:disabled { opacity: 0.65; cursor: not-allowed; box-shadow: none; transform: none; }
  .tdls-wa-ghost { min-height: 36px; border-radius: 999px; padding: 0 10px; font-size: 12px; }

  .tdls-wa-alt {
    font-size: 13px;
    color: rgba(15,33,71,0.70);
  }
  .tdls-wa-alt a {
    color: rgba(18,140,126,1);
    font-weight: 900;
    text-decoration: none;
  }
  .tdls-wa-alt a:hover { text-decoration: underline; }

  .tdls-wa-srOnly {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes tdlsWaFade {
    from { opacity: 0; transform: scale(0.985); }
    to { opacity: 1; transform: scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .tdls-wa-backdrop { animation: none; }
    .tdls-wa-fab, .tdls-wa-primary, .tdls-wa-secondary, .tdls-wa-ghost, .tdls-wa-topic, .tdls-wa-chip {
      transition: none;
    }
    .tdls-wa-topic:hover, .tdls-wa-chip:hover, .tdls-wa-secondary:hover, .tdls-wa-ghost:hover { transform: none; }
  }
`;
