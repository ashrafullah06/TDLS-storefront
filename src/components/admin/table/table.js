// src/components/admin/table/table.js
import React, { forwardRef } from "react";

/**
 * Minimal, reusable admin table container.
 * Tailwind-only; no external deps; works with server or client components.
 */
const Table = forwardRef(function Table({ children, className = "" }, ref) {
  return (
    <div ref={ref} className={`w-full overflow-x-auto ${className}`}>
      <table className="w-full border-collapse min-w-[720px]">
        {children}
      </table>
    </div>
  );
});

export default Table;
