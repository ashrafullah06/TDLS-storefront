//app/customer/dashboard/page.jsx
'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

import Navbar from '@/components/common/navbar';
import Bottomfloatingbar from '@/components/common/bottomfloatingbar';
import PaymentMethodsBar from '@/components/common/paymentmethodsbar';
import WhatsAppFloatingButton from '@/components/common/whatsappchatbutton';
import LiveInventoryPanel from '@/components/common/liveinventorypanel';
import PersonalizedOffers from '@/components/common/personalizedoffers';
import OrderAgainButton from '@/components/common/orderagainbutton';
import LoyaltyPopup from '@/components/common/loyaltypopup';
import WebVitalsBadge from '@/components/common/webvitalsbadge';
import FraudStatusBadge from '@/components/common/fraudstatusbadge';
import SignoutButton from '@/components/auth/signout_button';

import ReturnExchangeRefundPanel from '../returnexchangerefundpanel';

const NAVY = '#0C2340';
const SLATE_BG = '#F7F8FA';

/* -------------------- small hardening helpers (no UI change) -------------------- */

function pickUserIdFromSessionUser(u) {
  // Production NextAuth can store identifier in sub or other keys depending on callbacks/jwt.
  const cands = [u?.id, u?.userId, u?.uid, u?.sub, u?.customerId];
  for (const v of cands) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // sometimes numeric
  for (const v of cands) {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function pickPhoneFromSessionUser(u) {
  const cands = [u?.phone, u?.mobile, u?.phoneNumber, u?.tel];
  for (const v of cands) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

async function fetchJsonWithTimeout(url, { timeoutMs = 12000, signal, ...init } = {}) {
  const controller = new AbortController();
  const tt = setTimeout(() => controller.abort(), timeoutMs);

  // Bridge external abort into our controller if provided
  let abortBridge;
  if (signal) {
    if (signal.aborted) controller.abort();
    else {
      abortBridge = () => controller.abort();
      signal.addEventListener('abort', abortBridge, { once: true });
    }
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });

    const text = await res.text().catch(() => '');
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { res, json, text };
  } finally {
    clearTimeout(tt);
    if (signal && abortBridge) {
      try {
        signal.removeEventListener('abort', abortBridge);
      } catch {}
    }
  }
}

function getBotReply(msg) {
  const m = msg.toLowerCase();
  if (/hi|hello|hey|good morning|good afternoon|good evening/.test(m)) return 'hi there! 👋 how can i help you today?';
  if (/order.*(history|past)/.test(m)) return "you can view your full order history under 'order history'.";
  if (/track|tracking|where.*order/.test(m)) return "go to 'order tracking' and enter your order id for live updates.";
  if (/return|exchange/.test(m)) return "use 'returns / exchanges' to request a return or exchange.";
  if (/refund/.test(m)) return "refund requests and status are in the 'refund status' section.";
  if (/point|loyalty/.test(m)) return "your loyalty points and tier are shown in 'points status'.";
  if (/offer|promo|discount/.test(m)) return "personalized offers are curated in your 'offers' section.";
  return 'for further help, message our support team. i can guide you on any dashboard section!';
}

const dashboardOptions = [
  { key: 'profile', label: 'My Profile' },
  { key: 'order-history', label: 'Orders & History' },
  { key: 'tracking', label: 'Order Tracking' },
  { key: 'returns', label: 'Returns / Exchanges' },
  { key: 'refund', label: 'Refund Status' },
  { key: 'points', label: 'Points Status' },
  { key: 'redeem', label: 'Redeem Status' },
  { key: 'referral', label: 'Referral Status' },
  { key: 'wallet', label: 'Digital Wallet' },
  { key: 'loyalty', label: 'Loyalty & VIP' },
  { key: 'offers', label: 'Personalized Offers' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'activity', label: 'Recent Activity' },
  { key: 'wishlist', label: 'Wishlist' },
  { key: 'saved-carts', label: 'Saved Carts' },
  { key: 'gift-center', label: 'Gift Center' },
  { key: 'address-book', label: 'Address Book' },
  { key: 'payment-methods', label: 'Saved Payment Methods' },
  { key: 'invoices', label: 'Invoices & Documents' },
  { key: 'security', label: 'Account Security' },
  { key: 'policies', label: 'Customer Policies' },
];

function useSessionShell() {
  const { data: session, status } = useSession();
  const base = useMemo(() => {
    const u = session?.user;
    if (!u) return null;

    const id = pickUserIdFromSessionUser(u);
    return {
      id,
      name: u.name || '',
      email: u.email || '',
      phone: pickPhoneFromSessionUser(u),
    };
  }, [session]);
  return { base, status };
}

function DashboardOptionDropdown({ open, options, selectedKey, onSelect, setOpen, showMenuLabel }) {
  const selected = options.find((o) => o.key === selectedKey);

  return (
    <div
      className="tdls-dd-wrap"
      style={{
        position: 'relative',
        marginTop: '46px',
        marginRight: '18px',
        width: 230,
      }}
    >
      <div
        className="tdls-dd-label"
        style={{
          fontSize: 12,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: '#9ca3af',
          marginBottom: 6,
        }}
      >
        dashboard
      </div>

      <button
        className="tdls-dd-btn"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#ffffff',
          color: NAVY,
          border: '1px solid #d1d5e5',
          borderRadius: 999,
          fontWeight: 700,
          padding: '10px 16px',
          fontSize: 14,
          width: '100%',
          minWidth: 150,
          maxWidth: 260,
          letterSpacing: '.05em',
          boxShadow: '0 6px 18px rgba(15,23,42,0.07)',
          cursor: 'pointer',
          textTransform: 'uppercase',
        }}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="open dashboard menu"
        title="open dashboard menu"
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            className="tdls-dd-icon"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: '999px',
              border: `1px solid ${NAVY}`,
              fontSize: 11,
              flex: '0 0 auto',
            }}
          >
            ⌖
          </span>

          <span
            className="tdls-dd-selected"
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {showMenuLabel ? 'Dashboard Menu' : selected ? selected.label : 'Dashboard Menu'}
          </span>
        </span>

        <span style={{ fontSize: 18, marginLeft: 8, flex: '0 0 auto' }}>▾</span>
      </button>

      {open && (
        <ul
          className="tdls-dd-list"
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            top: '120%',
            background: '#ffffff',
            boxShadow: '0 18px 60px rgba(15,23,42,0.25)',
            borderRadius: 16,
            maxHeight: '65vh',
            overflowY: 'auto',
            minWidth: 240,
            width: 260,
            padding: '4px 0',
            zIndex: 9999,
            margin: 0,
            border: '1px solid #e5e7eb',
          }}
        >
          {options.map((opt) => (
            <li
              role="option"
              key={opt.key}
              onClick={() => {
                onSelect(opt.key);
                setOpen(false);
              }}
              className="tdlc-nav-option"
              style={{
                padding: '11px 16px',
                borderBottom: '1px solid #f3f4f6',
                cursor: 'pointer',
                background: selectedKey === opt.key ? '#eef2ff' : '#ffffff',
                fontWeight: selectedKey === opt.key ? 800 : 500,
                color: selectedKey === opt.key ? NAVY : '#111827',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background 0.16s ease, transform 0.16s ease, color 0.16s ease',
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {opt.label}
              </span>
              <span style={{ fontSize: 11, opacity: selectedKey === opt.key ? 1 : 0.3, flex: '0 0 auto' }}>→</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Banner({ children }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="tdls-banner"
      style={{
        borderRadius: 12,
        padding: '12px 14px',
        background: '#ecfdf5',
        color: '#065f46',
        border: '1px solid #a7f3d0',
        margin: '12px 24px 0 24px',
      }}
    >
      {children}
    </div>
  );
}

/** status derivation kept consistent with your order-history cards */
function deriveOrderStatus(o) {
  const s = o?.status || o?.orderStatus || o?.state || o?.fulfillmentStatus || o?.paymentStatus || '';
  return String(s || '').trim();
}

// Customer-safe panel guard
class TDLCPanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {}
  render() {
    if (this.state.hasError) return this.props.fallback || null;
    return this.props.children;
  }
}

function TDLCPanelFallback({ title = 'This section', onRetry }) {
  return (
    <div
      className="tdls-panel-fallback"
      style={{
        width: '100%',
        border: '1px solid #e4e7ef',
        background: '#ffffff',
        borderRadius: 14,
        padding: '18px 16px',
        boxShadow: '0 10px 28px rgba(15,23,42,0.06)',
        marginTop: 14,
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ fontWeight: 900, color: NAVY, fontSize: 16, textTransform: 'capitalize' }}>{title}</div>
      <div style={{ marginTop: 8, color: '#475569', fontSize: 14 }}>failed to execute right now. please try again later.</div>
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: NAVY,
            color: '#fff',
            borderRadius: 999,
            fontWeight: 800,
            padding: '8px 16px',
            border: 'none',
            fontSize: 13,
            boxShadow: '0 2px 7px #2A394433',
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
          }}
          aria-label="retry"
          title="retry"
        >
          retry
        </button>
        <span style={{ marginLeft: 10, fontSize: 12, color: '#94a3b8' }}>or check back later (coming soon updates).</span>
      </div>
    </div>
  );
}

function SafePanel({ title, children }) {
  const [k, setK] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);

  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);

  const isFetchFailure = useCallback((msg) => {
    const m = String(msg || '');
    return /failed to fetch|networkerror|load failed/i.test(m);
  }, []);

  const blockNow = useCallback(() => {
    if (blockedRef.current) return;
    blockedRef.current = true;
    setBlocked(true);
  }, []);

  useEffect(() => {
    if (blocked) return;
    if (typeof window === 'undefined') return;

    const onError = (e) => {
      const msg = String(e?.message || e?.error?.message || '');
      if (!isFetchFailure(msg)) return;
      try {
        e?.preventDefault?.();
      } catch {}
      blockNow();
    };

    const onRejection = (e) => {
      const reason = e?.reason;
      const msg = String(reason?.message || reason || '');
      if (!isFetchFailure(msg)) return;
      try {
        e?.preventDefault?.();
      } catch {}
      blockNow();
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [blocked, isFetchFailure, blockNow]);

  const retry = useCallback(() => {
    blockedRef.current = false;
    setBlocked(false);
    setK((x) => x + 1);
  }, []);

  if (blocked) return <TDLCPanelFallback title={title} onRetry={retry} />;

  return (
    <TDLCPanelErrorBoundary key={k} fallback={<TDLCPanelFallback title={title} onRetry={retry} />}>
      {children}
    </TDLCPanelErrorBoundary>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const search = useSearchParams();
  const { base, status } = useSessionShell();

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auth watchdog
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const redirectingRef = useRef(false);
  const [authLost, setAuthLost] = useState(false);
  const [authLostReason, setAuthLostReason] = useState('');

  const buildLoginUrl = useCallback((reason = 'logged_out') => {
    const nextPath = '/customer/dashboard';
    return `/login?next=${encodeURIComponent(nextPath)}&reason=${encodeURIComponent(String(reason || 'logged_out'))}`;
  }, []);

  const handleAuthLost = useCallback(
    (reason = 'logged_out') => {
      if (redirectingRef.current) return;
      redirectingRef.current = true;

      const finalReason = String(reason || 'logged_out');
      const loginUrl = buildLoginUrl(finalReason);

      setAuthLost(true);
      setAuthLostReason(finalReason);

      try {
        if (statusRef.current === 'unauthenticated') {
          if (typeof window !== 'undefined') window.location.assign(loginUrl);
          else router.replace(loginUrl);
          return;
        }

        void signOut({ callbackUrl: loginUrl });
        return;
      } catch {
        try {
          if (typeof window !== 'undefined') window.location.assign(loginUrl);
          else router.replace(loginUrl);
        } catch {
          router.replace(loginUrl);
        }
      }
    },
    [router, buildLoginUrl],
  );

  // Prevent “panic sign out” while status is loading
  const sessionNullConfirmRef = useRef(false);
  const refreshedOnceRef = useRef(false);

  useEffect(() => {
    if (status !== 'loading') {
      sessionNullConfirmRef.current = false;
      refreshedOnceRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    if (authLost) return;
    if (status !== 'loading') return;

    const SESSION_SOFT_TIMEOUT_MS = 2500;
    const SESSION_CONFIRM_DELAY_MS = 900;
    const SESSION_FETCH_TIMEOUT_MS = 7000;
    const SESSION_STUCK_REFRESH_MS = 7000;

    let softTimer = null;
    let confirmTimer = null;
    let refreshTimer = null;

    const probeSession = async () => {
      try {
        const { res, json } = await fetchJsonWithTimeout('/api/auth/session', { timeoutMs: SESSION_FETCH_TIMEOUT_MS });
        if (!res?.ok) return { kind: 'unknown' };
        if (!json || !json.user) return { kind: 'null' };
        return { kind: 'ok' };
      } catch {
        return { kind: 'unknown' };
      }
    };

    softTimer = setTimeout(async () => {
      if (statusRef.current !== 'loading') return;

      const first = await probeSession();
      if (statusRef.current !== 'loading') return;

      if (first.kind === 'ok') {
        sessionNullConfirmRef.current = false;
        return;
      }

      if (first.kind === 'null') {
        if (sessionNullConfirmRef.current) return;
        sessionNullConfirmRef.current = true;

        confirmTimer = setTimeout(async () => {
          if (statusRef.current !== 'loading') return;

          const second = await probeSession();
          if (statusRef.current !== 'loading') return;

          if (second.kind === 'null') {
            handleAuthLost('logged_out');
          } else {
            sessionNullConfirmRef.current = false;
          }
        }, SESSION_CONFIRM_DELAY_MS);
      }
    }, SESSION_SOFT_TIMEOUT_MS);

    refreshTimer = setTimeout(() => {
      if (authLost) return;
      if (statusRef.current !== 'loading') return;
      if (refreshedOnceRef.current) return;

      refreshedOnceRef.current = true;
      try {
        router.refresh();
      } catch {}
    }, SESSION_STUCK_REFRESH_MS);

    return () => {
      if (softTimer) clearTimeout(softTimer);
      if (confirmTimer) clearTimeout(confirmTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [status, authLost, handleAuthLost, router]);

  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  const userId = base?.id || '';

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadedOnce, setProfileLoadedOnce] = useState(false);

  // Fast path from session base
  useEffect(() => {
    if (!userId) return;
    if (!base) return;
    if (profileLoadedOnce) return;

    setProfile((p) =>
      p || {
        id: base.id || userId,
        name: base.name || '',
        email: base.email || '',
        phone: base.phone || '',
        tier: '',
        points: 0,
        referral_code: '',
        referral_id: '',
      },
    );
    setProfileLoading(false);
    setProfileLoadedOnce(true);
  }, [userId, base, profileLoadedOnce]);

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  const [selectedOption, setSelectedOption] = useState('profile');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const [hasManualSelection, setHasManualSelection] = useState(false);

  const [notificationFlyout, setNotificationFlyout] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifErr, setNotifErr] = useState('');
  const [notifLoading, setNotifLoading] = useState(false);

  const [showWelcome, setShowWelcome] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const profileLoadedForIdRef = useRef(null);
  const ordersLoadedForIdRef = useRef(null);
  const notifsLoadedForIdRef = useRef(null);

  const profileInFlightRef = useRef(false);
  const ordersInFlightRef = useRef(false);
  const notifsInFlightRef = useRef(false);

  const profileReqSeqRef = useRef(0);
  const ordersReqSeqRef = useRef(0);
  const notifsReqSeqRef = useRef(0);

  const FETCH_PROFILE_TIMEOUT_MS = 12000;
  const FETCH_ORDERS_TIMEOUT_MS = 15000;
  const FETCH_NOTIFS_TIMEOUT_MS = 12000;

  useEffect(() => {
    const welcome = search.get('welcome') === '1' && search.get('new') === '1';
    const login = search.get('login') === '1';
    if (welcome || login) {
      setShowWelcome(!!welcome);
      setShowLogin(!!login);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', '/customer/dashboard');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      handleAuthLost('unauthenticated');
    }
  }, [status, handleAuthLost]);

  const loadProfile = useCallback(
    async ({ force = false } = {}) => {
      if (!userId) return;
      if (!force && profileLoadedForIdRef.current === userId) return;
      if (profileInFlightRef.current) return;

      profileInFlightRef.current = true;

      if (!profileLoadedOnce || force) setProfileLoading(true);

      const reqId = ++profileReqSeqRef.current;

      try {
        const { res, json } = await fetchJsonWithTimeout('/api/customers/me', { timeoutMs: FETCH_PROFILE_TIMEOUT_MS });

        if (!mountedRef.current || profileReqSeqRef.current !== reqId) return;

        if (res.status === 401 || res.status === 403) {
          handleAuthLost('logged_out');
          return;
        }
        if (!res.ok) throw new Error(json?.error || 'failed to load profile');

        const b = baseRef.current;

        setProfile({
          id: json?.id || b?.id || userId,
          name: json?.name ?? b?.name ?? '',
          email: json?.email ?? b?.email ?? '',
          phone: json?.phone ?? b?.phone ?? '',
          tier: json?.tier ?? '',
          points: typeof json?.points === 'number' ? json.points : 0,
          referral_code: json?.referral_code ?? '',
          referral_id: json?.referral_id ?? '',
        });

        profileLoadedForIdRef.current = userId;
      } catch {
        if (!mountedRef.current || profileReqSeqRef.current !== reqId) return;

        const b = baseRef.current;

        setProfile({
          id: b?.id || userId,
          name: b?.name || '',
          email: b?.email || '',
          phone: b?.phone || '',
          tier: '',
          points: 0,
          referral_code: '',
          referral_id: '',
        });

        // NOTE: do NOT mark loaded-for-id on failure; allows later retry (no UI change, just resilience).
      } finally {
        if (mountedRef.current && profileReqSeqRef.current === reqId) {
          setProfileLoading(false);
          setProfileLoadedOnce(true);
        }
        profileInFlightRef.current = false;
      }
    },
    [userId, profileLoadedOnce, handleAuthLost],
  );

  useEffect(() => {
    if (!userId) return;
    loadProfile({ force: false });
  }, [userId, loadProfile]);

  const loadOrders = useCallback(
    async ({ force = false } = {}) => {
      if (!userId) return;
      if (!force && ordersLoadedForIdRef.current === userId) return;
      if (ordersInFlightRef.current) return;

      ordersInFlightRef.current = true;

      if (!ordersLoadedForIdRef.current || force) setOrdersLoading(true);

      const reqId = ++ordersReqSeqRef.current;

      try {
        const { res, json } = await fetchJsonWithTimeout('/api/customers/orders?limit=200', {
          timeoutMs: FETCH_ORDERS_TIMEOUT_MS,
        });

        if (!mountedRef.current || ordersReqSeqRef.current !== reqId) return;

        if (res.status === 401 || res.status === 403) {
          handleAuthLost('logged_out');
          return;
        }
        if (!res.ok) throw new Error(json?.error || 'failed to load orders');

        // Accept multiple production shapes:
        // - { items: [...] }
        // - { orders: [...] }
        // - { data: [...] }
        // - [...] (plain array)
        let items = [];
        if (Array.isArray(json)) items = json;
        else if (Array.isArray(json?.items)) items = json.items;
        else if (Array.isArray(json?.orders)) items = json.orders;
        else if (Array.isArray(json?.data)) items = json.data;
        else items = [];

        setOrders(items);
        ordersLoadedForIdRef.current = userId;
      } catch {
        if (!mountedRef.current || ordersReqSeqRef.current !== reqId) return;
        setOrders([]);
        // NOTE: do NOT mark loaded-for-id on failure; allows later retry.
      } finally {
        if (mountedRef.current && ordersReqSeqRef.current === reqId) setOrdersLoading(false);
        ordersInFlightRef.current = false;
      }
    },
    [userId, handleAuthLost],
  );

  useEffect(() => {
    if (!userId) return;
    loadOrders({ force: false });
  }, [userId, loadOrders]);

  const fetchNotifications = useCallback(
    async (page = 1, { force = false } = {}) => {
      if (!userId) return;

      if (!force && notifsLoadedForIdRef.current === userId) return;
      if (notifsInFlightRef.current) return;

      notifsInFlightRef.current = true;
      setNotifLoading(true);

      const reqId = ++notifsReqSeqRef.current;

      try {
        setNotifErr('');
        const { res, json } = await fetchJsonWithTimeout(`/api/customers/notifications?page=${page}&pageSize=50`, {
          timeoutMs: FETCH_NOTIFS_TIMEOUT_MS,
        });

        if (!mountedRef.current || notifsReqSeqRef.current !== reqId) return;

        if (res.status === 401 || res.status === 403) {
          handleAuthLost('logged_out');
          return;
        }
        if (!res.ok) throw new Error(json?.error || 'failed to load notifications');

        let items = [];
        if (Array.isArray(json)) items = json;
        else if (Array.isArray(json?.items)) items = json.items;
        else if (Array.isArray(json?.data)) items = json.data;

        setNotifications(items);
        setUnreadCount(typeof json?.unreadCount === 'number' ? json.unreadCount : 0);
        notifsLoadedForIdRef.current = userId;
      } catch (e) {
        if (!mountedRef.current || notifsReqSeqRef.current !== reqId) return;
        setNotifErr(String(e?.message || e));
        // NOTE: do not mark loaded-for-id on failure.
      } finally {
        if (mountedRef.current && notifsReqSeqRef.current === reqId) setNotifLoading(false);
        notifsInFlightRef.current = false;
      }
    },
    [userId, handleAuthLost],
  );

  useEffect(() => {
    if (!userId) return;
    fetchNotifications(1, { force: false });
  }, [userId, fetchNotifications]);

  async function markAllRead() {
    try {
      const { res, json } = await fetchJsonWithTimeout('/api/customers/notifications/mark-read', {
        timeoutMs: 12000,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });

      if (!res.ok) throw new Error(json?.error || 'failed to mark read');

      setNotifications((list) =>
        list.map((n) => ({
          ...n,
          readAt: n.readAt || new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
    } catch {
      // silent
    }
  }

  // IMPORTANT: keep hooks ABOVE conditional returns
  const user = useMemo(() => {
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      tier: profile.tier || '',
      points: profile.points || 0,
      referral_code: profile.referral_code || '',
      referral_id: profile.referral_id || '',
    };
  }, [profile]);

  const handleSelectOption = useCallback(
    (key) => {
      setHasManualSelection(true);
      setSelectedOption(key);

      if (key === 'profile') {
        loadProfile({ force: true });
      } else if (key === 'order-history' || key === 'tracking') {
        loadOrders({ force: true });
      } else if (key === 'notifications') {
        fetchNotifications(1, { force: true });
      }
    },
    [loadOrders, loadProfile, fetchNotifications],
  );

  const recentOrder = useMemo(() => {
    if (!Array.isArray(orders) || orders.length === 0) return null;

    const pickTime = (o) => {
      const t =
        (o?.createdAt && new Date(o.createdAt).getTime()) ||
        (o?.updatedAt && new Date(o.updatedAt).getTime()) ||
        (o?.placedAt && new Date(o.placedAt).getTime()) ||
        0;
      return Number.isFinite(t) ? t : 0;
    };

    let best = orders[0];
    let bestT = pickTime(best);

    for (let i = 1; i < orders.length; i++) {
      const t = pickTime(orders[i]);
      if (t > bestT) {
        best = orders[i];
        bestT = t;
      }
    }
    return best || null;
  }, [orders]);

  const recentOrderStatus = useMemo(() => {
    if (!recentOrder) return '';
    return deriveOrderStatus(recentOrder);
  }, [recentOrder]);

  if (authLost) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          padding: 24,
          textAlign: 'center',
          color: '#0f172a',
        }}
      >
        logged out. redirecting to login…
        {authLostReason ? <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>reason: {authLostReason}</div> : null}
      </div>
    );
  }

  if (status === 'loading' || (!profileLoadedOnce && profileLoading)) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
        }}
      >
        loading your dashboard…
      </div>
    );
  }

  if (!user) return null;

  function WelcomeBlock() {
    const [welcomeTime, setWelcomeTime] = useState('');
    useEffect(() => {
      const h = new Date().getHours();
      if (h < 5) setWelcomeTime('good night');
      else if (h < 12) setWelcomeTime('good morning');
      else if (h < 17) setWelcomeTime('good afternoon');
      else setWelcomeTime('good evening');
    }, []);
    return (
      <div
        className="tdls-welcome"
        style={{
          width: '100%',
          maxWidth: 900,
          margin: '120px auto 12px auto',
          padding: '10px 5px 10px 50px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 17,
          borderBottom: '1.3px solid #e4e7ef',
        }}
        aria-label="welcome panel"
      >
        <a
          href="#dashboard-main"
          id="skip-to-main"
          tabIndex="0"
          style={{
            position: 'absolute',
            left: -1000,
            top: -1000,
            background: '#ff0',
            color: '#222',
            padding: 3,
          }}
        >
          skip to main content
        </a>
        <div className="tdls-welcome-title" style={{ fontWeight: 800, fontSize: 24, color: NAVY }}>
          {welcomeTime},{' '}
          <span style={{ color: '#2A7D46' }}>{user.name}</span>!
        </div>
        <div
          className="tdls-welcome-chip"
          style={{
            marginLeft: 13,
            fontSize: 15,
            color: '#476A8A',
            fontWeight: 500,
            background: '#f7fcfa',
            borderRadius: 8,
            padding: '7px 14px',
            border: '1px solid #e4e7ef',
          }}
        >
          <b>membership:</b> <span style={{ color: NAVY, fontWeight: 800 }}>{user.tier || '—'}</span> &nbsp;|&nbsp;
          <b>points:</b> <span style={{ color: '#267' }}>{user.points}</span>
        </div>
        <div
          className="tdls-welcome-chip"
          style={{
            marginLeft: 13,
            fontSize: 15,
            color: '#876',
            background: '#f7fcfa',
            borderRadius: 8,
            padding: '7px 14px',
            border: '1px solid #e4e7ef',
          }}
        >
          user id: <span style={{ color: NAVY, fontWeight: 700 }}>{user.id}</span>
        </div>
        <div
          className="tdls-welcome-chip"
          style={{
            marginLeft: 13,
            fontSize: 15,
            color: '#876',
            background: '#f7fcfa',
            borderRadius: 8,
            padding: '7px 14px',
            border: '1px solid #e4e7ef',
          }}
        >
          referral:{' '}
          <span style={{ color: NAVY, fontWeight: 700 }}>{user.referral_code || user.referral_id || '—'}</span>
        </div>
        <button
          className="tdls-welcome-notif"
          onClick={() => {
            setNotificationFlyout(true);
            fetchNotifications(1, { force: true });
          }}
          style={{
            marginLeft: 'auto',
            marginTop: '10px',
            marginBottom: '18px',
            background: NAVY,
            color: '#fff',
            borderRadius: 999,
            fontWeight: 700,
            padding: '8px 18px',
            border: 'none',
            fontSize: 14,
            boxShadow: '0 2px 7px #2A394433',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
          aria-label="open notifications"
        >
          <span>notifications</span>
          <span
            style={{
              background: '#F36',
              color: '#fff',
              borderRadius: '999px',
              fontWeight: 900,
              fontSize: 13,
              padding: '2px 9px',
            }}
            aria-live="polite"
          >
            {unreadCount}
          </span>
        </button>
      </div>
    );
  }

  function CustomerSupportBot() {
    const [messages, setMessages] = useState([
      { from: 'bot', text: 'hi! this is your premium tdlc assistant. ask about orders, refunds, wallet, loyalty, policies or anything!' },
    ]);
    const [input, setInput] = useState('');
    const chatRef = useRef();

    function sendMessage(e) {
      e.preventDefault();
      if (!input.trim()) return;
      const current = input;
      setMessages((msgs) => [...msgs, { from: 'user', text: current }]);
      setTimeout(() => {
        setMessages((msgs) => [...msgs, { from: 'bot', text: getBotReply(current) }]);
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }, 700);
      setInput('');
    }

    return (
      <div
        className="tdls-support-bot"
        style={{
          width: '100%',
          maxWidth: 880,
          marginLeft: '85px',
          textAlign: 'center',
          padding: '1.9em 2.3em 2.1em 2.3em',
          background: '#fff',
          borderRadius: 18,
          boxShadow: '0 20px 60px rgba(15,23,42,0.12)',
          border: '1px solid #e4e7ef',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="customer support chat"
      >
        <div
          className="tdls-support-title"
          style={{
            fontWeight: 800,
            fontSize: 22,
            color: NAVY,
            letterSpacing: '.03em',
            margin: '0 auto 0.7em auto',
            textTransform: 'uppercase',
          }}
        >
          chat with support
        </div>
        <div
          ref={chatRef}
          className="tdls-support-chat"
          style={{
            minHeight: 180,
            maxHeight: 370,
            overflowY: 'auto',
            background: '#f6f7fb',
            borderRadius: 12,
            border: '1px solid #e4e7ef',
            margin: '0 auto 18px auto',
            padding: '18px 13px',
            boxShadow: '0 2px 8px #eaeaea50',
            width: '100%',
          }}
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`tdls-chat-bubble ${m.from === 'user' ? 'is-user' : 'is-bot'}`}
              style={{
                margin: '11px 0',
                textAlign: m.from === 'user' ? 'right' : 'left',
                color: m.from === 'user' ? NAVY : '#333',
                background: m.from === 'user' ? '#e3e8fa' : '#eef2f7',
                display: 'inline-block',
                borderRadius: 999,
                padding: '9px 16px',
                maxWidth: '93%',
                fontWeight: 500,
                fontSize: 15,
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              }}
            >
              {m.text}
            </div>
          ))}
        </div>
        <form
          onSubmit={sendMessage}
          className="tdls-support-form"
          style={{
            display: 'flex',
            gap: 10,
            margin: '0 auto',
            maxWidth: 540,
            width: '100%',
          }}
        >
          <input
            className="tdls-support-input"
            style={{
              flex: 1,
              borderRadius: 999,
              padding: '10px 14px',
              border: '1px solid #e4e7ef',
              fontFamily: 'inherit',
              fontSize: 15,
              background: '#fff',
              minWidth: 0,
            }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ask me anything..."
            aria-label="ask the chatbot"
          />
          <button
            type="submit"
            className="tdls-support-send"
            style={{
              background: NAVY,
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '11px 22px',
              fontWeight: 700,
              letterSpacing: '.08em',
              cursor: 'pointer',
              fontSize: 13,
              textTransform: 'uppercase',
              flex: '0 0 auto',
            }}
          >
            send
          </button>
        </form>
      </div>
    );
  }

  function DashboardContent() {
    if (selectedOption === 'returns') {
      return <ReturnExchangeRefundPanel user={user} userId={user.id} />;
    }

    if (selectedOption === 'profile') {
      return (
        <div
          style={{
            width: '100%',
            maxWidth: 730,
            margin: '0 auto',
            padding: '38px 0',
            textAlign: 'left',
          }}
        >
          <div style={{ color: NAVY, fontWeight: 800, fontSize: 22 }}>profile</div>
          <div style={{ color: '#476A8A', marginTop: 8 }}>name: {user.name}</div>
          <div style={{ color: '#476A8A' }}>email: {user.email}</div>
          <div style={{ color: '#476A8A' }}>phone: {user.phone}</div>
          <div style={{ color: '#476A8A' }}>user id: {user.id}</div>
          <div style={{ color: '#476A8A' }}>referral: {user.referral_code || user.referral_id || '—'}</div>
        </div>
      );
    }

    if (selectedOption === 'order-history') {
      return (
        <div
          id="dashboard-main"
          tabIndex={-1}
          className="tdls-main-section"
          style={{
            width: '100%',
            maxWidth: 950,
            margin: '0 auto',
            padding: '38px 0',
            textAlign: 'left',
          }}
        >
          <h2 style={{ fontWeight: 900, fontSize: 25, color: NAVY }}>order history</h2>

          <SafePanel title="live order status & eta">
            <LiveInventoryPanel userId={user.id} showEta />
          </SafePanel>

          <div style={{ marginTop: 20 }}>
            {ordersLoading && <div style={{ color: '#6c7a8a', padding: '12px 0' }}>loading orders…</div>}
            {!ordersLoading && orders.length === 0 && <div style={{ color: '#6c7a8a', padding: '12px 0' }}>no orders found.</div>}
            {!ordersLoading &&
              orders.map((o) => {
                const orderNumber = o.orderNumber || o.id;
                const statusLine = deriveOrderStatus(o);

                const createdAt = o.createdAt ? new Date(o.createdAt) : null;
                const dateLabel = createdAt ? createdAt.toLocaleDateString('en-BD', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
                const timeLabel = createdAt ? createdAt.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' }) : '';
                const itemCount =
                  typeof o.itemCount === 'number'
                    ? o.itemCount
                    : Array.isArray(o.items)
                    ? o.items.reduce((sum, it) => sum + Number(it.quantity || 0), 0)
                    : null;

                const grandTotalNum = typeof o.grandTotal === 'number' ? o.grandTotal : Number(o.total || 0);
                const paidAmountNum = typeof o.paidAmount === 'number' ? o.paidAmount : null;

                const money = (n) =>
                  `৳${Number(n || 0).toLocaleString('en-BD', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`;

                const handleClick = () => {
                  if (o.id) router.push(`/orders/${o.id}/receipt`);
                };

                return (
                  <div
                    key={o.id || orderNumber}
                    onClick={handleClick}
                    style={{
                      background: '#fcfdff',
                      borderRadius: 12,
                      boxShadow: '0 12px 34px rgba(15,23,42,0.07)',
                      padding: 22,
                      marginBottom: 18,
                      border: '1.1px solid #e4e7ef',
                      cursor: 'pointer',
                      transition: 'transform 0.16s ease, box-shadow 0.16s ease',
                    }}
                    className="tdlc-order-card tdls-order-card"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: '#223', fontSize: 17, overflowWrap: 'anywhere' }}>
                          order #{String(orderNumber)}
                        </div>
                        <div style={{ color: '#558', margin: '4px 0 7px 0', overflowWrap: 'anywhere' }}>
                          status: <b>{statusLine}</b>
                          {paidAmountNum != null && (
                            <>
                              {' '}
                              · paid: <b>{money(paidAmountNum)}</b>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 13, color: '#6c7a8a', flex: '0 0 auto' }}>
                        {dateLabel && <div>placed: {dateLabel}</div>}
                        {timeLabel && <div>time: {timeLabel}</div>}
                      </div>
                    </div>

                    <div style={{ marginTop: 6, fontSize: 14, color: '#4b5a72', overflowWrap: 'anywhere' }}>
                      {itemCount != null && (
                        <span>
                          {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
                        </span>
                      )}
                      <span>
                        total: <b>{money(grandTotalNum)}</b>
                      </span>
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 13, color: '#6c7a8a' }}>click to view full details &amp; download invoice</div>
                      <OrderAgainButton orderId={String(orderNumber)} userId={user.id} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      );
    }

    if (selectedOption === 'tracking') {
      return (
        <div
          style={{
            width: '100%',
            maxWidth: 950,
            margin: '0 auto',
            padding: '38px 0',
            textAlign: 'left',
          }}
        >
          <h2 style={{ fontWeight: 900, fontSize: 25, color: NAVY }}>order tracking</h2>
          <SafePanel title="order tracking">
            <LiveInventoryPanel userId={user.id} showTracking />
          </SafePanel>
        </div>
      );
    }

    if (selectedOption === 'points') {
      return (
        <div
          style={{
            width: '100%',
            maxWidth: 650,
            margin: '0 auto',
            padding: '38px 0',
          }}
        >
          <h2 style={{ fontWeight: 900, fontSize: 24, color: NAVY }}>points & rewards</h2>
          <div style={{ fontWeight: 700, color: '#277d4a', fontSize: 22 }}>{user.points} loyalty points</div>
          <LoyaltyPopup user={user} open={false} onClose={() => {}} />
        </div>
      );
    }

    if (['loyalty', 'offers', 'redeem', 'referral'].includes(selectedOption)) {
      return (
        <div
          style={{
            width: '100%',
            maxWidth: 650,
            margin: '0 auto',
            padding: '38px 0',
          }}
        >
          <PersonalizedOffers userId={user.id} />
          <LoyaltyPopup user={user} open={false} onClose={() => {}} />
        </div>
      );
    }

    if (selectedOption === 'wallet') {
      return <div style={{ fontWeight: 700, color: NAVY, fontSize: 23, padding: 70 }}>wallet: balance, statement, add funds, withdraw, view usage history etc.</div>;
    }

    if (selectedOption === 'security') {
      return (
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 23, padding: 70 }}>
          <FraudStatusBadge userId={user.id} />
          <br />
          account secure, no suspicious activity detected.
        </div>
      );
    }

    if (selectedOption === 'activity') {
      return (
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 23, padding: 70 }}>
          <WebVitalsBadge />
          <br />
          all systems performing within performance budget.
        </div>
      );
    }

    if (selectedOption === 'notifications') {
      return (
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto',
            padding: '12px 0 38px 0',
            textAlign: 'left',
          }}
        >
          <h2 style={{ fontWeight: 900, fontSize: 25, color: NAVY, marginBottom: 10 }}>notifications</h2>
          {notifErr && <div style={{ color: '#b00', marginBottom: 10 }}>failed to execute right now. please try again later.</div>}

          {(notifications || []).map((n) => (
            <div
              key={n.id}
              style={{
                border: '1px solid #e4e7ef',
                background: n.readAt ? '#fff' : '#f8fcff',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 10,
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
              }}
            >
              <div style={{ fontWeight: 800, color: NAVY }}>{n.title}</div>
              <div style={{ color: '#476A8A', marginTop: 4 }}>{n.body}</div>
              <div style={{ color: '#6c7a8a', fontSize: 12, marginTop: 6 }}>{new Date(n.createdAt).toLocaleString()}</div>
            </div>
          ))}

          {(!notifications || notifications.length === 0) && <div style={{ color: '#888', padding: '30px 0' }}>no notifications.</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={markAllRead} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">
              mark all as read
            </button>
            <button
              onClick={() => fetchNotifications(1, { force: true })}
              className="rounded border px-3 py-1 text-sm hover:bg-neutral-50"
              disabled={notifLoading}
            >
              {notifLoading ? 'refreshing…' : 'refresh'}
            </button>
          </div>
        </div>
      );
    }

    if (selectedOption === 'policies') {
      return (
        <div
          style={{
            width: '100%',
            maxWidth: 720,
            margin: '0 auto',
            padding: '38px 0',
            textAlign: 'left',
          }}
        >
          <h2 style={{ fontWeight: 900, fontSize: 24, color: NAVY }}>customer policies</h2>
          <p style={{ color: '#4b5a72', marginTop: 12 }}>
            returns, exchanges, refunds, shipping, and privacy policies are always available from the footer and from this
            dashboard. full policy center coming soon.
          </p>
        </div>
      );
    }

    return (
      <div style={{ fontWeight: 700, color: NAVY, fontSize: 23, padding: 70 }}>
        {dashboardOptions.find((opt) => opt.key === selectedOption)?.label || ''}
        <br />
        <span style={{ fontWeight: 400, fontSize: 15, color: '#555' }}>full panel coming soon.</span>
      </div>
    );
  }

  function NotificationFlyout() {
    return (
      <div
        className="tdls-notif-overlay"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(33,40,70,0.22)',
          zIndex: 10000,
          display: notificationFlyout ? 'block' : 'none',
        }}
        onClick={() => {
          setNotificationFlyout(false);
          markAllRead();
        }}
      >
        <div
          className="tdls-notif-panel"
          style={{
            position: 'absolute',
            right: 25,
            top: 100,
            background: '#fff',
            borderRadius: 14,
            minWidth: 340,
            boxShadow: '0 4px 32px #33435544',
            border: '1.5px solid #d7e3f7',
            zIndex: 11000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              fontWeight: 900,
              fontSize: 21,
              color: NAVY,
              padding: 22,
              borderBottom: '1.5px solid #e4e7ef',
            }}
          >
            notifications
            <button
              onClick={() => {
                setNotificationFlyout(false);
                markAllRead();
              }}
              style={{
                float: 'right',
                border: 'none',
                background: 'none',
                fontSize: 25,
                color: NAVY,
                cursor: 'pointer',
              }}
              aria-label="close"
            >
              ×
            </button>
          </div>
          <div className="tdls-notif-body" style={{ maxHeight: 370, overflowY: 'auto', padding: '14px 22px' }}>
            {(notifications || []).length === 0 ? (
              <div style={{ color: '#888', padding: '45px 0' }}>no notifications.</div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    fontWeight: !n.readAt ? 800 : 400,
                    color: !n.readAt ? NAVY : '#476A8A',
                    margin: '9px 0',
                    background: !n.readAt ? '#f8fcff' : '#fff',
                    padding: '7px 5px',
                    borderRadius: 8,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {n.title} — {n.body}
                  <span style={{ color: '#7b7', fontWeight: 400, marginLeft: 8 }}>{new Date(n.createdAt).toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  function EdgeQuickPanel() {
    const [hovered, setHovered] = useState(false);

    return (
      <div
        className="tdlc-edge-panel"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'fixed',
          top: '36%',
          left: 0,
          zIndex: 12000,
          transform: hovered ? 'translateX(0)' : 'translateX(-260px)',
          transition: 'transform 0.25s ease',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div
            style={{
              width: 32,
              background: '#ffffff',
              color: NAVY,
              borderRadius: '0 14px 14px 0',
              fontSize: 11,
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 6px',
              cursor: 'pointer',
              border: `1px solid ${NAVY}`,
              boxShadow: '0 4px 24px rgba(15,23,42,0.35)',
              fontWeight: 700,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
            }}
          >
            MENU
          </div>

          <div
            style={{
              background: NAVY,
              borderRadius: '0 14px 14px 0',
              boxShadow: '0 20px 40px rgba(15,23,42,0.55)',
              padding: '16px 16px 14px 18px',
              minWidth: 260,
              maxWidth: 320,
              border: `1px solid ${NAVY}`,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#F9FAFB',
                marginBottom: 4,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
              }}
            >
              quick access
            </div>
            <div style={{ fontSize: 12, color: '#CBD5F5', marginBottom: 12 }}>
              {user.name || 'guest'} · {user.tier || 'standard'}
            </div>

            <button
              onClick={() => handleSelectOption('order-history')}
              className="tdlc-edge-item"
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: '#E5E7EB',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: 3,
              }}
            >
              📦 Orders & History
            </button>
            <button
              onClick={() => handleSelectOption('returns')}
              className="tdlc-edge-item"
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: '#E5E7EB',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: 3,
              }}
            >
              ↩︎ Returns / Exchanges
            </button>
            <button
              onClick={() => {
                handleSelectOption('notifications');
                setNotificationFlyout(true);
              }}
              className="tdlc-edge-item"
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: '#E5E7EB',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: 3,
              }}
            >
              🔔 Notifications ({unreadCount})
            </button>
            <button
              onClick={() => router.push('/cart')}
              className="tdlc-edge-item"
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: '#E5E7EB',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: 6,
              }}
            >
              🛒 Cart
            </button>

            <div style={{ borderTop: '1px solid rgba(148,163,184,0.35)', margin: '10px 0 8px' }} />

            <div style={{ marginTop: 2 }}>
              <SignoutButton label="Logout" redirectTo="/" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tdls-dashboard-root" style={{ background: SLATE_BG, minHeight: '100vh' }}>
      <Navbar />
      <EdgeQuickPanel />

      {showWelcome && <Banner>your account was created successfully. you’re now signed in.</Banner>}
      {showLogin && <Banner>signed in successfully.</Banner>}

      <div style={{ height: '46px' }} />
      <div
        className="tdls-dashboard-shell"
        style={{
          maxWidth: 1420,
          borderRadius: 32,
          background: '#FFF',
          boxShadow: '0 28px 90px rgba(15,23,42,0.16)',
          padding: '0',
          border: '1.6px solid #e4e7ef',
          minHeight: 800,
          width: '99vw',
          margin: '0 auto',
        }}
      >
        <WelcomeBlock />

        <div
          className="tdls-dashboard-row"
          style={{
            display: 'flex',
            gap: 0,
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
            width: '100%',
            maxWidth: 1300,
            margin: '0 auto',
            padding: '0',
          }}
        >
          <div
            className="tdls-dashboard-left"
            style={{
              minWidth: 230,
              maxWidth: 240,
              width: 230,
              margin: '0',
              marginTop: '26px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <DashboardOptionDropdown
              open={dropdownOpen}
              options={dashboardOptions}
              selectedKey={selectedOption}
              onSelect={handleSelectOption}
              setOpen={setDropdownOpen}
              showMenuLabel={!hasManualSelection}
            />
          </div>

          <div
            className="tdls-dashboard-main"
            style={{
              flex: 1,
              marginLeft: 32,
              marginRight: 8,
              marginTop: '46px',
              minWidth: 390,
              maxWidth: 960,
              width: '100%',
              background: '#FFF',
              borderRadius: 20,
              boxShadow: '0 16px 44px rgba(15,23,42,0.11)',
              padding: '2.5em 2.7em',
              border: '1.1px solid #e4e7ef',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'flex-start',
              minHeight: 510,
              position: 'relative',
            }}
          >
            <DashboardContent />
          </div>
        </div>

        <div style={{ height: 25 }} />

        <div className="tdls-support-wrap" style={{ maxWidth: 960, margin: '0 auto' }}>
          <CustomerSupportBot />
        </div>
      </div>

      <NotificationFlyout />

      <div
        className="tdls-bottom-area"
        style={{
          height: '4.5in',
          minHeight: 260,
          background: SLATE_BG,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: '140px',
        }}
      >
        {recentOrder ? (
          <PaymentMethodsBar
            key={`pmb:${String(recentOrder.orderNumber || '')}:${String(recentOrder.id || '')}:${String(recentOrderStatus)}:${String(
              recentOrder.updatedAt || recentOrder.createdAt || recentOrder.placedAt || '',
            )}`}
            orderId={String(recentOrder.orderNumber || recentOrder.id)}
            locale="en"
            status={recentOrderStatus}
            orderInternalId={String(recentOrder.id || '')}
            orderNumber={String(recentOrder.orderNumber || '')}
            updatedAt={recentOrder.updatedAt || null}
          />
        ) : null}
      </div>

      <WhatsAppFloatingButton />

      <Bottomfloatingbar
        key={`bfb:${String(recentOrder?.orderNumber || '')}:${String(recentOrder?.id || '')}:${String(recentOrderStatus)}:${String(
          recentOrder?.updatedAt || recentOrder?.createdAt || recentOrder?.placedAt || '',
        )}`}
        latestOrder={
          recentOrder
            ? {
                id: String(recentOrder.id || ''),
                orderNumber: String(recentOrder.orderNumber || ''),
                status: String(recentOrderStatus || ''),
                updatedAt: recentOrder.updatedAt || null,
              }
            : null
        }
      />

      <style>{`
        /* Keep desktop intact; mobile overrides are isolated to new class selectors. */
        .tdlc-edge-panel { pointer-events: auto; }
        .tdlc-edge-panel .tdlc-edge-item:hover {
          background: rgba(15,23,42,0.78);
          transform: translateX(2px);
        }
        .tdlc-nav-option:hover {
          background: ${NAVY} !important;
          color: #ffffff !important;
          transform: translateX(3px);
        }
        .tdlc-nav-option:hover span:last-child { opacity: 1 !important; }
        .tdlc-order-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 50px rgba(15,23,42,0.18);
        }

        /* Base safety: prevent any accidental horizontal overflow on small screens */
        .tdls-dashboard-root { overflow-x: clip; }
        .tdls-dashboard-root, .tdls-dashboard-root * { box-sizing: border-box; }

        @media (max-width: 900px) {
          .tdlc-edge-panel { display: none !important; }
        }

        /* Tablet / small laptop: keep structure but tighten padding (no desktop change above 1100px) */
        @media (max-width: 1100px) {
          .tdls-dashboard-shell { max-width: 99vw !important; width: 99vw !important; }
          .tdls-dashboard-row { max-width: 99vw !important; padding: 0 10px !important; }
          .tdls-dashboard-left { min-width: 180px !important; width: 180px !important; }
          .tdls-dashboard-main { margin-left: 12px !important; padding: 1.4em 1.1em !important; min-width: 0 !important; }
          .tdls-support-wrap { max-width: 99vw !important; padding: 0 10px !important; }
        }

        /* Mobile: restructure layout (column), reduce all CTA/font sizes, guarantee no overflow */
        @media (max-width: 768px) {
          /* Safe-area friendly padding (iOS) */
          .tdls-dashboard-root {
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
          }

          .tdls-banner { margin: 12px 12px 0 12px !important; }

          .tdls-dashboard-shell {
            width: 100vw !important;
            max-width: 100vw !important;
            border-radius: 18px !important;
            margin: 0 auto !important;
            overflow: hidden;
          }

          .tdls-welcome {
            max-width: 100% !important;
            margin: 92px auto 10px auto !important;
            padding: 10px 12px 8px 12px !important;
            gap: 10px !important;
          }
          .tdls-welcome-title { font-size: 18px !important; }
          .tdls-welcome-chip {
            margin-left: 0 !important;
            font-size: 12px !important;
            padding: 6px 10px !important;
            border-radius: 10px !important;
            max-width: 100% !important;
            overflow-wrap: anywhere !important;
          }
          .tdls-welcome-notif {
            width: 100% !important;
            margin-left: 0 !important;
            margin-bottom: 10px !important;
            justify-content: center !important;
            font-size: 12px !important;
            padding: 8px 14px !important;
          }
          .tdls-welcome-notif span[aria-live="polite"] { font-size: 12px !important; padding: 2px 8px !important; }

          .tdls-dashboard-row {
            flex-direction: column !important;
            padding: 0 10px 12px 10px !important;
            gap: 10px !important;
          }
          .tdls-dashboard-left {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            margin-top: 10px !important;
            align-items: stretch !important;
          }
          .tdls-dd-wrap {
            width: 100% !important;
            margin-top: 8px !important;
            margin-right: 0 !important;
            padding: 0 2px !important;
          }
          .tdls-dd-label { font-size: 10px !important; margin-left: 2px !important; }
          .tdls-dd-btn {
            padding: 9px 12px !important;
            font-size: 12px !important;
            letter-spacing: .06em !important;
          }
          .tdls-dd-icon { width: 20px !important; height: 20px !important; font-size: 10px !important; }
          .tdls-dd-list {
            width: calc(100vw - 24px) !important;
            min-width: 0 !important;
            left: 0 !important;
            border-radius: 14px !important;
            max-height: 58vh !important;
          }
          .tdlc-nav-option { font-size: 13px !important; padding: 10px 12px !important; }

          .tdls-dashboard-main {
            margin-left: 0 !important;
            margin-right: 0 !important;
            margin-top: 6px !important;
            min-width: 0 !important;
            max-width: 100% !important;
            width: 100% !important;
            border-radius: 16px !important;
            padding: 14px 12px !important;
            min-height: auto !important;
            box-shadow: 0 14px 34px rgba(15,23,42,0.10) !important;
          }

          /* Tighten typical section typography inside the content panel */
          .tdls-dashboard-main h2 { font-size: 18px !important; }
          .tdls-order-card { padding: 14px !important; }
          .tdls-order-card div[style*="font-size: 17"] { font-size: 14px !important; }
          .tdls-order-card div[style*="font-size: 14"] { font-size: 13px !important; }
          .tdls-order-card div[style*="font-size: 13"] { font-size: 12px !important; }

          /* Support bot: remove left offset and reduce vertical footprint */
          .tdls-support-wrap { max-width: 100% !important; padding: 0 10px 20px 10px !important; }
          .tdls-support-bot {
            margin-left: 0 !important;
            max-width: 100% !important;
            padding: 14px 12px 12px 12px !important;
            border-radius: 16px !important;
          }
          .tdls-support-title { font-size: 16px !important; }
          .tdls-support-chat {
            min-height: 140px !important;
            max-height: 44vh !important;
            padding: 12px 10px !important;
          }
          .tdls-chat-bubble { font-size: 13px !important; padding: 8px 12px !important; max-width: 96% !important; }
          .tdls-support-form { max-width: 100% !important; gap: 8px !important; }
          .tdls-support-input { font-size: 13px !important; padding: 9px 12px !important; }
          .tdls-support-send { font-size: 12px !important; padding: 10px 14px !important; }

          /* Notification flyout: fit within the screen */
          .tdls-notif-panel {
            left: 12px !important;
            right: 12px !important;
            top: 78px !important;
            min-width: 0 !important;
            width: calc(100vw - 24px) !important;
          }
          .tdls-notif-body { max-height: 64vh !important; padding: 12px 14px !important; }

          /* Bottom area: reduce giant reserved space on mobile to avoid long blank scroll */
          .tdls-bottom-area {
            height: auto !important;
            min-height: 160px !important;
            padding-bottom: 110px !important;
          }
        }

        /* Very short height (landscape phones): keep everything inside viewport */
        @media (max-width: 768px) and (max-height: 520px) {
          .tdls-welcome { margin-top: 78px !important; }
          .tdls-support-chat { max-height: 38vh !important; }
          .tdls-dd-list { max-height: 48vh !important; }
        }
      `}</style>
    </div>
  );
}
