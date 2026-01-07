// src/components/admin/table/row.js
import React from "react";

export default function Row({ children, onClick, selected = false, hover = true }) {
  return (
    <tr
      onClick={onClick}
      className={[
        "align-middle",
        selected ? "bg-blue-50" : "bg-white",
        hover ? "hover:bg-gray-50" : "",
        "border-b border-gray-200",
      ].join(" ")}
    >
      {children}
    </tr>
  );
}
