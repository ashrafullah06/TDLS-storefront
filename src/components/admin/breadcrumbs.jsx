// src/components/admin/breadcrumbs.jsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Admin breadcrumbs
 * - small, dependency-free
 * - uses current pathname, trims dynamic segments
 * - links back to /admin home and intermediate nodes
 */
export default function Breadcrumbs({ rootLabel = "dashboard" }) {
  const pathname = usePathname() || "";
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .filter((s) => s !== "admin" && s !== "(admin)");

  const parts = [];
  let href = "/admin";
  parts.push({ label: rootLabel, href });

  segments.forEach((seg) => {
    href += `/${seg}`;
    parts.push({ label: seg.replace(/[\[\]]/g, ""), href });
  });

  return (
    <nav aria-label="Breadcrumb" className="text-sm text-gray-500">
      <ol className="flex items-center gap-1 flex-wrap">
        {parts.map((p, i) => {
          const last = i === parts.length - 1;
         return (
            <li key={p.href} className="flex items-center gap-1">
              {!last ? (
                <>
                  <Link href={p.href} className="hover:text-gray-900">{p.label}</Link>
                  <span className="opacity-60">/</span>
                </>
              ) : (
                <span className="text-gray-900 font-medium">{p.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
