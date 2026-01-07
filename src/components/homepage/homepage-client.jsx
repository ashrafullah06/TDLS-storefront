//my-project/src/components/homepage/homepage-client.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import { Swiper, SwiperSlide } from "swiper/react";
import { Navigation, Pagination, Autoplay, EffectFade } from "swiper/modules";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/effect-fade";

// Safe relative import to avoid alias issues for data fetch
import { fetchHomepage } from "../../lib/fetchhomepage";

import Navbar from "@/components/common/navbar";
import Whatsappchatbutton from "@/components/common/whatsappchatbutton";
import ThemeToggle from "@/components/common/themetoggle";
import Footer from "@/components/common/footer";
import ComplianceAnnouncement from "@/components/common/complianceannouncement";
import BottomFloatingBarShell from "@/components/common/bottomfloatingbar.shell";

/* ========================= Helpers ========================= */
const API_BASE =
  process.env.NEXT_PUBLIC_STRAPI_API_URL?.replace(/\/$/, "") ||
  "http://localhost:1337";

function absolutize(url) {
  if (!url) return null;
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
}

/** Accepts: string | {url} | {formats.*.url} | {data:{attributes}} | arrays */
function getMediaUrl(value) {
  if (!value) return null;
  if (typeof value === "string") return absolutize(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const u = getMediaUrl(v);
      if (u) return u;
    }
    return null;
  }
  if (value?.data) return getMediaUrl(value.data);
  if (Array.isArray(value?.data)) return getMediaUrl(value.data[0]);
  if (value?.attributes) return getMediaUrl(value.attributes);
  if (value?.url) return absolutize(value.url);
  const f = value?.formats;
  if (f) {
    const order = ["large", "medium", "small", "thumbnail"];
    for (const k of order) {
      if (f[k]?.url) return absolutize(f[k].url);
    }
  }
  return null;
}

function fromAttrs(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined) return obj[key];
  if (obj.attributes && obj.attributes[key] !== undefined) return obj.attributes[key];
  return undefined;
}

function imgUrlOf(slide) {
  if (!slide) return null;
  const a = slide.attributes || slide;
  const candidates = [
    fromAttrs(slide, "background_image"),
    fromAttrs(slide, "image"),
    fromAttrs(slide, "media"),
    fromAttrs(slide, "cover"),
    fromAttrs(slide, "asset"),
    fromAttrs(slide, "file"),
    fromAttrs(slide, "poster"),
    fromAttrs(slide, "photo"),
    fromAttrs(slide, "picture"),
  ];
  for (const c of candidates) {
    const u = getMediaUrl(c);
    if (u) return u;
  }
  for (const k of Object.keys(a)) {
    const u = getMediaUrl(a[k]);
    if (u) return u;
  }
  return null;
}

function pickImageNode(slide) {
  if (!slide) return null;
  const a = slide.attributes || slide;
  const keys = ["background_image", "image", "media", "cover", "asset", "file", "poster", "photo", "picture"];
  for (const k of keys) {
    const v = a?.[k] || slide?.[k];
    const node = v?.data?.attributes || v?.attributes || v;
    if (node && (node.url || node.formats)) return node;
  }
  for (const k of Object.keys(a)) {
    const v = a[k];
    const node = v?.data?.attributes || v?.attributes || v;
    if (node && (node.url || node.formats)) return node;
  }
  return null;
}

function buildSrcSet(node) {
  if (!node) return { srcSet: null, sizes: null };
  const f = node.formats || {};
  const parts = [];
  const push = (u, w) => {
    if (u && w) parts.push(`${absolutize(u)} ${w}w`);
  };
  const guessW = { thumbnail: 245, small: 500, medium: 1000, large: 1920 };
  for (const key of ["thumbnail", "small", "medium", "large"]) {
    const item = f[key];
    if (item?.url) push(item.url, item.width || guessW[key]);
  }
  if (node.url) push(node.url, node.width || 2560);
  return {
    srcSet: parts.length ? parts.join(", ") : null,
    sizes: "(min-width: 1024px) 100vw, 100vw",
  };
}

function videoUrlsOf(slide) {
  const pick =
    getMediaUrl(fromAttrs(slide, "video")) ||
    getMediaUrl(fromAttrs(slide, "background_video")) ||
    getMediaUrl(fromAttrs(slide, "media_video"));
  if (!pick) return { mp4: null, hls: null, webm: null };
  const l = pick.toLowerCase();
  return {
    mp4: l.endsWith(".mp4") ? pick : null,
    hls: l.endsWith(".m3u8") ? pick : null,
    webm: l.endsWith(".webm") ? pick : null,
  };
}

/** optional focal point (0–100 or 0–1) */
function getFocal(slide) {
  const fx = fromAttrs(slide, "focal_x") ?? fromAttrs(slide, "focus_x") ?? undefined;
  const fy = fromAttrs(slide, "focal_y") ?? fromAttrs(slide, "focus_y") ?? undefined;
  let x = Number.isFinite(+fx) ? +fx : null;
  let y = Number.isFinite(+fy) ? +fy : null;
  if (x !== null && x <= 1) x *= 100;
  if (y !== null && y <= 1) y *= 100;
  if (x === null || y === null) return "center";
  x = Math.max(0, Math.min(100, x));
  y = Math.max(0, Math.min(100, y));
  return `${x}% ${y}%`;
}

const useInViewport = (ref, rootMargin = "0px") => {
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), {
      root: null,
      rootMargin,
      threshold: 0.01,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return v;
};

const useReduced = () => {
  const [s, setS] = useState({ reduced: false, saveData: false });
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduced = mq?.matches ?? false;
    const saveData = !!(navigator.connection && navigator.connection.saveData);
    setS({ reduced, saveData });
    if (mq) {
      const h = (e) => setS((p) => ({ ...p, reduced: e.matches }));
      mq.addEventListener?.("change", h);
      return () => mq.removeEventListener?.("change", h);
    }
  }, []);
  return s;
};

/* ===================== CTA sequence & rules ===================== */
/**
 * Futuristic, low-maintenance routing strategy:
 * 1) If Strapi provides an explicit URL → use it (rewriting /audience-categories/* → /collections/*).
 * 2) If Strapi provides an audience/category/collection RELATION with slug → /collections/{slug}. (PRIMARY)
 * 3) If Strapi provides a product slug relation → /products/{slug}.
 * 4) Otherwise fallback to label/title slugify → /collections/{slugifiedLabel}. (FALLBACK)
 *
 * BottomFloatingBar already uses /collections/{slug}, so homepage is aligned automatically.
 */

// Keep labels exactly (UI unchanged). Hrefs are no longer hardcoded per label;
// they will be computed via the resolver to reduce future work.
const SEQ = [
  { label: "Explore", href: "/product" },
  { label: "Women" },
  { label: "Men" },
  { label: "Kids" },
  { label: "Young" },
  { label: "Home Décor" },
  { label: "Accessories" },
  { label: "New Arrival" },
  { label: "On Sale" },
  { label: "Monsoon" },
  { label: "Summer" },
  { label: "Winter" },
];

/* Rewrite any legacy /audience-categories/* link coming from Strapi */
function rewriteToCollections(u) {
  if (!u || typeof u !== "string") return u;
  try {
    const url = new URL(u, "http://dummy");
    const path = url.pathname;
    if (path.startsWith("/audience-categories/")) {
      return u.replace("/audience-categories/", "/collections/");
    }
    return u;
  } catch {
    return u.startsWith("/audience-categories/")
      ? u.replace("/audience-categories/", "/collections/")
      : u;
  }
}

/* Fallback slugify (matches BottomFloatingBar intent) */
function slugifyAudienceLabel(input) {
  const raw = (input ?? "").toString().trim();
  if (!raw) return "";
  const deburred = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return deburred
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['"’`]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Strapi-first CTA; resilient fallbacks; aligned to /collections */
function resolveCTA({ slide, slotIndex }) {
  const getSlug = (val) => {
    if (!val) return null;
    if (typeof val === "string") return val.trim() || null;
    if (Array.isArray(val)) {
      for (const v of val) {
        const s = getSlug(v);
        if (s) return s;
      }
      return null;
    }
    const node = val?.data?.attributes || val?.attributes || val;
    if (typeof node?.slug === "string" && node.slug.trim()) return node.slug.trim();
    return null;
  };

  const fallback =
    slotIndex === 0
      ? { label: "Explore", href: "/product" }
      : SEQ[slotIndex] || { label: "Shop Now", href: "/product" };

  // pick label (prefer Strapi; then slide title/name; then SEQ)
  const labelCandidates = [
    fromAttrs(slide, "cta_text"),
    fromAttrs(slide, "cta_label"),
    fromAttrs(slide, "ctaTitle"),
    fromAttrs(slide, "cta"),
    fromAttrs(slide, "button_text"),
    fromAttrs(slide, "button_label"),
    fromAttrs(slide, "buttonTitle"),
    fromAttrs(slide, "call_to_action_text"),
    fromAttrs(slide, "title"),
    fromAttrs(slide, "name"),
  ];
  const pickedLabel = (labelCandidates.find((v) => typeof v === "string" && v.trim()) || fallback.label)
    .toString()
    .trim();

  // Explore → all products (keep existing behavior)
  if (pickedLabel.toLowerCase() === "explore") {
    return { label: pickedLabel, href: "/product" };
  }

  // 1) explicit Strapi link (rewrite legacy audience-categories → collections)
  const linkCandidates = [
    fromAttrs(slide, "cta_link"),
    fromAttrs(slide, "cta_url"),
    fromAttrs(slide, "link"),
    fromAttrs(slide, "url"),
    fromAttrs(slide, "href"),
    fromAttrs(slide, "button_url"),
    fromAttrs(slide, "button_link"),
    fromAttrs(slide, "button_href"),
    fromAttrs(slide, "cta_href"),
  ];
  const normalizeUrlish = (val) => {
    if (!val) return null;
    if (typeof val === "string") return val.trim() || null;
    if (val?.url || val?.href) return (val.url || val.href || "").toString().trim() || null;
    const nested = val?.data?.attributes?.url || val?.attributes?.url;
    if (nested) return nested.toString().trim();
    if (val?.path) return val.path.toString().trim();
    if (val?.slug) return `/${String(val.slug).trim().replace(/^\/+/, "")}`;
    return null;
  };
  for (const v of linkCandidates) {
    const u = normalizeUrlish(v);
    if (u) return { label: pickedLabel, href: rewriteToCollections(u) };
  }

  // 2) PRIMARY: audience/category/collection relation slug → /collections/{slug}
  const directAudienceSlugKeys = ["audience_slug", "category_slug", "collection_slug", "audienceSlug"];
  for (const k of directAudienceSlugKeys) {
    const raw = fromAttrs(slide, k);
    const s = typeof raw === "string" ? raw.trim() : getSlug(raw);
    if (s) return { label: pickedLabel, href: `/collections/${s.replace(/^\/+/, "")}` };
  }

  const audienceKeys = [
    "audience_category",
    "audienceCategory",
    "audience",
    "category",
    "collection",
    "audience_categories",
    "audienceCategories",
    "collections",
    "collection_ref",
    "category_ref",
    "target_audience",
  ];
  for (const k of audienceKeys) {
    const rel = fromAttrs(slide, k);
    const s = getSlug(rel);
    if (s) return { label: pickedLabel, href: `/collections/${s.replace(/^\/+/, "")}` };
  }

  // 3) product slug relation → /products/{slug}
  const productKeys = [
    "product_slug",
    "product",
    "linked_product",
    "primary_product",
    "product_ref",
    "productRelation",
    "item",
    "variant",
    "products",
  ];
  for (const k of productKeys) {
    const maybe = fromAttrs(slide, k);
    const s =
      k === "product_slug"
        ? typeof maybe === "string"
          ? maybe.trim()
          : getSlug(maybe)
        : getSlug(maybe);
    if (s) return { label: pickedLabel, href: `/products/${s.replace(/^\/+/, "")}` };
  }

  // 4) FALLBACK: label/title => /collections/{slugifiedLabel}
  const slug = slugifyAudienceLabel(pickedLabel);
  if (slug) return { label: pickedLabel, href: `/collections/${slug}` };

  // last resort fallback (should rarely happen)
  if (fallback?.href) return { label: pickedLabel || fallback.label, href: fallback.href };
  return { label: pickedLabel || "Shop Now", href: "/product" };
}

/* Buttons (UI text untouched) */
function PremiumButton({ label, href }) {
  return (
    <a
      href={href}
      className="px-12 py-3 bg-white text-[#142149] text-lg md:text-xl font-extrabold rounded-[0.8rem] shadow-xl border border-neutral-200 hover:bg-[#f1f3f8] hover:text-[#06103B] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#1A2452] tracking-wide flex items-center justify-center"
      style={{ minWidth: 220, letterSpacing: ".02em", textAlign: "center" }}
    >
      {label}
    </a>
  );
}

/* ========= sizing hints ========= */
function sizesForColumns(columns) {
  if (columns === 2) {
    return `
      (min-width: 1440px) calc((100vw - 96px) / 2),
      (min-width: 1024px) calc((100vw - 80px) / 2),
      100vw
    `;
  }
  return `
    (min-width: 1440px) calc((100vw - (3 * 96px)) / 4),
    (min-width: 1024px) calc((100vw - (3 * 80px)) / 4),
    100vw
  `;
}

/* ========================= Media Tile ========================= */
/**
 * SMART PREFERENCE (your rule):
 * - Prefer filling the frame with the whole image: contain + tiny safe scale to hide bands.
 * - Letterbox/pillarbox is the absolute last resort (big disparity).
 * - Main hero (hero_slides / Explore CTA) NEVER letterboxes → always cover.
 * - No distortion ever.
 * - Sharp via srcSet + sizes (browser picks the highest-res available).
 */
function MediaTile({
  slide,
  mode = "grid",
  active,
  eager = false,
  sizesHint = null,
  forceCover = false, // ← for main hero
  focal = "center", // pass precomputed focal
}) {
  const img = imgUrlOf(slide);
  const imgNode = pickImageNode(slide);
  const built = buildSrcSet(imgNode);
  const { mp4, hls, webm } = videoUrlsOf(slide);

  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const visible = useInViewport(wrapRef, "200px");
  const { reduced, saveData } = useReduced();

  const [fit, setFit] = useState(forceCover ? "cover" : "containSafe"); // "cover" | "containSafe" | "contain"
  const [scale, setScale] = useState(1);

  function decideFitForBox(iw, ih, cw, ch) {
    if (!iw || !ih || !cw || !ch) return;

    const arI = iw / ih;
    const arF = cw / ch;
    const disparity = Math.max(arF / arI, arI / arF); // >=1

    const coverScale = Math.max(cw / iw, ch / ih);
    const containScale = Math.min(cw / iw, ch / ih);
    const mulToCover = coverScale / containScale;

    const coverW = iw * coverScale;
    const coverH = ih * coverScale;
    const cropX = Math.max(0, (coverW - cw) / coverW);
    const cropY = Math.max(0, (coverH - ch) / coverH);
    const worstCrop = Math.max(cropX, cropY);

    if (forceCover) {
      setFit("cover");
      setScale(1);
      return;
    }

    if (worstCrop <= 0.06) {
      setFit("cover");
      setScale(1);
      return;
    }

    if (worstCrop <= 0.12) {
      const maxMul = Math.min(mulToCover, 1 + Math.min(0.08, worstCrop * 0.9));
      setFit("containSafe");
      setScale(maxMul);
      return;
    }

    if (disparity > 1.8 || worstCrop > 0.18) {
      setFit("contain");
      setScale(1);
      return;
    }

    const tryMul = Math.min(mulToCover, 1.10);
    if (tryMul >= mulToCover) {
      setFit("containSafe");
      setScale(mulToCover);
    } else {
      setFit("containSafe");
      setScale(tryMul);
    }
  }

  // HLS hookup
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !hls) return;
    const native =
      typeof el.canPlayType === "function" && el.canPlayType("application/vnd.apple.mpegURL");
    if (native) {
      el.src = hls;
      return;
    }
    let h;
    (async () => {
      try {
        const M = await import("hls.js/dist/hls.min.js");
        const H = M.default || M;
        if (H.isSupported()) {
          h = new H({ maxBufferLength: 10 });
          h.loadSource(hls);
          h.attachMedia(el);
        }
      } catch {}
    })();
    return () => {
      try {
        h?.destroy();
      } catch {}
    };
  }, [hls]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const play = visible && active && !reduced && !saveData;
    try {
      play ? el.play?.() : el.pause?.();
    } catch {}
  }, [visible, active, reduced, saveData]);

  const tileRadius = mode === "single" ? "0" : "1rem";

  const tileStyle = {
    width: "100%",
    height: "var(--hero-h)",
    background: "#fff",
    position: "relative",
    borderRadius: tileRadius,
    boxSizing: "border-box",
    overflow: "hidden",
    contentVisibility: "auto",
    contain: "paint",
  };

  const mediaBase = {
    width: "100%",
    height: "100%",
    display: "block",
    borderRadius: tileRadius,
    backgroundColor: "#fff",
  };

  const styleForImg = () => {
    if (fit === "cover") {
      return { ...mediaBase, objectFit: "cover", objectPosition: focal };
    }
    if (fit === "containSafe") {
      return {
        ...mediaBase,
        objectFit: "contain",
        objectPosition: "center",
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        willChange: "transform",
      };
    }
    return { ...mediaBase, objectFit: "contain", objectPosition: "center" };
  };

  const styleForVideo = styleForImg;

  // Render image (or fallback to video)
  if (img || (!mp4 && !hls && !webm)) {
    if (!img) return null;
    return (
      <div ref={wrapRef} className="hero-tile group" style={tileStyle}>
        <img
          src={img}
          srcSet={built.srcSet || undefined}
          sizes={sizesHint || built.sizes || undefined}
          alt={fromAttrs(slide, "title") || "Hero"}
          className="hero-media"
          decoding="async"
          loading={eager ? "eager" : "lazy"}
          {...(eager ? { fetchPriority: "high" } : {})}
          onLoad={(e) => {
            const iw = e.currentTarget.naturalWidth;
            const ih = e.currentTarget.naturalHeight;
            const cw = wrapRef.current?.clientWidth || 0;
            const ch = wrapRef.current?.clientHeight || 0;
            decideFitForBox(iw, ih, cw, ch);
          }}
          style={styleForImg()}
        />
      </div>
    );
  }

  const poster = imgUrlOf(slide) || undefined;

  return (
    <div ref={wrapRef} className="hero-tile group" style={tileStyle}>
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        poster={poster}
        aria-hidden="true"
        className="hero-media"
        onLoadedMetadata={(e) => {
          const iw = e.currentTarget.videoWidth;
          const ih = e.currentTarget.videoHeight;
          const cw = wrapRef.current?.clientWidth || 0;
          const ch = wrapRef.current?.clientHeight || 0;
          decideFitForBox(iw, ih, cw, ch);
        }}
        style={styleForVideo()}
        controls={false}
        disablePictureInPicture
        controlsList="nodownload noplaybackrate nofullscreen noremoteplayback"
        onError={(e) => {
          const c = e.currentTarget.parentElement;
          if (poster && c) {
            c.innerHTML = `<img src="${poster}" alt="Hero" style="object-fit:contain;object-position:center;width:100%;height:100%;display:block;background:#fff;" />`;
          }
        }}
      >
        {mp4 ? <source src={mp4} type="video/mp4" /> : null}
        {webm ? <source src={webm} type="video/webm" /> : null}
      </video>
    </div>
  );
}

/* ========================= Carousel (per tile) ========================= */
function HeroCarousel({ slides, mode = "grid", eagerFirst = false, sizesHint = null, forceCover = false }) {
  const [active, setActive] = useState(0);
  const clean = (slides || []).filter(
    (s) => imgUrlOf(s) || videoUrlsOf(s).mp4 || videoUrlsOf(s).hls || videoUrlsOf(s).webm
  );
  if (!clean.length) return null;

  return (
    <Swiper
      modules={[Navigation, Pagination, Autoplay, EffectFade]}
      navigation
      pagination={{ clickable: true }}
      effect="fade"
      loop
      autoplay={{ delay: 5500, disableOnInteraction: false }}
      onAfterInit={(w) => setActive(w.realIndex ?? 0)}
      onSlideChange={(w) => setActive(w.realIndex ?? 0)}
      className="w-full"
      style={{
        width: "100%",
        borderRadius: mode === "single" ? "0" : "1rem",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      {clean.map((slide, i) => (
        <SwiperSlide key={i}>
          <MediaTile
            slide={slide}
            mode={mode}
            active={i === active}
            eager={eagerFirst && i === 0}
            sizesHint={sizesHint}
            forceCover={forceCover}
            focal={getFocal(slide)}
          />
        </SwiperSlide>
      ))}
      <style>{`
        .swiper-button-next, .swiper-button-prev { display: none !important; }
        .swiper-pagination-bullet { width: 6px; height: 6px; }
        @media (min-width: 1280px) {
          .swiper-pagination-bullet { width: 8px; height: 8px; }
        }
      `}</style>
    </Swiper>
  );
}

/* ========================= Sections ========================= */
function FullBleedSingle({ slides, cta, eagerFirst = false, onBlankClick }) {
  if (!slides?.length) return null;
  return (
    <section
      className="shadow-2xl relative"
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
        marginRight: "calc(-50vw + 50%)",
        background: "#fff",
        borderRadius: 0,
        boxShadow: "0 10px 64px #e5e5e5cc",
      }}
      onClick={onBlankClick}
    >
      {/* hero_slides must NEVER letterbox → forceCover */}
      <HeroCarousel slides={slides} mode="single" eagerFirst={eagerFirst} sizesHint="100vw" forceCover />
      <div className="flex justify-center items-center" style={{ margin: "10px 0 22px 0" }}>
        <PremiumButton label={cta.label} href={cta.href} />
      </div>
    </section>
  );
}

function GridRow({ items, columns, onBlankClick }) {
  const usable = (items || []).filter((it) => Array.isArray(it.slides) && it.slides.length > 0);
  if (!usable.length) return null;

  const sizesHint = sizesForColumns(columns);

  return (
    <section
      style={{
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
        marginRight: "calc(-50vw + 50%)",
        background: "#fff",
        boxSizing: "border-box",
      }}
    >
      <div className="hero-grid" style={{ "--cols": columns }}>
        {usable.map((it, i) => {
          const firstSlide = it.slides?.[0] || {};
          const cta = resolveCTA({ slide: firstSlide, slotIndex: it.slotIndex });
          return (
            <div
              key={i}
              className="hero-tile-wrap"
              style={{ background: "#fff", borderRadius: "0" }}
              onClick={onBlankClick}
            >
              <HeroCarousel slides={it.slides} mode="grid" sizesHint={sizesHint} />
              <div className="flex justify-center items-center" style={{ margin: "14px 0 26px 0" }}>
                <PremiumButton label={cta.label} href={cta.href} />
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .hero-grid {
          display: grid;
          grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
          align-items: stretch;
          gap: 80px; /* horizontal spacing */
          width: 100%;
        }
        @media (min-width: 1440px) {
          .hero-grid { gap: 96px; }
        }
      `}</style>
    </section>
  );
}

/* ========================= Grouping / Planning ========================= */
function coerceSlides(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.length ? val : null;
  if (Array.isArray(val.slides)) return val.slides.length ? val.slides : null;
  if (val.slides && !Array.isArray(val.slides)) {
    const node = val.slides.attributes || val.slides;
    const hasMedia =
      imgUrlOf(node) || videoUrlsOf(node).mp4 || videoUrlsOf(node).hls || videoUrlsOf(node).webm;
    return hasMedia ? [node] : null;
  }
  if (Array.isArray(val.data)) {
    const arr = val.data.map((d) => (d && (d.attributes || d)) || null).filter(Boolean);
    return arr.length ? arr : null;
  }
  if (val.data && !Array.isArray(val.data)) {
    const node = val.data.attributes || val.data;
    const hasMedia =
      imgUrlOf(node) || videoUrlsOf(node).mp4 || videoUrlsOf(node).hls || videoUrlsOf(node).webm;
    return hasMedia ? [node] : null;
  }
  if (typeof val === "object") {
    const node = val.attributes || val;
    const hasMedia =
      imgUrlOf(node) || videoUrlsOf(node).mp4 || videoUrlsOf(node).hls || videoUrlsOf(node).webm;
    return hasMedia ? [node] : null;
  }
  return null;
}

function collectGroups(attrs) {
  const main = coerceSlides(attrs?.hero_slides) || coerceSlides(attrs?.hero_slide) || null;

  const numbered = Object.entries(attrs || {})
    .map(([k, v]) => {
      const m = k.match(/^hero_slides?_?(\d+)$/i);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      const slides = coerceSlides(v);
      if (!slides) console.warn(`[homepage] ${k} exists but has no renderable media`);
      return slides ? { key: k, n, slides } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);

  const groups = [{ key: "hero_slides", slotIndex: 0, slides: main }];
  for (const g of numbered) groups.push({ key: g.key, slotIndex: g.n, slides: g.slides });
  return groups;
}

function planRows(groups) {
  const rows = [];
  const main = groups[0];
  if (main?.slides) {
    rows.push({ type: "single", items: [{ slides: main.slides, slotIndex: 0 }] });
  }
  const rest = groups.slice(1).filter(Boolean);
  const pattern = [4, 2, 4, 2, 4];
  let i = 0,
    p = 0;
  while (i < rest.length) {
    const take = pattern[p % pattern.length];
    const chunk = rest.slice(i, i + take).map((g) => ({ slides: g.slides, slotIndex: g.slotIndex }));
    if (chunk.length) {
      rows.push({ type: "grid", columns: take === 2 ? 2 : 4, items: chunk });
    }
    i += take;
    p += 1;
  }
  return rows;
}

/* ========================= Main ========================= */
export default function HomepageClient({ homepage: initialHomepage = null, error: initialError = null }) {
  const [showBigTDLC, setShowBigTDLC] = useState(true);
  useEffect(() => {
    const onScroll = () => setShowBigTDLC(window.scrollY === 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const handleHideTDLC = () => {
    if (showBigTDLC) setShowBigTDLC(false);
  };

  const [homepage, setHomepage] = useState(initialHomepage);
  const [error, setError] = useState(initialError);

  useEffect(() => {
    if (!homepage) {
      fetchHomepage()
        .then(setHomepage)
        .catch((e) => {
          console.error("[homepage] fetch error", e);
          setError(e?.message || "Unable to load homepage");
        });
    }
  }, [homepage]);

  // tolerant to different Strapi envelopes
  const attrs = (homepage && (homepage.attributes || (homepage.data && homepage.data.attributes))) || {};

  const groups = useMemo(() => collectGroups(attrs), [attrs]);
  const rows = useMemo(() => planRows(groups), [groups]);

  const firstHeroImage = useMemo(() => {
    const firstItem = rows?.[0]?.items?.[0];
    const firstSlide = firstItem?.slides?.[0];
    return firstSlide ? imgUrlOf(firstSlide) : null;
  }, [rows]);

  function handleHeroBlankClick(e) {
    const tag = e.target.tagName.toLowerCase();
    if (
      ["button", "a", "input", "svg", "path"].includes(tag) ||
      e.target.closest(".swiper-pagination") ||
      e.target.closest(".swiper-button-next") ||
      e.target.closest(".swiper-button-prev") ||
      e.target.closest("[role='button']")
    )
      return;
    window.dispatchEvent(new CustomEvent("navbar-dissolve-toggle"));
  }

  return (
    <div className="relative min-h-screen w-full bg-white" onClick={handleHideTDLC}>
      <style jsx global>{`
        :root {
          --hero-h: clamp(560px, 100svh, 1100px);
          --tdlc-bar-h: var(--tdlc-bar-h, 64px);
          --hero-section-gap: 56px;
        }
        @media (min-width: 1024px) {
          :root {
            --hero-section-gap: 80px;
          }
        }
        @media (min-width: 1440px) {
          :root {
            --hero-section-gap: 112px;
          }
        }
      `}</style>

      <Head>
        <link rel="preconnect" href={API_BASE} crossOrigin="" />
        {firstHeroImage ? <link rel="preload" as="image" href={firstHeroImage} fetchPriority="high" /> : null}
      </Head>

      {showBigTDLC && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "100vw",
            zIndex: 9999,
            fontFamily: "'Playfair Display', serif",
            fontWeight: 530,
            fontSize: "25.5rem",
            letterSpacing: ".18em",
            color: "#06103B",
            textAlign: "center",
            textShadow: "0 4px 36px #f9f6e855",
            lineHeight: 1.12,
            pointerEvents: "none",
            userSelect: "none",
            transition: "opacity .00s",
            opacity: 1,
            padding: "32px 0",
            boxShadow: "0 8px 44px #e6e6e6d8",
          }}
        >
          TDLC
        </div>
      )}

      <Navbar />
      <ComplianceAnnouncement />

      {rows.map((row, i) => {
        if (row.type === "single") {
          const item = row.items[0];
          const firstSlide = item?.slides?.[0] || {};
          const cta = resolveCTA({ slide: firstSlide, slotIndex: 0 });
          return (
            <div key={`row-${i}`} style={{ marginTop: i === 0 ? "0.6rem" : "var(--hero-section-gap)" }}>
              <FullBleedSingle slides={item.slides} cta={cta} eagerFirst={i === 0} onBlankClick={handleHeroBlankClick} />
            </div>
          );
        }
        return (
          <div key={`row-${i}`} style={{ marginTop: "var(--hero-section-gap)" }}>
            <GridRow items={row.items} columns={row.columns} onBlankClick={handleHeroBlankClick} />
          </div>
        );
      })}

      {error && (
        <div className="bg-red-50 text-red-700 rounded px-4 py-3 my-8 text-center font-semibold max-w-lg mx-auto">
          <b>Error:</b> {error}
        </div>
      )}

      <div
        style={{
          position: "fixed",
          right: "1.5in",
          bottom: "calc(var(--tdlc-bar-h, 64px) + 1in)",
          zIndex: 60,
        }}
      >
        <Whatsappchatbutton />
      </div>

      <div className="fixed right-6 bottom-24 z-50">
        <ThemeToggle />
      </div>

      <BottomFloatingBarShell />
      <Footer />
    </div>
  );
}
