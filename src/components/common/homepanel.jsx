// PATH: my-project/src/components/common/homepanel.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

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
  return v.toLocaleString("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 0,
  });
}

function absUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.STRAPI_API_URL ||
    "";
  return base
    ? `${base.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`
    : url;
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

  // Try many common shapes (custom API + Strapi media)
  const candidates = [
    // Common direct props
    a.coverImageUrl,
    item?.coverImageUrl,
    a.imageUrl,
    item?.imageUrl,
    a.thumbnailUrl,
    item?.thumbnailUrl,

    // Additional common keys seen in APIs
    a.coverImage?.url,
    item?.coverImage?.url,
    a.coverImage?.data?.attributes?.url,
    item?.coverImage?.data?.attributes?.url,

    a.thumb?.url,
    item?.thumb?.url,
    a.thumbnail?.url,
    item?.thumbnail?.url,

    // Strapi single media:
    a.cover?.data?.attributes?.url,
    a.image?.data?.attributes?.url,
    a.thumbnail?.data?.attributes?.url,
    a.heroImage?.data?.attributes?.url,

    // Strapi repeatable media:
    a.images?.data?.[0]?.attributes?.url,
    a.gallery?.data?.[0]?.attributes?.url,
    a.media?.data?.[0]?.attributes?.url,

    // Non-Strapi arrays:
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
    "TDLC piece"
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
    "TDLC product"
  );
}

function safeHref(item) {
  // ✅ Your “All Products” page is /product
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
  // Preserve original fields but ensure we always have the keys HomePanel needs
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
  const candidates = [
    a.totalSold,
    a.total_sold,
    a.sold,
    a.soldCount,
    a.salesCount,
    a.orderCount,
  ];
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
      // keep optional fields if present
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
        <path
          d="M20 21a8 8 0 0 0-16 0"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
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
        <path
          d="M7 9V7a5 5 0 0 1 10 0v2"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M6 9h12l-1 12H7L6 9Z"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (name === "cart") {
    return (
      <svg {...common}>
        <path
          d="M6 6h15l-2 9H7L6 6Z"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M6 6 5 3H2"
          stroke={NAVY}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
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
}) {
  const bg =
    variant === "gold"
      ? "linear-gradient(135deg,#FFF7D6 0%, #F6D77B 40%, #C9B065 100%)"
      : variant === "glass"
      ? "linear-gradient(135deg, rgba(255,255,255,.85) 0%, rgba(255,255,255,.65) 100%)"
      : "linear-gradient(180deg,#1b2d64 0%,#0f2147 100%)";

  const color = variant === "dark" ? "#FFFFFF" : NAVY;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group w-full text-left"
      style={{
        borderRadius: 999,
        border: `1px solid ${variant === "dark" ? "rgba(255,255,255,.10)" : BORDER}`,
        background: bg,
        color,
        padding: "12px 14px",
        boxShadow:
          variant === "dark"
            ? "0 18px 44px rgba(15,33,71,.34)"
            : "0 16px 40px rgba(6,10,24,.12)",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "transform .12s ease, box-shadow .12s ease, filter .12s ease",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.filter = "saturate(1.05)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.filter = "none";
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex items-center justify-center"
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background:
              variant === "dark"
                ? "linear-gradient(135deg, rgba(255,255,255,.18) 0%, rgba(255,255,255,.06) 100%)"
                : "linear-gradient(135deg,#ffffff 0%, #f3f4f6 100%)",
            border:
              variant === "dark"
                ? "1px solid rgba(255,255,255,.12)"
                : `1px solid ${BORDER}`,
            boxShadow: "0 12px 28px rgba(6,10,24,.12)",
          }}
        >
          <span className="opacity-95">{icon}</span>
        </span>

        <div className="min-w-0 flex-1">
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
          }}
        >
          ↗
        </span>
      </div>
    </button>
  );
}

export default function HomePanel({ open, onClose }) {
  const router = useRouter();
  const { data: session, status } = useSession();

  const panelRef = useRef(null);
  const previewRef = useRef(null);

  // ✅ prevent “close then immediately re-open” when clicking Home button again
  const swallowNextOutsideClickRef = useRef(false);

  const [isMobile, setIsMobile] = useState(false);

  const [loadingHighlights, setLoadingHighlights] = useState(false);
  const [highlightsError, setHighlightsError] = useState(null);
  const [trendingProducts, setTrendingProducts] = useState([]);
  const [bestSellerProducts, setBestSellerProducts] = useState([]);
  const [activeTab, setActiveTab] = useState("TRENDING");
  const [hoverIndex, setHoverIndex] = useState(0);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Read navbar height from CSS var set in Navbar (do NOT hardcode)
  const [navH, setNavH] = useState(89);
  const [bottomH, setBottomH] = useState(86);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      setNavH(readCssPxVar("--nav-h", 89));
      setBottomH(readCssPxVar("--bottom-bar-h", 86));
      setIsMobile(window.innerWidth < 768);
    };
    apply();
    window.addEventListener("resize", apply, { passive: true });
    return () => window.removeEventListener("resize", apply);
  }, []);

  const isAuthed = status === "authenticated" && !!session?.user;
  const displayName =
    session?.user?.name ||
    session?.user?.email ||
    session?.user?.phone ||
    "Signed in";

  const routes = useMemo(() => {
    const customerDashboard = "/customer/dashboard";
    const customerLogin = `/login?redirect=${encodeURIComponent(customerDashboard)}`;
    const customerForgot = "/forgot-password";
    const allProducts = "/product";
    const cart = "/cart";
    const adminLogin = "/admin/login";
    return {
      customerDashboard,
      customerLogin,
      customerForgot,
      allProducts,
      cart,
      adminLogin,
    };
  }, []);

  const handleNavigate = (path) => {
    onClose?.();
    setTimeout(() => router.push(path), 0);
  };

  // Prefetch (fast UX)
  useEffect(() => {
    try {
      router.prefetch(routes.allProducts);
      router.prefetch(routes.customerDashboard);
      router.prefetch("/login");
      router.prefetch("/login/otp");
      router.prefetch(routes.adminLogin);
      router.prefetch(routes.cart);
      router.prefetch(routes.customerForgot);
    } catch {}
  }, [router, routes]);

  // Scroll lock while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [open, onClose]);

  /**
   * ✅ close when clicking outside panel AND outside flyout,
   * ✅ swallow next click so Home button second click closes (no instant re-open).
   */
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
      return !inPanel && !inPreview;
    };

    const onDownCapture = (e) => {
      const t = e?.target;
      if (!t) return;
      if (!isOutside(t)) return;

      swallowNextOutsideClickRef.current = true;
      swallow(e);
      onClose?.();
    };

    const onClickCapture = (e) => {
      if (!swallowNextOutsideClickRef.current) return;

      const t = e?.target;
      if (t && isOutside(t)) swallow(e);
      swallowNextOutsideClickRef.current = false;
    };

    document.addEventListener("pointerdown", onDownCapture, true);
    document.addEventListener("mousedown", onDownCapture, true);
    document.addEventListener("touchstart", onDownCapture, true);
    document.addEventListener("click", onClickCapture, true);

    return () => {
      document.removeEventListener("pointerdown", onDownCapture, true);
      document.removeEventListener("mousedown", onDownCapture, true);
      document.removeEventListener("touchstart", onDownCapture, true);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [open, onClose]);

  // Load highlights once per open session (NO THROW; fallback to Strapi if /api/home/highlights fails)
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
        // 1) Primary: your custom endpoint (may 500)
        let data = null;
        try {
          const res = await fetch("/api/home/highlights", {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
            signal: ac.signal,
          });

          if (res.ok) {
            data = await res.json().catch(() => null);
          }
        } catch {
          // ignore primary failures; fallback below
        }

        if (!cancelled && data?.ok) {
          const trending = Array.isArray(data.trendingProducts) ? data.trendingProducts : [];
          const best = Array.isArray(data.bestSellerProducts) ? data.bestSellerProducts : [];

          setTrendingProducts(trending.map(normalizeHighlightItem));
          setBestSellerProducts(best.map(normalizeHighlightItem));
          setLoadedOnce(true);
          setHoverIndex(0);
          return;
        }

        // 2) Fallback: Strapi products via your existing proxy (shows REAL product images)
        const json = await fetchFromStrapi("/products?populate=*", ac.signal);
        const payload = unwrapStrapiProxy(json);
        const products = toProductArrayFromStrapiPayload(payload);

        if (cancelled) return;

        const built = buildHighlightsFromProducts(products);
        setTrendingProducts(built.trendingProducts);
        setBestSellerProducts(built.bestSellerProducts);

        setLoadedOnce(true);
        setHoverIndex(0);

        // If primary failed, show a soft note only if fallback also empty
        if ((built.trendingProducts?.length || 0) === 0 && (built.bestSellerProducts?.length || 0) === 0) {
          setHighlightsError("Live highlights are temporarily unavailable.");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load highlights", err);
        setHighlightsError("Live highlights are temporarily unavailable.");
        setTrendingProducts([]);
        setBestSellerProducts([]);
      } finally {
        if (!cancelled) setLoadingHighlights(false);
      }
    }

    // Ensure no unhandled promise
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
  const safeIndex =
    activeList.length === 0 ? 0 : clampInt(hoverIndex, 0, activeList.length - 1);
  const previewItem = activeList.length > 0 ? activeList[safeIndex] : null;

  function TabButton({ id, label, labelSub }) {
    const isActive = activeTab === id;
    return (
      <button
        type="button"
        onClick={() => setActiveTab(id)}
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
          transition:
            "background .16s ease, color .16s ease, box-shadow .16s ease, transform .12s ease",
        }}
        onMouseOver={(e) => {
          if (!isActive) e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseOut={(e) => {
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

  function RailItem({ item, index }) {
    const priceFrom = formatBDT(item.priceFrom);
    const priceTo = formatBDT(item.priceTo);

    let priceText = "";
    if (priceFrom && priceTo && priceFrom !== priceTo) priceText = `${priceFrom} – ${priceTo}`;
    else if (priceFrom) priceText = priceFrom;

    const isActive = index === safeIndex;

    return (
      <button
        type="button"
        onMouseEnter={() => setHoverIndex(index)}
        onFocus={() => setHoverIndex(index)}
        onClick={() => handleNavigate(item.href || routes.allProducts)}
        style={{
          width: "100%",
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
            }}
          >
            {item.title || "TDLC piece"}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 6,
            }}
          >
            <span
              style={{
                fontFamily: SYS_FONT,
                fontSize: 11,
                color: "#6B7280",
                fontWeight: 800,
              }}
            >
              {item.totalSold != null
                ? `${n(item.totalSold).toLocaleString("en-BD")} pcs sold`
                : "Early orders in progress"}
            </span>

            <span
              style={{
                fontFamily: SYS_FONT,
                fontSize: 11,
                color: "#4B5563",
                fontWeight: 900,
              }}
            >
              {priceText || "Price at checkout"}
            </span>
          </div>
        </div>
      </button>
    );
  }

  function PreviewCard() {
    if (!previewItem && !loadingHighlights && !highlightsError) {
      return (
        <div
          style={{
            borderRadius: 22,
            border: `1px dashed ${BORDER}`,
            padding: "18px 16px",
            fontFamily: SYS_FONT,
            fontSize: 12.5,
            color: "#4B5563",
            background: "linear-gradient(135deg,#f9fafb 0%,#f3f4f6 100%)",
          }}
        >
          Highlights will appear here as your order history grows.
        </div>
      );
    }

    if (!previewItem) return null;

    const priceFrom = formatBDT(previewItem.priceFrom);
    const priceTo = formatBDT(previewItem.priceTo);

    let priceText;
    if (priceFrom && priceTo && priceFrom !== priceTo) priceText = `${priceFrom} – ${priceTo}`;
    else if (priceFrom) priceText = priceFrom;
    else priceText = "Price at checkout";

    const imgUrl = absUrl(previewItem.coverImageUrl);

    return (
      <div className="hp-preview">
        <div
          style={{
            borderRadius: 24,
            overflow: "hidden",
            position: "relative",
            height: isMobile ? 230 : 270,
            boxShadow:
              "0 22px 52px rgba(7,11,27,.45), 0 0 0 1px rgba(225,228,240,.75)",
            background:
              "radial-gradient(circle at 30% 0%, #f2f6ff 0%, #e1e6f7 40%, #f4f5fb 100%)",
          }}
        >
          {imgUrl ? (
            <img
              src={imgUrl}
              alt={previewItem.coverImageAlt || previewItem.title || "TDLC product"}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                transform: "scale(1.03)",
              }}
              loading="eager"
              decoding="async"
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: SYS_FONT,
                fontSize: 12,
                letterSpacing: ".28em",
                textTransform: "uppercase",
                color: "#6B7280",
              }}
            >
              TDLC
            </div>
          )}

          <div
            style={{
              position: "absolute",
              inset: "54% 0 0 0",
              background:
                "linear-gradient(180deg, rgba(6,10,24,.0) 0%, rgba(6,10,24,.74) 55%, rgba(6,10,24,.98) 100%)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              padding: "14px 16px 14px",
              color: "#F9FAFB",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: LUX_FONT,
                    fontSize: 17,
                    fontWeight: 900,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {previewItem.title || "TDLC piece"}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: SYS_FONT,
                    fontSize: 11.5,
                    color: "#E5E7EB",
                    fontWeight: 800,
                  }}
                >
                  {activeTab === "TRENDING"
                    ? "Trending in the last 3 months"
                    : "All-time favourite"}
                </div>
              </div>

              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(249,250,251,.55)",
                  background:
                    "linear-gradient(135deg, rgba(249,250,251,.22) 0%, rgba(249,250,251,.06) 100%)",
                  fontFamily: SYS_FONT,
                  fontSize: 10,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: ".14em",
                }}
              >
                #{safeIndex + 1}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <div
                  style={{
                    fontFamily: SYS_FONT,
                    fontSize: 13,
                    fontWeight: 900,
                    letterSpacing: ".02em",
                  }}
                >
                  {priceText}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: SYS_FONT,
                    fontSize: 11,
                    color: "#D1D5DB",
                    fontWeight: 800,
                  }}
                >
                  {previewItem.totalSold != null
                    ? `${n(previewItem.totalSold).toLocaleString("en-BD")} pcs sold`
                    : "First units shipping out"}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleNavigate(previewItem.href || routes.allProducts)}
                style={{
                  borderRadius: 999,
                  border: "none",
                  padding: "9px 16px",
                  fontFamily: SYS_FONT,
                  fontSize: 11.5,
                  fontWeight: 900,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  background: "linear-gradient(135deg,#fefce8,#facc15)",
                  color: "#111827",
                  cursor: "pointer",
                  boxShadow:
                    "0 16px 40px rgba(6,10,24,.62), 0 0 0 1px rgba(248,250,252,.45)",
                }}
              >
                View piece
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!open) return null;

  const top = navH;
  const bottom = bottomH;
  const panelHeight = `calc(100vh - ${top + bottom}px)`;

  const panelWidthDesktop = 372;
  const panelLeftDesktop = 20;
  const previewGap = 18;
  const previewLeft = panelLeftDesktop + panelWidthDesktop + previewGap;

  return (
    <div
      className="fixed inset-x-0 z-[120] flex items-start"
      style={{ top, bottom }}
      role="dialog"
      aria-modal="true"
      aria-label="TDLC Home panel"
    >
      {/* Scrim */}
      <button
        type="button"
        aria-label="Close home panel overlay"
        onClick={onClose}
        className="absolute inset-0 w-full h-full bg-slate-950/55 backdrop-blur-sm"
        style={{ top: 0, bottom: 0 }}
      />

      {/* Left rail */}
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top,
          left: isMobile ? 0 : panelLeftDesktop,
          width: isMobile ? "100vw" : panelWidthDesktop,
          height: panelHeight,
          background:
            "linear-gradient(170deg, rgba(255,255,255,.98) 0%, #f9fafc 55%, #fdfdfd 100%)",
          zIndex: 10000,
          boxShadow: "0 26px 72px rgba(6,10,24,.38), inset 0 1px 0 rgba(255,255,255,.6)",
          borderTopRightRadius: isMobile ? 0 : 22,
          borderBottomRightRadius: isMobile ? 0 : 22,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          padding: isMobile ? "16px 14px 14px" : "16px 18px 16px",
          maxWidth: "100vw",
          overflow: "hidden",
          borderRight: `1px solid ${BORDER}`,
          backdropFilter: "blur(7px)",
        }}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={() => onClose?.()}
          aria-label="Close home panel"
          style={{
            position: "absolute",
            top: 10,
            right: 14,
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 999,
            color: NAVY,
            cursor: "pointer",
            padding: "6px 7px",
            boxShadow: "0 10px 22px rgba(6,10,24,.18)",
          }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" stroke={NAVY} strokeWidth="1.8" fill="none">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="6" y1="18" x2="18" y2="6" />
          </svg>
        </button>

        {/* Header */}
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "2px 2px 12px",
            borderBottom: `1px dashed ${BORDER}`,
            marginBottom: 12,
            position: "relative",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -22,
              left: -16,
              width: 240,
              height: 240,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(201,176,101,.18) 0%, rgba(201,176,101,0) 70%)",
              opacity: 0.95,
              pointerEvents: "none",
              zIndex: -1,
            }}
          />

          <div>
            <span
              style={{
                display: "block",
                fontFamily: LUX_FONT,
                fontWeight: 900,
                fontSize: isMobile ? "1.25rem" : "1.55rem",
                color: NAVY,
                letterSpacing: ".03em",
              }}
            >
              TDLC Hub
            </span>
            <span
              style={{
                display: "block",
                marginTop: 2,
                fontFamily: SYS_FONT,
                fontSize: 12,
                color: "#6B7280",
                fontWeight: 800,
              }}
            >
              Customer sign-in + quick actions + live highlights.
            </span>
          </div>

          {/* Customer Sign-in / Account card */}
          <div
            className="rounded-2xl border"
            style={{
              borderColor: BORDER,
              background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
              padding: "10px 10px",
              boxShadow: "0 14px 34px rgba(6,10,24,.08)",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div
                  style={{
                    fontFamily: SYS_FONT,
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: ".18em",
                    textTransform: "uppercase",
                    color: "#6B7280",
                  }}
                >
                  Customer Account
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontFamily: SYS_FONT,
                    fontSize: 13,
                    fontWeight: 900,
                    color: NAVY,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {isAuthed ? displayName : "Not signed in"}
                </div>
              </div>

              {isAuthed ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleNavigate(routes.customerDashboard)}
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${BORDER}`,
                      padding: "8px 12px",
                      background: "#ffffff",
                      fontFamily: SYS_FONT,
                      fontSize: 11.5,
                      fontWeight: 900,
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: NAVY,
                      boxShadow: "0 12px 28px rgba(6,10,24,.10)",
                      cursor: "pointer",
                    }}
                  >
                    Dashboard
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      setTimeout(() => signOut({ callbackUrl: "/" }), 0);
                    }}
                    style={{
                      borderRadius: 999,
                      border: "none",
                      padding: "8px 12px",
                      background: "linear-gradient(135deg,#111827 0%, #0f2147 100%)",
                      fontFamily: SYS_FONT,
                      fontSize: 11.5,
                      fontWeight: 900,
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: "white",
                      boxShadow: "0 14px 34px rgba(15,33,71,.22)",
                      cursor: "pointer",
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleNavigate(routes.customerLogin)}
                  style={{
                    borderRadius: 999,
                    border: "none",
                    padding: "9px 14px",
                    background: "linear-gradient(180deg,#1b2d64 0%,#0f2147 100%)",
                    fontFamily: SYS_FONT,
                    fontSize: 11.5,
                    fontWeight: 900,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: "white",
                    boxShadow: "0 14px 34px rgba(15,33,71,.22)",
                    cursor: "pointer",
                  }}
                >
                  Customer sign in
                </button>
              )}
            </div>

            {!isAuthed ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleNavigate(routes.customerForgot)}
                  style={{
                    fontFamily: SYS_FONT,
                    fontSize: 12,
                    fontWeight: 900,
                    color: NAVY_SOFT,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                    textUnderlineOffset: 4,
                    opacity: 0.85,
                  }}
                >
                  Forgot password?
                </button>

                <span style={{ color: "#CBD5E1" }}>•</span>

                <button
                  type="button"
                  onClick={() => handleNavigate(routes.adminLogin)}
                  style={{
                    fontFamily: SYS_FONT,
                    fontSize: 12,
                    fontWeight: 900,
                    color: NAVY_SOFT,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                    textUnderlineOffset: 4,
                    opacity: 0.85,
                  }}
                >
                  Staff / Admin login
                </button>
              </div>
            ) : null}
          </div>

          {/* Premium quick actions */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <PillButton
              title="Shop all products"
              subtitle="Browse the full TDLC collection"
              icon={<Icon name="bag" />}
              variant="gold"
              onClick={() => handleNavigate(routes.allProducts)}
            />

            <PillButton
              title="Cart"
              subtitle="View items"
              icon={<Icon name="cart" />}
              variant="glass"
              onClick={() => handleNavigate(routes.cart)}
            />
          </div>

          {/* Tabs */}
          <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <TabButton id="TRENDING" label="TRENDING" labelSub="Last 3 months" />
            <TabButton id="BEST" label="ALL-TIME" labelSub="Best sellers" />
          </div>
        </div>

        {/* Rail list */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: 1,
            overflowY: "auto",
            paddingRight: 2,
            paddingBottom: 10,
          }}
        >
          {loadingHighlights && (
            <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    height: 54,
                    borderRadius: 16,
                    background: "linear-gradient(90deg,#f3f4f6 0%, #e5e7eb 40%, #f3f4f6 100%)",
                    backgroundSize: "200% 100%",
                    animation: "tdlc-shimmer 1.2s ease-in-out infinite",
                  }}
                />
              ))}
            </div>
          )}

          {!loadingHighlights && highlightsError && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 16,
                border: `1px solid ${BORDER}`,
                background: "linear-gradient(135deg,#FFF7ED 0%,#FFFDF8 40%,#FFFFFF 100%)",
                fontFamily: SYS_FONT,
                fontSize: 12.5,
                color: "#92400E",
                fontWeight: 800,
              }}
            >
              {highlightsError}
            </div>
          )}

          {!loadingHighlights && !highlightsError && activeList.length === 0 && (
            <div
              style={{
                padding: "12px 12px",
                borderRadius: 16,
                border: `1px dashed ${BORDER}`,
                background: "#F9FAFB",
                fontFamily: SYS_FONT,
                fontSize: 12.5,
                color: "#4B5563",
                fontWeight: 800,
              }}
            >
              No highlights yet. This populates automatically from completed orders.
            </div>
          )}

          {!loadingHighlights &&
            !highlightsError &&
            activeList.length > 0 &&
            activeList.slice(0, 12).map((item, idx) => (
              <RailItem key={item.id || item.slug || `${activeTab}-${idx}`} item={item} index={idx} />
            ))}
        </div>

        {/* Mobile inline preview */}
        {isMobile ? (
          <div style={{ marginTop: 12 }}>
            <PreviewCard />
          </div>
        ) : null}

        <style jsx>{`
          @keyframes tdlc-shimmer {
            0% {
              background-position: 200% 0;
            }
            100% {
              background-position: -200% 0;
            }
          }
          .hp-preview {
            animation: hpSlideIn 0.18s ease-out;
          }
          @keyframes hpSlideIn {
            0% {
              opacity: 0;
              transform: translateX(8px) scale(0.98);
            }
            100% {
              opacity: 1;
              transform: translateX(0) scale(1);
            }
          }
        `}</style>
      </div>

      {/* Desktop preview flyout */}
      {!isMobile ? (
        <div
          ref={previewRef}
          style={{
            position: "fixed",
            top: top + 8,
            bottom: bottom + 8,
            left: previewLeft,
            right: 24,
            zIndex: 10001,
            display: "flex",
            alignItems: "flex-start",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ flex: 1, maxWidth: 560, minWidth: 340, display: "flex", flexDirection: "column" }}>
            <PreviewCard />
          </div>
        </div>
      ) : null}
    </div>
  );
}
