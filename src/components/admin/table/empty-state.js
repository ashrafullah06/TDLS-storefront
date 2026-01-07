// src/components/admin/table/empty-state.js
import React from "react";

export default function EmptyState({ title = "No results", subtitle = "Try adjusting your filters or search." , action = null}) {
  return (
    <div className="w-full rounded-lg border border-dashed border-gray-300 p-10 text-center bg-white">
      <div className="text-gray-900 font-medium">{title}</div>
      <div className="text-gray-500 text-sm mt-1">{subtitle}</div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
