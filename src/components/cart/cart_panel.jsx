// FILE: src/components/cart/cart_panel.jsx
"use client";

import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCart as use_cart } from "@/components/common/cart_context";
import { useRouter, usePathname } from "next/navigation";

const NAVY = "#0F2147";
const GOLD = "#A67C37";
const MUTED = "#6B7280";
const BORDER = "#E0E4F2";

// Navbar/promobar base safe zone + extra 0.5" drop
const NAVBAR_BASE_TOP = 96; // your existing safe distance
const HALF_INCH = 48; // ~0.5 inch in px
const NAVBAR_SAFE_TOP = NAVBAR_BASE_TOP + HALF_INCH; // shifted down by 0.5"
const BOTTOM_SAFE = 96; // keep clear from bottomfloatingbar (mobile too)

const AUTO_CLOSE_MS_DEFAULT = 3500;

/**
 * UI-only stabilization window:
 * When cart context is briefly inconsistent during cross-page add-to-cart (common on first-time
 * scope/hydration reconciliation), we keep a merged "best known" display for a short window.
 * This prevents: (1) showing only the newly added item for a moment, then (2) showing the old cart
 * without the newly added line.
 *
 * IMPORTANT: This does NOT change cart state. It only stabilizes what the drawer displays.
 */
const DISPLAY_STABILIZE_WINDOW_MS = 1400;

function money(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "৳0";
  return v.toLocaleString("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2,
  });
}

/**
 * Guest rules:
 * - Guest should not "remember" after tab close.
 * - Clear any legacy guest persistence/cookies when user starts checkout.
 * - Checkout page will handle mode selection modal, not this drawer.
 *
 * NOTE (mismatch fix):
 * Checkout now uses these session/local keys:
 * - "tdlc_guest_checkout_session_v1"
 * - "tdlc_checkout_mode_session_v1"
 * - "tdlc_checkout_profile_override_v1"
 *
 * We clear BOTH legacy keys and the current canonical keys.
 */
function clearGuestCheckoutState() {
  // Canonical/current keys (checkout-page.js / checkout.addressbook.js aligned)
  try {
    sessionStorage.removeItem("tdlc_guest_checkout_session_v1");
  } catch {}
  try {
    sessionStorage.removeItem("tdlc_checkout_mode_session_v1");
  } catch {}
  // Some older builds used local overrides; safe to remove for guest flow only
  try {
    localStorage.removeItem("tdlc_checkout_profile_override_v1");
  } catch {}

  // Legacy / older implementations (keep for backward compatibility)
  try {
    sessionStorage.removeItem("TDLC_GUEST_CHECKOUT_V1");
  } catch {}
  try {
    sessionStorage.removeItem("TDLC_CHECKOUT_GUEST_DRAFT");
  } catch {}
  try {
    sessionStorage.removeItem("TDLC_CHECKOUT_MODE");
  } catch {}
  try {
    sessionStorage.removeItem("tdlc_checkout_mode");
  } catch {}

  // Clear legacy cookie that causes cross-tab / post-close remembering
  try {
    document.cookie = "tdlc_guest_checkout=; Path=/; Max-Age=0; SameSite=Lax";
  } catch {}
}

/* ---------------- cart-context compatibility helpers (non-breaking) ---------------- */

function getCartItemsFromCtx(cartCtx) {
  if (!cartCtx) return [];
  if (Array.isArray(cartCtx.items)) return cartCtx.items;
  if (Array.isArray(cartCtx.lines)) return cartCtx.lines; // ✅ compatibility: some builds expose "lines"
  if (Array.isArray(cartCtx.cart?.items)) return cartCtx.cart.items; // legacy shape support
  if (Array.isArray(cartCtx.cart?.lines)) return cartCtx.cart.lines; // legacy alt
  return [];
}

function getMeta(it) {
  return it && typeof it.metadata === "object" ? it.metadata : {};
}

function getQty(it) {
  const q = Number(it?.quantity ?? it?.qty ?? 0);
  return Number.isFinite(q) ? q : 0;
}

function getUnitPrice(it) {
  const n = Number(it?.unitPrice ?? it?.price ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getStableKey(it, idx) {
  // CartContext guarantees stable lineId/id once created; prefer those.
  const md = getMeta(it);
  return (
    it?.lineId ||
    it?.id ||
    md?.lineId ||
    md?.id ||
    it?.cartLineId ||
    it?.cart_line_id ||
    `cart-item-${idx}`
  );
}

function getTitle(it) {
  const md = getMeta(it);
  return (
    it?.title ||
    it?.name ||
    it?.productName ||
    it?.product_name ||
    md?.title ||
    md?.name ||
    md?.productName ||
    "Untitled product"
  );
}

function getThumb(it) {
  const md = getMeta(it);
  const src =
    it?.thumbnail ||
    it?.image ||
    it?.thumbnailUrl ||
    it?.imageUrl ||
    md?.thumbnail ||
    md?.image ||
    md?.thumbnailUrl ||
    md?.imageUrl ||
    "";
  return typeof src === "string" ? src : "";
}

function getSize(it) {
  const md = getMeta(it);
  return it?.selectedSize || it?.size || md?.selectedSize || md?.size || "";
}

function getColor(it) {
  const md = getMeta(it);
  return it?.selectedColor || it?.color || md?.selectedColor || md?.color || "";
}

function getFit(it) {
  const md = getMeta(it);
  return it?.fit || it?.selectedFit || md?.fit || md?.selectedFit || "";
}

/* ---------------- UI-only merge helpers (display stabilization) ---------------- */

function buildKeyMap(lines) {
  const map = new Map();
  const arr = Array.isArray(lines) ? lines : [];
  arr.forEach((it, idx) => {
    const k = getStableKey(it, idx);
    if (!map.has(k)) map.set(k, it);
  });
  return map;
}

function mergeDisplayLists(primary, secondary) {
  // Keep order of primary first; append items from secondary that are missing in primary.
  const p = Array.isArray(primary) ? primary : [];
  const s = Array.isArray(secondary) ? secondary : [];

  if (!p.length) return s.slice();
  if (!s.length) return p.slice();

  const pMap = buildKeyMap(p);

  const out = p.slice();
  s.forEach((it, idx) => {
    const k = getStableKey(it, idx);
    if (!pMap.has(k)) out.push(it);
  });
  return out;
}

export default function CartPanel() {
  const cartCtx = use_cart?.();
  const router = useRouter();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile has no "hover". We treat touch/pointer interactions inside the panel as "interacting"
  // to avoid auto-closing while user scrolls/reads/taps.
  const [interacting, setInteracting] = useState(false);
  const interactingRef = useRef(false);
  const interactingClearRef = useRef(null);

  const closeTimerRef = useRef(null);
  const lastActiveElRef = useRef(null);
  const closeBtnRef = useRef(null);

  // swipe gesture refs
  const touchStartRef = useRef({ x: 0, y: 0, t: 0 });
  const touchMovedRef = useRef(false);

  // open-source control (event / qty-change) + auto-close overrides
  const lastOpenReasonRef = useRef("unknown"); // "event" | "qty" | "manual"
  const autoCloseMsRef = useRef(AUTO_CLOSE_MS_DEFAULT);
  const allowAutoCloseRef = useRef(true);

  // Cart image cache (prevents “image disappears” when some add-to-cart paths send partial payloads)
  const imageCacheRef = useRef(new Map()); // key => url
  const titleCacheRef = useRef(new Map()); // optional: keep title stable if later payload is partial

  // UI-only stabilization (fix for one-time cross-page add-to-cart mismatch flashes)
  const lastKnownStableCartRef = useRef([]); // updated when not loading
  const stabilizeUntilRef = useRef(0);
  const stabilizeSeedRef = useRef([]); // cart snapshot captured at the start of stabilization window
  const stabilizeOpenAtRef = useRef(0);

  const clearAutoCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    clearAutoCloseTimer();
    setOpen(false);
  }, [clearAutoCloseTimer]);

  const setInteractingSafe = useCallback((v) => {
    interactingRef.current = !!v;
    setInteracting(!!v);
  }, []);

  const bumpInteracting = useCallback(() => {
    // mark interacting immediately and keep it alive briefly after last interaction
    setInteractingSafe(true);
    if (interactingClearRef.current) clearTimeout(interactingClearRef.current);
    interactingClearRef.current = setTimeout(() => {
      setInteractingSafe(false);
      interactingClearRef.current = null;
    }, 1200);
  }, [setInteractingSafe]);

  const scheduleAutoClose = useCallback(
    (msMaybe) => {
      clearAutoCloseTimer();

      // Must match desktop behavior: auto-close after a few seconds unless user interacts.
      if (!open) return;
      if (!allowAutoCloseRef.current) return;

      // Do not auto-close if user is actively interacting or desktop hover is active.
      if (hovered) return;
      if (interactingRef.current) return;

      const ms = Number(
        msMaybe ?? autoCloseMsRef.current ?? AUTO_CLOSE_MS_DEFAULT
      );
      if (!Number.isFinite(ms) || ms <= 0) return;

      closeTimerRef.current = setTimeout(() => {
        setOpen(false);
        closeTimerRef.current = null;
      }, ms);
    },
    [open, hovered, clearAutoCloseTimer]
  );

  // only portal on client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Do not render cart panel on /admin routes (customer/admin fully decoupled)
  // (Keeps admin UX clean; prevents stray overlays/panels on admin screens.)
  const isAdminRoute = useMemo(() => {
    const p = String(pathname || "");
    return p === "/admin" || p.startsWith("/admin/");
  }, [pathname]);

  // device breakpoint (drawer on desktop, bottom-sheet on mobile)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(max-width: 520px)");
    const apply = () => setIsMobile(Boolean(mq.matches));
    apply();

    if (mq.addEventListener) mq.addEventListener("change", apply);
    else mq.addListener(apply);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", apply);
      else mq.removeListener(apply);
    };
  }, []);

  // cleanup timers on unmount
  useEffect(() => {
    return () => {
      try {
        if (interactingClearRef.current)
          clearTimeout(interactingClearRef.current);
      } catch {}
      try {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      } catch {}
    };
  }, []);

  // Close panel on route change (prevents ghost overlay/panel carryover across pages)
  useEffect(() => {
    if (!open) return;
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Listen for global "cart:open-panel" (and provide a stable programmatic hook to avoid missed events)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOpen = (evtOrDetail) => {
      // support both:
      // 1) dispatched event: CustomEvent("cart:open-panel", { detail: {...} })
      // 2) direct call: window.__TDLC_OPEN_CART_PANEL__({ ... })  (legacy)
      // 3) direct call: window.__TDLS_OPEN_CART_PANEL__({ ... })  (current naming)
      const detail = evtOrDetail?.detail || evtOrDetail || {};
      const ms = Number(detail.autoCloseMs);
      if (Number.isFinite(ms) && ms > 0) autoCloseMsRef.current = ms;
      else autoCloseMsRef.current = AUTO_CLOSE_MS_DEFAULT;

      if (typeof detail.allowAutoClose === "boolean") {
        allowAutoCloseRef.current = detail.allowAutoClose;
      } else {
        allowAutoCloseRef.current = true;
      }

      lastOpenReasonRef.current = detail.reason || "event";
      lastActiveElRef.current =
        typeof document !== "undefined" ? document.activeElement : null;

      // Start a short UI stabilization window (display only; no state mutation).
      stabilizeOpenAtRef.current = Date.now();
      stabilizeUntilRef.current =
        stabilizeOpenAtRef.current + DISPLAY_STABILIZE_WINDOW_MS;
      stabilizeSeedRef.current = Array.isArray(lastKnownStableCartRef.current)
        ? lastKnownStableCartRef.current
        : [];

      setOpen(true);
      setHovered(false);
      setInteractingSafe(false);
    };

    const handleOpenEvent = (evt) => handleOpen(evt);

    window.addEventListener("cart:open-panel", handleOpenEvent);

    // Expose stable hooks for any component (QuickView/ProductCard/PDP)
    // Legacy:
    //   window.__TDLC_OPEN_CART_PANEL__?.({ reason:"add-to-cart", autoCloseMs:3500 })
    // Current:
    //   window.__TDLS_OPEN_CART_PANEL__?.({ reason:"add-to-cart", autoCloseMs:3500 })
    try {
      window.__TDLC_OPEN_CART_PANEL__ = handleOpen;
    } catch {}
    try {
      window.__TDLS_OPEN_CART_PANEL__ = handleOpen;
    } catch {}

    return () => {
      window.removeEventListener("cart:open-panel", handleOpenEvent);
      try {
        if (window.__TDLC_OPEN_CART_PANEL__ === handleOpen) {
          delete window.__TDLC_OPEN_CART_PANEL__;
        }
      } catch {}
      try {
        if (window.__TDLS_OPEN_CART_PANEL__ === handleOpen) {
          delete window.__TDLS_OPEN_CART_PANEL__;
        }
      } catch {}
    };
  }, [setInteractingSafe]);

  // Focus close on open, restore focus on close, ESC closes
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (e) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    if (open) {
      const t = setTimeout(() => {
        try {
          closeBtnRef.current?.focus?.();
        } catch {}
      }, 0);
      return () => {
        clearTimeout(t);
        window.removeEventListener("keydown", onKeyDown);
      };
    } else {
      // restore focus when closed
      const prev = lastActiveElRef.current;
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {}
      }
      window.removeEventListener("keydown", onKeyDown);
    }

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Prevent background scroll when open (mobile + desktop)
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!open) return;

    const el = document.documentElement;
    const prevOverflow = el.style.overflow;
    const prevOverscroll = el.style.overscrollBehavior;
    el.style.overflow = "hidden";
    el.style.overscrollBehavior = "none";

    return () => {
      el.style.overflow = prevOverflow;
      el.style.overscrollBehavior = prevOverscroll;
    };
  }, [open]);

  // ───────────────── derive cart data from context ─────────────────
  const items = useMemo(() => getCartItemsFromCtx(cartCtx), [cartCtx]);

  const totals = cartCtx?.totals || cartCtx?.serverTotals || {};
  const loading = !!(
    cartCtx?.loading ||
    cartCtx?.isLoading ||
    cartCtx?.hydrating ||
    cartCtx?.isHydrating
  );

  // Track last-known stable cart for UI stabilization (display only)
  useEffect(() => {
    if (loading) return;
    lastKnownStableCartRef.current = Array.isArray(items) ? items : [];
  }, [items, loading]);

  const subtotal = useMemo(() => {
    if (totals?.subtotal != null) return Number(totals.subtotal);
    if (typeof cartCtx?.subtotal === "number") return Number(cartCtx.subtotal);
    return items.reduce((sum, it) => sum + getQty(it) * getUnitPrice(it), 0);
  }, [items, totals, cartCtx]);

  const itemCount = items.length;
  const totalQty = useMemo(
    () => items.reduce((sum, it) => sum + getQty(it), 0),
    [items]
  );
  const empty = !loading && itemCount === 0;

  // ✅ UI stabilization display list
  const displayItems = useMemo(() => {
    const current = Array.isArray(items) ? items : [];
    if (!open) return current;

    const now = Date.now();
    const until = Number(stabilizeUntilRef.current || 0) || 0;
    const inWindow = now <= until;

    if (!inWindow) return current;

    // Only stabilize aggressively if this open is likely due to add-to-cart.
    const r = String(lastOpenReasonRef.current || "");
    const likelyAdd =
      r === "qty" ||
      r === "event" ||
      r === "add-to-cart" ||
      r.includes("add");

    if (!likelyAdd) return current;

    const seed = Array.isArray(stabilizeSeedRef.current)
      ? stabilizeSeedRef.current
      : [];

    const merged = mergeDisplayLists(current, seed);

    if (!current.length && seed.length) return seed.slice();

    return merged;
  }, [items, open]);

  // Detect add-to-cart across ALL pages even if some emitters fail to dispatch the open event.
  const prevQtyRef = useRef(0);
  const hydratedRef = useRef(false);

  useEffect(() => {
    // avoid “open on first hydration” when cart is restored from storage/server
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      prevQtyRef.current = totalQty;
      return;
    }

    const prev = Number(prevQtyRef.current || 0);
    const curr = Number(totalQty || 0);
    prevQtyRef.current = curr;

    if (!Number.isFinite(prev) || !Number.isFinite(curr)) return;

    if (curr > prev) {
      const p = String(pathname || "");
      const suppress = p.startsWith("/cart") || p.startsWith("/checkout");
      if (!suppress) {
        lastOpenReasonRef.current = "qty";
        allowAutoCloseRef.current = true;
        autoCloseMsRef.current = AUTO_CLOSE_MS_DEFAULT;

        stabilizeOpenAtRef.current = Date.now();
        stabilizeUntilRef.current =
          stabilizeOpenAtRef.current + DISPLAY_STABILIZE_WINDOW_MS;
        stabilizeSeedRef.current = Array.isArray(lastKnownStableCartRef.current)
          ? lastKnownStableCartRef.current
          : [];

        lastActiveElRef.current =
          typeof document !== "undefined" ? document.activeElement : null;
        setOpen(true);
        setHovered(false);
        setInteractingSafe(false);
      }
    }
  }, [totalQty, pathname, setInteractingSafe]);

  // Auto-close scheduling
  useEffect(() => {
    if (!open) {
      clearAutoCloseTimer();
      return;
    }
    scheduleAutoClose(autoCloseMsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (hovered || interacting) {
      clearAutoCloseTimer();
      return;
    }
    scheduleAutoClose(autoCloseMsRef.current);
  }, [hovered, interacting, open, scheduleAutoClose, clearAutoCloseTimer]);

  const onCheckout = () => {
    if (empty) return;

    clearGuestCheckoutState();

    close();
    router.push("/checkout");
  };

  const onViewCart = () => {
    close();
    router.push("/cart");
  };

  const onContinueShopping = () => {
    close();
    router.push("/");
  };

  // swipe close (mobile: drag down; desktop: drag right)
  const onTouchStart = (e) => {
    bumpInteracting();
    const t = e.touches?.[0];
    if (!t) return;
    touchMovedRef.current = false;
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };

  const onTouchMove = (e) => {
    bumpInteracting();
    const t = e.touches?.[0];
    if (!t) return;
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;

    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) touchMovedRef.current = true;
  };

  const onTouchEnd = (e) => {
    bumpInteracting();
    if (!touchMovedRef.current) return;

    const changed = e.changedTouches?.[0];
    if (!changed) return;

    const dx = changed.clientX - touchStartRef.current.x;
    const dy = changed.clientY - touchStartRef.current.y;
    const dt = Math.max(1, Date.now() - touchStartRef.current.t);

    const vy = dy / dt;
    const vx = dx / dt;

    if (isMobile) {
      if (dy > 90 || (dy > 50 && vy > 0.9)) close();
    } else {
      if (dx > 90 || (dx > 50 && vx > 0.9)) close();
    }
  };

  // ───────────────── render via portal ─────────────────
  const variant = isMobile ? "sheet" : "side";
  const state = open ? "open" : "closed";

  const content = (
    <>
      {/* Backdrop overlay */}
      <div
        className="tdlcCartOverlay"
        data-state={state}
        aria-hidden="true"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      />

      <aside
        className="tdlcCartPanel"
        data-variant={variant}
        data-state={state}
        aria-label="Cart panel"
        onMouseEnter={() => {
          setHovered(true);
          clearAutoCloseTimer();
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
        onPointerDown={() => bumpInteracting()}
        onPointerMove={() => bumpInteracting()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          ["--tdlc-top-safe"]: `${NAVBAR_SAFE_TOP}px`,
          ["--tdlc-bottom-safe"]: `${BOTTOM_SAFE}px`,
        }}
      >
        {/* Header */}
        <div className="tdlcCartHeader">
          <div className="tdlcCartBrandRow">
            <span className="tdlcBadge">TDLS · CART</span>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={close}
              aria-label="Close cart panel"
              className="tdlcCloseBtn"
            >
              ×
            </button>
          </div>

          <div className="tdlcCartTitleRow">
            <div className="tdlcCartTitle">Your Cart</div>
            <div className="tdlcCartMeta">
              {empty
                ? "No items added yet."
                : `${totalQty} item${totalQty === 1 ? "" : "s"} · ${money(
                    subtotal
                  )}`}
            </div>
          </div>

          {/* Mobile handle */}
          <div className="tdlcHandle" aria-hidden="true" />
        </div>

        {/* Body */}
        <div
          className="tdlcCartBody"
          onPointerDown={() => bumpInteracting()}
          onScroll={() => bumpInteracting()}
        >
          {loading ? (
            <div className="tdlcStateBlock">
              <div className="tdlcStateTitle">Updating cart…</div>
              <div className="tdlcStateSub">Please wait a moment.</div>
            </div>
          ) : empty ? (
            <div className="tdlcStateBlock">
              <div className="tdlcStateTitle">Your cart is empty</div>
              <div className="tdlcStateSub">
                Add your first TDLS piece and come back here.
              </div>

              <div className="tdlcInlineActions">
                <button
                  type="button"
                  className="tdlcGhostBtn"
                  onClick={onContinueShopping}
                >
                  Continue Shopping
                </button>
              </div>
            </div>
          ) : (
            <ul className="tdlcItemList">
              {displayItems.map((it, idx) => {
                const qty = getQty(it);
                const unit = getUnitPrice(it);
                const line = qty * unit;

                const key = getStableKey(it, idx);
                const rawImg = getThumb(it);
                const rawTitle = getTitle(it);

                // Cache image/title when present; if later payload is partial, keep last known good values.
                if (rawImg) imageCacheRef.current.set(key, rawImg);
                if (rawTitle) titleCacheRef.current.set(key, rawTitle);

                const stableImg = rawImg || imageCacheRef.current.get(key) || "";
                const stableTitle =
                  rawTitle ||
                  titleCacheRef.current.get(key) ||
                  "Untitled product";

                const size = getSize(it);
                const color = getColor(it);
                const fit = getFit(it);

                return (
                  <li key={key} className="tdlcItem">
                    <div className="tdlcThumb">
                      {/* ✅ mismatch fix: fallback sits BEHIND the image (only visible if image fails/hidden) */}
                      <div className="tdlcThumbFallback tdlcThumbFallbackOverlay">
                        TDLS
                      </div>

                      {stableImg ? (
                        <img
                          src={stableImg}
                          alt={stableTitle || "Cart item"}
                          className="tdlcThumbImg"
                          loading="lazy"
                          onError={(e) => {
                            // If a URL fails, do not poison cache; hide the image so fallback shows.
                            try {
                              const img = e.currentTarget;
                              img.style.display = "none";
                            } catch {}
                          }}
                        />
                      ) : null}
                    </div>

                    <div className="tdlcItemInfo">
                      <div className="tdlcItemTop">
                        <div className="tdlcItemTitle">{stableTitle}</div>
                      </div>

                      <div className="tdlcItemMeta">
                        {size ? (
                          <span>
                            Size: <b>{size}</b>
                          </span>
                        ) : null}
                        {color ? (
                          <span>
                            Color: <b>{color}</b>
                          </span>
                        ) : null}
                        {fit ? (
                          <span>
                            Fit: <b>{fit}</b>
                          </span>
                        ) : null}
                      </div>

                      <div className="tdlcItemBottom">
                        <div className="tdlcItemQty">
                          {qty} × {money(unit)}
                        </div>
                        <div className="tdlcItemLine">{money(line)}</div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="tdlcCartFooter" onPointerDown={() => bumpInteracting()}>
          <div className="tdlcFooterLine" />
          <div className="tdlcTotalsRow">
            <div className="tdlcTotalsLabel">Subtotal</div>
            <div className="tdlcTotalsValue">{money(subtotal)}</div>
          </div>
          <div className="tdlcTotalsHint">
            Taxes & shipping will be calculated on checkout.
          </div>

          <div className="tdlcCtaRow">
            <button
              type="button"
              onClick={onViewCart}
              className="tdlcOutlineBtn"
            >
              View Cart
            </button>

            <button
              type="button"
              onClick={onCheckout}
              disabled={empty || loading}
              className="tdlcPrimaryBtn"
            >
              Checkout
            </button>
          </div>

          <div className="tdlcFootnote">
            Secure checkout. Mode selection happens on the checkout page.
          </div>
        </div>

        {/* styles */}
        <style jsx global>{`
          .tdlcCartOverlay {
            position: fixed;
            inset: 0;
            z-index: 11900;
            background: radial-gradient(
              circle at 20% 0%,
              rgba(2, 6, 23, 0.52),
              rgba(2, 6, 23, 0.62)
            );
            opacity: 0;
            pointer-events: none;
            transition: opacity 220ms ease;
            touch-action: manipulation;
          }
          .tdlcCartOverlay[data-state="open"] {
            opacity: 1;
            pointer-events: auto;
          }

          .tdlcCartPanel {
            position: fixed;
            z-index: 12000;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border: 1px solid rgba(224, 228, 242, 0.75);
            background: linear-gradient(
              145deg,
              rgba(255, 255, 255, 0.92),
              rgba(240, 244, 255, 0.98)
            );
            backdrop-filter: blur(14px);
            box-shadow: 0 28px 80px rgba(15, 33, 71, 0.34),
              0 0 0 1px rgba(226, 232, 240, 0.65);
            transition: transform 340ms cubic-bezier(0.22, 0.61, 0.36, 1),
              opacity 240ms ease;
            opacity: 0;
            pointer-events: none;
            overscroll-behavior: contain;
          }

          /* Side drawer variant (desktop/tablet) */
          .tdlcCartPanel[data-variant="side"] {
            top: var(--tdlc-top-safe);
            right: 18px;
            bottom: var(--tdlc-bottom-safe);
            width: min(420px, calc(100vw - 36px));
            border-radius: 26px;
            max-height: calc(
              100vh - (var(--tdlc-top-safe) + var(--tdlc-bottom-safe))
            );
            transform: translateX(110%);
          }
          .tdlcCartPanel[data-variant="side"][data-state="open"] {
            opacity: 1;
            pointer-events: auto;
            transform: translateX(0);
          }

          /* Bottom sheet variant (mobile) */
          .tdlcCartPanel[data-variant="sheet"] {
            --tdlc-sheet-bottom: calc(
              var(--tdlc-bottom-safe) + env(safe-area-inset-bottom)
            );
            left: 0;
            right: 0;
            bottom: var(--tdlc-sheet-bottom);
            top: auto;
            width: 100%;
            height: min(82vh, calc(100vh - var(--tdlc-sheet-bottom) - 10px));
            height: min(82vh, calc(100dvh - var(--tdlc-sheet-bottom) - 10px));
            border-radius: 26px 26px 0 0;
            transform: translateY(110%);
          }
          .tdlcCartPanel[data-variant="sheet"][data-state="open"] {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
          }

          @media (prefers-reduced-motion: reduce) {
            .tdlcCartPanel,
            .tdlcCartOverlay {
              transition: none !important;
            }
          }

          .tdlcCartHeader {
            position: relative;
            padding: 14px 16px 12px;
            background: radial-gradient(
              circle at top left,
              rgba(229, 231, 255, 0.95),
              rgba(248, 250, 252, 0.98)
            );
            border-bottom: 1px solid rgba(224, 228, 242, 0.95);
          }

          .tdlcCartBrandRow {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .tdlcBadge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 999px;
            font-size: 10px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            font-weight: 950;
            color: #f9fafb;
            background: linear-gradient(90deg, ${NAVY}, ${GOLD});
            box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
            user-select: none;
          }

          .tdlcCloseBtn {
            width: 38px;
            height: 38px;
            border-radius: 999px;
            border: 1px solid rgba(224, 228, 242, 0.95);
            background: linear-gradient(135deg, #ffffff, #eef2ff);
            color: ${NAVY};
            font-size: 18px;
            font-weight: 900;
            cursor: pointer;
            box-shadow: 0 12px 26px rgba(2, 6, 23, 0.12);
            transition: transform 120ms ease, box-shadow 120ms ease,
              border-color 120ms ease;
          }
          .tdlcCloseBtn:hover {
            transform: translateY(-1px);
            box-shadow: 0 16px 34px rgba(2, 6, 23, 0.16);
            border-color: rgba(15, 33, 71, 0.5);
          }
          .tdlcCloseBtn:active {
            transform: translateY(0px) scale(0.98);
          }
          .tdlcCloseBtn:focus-visible {
            outline: 2px solid rgba(166, 124, 55, 0.65);
            outline-offset: 2px;
          }

          .tdlcCartTitleRow {
            margin-top: 10px;
          }
          .tdlcCartTitle {
            font-size: 16px;
            font-weight: 950;
            color: ${NAVY};
            letter-spacing: 0.02em;
          }
          .tdlcCartMeta {
            margin-top: 2px;
            font-size: 12px;
            color: ${MUTED};
            font-weight: 700;
          }

          .tdlcHandle {
            display: none;
          }
          .tdlcCartPanel[data-variant="sheet"] .tdlcHandle {
            display: block;
            width: 44px;
            height: 5px;
            border-radius: 999px;
            background: rgba(15, 33, 71, 0.18);
            margin: 10px auto 0;
          }

          .tdlcCartBody {
            flex: 1 1 auto;
            overflow: auto;
            padding: 12px 12px 10px;
            -webkit-overflow-scrolling: touch;
          }

          .tdlcCartBody::-webkit-scrollbar {
            width: 10px;
          }
          .tdlcCartBody::-webkit-scrollbar-thumb {
            background: rgba(15, 33, 71, 0.16);
            border-radius: 999px;
            border: 2px solid rgba(255, 255, 255, 0.65);
          }
          .tdlcCartBody::-webkit-scrollbar-track {
            background: transparent;
          }

          .tdlcStateBlock {
            padding: 18px 12px;
            border: 1px solid rgba(224, 228, 242, 0.9);
            border-radius: 20px;
            background: linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.98),
              rgba(239, 246, 255, 0.98)
            );
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
          }
          .tdlcStateTitle {
            font-size: 14px;
            font-weight: 950;
            color: ${NAVY};
          }
          .tdlcStateSub {
            margin-top: 6px;
            font-size: 12px;
            color: ${MUTED};
            font-weight: 650;
            line-height: 1.45;
          }

          .tdlcInlineActions {
            margin-top: 12px;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }

          .tdlcItemList {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .tdlcItem {
            display: grid;
            grid-template-columns: 78px 1fr;
            gap: 12px;
            padding: 10px;
            border-radius: 20px;
            border: 1px solid rgba(148, 163, 184, 0.35);
            background: linear-gradient(
              140deg,
              rgba(249, 250, 251, 1),
              rgba(239, 246, 255, 1)
            );
            box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
            transition: transform 140ms ease, box-shadow 140ms ease,
              border-color 140ms ease;
          }
          .tdlcItem:hover {
            transform: translateY(-1px);
            box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
            border-color: rgba(15, 33, 71, 0.18);
          }

          .tdlcThumb {
            width: 78px;
            height: 94px;
            border-radius: 18px;
            overflow: hidden;
            border: 1px solid rgba(224, 228, 242, 0.95);
            background: radial-gradient(circle at 30% 10%, #e0e7ff, #f3f4f6);
            position: relative;
          }
          .tdlcThumbImg {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            position: relative;
            z-index: 1;
          }
          .tdlcThumbFallback {
            width: 100%;
            height: 100%;
            display: grid;
            place-items: center;
            font-size: 10px;
            font-weight: 900;
            letter-spacing: 0.18em;
            color: rgba(15, 33, 71, 0.65);
          }
          /* ✅ fallback behind image (only shows if image is missing/hidden) */
          .tdlcThumbFallbackOverlay {
            position: absolute;
            inset: 0;
            background: transparent;
            pointer-events: none;
            z-index: 0;
          }

          .tdlcItemInfo {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .tdlcItemTop {
            display: flex;
            align-items: start;
            justify-content: space-between;
            gap: 10px;
          }

          .tdlcItemTitle {
            font-size: 13px;
            font-weight: 900;
            color: ${NAVY};
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .tdlcItemMeta {
            font-size: 11px;
            color: ${MUTED};
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            line-height: 1.35;
          }
          .tdlcItemMeta b {
            color: ${NAVY};
            font-weight: 900;
          }

          .tdlcItemBottom {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-top: 2px;
          }
          .tdlcItemQty {
            font-size: 12px;
            font-weight: 800;
            color: ${NAVY};
          }
          .tdlcItemLine {
            font-size: 12px;
            font-weight: 950;
            color: ${GOLD};
          }

          .tdlcCartFooter {
            padding: 12px 14px 14px;
            border-top: 1px solid rgba(224, 228, 242, 0.85);
            background: radial-gradient(
              circle at top left,
              #020617,
              #020617 45%,
              #111827 100%
            );
            color: #e5e7eb;
          }
          .tdlcFooterLine {
            height: 3px;
            border-radius: 999px;
            margin-bottom: 10px;
            background: linear-gradient(
              90deg,
              rgba(250, 204, 21, 0.85),
              rgba(166, 124, 55, 0.7)
            );
            box-shadow: 0 0 14px rgba(250, 204, 21, 0.45);
          }

          .tdlcTotalsRow {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .tdlcTotalsLabel {
            font-size: 11px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: #9ca3af;
            font-weight: 900;
          }
          .tdlcTotalsValue {
            font-size: 16px;
            font-weight: 950;
            color: #f9fafb;
          }
          .tdlcTotalsHint {
            margin-top: 6px;
            font-size: 11px;
            color: #9ca3af;
            line-height: 1.35;
          }

          .tdlcCtaRow {
            margin-top: 12px;
            display: grid;
            grid-template-columns: 1fr 1.25fr;
            gap: 10px;
          }

          .tdlcOutlineBtn {
            height: 40px;
            border-radius: 999px;
            border: 1px solid rgba(148, 163, 184, 0.95);
            background: linear-gradient(135deg, #ffffff, #f3f4f6);
            color: ${NAVY};
            font-weight: 950;
            font-size: 12px;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            cursor: pointer;
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.22);
            transition: transform 120ms ease, box-shadow 120ms ease;
          }
          .tdlcOutlineBtn:hover {
            transform: translateY(-1px);
            box-shadow: 0 14px 30px rgba(15, 23, 42, 0.26);
          }
          .tdlcOutlineBtn:active {
            transform: translateY(0px) scale(0.99);
          }

          .tdlcPrimaryBtn {
            height: 40px;
            border-radius: 999px;
            border: none;
            background: linear-gradient(135deg, #fcd34d, #a16207);
            color: #111827;
            font-weight: 950;
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            cursor: pointer;
            box-shadow: 0 14px 34px rgba(250, 204, 21, 0.46);
            transition: transform 120ms ease, box-shadow 120ms ease,
              opacity 120ms ease;
          }
          .tdlcPrimaryBtn:hover {
            transform: translateY(-1px);
            box-shadow: 0 18px 44px rgba(250, 204, 21, 0.52);
          }
          .tdlcPrimaryBtn:active {
            transform: translateY(0px) scale(0.99);
          }
          .tdlcPrimaryBtn:disabled {
            cursor: not-allowed;
            opacity: 0.55;
            transform: none;
            box-shadow: 0 12px 26px rgba(250, 204, 21, 0.26);
          }

          .tdlcGhostBtn {
            height: 38px;
            padding: 0 14px;
            border-radius: 999px;
            border: 1px solid rgba(224, 228, 242, 0.95);
            background: linear-gradient(135deg, #ffffff, #eef2ff);
            color: ${NAVY};
            font-weight: 900;
            font-size: 12px;
            cursor: pointer;
            box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
          }

          .tdlcFootnote {
            margin-top: 10px;
            font-size: 11px;
            color: rgba(229, 231, 235, 0.7);
            line-height: 1.35;
          }

          @media (max-width: 520px) {
            .tdlcCartHeader {
              padding: 12px 14px 10px;
            }
            .tdlcCloseBtn {
              width: 34px;
              height: 34px;
            }
            .tdlcCartTitle {
              font-size: 15px;
            }
            .tdlcCartMeta {
              font-size: 11.5px;
            }

            .tdlcCartBody {
              padding: 10px 10px 8px;
            }

            .tdlcItem {
              grid-template-columns: 70px 1fr;
              padding: 9px;
              border-radius: 18px;
            }
            .tdlcThumb {
              width: 70px;
              height: 86px;
              border-radius: 16px;
            }
            .tdlcItemTitle {
              font-size: 12.5px;
            }
            .tdlcItemMeta {
              font-size: 10.5px;
            }
            .tdlcItemQty,
            .tdlcItemLine {
              font-size: 11.5px;
            }

            .tdlcCartFooter {
              padding: 10px 12px 12px;
            }
            .tdlcTotalsValue {
              font-size: 15px;
            }
            .tdlcOutlineBtn,
            .tdlcPrimaryBtn {
              height: 38px;
              font-size: 11.5px;
              letter-spacing: 0.11em;
            }
          }

          @media (max-height: 420px) and (max-width: 920px) {
            .tdlcCartPanel[data-variant="sheet"] {
              height: min(78vh, calc(100vh - var(--tdlc-sheet-bottom) - 8px));
              height: min(78vh, calc(100dvh - var(--tdlc-sheet-bottom) - 8px));
            }
          }
        `}</style>
      </aside>
    </>
  );

  if (!mounted) return null;
  if (isAdminRoute) return null; // ✅ keep customer/admin decoupled

  return createPortal(content, document.body);
}
