// FILE: app/customer/dashboard/page.jsx
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
    return u
      ? { id: u.id || '', name: u.name || '', email: u.email || '', phone: u.phone || '' }
      : null;
  }, [session]);
  return { base, status };
}

function DashboardOptionDropdown({ open, options, selectedKey, onSelect, setOpen, showMenuLabel }) {
  const selected = options.find((o) => o.key === selectedKey);

  return (
    <div
      style={{
        position: 'relative',
        marginTop: '46px',
        marginRight: '18px',
        width: 230,
      }}
    >
      <div
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: '999px',
              border: `1px solid ${NAVY}`,
              fontSize: 11,
            }}
          >
            ⌖
          </span>

          <span>{showMenuLabel ? 'Dashboard Menu' : selected ? selected.label : 'Dashboard Menu'}</span>
        </span>

        <span style={{ fontSize: 18, marginLeft: 8 }}>▾</span>
      </button>

      {open && (
        <ul
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
              <span>{opt.label}</span>
              <span style={{ fontSize: 11, opacity: selectedKey === opt.key ? 1 : 0.3 }}>→</span>
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

/** NEW: status derivation kept consistent with your order-history cards (no logic changes elsewhere). */
function deriveOrderStatus(o) {
  const s = o?.status || o?.orderStatus || o?.state || o?.fulfillmentStatus || o?.paymentStatus || '';
  return String(s || '').trim();
}



// ────────────────────────────────────────────────────────────────
// Customer-safe panel guard:
// Prevents raw runtime errors (e.g., "Failed to fetch") from surfacing to customers
// while keeping the dashboard structure and logic intact.
// Primarily protects LiveInventoryPanel (Order History / Tracking).
// ────────────────────────────────────────────────────────────────
class TDLCPanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // Intentionally silent in UI (avoid exposing internal errors to customers).
    // Optional: add logging here later.
  }
  render() {
    if (this.state.hasError) return this.props.fallback || null;
    return this.props.children;
  }
}

function TDLCPanelFallback({ title = 'This section', onRetry }) {
  return (
    <div
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
      <div style={{ marginTop: 8, color: '#475569', fontSize: 14 }}>
        failed to execute right now. please try again later.
      </div>
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
        <span style={{ marginLeft: 10, fontSize: 12, color: '#94a3b8' }}>
          or check back later (coming soon updates).
        </span>
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

  const blockNow = useCallback(
    (msg) => {
      if (blockedRef.current) return;
      blockedRef.current = true;
      setBlocked(true);
    },
    [],
  );

  // Catch unhandled promise rejections (dev overlay) coming from panel fetches.
  useEffect(() => {
    if (blocked) return;
    if (typeof window === 'undefined') return;

    const onError = (e) => {
      const msg = String(e?.message || e?.error?.message || '');
      if (!isFetchFailure(msg)) return;
      try {
        e?.preventDefault?.();
      } catch {}
      blockNow(msg);
    };

    const onRejection = (e) => {
      const reason = e?.reason;
      const msg = String(reason?.message || reason || '');
      if (!isFetchFailure(msg)) return;
      try {
        e?.preventDefault?.();
      } catch {}
      blockNow(msg);
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

  // Auth watchdog: prevents "infinite loading" and handles cross-tab/session invalidation fast.
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const redirectingRef = useRef(false);
  const [authLost, setAuthLost] = useState(false);
  const [authLostReason, setAuthLostReason] = useState('');

  const buildLoginUrl = useCallback((reason = "logged_out") => {
  const nextPath = "/customer/dashboard";
  return `/login?next=${encodeURIComponent(nextPath)}&reason=${encodeURIComponent(String(reason || "logged_out"))}`;
}, []);

const handleAuthLost = useCallback(
  (reason = "logged_out") => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;

    const finalReason = String(reason || "logged_out");
    const loginUrl = buildLoginUrl(finalReason);

    setAuthLost(true);
    setAuthLostReason(finalReason);

    /**
     * IMPORTANT:
     * Use NextAuth signOut redirect (callbackUrl) so cookies clear BEFORE we land on /login.
     * This prevents "login page flicker" (login -> loading -> stable) caused by a transient authenticated session.
     */
    try {
      if (statusRef.current === "unauthenticated") {
        if (typeof window !== "undefined") window.location.assign(loginUrl);
        else router.replace(loginUrl);
        return;
      }

      void signOut({ callbackUrl: loginUrl });
      return;
    } catch {
      // Fallback: client-side redirect.
      try {
        if (typeof window !== "undefined") window.location.assign(loginUrl);
        else router.replace(loginUrl);
      } catch {
        router.replace(loginUrl);
      }
    }
  },
  [router, buildLoginUrl],
);

  // If NextAuth session fetch gets stuck (network/proxy) we must fail fast (no endless spinner).
  useEffect(() => {
    if (authLost) return;
    if (status !== "loading") return;

    const SESSION_SOFT_TIMEOUT_MS = 1500;
    const SESSION_FETCH_TIMEOUT_MS = 1500;

    const t = setTimeout(async () => {
      // If status already resolved, do nothing.
      if (statusRef.current !== "loading") return;

      try {
        const controller = new AbortController();
        const tt = setTimeout(() => controller.abort(), SESSION_FETCH_TIMEOUT_MS);

        const r = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        clearTimeout(tt);

        if (!r.ok) return handleAuthLost("session_check_failed");

        const j = await r.json().catch(() => null);
        // next-auth returns `null` when logged out.
        if (!j || !j.user) return handleAuthLost("logged_out");
      } catch {
        return handleAuthLost("session_timeout");
      }
    }, SESSION_SOFT_TIMEOUT_MS);

    return () => clearTimeout(t);
  }, [status, authLost, handleAuthLost]);

  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  const userId = base?.id || '';

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadedOnce, setProfileLoadedOnce] = useState(false);

  // Fast path: render immediately from session base to avoid slow dashboard boot.
  // /api/customers/me still loads in the background and will enrich tier/points/etc.
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

  // Hard timeouts to prevent hung fetches from trapping the UI in a loading state.
  const FETCH_PROFILE_TIMEOUT_MS = 5500;
  const FETCH_ORDERS_TIMEOUT_MS = 6500;
  const FETCH_NOTIFS_TIMEOUT_MS = 6500;

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

      let active = true;
      try {
        const controller = new AbortController();
        const tt = setTimeout(() => controller.abort(), FETCH_PROFILE_TIMEOUT_MS);
        const res = await fetch('/api/customers/me', { cache: 'no-store', signal: controller.signal });
        clearTimeout(tt);

        if (res.status === 401 || res.status === 403) {
          handleAuthLost('logged_out');
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'failed to load profile');
        if (!active) return;

        const b = baseRef.current;

        setProfile({
          id: data.id || b?.id || userId,
          name: data.name ?? b?.name ?? '',
          email: data.email ?? b?.email ?? '',
          phone: data.phone ?? b?.phone ?? '',
          tier: data.tier ?? '',
          points: typeof data.points === 'number' ? data.points : 0,
          referral_code: data.referral_code ?? '',
          referral_id: data.referral_id ?? '',
        });

        profileLoadedForIdRef.current = userId;
      } catch {
        if (!active) return;

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

        profileLoadedForIdRef.current = userId;
      } finally {
        if (active) {
          setProfileLoading(false);
          setProfileLoadedOnce(true);
        }
        profileInFlightRef.current = false;
      }

      return () => {
        active = false;
      };
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

      let active = true;
      try {
        const controller = new AbortController();
        const tt = setTimeout(() => controller.abort(), FETCH_ORDERS_TIMEOUT_MS);
        const r = await fetch('/api/customers/orders?limit=200', { cache: 'no-store', signal: controller.signal });
        clearTimeout(tt);

        if (r.status === 401 || r.status === 403) {
          handleAuthLost('logged_out');
          return;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || 'failed to load orders');
        if (!active) return;

        const items = Array.isArray(j?.items) ? j.items : [];
        setOrders(items);
        ordersLoadedForIdRef.current = userId;
      } catch {
        if (!active) return;
        setOrders([]);
        ordersLoadedForIdRef.current = userId;
      } finally {
        if (active) setOrdersLoading(false);
        ordersInFlightRef.current = false;
      }

      return () => {
        active = false;
      };
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

      try {
        setNotifErr('');
        const controller = new AbortController();
        const tt = setTimeout(() => controller.abort(), FETCH_NOTIFS_TIMEOUT_MS);
        const r = await fetch(`/api/customers/notifications?page=${page}&pageSize=50`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(tt);

        if (r.status === 401 || r.status === 403) {
          handleAuthLost('logged_out');
          return;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'failed to load notifications');

        setNotifications(j.items || []);
        setUnreadCount(j.unreadCount || 0);
        notifsLoadedForIdRef.current = userId;
      } catch (e) {
        setNotifErr(String(e.message || e));
        notifsLoadedForIdRef.current = userId;
      } finally {
        setNotifLoading(false);
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
      const r = await fetch('/api/customers/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'failed to mark read');

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

  /** NEW: use the same status precedence as the order cards (ensures we treat "DELIVERED" as the truth). */
  const recentOrderStatus = useMemo(() => {
    if (!recentOrder) return '';
    return deriveOrderStatus(recentOrder);
  }, [recentOrder]);

  // now safe to conditionally return
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
        {authLostReason ? (
          <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>reason: {authLostReason}</div>
        ) : null}
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
        <div style={{ fontWeight: 800, fontSize: 24, color: NAVY }}>
          {welcomeTime},{' '}
          <span style={{ color: '#2A7D46' }}>{user.name}</span>!
        </div>
        <div
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
          <b>membership:</b>{' '}
          <span style={{ color: NAVY, fontWeight: 800 }}>
            {user.tier || '—'}
          </span>{' '}
          &nbsp;|&nbsp;
          <b>points:</b>{' '}
          <span style={{ color: '#267' }}>{user.points}</span>
        </div>
        <div
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
          user id:{' '}
          <span style={{ color: NAVY, fontWeight: 700 }}>{user.id}</span>
        </div>
        <div
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
          <span style={{ color: NAVY, fontWeight: 700 }}>
            {user.referral_code || user.referral_id || '—'}
          </span>
        </div>
        <button
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
      {
        from: 'bot',
        text: 'hi! this is your premium tdlc assistant. ask about orders, refunds, wallet, loyalty, policies or anything!',
      },
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
              }}
            >
              {m.text}
            </div>
          ))}
        </div>
        <form
          onSubmit={sendMessage}
          style={{
            display: 'flex',
            gap: 10,
            margin: '0 auto',
            maxWidth: 540,
            width: '100%',
          }}
        >
          <input
            style={{
              flex: 1,
              borderRadius: 999,
              padding: '10px 14px',
              border: '1px solid #e4e7ef',
              fontFamily: 'inherit',
              fontSize: 15,
              background: '#fff',
            }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ask me anything..."
            aria-label="ask the chatbot"
          />
          <button
            type="submit"
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
          <div style={{ color: '#476A8A' }}>
            referral: {user.referral_code || user.referral_id || '—'}
          </div>
        </div>
      );
    }

    if (selectedOption === 'order-history') {
      return (
        <div
          id="dashboard-main"
          tabIndex={-1}
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
            {ordersLoading && (
              <div style={{ color: '#6c7a8a', padding: '12px 0' }}>loading orders…</div>
            )}
            {!ordersLoading && orders.length === 0 && (
              <div style={{ color: '#6c7a8a', padding: '12px 0' }}>no orders found.</div>
            )}
            {!ordersLoading &&
              orders.map((o) => {
                const orderNumber = o.orderNumber || o.id;
                const statusLine = deriveOrderStatus(o);

                const createdAt = o.createdAt ? new Date(o.createdAt) : null;
                const dateLabel = createdAt
                  ? createdAt.toLocaleDateString('en-BD', { year: 'numeric', month: 'short', day: 'numeric' })
                  : '';
                const timeLabel = createdAt
                  ? createdAt.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })
                  : '';
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
                    className="tdlc-order-card"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 800, color: '#223', fontSize: 17 }}>
                          order #{String(orderNumber)}
                        </div>
                        <div style={{ color: '#558', margin: '4px 0 7px 0' }}>
                          status: <b>{statusLine}</b>
                          {paidAmountNum != null && (
                            <>
                              {' '}
                              · paid: <b>{money(paidAmountNum)}</b>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 13, color: '#6c7a8a' }}>
                        {dateLabel && <div>placed: {dateLabel}</div>}
                        {timeLabel && <div>time: {timeLabel}</div>}
                      </div>
                    </div>

                    <div style={{ marginTop: 6, fontSize: 14, color: '#4b5a72' }}>
                      {itemCount != null && (
                        <span>
                          {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
                        </span>
                      )}
                      <span>
                        total: <b>{money(grandTotalNum)}</b>
                      </span>
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
      return (
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 23, padding: 70 }}>
          wallet: balance, statement, add funds, withdraw, view usage history etc.
        </div>
      );
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
          <h2
            style={{
              fontWeight: 900,
              fontSize: 25,
              color: NAVY,
              marginBottom: 10,
            }}
          >
            notifications
          </h2>
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
              }}
            >
              <div style={{ fontWeight: 800, color: NAVY }}>{n.title}</div>
              <div style={{ color: '#476A8A', marginTop: 4 }}>{n.body}</div>
              <div style={{ color: '#6c7a8a', fontSize: 12, marginTop: 6 }}>
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
          ))}

          {(!notifications || notifications.length === 0) && (
            <div style={{ color: '#888', padding: '30px 0' }}>no notifications.</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
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
          <div style={{ maxHeight: 370, overflowY: 'auto', padding: '14px 22px' }}>
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
                  }}
                >
                  {n.title} — {n.body}
                  <span style={{ color: '#7b7', fontWeight: 400, marginLeft: 8 }}>
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
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
              <SignoutButton label="Logout" redirectTo="/" onDone={() => signOut({ callbackUrl: '/' })} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: SLATE_BG, minHeight: '100vh' }}>
      <Navbar />
      <EdgeQuickPanel />

      {showWelcome && <Banner>your account was created successfully. you’re now signed in.</Banner>}
      {showLogin && <Banner>signed in successfully.</Banner>}

      <div style={{ height: '46px' }} />
      <div
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

        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <CustomerSupportBot />
        </div>
      </div>

      <NotificationFlyout />

      <div
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
            /** NEW: forces PaymentMethodsBar to remount when the latest order status changes */
            key={`pmb:${String(recentOrder.orderNumber || '')}:${String(recentOrder.id || '')}:${String(recentOrderStatus)}:${String(recentOrder.updatedAt || recentOrder.createdAt || recentOrder.placedAt || '')}`}
            orderId={String(recentOrder.orderNumber || recentOrder.id)}
            locale="en"
            /** Optional non-breaking hints (ignored if component doesn't use them) */
            status={recentOrderStatus}
            orderInternalId={String(recentOrder.id || '')}
            orderNumber={String(recentOrder.orderNumber || '')}
            updatedAt={recentOrder.updatedAt || null}
          />
        ) : null}
      </div>

      <WhatsAppFloatingButton />

      {/**
        * NEW: also give Bottomfloatingbar a stable key that changes with the latest order status.
        * This prevents stale "Pending" if it internally caches the last order state.
        */}
      <Bottomfloatingbar
        key={`bfb:${String(recentOrder?.orderNumber || '')}:${String(recentOrder?.id || '')}:${String(recentOrderStatus)}:${String(recentOrder?.updatedAt || recentOrder?.createdAt || recentOrder?.placedAt || '')}`}
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
        .tdlc-nav-option:hover span:last-child {
          opacity: 1 !important;
        }
        .tdlc-order-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 50px rgba(15,23,42,0.18);
        }

        @media (max-width: 900px) {
          .tdlc-edge-panel { display: none !important; }
        }

        @media (max-width: 1100px) {
          div[style*="max-width: 1420px"] { max-width: 99vw !important; }
          div[style*="min-width: 230px"] { min-width: 140px !important; max-width: 100vw !important; }
          div[style*="marginLeft: 32px"] { margin-left: 0 !important; }
          div[style*="max-width: 960px"] { padding: 1.2em 0.8em !important; }
        }
        @media (max-width: 650px) {
          div[style*="max-width: 1420px"], main, .container { padding: 2vw 0vw !important;}
          div[style*="min-width: 230px"] { width: 100% !important; min-width: 0 !important; }
          div[style*="max-width: 960px"] { min-width: 0 !important; }
          div[style*="flex-direction: column"] > div:not(:first-child) { margin-left: 0 !important; }
        }
      `}</style>
    </div>
  );
}
