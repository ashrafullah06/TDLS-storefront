// src/components/admin/table/pagination.js
import React from "react";

export default function Pagination({
  page = 1,
  pageSize = 20,
  total = 0,
  onPageChange,
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const jump = (p) => {
    const next = Math.min(Math.max(1, p), totalPages);
    if (next !== page) onPageChange?.(next);
  };

  return (
    <div className="mt-3 flex items-center justify-between text-sm text-gray-700">
      <div>
        Showing{" "}
        <strong>
          {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}
        </strong>{" "}
        of <strong>{total}</strong>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="h-8 px-3 rounded border border-gray-300 disabled:opacity-50"
          disabled={!canPrev}
          onClick={() => jump(page - 1)}
        >
          Prev
        </button>
        <span>
          Page <strong>{page}</strong> / {totalPages}
        </span>
        <button
          className="h-8 px-3 rounded border border-gray-300 disabled:opacity-50"
          disabled={!canNext}
          onClick={() => jump(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
