// FILE: src/components/checkout/checkout-page.js
"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";

import PaymentMethods from "./payment-methods";
import Summary from "./summary";
import GoBackButton from "./go-back-button";

import Navbar from "@/components/common/navbar";
import BottomFloatingBar from "@/components/common/bottomfloatingbar";

import CheckoutAddressForm from "./checkout.addressform";
import { OtpDialog, CheckoutModeDialog } from "./checkout.dialogs";

import {
  NAVY,
  MUTED,
  BORDER,
  titleCase,
  normalizeBDPhone,
  isValidBDMobile,
  normalizeAddress,
  dedupePreserveOrder,
  coerceAddressForSummary,
  toServerPayload,
  tryJson,
  book,
  profile,
  isAddressComplete,
  addressesEqual,
} from "./checkout.addressbook";

import {
  purgeLegacyCartKeysIfCanonicalExists,
  snapshotFromLocalStorage,
  snapshotFromWindow,
  persistSnapshot,
  buildFreshCartSnapshot,
  clearClientCartEverywhere,
  clearServerCartIfAny,
} from "./checkout.cart";

/**
 * Storage keys
 * - Guest must NOT persist across tabs; use sessionStorage only.
 * - Account mode may persist (localStorage).
 */
const SS_GUEST_KEY = "tdlc_guest_checkout_session_v1";
const LS_ACCOUNT_PROFILE_OVERRIDE_KEY = "tdlc_checkout_profile_override_v1";
const SS_CHECKOUT_MODE_KEY = "tdlc_checkout_mode_session_v1";
const SS_CHECKOUT_METHOD_KEY = "tdlc_checkout_method_session_v1";
const LS_CHECKOUT_METHOD_KEY = "checkout_method";

/** OTP is used ONLY at COD confirmation (both guest + account). */
const COD_OTP_PURPOSE = "cod_confirm";

/* ---------- normalize payment method tokens ---------- */
function normalizeMethod(m) {
  if (!m) return null;
  const s = String(m).trim().toUpperCase();
  if (s === "COD" || s === "CASH" || s === "CASH_ON_DELIVERY") return "COD";
  if (s === "BKASH" || s === "B-KASH") return "BKASH";
  if (s === "NAGAD") return "NAGAD";
  if (s === "SSL" || s === "SSLCOMMERZ" || s === "SSLCOMMERZ_GATEWAY") return "SSL";
  if (s === "STRIPE") return "STRIPE";
  return s;
}

/* ---------------- Guest draft helpers (sessionStorage only) ---------------- */
function readGuestDraft() {
  try {
    const raw = sessionStorage.getItem(SS_GUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeGuestDraft(draft) {
  try {
    sessionStorage.setItem(SS_GUEST_KEY, JSON.stringify(draft || {}));
  } catch {}
}
function clearGuestDraft() {
  try {
    sessionStorage.removeItem(SS_GUEST_KEY);
  } catch {}
}

function readCheckoutModePref() {
  try {
    const raw = sessionStorage.getItem(SS_CHECKOUT_MODE_KEY);
    const v = String(raw || "").toLowerCase();
    if (v === "guest") return "guest";
  } catch {}
  return null;
}
function writeCheckoutModePref(mode) {
  try {
    if (!mode) sessionStorage.removeItem(SS_CHECKOUT_MODE_KEY);
    else sessionStorage.setItem(SS_CHECKOUT_MODE_KEY, String(mode));
  } catch {}
}

function readAccountProfileOverride() {
  try {
    const raw = localStorage.getItem(LS_ACCOUNT_PROFILE_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}
function writeAccountProfileOverride(p) {
  try {
    localStorage.setItem(LS_ACCOUNT_PROFILE_OVERRIDE_KEY, JSON.stringify(p || {}));
  } catch {}
}
function clearAccountProfileOverride() {
  try {
    localStorage.removeItem(LS_ACCOUNT_PROFILE_OVERRIDE_KEY);
  } catch {}
}

function readCheckoutMethod(isGuest) {
  try {
    return isGuest
      ? sessionStorage.getItem(SS_CHECKOUT_METHOD_KEY)
      : localStorage.getItem(LS_CHECKOUT_METHOD_KEY);
  } catch {
    return null;
  }
}
function writeCheckoutMethod(isGuest, method) {
  try {
    const v = method ? String(method) : "";
    if (isGuest) {
      if (!v) sessionStorage.removeItem(SS_CHECKOUT_METHOD_KEY);
      else sessionStorage.setItem(SS_CHECKOUT_METHOD_KEY, v);
      return;
    }
    if (!v) localStorage.removeItem(LS_CHECKOUT_METHOD_KEY);
    else localStorage.setItem(LS_CHECKOUT_METHOD_KEY, v);
  } catch {}
}

/* ---------------- OTP API facades ---------------- */
async function requestOtp(identifier, channel = "sms", purpose = COD_OTP_PURPOSE, opts = {}) {
  const raw = String(channel || "sms").toLowerCase();
  const normalized = raw === "email" ? "EMAIL" : raw === "whatsapp" ? "WHATSAPP" : "SMS";

  const payload = { identifier, channel: normalized, purpose };
  if (opts?.allowGuest) {
    payload.allowGuest = true;
    payload.guestCheckout = true;
  }

  async function doReq(path) {
    const r = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let j = {};
    try {
      j = await r.json();
    } catch {}
    return { ok: r.ok && (j.ok === undefined || j.ok === true), j, status: r.status };
  }

  const primaryPath = opts?.path || "/api/auth/request-otp";
  let res = await doReq(primaryPath);

  const errCode = res?.j?.error || res?.j?.code || res?.j?.message;
  if (
    !res.ok &&
    opts?.allowGuest &&
    (errCode === "USER_NOT_FOUND" || String(errCode || "").includes("USER_NOT_FOUND"))
  ) {
    res = await doReq("/api/orders/request-otp");
  }
  return res;
}

async function verifyOtpApi(identifier, code, purpose = COD_OTP_PURPOSE) {
  const r = await fetch("/api/auth/verify-otp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, code, purpose }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j?.ok !== false, j };
}

/* ---------------- tiny UI helpers ---------------- */
function ModalShell({ open, title, subtitle, onClose, children }) {
  if (!open) return null;
  return (
    <div className="tdls-modal" role="dialog" aria-modal="true">
      <div className="tdls-sheet">
        <div className="tdls-sheet-head">
          <div>
            <div className="tdls-sheet-title">{title}</div>
            {subtitle ? <div className="tdls-sheet-sub">{subtitle}</div> : null}
          </div>
          <button className="tdls-sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="tdls-sheet-body">{children}</div>
      </div>

      <style jsx>{`
        .tdls-modal {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.34);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9998;
          padding: 14px;
        }
        .tdls-sheet {
          width: min(860px, 96vw);
          max-height: min(88vh, 880px);
          overflow: auto;
          background: #fff;
          border-radius: 18px;
          border: 1px solid ${BORDER};
          box-shadow: 0 18px 48px rgba(15, 33, 71, 0.28);
        }
        .tdls-sheet-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          padding: 14px 14px 10px;
          border-bottom: 1px solid ${BORDER};
        }
        .tdls-sheet-title {
          font-weight: 900;
          color: ${NAVY};
          font-size: 16px;
        }
        .tdls-sheet-sub {
          margin-top: 2px;
          color: ${MUTED};
          font-weight: 700;
          font-size: 12px;
          line-height: 1.35;
        }
        .tdls-sheet-x {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          border: 1px solid ${BORDER};
          background: #fff;
          font-size: 22px;
          cursor: pointer;
          flex: 0 0 auto;
        }
        .tdls-sheet-body {
          padding: 14px;
        }
      `}</style>
    </div>
  );
}

export default function CheckoutPage() {
  // ACCOUNT MODE STATE
  const [addresses, setAddresses] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [shipping, setShipping] = useState(null);
  const [billing, setBilling] = useState(null);

  const [billingDifferent, setBillingDifferent] = useState(false);
  const [shippingEditorOpen, setShippingEditorOpen] = useState(false);
  const [billingEditorOpen, setBillingEditorOpen] = useState(false);
  const [editingShipping, setEditingShipping] = useState(null);
  const [editingBilling, setEditingBilling] = useState(null);

  const [userInfo, setUserInfo] = useState({
    id: "",
    name: "",
    email: "",
    phone: "",
    phoneVerified: false,
  });
  const [defaultKey, setDefaultKey] = useState(null);

  // BOTH MODES
  const [methodSelected, setMethodSelected] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [showGatewayWarning, setShowGatewayWarning] = useState(false);

  const [cartId, setCartId] = useState(null);
  const [cartSnapshot, setCartSnapshot] = useState(null);

  const [toast, setToast] = useState("");
  const [placeOrderCtaWarning, setPlaceOrderCtaWarning] = useState("");

  // OTP
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpIdentifier, setOtpIdentifier] = useState("");
  const [otpTtl, setOtpTtl] = useState(90);
  const otpResolverRef = useRef(null);
  const lastOtpRef = useRef(null);

  const preOtpSnapshotRef = useRef(null);

  // SESSION + CHECKOUT MODE
  const [sessionChecked, setSessionChecked] = useState(false);
  const [checkoutMode, setCheckoutMode] = useState(null); // "account" | "guest" | null
  const [modeDialogOpen, setModeDialogOpen] = useState(false);

  // GUEST STATE (session-only)
  const [guestDraft, setGuestDraft] = useState({
    profile: { name: "", phone: "", email: "" },
    shipping: null,
    billingDifferent: false,
    billing: null,
  });

  const [guestShipValidateSignal, setGuestShipValidateSignal] = useState(0);
  const [guestBillValidateSignal, setGuestBillValidateSignal] = useState(0);
  const lastGuestShipSigRef = useRef("");
  const lastGuestBillSigRef = useRef("");

  const isGuest = checkoutMode === "guest";
  const methodCanon = normalizeMethod(methodSelected);

  /* ---------------- legacy event path support (kept) ---------------- */
  useEffect(() => {
    const onPlace = (evt) => {
      const m = normalizeMethod(evt?.detail?.methodSelected);
      if (m) setMethodSelected(m);
      placeOrder(evt?.detail);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("checkout:place-order", onPlace);
      window.__onPlaceOrder = (payload) => {
        const m = normalizeMethod(payload?.methodSelected);
        if (m) setMethodSelected(m);
        placeOrder(payload);
      };
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("checkout:place-order", onPlace);
        if (window.__onPlaceOrder) {
          try {
            delete window.__onPlaceOrder;
          } catch {}
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gotoLogin = useCallback(() => {
    const dest = `/login?redirect=${encodeURIComponent(
      typeof window !== "undefined" ? window.location.pathname || "/checkout" : "/checkout"
    )}`;
    window.location.href = dest;
  }, []);

  const gotoSignup = useCallback(() => {
    const dest = `/signup?redirect=${encodeURIComponent(
      typeof window !== "undefined" ? window.location.pathname || "/checkout" : "/checkout"
    )}`;
    window.location.href = dest;
  }, []);

  const openModeDialog = useCallback((message) => {
    if (message) setToast(message);
    setModeDialogOpen(true);
  }, []);

  const pickSelected = useCallback(
    (list) => list.find((a) => a._key === defaultKey) || list[0] || null,
    [defaultKey]
  );

  const select = useCallback((addr) => {
    if (!addr) return;
    setSelectedKey(addr._key);
    setShipping(addr);
    try {
      localStorage.setItem("checkout_address", JSON.stringify(addr));
    } catch {}
  }, []);

  async function fetchSessionUserNoRedirect() {
    try {
      const r = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json().catch(() => ({}));
      const id = j?.user?.id;
      if (!id) return null;
      return {
        id,
        name: j?.user?.name || "",
        email: j?.user?.email || "",
        phone: j?.user?.phone || "",
        phoneVerified: !!(j?.user?.phoneVerified || j?.user?.phoneVerifiedAt),
      };
    } catch {
      return null;
    }
  }

  /* --------------------
   * INIT: load everything in parallel on mount
   * - Cart snapshot starts immediately (not click-triggered)
   * - Account: address bundle + profile in parallel
   * - Guest: draft in sessionStorage loaded immediately
   * -------------------- */
  useEffect(() => {
    (async () => {
      setToast("");
      purgeLegacyCartKeysIfCanonicalExists();

      // Start cart preload immediately (do not block UI)
      const cartPromise = buildFreshCartSnapshot(setCartId).catch(() => null);
      cartPromise.then((snap) => {
        if (snap?.items?.length) setCartSnapshot(snap);
      });

      // Guest draft early
      const draft = typeof window !== "undefined" ? readGuestDraft() : null;
      if (draft) setGuestDraft((p) => ({ ...p, ...draft }));

      // Checkout-only profile override (account)
      const profOverride = typeof window !== "undefined" ? readAccountProfileOverride() : null;
      if (profOverride && typeof profOverride === "object") {
        setUserInfo((prev) => ({ ...prev, ...profOverride }));
      }

      // Session user
      const sessionUser = await fetchSessionUserNoRedirect();

      if (sessionUser?.id) {
        setCheckoutMode("account");
        setUserInfo((prev) => ({ ...prev, ...sessionUser }));

        // Account hydrate: bundle + profile in parallel
        const [bundleRes, me] = await Promise.allSettled([
          book.bundle().catch(() => ({ ok: false, list: [], def: null })),
          profile.read().catch(() => ({})),
        ]);

        const bundle = bundleRes.status === "fulfilled" ? bundleRes.value : { ok: false, list: [], def: null };
        const meObj = me.status === "fulfilled" ? me.value : {};

        let currentUser = { ...sessionUser };
        if (meObj?.id) {
          currentUser = {
            ...currentUser,
            id: meObj.id,
            name: meObj.name ?? currentUser.name,
            email: meObj.email ?? currentUser.email,
            phone: meObj.phone ?? currentUser.phone,
            phoneVerified:
              !!(meObj.phoneVerified || meObj.phoneVerifiedAt) || !!currentUser.phoneVerified,
          };
        }
        setUserInfo((prev) => ({ ...prev, ...currentUser }));

        let list = dedupePreserveOrder(bundle?.list || []);
        const def = bundle?.def || list.find((a) => a.isDefault) || null;

        setAddresses(list);
        if (def?._key) setDefaultKey(def._key);

        const initial = def || pickSelected(list);
        if (initial) select(initial);

        // restore overrides (kept)
        try {
          const s = JSON.parse(localStorage.getItem("checkout_address_shipping"));
          if (s) setShipping(normalizeAddress(s, 0));
        } catch {}
        try {
          const b = JSON.parse(localStorage.getItem("checkout_address_billing"));
          if (b) setBilling(normalizeAddress(b, 0));
        } catch {}
        try {
          const savedMethod = localStorage.getItem(LS_CHECKOUT_METHOD_KEY);
          if (savedMethod) setMethodSelected(normalizeMethod(savedMethod));
        } catch {}

        setSessionChecked(true);
        return;
      }

      // Not logged in -> require explicit mode choice (session-only preference)
      const pref = typeof window !== "undefined" ? readCheckoutModePref() : null;
      if (pref === "guest") {
        setCheckoutMode("guest");
        setModeDialogOpen(false);
        setSessionChecked(true);

        setMethodSelected(null);
        writeCheckoutMethod(true, "");
        return;
      }

      setCheckoutMode(null);
      setModeDialogOpen(true);
      setSessionChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickSelected, select]);

  // Close OTP modal if mode becomes invalid
  useEffect(() => {
    if (checkoutMode !== "account" && checkoutMode !== "guest") {
      setOtpOpen(false);
      lastOtpRef.current = null;
      otpResolverRef.current = null;
    }
  }, [checkoutMode]);

  // Keep selected shipping synced to refreshed list
  useEffect(() => {
    if (!selectedKey) return;
    const now = addresses.find((a) => a._key === selectedKey);
    if (now) setShipping(now);
  }, [addresses, selectedKey]);

  // Resync stored payment method only when tab becomes visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const saved = readCheckoutMethod(isGuest);
      if (saved) setMethodSelected(normalizeMethod(saved));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isGuest]);

  /* ---------------- OTP for COD confirmation (account + guest) ---------------- */
  async function openOtpModalFor(identifier, channelGuess = "sms") {
    if (checkoutMode !== "account" && checkoutMode !== "guest") return { ok: false };

    const rawIdentifier = String(identifier || "").trim();
    if (!rawIdentifier) {
      setToast("No phone/email available for OTP verification.");
      return { ok: false };
    }

    const safeId = /\S+@\S+/.test(rawIdentifier) ? rawIdentifier : normalizeBDPhone(rawIdentifier);
    if (!safeId) {
      setToast("Please provide a valid phone/email for OTP verification.");
      return { ok: false };
    }

    const req = await requestOtp(safeId, channelGuess, COD_OTP_PURPOSE, {
      allowGuest: checkoutMode === "guest",
    });

    if (!req.ok) {
      setToast(req.j?.error || "Could not send verification code.");
      return { ok: false };
    }

    const display = req.j?.displayIdentifier || req.j?.identifier || safeId;
    setOtpIdentifier(display);
    setOtpTtl(req.j?.ttlSeconds || 90);

    lastOtpRef.current = { identifier: safeId, displayIdentifier: display, code: "" };
    setOtpOpen(true);

    const result = await new Promise((resolve) => {
      otpResolverRef.current = resolve;
    });

    setOtpOpen(false);
    return result;
  }

  async function verifyOtpPair(identifier, code) {
    const v = await verifyOtpApi(identifier, code, COD_OTP_PURPOSE);
    if (!v.ok) setToast("Invalid or expired code. Please try again.");
    return v.ok;
  }

  /* ---------------- Address state: effective shipping/billing ---------------- */
  const defaultAddr =
    addresses.find((a) => a._key === defaultKey) || addresses.find((a) => a.isDefault) || null;

  const effectiveShipping = isGuest ? guestDraft.shipping : shipping || defaultAddr || null;

  const effectiveBilling = isGuest
    ? guestDraft.billingDifferent
      ? guestDraft.billing
      : guestDraft.shipping
    : billingDifferent
    ? billing || null
    : billing || defaultAddr || null;

  const codNeedsMatch =
    methodCanon === "COD" &&
    effectiveShipping &&
    effectiveBilling &&
    !addressesEqual(effectiveShipping, effectiveBilling);

  const shipIncomplete = !effectiveShipping || !isAddressComplete(effectiveShipping);
  const savedMethodForUi = !methodCanon ? normalizeMethod(readCheckoutMethod(isGuest)) : null;
  const guestOnlineNotAllowed = isGuest && methodCanon && methodCanon !== "COD";

  const placeOrderUiDisabled =
    !checkoutMode || !methodCanon || shipIncomplete || codNeedsMatch || guestOnlineNotAllowed;

  useEffect(() => {
    if (!placeOrderCtaWarning) return;
    if (!placeOrderUiDisabled) {
      setPlaceOrderCtaWarning("");
      return;
    }

    const needsPayment = !methodCanon;
    const needsShip = shipIncomplete;
    const needsCodMatch = codNeedsMatch;

    let next = placeOrderCtaWarning;

    if (!checkoutMode) next = "Please choose a checkout mode to continue.";
    else if (guestOnlineNotAllowed) {
      next =
        "Online payment requires an account. Please log in or create an account to use online payment methods.";
    } else if (needsPayment && needsShip)
      next = "Please select a payment method and complete your shipping address.";
    else if (needsPayment) next = "Please select a payment method to place your order.";
    else if (needsShip) next = "Please complete your shipping address to place your order.";
    else if (needsCodMatch) next = "For Cash on Delivery, shipping and billing addresses must be the same.";
    else next = "Please complete the required steps above to place your order.";

    if (next !== placeOrderCtaWarning) setPlaceOrderCtaWarning(next);
  }, [
    placeOrderUiDisabled,
    methodCanon,
    shipIncomplete,
    codNeedsMatch,
    guestOnlineNotAllowed,
    checkoutMode,
    placeOrderCtaWarning,
  ]);

  const summaryShipping = useMemo(
    () => coerceAddressForSummary(effectiveShipping),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(effectiveShipping || {})]
  );
  const summaryBilling = useMemo(
    () => coerceAddressForSummary(effectiveBilling),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(effectiveBilling || {})]
  );

  function handleDisabledPlaceOrderClick() {
    if (!methodCanon && savedMethodForUi) {
      setMethodSelected(savedMethodForUi);
      writeCheckoutMethod(isGuest, savedMethodForUi || "");
      setShowGatewayWarning(false);
      setPlaceOrderCtaWarning("");
      return;
    }

    if (!checkoutMode) {
      openModeDialog("Please choose Guest / Login / Create Account to continue.");
      setPlaceOrderCtaWarning("Please choose a checkout mode to continue.");
      return;
    }

    if (guestOnlineNotAllowed) {
      const msg =
        "Online payment requires an account. Please log in or create an account to use online payment methods.";
      setToast(msg);
      setPlaceOrderCtaWarning(msg);
      return;
    }

    const needsPayment = !methodCanon;
    const needsShip = shipIncomplete;
    const needsCodMatch = codNeedsMatch;

    if (needsPayment && needsShip)
      setPlaceOrderCtaWarning("Please select a payment method and complete your shipping address.");
    else if (needsPayment) setPlaceOrderCtaWarning("Please select a payment method to place your order.");
    else if (needsShip) setPlaceOrderCtaWarning("Please complete your shipping address to place your order.");
    else if (needsCodMatch)
      setPlaceOrderCtaWarning("For Cash on Delivery, shipping and billing addresses must be the same.");
    else setPlaceOrderCtaWarning("Please complete the required steps above to place your order.");

    if (needsPayment) {
      setShowGatewayWarning(true);
      const paymentCard = document.getElementById("payment-card");
      paymentCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }

    if (needsShip) {
      if (isGuest) setGuestShipValidateSignal((v) => v + 1);
      const addressCard = document.getElementById(isGuest ? "guest-address-card" : "account-address-card");
      addressCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }

  /* ---------------- Account address ops (single source of truth: address-book bundle) ---------------- */
  async function refreshAccountAddressesKeepSelection() {
    const bundleRes = await book.bundle().catch(() => ({ ok: false, list: [], def: null }));
    const list = dedupePreserveOrder(bundleRes?.list || []);
    setAddresses(list);

    const def = bundleRes?.def || list.find((a) => a.isDefault) || null;
    if (def) setDefaultKey(def._key);

    const keep =
      list.find((a) => a._key === selectedKey) ||
      (def ? list.find((a) => a._key === def._key) : null) ||
      list[0] ||
      null;

    if (keep) select(keep);
  }

  async function createOrUpdate(values, oldId = null) {
    const newPhone = normalizeBDPhone(values.phone || "");
    const newEmail = (values.email || "").trim().toLowerCase();
    const payloadValues = { ...values, phone: newPhone, email: newEmail };

    const localSaved = normalizeAddress({ ...payloadValues, id: oldId || values.id || undefined }, 0);

    const attempt = async () =>
      oldId ? await book.update(oldId, payloadValues) : await book.create(payloadValues);

    const res = await attempt();

    if (!res.ok && res.status === 401) {
      setToast("Your session expired. Please login again or use Guest Mode.");
      setCheckoutMode(null);
      setModeDialogOpen(true);
      return { ok: false, localOnly: true, localSaved };
    }

    const msg = String(res?.j?.error || res?.j?.message || "").toUpperCase();
    const otpLike = res.status === 403 || msg.includes("OTP") || msg.includes("VERIFICATION");
    if (!res.ok && otpLike) {
      setToast(
        "This address update needs verification. Checkout will continue using this address for now. OTP is used during COD confirmation."
      );
      return { ok: true, localOnly: true, localSaved };
    }

    if (!res.ok) return { ok: false, localOnly: true, localSaved, res };

    const saved = normalizeAddress(res.j?.data || res.j?.address || res.j, 0);
    return { ok: true, localOnly: false, saved, res };
  }

  async function submitShipping(values) {
    const res = await createOrUpdate(
      { ...values, makeDefault: !!values.makeDefault },
      editingShipping?.id || null
    );

    if (!res.ok) {
      setToast(res?.res?.j?.error || "Could not save shipping address.");
      return false;
    }

    const saved = res.localOnly ? res.localSaved : res.saved;

    setShipping(saved);
    setSelectedKey(saved._key);

    try {
      localStorage.setItem("checkout_address_shipping", JSON.stringify(saved));
    } catch {}

    // If server saved, refresh bundle to keep the grid consistent
    if (!res.localOnly) await refreshAccountAddressesKeepSelection();

    setShippingEditorOpen(false);
    setEditingShipping(null);
    setToast("Shipping address saved.");
    return true;
  }

  async function submitBilling(values) {
    const res = await createOrUpdate(
      { ...values, makeDefault: !!values.makeDefault },
      editingBilling?.id || null
    );

    if (!res.ok) {
      setToast(res?.res?.j?.error || "Could not save billing address.");
      return false;
    }

    const saved = res.localOnly ? res.localSaved : res.saved;

    setBilling(saved);
    try {
      localStorage.setItem("checkout_address_billing", JSON.stringify(saved));
    } catch {}

    if (!res.localOnly) await refreshAccountAddressesKeepSelection();

    setBillingEditorOpen(false);
    setEditingBilling(null);
    setToast("Billing address saved.");
    return true;
  }

  async function handleGridDelete(addr) {
    if (!addr || addr.isDefault || !addr?.id) return;

    const res = await book.remove(addr.id);

    if (!res.ok) {
      if (res.status === 401) {
        setToast("Your session expired. Please choose how you want to continue.");
        setCheckoutMode(null);
        setModeDialogOpen(true);
        return;
      }

      const msg = String(res?.j?.error || res?.j?.message || "").toUpperCase();
      const otpLike = res.status === 403 || msg.includes("OTP") || msg.includes("VERIFICATION");
      if (otpLike) {
        setToast(
          "This delete requires verification. Checkout will continue without deleting. OTP is used during COD confirmation."
        );
        return;
      }

      setToast(res?.j?.error || "Could not delete address.");
      await refreshAccountAddressesKeepSelection();
      return;
    }

    // Optimistic local remove, then refresh bundle to guarantee single source of truth
    setAddresses((prev) => prev.filter((a) => a._key !== addr._key && String(a.id) !== String(addr.id)));

    if (selectedKey === addr._key) {
      setSelectedKey(null);
      setShipping(null);
    }

    setToast("Address deleted.");
    await refreshAccountAddressesKeepSelection();
  }

  async function handleMakeDefault(addr) {
    if (!addr?.id) return;

    const res = await book.setDefault(addr.id);

    if (!res.ok) {
      setToast(res?.j?.error || "Could not set default address.");
      return;
    }

    setToast("Default address updated.");
    await refreshAccountAddressesKeepSelection();
  }

  /* ---------------- Guest live draft apply (no loops) ---------------- */
  function applyGuestShippingDraft(values) {
    const nameRaw = String(values?.name ?? "");
    const phoneRaw = String(values?.phone ?? "");
    const emailRaw = String(values?.email ?? "");

    const nameNorm = nameRaw.trim();
    const phoneNorm = normalizeBDPhone(phoneRaw);
    const emailNorm = emailRaw.trim().toLowerCase();

    const rest = values && typeof values === "object" ? { ...values } : {};
    delete rest._key;
    delete rest._ord;
    delete rest.address1;
    delete rest.line1;
    delete rest.line2;

    const shippingDraft = {
      ...rest,
      name: nameRaw,
      phone: phoneRaw,
      email: emailRaw,
      nameNormalized: nameNorm,
      phoneNormalized: phoneNorm,
      emailNormalized: emailNorm,
      countryIso2: String(rest.countryIso2 || "BD").toUpperCase(),
      makeDefault: false,
    };

    setGuestDraft((prev) => {
      const next = {
        ...prev,
        profile: {
          name: nameRaw,
          phone: phoneRaw,
          email: emailRaw,
          nameNormalized: nameNorm,
          phoneNormalized: phoneNorm,
          emailNormalized: emailNorm,
        },
        shipping: shippingDraft,
      };

      const sig = JSON.stringify({ profile: next.profile, shipping: next.shipping });
      if (sig === lastGuestShipSigRef.current) return prev;
      lastGuestShipSigRef.current = sig;

      writeGuestDraft(next);
      return next;
    });
  }

  function applyGuestBillingDraft(values) {
    const nameRaw = String(values?.name ?? "");
    const phoneRaw = String(values?.phone ?? "");
    const emailRaw = String(values?.email ?? "");

    const nameNorm = nameRaw.trim();
    const phoneNorm = normalizeBDPhone(phoneRaw);
    const emailNorm = emailRaw.trim().toLowerCase();

    const rest = values && typeof values === "object" ? { ...values } : {};
    delete rest._key;
    delete rest._ord;
    delete rest.address1;
    delete rest.line1;
    delete rest.line2;

    const billingDraft = {
      ...rest,
      name: nameRaw,
      phone: phoneRaw,
      email: emailRaw,
      nameNormalized: nameNorm,
      phoneNormalized: phoneNorm,
      emailNormalized: emailNorm,
      countryIso2: String(rest.countryIso2 || "BD").toUpperCase(),
      makeDefault: false,
    };

    setGuestDraft((prev) => {
      const next = {
        ...prev,
        profile: {
          name: nameRaw,
          phone: phoneRaw,
          email: emailRaw,
          nameNormalized: nameNorm,
          phoneNormalized: phoneNorm,
          emailNormalized: emailNorm,
        },
        billing: billingDraft,
      };

      const sig = JSON.stringify({
        profile: next.profile,
        billing: next.billing,
        billingDifferent: !!next.billingDifferent,
      });
      if (sig === lastGuestBillSigRef.current) return prev;
      lastGuestBillSigRef.current = sig;

      writeGuestDraft(next);
      return next;
    });
  }

  function validateGuestReady() {
    const p = guestDraft.profile || {};
    const ship = guestDraft.shipping || {};
    const bill = guestDraft.billing || {};

    const name = String(p.nameNormalized || ship?.nameNormalized || p.name || ship?.name || "").trim();
    const phoneRaw = String(p.phone || ship?.phone || "").trim();
    const phone = String(p.phoneNormalized || ship?.phoneNormalized || normalizeBDPhone(phoneRaw) || "").trim();

    if (!name) {
      setGuestShipValidateSignal((v) => v + 1);
      return "Please enter your full name.";
    }
    if (!phone || !isValidBDMobile(phone)) {
      setGuestShipValidateSignal((v) => v + 1);
      return "Please enter a valid Bangladeshi mobile number (e.g., 017XXXXXXXX, 88017XXXXXXXX, +88017XXXXXXXX, or 088017XXXXXXXX).";
    }

    if (guestDraft.billingDifferent) {
      if (!bill || !isAddressComplete(bill)) {
        setGuestBillValidateSignal((v) => v + 1);
        return "Please complete your billing address (Street Address, Upazila / City, District).";
      }
    }

    if (!ship || !isAddressComplete(ship)) {
      setGuestShipValidateSignal((v) => v + 1);
      return "Please complete your shipping address (Street Address, Upazila / City, District).";
    }

    return "";
  }

  /* ---------------- ORDER PLACEMENT (kept logic) ---------------- */
  async function placeOrder(payload) {
    setToast("");

    if (!checkoutMode) {
      openModeDialog("Please choose Guest / Login / Create Account to continue.");
      return;
    }

    const payloadMethod = normalizeMethod(payload?.methodSelected);
    const savedMethod = normalizeMethod(readCheckoutMethod(isGuest));
    const method = payloadMethod || methodCanon || savedMethod;

    if (!method) {
      setShowGatewayWarning(true);
      setToast("Please select a payment method.");
      return;
    }

    const ship = effectiveShipping;
    const bill = effectiveBilling;

    if (!ship || !isAddressComplete(ship)) {
      setToast("Please complete your shipping address (Street Address, Upazila / City, District).");
      if (isGuest) setGuestShipValidateSignal((v) => v + 1);
      const addressCard = document.getElementById(isGuest ? "guest-address-card" : "account-address-card");
      addressCard?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return;
    }

    if (isGuest && method !== "COD") {
      setToast("Online payment requires an account. Please log in or create an account to use online payment methods.");
      return;
    }

    if (method === "COD" && !addressesEqual(ship, bill || ship)) {
      setToast("For Cash on Delivery, shipping and billing addresses must be the same.");
      return;
    }

    if (isGuest) {
      const err = validateGuestReady();
      if (err) {
        setToast(err);
        return;
      }
    }

    setPlacing(true);
    try {
      purgeLegacyCartKeysIfCanonicalExists();

      let snapshot =
        (payload?.cartSnapshot?.items?.length ? payload.cartSnapshot : null) ||
        cartSnapshot ||
        snapshotFromLocalStorage() ||
        snapshotFromWindow();

      if (!snapshot?.items?.length) {
        snapshot = await buildFreshCartSnapshot(setCartId);
      }

      if (!snapshot?.items?.length) {
        setToast("Your cart appears empty. Please refresh and try again.");
        return;
      }

      setCartSnapshot(snapshot);
      persistSnapshot(snapshot);

      preOtpSnapshotRef.current = snapshot;
      try {
        sessionStorage.setItem("checkout_ctx", JSON.stringify({ method, snapshot }));
      } catch {}

      if (method === "COD") {
        const phoneForOtp = (() => {
          if (!isGuest) return (userInfo.phone || ship.phone || defaultAddr?.phone || "").trim();
          return (
            guestDraft.profile?.phoneNormalized ||
            ship.phoneNormalized ||
            normalizeBDPhone(guestDraft.profile?.phone || ship.phone || "")
          ).trim();
        })();

        if (!phoneForOtp) {
          setToast("A mobile number is required for COD.");
          return;
        }

        const otpRes = await openOtpModalFor(phoneForOtp, "sms");
        if (!otpRes?.ok) return;

        const shipPayload = toServerPayload(ship);
        const billPayload = toServerPayload(bill || ship);

        if (!isGuest) {
          const orderPayload = {
            method: "COD",
            shippingAddressId: ship.id || null,
            billingAddressId: (bill || ship).id || null,
            shippingAddress: ship.id ? undefined : shipPayload,
            billingAddress: (bill || ship)?.id ? undefined : billPayload,
            shipping: shipPayload,
            billing: billPayload,
            otp: {
              identifier: otpRes.identifier,
              code: otpRes.code,
              purpose: COD_OTP_PURPOSE,
            },
            cartId: cartId || undefined,
            cartSnapshot: snapshot,
            items: snapshot.items,
            lines: snapshot.items,
            cartItems: snapshot.items,
            cart: { items: snapshot.items },
          };

          const r = await tryJson("/api/orders/place", "POST", orderPayload);
          if (!r.ok) {
            setToast(r.j?.error || "Could not confirm COD order.");
            return;
          }

          await clearServerCartIfAny();
          clearClientCartEverywhere();
          clearAccountProfileOverride();

          const orderId = r.j?.orderId || r.j?.order?.id || r.j?.id;
          const receiptUrl =
            r.j?.receiptUrl || r.j?.redirectUrl || (orderId ? `/orders/${orderId}/receipt` : "/orders");
          window.location.href = receiptUrl;
          return;
        }

        const guestProfile = {
          name: String(guestDraft.profile?.nameNormalized || guestDraft.profile?.name || ship?.name || "").trim(),
          phone: String(
            guestDraft.profile?.phoneNormalized ||
              ship?.phoneNormalized ||
              normalizeBDPhone(guestDraft.profile?.phone || ship?.phone || "")
          ).trim(),
          email: String(guestDraft.profile?.emailNormalized || guestDraft.profile?.email || ship?.email || "")
            .trim()
            .toLowerCase(),
        };

        const shipForPayload = { ...ship, ...guestProfile };
        const billForPayload = { ...(bill || ship), ...guestProfile };

        const shipPayloadGuest = toServerPayload(shipForPayload);
        const billPayloadGuest = toServerPayload(billForPayload);

        const orderPayload = {
          method: "COD",
          guest: guestProfile,
          guestCheckout: true,
          shippingAddressId: null,
          billingAddressId: null,
          shippingAddress: shipPayloadGuest,
          billingAddress: billPayloadGuest,
          shipping: shipPayloadGuest,
          billing: billPayloadGuest,
          otp: {
            identifier: otpRes.identifier,
            code: otpRes.code,
            purpose: COD_OTP_PURPOSE,
          },
          cartId: cartId || undefined,
          cartSnapshot: snapshot,
          items: snapshot.items,
          lines: snapshot.items,
          cartItems: snapshot.items,
          cart: { items: snapshot.items },
        };

        const r = await tryJson("/api/orders/place", "POST", orderPayload);
        if (!r.ok && (r.status === 401 || r.j?.error === "AUTH_REQUIRED")) {
          setToast(
            "To place this order, please log in or create an account. Guest checkout is not enabled on the server yet."
          );
          setCheckoutMode(null);
          writeCheckoutModePref(null);
          setModeDialogOpen(true);
          return;
        }

        if (!r.ok) {
          setToast(r.j?.error || "Could not place guest COD order.");
          return;
        }

        await clearServerCartIfAny();
        clearClientCartEverywhere();
        clearGuestDraft();
        writeCheckoutMethod(true, "");

        const orderId = r.j?.orderId || r.j?.order?.id || r.j?.id;
        const receiptUrl =
          r.j?.receiptUrl || r.j?.redirectUrl || (orderId ? `/orders/${orderId}/receipt` : "/orders");
        window.location.href = receiptUrl;
        return;
      }

      // Online payment (account only)
      const r = await tryJson("/api/payments/checkout", "POST", {
        provider: method,
        shippingAddressId: ship.id || null,
        billingAddressId: (bill || ship).id || null,
        returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
      });

      if (!r.ok || !r.j?.redirectUrl) {
        setToast(r.j?.error || "Payment gateway not available. Please use Cash on Delivery.");
        setMethodSelected(null);
        writeCheckoutMethod(false, "");
        setShowGatewayWarning(false);
        return;
      }

      writeCheckoutMethod(false, method);
      window.location.href = r.j.redirectUrl;
    } finally {
      setPlacing(false);
    }
  }

  /* ---------------- Render helpers ---------------- */
  function renderFullAddressLines(a) {
    if (!a) return <span>—</span>;
    const line1 = [a.houseName, a.houseNo, a.apartmentNo, a.floorNo, a.line1 || a.address1]
      .filter(Boolean)
      .join(", ");
    const line2 = [a.village, a.postOffice, a.union, a.policeStation].filter(Boolean).join(", ");
    const line3Parts = [a.upazila || a.city, a.district || a.state];
    if (a.postalCode) line3Parts.push(a.postalCode);
    if (a.countryIso2) line3Parts.push(String(a.countryIso2).toUpperCase());
    const line3 = line3Parts.filter(Boolean).join(", ");

    return (
      <>
        <div style={{ fontWeight: 900, color: NAVY }}>{line1 || "—"}</div>
        {line2 ? <div style={{ fontWeight: 800, color: NAVY }}>{line2}</div> : null}
        <div style={{ fontWeight: 800, color: NAVY }}>{line3 || "—"}</div>
      </>
    );
  }

  const AddressTile = ({ a }) => {
    const selected = selectedKey && a?._key === selectedKey;
    return (
      <button
        type="button"
        className={`addr-tile${selected ? " selected" : ""}`}
        onClick={() => select(a)}
        title="Select this address"
      >
        <div className="addr-tile-top">
          <div className="addr-tile-name">{titleCase(a?.name || userInfo?.name || "Address")}</div>
          <div className="addr-tile-actions">
            {a?.isDefault ? <span className="pill-default">Default</span> : null}
          </div>
        </div>

        <div className="addr-tile-body">{renderFullAddressLines(a)}</div>

        <div className="addr-tile-foot">
          <div className="addr-tile-meta">
            {a?.phone ? <span>{a.phone}</span> : null}
            {a?.email ? <span className="sep">•</span> : null}
            {a?.email ? <span>{a.email}</span> : null}
          </div>

          <div className="addr-tile-btns">
            <button
              type="button"
              className="btn-mini"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEditingShipping(a);
                setShippingEditorOpen(true);
              }}
            >
              Edit
            </button>

            {!a?.isDefault ? (
              <button
                type="button"
                className="btn-mini"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleMakeDefault(a);
                }}
              >
                Make default
              </button>
            ) : null}

            {!a?.isDefault ? (
              <button
                type="button"
                className="btn-mini danger"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleGridDelete(a);
                }}
              >
                Delete
              </button>
            ) : null}
          </div>
        </div>

        <style jsx>{`
          .addr-tile {
            width: 100%;
            text-align: left;
            border: 1px solid ${BORDER};
            border-radius: 16px;
            padding: 12px;
            background: linear-gradient(180deg, #ffffff 0%, #fafbff 100%);
            box-shadow: 0 10px 26px rgba(15, 33, 71, 0.06);
            display: grid;
            gap: 10px;
            cursor: pointer;
          }
          .addr-tile.selected {
            border-color: rgba(29, 78, 216, 0.55);
            box-shadow: 0 12px 30px rgba(29, 78, 216, 0.12);
          }
          .addr-tile-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .addr-tile-name {
            font-weight: 900;
            color: ${NAVY};
          }
          .addr-tile-body {
            font-size: 13px;
            line-height: 1.35;
          }
          .addr-tile-foot {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 10px;
            flex-wrap: wrap;
          }
          .addr-tile-meta {
            color: ${MUTED};
            font-weight: 800;
            font-size: 12px;
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
          }
          .sep {
            opacity: 0.7;
          }
          .addr-tile-btns {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .btn-mini {
            height: 34px;
            padding: 0 12px;
            border-radius: 999px;
            border: 1px solid ${BORDER};
            background: #fff;
            color: ${NAVY};
            font-weight: 900;
            font-size: 12px;
          }
          .btn-mini.danger {
            border-color: rgba(220, 38, 38, 0.35);
            color: #b91c1c;
          }
          .pill-default {
            background: #eef2ff;
            color: #3730a3;
            border: 1px solid #e0e7ff;
            font-weight: 900;
            font-size: 11px;
            padding: 3px 10px;
            border-radius: 999px;
          }
        `}</style>
      </button>
    );
  };

  return (
    <>
      <Navbar />

      {/* MODE DIALOG */}
      <CheckoutModeDialog
        open={modeDialogOpen}
        onClose={() => setModeDialogOpen(false)}
        onGuest={() => {
          setCheckoutMode("guest");
          writeCheckoutModePref("guest");
          setModeDialogOpen(false);
          setMethodSelected(null);
          writeCheckoutMethod(true, "");
        }}
        onLogin={gotoLogin}
        onCreate={gotoSignup}
        subtitle="Choose Guest Mode or Login to continue checkout."
      />

      {/* OTP DIALOG */}
      <OtpDialog
        open={otpOpen}
        identifier={otpIdentifier}
        ttlSeconds={otpTtl}
        onClose={() => {
          setOtpOpen(false);
          if (otpResolverRef.current) otpResolverRef.current({ ok: false });
        }}
        onSubmit={async (code) => {
          const last = lastOtpRef.current;
          if (!last?.identifier) return;

          const ok = await verifyOtpPair(last.identifier, code);
          if (!ok) return;

          const payload = { ok: true, identifier: last.identifier, code };
          if (otpResolverRef.current) otpResolverRef.current(payload);
          setOtpOpen(false);
        }}
        onResend={async () => {
          const last = lastOtpRef.current;
          if (!last?.identifier) return null;
          const req = await requestOtp(last.identifier, "sms", COD_OTP_PURPOSE, {
            allowGuest: checkoutMode === "guest",
          });
          if (!req.ok) {
            setToast(req.j?.error || "Could not resend code.");
            return null;
          }
          const nextTtl = req.j?.ttlSeconds || 90;
          setOtpTtl(nextTtl);
          return nextTtl;
        }}
      />

      {/* SHIPPING EDITOR */}
      <ModalShell
        open={shippingEditorOpen}
        title={editingShipping?.id ? "Edit shipping address" : "Add new shipping address"}
        subtitle="Save once — it will instantly update your checkout selection."
        onClose={() => {
          setShippingEditorOpen(false);
          setEditingShipping(null);
        }}
      >
        <CheckoutAddressForm
          title=""
          subtitle=""
          prefill={{
            ...(editingShipping || {}),
            name: editingShipping?.name ?? userInfo.name ?? "",
            phone: editingShipping?.phone ?? userInfo.phone ?? "",
            email: editingShipping?.email ?? userInfo.email ?? "",
          }}
          includeUserFields={true}
          requirePhone={true}
          showMakeDefault={true}
          submitLabel="Save shipping address"
          onCancel={() => {
            setShippingEditorOpen(false);
            setEditingShipping(null);
          }}
          onSubmit={submitShipping}
        />
      </ModalShell>

      {/* BILLING EDITOR */}
      <ModalShell
        open={billingEditorOpen}
        title={editingBilling?.id ? "Edit billing address" : "Add new billing address"}
        subtitle="Billing is used for invoice details. For COD, shipping and billing must match."
        onClose={() => {
          setBillingEditorOpen(false);
          setEditingBilling(null);
        }}
      >
        <CheckoutAddressForm
          title=""
          subtitle=""
          prefill={{
            ...(editingBilling || {}),
            name: editingBilling?.name ?? userInfo.name ?? "",
            phone: editingBilling?.phone ?? userInfo.phone ?? "",
            email: editingBilling?.email ?? userInfo.email ?? "",
          }}
          includeUserFields={true}
          requirePhone={true}
          showMakeDefault={false}
          submitLabel="Save billing address"
          onCancel={() => {
            setBillingEditorOpen(false);
            setEditingBilling(null);
          }}
          onSubmit={submitBilling}
        />
      </ModalShell>

      <div className="checkout bg-white min-h-[100dvh]">
        <style jsx global>{`
          .container {
            padding-top: var(--nav-h, 88px);
          }
          .checkout {
            padding-bottom: max(140px, env(safe-area-inset-bottom));
          }
          .card {
            border: 1px solid ${BORDER};
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 8px 24px rgba(15, 33, 71, 0.06);
            overflow: hidden;
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
          .toast {
            background: #fee2e2;
            border: 1px solid #fecaca;
            color: #991b1b;
            border-radius: 12px;
            padding: 10px 12px;
            font-weight: 900;
          }
          .sticky-col {
            position: sticky;
            top: calc(var(--nav-h, 88px) + 16px);
            align-self: flex-start;
          }
          .po-guard-overlay {
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            height: 220px;
            background: transparent;
            border: 0;
            padding: 0;
            margin: 0;
            cursor: not-allowed;
            z-index: 80;
          }
          .po-guard-msg-inline {
            position: absolute;
            left: 12px;
            right: 12px;
            bottom: 196px;
            padding: 10px 12px;
            color: #dc2626;
            font-size: 13px;
            font-weight: 900;
            line-height: 1.35;
            background: rgba(254, 242, 242, 0.92);
            border: 1px solid rgba(254, 205, 211, 0.95);
            border-radius: 12px;
            z-index: 90;
            pointer-events: none;
          }
        `}</style>

        <header className="container pt-8 pb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <GoBackButton />
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: NAVY }}>
              Checkout
            </h1>
          </div>
          <nav className="hidden md:flex items-center gap-3 text-sm" style={{ color: MUTED }}>
            <span className="font-extrabold" style={{ color: NAVY }}>
              1. Address
            </span>
            <span>•</span>
            <span>2. Payment</span>
          </nav>
        </header>

        <main className="container pb-28 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-10">
          {/* LEFT */}
          <div className="space-y-10">
            {toast ? <div className="toast">{toast}</div> : null}

            {/* MODE BANNER */}
            {sessionChecked ? (
              <section className="card">
                <div className="card-head">Checkout Mode</div>
                <div className="card-body">
                  <div
                    style={{
                      border: `1px solid ${BORDER}`,
                      borderRadius: 18,
                      padding: 16,
                      background: "linear-gradient(180deg, #fff 0%, #fafbff 100%)",
                      boxShadow: "0 8px 24px rgba(15,33,71,0.06)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold" style={{ color: NAVY }}>
                          {checkoutMode === "guest"
                            ? "Guest Checkout"
                            : checkoutMode === "account"
                            ? "Account Checkout"
                            : "Choose a mode"}
                        </span>

                        {checkoutMode === "guest" ? (
                          <span
                            style={{
                              background: "#EEF2FF",
                              color: "#3730A3",
                              border: "1px solid #E0E7FF",
                              fontWeight: 900,
                              fontSize: 11,
                              padding: "3px 10px",
                              borderRadius: 999,
                            }}
                          >
                            OTP at COD • Session-only
                          </span>
                        ) : checkoutMode === "account" ? (
                          <span
                            style={{
                              background: "#EEF2FF",
                              color: "#3730A3",
                              border: "1px solid #E0E7FF",
                              fontWeight: 900,
                              fontSize: 11,
                              padding: "3px 10px",
                              borderRadius: 999,
                            }}
                          >
                            Saved addresses • Account tools
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        {checkoutMode !== "account" ? (
                          <button
                            className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                            onClick={() => openModeDialog()}
                          >
                            Change
                          </button>
                        ) : null}

                        {checkoutMode === "guest" ? (
                          <button
                            className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                            onClick={gotoSignup}
                          >
                            Create Account
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {checkoutMode === "guest" ? (
                      <div className="mt-2 text-[13px]" style={{ color: MUTED, fontWeight: 800 }}>
                        Guest checkout is session-only: details are not saved. OTP will be requested only when placing a COD order.
                      </div>
                    ) : checkoutMode === "account" ? (
                      <div className="mt-2 text-[13px]" style={{ color: MUTED, fontWeight: 800 }}>
                        Your saved addresses load instantly. You can add, edit, delete, and set default without leaving checkout.
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            {/* ADDRESS */}
            <section className="card" id={isGuest ? "guest-address-card" : "account-address-card"}>
              <div className="card-head">Address</div>
              <div className="card-body">
                {/* GUEST */}
                {checkoutMode === "guest" ? (
                  <div className="space-y-6">
                    <div
                      style={{
                        border: `1px solid ${BORDER}`,
                        borderRadius: 18,
                        padding: 16,
                        background: "linear-gradient(180deg, #fff 0%, #fafbff 100%)",
                        boxShadow: "0 8px 24px rgba(15,33,71,0.06)",
                      }}
                    >
                      <CheckoutAddressForm
                        title="Shipping address"
                        subtitle="Enter your details. This is session-only and will not be saved."
                        prefill={{
                          ...(guestDraft.shipping || {}),
                          name: guestDraft.profile?.name || "",
                          phone: guestDraft.profile?.phone || "",
                          email: guestDraft.profile?.email || "",
                        }}
                        includeUserFields={true}
                        requirePhone={true}
                        showMakeDefault={false}
                        submitLabel="Continue"
                        validateSignal={guestShipValidateSignal}
                        onDraftChange={(vals) => applyGuestShippingDraft(vals)}
                        onCancel={() => {}}
                        onSubmit={async () => true}
                      />
                    </div>

                    <div
                      style={{
                        border: `1px solid ${BORDER}`,
                        borderRadius: 18,
                        padding: 16,
                        background: "#fff",
                        boxShadow: "0 8px 24px rgba(15,33,71,0.06)",
                      }}
                    >
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={!!guestDraft.billingDifferent}
                          onChange={(e) => {
                            const v = !!e.target.checked;
                            setGuestDraft((p) => {
                              const next = { ...p, billingDifferent: v };
                              writeGuestDraft(next);
                              return next;
                            });
                          }}
                        />
                        <span style={{ color: NAVY, fontWeight: 900 }}>Use a different billing address</span>
                      </label>

                      {guestDraft.billingDifferent ? (
                        <div className="mt-4">
                          <CheckoutAddressForm
                            title="Billing address"
                            subtitle="For COD, billing and shipping must match."
                            prefill={{
                              ...(guestDraft.billing || {}),
                              name: guestDraft.profile?.name || "",
                              phone: guestDraft.profile?.phone || "",
                              email: guestDraft.profile?.email || "",
                            }}
                            includeUserFields={true}
                            requirePhone={true}
                            showMakeDefault={false}
                            submitLabel="Continue"
                            validateSignal={guestBillValidateSignal}
                            onDraftChange={(vals) => applyGuestBillingDraft(vals)}
                            onCancel={() => {}}
                            onSubmit={async () => true}
                          />
                        </div>
                      ) : (
                        <div className="mt-2 text-[13px]" style={{ color: MUTED, fontWeight: 800 }}>
                          Billing address will be the same as shipping.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* ACCOUNT */}
                {checkoutMode === "account" ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div style={{ color: NAVY, fontWeight: 900 }}>Select a shipping address</div>
                        <div style={{ color: MUTED, fontWeight: 800, fontSize: 12, marginTop: 2 }}>
                          Default and saved addresses are managed via the canonical address-book API.
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                          onClick={() => {
                            setEditingShipping(null);
                            setShippingEditorOpen(true);
                          }}
                        >
                          Add new
                        </button>

                        <button
                          type="button"
                          className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                          onClick={() => refreshAccountAddressesKeepSelection()}
                        >
                          Refresh
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(addresses || []).map((a) => (
                        <AddressTile key={a._key} a={a} />
                      ))}
                      {!addresses?.length ? (
                        <div
                          style={{
                            border: `1px dashed ${BORDER}`,
                            borderRadius: 16,
                            padding: 14,
                            color: MUTED,
                            fontWeight: 900,
                          }}
                        >
                          No saved addresses found. Add one to continue.
                        </div>
                      ) : null}
                    </div>

                    {/* Billing toggle */}
                    <div
                      style={{
                        border: `1px solid ${BORDER}`,
                        borderRadius: 18,
                        padding: 16,
                        background: "#fff",
                        boxShadow: "0 8px 24px rgba(15,33,71,0.06)",
                      }}
                    >
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={!!billingDifferent}
                          onChange={(e) => setBillingDifferent(!!e.target.checked)}
                        />
                        <span style={{ color: NAVY, fontWeight: 900 }}>Use a different billing address</span>
                      </label>

                      {billingDifferent ? (
                        <div className="mt-4">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div style={{ color: NAVY, fontWeight: 900 }}>Billing address</div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                className="h-10 px-4 rounded-xl font-extrabold bg-white text-[#0F2147] border border-[#0F2147]"
                                onClick={() => {
                                  setEditingBilling(billing || null);
                                  setBillingEditorOpen(true);
                                }}
                              >
                                {billing?.id ? "Edit billing" : "Add billing"}
                              </button>
                            </div>
                          </div>

                          <div className="mt-3" style={{ fontSize: 13, color: NAVY, fontWeight: 800 }}>
                            {billing ? renderFullAddressLines(billing) : <span style={{ color: MUTED }}>No billing address selected.</span>}
                          </div>

                          {methodCanon === "COD" && billing && effectiveShipping && !addressesEqual(effectiveShipping, billing) ? (
                            <div className="mt-3" style={{ color: "#b91c1c", fontWeight: 900, fontSize: 13 }}>
                              For Cash on Delivery, shipping and billing addresses must be the same.
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 text-[13px]" style={{ color: MUTED, fontWeight: 800 }}>
                          Billing address will follow your shipping/default address.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* MODE NOT CHOSEN */}
                {!checkoutMode ? (
                  <div style={{ color: MUTED, fontWeight: 900 }}>
                    Please choose Guest Mode or Login to continue.
                  </div>
                ) : null}
              </div>
            </section>

            {/* PAYMENT */}
            <section className="card" id="payment-card">
              <div className="card-head">Payment</div>
              <div className="card-body">
                <PaymentMethods
                  methodSelected={methodCanon}
                  setMethodSelected={(m) => {
                    const nm = normalizeMethod(m);
                    setMethodSelected(nm);
                    writeCheckoutMethod(isGuest, nm || "");
                    setShowGatewayWarning(false);
                  }}
                  isGuest={isGuest}
                  showGatewayWarning={showGatewayWarning}
                  setShowGatewayWarning={setShowGatewayWarning}
                  onRequireAccount={() => {
                    setToast("Online payment requires an account. Please log in or create an account.");
                    openModeDialog("Online payment requires an account. Please log in or create an account.");
                  }}
                />

                {isGuest ? (
                  <div className="mt-3 text-[13px]" style={{ color: MUTED, fontWeight: 800 }}>
                    Guest checkout supports Cash on Delivery only.
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {/* RIGHT: SUMMARY */}
          <div className="sticky-col">
            <div className="relative">
              <Summary
                shippingAddress={summaryShipping}
                billingAddress={summaryBilling}
                cartSnapshot={cartSnapshot}
                placing={placing}
                methodSelected={methodCanon}
                onPlaceOrder={() => placeOrder({ methodSelected: methodCanon, cartSnapshot })}
              />

              {placeOrderUiDisabled ? (
                <>
                  <button
                    className="po-guard-overlay"
                    onClick={handleDisabledPlaceOrderClick}
                    aria-label="Complete required steps before placing order"
                  />
                  {placeOrderCtaWarning ? (
                    <div className="po-guard-msg-inline">{placeOrderCtaWarning}</div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </main>

        <BottomFloatingBar />
      </div>
    </>
  );
}

/* ===========================
   What was fixed / improved
   ===========================
   1) True parallel preload on mount:
      - Cart snapshot starts immediately (buildFreshCartSnapshot) and is applied as soon as it resolves.
      - Account mode hydrates address-book bundle + profile in parallel, not sequentially.
      - No “load later on click” paths were introduced.

   2) Address management is single source of truth:
      - All account CRUD + default uses the canonical /api/customers/address-book layer via checkout.addressbook (book.*).
      - After save/delete/default, we refresh via book.bundle() to keep UI consistent and deduped.

   3) Smooth checkout UX:
      - Guest draft writes to sessionStorage live (no page reload).
      - Place Order CTA guard provides deterministic guidance and scrolls to the right section.
      - COD OTP flow remains strictly at confirmation only (guest + account).

   4) Code consistency:
      - This main file only imports the split modules you already created (addressbook/cart/dialogs/addressform).
      - No extra splitting is done here; no duplicate old inline helpers remain.
*/
