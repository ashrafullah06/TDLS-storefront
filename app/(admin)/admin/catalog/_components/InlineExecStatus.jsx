// FILE: app/(admin)/admin/catalog/_components/InlineExecStatus.jsx
"use client";

import React, { useMemo } from "react";

function str(v) {
  return String(v ?? "").trim();
}

/**
 * InlineExecStatus
 * - Standardized inline execution feedback (NO popups/panels).
 * - Designed to sit near CTAs (e.g., Bulk Actions button, "Run diagnostics", etc.)
 *
 * Usage examples:
 * <InlineExecStatus state={execState} />
 * where execState could be:
 *   { tone: "success"|"error"|"warn"|"info", title: "...", message: "...", at: Date|string|number }
 *
 * Or pass props directly:
 * <InlineExecStatus tone="success" title="Saved" message="Product updated." />
 */
export default function InlineExecStatus({
  state,
  tone,
  title,
  message,
  at,
  compact = false,
  className = "",
}) {
  const resolved = useMemo(() => {
    const s = state || {};
    const t = str(tone || s.tone || s.type || "").toLowerCase();
    const tt = str(title || s.title || "");
    const mm = str(message || s.message || s.detail || "");
    const when = at ?? s.at ?? s.time ?? null;

    let stamp = "";
    if (when != null) {
      const d = new Date(when);
      if (Number.isFinite(d.getTime())) stamp = d.toLocaleString();
    }

    const normTone =
      t === "success" || t === "ok"
        ? "success"
        : t === "error" || t === "failed" || t === "danger"
        ? "error"
        : t === "warn" || t === "warning"
        ? "warn"
        : t === "info"
        ? "info"
        : "";

    return { normTone, tt, mm, stamp };
  }, [state, tone, title, message, at]);

  if (!resolved.tt && !resolved.mm) return null;

  const palette =
    resolved.normTone === "success"
      ? {
          dot: "bg-emerald-600",
          title: "text-emerald-700",
          text: "text-emerald-800",
          border: "border-emerald-200",
          bg: "bg-emerald-50",
        }
      : resolved.normTone === "error"
      ? {
          dot: "bg-red-600",
          title: "text-red-700",
          text: "text-red-800",
          border: "border-red-200",
          bg: "bg-red-50",
        }
      : resolved.normTone === "warn"
      ? {
          dot: "bg-amber-600",
          title: "text-amber-800",
          text: "text-amber-900",
          border: "border-amber-200",
          bg: "bg-amber-50",
        }
      : {
          dot: "bg-[#0F2147]",
          title: "text-[#0F2147]",
          text: "text-neutral-800",
          border: "border-neutral-200",
          bg: "bg-neutral-50",
        };

  return (
    <div
      className={[
        "rounded-2xl border px-4 py-3",
        palette.border,
        palette.bg,
        compact ? "py-2" : "",
        className,
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${palette.dot}`} />
        <div className="min-w-0">
          {resolved.tt ? (
            <div className={["text-sm font-extrabold", palette.title].join(" ")}>
              {resolved.tt}
              {resolved.stamp ? (
                <span className="ml-2 text-xs font-semibold text-neutral-600">
                  {resolved.stamp}
                </span>
              ) : null}
            </div>
          ) : null}

          {resolved.mm ? (
            <div
              className={[
                compact ? "text-xs" : "text-sm",
                "mt-0.5 whitespace-pre-wrap font-semibold",
                palette.text,
              ].join(" ")}
            >
              {resolved.mm}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
