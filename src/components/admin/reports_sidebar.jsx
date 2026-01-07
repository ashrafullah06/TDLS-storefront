// FILE: src/components/admin/reports_sidebar.jsx
// Links only; no placeholders.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/admin/reports/product-pnl",     label: "Product P&L",      required: ["VIEW_FINANCIALS"] },
  { href: "/admin/reports/pnl",             label: "Aggregate P&L",    required: ["VIEW_FINANCIALS"] },
  { href: "/admin/reports/inventory-aging", label: "Inventory Aging",  required: ["VIEW_REPORTS"]   },
];

export default function ReportsSidebar() {
  const pathname = usePathname();
  const [perms, setPerms] = useState(null);

  useEffect(() => {
    let ok = true;
    fetch("/api/admin/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (ok) setPerms(d?.user?.permissions || []); })
      .catch(() => { if (ok) setPerms(null); });
    return () => { ok = false; };
  }, []);

  const items = Array.isArray(perms)
    ? LINKS.filter((l) => (l.required || []).every((req) => perms.includes(req)))
    : LINKS;

  return (
    <aside className="w-full md:w-64 border-r bg-white" aria-label="Reports sidebar">
      <div className="p-4">
        <div className="text-base font-semibold mb-3 text-[#0b1b3b]">Reports</div>
        <nav className="space-y-1">
          {items.map((l) => {
            const active = pathname?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={[
                  "block rounded px-3 py-2 border transition-colors outline-none",
                  active
                    ? "bg-[#0b1b3b] text-white border-[#0b1b3b]"
                    : "bg-white text-[#0b1b3b] border-[#0b1b3b] hover:bg-[#f6f7fb] focus:ring-2 focus:ring-offset-2 focus:ring-[#0b1b3b]",
                ].join(" ")}
                style={{ textDecoration: "none" }}
              >
                {l.label}
              </Link>
            );
          })}
          {Array.isArray(perms) && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-neutral-500">
              No report permissions for this account.
            </div>
          )}
        </nav>
      </div>
    </aside>
  );
}
