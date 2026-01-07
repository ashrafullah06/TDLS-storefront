// src/components/admin/table/skeleton.js
import React from "react";

export default function Skeleton({ rows = 8, cols = 6 }) {
  const R = Array.from({ length: rows });
  const C = Array.from({ length: cols });
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse min-w-[720px]">
        <thead>
          <tr>
            {C.map((_, ci) => (
              <th key={`h-${ci}`} className="px-3 py-2 text-left text-sm font-semibold text-gray-600">
                <div className="h-4 w-24 bg-gray-200 animate-pulse rounded" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {R.map((_, ri) => (
            <tr key={`r-${ri}`} className="border-b border-gray-200">
              {C.map((_, ci) => (
                <td key={`c-${ri}-${ci}`} className="px-3 py-3">
                  <div className="h-4 w-full max-w-[180px] bg-gray-200 animate-pulse rounded" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
