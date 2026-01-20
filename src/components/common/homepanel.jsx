// PATH: src/components/common/homepanel.jsx
"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import HomePanelAllProducts from "@/components/common/homepanel_all_products";

/* Brand tokens */
const NAVY = "#0F2147";
const NAVY_DARK = "#050b1f";
const NAVY_SOFT = "#233356";
const GOLD = "#C9B065";
const BORDER = "#E1E4F0";
const SURFACE = "#FFFFFF";

const LUX_FONT = "'Playfair Display','Georgia',serif";
const SYS_FONT =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/* ---------- helpers ---------- */
function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function formatBDT(amount) {
  const v = n(amount, 0);
  if (!Number.isFinite(v) || v <= 0) return null;
  try {
    return v.toLocaleString("en-BD", {
      style: "currency",
      currency: "BDT",
      maximumFractionDigits: 0,
    });
  } catch {
    return `৳${Math.round(v).toLocaleString("en-US")}`;
  }
}

function absUrl(url) {
  if (!url) return "";
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;

  const base =
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.NEXT_PUBLIC_STRAPI_URL ||
    process.env.NEXT_PUBLIC_MEDIA_URL ||
    process.env.STRAPI_API_URL ||
    process.env.STRAPI_URL ||
    "";

  return base
    ? `${String(base).replace(/\/+$/, "")}${u.startsWith("/") ? "" : "/"}${u}`
    : u;
}

function clampInt(v, minV, maxV) {
  return Math.max(minV, Math.min(maxV, v));
}

/** read CSS variable (like --nav-h) set by Navbar */
function readCssPxVar(name, fallbackPx) {
  if (typeof window === "undefined") return fallbackPx;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const px = parseInt(String(raw || "").replace("px", "").trim(), 10);
    return Number.isFinite(px) && px > 0 ? px : fallbackPx;
  } catch {
    return fallbackPx;
  }
}

function getStrapiAttrs(item) {
  const a = item?.attributes;
  return a && typeof a === "object" ? a : item || {};
}

function pickImageUrl(item) {
  const a = getStrapiAttrs(item);

  const candidates = [
    a.coverImageUrl,
    item?.coverImageUrl,
    a.imageUrl,
    item?.imageUrl,
    a.thumbnailUrl,
    item?.thumbnailUrl,

    a.coverImage?.url,
    item?.coverImage?.url,
    a.coverImage?.data?.attributes?.url,
    item?.coverImage?.data?.attributes?.url,

    a.thumb?.url,
    item?.thumb?.url,
    a.thumbnail?.url,
    item?.thumbnail?.url,

    a.cover?.data?.attributes?.url,
    a.image?.data?.attributes?.url,
    a.thumbnail?.data?.attributes?.url,
    a.heroImage?.data?.attributes?.url,

    a.images?.data?.[0]?.attributes?.url,
    a.gallery?.data?.[0]?.attributes?.url,
    a.media?.data?.[0]?.attributes?.url,

    a.images?.[0]?.url,
    a.images?.[0],
    item?.images?.[0]?.url,
    item?.images?.[0],
  ];

  for (const c of candidates) {
    const u = String(c || "").trim();
    if (u) return u;
  }
  return "";
}

function pickTitle(item) {
  const a = getStrapiAttrs(item);
  return (
    a.title ||
    item?.title ||
    a.name ||
    item?.name ||
    a.productName ||
    item?.productName ||
    "TDLS piece"
  );
}

function pickSlug(item) {
  const a = getStrapiAttrs(item);
  return a.slug || item?.slug || "";
}

function pickAlt(item) {
  const a = getStrapiAttrs(item);
  return (
    a.coverImageAlt ||
    item?.coverImageAlt ||
    a.imageAlt ||
    item?.imageAlt ||
    pickTitle(item) ||
    "Product"
  );
}

function safeHref(item) {
  if (!item) return "/product";
  const href = String(item.href || "").trim();
  if (href.startsWith("/")) return href;

  const slug = pickSlug(item);
  if (slug) return `/product/${slug}`;

  const id = item?.id || getStrapiAttrs(item)?.id;
  if (id) return `/product/${id}`;

  return "/product";
}

function normalizeHighlightItem(it) {
  return {
    ...it,
    title: pickTitle(it),
    slug: pickSlug(it),
    href: safeHref(it),
    coverImageUrl: pickImageUrl(it),
    coverImageAlt: pickAlt(it),
  };
}

/* --------- Strapi proxy fallback (uses your existing /api/strapi) --------- */
async function fetchFromStrapi(path, signal) {
  try {
    const res = await fetch(`/api/strapi?path=${encodeURIComponent(path)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function unwrapStrapiProxy(json) {
  if (!json) return null;
  return json?.ok ? json.data : json;
}

function toProductArrayFromStrapiPayload(payload) {
  if (!payload) return [];
  const list = payload?.data;
  if (!Array.isArray(list)) return [];
  return list.map((node) =>
    node?.attributes ? { id: node.id, ...node.attributes, attributes: node.attributes } : node
  );
}

function guessSoldCount(p) {
  const a = getStrapiAttrs(p);
  const candidates = [a.totalSold, a.total_sold, a.sold, a.soldCount, a.salesCount, a.orderCount];
  for (const c of candidates) {
    const v = Number(c);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

function guessUpdatedAt(p) {
  const a = getStrapiAttrs(p);
  const candidates = [a.updatedAt, a.publishedAt, a.createdAt, p?.updatedAt, p?.createdAt];
  for (const c of candidates) {
    const t = Date.parse(String(c || ""));
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function buildHighlightsFromProducts(products) {
  const normalized = (Array.isArray(products) ? products : []).map((p) => {
    const a = getStrapiAttrs(p);
    const sold = guessSoldCount(p);
    return normalizeHighlightItem({
      ...p,
      title: pickTitle(p),
      slug: pickSlug(p),
      href: safeHref(p),
      coverImageUrl: pickImageUrl(p),
      coverImageAlt: pickAlt(p),
      priceFrom: a.priceFrom ?? a.price_from ?? a.price ?? a.sale_price ?? a.salePrice,
      priceTo: a.priceTo ?? a.price_to ?? a.mrp ?? a.compare_at_price ?? a.compareAtPrice,
      totalSold: sold,
      _t: guessUpdatedAt(p),
    });
  });

  const trending = [...normalized]
    .sort((x, y) => n(y._t, 0) - n(x._t, 0))
    .slice(0, 12)
    .map(({ _t, ...rest }) => rest);

  const best = [...normalized]
    .sort((x, y) => n(y.totalSold, -1) - n(x.totalSold, -1) || n(y._t, 0) - n(x._t, 0))
    .slice(0, 12)
    .map(({ _t, ...rest }) => rest);

  return { trendingProducts: trending, bestSellerProducts: best };
}

function Icon({ name = "spark" }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
  };

  if (name === "user") {
    return (
      <svg {...common}>
        <path d="M20 21a8 8 0 0 0-16 0" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === "bag") {
    return (
      <svg {...common}>
        <path d="M7 9V7a5 5 0 0 1 10 0v2" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 9h12l-1 12H7L6 9Z" stroke={NAVY} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "cart") {
    return (
      <svg {...common}>
        <path d="M6 6h15l-2 9H7L6 6Z" stroke={NAVY} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M6 6 5 3H2" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === "spark") {
    return (
      <svg {...common}>
        <path
          d="M12 2l1.2 5.2L18 9l-4.8 1.8L12 16l-1.2-5.2L6 9l4.8-1.8L12 2Z"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M19 13l.7 3L22 17l-2.3 1-.7 3-.7-3L16 17l2.3-1 .7-3Z"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return <span />;
}

function PillButton({
  title,
  subtitle,
  icon,
  onClick,
  variant = "dark",
  disabled = false,
  buttonRef,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ariaExpanded,
  ariaHaspopup,
  ariaControls,
}) {
  const bg =
    variant === "gold"
      ? "linear-gradient(135deg,#FFF7D6 0%, #F6D77B 40%, #C9B065 100%)"
      : variant === "glass"
      ? "linear-gradient(135deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,.65) 100%)"
      : "linear-gradient(180deg,#1b2d64 0%,#0f2147 100%)";

  const color = variant === "dark" ? "#FFFFFF" : NAVY;

  const handleEnter = (e) => {
    if (!disabled) {
      e.currentTarget.style.transform = "translateY(-1px)";
      e.currentTarget.style.filter = "saturate(1.05)";
    }
    onMouseEnter?.(e);
  };

  const handleLeave = (e) => {
    e.currentTarget.style.transform = "translateY(0)";
    e.currentTarget.style.filter = "none";
    onMouseLeave?.(e);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
      style={{
        width: "100%",
        maxWidth: "100%",
        borderRadius: 999,
        border: `1px solid ${variant === "dark" ? "rgba(255,255,255,.10)" : BORDER}`,
        background: bg,
        color,
        padding: "12px 14px",
        boxShadow:
          variant === "dark" ? "0 18px 44px rgba(15,33,71,.34)" : "0 16px 40px rgba(6,10,24,.12)",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "transform .12s ease, box-shadow .12s ease, filter .12s ease",
        textAlign: "left",
        touchAction: "manipulation",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background:
              variant === "dark"
                ? "linear-gradient(135deg, rgba(255,255,255,.18) 0%, rgba(255,255,255,.06) 100%)"
                : "linear-gradient(135deg,#ffffff 0%, #f3f4f6 100%)",
            border: variant === "dark" ? "1px solid rgba(255,255,255,.12)" : `1px solid ${BORDER}`,
            boxShadow: "0 12px 28px rgba(6,10,24,.12)",
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ opacity: 0.95 }}>{icon}</span>
        </span>

        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div
            style={{
              fontFamily: SYS_FONT,
              fontWeight: 900,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              fontSize: 11.5,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                marginTop: 4,
                fontFamily: SYS_FONT,
                fontSize: 12.5,
                fontWeight: 700,
                opacity: variant === "dark" ? 0.86 : 0.72,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        <span
          style={{
            fontFamily: SYS_FONT,
            fontSize: 12,
            fontWeight: 900,
            opacity: variant === "dark" ? 0.95 : 0.8,
            flex: "0 0 auto",
          }}
        >
          ↗
        </span>
      </div>
    </button>
  );
}

/* ---------- extracted UI components ---------- */
function TabButton({ id, label, labelSub, active, onSelect }) {
  const isActive = !!active;
  return (
    <button
      type="button"
      onClick={() => onSelect?.(id)}
      role="tab"
      aria-selected={isActive}
      style={{
        padding: "8px 14px",
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        background: isActive
          ? `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DARK} 100%)`
          : "rgba(15,22,45,0.05)",
        color: isActive ? "#FDFCF8" : NAVY_SOFT,
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: SYS_FONT,
        fontSize: 11.5,
        fontWeight: 900,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        boxShadow: isActive ? "0 14px 34px rgba(6,10,24,.28)" : "none",
        transition: "background .16s ease, color .16s ease, box-shadow .16s ease, transform .12s ease",
        maxWidth: "100%",
        minWidth: 0,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <span>{label}</span>
      {labelSub ? (
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            textTransform: "none",
            opacity: 0.85,
            letterSpacing: 0,
          }}
        >
          {labelSub}
        </span>
      ) : null}
    </button>
  );
}

function RailItem({
  item,
  index,
  isActive,
  onHover,
  onHoverIntent,
  onHoverCancel,
  onOpen,
  fallbackHref,
}) {
  const priceFrom = formatBDT(item?.priceFrom);
  const priceTo = formatBDT(item?.priceTo);

  let priceText = "";
  if (priceFrom && priceTo && priceFrom !== priceTo) priceText = `${priceFrom} – ${priceTo}`;
  else if (priceFrom) priceText = priceFrom;

  return (
    <button
      type="button"
      onMouseEnter={() => onHoverIntent?.(index)}
      onMouseLeave={() => onHoverCancel?.()}
      onFocus={() => onHover?.(index)}
      onClick={() => onOpen?.(item?.href || fallbackHref)}
      style={{
        width: "100%",
        maxWidth: "100%",
        border: "none",
        textAlign: "left",
        cursor: "pointer",
        padding: "10px 10px",
        borderRadius: 16,
        display: "flex",
        alignItems: "center",
        gap: 10,
        backgroundColor: isActive ? "#f5f6fb" : "transparent",
        boxShadow: isActive ? "0 14px 28px rgba(7,11,27,.12)" : "none",
        transform: isActive ? "translateX(2px)" : "translateX(0)",
        transition: "background .12s ease, transform .12s ease, box-shadow .12s ease",
        minWidth: 0,
        outline: "none",
        touchAction: "manipulation",
      }}
    >
      <div
        style={{
          minWidth: 28,
          height: 28,
          borderRadius: 999,
          border: `1px solid ${isActive ? GOLD : "#D1D5E3"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: SYS_FONT,
          fontSize: 11,
          fontWeight: 900,
          color: isActive ? "#7a5b18" : NAVY_SOFT,
          background: isActive
            ? "radial-gradient(circle at 30% 0%, #fffdf4 0%, #f1e6c7 100%)"
            : "linear-gradient(135deg,#f8fafc,#edf1fb)",
          boxShadow: "0 10px 22px rgba(6,10,24,.10)",
          flex: "0 0 auto",
        }}
      >
        {index + 1}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontFamily: LUX_FONT,
            fontWeight: 900,
            fontSize: 13.75,
            color: NAVY,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            letterSpacing: ".01em",
            lineHeight: 1.2,
          }}
        >
          {item?.title || "Product"}
        </div>
        <div
          style={{
            fontFamily: SYS_FONT,
            fontSize: 12,
            fontWeight: 800,
            color: NAVY_SOFT,
            opacity: 0.84,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.2,
          }}
        >
          {priceText ? priceText : "View details"}
        </div>
      </div>

      <div
        style={{
          flex: "0 0 auto",
          width: 10,
          height: 10,
          borderRadius: 999,
          background: isActive ? GOLD : "rgba(15,33,71,.18)",
          boxShadow: isActive ? "0 10px 18px rgba(201,176,101,.35)" : "none",
        }}
        aria-hidden="true"
      />
    </button>
  );
}

/* ------------------ viewport-safe vh (iOS/Android) ------------------ */
function setAppVhVar() {
  if (typeof window === "undefined") return;
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--app-vh", `${vh}px`);
}

/* ------------------ portal host ------------------ */
function Portal({ children, zIndex = 2147483647 }) {
  const [host, setHost] = useState(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.dataset.homepanelHost = "tdls";
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.zIndex = String(zIndex);
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
    setHost(el);
    return () => {
      try {
        document.body.removeChild(el);
      } catch {}
    };
  }, [zIndex]);

  if (!host) return null;
  return createPortal(children, host);
}

export default function HomePanel({ open, onClose }) {
  const router = useRouter();
  const { data: session, status } = useSession();

  const panelRef = useRef(null);
  const previewRef = useRef(null);
  const bodyRef = useRef(null);
  const highlightsSectionRef = useRef(null);

  const swallowNextOutsideClickRef = useRef(false);

  const [vw, setVw] = useState(1024);
  const [vh, setVh] = useState(768);

  const [isMobile, setIsMobile] = useState(false);
  const [isCompactHeight, setIsCompactHeight] = useState(false);

  const [loadingHighlights, setLoadingHighlights] = useState(false);
  const [highlightsError, setHighlightsError] = useState(null);
  const [trendingProducts, setTrendingProducts] = useState([]);
  const [bestSellerProducts, setBestSellerProducts] = useState([]);
  const [activeTab, setActiveTab] = useState("TRENDING");
  const [hoverIndex, setHoverIndex] = useState(0);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [navH, setNavH] = useState(89);
  const [bottomH, setBottomH] = useState(86);

  // ✅ Collections flyout
  const collectionsBtnRef = useRef(null);
  const collectionsFlyRef = useRef(null);

  const openIntentRef = useRef(null);
  const closeIntentRef = useRef(null);

  // ✅ SINGLE openFlyout controller
  // null | "collections" | "highlights"
  const [openFlyout, setOpenFlyout] = useState(null);
  const openFlyoutRef = useRef(null);

  useEffect(() => {
    openFlyoutRef.current = openFlyout;
  }, [openFlyout]);

  const collectionsOpen = openFlyout === "collections";
  const highlightsPreviewOpen = openFlyout === "highlights";

  const [collectionsReady, setCollectionsReady] = useState(false);
  const [collectionsGeom, setCollectionsGeom] = useState({
    top: 140,
    left: 24,
    width: 760,
    maxHeight: 620,
    height: null,
    side: "left",
  });

  // ✅ Gesture guard (only blocks accidental scroll-drag clicks on touch/pen, NOT mouse)
  const flyGestureRef = useRef({
    active: false,
    moved: false,
    sx: 0,
    sy: 0,
    pointerType: "mouse",
  });

  // ✅ Highlights preview flyout behavior (desktop only)
  const highlightsOpenIntentRef = useRef(null);
  const highlightsCloseIntentRef = useRef(null);

  // ✅ Hover intent to avoid “hypersensitive” selection changes
  const railHoverTimerRef = useRef(null);
  const railHoverTargetRef = useRef(-1);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const apply = () => {
      setAppVhVar();
      const w = window.innerWidth || 0;
      const h = window.innerHeight || 0;

      setVw(w);
      setVh(h);

      setNavH(readCssPxVar("--nav-h", 89));
      setBottomH(readCssPxVar("--bottom-bar-h", 86));

      const mobile = w < 768 || h < 520;
      setIsMobile(mobile);
      setIsCompactHeight(h < 640);
    };

    apply();

    const onResize = () => apply();
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });

    const vv = window.visualViewport;
    if (vv?.addEventListener) {
      vv.addEventListener("resize", onResize, { passive: true });
      vv.addEventListener("scroll", onResize, { passive: true });
    }

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      if (vv?.removeEventListener) {
        vv.removeEventListener("resize", onResize);
        vv.removeEventListener("scroll", onResize);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) {
      // reset flyouts hard when panel closes (component may stay mounted)
      setOpenFlyout(null);
      setCollectionsReady(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (openIntentRef.current) window.clearTimeout(openIntentRef.current);
      if (closeIntentRef.current) window.clearTimeout(closeIntentRef.current);
      openIntentRef.current = null;
      closeIntentRef.current = null;

      if (highlightsOpenIntentRef.current) window.clearTimeout(highlightsOpenIntentRef.current);
      if (highlightsCloseIntentRef.current) window.clearTimeout(highlightsCloseIntentRef.current);
      highlightsOpenIntentRef.current = null;
      highlightsCloseIntentRef.current = null;

      if (railHoverTimerRef.current) window.clearTimeout(railHoverTimerRef.current);
      railHoverTimerRef.current = null;
      railHoverTargetRef.current = -1;
    }
  }, [open]);

  const isAuthed = status === "authenticated" && !!session?.user;
  const displayName =
    session?.user?.name || session?.user?.email || session?.user?.phone || "Signed in";

  const routes = useMemo(() => {
    const customerDashboard = "/customer/dashboard";
    const customerLogin = `/login?redirect=${encodeURIComponent(customerDashboard)}`;
    const customerForgot = "/forgot-password";
    const allProducts = "/product";
    const cart = "/cart";
    const adminLogin = "/admin/login";
    return { customerDashboard, customerLogin, customerForgot, allProducts, cart, adminLogin };
  }, []);

  const closeAllFlyouts = useCallback(() => {
    setOpenFlyout(null);
    setCollectionsReady(false);
  }, []);

  const handleNavigate = (path) => {
    closeAllFlyouts();
    onClose?.();
    setTimeout(() => router.push(path), 0);
  };

  useEffect(() => {
    try {
      router.prefetch(routes.allProducts);
      router.prefetch(routes.customerDashboard);
      router.prefetch("/login");
      router.prefetch("/login/otp");
      router.prefetch(routes.adminLogin);
      router.prefetch(routes.cart);
      router.prefetch(routes.customerForgot);
      router.prefetch("/collections");
    } catch {}
  }, [router, routes]);

  useEffect(() => {
    if (!open) return;
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    const prevBodyX = document.body.style.overflowX;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overflowX = "hidden";

    return () => {
      document.documentElement.style.overflow = prevHtml || "";
      document.body.style.overflow = prevBody || "";
      document.body.style.overflowX = prevBodyX || "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => {
      if (e.key !== "Escape") return;

      // single flyout controller: close flyout first, then panel
      if (openFlyoutRef.current === "collections") {
        setOpenFlyout(null);
        setCollectionsReady(false);
        return;
      }
      if (openFlyoutRef.current === "highlights") {
        setOpenFlyout(null);
        return;
      }
      onClose?.();
    };
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const swallow = (e) => {
      try {
        e.preventDefault?.();
        e.stopPropagation?.();
        e.stopImmediatePropagation?.();
      } catch {}
    };

    const isOutside = (t) => {
      const inPanel = panelRef.current?.contains(t);
      const inPreview = previewRef.current?.contains(t);
      const inFlyout = collectionsFlyRef.current?.contains(t);
      const inTrigger = collectionsBtnRef.current?.contains(t);
      return !inPanel && !inPreview && !inFlyout && !inTrigger;
    };

    const onDownCapture = (e) => {
      if (swallowNextOutsideClickRef.current) return;
      const t = e?.target;
      if (!t) return;
      if (!isOutside(t)) return;

      swallowNextOutsideClickRef.current = true;
      swallow(e);

      closeAllFlyouts();
      onClose?.();
    };

    const onClickCapture = (e) => {
      if (!swallowNextOutsideClickRef.current) return;
      const t = e?.target;
      if (t && isOutside(t)) swallow(e);
      swallowNextOutsideClickRef.current = false;
    };

    document.addEventListener("pointerdown", onDownCapture, true);
    document.addEventListener("click", onClickCapture, true);

    return () => {
      document.removeEventListener("pointerdown", onDownCapture, true);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [open, onClose, closeAllFlyouts]);

  useEffect(() => {
    if (!open) return;

    const el = panelRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;

    const onStart = (e) => {
      const t = e.touches?.[0];
      const clientX = t ? t.clientX : e.clientX;
      const clientY = t ? t.clientY : e.clientY;
      startX = clientX;
      startY = clientY;
      startT = Date.now();
      tracking = true;
    };

    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches?.[0];
      const clientX = t ? t.clientX : e.clientX;
      const clientY = t ? t.clientY : e.clientY;

      const dx = clientX - startX;
      const dy = clientY - startY;

      if (Math.abs(dx) < 18) return;
      if (Math.abs(dy) > Math.abs(dx) * 0.9) return;

      if (e.cancelable) e.preventDefault();

      const dt = Math.max(1, Date.now() - startT);
      const vx = dx / dt;

      if (dx < -70 || vx < -0.55) {
        tracking = false;
        closeAllFlyouts();
        onClose?.();
      }
    };

    const onEnd = () => {
      tracking = false;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [open, onClose, closeAllFlyouts]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      try {
        panelRef.current?.focus?.();
      } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const ac = new AbortController();
    const timeoutId = setTimeout(() => {
      try {
        ac.abort();
      } catch {}
    }, 6500);

    async function loadHighlights() {
      if (loadedOnce) return;

      setLoadingHighlights(true);
      setHighlightsError(null);

      try {
        let data = null;
        try {
          const res = await fetch("/api/home/highlights", {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: ac.signal,
          });

          if (res.ok) data = await res.json().catch(() => null);
        } catch {}

        if (!cancelled && data?.ok) {
          const trending = Array.isArray(data.trendingProducts) ? data.trendingProducts : [];
          const best = Array.isArray(data.bestSellerProducts) ? data.bestSellerProducts : [];

          setTrendingProducts(trending.map(normalizeHighlightItem));
          setBestSellerProducts(best.map(normalizeHighlightItem));
          setLoadedOnce(true);
          setHoverIndex(0);
          return;
        }

        const json = await fetchFromStrapi("/products?populate=*", ac.signal);
        const payload = unwrapStrapiProxy(json);
        const products = toProductArrayFromStrapiPayload(payload);

        if (cancelled) return;

        const built = buildHighlightsFromProducts(products);
        setTrendingProducts(built.trendingProducts);
        setBestSellerProducts(built.bestSellerProducts);

        setLoadedOnce(true);
        setHoverIndex(0);

        if (
          (built.trendingProducts?.length || 0) === 0 &&
          (built.bestSellerProducts?.length || 0) === 0
        ) {
          setHighlightsError("Live highlights are temporarily unavailable.");
        }
      } catch {
        if (cancelled) return;
        setHighlightsError("Live highlights are temporarily unavailable.");
        setTrendingProducts([]);
        setBestSellerProducts([]);
      } finally {
        if (!cancelled) setLoadingHighlights(false);
      }
    }

    loadHighlights().catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      try {
        ac.abort();
      } catch {}
    };
  }, [open, loadedOnce]);

  useEffect(() => {
    setHoverIndex(0);
  }, [activeTab]);

  const activeList = activeTab === "TRENDING" ? trendingProducts : bestSellerProducts;
  const safeIndex = activeList.length === 0 ? 0 : clampInt(hoverIndex, 0, activeList.length - 1);
  const previewItem = activeList.length > 0 ? activeList[safeIndex] : null;

  const layout = useMemo(() => {
    const safeTop = 8;
    const safeBottom = 10;

    const viewportPx = `calc(var(--app-vh, 1vh) * 100)`;

    const top = `calc(${navH}px + ${safeTop}px + env(safe-area-inset-top))`;
    const bottom = `calc(${bottomH}px + ${safeBottom}px + env(safe-area-inset-bottom))`;
    const maxH = `calc(${viewportPx} - ${navH}px - ${bottomH}px - ${safeTop}px - ${safeBottom}px - env(safe-area-inset-top) - env(safe-area-inset-bottom))`;

    const panelW = isMobile ? "min(100vw, 520px)" : "min(420px, calc(100vw - 24px))";
    const showPreview = !isMobile && !isCompactHeight && vw >= 980;

    return { top, bottom, maxH, panelW, showPreview };
  }, [navH, bottomH, isMobile, isCompactHeight, vw]);

  // If desktop preview is not eligible (responsive), never keep highlights flyout "open" in state.
  useEffect(() => {
    if (!layout.showPreview && openFlyoutRef.current === "highlights") {
      setOpenFlyout(null);
    }
  }, [layout.showPreview]);

  const computeCollectionsGeom = useCallback(() => {
    if (typeof window === "undefined") return null;
    const btn = collectionsBtnRef.current;
    if (!btn) return null;

    const rect = btn.getBoundingClientRect();
    const vwNow = window.innerWidth || 0;
    const vhNow = window.innerHeight || 0;

    const safe = 10;
    const gap = 14;

    const drawerRect = panelRef.current?.getBoundingClientRect?.() || null;

    if (!isMobile && drawerRect) {
      const top = Math.round(drawerRect.top);
      const height = Math.max(320, Math.round(drawerRect.height));

      const preferred = clampInt(Math.round(vwNow * 0.46), 560, 900);

      const leftSpace = Math.max(0, Math.round(drawerRect.left - safe - gap));
      const rightSpace = Math.max(0, Math.round(vwNow - safe - gap - drawerRect.right));

      let side = "left";
      let width = Math.min(preferred, leftSpace);
      let left = Math.round(drawerRect.left - width - gap);

      if (width < 440 && rightSpace >= 440) {
        side = "right";
        width = Math.min(preferred, rightSpace);
        left = Math.round(drawerRect.right + gap);
      }

      width = clampInt(width || preferred, 420, Math.max(420, vwNow - safe * 2));
      left = clampInt(left || safe, safe, Math.max(safe, vwNow - width - safe));

      return {
        top,
        left,
        width,
        height,
        maxHeight: height,
        side,
      };
    }

    const topLimit = Math.max(safe + 2, navH + 10);

    // ✅ Increased bottom clearance so mobile expanded lists are less likely to hide under bottom bar.
    const bottomLimit = Math.max(topLimit + 260, vhNow - (bottomH + 24));

    const width = Math.min(vwNow - safe * 2, 720);
    let side = "left";
    let left = Math.max(safe, Math.round((vwNow - width) / 2));

    const gapY = 10;
    const spaceBelow = bottomLimit - (rect.bottom + gapY);
    const spaceAbove = rect.top - gapY - topLimit;

    const desiredMax = clampInt(Math.round((bottomLimit - topLimit) * 0.92), 360, 780);

    let top;
    if (spaceBelow >= 320 || spaceBelow >= spaceAbove) {
      top = Math.round(rect.bottom + gapY);
      top = clampInt(top, topLimit, bottomLimit - 260);
    } else {
      top = Math.round(rect.top - gapY - Math.min(desiredMax, Math.max(320, spaceAbove)));
      top = clampInt(top, topLimit, bottomLimit - 260);
    }

    const maxHeight = clampInt(bottomLimit - top, 320, desiredMax);

    return { top, left, width, maxHeight, height: null, side };
  }, [isMobile, navH, bottomH]);

  const openCollections = useCallback(() => {
    // ✅ Auto-close any other flyout via single controller (highlights)
    try {
      window.dispatchEvent(
        new CustomEvent("tdls:homepanel:closeFlyouts", { detail: { except: "collections" } })
      );
    } catch {}

    const g = computeCollectionsGeom();
    if (g) setCollectionsGeom(g);
    setCollectionsReady(true);
    setOpenFlyout("collections");
  }, [computeCollectionsGeom]);

  const closeCollections = useCallback(() => {
    setCollectionsReady(false);
    setOpenFlyout((cur) => (cur === "collections" ? null : cur));
  }, []);

  // ✅ Global closeFlyouts listener so other UI can close ours safely
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      const except = e?.detail?.except || null;

      if (except !== "collections") {
        if (openFlyoutRef.current === "collections") {
          setCollectionsReady(false);
          setOpenFlyout(null);
        }
      }
      if (except !== "highlights") {
        if (openFlyoutRef.current === "highlights") {
          setOpenFlyout(null);
        }
      }
    };
    window.addEventListener("tdls:homepanel:closeFlyouts", handler);
    return () => window.removeEventListener("tdls:homepanel:closeFlyouts", handler);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !collectionsOpen) return;
    const g = computeCollectionsGeom();
    if (g) setCollectionsGeom(g);
  }, [open, collectionsOpen, computeCollectionsGeom]);

  useEffect(() => {
    if (!open || !collectionsOpen) return;

    let raf = 0;
    const tick = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const g = computeCollectionsGeom();
        if (g) setCollectionsGeom(g);
      });
    };

    const body = bodyRef.current;
    body?.addEventListener("scroll", tick, { passive: true });

    window.addEventListener("resize", tick, { passive: true });
    window.addEventListener("orientationchange", tick, { passive: true });

    const vv = window.visualViewport;
    if (vv?.addEventListener) {
      vv.addEventListener("resize", tick, { passive: true });
      vv.addEventListener("scroll", tick, { passive: true }); // ✅ fixed typo
    }

    return () => {
      try {
        if (raf) window.cancelAnimationFrame(raf);
      } catch {}
      body?.removeEventListener("scroll", tick);
      window.removeEventListener("resize", tick);
      window.removeEventListener("orientationchange", tick);
      if (vv?.removeEventListener) {
        vv.removeEventListener("resize", tick);
        vv.removeEventListener("scroll", tick);
      }
    };
  }, [open, collectionsOpen, computeCollectionsGeom]);

  const scheduleOpenCollections = () => {
    if (isMobile) return;
    if (closeIntentRef.current) {
      window.clearTimeout(closeIntentRef.current);
      closeIntentRef.current = null;
    }
    if (collectionsOpen) return;

    if (openIntentRef.current) window.clearTimeout(openIntentRef.current);
    openIntentRef.current = window.setTimeout(() => {
      openCollections();
      openIntentRef.current = null;
    }, 120);
  };

  // ✅ Safer close: do not close if moving into flyout/trigger; slightly longer delay.
  const scheduleCloseCollections = (e) => {
    if (isMobile) return;

    const next = e?.relatedTarget;
    const fly = collectionsFlyRef.current;
    const trig = collectionsBtnRef.current;

    if (next && (fly?.contains(next) || trig?.contains(next))) return;

    if (openIntentRef.current) {
      window.clearTimeout(openIntentRef.current);
      openIntentRef.current = null;
    }

    if (closeIntentRef.current) window.clearTimeout(closeIntentRef.current);
    closeIntentRef.current = window.setTimeout(() => {
      closeCollections();
      closeIntentRef.current = null;
    }, 420);
  };

  const cancelCloseCollections = () => {
    if (closeIntentRef.current) {
      window.clearTimeout(closeIntentRef.current);
      closeIntentRef.current = null;
    }
  };

  const toggleCollectionsClick = () => {
    if (collectionsOpen) closeCollections();
    else openCollections();
  };

  // ✅ Highlights preview open/close (desktop intent, not hypersensitive)
  const openHighlightsPreview = useCallback(() => {
    if (isMobile) return;
    if (!layout.showPreview) return;

    // If collections is open, keep it as the only overlay.
    if (collectionsOpen) return;

    // ✅ single controller: open highlights
    setOpenFlyout("highlights");
    try {
      window.dispatchEvent(
        new CustomEvent("tdls:homepanel:closeFlyouts", { detail: { except: "highlights" } })
      );
    } catch {}
  }, [isMobile, layout.showPreview, collectionsOpen]);

  const scheduleOpenHighlightsPreview = useCallback(() => {
    if (isMobile) return;
    if (!layout.showPreview) return;
    if (collectionsOpen) return;

    if (highlightsCloseIntentRef.current) {
      window.clearTimeout(highlightsCloseIntentRef.current);
      highlightsCloseIntentRef.current = null;
    }
    if (openFlyoutRef.current === "highlights") return;

    if (highlightsOpenIntentRef.current) window.clearTimeout(highlightsOpenIntentRef.current);
    highlightsOpenIntentRef.current = window.setTimeout(() => {
      openHighlightsPreview();
      highlightsOpenIntentRef.current = null;
    }, 160);
  }, [isMobile, layout.showPreview, collectionsOpen, openHighlightsPreview]);

  // ✅ Close on mouse-leave (but allow moving between section <-> preview without closing)
  const scheduleCloseHighlightsPreview = useCallback(
    (e) => {
      if (isMobile) return;
      if (!layout.showPreview) return;

      const next = e?.relatedTarget || null;
      const inPreview = next && previewRef.current?.contains(next);
      const inSection = next && highlightsSectionRef.current?.contains(next);

      if (inPreview || inSection) return;

      if (highlightsOpenIntentRef.current) {
        window.clearTimeout(highlightsOpenIntentRef.current);
        highlightsOpenIntentRef.current = null;
      }
      if (highlightsCloseIntentRef.current) window.clearTimeout(highlightsCloseIntentRef.current);
      highlightsCloseIntentRef.current = window.setTimeout(() => {
        setOpenFlyout((cur) => (cur === "highlights" ? null : cur));
        highlightsCloseIntentRef.current = null;
      }, 420);
    },
    [isMobile, layout.showPreview]
  );

  const cancelCloseHighlightsPreview = useCallback(() => {
    if (highlightsCloseIntentRef.current) {
      window.clearTimeout(highlightsCloseIntentRef.current);
      highlightsCloseIntentRef.current = null;
    }
  }, []);

  // ✅ Hover-intent for rail selection (prevents “cursor passing over items = selected”)
  const scheduleRailHoverIndex = useCallback((idx) => {
    if (typeof window === "undefined") return;
    if (railHoverTimerRef.current) window.clearTimeout(railHoverTimerRef.current);
    railHoverTargetRef.current = idx;

    railHoverTimerRef.current = window.setTimeout(() => {
      railHoverTimerRef.current = null;
      const t = railHoverTargetRef.current;
      if (t >= 0) setHoverIndex(t);
    }, 140);
  }, []);

  const cancelRailHoverIndex = useCallback(() => {
    if (typeof window === "undefined") return;
    railHoverTargetRef.current = -1;
    if (railHoverTimerRef.current) window.clearTimeout(railHoverTimerRef.current);
    railHoverTimerRef.current = null;
  }, []);

  const handleSignOut = async () => {
    try {
      closeAllFlyouts();
      onClose?.();
      await signOut({ redirect: true, callbackUrl: "/" });
    } catch {}
  };

  // ✅ Collections flyout gesture guard (do not block mouse clicks)
  const onFlyPointerDownCapture = (e) => {
    const g = flyGestureRef.current;
    g.active = true;
    g.moved = false;
    g.sx = e.clientX;
    g.sy = e.clientY;
    g.pointerType = e.pointerType || "mouse";
  };
  const onFlyPointerMoveCapture = (e) => {
    const g = flyGestureRef.current;
    if (!g.active) return;

    // only treat as “drag” for touch/pen, never for mouse
    if (g.pointerType === "mouse") return;

    if (Math.abs(e.clientX - g.sx) > 8 || Math.abs(e.clientY - g.sy) > 8) g.moved = true;
  };
  const onFlyPointerUpCapture = () => {
    const g = flyGestureRef.current;
    g.active = false;
    window.setTimeout(() => {
      g.moved = false;
    }, 0);
  };
  const onFlyClickCapture = (e) => {
    const g = flyGestureRef.current;

    // Only suppress click if it was a touch/pen drag; never suppress mouse.
    if (g.pointerType !== "mouse" && g.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  if (!open) return null;

  return (
    <Portal zIndex={2147483647}>
      <style>{`
        .tdls-homepanel-backdrop{
          position: fixed;
          inset: 0;
          pointer-events: auto;
          background: radial-gradient(1000px 680px at 70% 20%, rgba(201,176,101,.18) 0%, rgba(15,33,71,.52) 48%, rgba(5,11,31,.74) 100%);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .tdls-homepanel-stage{
          position: fixed;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }

        .tdls-homepanel-preview{
          pointer-events: auto;
          position: absolute;
          top: ${layout.top};
          bottom: ${layout.bottom};
          right: calc(${layout.panelW} + 16px);
          width: min(520px, calc(100vw - ${layout.panelW} - 40px));
          max-width: 560px;
          border-radius: 26px;
          background: linear-gradient(180deg, rgba(255,255,255,.88) 0%, rgba(255,255,255,.72) 100%);
          border: 1px solid rgba(255,255,255,.34);
          box-shadow: 0 26px 70px rgba(0,0,0,.22);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .tdls-homepanel-drawer{
          pointer-events: auto;
          position: absolute;
          top: ${layout.top};
          bottom: ${layout.bottom};
          right: max(10px, env(safe-area-inset-right));
          width: ${layout.panelW};
          max-width: calc(100vw - 20px);
          border-radius: 26px;
          background: ${SURFACE};
          border: 1px solid ${BORDER};
          box-shadow: 0 26px 70px rgba(0,0,0,.22);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transform: translateX(0);
          contain: layout paint style;
        }

        .tdls-homepanel-head{
          padding: 16px 16px 12px;
          background: linear-gradient(180deg, #ffffff 0%, #fbfbff 100%);
          border-bottom: 1px solid ${BORDER};
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .tdls-homepanel-title{
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .tdls-homepanel-title h3{
          margin: 0;
          font-family: ${LUX_FONT};
          font-weight: 900;
          color: ${NAVY};
          letter-spacing: .12em;
          text-transform: uppercase;
          font-size: 1.12rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tdls-homepanel-title p{
          margin: 0;
          font-family: ${SYS_FONT};
          color: ${NAVY_SOFT};
          font-weight: 800;
          font-size: .82rem;
          opacity: .84;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tdls-homepanel-close{
          border: 1px solid ${BORDER};
          background: #fff;
          color: ${NAVY};
          border-radius: 14px;
          height: 44px;
          width: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 10px 22px rgba(6,10,24,.10);
          transition: transform .10s ease, box-shadow .12s ease, background .12s ease;
          flex: 0 0 auto;
        }
        .tdls-homepanel-close:hover{ background: #f6f7fb; transform: translateY(-1px); }
        .tdls-homepanel-close:active{ transform: translateY(0); }

        .tdls-homepanel-body{
          padding: 14px 16px 16px;
          overflow: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          max-height: ${layout.maxH};
        }
        .tdls-homepanel-body::-webkit-scrollbar{ width: 0px; height: 0px; }

        .tdls-homepanel-section{
          margin-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .tdls-homepanel-section:first-child{ margin-top: 0; }

        .tdls-homepanel-section-title{
          font-family: ${SYS_FONT};
          font-size: 11px;
          font-weight: 900;
          letter-spacing: .18em;
          text-transform: uppercase;
          color: ${NAVY_SOFT};
          opacity: .95;
        }

        .tdls-homepanel-grid{
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }

        .tdls-homepanel-tabs{
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .tdls-homepanel-rail{
          display: flex;
          flex-direction: column;
          gap: 6px;
          border: 1px solid ${BORDER};
          border-radius: 18px;
          padding: 8px;
          background: linear-gradient(180deg, #ffffff 0%, #fbfbff 100%);
        }

        .tdls-collections-flyout{
          pointer-events: auto;
          position: fixed;
          border-radius: 22px;
          background: linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.86) 100%);
          border: 1px solid rgba(255,255,255,.34);
          box-shadow: 0 26px 70px rgba(0,0,0,.22);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          height: var(--fly-h, auto);
          max-height: var(--fly-max-h, 640px);
          z-index: 2147483647;
          transform-origin: var(--fly-origin, left top);
          animation: tdlsFlyIn .14s ease-out;
          touch-action: pan-y;
        }

        @keyframes tdlsFlyIn{
          from { opacity: .0; transform: translateY(4px) scale(.992); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .tdls-collections-flyhead{
          padding: 12px 12px 10px;
          border-bottom: 1px solid rgba(231,227,218,.85);
          background: linear-gradient(180deg, rgba(255,255,255,.94) 0%, rgba(255,255,255,.84) 100%);
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 10px;
          flex: 0 0 auto;
        }

        .tdls-collections-flytitle{
          min-width: 0;
          font-family: ${LUX_FONT};
          font-weight: 900;
          letter-spacing: .12em;
          text-transform: uppercase;
          font-size: 1.02rem;
          color: ${NAVY};
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tdls-collections-flyclose{
          height: 40px;
          width: 40px;
          border-radius: 14px;
          border: 1px solid rgba(15,33,71,.14);
          background: rgba(255,255,255,.92);
          color: ${NAVY};
          cursor: pointer;
          box-shadow: 0 12px 26px rgba(6,10,24,.12);
          transition: transform .10s ease, background .12s ease;
        }
        .tdls-collections-flyclose:hover{ transform: translateY(-1px); background: rgba(246,247,251,.95); }
        .tdls-collections-flyclose:active{ transform: translateY(0); }

        .tdls-collections-flybody{
          padding: 12px;
          overflow: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          flex: 1 1 auto;
          min-height: 0;
        }
        .tdls-collections-flybody::-webkit-scrollbar{ width: 0px; height: 0px; }

        /* ✅ Desktop: extra bottom padding so last clickable items are fully visible */
        @media (min-width: 769px){
          .tdls-collections-flybody{
            padding-bottom: 30px;
          }
        }

        /* ✅ Mobile: ensure bottom bar + safe-area never hides last options */
        @media (max-width: 768px){
          .tdls-homepanel-drawer{
            left: max(10px, env(safe-area-inset-left));
            right: max(10px, env(safe-area-inset-right));
            width: auto;
            border-radius: 22px;
          }
          .tdls-homepanel-body{
            padding: 12px 14px 14px;
          }
          .tdls-collections-flybody{
            padding-bottom: calc(26px + env(safe-area-inset-bottom));
          }
        }

        @media (prefers-reduced-motion: reduce){
          .tdls-homepanel-close{ transition: none; }
          .tdls-collections-flyclose{ transition: none; }
          .tdls-collections-flyout{ animation: none; }
        }
      `}</style>

      <div className="tdls-homepanel-backdrop" aria-hidden="true" />

      <div className="tdls-homepanel-stage" role="presentation">
        {/* ✅ Desktop Preview (flyout: opens on hover/click only; auto-closes via single controller) */}
        {layout.showPreview && highlightsPreviewOpen ? (
          <div
            ref={previewRef}
            className="tdls-homepanel-preview"
            aria-label="Preview"
            onMouseEnter={() => cancelCloseHighlightsPreview()}
            onMouseLeave={(e) => scheduleCloseHighlightsPreview(e)}
          >
            <div style={{ padding: 16, borderBottom: `1px solid rgba(255,255,255,.34)` }}>
              <div
                style={{
                  fontFamily: SYS_FONT,
                  fontWeight: 900,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: NAVY,
                  fontSize: 11.5,
                }}
              >
                {activeTab === "TRENDING" ? "Trending Preview" : "Best Sellers Preview"}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: LUX_FONT,
                  fontWeight: 900,
                  color: NAVY,
                  fontSize: 18,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {previewItem?.title || "Explore our collections"}
              </div>
            </div>

            <div style={{ position: "relative", flex: "1 1 auto", background: "rgba(15,33,71,.06)" }}>
              {previewItem?.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={absUrl(previewItem.coverImageUrl)}
                  alt={previewItem.coverImageAlt || previewItem.title || "Preview"}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                  loading="eager"
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: SYS_FONT,
                    fontWeight: 900,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: NAVY_SOFT,
                    opacity: 0.75,
                  }}
                >
                  TDLS
                </div>
              )}

              <div
                style={{
                  position: "absolute",
                  left: 12,
                  right: 12,
                  bottom: 12,
                  borderRadius: 20,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.78) 100%)",
                  border: "1px solid rgba(255,255,255,.44)",
                  boxShadow: "0 18px 44px rgba(0,0,0,.18)",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontFamily: SYS_FONT,
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: NAVY_SOFT,
                  }}
                >
                  Quick view
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: LUX_FONT,
                        fontWeight: 900,
                        fontSize: 15,
                        color: NAVY,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {previewItem?.title || "Browse products"}
                    </div>
                    <div
                      style={{
                        fontFamily: SYS_FONT,
                        fontWeight: 800,
                        fontSize: 12,
                        color: NAVY_SOFT,
                        opacity: 0.85,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      Tap any item in the list to open
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleNavigate(previewItem?.href || routes.allProducts)}
                    style={{
                      flex: "0 0 auto",
                      borderRadius: 999,
                      border: `1px solid rgba(15,33,71,.14)`,
                      background: `linear-gradient(180deg, #ffffff 0%, #f4f6fe 100%)`,
                      color: NAVY,
                      fontFamily: SYS_FONT,
                      fontWeight: 900,
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      fontSize: 11,
                      padding: "10px 14px",
                      cursor: "pointer",
                      boxShadow: "0 14px 30px rgba(6,10,24,.14)",
                      touchAction: "manipulation",
                    }}
                  >
                    Open ↗
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <aside
          ref={panelRef}
          className="tdls-homepanel-drawer"
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          aria-label="Home panel"
        >
          <div className="tdls-homepanel-head">
            <div className="tdls-homepanel-title">
              <h3>Home</h3>
              <p title={displayName}>{isAuthed ? displayName : "Guest mode"}</p>
            </div>

            <button
              type="button"
              className="tdls-homepanel-close"
              aria-label="Close home panel"
              onClick={() => {
                closeAllFlyouts();
                onClose?.();
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 18, fontWeight: 900 }}>
                ×
              </span>
            </button>
          </div>

          <div ref={bodyRef} className="tdls-homepanel-body">
            <div className="tdls-homepanel-section">
              <div className="tdls-homepanel-section-title">Quick actions</div>
              <div className="tdls-homepanel-grid">
                {isAuthed ? (
                  <PillButton
                    title="My Account"
                    subtitle="Dashboard & profile"
                    icon={<Icon name="user" />}
                    onClick={() => handleNavigate(routes.customerDashboard)}
                    variant="dark"
                  />
                ) : (
                  <PillButton
                    title="Customer Sign In"
                    subtitle="Login with OTP"
                    icon={<Icon name="user" />}
                    onClick={() => handleNavigate(routes.customerLogin)}
                    variant="dark"
                  />
                )}

                <PillButton
                  title="Collections"
                  subtitle={collectionsOpen ? "Browse categories (open)" : "Browse categories"}
                  icon={<Icon name="spark" />}
                  onClick={toggleCollectionsClick}
                  variant="glass"
                  buttonRef={collectionsBtnRef}
                  onMouseEnter={scheduleOpenCollections}
                  onMouseLeave={scheduleCloseCollections}
                  onFocus={() => scheduleOpenCollections()}
                  onBlur={(e) => scheduleCloseCollections(e)}
                  ariaHaspopup="dialog"
                  ariaExpanded={collectionsOpen}
                  ariaControls="tdls-collections-flyout"
                />

                <PillButton
                  title="Cart"
                  subtitle="Review & checkout"
                  icon={<Icon name="cart" />}
                  onClick={() => handleNavigate(routes.cart)}
                  variant="gold"
                />

                <PillButton
                  title="Admin"
                  subtitle="Only for TDLS admin"
                  icon={<Icon name="bag" />}
                  onClick={() => handleNavigate(routes.adminLogin)}
                  variant="glass"
                />

                {isAuthed ? (
                  <PillButton
                    title="Sign Out"
                    subtitle="Logout from customer"
                    icon={<Icon name="user" />}
                    onClick={handleSignOut}
                    variant="glass"
                  />
                ) : null}
              </div>
            </div>

            <div
              ref={highlightsSectionRef}
              className="tdls-homepanel-section"
              // ✅ Desktop: preview opens only when user intentionally hovers/focuses this section
              onMouseEnter={() => {
                cancelCloseHighlightsPreview();
                scheduleOpenHighlightsPreview();
              }}
              onMouseLeave={(e) => scheduleCloseHighlightsPreview(e)}
              onFocusCapture={() => {
                cancelCloseHighlightsPreview();
                scheduleOpenHighlightsPreview();
              }}
              onBlurCapture={(e) => scheduleCloseHighlightsPreview(e)}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <div className="tdls-homepanel-section-title">Highlights</div>

                <div className="tdls-homepanel-tabs" role="tablist" aria-label="Highlights tabs">
                  <TabButton
                    id="TRENDING"
                    label="Trending"
                    labelSub={trendingProducts.length ? `${trendingProducts.length}` : ""}
                    active={activeTab === "TRENDING"}
                    onSelect={(id) => {
                      setActiveTab(id);
                      // ✅ Click intent: open preview on desktop
                      openHighlightsPreview();
                    }}
                  />
                  <TabButton
                    id="BEST"
                    label="Best Sellers"
                    labelSub={bestSellerProducts.length ? `${bestSellerProducts.length}` : ""}
                    active={activeTab === "BEST"}
                    onSelect={(id) => {
                      setActiveTab(id);
                      // ✅ Click intent: open preview on desktop
                      openHighlightsPreview();
                    }}
                  />
                </div>
              </div>

              {loadingHighlights ? (
                <div
                  style={{
                    border: `1px dashed ${BORDER}`,
                    borderRadius: 18,
                    padding: 16,
                    background: "linear-gradient(180deg,#ffffff 0%, #fbfbff 100%)",
                    color: NAVY_SOFT,
                    fontFamily: SYS_FONT,
                    fontWeight: 900,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    fontSize: 11,
                  }}
                >
                  Loading highlights…
                </div>
              ) : highlightsError ? (
                <div
                  style={{
                    border: `1px dashed ${BORDER}`,
                    borderRadius: 18,
                    padding: 16,
                    background: "linear-gradient(180deg,#ffffff 0%, #fbfbff 100%)",
                    color: NAVY_SOFT,
                    fontFamily: SYS_FONT,
                    fontWeight: 800,
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}
                >
                  {highlightsError}
                </div>
              ) : activeList.length > 0 ? (
                <div
                  className="tdls-homepanel-rail"
                  role="list"
                  onMouseEnter={() => {
                    cancelCloseHighlightsPreview();
                    scheduleOpenHighlightsPreview();
                  }}
                  onMouseLeave={(e) => scheduleCloseHighlightsPreview(e)}
                >
                  {activeList.map((it, idx) => (
                    <div key={it.slug || it.id || idx} role="listitem">
                      <RailItem
                        item={it}
                        index={idx}
                        isActive={idx === safeIndex}
                        onHover={setHoverIndex}
                        onHoverIntent={scheduleRailHoverIndex}
                        onHoverCancel={cancelRailHoverIndex}
                        onOpen={handleNavigate}
                        fallbackHref={routes.allProducts}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    border: `1px dashed ${BORDER}`,
                    borderRadius: 18,
                    padding: 16,
                    background: "linear-gradient(180deg,#ffffff 0%, #fbfbff 100%)",
                    color: NAVY_SOFT,
                    fontFamily: SYS_FONT,
                    fontWeight: 800,
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}
                >
                  No highlights yet.
                </div>
              )}

              {!layout.showPreview && previewItem ? (
                <div
                  style={{
                    marginTop: 10,
                    borderRadius: 18,
                    border: `1px solid ${BORDER}`,
                    background: "linear-gradient(180deg,#ffffff 0%, #fbfbff 100%)",
                    overflow: "hidden",
                    boxShadow: "0 16px 40px rgba(6,10,24,.10)",
                  }}
                >
                  <div style={{ display: "flex", gap: 12, padding: 12, alignItems: "center", minWidth: 0 }}>
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 14,
                        background: "rgba(15,33,71,.08)",
                        border: "1px solid rgba(15,33,71,.10)",
                        overflow: "hidden",
                        flex: "0 0 auto",
                        position: "relative",
                      }}
                    >
                      {previewItem.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={absUrl(previewItem.coverImageUrl)}
                          alt={previewItem.coverImageAlt || previewItem.title || "Preview"}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          loading="lazy"
                        />
                      ) : null}
                    </div>

                    <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                      <div
                        style={{
                          fontFamily: LUX_FONT,
                          fontWeight: 900,
                          color: NAVY,
                          fontSize: 14.5,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {previewItem.title}
                      </div>
                      <div
                        style={{
                          marginTop: 3,
                          fontFamily: SYS_FONT,
                          fontWeight: 800,
                          fontSize: 12,
                          color: NAVY_SOFT,
                          opacity: 0.85,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        Tap to open
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleNavigate(previewItem.href || routes.allProducts)}
                      style={{
                        flex: "0 0 auto",
                        borderRadius: 999,
                        border: `1px solid rgba(15,33,71,.14)`,
                        background: `linear-gradient(180deg, #ffffff 0%, #f4f6fe 100%)`,
                        color: NAVY,
                        fontFamily: SYS_FONT,
                        fontWeight: 900,
                        letterSpacing: ".14em",
                        textTransform: "uppercase",
                        fontSize: 11,
                        padding: "10px 12px",
                        cursor: "pointer",
                        touchAction: "manipulation",
                      }}
                    >
                      Open
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div
              style={{
                marginTop: 14,
                textAlign: "center",
                color: NAVY_SOFT,
                opacity: 0.7,
                fontFamily: SYS_FONT,
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              Swipe left to close. Tap outside to dismiss.
            </div>
          </div>
        </aside>

        {collectionsOpen && collectionsReady ? (
          <div
            ref={collectionsFlyRef}
            id="tdls-collections-flyout"
            className="tdls-collections-flyout"
            role="dialog"
            aria-label="Collections flyout"
            style={{
              top: collectionsGeom.top,
              left: collectionsGeom.left,
              width: collectionsGeom.width,
              ["--fly-h"]: collectionsGeom.height ? `${collectionsGeom.height}px` : undefined,
              ["--fly-max-h"]: `${collectionsGeom.maxHeight}px`,
              ["--fly-origin"]: collectionsGeom.side === "right" ? "left top" : "right top",
            }}
            onMouseEnter={() => cancelCloseCollections()}
            onMouseLeave={(e) => scheduleCloseCollections(e)}
            onPointerDownCapture={onFlyPointerDownCapture}
            onPointerMoveCapture={onFlyPointerMoveCapture}
            onPointerUpCapture={onFlyPointerUpCapture}
            onClickCapture={onFlyClickCapture}
          >
            <div className="tdls-collections-flyhead">
              <div className="tdls-collections-flytitle">Collections</div>

              <button
                type="button"
                className="tdls-collections-flyclose"
                aria-label="Close collections flyout"
                onClick={() => closeCollections()}
              >
                <span aria-hidden="true" style={{ fontSize: 18, fontWeight: 900 }}>
                  ×
                </span>
              </button>
            </div>

            <div className="tdls-collections-flybody">
              {/* ✅ Desktop click navigation fix:
                  - Mouse clicks are no longer suppressed by the gesture guard.
                  - Additionally, if any plain <a href="/..."> exists inside, we safely route it. */}
              <div
                onClick={(e) => {
                  // respect modified clicks / already-handled clicks
                  if (
                    e.defaultPrevented ||
                    e.button !== 0 ||
                    e.metaKey ||
                    e.ctrlKey ||
                    e.shiftKey ||
                    e.altKey
                  )
                    return;

                  const a = e.target?.closest?.("a[href]");
                  if (!a) return;

                  const href = String(a.getAttribute("href") || "");
                  if (!href || !href.startsWith("/")) return;

                  e.preventDefault();
                  handleNavigate(href);
                }}
              >
                <HomePanelAllProducts
                  onAfterNavigate={() => {
                    closeAllFlyouts();
                    onClose?.();
                  }}
                  /* ✅ safe hints for selection/nav behavior inside the flyout */
                  isMobile={isMobile}
                  interactionMode={isMobile ? "tap" : "hover"}
                  hoverIntentMs={160}
                  onRequestNavigate={handleNavigate}
                />
              </div>

              {/* ✅ Bottom spacer: ensures the last clickable options are visible comfortably */}
              <div aria-hidden="true" style={{ height: isMobile ? 18 : 14 }} />
            </div>
          </div>
        ) : null}
      </div>
    </Portal>
  );
}
