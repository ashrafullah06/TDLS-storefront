// src/components/common/logorotator.jsx
"use client";

import React, { useEffect, useRef } from "react";

const LOGOS = [
  "/logos/logo-gold.svg",
  "/logos/logo-white.svg",
  "/logos/logo-silver.svg",
  "/logos/logo-cyan.svg",
  "/logos/logo-olive-smoke.svg",
  "/logos/logo-maroon.svg",
];

// Calm luxury pacing
const ROTATE_INTERVAL_MS = 12000;

// Transition tuning (silky, premium)
const FADE_OUT_MS = 420;
const FADE_IN_MS = 620;
const SHEEN_MS = 900; // short specular sweep
const GLOW_MS = 780; // restrained aura

const GLOW_COLORS = ["#e7b84e", "#f5f5f7", "#c3c3c9", "#14d0e8", "#7a8862", "#962c34"];

function getReducedMotionNow() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return !!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function computeSize() {
  const w = (typeof window !== "undefined" && window.innerWidth) ? window.innerWidth : 1200;
  if (w < 420) return 92;
  if (w < 640) return 112;
  if (w < 1024) return 138;
  return 150;
}

function buildBaseFilter() {
  // Luxury shadow stack: deep base + crisp edge (works on white + light backgrounds)
  return "drop-shadow(0 18px 38px rgba(15,33,71,0.14)) drop-shadow(0 3px 10px rgba(0,0,0,0.12))";
}

function buildGlowFilter(glowHex) {
  const base = buildBaseFilter();
  // Aura is subtle and “expensive”: small radius + low alpha
  return `${base} drop-shadow(0 0 22px ${glowHex}55) drop-shadow(0 0 46px ${glowHex}33)`;
}

/**
 * LogoRotator (fully independent)
 * - No React state updates (no setState) => cannot cause update-depth loops.
 * - Only mutates its own DOM nodes via refs.
 * - No global connections: no context, no stores, no cross-component wiring.
 * - Cleans up timers/listeners on unmount (StrictMode safe).
 */
const LogoRotator = React.memo(function LogoRotator() {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const sheenRef = useRef(null);

  const indexRef = useRef(0);
  const reducedRef = useRef(false);

  const intervalRef = useRef(null);
  const tOutRef = useRef(null);
  const tGlowRef = useRef(null);
  const tFirstRef = useRef(null);

  // Apply current sizing without causing any React re-render
  useEffect(() => {
    const applySize = () => {
      const size = computeSize();

      const c = containerRef.current;
      const img = imgRef.current;
      const sheen = sheenRef.current;

      if (c) {
        c.style.minHeight = `${size + 18}px`;
        c.style.minWidth = `${size + 18}px`;
      }
      if (img) {
        img.style.width = `${size}px`;
        img.style.height = `${size}px`;
      }
      if (sheen) {
        sheen.style.width = `${size}px`;
        sheen.style.height = `${size}px`;
      }
    };

    applySize();
    window.addEventListener("resize", applySize, { passive: true });
    return () => window.removeEventListener("resize", applySize);
  }, []);

  // Reduced-motion listener (no state; internal ref only)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = !!mq.matches;
    };
    apply();

    if (mq.addEventListener) mq.addEventListener("change", apply);
    else mq.addListener(apply);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", apply);
      else mq.removeListener(apply);
    };
  }, []);

  // Rotation engine (DOM-only; no React state)
  useEffect(() => {
    const clearAll = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tOutRef.current) clearTimeout(tOutRef.current);
      if (tGlowRef.current) clearTimeout(tGlowRef.current);
      if (tFirstRef.current) clearTimeout(tFirstRef.current);

      intervalRef.current = null;
      tOutRef.current = null;
      tGlowRef.current = null;
      tFirstRef.current = null;
    };

    const img = imgRef.current;
    const sheen = sheenRef.current;

    const setPhase = (phase) => {
      if (!img) return;

      const inPhase = phase === "in";

      img.style.opacity = inPhase ? "1" : "0";
      img.style.transform = inPhase
        ? "perspective(1100px) rotateY(0deg) translateZ(0px) scale(1)"
        : "perspective(1100px) rotateY(62deg) translateZ(-8px) scale(0.972)";

      const ms = inPhase ? FADE_IN_MS : FADE_OUT_MS;

      // Micro blur on exit makes the flip look more expensive
      // IMPORTANT FIX: keep filter + webkitFilter identical to avoid compositor ghost/double artifacts
      const baseFilter = buildBaseFilter();
      const blur = inPhase ? " blur(0px)" : " blur(0.35px)";
      const combined = baseFilter + blur;
      img.style.filter = combined;
      img.style.webkitFilter = combined;

      img.style.transition = [
        `opacity ${ms}ms cubic-bezier(0.22,1,0.36,1)`,
        `transform ${ms}ms cubic-bezier(0.22,1,0.36,1)`,
        "filter 720ms cubic-bezier(0.22,1,0.36,1)",
        "-webkit-filter 720ms cubic-bezier(0.22,1,0.36,1)",
      ].join(", ");
      img.style.willChange = "opacity, transform, filter";

      // IMPORTANT FIX: do not keep sheen visible continuously (prevents dark/black shading overlay)
      if (sheen) {
        if (!inPhase || reducedRef.current) sheen.style.opacity = "0";
      }
    };

    const applyLogo = (i) => {
      if (!img) return;
      const safeI = ((i % LOGOS.length) + LOGOS.length) % LOGOS.length;
      indexRef.current = safeI;
      img.src = LOGOS[safeI];
    };

    const runSheen = () => {
      if (!sheen || reducedRef.current) return;

      // Retrigger by resetting animation
      const sweep = sheen.querySelector('[data-sheen-sweep="1"]');
      if (!sweep) return;

      // IMPORTANT FIX: show sheen only during sweep, otherwise keep it hidden (prevents shading/ghost look)
      sheen.style.opacity = "1";

      sweep.style.animation = "none";
      // Force reflow to restart animation
      // eslint-disable-next-line no-unused-expressions
      sweep.getBoundingClientRect();
      sweep.style.animation = `tdlcSheen ${SHEEN_MS}ms cubic-bezier(0.22,1,0.36,1) both`;

      // Hide right after sweep ends (small buffer for compositor)
      try {
        if (sheen.__hideT) clearTimeout(sheen.__hideT);
        sheen.__hideT = setTimeout(() => {
          if (!sheen) return;
          sheen.style.opacity = "0";
        }, SHEEN_MS + 90);
      } catch {}
    };

    const glowOn = () => {
      if (!img) return;
      const glowHex = GLOW_COLORS[indexRef.current] || "#e7b84e";
      const glowFilter = buildGlowFilter(glowHex);

      // IMPORTANT FIX: keep filter + webkitFilter identical to avoid compositor ghost/double artifacts
      const isOut = img.style.opacity === "0";
      const blur = isOut ? " blur(0.35px)" : " blur(0px)";
      const combined = glowFilter + blur;

      img.style.filter = combined;
      img.style.webkitFilter = combined;

      if (tGlowRef.current) clearTimeout(tGlowRef.current);
      tGlowRef.current = setTimeout(() => {
        if (!img) return;
        const base = buildBaseFilter();

        const stillOut = img.style.opacity === "0";
        const b2 = stillOut ? " blur(0.35px)" : " blur(0px)";
        const combined2 = base + b2;

        img.style.filter = combined2;
        img.style.webkitFilter = combined2;
      }, GLOW_MS);
    };

    const tick = () => {
      if (reducedRef.current || LOGOS.length <= 1) return;

      setPhase("out");

      tOutRef.current = setTimeout(() => {
        const next = (indexRef.current + 1) % LOGOS.length;
        applyLogo(next);
        setPhase("in");
        runSheen();
        glowOn();
      }, FADE_OUT_MS);
    };

    // init
    clearAll();
    reducedRef.current = getReducedMotionNow();

    applyLogo(indexRef.current);
    setPhase("in");

    // If reduced motion: keep static and do not schedule timers.
    if (reducedRef.current || LOGOS.length <= 1) return clearAll;

    // calm start
    tFirstRef.current = setTimeout(tick, ROTATE_INTERVAL_MS);
    intervalRef.current = setInterval(tick, ROTATE_INTERVAL_MS);

    return clearAll;
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        minHeight: "168px",
        minWidth: "168px",
        pointerEvents: "none",
        userSelect: "none",
        isolation: "isolate",
        background: "transparent",
      }}
    >
      {/* Specular sweep (subtle, only on swap; no circular plate) */}
      <div
        ref={sheenRef}
        style={{
          position: "absolute",
          width: "150px",
          height: "150px",
          zIndex: 2,
          pointerEvents: "none",
          opacity: 0, // IMPORTANT FIX: was 1 (caused static overlay shading/ghosting)
          transition: "opacity 240ms ease",
          WebkitMaskImage:
            "radial-gradient(closest-side, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 62%, rgba(0,0,0,0.0) 82%)",
          maskImage:
            "radial-gradient(closest-side, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 62%, rgba(0,0,0,0.0) 82%)",
          mixBlendMode: "soft-light",
        }}
      >
        <div
          data-sheen-sweep="1"
          style={{
            width: "120%",
            height: "120%",
            transform: "translate(-18%, -10%) rotate(12deg)",
            background:
              "linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.26) 45%, rgba(255,255,255,0) 62%)",
            animation: "none",
          }}
        />
      </div>

      {/* Logo */}
      <img
        ref={imgRef}
        src={LOGOS[0]}
        alt=""
        draggable={false}
        style={{
          width: "150px",
          height: "150px",
          objectFit: "contain",
          zIndex: 1,
          opacity: 1,
          transform: "perspective(1100px) rotateY(0deg) translateZ(0px) scale(1)",
          filter: buildBaseFilter() + " blur(0px)", // IMPORTANT FIX: match filter pipeline baseline
          WebkitFilter: buildBaseFilter() + " blur(0px)", // IMPORTANT FIX: keep identical to avoid ghosting
          willChange: "opacity, transform, filter",
        }}
      />

      <style jsx>{`
        @keyframes tdlcSheen {
          0% {
            transform: translate(-26%, -14%) rotate(12deg) translateX(-18%);
            opacity: 0.05;
          }
          20% {
            opacity: 0.55;
          }
          100% {
            transform: translate(-26%, -14%) rotate(12deg) translateX(26%);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
});

export default LogoRotator;
