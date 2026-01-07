// FILE: app/(admin)/admin/analytics/_components/charts.jsx
"use client";

import React from "react";
import { NAVY, n } from "../_lib/utils";

/* ---------------- micro charts (no libs) ---------------- */
export function MiniLineChart({
  data,
  valueKey = "revenuePaid",
  height = 240,
  stroke = NAVY,
}) {
  const width = 920;
  const pad = 18;

  const values = (data || []).map((d) => n(d?.[valueKey]));
  const maxV = Math.max(1, ...values);
  const minV = Math.min(0, ...values);

  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const xFor = (i) =>
    pad + (innerW * i) / Math.max(1, (data?.length || 1) - 1);
  const yFor = (v) => {
    const t = (v - minV) / Math.max(1e-9, maxV - minV);
    return pad + innerH * (1 - t);
  };

  const pts = (data || []).map((d, i) => ({
    x: xFor(i),
    y: yFor(n(d?.[valueKey])),
  }));
  const path =
    pts.length > 0
      ? `M ${pts[0].x} ${pts[0].y} ` +
        pts
          .slice(1)
          .map((p) => `L ${p.x} ${p.y}`)
          .join(" ")
      : "";

  const area =
    pts.length > 0
      ? `${path} L ${pts[pts.length - 1].x} ${height - pad} L ${
          pts[0].x
        } ${height - pad} Z`
      : "";

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-[240px] w-full"
      >
        <defs>
          <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#lineFill)" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="3.5" />
        <line
          x1={pad}
          x2={width - pad}
          y1={height - pad}
          y2={height - pad}
          stroke="#E5E7EB"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

export function MiniBars({
  data,
  valueKey = "orders",
  height = 240,
  fill = NAVY,
}) {
  const width = 920;
  const pad = 18;

  const values = (data || []).map((d) => n(d?.[valueKey]));
  const maxV = Math.max(1, ...values);
  const barW = (width - pad * 2) / Math.max(1, (data || []).length);

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-[240px] w-full"
      >
        <line
          x1={pad}
          x2={width - pad}
          y1={height - pad}
          y2={height - pad}
          stroke="#E5E7EB"
          strokeWidth="2"
        />
        {(data || []).map((d, i) => {
          const v = n(d?.[valueKey]);
          const h = ((height - pad * 2) * v) / maxV;
          const x = pad + i * barW + barW * 0.15;
          const y = height - pad - h;
          const w = barW * 0.7;
          return (
            <rect
              key={d?.day || d?.date || i}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={12}
              fill={fill}
              opacity={0.14 + Math.min(0.55, v / maxV)}
            />
          );
        })}
      </svg>
    </div>
  );
}
