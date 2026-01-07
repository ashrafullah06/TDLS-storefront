// src/components/admin/table/cell.js
import React from "react";

export default function Cell({
  children,
  header = false,
  align = "left",
  wrap = false,
  className = "",
  width,
}) {
  const Tag = header ? "th" : "td";
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const base =
    "px-3 py-2 text-sm " + (header ? "font-semibold text-gray-700" : "text-gray-800");
  const wrapClass = wrap ? "whitespace-normal break-words" : "whitespace-nowrap";
  const style = width ? { width } : undefined;

  return (
    <Tag className={`${base} ${alignClass} ${wrapClass} ${className}`} style={style}>
      {children}
    </Tag>
  );
}
