"use client";
/**
 * Flyouts – blinking-free, hover + click open, outside-click/Esc/close-button close.
 * Drop-in file. No timers, no mouseleave auto-close.
 * Tailwind classes are used for sizing & spacing; adjust if needed.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const FlyoutCtx = createContext(null);

function useOutsideClick(ref, onOutside) {
  useEffect(() => {
    function handler(e) {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target)) onOutside?.(e);
    }
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [ref, onOutside]);
}

function useEsc(onEsc) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onEsc?.(e);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onEsc]);
}

export function Root({ children, initialOpenId = null }) {
  const rootRef = useRef(null);
  const [openId, setOpenId] = useState(initialOpenId);

  // Close only by outside click or Esc (no hover-based closing).
  useOutsideClick(rootRef, () => setOpenId(null));
  useEsc(() => setOpenId(null));

  const api = useMemo(
    () => ({
      openId,
      open: (id) => setOpenId(id),
      close: () => setOpenId(null),
      toggle: (id) => setOpenId((cur) => (cur === id ? null : id)),
      isOpen: (id) => openId === id,
    }),
    [openId]
  );

  return (
    <FlyoutCtx.Provider value={api}>
      <div ref={rootRef} className="relative z-50">
        {children}
      </div>
    </FlyoutCtx.Provider>
  );
}

export function Trigger({
  id,
  as: Comp = "button",
  className = "",
  children,
  "aria-controls": ariaControls,
  ...rest
}) {
  const fly = useContext(FlyoutCtx);
  if (!fly) throw new Error("Flyouts.Trigger must be used inside Flyouts.Root");

  const isOpen = fly.isOpen(id);

  return (
    <Comp
      type={Comp === "button" ? "button" : undefined}
      aria-expanded={isOpen}
      aria-haspopup="menu"
      aria-controls={ariaControls || `${id}-panel`}
      data-flyout-trigger={id}
      // Open on hover; this does NOT close on leave
      onPointerEnter={() => fly.open(id)}
      // Toggle on click
      onClick={(e) => {
        e.preventDefault();
        fly.toggle(id);
      }}
      className={[
        "px-3 py-2 lg:px-4 lg:py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2",
        isOpen ? "ring-1 ring-black/10" : "ring-0",
        "text-[15px] md:text-[16px] lg:text-[17px]", // slightly larger text
        "transition-colors",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </Comp>
  );
}

export function Panel({
  id,
  align = "left", // 'left' | 'center' | 'right'
  className = "",
  style,
  children,
}) {
  const fly = useContext(FlyoutCtx);
  if (!fly) throw new Error("Flyouts.Panel must be used inside Flyouts.Root");

  const isOpen = fly.isOpen(id);

  // Positioning helpers
  const alignClass =
    align === "center"
      ? "left-1/2 -translate-x-1/2"
      : align === "right"
      ? "right-0"
      : "left-0";

  return (
    <div
      id={`${id}-panel`}
      role="menu"
      aria-labelledby={`${id}-trigger`}
      data-flyout-panel={id}
      className={[
        "absolute top-full mt-2",
        alignClass,
        // Panel chrome
        "min-w-64 md:min-w-72 lg:min-w-[22rem]",
        "rounded-2xl shadow-xl border border-black/5 bg-white",
        "p-4 md:p-5 lg:p-6",
        "text-[14.5px] md:text-[15.5px] lg:text-[16px] leading-relaxed",
        "transition-opacity duration-100",
        isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        className,
      ].join(" ")}
      style={style}
    >
      {/* Close row */}
      <div className="flex items-center justify-between mb-3 md:mb-4">
        <div className="font-medium tracking-wide uppercase text-gray-700 text-[12px]">
          {id}
        </div>
        <button
          type="button"
          className="px-2 py-1 rounded-md text-sm border border-black/10 hover:bg-black/5"
          onClick={() => fly.close()}
          aria-label="Close flyout"
        >
          Close
        </button>
      </div>

      {children}
    </div>
  );
}

/**
 * Convenience namespace export:
 * import * as Flyouts from "@/components/common/flyouts";
 * <Flyouts.Root> <Flyouts.Trigger id="women">Women</Flyouts.Trigger> <Flyouts.Panel id="women">...</Flyouts.Panel> </Flyouts.Root>
 */
const Flyouts = { Root, Trigger, Panel };
export default Flyouts;

/* ----------- OPTIONAL: Example usage (delete if not needed) -----------
import Flyouts from "@/components/common/flyouts";

export default function CategoryBar() {
  return (
    <Flyouts.Root>
      <div className="relative flex items-center gap-2 lg:gap-4">
        <Flyouts.Trigger id="women" className="font-medium">Women</Flyouts.Trigger>
        <Flyouts.Trigger id="men" className="font-medium">Men</Flyouts.Trigger>
        <Flyouts.Trigger id="kids" className="font-medium">Kids</Flyouts.Trigger>
      </div>

      <Flyouts.Panel id="women" align="left">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <a className="hover:underline" href="/collections/women/new">New In</a>
          <a className="hover:underline" href="/collections/women/tops">Tops</a>
          <a className="hover:underline" href="/collections/women/bottoms">Bottoms</a>
          <a className="hover:underline" href="/collections/women/outerwear">Outerwear</a>
          <a className="hover:underline" href="/collections/women/accessories">Accessories</a>
        </div>
      </Flyouts.Panel>

      <Flyouts.Panel id="men" align="left">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <a className="hover:underline" href="/collections/men/new">New In</a>
          <a className="hover:underline" href="/collections/men/tshirts">T-Shirts</a>
          <a className="hover:underline" href="/collections/men/trousers">Trousers</a>
          <a className="hover:underline" href="/collections/men/outerwear">Outerwear</a>
        </div>
      </Flyouts.Panel>

      <Flyouts.Panel id="kids" align="left">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <a className="hover:underline" href="/collections/kids/new">New In</a>
          <a className="hover:underline" href="/collections/kids/girls">Girls</a>
          <a className="hover:underline" href="/collections/kids/boys">Boys</a>
        </div>
      </Flyouts.Panel>
    </Flyouts.Root>
  );
}
----------------------------------------------------------------------- */
