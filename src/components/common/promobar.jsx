// FILE: src/components/common/promobar.jsx
"use client";

import React from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "tdlc_promobar_dismissed";
const COLLAPSE_KEY_PREFIX = "tdlc_promobar_collapsed_";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(!!mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

// Split "sticky marquee" or "collapsible slide-right" into tokens
function tokenize(animStr) {
  return String(animStr || "")
    .toLowerCase()
    .split(/[\s+,|]+/)
    .filter(Boolean);
}

const CYCLE_LIST = [
  "marquee",
  "fade",
  "slide",
  "slide-right",
  "slide-up",
  "zoom",
  "bounce",
  "flip",
  "highlight",
  "pulse",
  "wave",
  "typewriter",
];

function parseAnimation(tokens, idxForCycle = 0, perMessageAnim = "") {
  const tset = new Set(tokens);
  const flags = {
    sticky: tset.has("sticky"),
    collapsible: tset.has("collapsible"),
    hoverReveal: tset.has("hover"),
    autoDismiss: tset.has("auto_dismiss"),
    persistent: tset.has("persistent"),
    perMessage: tset.has("per_message"),
    manual: tset.has("manual"),
    cycle: tset.has("cycle"),
    wantFramer: tset.has("framer_motion"),
    wantGsap: tset.has("gsap"),
  };

  const baseCandidates = [
    "none","fade","slide","slide-right","slide-up","slide-down",
    "marquee","marquee-right","marquee-up","marquee-down",
    "typewriter","zoom","bounce","flip","highlight","pulse","wave"
  ];

  let base = flags.perMessage && perMessageAnim ? perMessageAnim.toLowerCase().trim() : "";
  if (!base || !baseCandidates.includes(base)) {
    base = tokens.find(t => baseCandidates.includes(t)) || "";
  }
  if (!base && flags.cycle) {
    base = CYCLE_LIST[idxForCycle % CYCLE_LIST.length];
  }
  if (!base) base = "marquee";

  return { base, flags };
}

export default function Promobar() {
  const pathname = usePathname();
  const reduceMotion = usePrefersReducedMotion();

  const [data, setData] = React.useState(null);
  const [hidden, setHidden] = React.useState(false);
  const [idx, setIdx] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [revealed, setRevealed] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  const wrapRef = React.useRef(null);
  const textRef = React.useRef(null);
  const animTimerRef = React.useRef(null);
  const dwellTimerRef = React.useRef(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/promobar", { cache: "no-store" });
        if (res.status === 204) { if (alive) setData(null); return; }
        if (!res.ok) { if (alive) setData(null); return; }
        const json = await res.json();

        const dismissed = (localStorage.getItem(STORAGE_KEY) || "")
          .split(",").filter(Boolean);
        if (dismissed.includes(json.dismissId)) { if (alive) setData(null); return; }

        if (alive) {
          setData(json);
          setHidden(false);
          setIdx(0);
          try {
            const ckey = COLLAPSE_KEY_PREFIX + json.dismissId;
            const wasCollapsed = localStorage.getItem(ckey) === "1";
            setCollapsed(!!wasCollapsed);
          } catch {}
        }
      } catch { if (alive) setData(null); }
    })();
    return () => { alive = false; };
  }, [pathname]);

  React.useEffect(() => {
    return () => {
      clearTimeout(animTimerRef.current);
      clearTimeout(dwellTimerRef.current);
    };
  }, []);

  if (!data || hidden) return null;

  const {
    bg, fg, closable, speed = 60, gapMs = 400, dwellMs = 0,
    animation = "marquee", messages, dismissId,
  } = data;

  const current = messages[idx % messages.length];
  const tokens = tokenize(animation);
  const { base, flags } = parseAnimation(tokens, idx, current?.animation);

  const isManual = flags.manual;
  const isCycle = flags.cycle;
  const isPerMsg = flags.perMessage;
  const isPersistent = flags.persistent;
  const isHoverReveal = flags.hoverReveal;
  const isCollapsible = flags.collapsible;
  const isSticky = flags.sticky;

  const effectiveClosable = isPersistent ? false : !!closable;

  const onClose = () => {
    if (isPersistent) return;
    try {
      const prev = (localStorage.getItem(STORAGE_KEY) || "")
        .split(",").filter(Boolean);
      if (!prev.includes(dismissId)) prev.push(dismissId);
      localStorage.setItem(STORAGE_KEY, prev.join(","));
    } catch {}
    setHidden(true);
  };

  const collapseKey = COLLAPSE_KEY_PREFIX + dismissId;
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(collapseKey, next ? "1" : "0"); } catch {}
  };

  const computedDwell = React.useMemo(() => {
    if (dwellMs > 0) return dwellMs;
    const len = (current?.message?.length || 20);
    return Math.min(9000, Math.max(2500, len * (base === "typewriter" ? 120 : 90)));
  }, [dwellMs, current?.message, base]);

  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    if (base !== "typewriter" || reduceMotion) { setTyped(""); return; }
    const full = current?.message || "";
    setTyped("");
    clearTimeout(dwellTimerRef.current);
    clearTimeout(animTimerRef.current);

    let i = 0;
    const step = () => {
      setTyped(full.slice(0, i));
      i++;
      if (i <= full.length) {
        animTimerRef.current = setTimeout(step, Math.max(15, 900 / Math.max(10, full.length)));
      } else {
        if (!isManual) {
          dwellTimerRef.current = setTimeout(() => {
            setIdx((p) => (p + 1) % messages.length);
          }, gapMs + computedDwell);
        }
      }
    };
    step();
    return () => {
      clearTimeout(animTimerRef.current);
      clearTimeout(dwellTimerRef.current);
    };
  }, [idx, base, reduceMotion, isManual, gapMs, computedDwell, current?.message]);

  React.useEffect(() => {
    if (flags.autoDismiss && !isManual) {
      const t = setTimeout(() => setHidden(true), Math.max(1500, computedDwell));
      return () => clearTimeout(t);
    }
  }, [flags.autoDismiss, isManual, computedDwell]);

  React.useEffect(() => {
    if (!wrapRef.current || !textRef.current) return;
    if (base === "typewriter" && !reduceMotion) return;

    const wrap = wrapRef.current;
    const text = textRef.current;

    clearTimeout(animTimerRef.current);
    clearTimeout(dwellTimerRef.current);

    const scheduleNext = () => {
      if (isManual) return;
      dwellTimerRef.current = setTimeout(() => {
        setIdx((p) => (p + 1) % messages.length);
      }, gapMs);
    };

    if (reduceMotion || base === "none") {
      text.style.animation = "none";
      text.style.transform = "translate3d(0,0,0)";
      if (!isManual) {
        dwellTimerRef.current = setTimeout(scheduleNext, computedDwell);
      }
      return;
    }

    const oneShot = (name, durMs = 320) => {
      text.style.animation = "none";
      void text.offsetWidth;
      text.style.animation = `${name} ${durMs}ms ease 0s 1 both`;
      if (!isManual) {
        dwellTimerRef.current = setTimeout(scheduleNext, computedDwell);
      }
    };

    if (base === "fade") return void oneShot("tdlc-fade-in", 280);
    if (base === "zoom") return void oneShot("tdlc-zoom-in", 300);
    if (base === "bounce") return void oneShot("tdlc-bounce-in", 450);
    if (base === "flip") return void oneShot("tdlc-flip-in", 420);
    if (base === "highlight") return void oneShot("tdlc-highlight", 600);
    if (base === "pulse") return void oneShot("tdlc-pulse", 420);
    if (base === "wave") return void oneShot("tdlc-wave", 600);
    if (base === "slide") return void oneShot("tdlc-slide-in-left", 300);
    if (base === "slide-right") return void oneShot("tdlc-slide-in-right", 300);
    if (base === "slide-up") return void oneShot("tdlc-slide-in-up", 300);
    if (base === "slide-down") return void oneShot("tdlc-slide-in-down", 300);

    const runMarquee = (axis, dir) => {
      text.style.animation = "none";
      text.style.transform = "translate3d(0,0,0)";

      requestAnimationFrame(() => {
        const wr = wrap.getBoundingClientRect();
        const tr = text.getBoundingClientRect();

        if (axis === "x") {
          const wrapW = Math.ceil(wr.width);
          const textW = Math.ceil(tr.width);
          const fromX = dir > 0 ? -textW : wrapW;
          const toX = dir > 0 ? wrapW : -textW;
          const distance = Math.abs(toX - fromX);
          const durationSec = Math.max(0.1, distance / Math.max(10, speed));

          text.style.setProperty("--tdlc-from-x", `${fromX}px`);
          text.style.setProperty("--tdlc-to-x", `${toX}px`);
          text.style.setProperty("--tdlc-dur", `${durationSec}s`);
          text.style.animation = `tdlc-marquee-x var(--tdlc-dur) linear 0s 1 forwards`;
          text.style.animationPlayState = paused ? "paused" : "running";

          animTimerRef.current = setTimeout(() => scheduleNext(), durationSec * 1000);
          return;
        }

        const wrapH = Math.ceil(wr.height);
        const textH = Math.ceil(tr.height);
        const fromY = dir > 0 ? -textH : wrapH;
        const toY = dir > 0 ? wrapH : -textH;
        const distance = Math.abs(toY - fromY);
        const durationSec = Math.max(0.1, distance / Math.max(10, speed));

        text.style.setProperty("--tdlc-from-y", `${fromY}px`);
        text.style.setProperty("--tdlc-to-y", `${toY}px`);
        text.style.setProperty("--tdlc-dur", `${durationSec}s`);
        text.style.animation = `tdlc-marquee-y var(--tdlc-dur) linear 0s 1 forwards`;
        text.style.animationPlayState = paused ? "paused" : "running";

        animTimerRef.current = setTimeout(() => scheduleNext(), durationSec * 1000);
      });
    };

    if (base === "marquee") return void runMarquee("x", -1);
    if (base === "marquee-right") return void runMarquee("x", +1);
    if (base === "marquee-up") return void runMarquee("y", -1);
    if (base === "marquee-down") return void runMarquee("y", +1);

    if (base === "framer_motion" || flags.wantFramer) {
      if (!isManual) oneShot("tdlc-fade-in", 260);
      else text.style.animation = "none";
      return;
    }
    if (base === "gsap" || flags.wantGsap) {
      if (!isManual) oneShot("tdlc-slide-in-left", 280);
      else text.style.animation = "none";
      return;
    }
  }, [idx, base, flags.autoDismiss, isManual, messages.length, reduceMotion, paused, speed, gapMs, computedDwell]);

  const onPrev = () => setIdx((p) => (p - 1 + messages.length) % messages.length);
  const onNext = () => setIdx((p) => (p + 1) % messages.length);

  const containerStyle = {
    backgroundColor: bg,
    color: fg,
    paddingTop: "calc(6px + env(safe-area-inset-top, 0px))",
    paddingBottom: "6px",
    position: isSticky ? "sticky" : undefined,
    top: isSticky ? 0 : undefined,
    zIndex: isSticky ? 50 : undefined,
    overflow: "hidden",
    transition: "max-height 200ms ease",
    maxHeight: isCollapsible && collapsed ? 0 : undefined,
  };

  const barInnerStyle = {
    opacity: isHoverReveal && !revealed ? 0 : 1,
    maxHeight: isHoverReveal && !revealed ? "4px" : undefined,
    transition: "opacity 180ms ease, max-height 180ms ease",
  };

  const content = base === "typewriter" && !reduceMotion ? (typed || " ") : current.message;

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="w-full"
      style={containerStyle}
      onMouseEnter={() => { setPaused(true); setRevealed(true); }}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => { setPaused(true); setRevealed(true); }}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        className="mx-auto flex items-center gap-2 px-4 sm:px-6 lg:px-8"
        style={{ maxWidth: "1280px", ...barInnerStyle }}
      >
        {isCollapsible && (
          <button
            type="button"
            aria-label={collapsed ? "Expand announcement" : "Collapse announcement"}
            onClick={toggleCollapsed}
            className="shrink-0 px-2 py-1 rounded"
            style={{ lineHeight: 1, opacity: 0.85 }}
          >
            {collapsed ? "▾" : "▴"}
          </button>
        )}

        {isManual && (
          <button
            type="button"
            aria-label="Previous"
            onClick={onPrev}
            className="shrink-0 px-1 py-1 rounded"
            style={{ lineHeight: 1, opacity: 0.8 }}
          >
            ‹
          </button>
        )}

        <div ref={wrapRef} className="relative flex-1 overflow-hidden" style={{ minHeight: 28 }}>
          <span
            ref={textRef}
            className="block"
            style={{
              willChange: "transform, opacity",
              whiteSpace: "nowrap",
              display: "inline-block",
              backfaceVisibility: "hidden",
              WebkitFontSmoothing: "antialiased",
              transform: "translate3d(0,0,0)",
            }}
          >
            {current.link ? (
              <a href={current.link} className="underline-offset-2 hover:underline focus:underline">
                {content}
              </a>
            ) : (
              content
            )}
          </span>
        </div>

        {isManual && (
          <button
            type="button"
            aria-label="Next"
            onClick={onNext}
            className="shrink-0 px-1 py-1 rounded"
            style={{ lineHeight: 1, opacity: 0.8 }}
          >
            ›
          </button>
        )}

        {effectiveClosable && (
          <button
            type="button"
            aria-label="Dismiss announcement"
            onClick={onClose}
            className="shrink-0 px-2 py-1 rounded"
            style={{ lineHeight: 1, opacity: 0.85 }}
          >
            ×
          </button>
        )}
      </div>

      <style jsx global>{`
        @keyframes tdlc-marquee-x { from { transform: translate3d(var(--tdlc-from-x, 100%), 0, 0); } to { transform: translate3d(var(--tdlc-to-x, -100%), 0, 0); } }
        @keyframes tdlc-marquee-y { from { transform: translate3d(0, var(--tdlc-from-y, 100%), 0); } to { transform: translate3d(0, var(--tdlc-to-y, -100%), 0); } }
        @keyframes tdlc-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tdlc-zoom-in { from { transform: scale(0.98); opacity: 0.0; } to { transform: scale(1.0); opacity: 1.0; } }
        @keyframes tdlc-bounce-in { 0% { transform: translate3d(0, -10px, 0); opacity: 0; } 50% { transform: translate3d(0, 3px, 0); opacity: 0.9; } 70% { transform: translate3d(0, -2px, 0); opacity: 1; } 100% { transform: translate3d(0, 0, 0); opacity: 1; } }
        @keyframes tdlc-flip-in { from { transform: rotateY(90deg); opacity: 0; transform-style: preserve-3d; } to { transform: rotateY(0deg); opacity: 1; transform-style: preserve-3d; } }
        @keyframes tdlc-highlight { 0% { background: transparent; } 40% { background: rgba(255, 242, 0, 0.35); } 100% { background: transparent; } }
        @keyframes tdlc-pulse { 0% { transform: scale(0.98); opacity: 0.9; } 50% { transform: scale(1.01); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes tdlc-wave { 0% { background-position-x: 0%; } 100% { background-position-x: 100%; } }
        @keyframes tdlc-slide-in-left { from { transform: translate3d(12px, 0, 0); opacity: 0; } to { transform: translate3d(0, 0, 0); opacity: 1; } }
        @keyframes tdlc-slide-in-right { from { transform: translate3d(-12px, 0, 0); opacity: 0; } to { transform: translate3d(0, 0, 0); opacity: 1; } }
        @keyframes tdlc-slide-in-up { from { transform: translate3d(0, 10px, 0); opacity: 0; } to { transform: translate3d(0, 0, 0); opacity: 1; } }
        @keyframes tdlc-slide-in-down { from { transform: translate3d(0, -10px, 0); opacity: 0; } to { transform: translate3d(0, 0, 0); opacity: 1; } }

        [data-tdlc-wave] {
          background: linear-gradient(90deg, currentColor 0%, rgba(255,255,255,0.5) 50%, currentColor 100%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: tdlc-wave 1200ms linear 0s 1 both;
        }
      `}</style>
    </div>
  );
}
