// FILE: app/(admin)/admin/analytics/_components/ui.jsx
"use client";

import React from "react";
import { cx } from "../_lib/utils";

export function Tile({ className, children }) {
  return (
    <div
      className={cx(
        "rounded-3xl border border-slate-200/80 bg-white/70 backdrop-blur",
        "shadow-[0_18px_50px_rgba(2,6,23,0.06)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Pill({ children, tone = "neutral", className }) {
  const map = {
    neutral: "bg-slate-900/5 text-slate-700 border-slate-900/10",
    good: "bg-emerald-500/10 text-emerald-700 border-emerald-600/20",
    warn: "bg-amber-500/10 text-amber-800 border-amber-600/20",
    bad: "bg-rose-500/10 text-rose-700 border-rose-600/20",
    navy: "bg-[#0F2147]/10 text-[#0F2147] border-[#0F2147]/20",
    gold: "bg-[#D4AF37]/10 text-[#7A5A00] border-[#D4AF37]/30",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-bold",
        map[tone] || map.neutral,
        className
      )}
    >
      {children}
    </span>
  );
}

export function BigCTAButton({
  tone = "secondary",
  disabled,
  className,
  children,
  ...props
}) {
  const base =
    "h-11 px-6 rounded-full font-black text-[13px] tracking-[0.02em] transition " +
    "shadow-[0_12px_30px_rgba(2,6,23,0.10)] hover:shadow-[0_18px_42px_rgba(2,6,23,0.14)] " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
  const map = {
    primary:
      "bg-[#0F2147] text-white hover:bg-[#183A7B] focus-visible:ring-[#0F2147]",
    secondary:
      "bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 focus-visible:ring-slate-300",
    subtle:
      "bg-slate-900/5 text-slate-900 border border-slate-200/60 hover:bg-slate-900/8 focus-visible:ring-slate-300",
    danger:
      "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      className={cx(
        base,
        map[tone] || map.secondary,
        disabled ? "opacity-60 cursor-not-allowed" : "hover:-translate-y-[1px]",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "relative h-10 px-4 rounded-full text-[12px] font-black tracking-[0.06em] uppercase",
        "transition border",
        active
          ? "bg-[#0F2147] text-white border-[#0F2147] shadow-[0_16px_36px_rgba(15,33,71,0.25)]"
          : "bg-white/80 text-slate-700 border-slate-200 hover:bg-white hover:text-slate-900 hover:border-slate-300"
      )}
    >
      {children}
    </button>
  );
}

export function Notice({ tone = "soft", text, onClose }) {
  if (!text) return null;
  const map = {
    soft: "border-slate-200/80 bg-white/75 text-slate-800",
    good: "border-emerald-300/50 bg-emerald-50/70 text-emerald-900",
    warn: "border-amber-300/50 bg-amber-50/70 text-amber-900",
    bad: "border-rose-300/50 bg-rose-50/70 text-rose-900",
  };
  return (
    <div
      className={cx(
        "w-full rounded-3xl border p-4 md:p-5",
        "shadow-[0_18px_50px_rgba(2,6,23,0.06)]",
        map[tone] || map.soft
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13px] font-semibold leading-relaxed">{text}</div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className={cx(
              "shrink-0 h-10 px-5 rounded-full",
              "border border-slate-200/80 bg-white/85 text-[12px] font-black text-slate-900",
              "shadow-[0_10px_26px_rgba(2,6,23,0.06)]",
              "transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-[0_14px_36px_rgba(2,6,23,0.08)] hover:-translate-y-[1px]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-300"
            )}
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function MetricKPI({ label, value, sub, right }) {
  return (
    <Tile className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-black uppercase tracking-[0.08em] text-slate-600">
            {label}
          </div>
          <div className="mt-3 text-[34px] leading-none font-black tracking-tight text-slate-900">
            {value}
          </div>
          {sub ? (
            <div className="mt-2 text-[12px] font-semibold text-slate-600">
              {sub}
            </div>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
    </Tile>
  );
}
