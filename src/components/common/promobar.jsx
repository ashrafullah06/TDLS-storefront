// ✅ FILE: src/components/common/promobar.jsx
"use client";

import React from "react";

/* -------------------------------------------------------------------------- */
/* HEADER STACK CONTRACT                                                       */
/* -------------------------------------------------------------------------- */

const PROMO_HEIGHT_VAR = "--tdls-promobar-h";
const PROMO_HEIGHT_EVENT = "tdls:promobar-height";

/*
 * Highest storefront layer.
 */
const PROMOBAR_Z_INDEX = 2147483647;

/* -------------------------------------------------------------------------- */
/* DISMISSAL                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Deliberately versioned.
 *
 * Previous PromoBar implementations could leave a valid campaign permanently
 * invisible because they reused old TDLC/TDLS dismissal records.
 *
 * V3 intentionally starts a fresh dismissal namespace once.
 *
 * After a customer closes a V3 campaign, the SAME dismissId stays dismissed.
 * A changed/new campaign receives a different dismissId from the API.
 */
const STORAGE_KEY = "tdls_promobar_dismissed_v3";

/* -------------------------------------------------------------------------- */
/* SINGLETON                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Navbar now mounts PromoBar directly.
 *
 * This browser-global guard prevents accidental duplicate bars if an old
 * layout also still renders <Promobar />.
 */
const OWNER_KEY = "__TDLS_PROMOBAR_OWNER_V3__";

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                     */
/* -------------------------------------------------------------------------- */

function canUseWindow() {
  return typeof window !== "undefined";
}

function canUseDocument() {
  return typeof document !== "undefined";
}

function normalizeString(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  const text = String(value).trim();

  return text || fallback;
}

function parseStoredList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readDismissedIds() {
  if (!canUseWindow()) return [];

  try {
    return parseStoredList(
      window.localStorage.getItem(STORAGE_KEY)
    );
  } catch {
    return [];
  }
}

function saveDismissedId(id) {
  if (!canUseWindow()) return;

  const clean = normalizeString(id);

  if (!clean) return;

  try {
    const current = readDismissedIds();

    if (!current.includes(clean)) {
      current.push(clean);
    }

    /*
     * Prevent uncontrolled storage growth.
     */
    const trimmed = current.slice(-60);

    window.localStorage.setItem(
      STORAGE_KEY,
      trimmed.join(",")
    );
  } catch {}
}

function publishPromoHeight(height) {
  if (!canUseDocument()) return;

  const safeHeight = Math.max(
    0,
    Math.ceil(Number(height) || 0)
  );

  try {
    document.documentElement.style.setProperty(
      PROMO_HEIGHT_VAR,
      `${safeHeight}px`
    );
  } catch {}

  if (!canUseWindow()) return;

  try {
    window.dispatchEvent(
      new CustomEvent(PROMO_HEIGHT_EVENT, {
        detail: {
          height: safeHeight,
        },
      })
    );
  } catch {
    try {
      window.dispatchEvent(
        new Event(PROMO_HEIGHT_EVENT)
      );
    } catch {}
  }
}

function normalizeMessage(item) {
  if (typeof item === "string") {
    const message = item.trim();

    return message
      ? {
          id: message.slice(0, 64),
          message,
          link: "",
          animation: "",
        }
      : null;
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  const source =
    item.attributes &&
    typeof item.attributes === "object"
      ? {
          id: item.id,
          ...item.attributes,
        }
      : item;

  const message = normalizeString(
    source.message ??
      source.text ??
      source.title ??
      source.label
  );

  if (!message) return null;

  return {
    ...source,

    id: normalizeString(
      source.id ??
        source.documentId ??
        message.slice(0, 64)
    ),

    message,

    link: normalizeString(
      source.link ??
        source.href ??
        source.url,
      ""
    ),

    animation: normalizeString(
      source.animation,
      ""
    ).toLowerCase(),
  };
}

function normalizePayload(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  let source = raw;

  /*
   * Support:
   * { ok:true, data:{...} }
   */
  if (
    source.ok === true &&
    source.data &&
    typeof source.data === "object"
  ) {
    source = source.data;
  }

  /*
   * Support Strapi style wrapper.
   */
  if (
    source.data &&
    !Array.isArray(source.data) &&
    typeof source.data === "object" &&
    !source.messages
  ) {
    source = source.data.attributes
      ? {
          id: source.data.id,
          ...source.data.attributes,
        }
      : source.data;
  }

  const rawMessages = Array.isArray(
    source.messages
  )
    ? source.messages
    : source.message
      ? [source.message]
      : [];

  const messages = rawMessages
    .map(normalizeMessage)
    .filter(Boolean);

  if (!messages.length) {
    return null;
  }

  return {
    bg: normalizeString(
      source.bg,
      "#0C2340"
    ),

    fg: normalizeString(
      source.fg,
      "#FFFDF8"
    ),

    /*
     * Customer dismissibility is a storefront requirement.
     */
    closable: true,

    speed: Number.isFinite(
      Number(source.speed)
    )
      ? Math.max(
          15,
          Math.min(
            300,
            Number(source.speed)
          )
        )
      : 52,

    gapMs: Number.isFinite(
      Number(source.gapMs)
    )
      ? Math.max(
          0,
          Number(source.gapMs)
        )
      : 650,

    dwellMs: Number.isFinite(
      Number(source.dwellMs)
    )
      ? Math.max(
          1800,
          Number(source.dwellMs)
        )
      : 5200,

    animation: normalizeString(
      source.animation,
      "fade"
    ).toLowerCase(),

    dismissId: normalizeString(
      source.dismissId ??
        source.dismiss_id ??
        source.id ??
        "tdls-promo-v3"
    ),

    messages,
  };
}

/* -------------------------------------------------------------------------- */
/* REDUCED MOTION                                                              */
/* -------------------------------------------------------------------------- */

function usePrefersReducedMotion() {
  const [reduced, setReduced] =
    React.useState(false);

  React.useEffect(() => {
    if (
      !canUseWindow() ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const query = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    const apply = () => {
      setReduced(!!query.matches);
    };

    apply();

    if (
      typeof query.addEventListener ===
      "function"
    ) {
      query.addEventListener(
        "change",
        apply
      );

      return () => {
        query.removeEventListener(
          "change",
          apply
        );
      };
    }

    if (
      typeof query.addListener === "function"
    ) {
      query.addListener(apply);

      return () => {
        query.removeListener(apply);
      };
    }
  }, []);

  return reduced;
}

/* -------------------------------------------------------------------------- */
/* ANIMATION                                                                   */
/* -------------------------------------------------------------------------- */

function animationTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[\s+,|]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveAnimation(
  globalAnimation,
  messageAnimation
) {
  const valid = new Set([
    "none",
    "fade",
    "slide",
    "slide-right",
    "slide-up",
    "slide-down",
    "zoom",
    "marquee",
    "marquee-right",
  ]);

  const local = normalizeString(
    messageAnimation,
    ""
  ).toLowerCase();

  if (valid.has(local)) {
    return local;
  }

  const tokens = animationTokens(
    globalAnimation
  );

  const found = tokens.find((token) =>
    valid.has(token)
  );

  return found || "fade";
}

function isManualAnimation(value) {
  return animationTokens(value).includes(
    "manual"
  );
}

/* -------------------------------------------------------------------------- */
/* ICONS                                                                       */
/* -------------------------------------------------------------------------- */

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M5 12H19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      <path
        d="M14 7L19 12L14 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M6.5 6.5L17.5 17.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />

      <path
        d="M17.5 6.5L6.5 17.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* COMPONENT                                                                   */
/* -------------------------------------------------------------------------- */

export default function Promobar() {
  const reduceMotion =
    usePrefersReducedMotion();

  const [isOwner, setIsOwner] =
    React.useState(false);

  const [data, setData] =
    React.useState(null);

  const [hidden, setHidden] =
    React.useState(false);

  const [index, setIndex] =
    React.useState(0);

  const [paused, setPaused] =
    React.useState(false);

  const barRef = React.useRef(null);

  const ownerTokenRef =
    React.useRef(null);

  /* ---------------------------------------------------------------------- */
  /* SINGLETON CLAIM                                                        */
  /* ---------------------------------------------------------------------- */

  React.useEffect(() => {
    if (!canUseWindow()) return;

    const token =
      `tdls-promo-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

    ownerTokenRef.current = token;

    if (!window[OWNER_KEY]) {
      window[OWNER_KEY] = token;
    }

    const owns =
      window[OWNER_KEY] === token;

    setIsOwner(owns);

    return () => {
      if (
        window[OWNER_KEY] === token
      ) {
        try {
          delete window[OWNER_KEY];
        } catch {
          window[OWNER_KEY] = null;
        }

        publishPromoHeight(0);
      }
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* FETCH                                                                  */
  /* ---------------------------------------------------------------------- */

  React.useEffect(() => {
    if (!isOwner) return;

    let alive = true;

    const load = async () => {
      try {
        const response =
          await fetch(
            "/api/promobar",
            {
              method: "GET",

              headers: {
                Accept:
                  "application/json",
              },

              cache: "no-store",
            }
          );

        if (!alive) return;

        if (
          response.status ===
          204
        ) {
          setData(null);
          setHidden(false);
          publishPromoHeight(0);
          return;
        }

        if (!response.ok) {
          setData(null);
          setHidden(false);
          publishPromoHeight(0);
          return;
        }

        const raw =
          await response
            .json()
            .catch(() => null);

        if (!alive) return;

        const normalized =
          normalizePayload(raw);

        if (!normalized) {
          setData(null);
          setHidden(false);
          publishPromoHeight(0);
          return;
        }

        const dismissed =
          readDismissedIds();

        /*
         * Only V3 dismissals are respected.
         *
         * Old broken dismissal data cannot suppress the new PromoBar.
         */
        if (
          dismissed.includes(
            normalized.dismissId
          )
        ) {
          setData(null);
          setHidden(false);
          publishPromoHeight(0);
          return;
        }

        setData(normalized);
        setHidden(false);
        setIndex(0);
      } catch {
        if (!alive) return;

        setData(null);
        setHidden(false);
        publishPromoHeight(0);
      }
    };

    load();

    return () => {
      alive = false;
    };
  }, [isOwner]);

  /* ---------------------------------------------------------------------- */
  /* ACTIVE DATA                                                            */
  /* ---------------------------------------------------------------------- */

  const activeData =
    data && !hidden
      ? data
      : null;

  const messages =
    Array.isArray(
      activeData?.messages
    )
      ? activeData.messages
      : [];

  const current =
    messages.length > 0
      ? messages[
          index %
            messages.length
        ]
      : null;

  const animation =
    resolveAnimation(
      activeData?.animation,
      current?.animation
    );

  const manual =
    isManualAnimation(
      activeData?.animation
    );

  /* ---------------------------------------------------------------------- */
  /* MEASURE                                                                */
  /* ---------------------------------------------------------------------- */

  React.useEffect(() => {
    if (
      !isOwner ||
      !activeData
    ) {
      publishPromoHeight(0);
      return;
    }

    const element =
      barRef.current;

    if (!element) {
      publishPromoHeight(0);
      return;
    }

    let frame = 0;

    const measure = () => {
      if (frame) {
        cancelAnimationFrame(
          frame
        );
      }

      frame =
        requestAnimationFrame(
          () => {
            frame = 0;

            const height =
              element
                .getBoundingClientRect()
                .height || 0;

            publishPromoHeight(
              height
            );
          }
        );
    };

    measure();

    let observer = null;

    if (
      typeof ResizeObserver !==
      "undefined"
    ) {
      observer =
        new ResizeObserver(
          measure
        );

      observer.observe(
        element
      );
    }

    window.addEventListener(
      "resize",
      measure,
      {
        passive: true,
      }
    );

    window.visualViewport?.addEventListener?.(
      "resize",
      measure,
      {
        passive: true,
      }
    );

    return () => {
      if (frame) {
        cancelAnimationFrame(
          frame
        );
      }

      observer?.disconnect();

      window.removeEventListener(
        "resize",
        measure
      );

      window.visualViewport?.removeEventListener?.(
        "resize",
        measure
      );
    };
  }, [
    isOwner,
    activeData,
  ]);

  /* ---------------------------------------------------------------------- */
  /* MESSAGE ROTATION                                                       */
  /* ---------------------------------------------------------------------- */

  React.useEffect(() => {
    if (
      !activeData ||
      messages.length <= 1 ||
      paused ||
      manual
    ) {
      return;
    }

    const currentLength =
      current?.message?.length ||
      30;

    const readingTime =
      Math.max(
        activeData.dwellMs ||
          5200,

        Math.min(
          9000,
          currentLength * 72
        )
      );

    const timer =
      window.setTimeout(() => {
        setIndex(
          (prev) =>
            (prev + 1) %
            messages.length
        );
      }, readingTime + (activeData.gapMs || 0));

    return () => {
      window.clearTimeout(
        timer
      );
    };
  }, [
    activeData,
    messages.length,
    current?.message,
    paused,
    manual,
  ]);

  /* ---------------------------------------------------------------------- */
  /* CLOSE                                                                  */
  /* ---------------------------------------------------------------------- */

  const onClose = () => {
    if (!activeData) return;

    saveDismissedId(
      activeData.dismissId
    );

    setHidden(true);

    publishPromoHeight(0);
  };

  /* ---------------------------------------------------------------------- */
  /* MANUAL NAVIGATION                                                      */
  /* ---------------------------------------------------------------------- */

  const onPrevious = () => {
    if (
      messages.length <= 1
    ) {
      return;
    }

    setIndex(
      (prev) =>
        (prev -
          1 +
          messages.length) %
        messages.length
    );
  };

  const onNext = () => {
    if (
      messages.length <= 1
    ) {
      return;
    }

    setIndex(
      (prev) =>
        (prev + 1) %
        messages.length
    );
  };

  /* ---------------------------------------------------------------------- */
  /* RENDER GUARD                                                           */
  /* ---------------------------------------------------------------------- */

  if (
    !isOwner ||
    !activeData ||
    !current
  ) {
    return null;
  }

  const marqueeDuration =
    Math.max(
      12,
      Math.min(
        34,
        (current.message.length *
          8) /
          Math.max(
            15,
            activeData.speed
          )
      )
    );

  const animationClass =
    reduceMotion ||
    animation === "none"
      ? ""
      : animation ===
          "marquee"
        ? "tdls-promo-marquee"
        : animation ===
            "marquee-right"
          ? "tdls-promo-marquee tdls-promo-marquee-right"
          : `tdls-promo-${animation}`;

  /* ---------------------------------------------------------------------- */
  /* RENDER                                                                 */
  /* ---------------------------------------------------------------------- */

  return (
    <aside
      ref={barRef}
      id="tdls-promobar"
      role="region"
      aria-label="Store announcement"
      data-tdls-promobar-instance="true"
      className="tdls-promobar"
      style={{
        "--tdls-promo-bg":
          activeData.bg,

        "--tdls-promo-fg":
          activeData.fg,

        "--tdls-promo-marquee-duration":
          `${marqueeDuration}s`,

        position: "fixed",

        top: 0,

        left: 0,

        right: 0,

        width: "100%",

        zIndex:
          PROMOBAR_Z_INDEX,

        color:
          activeData.fg,

        background: `
          linear-gradient(
            110deg,
            rgba(255,255,255,0.035) 0%,
            rgba(191,167,80,0.075) 38%,
            rgba(255,255,255,0.015) 72%,
            rgba(191,167,80,0.055) 100%
          ),
          ${activeData.bg}
        `,

        boxSizing:
          "border-box",

        paddingTop:
          "env(safe-area-inset-top, 0px)",

        isolation:
          "isolate",

        boxShadow:
          "0 7px 26px rgba(4, 12, 30, 0.12)",

        WebkitFontSmoothing:
          "antialiased",
      }}
      onMouseEnter={() =>
        setPaused(true)
      }
      onMouseLeave={() =>
        setPaused(false)
      }
      onFocusCapture={() =>
        setPaused(true)
      }
      onBlurCapture={() =>
        setPaused(false)
      }
    >
      {/* subtle top champagne line */}
      <span
        aria-hidden="true"
        className="tdls-promo-goldline tdls-promo-goldline-top"
      />

      <div className="tdls-promo-inner">
        {/* ---------------------------------------------------------------- */}
        {/* BRAND — TDLS ONLY                                                */}
        {/* ---------------------------------------------------------------- */}

        <div
          className="tdls-promo-brand"
          aria-hidden="true"
        >
          <span className="tdls-promo-brand-word">
            TDLS
          </span>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* MESSAGE                                                          */}
        {/* ---------------------------------------------------------------- */}

        <div
          className="tdls-promo-message-window"
          aria-live="polite"
          aria-atomic="true"
        >
          <div
            key={`${current.id}-${index}`}
            className={`tdls-promo-message ${animationClass}`}
          >
            {current.link ? (
              <a
                href={
                  current.link
                }
                className="tdls-promo-link"
              >
                <span>
                  {
                    current.message
                  }
                </span>

                <span
                  className="tdls-promo-link-arrow"
                  aria-hidden="true"
                >
                  <ArrowIcon />
                </span>
              </a>
            ) : (
              <span>
                {current.message}
              </span>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* CONTROLS                                                         */}
        {/* ---------------------------------------------------------------- */}

        <div className="tdls-promo-controls">
          {messages.length >
            1 &&
          manual ? (
            <>
              <button
                type="button"
                onClick={
                  onPrevious
                }
                className="tdls-promo-nav-button"
                aria-label="Previous announcement"
              >
                ‹
              </button>

              <span
                className="tdls-promo-count"
                aria-hidden="true"
              >
                {index + 1}/
                {messages.length}
              </span>

              <button
                type="button"
                onClick={onNext}
                className="tdls-promo-nav-button"
                aria-label="Next announcement"
              >
                ›
              </button>
            </>
          ) : messages.length >
            1 ? (
            <div
              className="tdls-promo-dots"
              aria-hidden="true"
            >
              {messages.map(
                (
                  message,
                  i
                ) => (
                  <span
                    key={
                      message.id ||
                      i
                    }
                    className={`tdls-promo-dot ${
                      i ===
                      index
                        ? "is-active"
                        : ""
                    }`}
                  />
                )
              )}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="tdls-promo-close"
            aria-label="Dismiss announcement"
            title="Dismiss announcement"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* subtle bottom champagne line */}
      <span
        aria-hidden="true"
        className="tdls-promo-goldline tdls-promo-goldline-bottom"
      />

      <style jsx>{`
        .tdls-promobar {
          min-height: 42px;
        }

        .tdls-promo-inner {
          width: 100%;
          max-width: 1540px;
          min-height: 42px;
          margin: 0 auto;

          display: grid;

          grid-template-columns:
            minmax(58px, auto)
            minmax(0, 1fr)
            minmax(46px, auto);

          align-items: center;

          gap: clamp(
            12px,
            2vw,
            28px
          );

          padding:
            5px
            clamp(
              14px,
              3.2vw,
              52px
            );

          box-sizing: border-box;
        }

        /* -------------------------------------------------------------- */
        /* LUXURY ACCENTS                                                 */
        /* -------------------------------------------------------------- */

        .tdls-promo-goldline {
          position: absolute;

          left: 0;
          right: 0;

          height: 1px;

          pointer-events: none;

          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(
                191,
                167,
                80,
                0.12
              )
              10%,
            rgba(
                218,
                194,
                118,
                0.72
              )
              50%,
            rgba(
                191,
                167,
                80,
                0.12
              )
              90%,
            transparent 100%
          );
        }

        .tdls-promo-goldline-top {
          top: env(
            safe-area-inset-top,
            0px
          );

          opacity: 0.68;
        }

        .tdls-promo-goldline-bottom {
          bottom: 0;

          opacity: 0.38;
        }

        /* -------------------------------------------------------------- */
        /* BRAND — TDLS ONLY                                              */
        /* -------------------------------------------------------------- */

        .tdls-promo-brand {
          min-width: 0;

          display: inline-flex;

          align-items: center;

          color: #d6be78;

          user-select: none;
        }

        .tdls-promo-brand-word {
          font-family:
            "Playfair Display",
            "Times New Roman",
            Georgia,
            serif;

          font-size: 12px;

          font-weight: 700;

          letter-spacing: 0.23em;

          line-height: 1;

          color: #e3ce91;

          text-transform: uppercase;

          text-shadow:
            0 1px 10px
              rgba(
                218,
                194,
                118,
                0.08
              );
        }

        /* -------------------------------------------------------------- */
        /* MESSAGE — LUXURY TYPOGRAPHY                                    */
        /* -------------------------------------------------------------- */

        .tdls-promo-message-window {
          position: relative;

          min-width: 0;

          min-height: 30px;

          overflow: hidden;

          display: flex;

          align-items: center;

          justify-content: center;
        }

        .tdls-promo-message {
          max-width: 100%;

          display: inline-flex;

          align-items: center;

          justify-content: center;

          text-align: center;

          /*
           * Luxury editorial serif typography.
           *
           * Playfair Display is already used by the TDLS navigation,
           * keeping the PromoBar visually coherent with the brand.
           */
          font-family:
            "Playfair Display",
            "Cormorant Garamond",
            "Baskerville",
            "Times New Roman",
            Georgia,
            serif;

          font-size: clamp(
            12px,
            1.08vw,
            14px
          );

          font-weight: 500;

          letter-spacing: 0.055em;

          line-height: 1.38;

          color:
            var(
              --tdls-promo-fg
            );

          text-shadow:
            0 1px 10px
              rgba(
                0,
                0,
                0,
                0.1
              );

          white-space: nowrap;

          will-change:
            transform,
            opacity;
        }

        .tdls-promo-link {
          max-width: 100%;

          display: inline-flex;

          align-items: center;

          gap: 8px;

          color: inherit;

          text-decoration: none;

          outline: none;

          font-family: inherit;

          font-weight: inherit;

          letter-spacing: inherit;

          transition:
            opacity 160ms
              ease,
            color 160ms ease;
        }

        .tdls-promo-link:hover,
        .tdls-promo-link:focus-visible {
          color: #f2dda0;
        }

        .tdls-promo-link-arrow {
          display: inline-flex;

          align-items: center;

          justify-content: center;

          color: #d9c27e;

          transition:
            transform 180ms
            ease;
        }

        .tdls-promo-link:hover
          .tdls-promo-link-arrow,
        .tdls-promo-link:focus-visible
          .tdls-promo-link-arrow {
          transform: translateX(
            3px
          );
        }

        /* -------------------------------------------------------------- */
        /* CONTROLS                                                        */
        /* -------------------------------------------------------------- */

        .tdls-promo-controls {
          display: inline-flex;

          align-items: center;

          justify-content:
            flex-end;

          gap: 7px;

          min-width: 0;
        }

        .tdls-promo-close,
        .tdls-promo-nav-button {
          appearance: none;

          border: 0;

          outline: none;

          margin: 0;

          padding: 0;

          color: #e4d29b;

          background:
            rgba(
              255,
              255,
              255,
              0.035
            );

          border:
            1px solid
            rgba(
              220,
              199,
              137,
              0.18
            );

          cursor: pointer;

          WebkitTapHighlightColor:
            transparent;

          transition:
            background 160ms
              ease,
            border-color 160ms
              ease,
            transform 120ms
              ease,
            color 160ms ease;
        }

        .tdls-promo-close {
          width: 30px;

          height: 30px;

          flex: 0 0 30px;

          display: inline-flex;

          align-items: center;

          justify-content: center;

          border-radius: 999px;
        }

        .tdls-promo-close:hover,
        .tdls-promo-close:focus-visible {
          background:
            rgba(
              214,
              190,
              120,
              0.12
            );

          border-color:
            rgba(
              220,
              199,
              137,
              0.45
            );

          color: #fff1c5;
        }

        .tdls-promo-close:active {
          transform: scale(
            0.94
          );
        }

        .tdls-promo-nav-button {
          width: 25px;

          height: 25px;

          display: inline-flex;

          align-items: center;

          justify-content: center;

          border-radius: 999px;

          font-size: 17px;

          line-height: 1;
        }

        .tdls-promo-count {
          font-family:
            "Playfair Display",
            Georgia,
            serif;

          font-size: 9px;

          letter-spacing: 0.08em;

          color:
            rgba(
              255,
              255,
              255,
              0.55
            );

          white-space: nowrap;
        }

        .tdls-promo-dots {
          display: inline-flex;

          align-items: center;

          justify-content: center;

          gap: 5px;

          padding: 0 2px;
        }

        .tdls-promo-dot {
          width: 4px;

          height: 4px;

          display: block;

          border-radius: 999px;

          background:
            rgba(
              255,
              255,
              255,
              0.25
            );

          transition:
            width 180ms ease,
            background 180ms
              ease;
        }

        .tdls-promo-dot.is-active {
          width: 12px;

          background:
            rgba(
              221,
              198,
              130,
              0.92
            );
        }

        /* -------------------------------------------------------------- */
        /* ANIMATION                                                       */
        /* -------------------------------------------------------------- */

        .tdls-promo-fade {
          animation:
            tdlsPromoFade
            520ms ease both;
        }

        .tdls-promo-slide {
          animation:
            tdlsPromoSlideLeft
            520ms
            cubic-bezier(
              0.22,
              0.61,
              0.36,
              1
            )
            both;
        }

        .tdls-promo-slide-right {
          animation:
            tdlsPromoSlideRight
            520ms
            cubic-bezier(
              0.22,
              0.61,
              0.36,
              1
            )
            both;
        }

        .tdls-promo-slide-up {
          animation:
            tdlsPromoSlideUp
            520ms
            cubic-bezier(
              0.22,
              0.61,
              0.36,
              1
            )
            both;
        }

        .tdls-promo-slide-down {
          animation:
            tdlsPromoSlideDown
            520ms
            cubic-bezier(
              0.22,
              0.61,
              0.36,
              1
            )
            both;
        }

        .tdls-promo-zoom {
          animation:
            tdlsPromoZoom
            500ms ease both;
        }

        .tdls-promo-marquee {
          justify-content:
            flex-start;

          animation:
            tdlsPromoMarquee
            var(
              --tdls-promo-marquee-duration
            )
            linear infinite;
        }

        .tdls-promo-marquee-right {
          animation-name:
            tdlsPromoMarqueeRight;
        }

        .tdls-promobar:hover
          .tdls-promo-marquee {
          animation-play-state:
            paused;
        }

        @keyframes tdlsPromoFade {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }

        @keyframes tdlsPromoSlideLeft {
          from {
            opacity: 0;

            transform:
              translate3d(
                12px,
                0,
                0
              );
          }

          to {
            opacity: 1;

            transform:
              translate3d(
                0,
                0,
                0
              );
          }
        }

        @keyframes tdlsPromoSlideRight {
          from {
            opacity: 0;

            transform:
              translate3d(
                -12px,
                0,
                0
              );
          }

          to {
            opacity: 1;

            transform:
              translate3d(
                0,
                0,
                0
              );
          }
        }

        @keyframes tdlsPromoSlideUp {
          from {
            opacity: 0;

            transform:
              translate3d(
                0,
                7px,
                0
              );
          }

          to {
            opacity: 1;

            transform:
              translate3d(
                0,
                0,
                0
              );
          }
        }

        @keyframes tdlsPromoSlideDown {
          from {
            opacity: 0;

            transform:
              translate3d(
                0,
                -7px,
                0
              );
          }

          to {
            opacity: 1;

            transform:
              translate3d(
                0,
                0,
                0
              );
          }
        }

        @keyframes tdlsPromoZoom {
          from {
            opacity: 0;

            transform:
              scale(
                0.985
              );
          }

          to {
            opacity: 1;

            transform:
              scale(1);
          }
        }

        @keyframes tdlsPromoMarquee {
          from {
            transform:
              translate3d(
                100vw,
                0,
                0
              );
          }

          to {
            transform:
              translate3d(
                -100%,
                0,
                0
              );
          }
        }

        @keyframes tdlsPromoMarqueeRight {
          from {
            transform:
              translate3d(
                -100%,
                0,
                0
              );
          }

          to {
            transform:
              translate3d(
                100vw,
                0,
                0
              );
          }
        }

        /* -------------------------------------------------------------- */
        /* TABLET                                                         */
        /* -------------------------------------------------------------- */

        @media (max-width: 900px) {
          .tdls-promo-inner {
            grid-template-columns:
              minmax(
                56px,
                auto
              )
              minmax(0, 1fr)
              minmax(
                38px,
                auto
              );

            gap: 10px;

            padding-left: 16px;

            padding-right: 10px;
          }

          .tdls-promo-brand-word {
            font-size: 10.5px;

            letter-spacing: 0.19em;
          }

          .tdls-promo-message {
            font-size: clamp(
              11.5px,
              1.35vw,
              13.5px
            );

            letter-spacing: 0.045em;
          }
        }

        /* -------------------------------------------------------------- */
        /* MOBILE                                                         */
        /* -------------------------------------------------------------- */

        @media (max-width: 639px) {
          .tdls-promobar {
            min-height: 40px;
          }

          .tdls-promo-inner {
            min-height: 40px;

            grid-template-columns:
              minmax(
                0,
                1fr
              )
              32px;

            gap: 7px;

            padding:
              5px
              7px
              5px
              12px;
          }

          /*
           * Mobile remains message-focused exactly as before.
           */
          .tdls-promo-brand {
            display: none;
          }

          .tdls-promo-message-window {
            min-height: 30px;

            justify-content:
              flex-start;
          }

          .tdls-promo-message {
            width: 100%;

            justify-content:
              center;

            font-family:
              "Playfair Display",
              "Cormorant Garamond",
              "Baskerville",
              "Times New Roman",
              Georgia,
              serif;

            font-size: clamp(
              11px,
              3vw,
              12.5px
            );

            font-weight: 500;

            letter-spacing: 0.025em;

            line-height: 1.34;
          }

          .tdls-promo-message:not(
              .tdls-promo-marquee
            ) {
            white-space: normal;

            display: -webkit-box;

            -webkit-line-clamp: 2;

            -webkit-box-orient:
              vertical;

            overflow: hidden;

            text-align: center;
          }

          .tdls-promo-link {
            gap: 5px;
          }

          .tdls-promo-controls {
            gap: 0;
          }

          .tdls-promo-dots,
          .tdls-promo-count,
          .tdls-promo-nav-button {
            display: none;
          }

          .tdls-promo-close {
            width: 30px;

            height: 30px;
          }
        }

        /* -------------------------------------------------------------- */
        /* VERY SMALL MOBILE                                              */
        /* -------------------------------------------------------------- */

        @media (max-width: 360px) {
          .tdls-promo-inner {
            padding-left: 8px;

            padding-right: 5px;
          }

          .tdls-promo-message {
            font-size: 10.5px;

            letter-spacing:
              0.018em;
          }
        }

        /* -------------------------------------------------------------- */
        /* ACCESSIBILITY                                                  */
        /* -------------------------------------------------------------- */

        @media (
          prefers-reduced-motion:
            reduce
        ) {
          .tdls-promo-message,
          .tdls-promo-link-arrow,
          .tdls-promo-dot,
          .tdls-promo-close,
          .tdls-promo-nav-button {
            animation:
              none !important;

            transition:
              none !important;
          }
        }
      `}</style>
    </aside>
  );
}