// FILE: src/components/admin/admintopbar.js
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

export default function AdminTopbar() {
  const pathname = usePathname();

  const crumbs = useMemo(() => {
    const parts = (pathname || "").split("/").filter(Boolean);
    // keep only the admin path onwards
    const adminIndex = parts.indexOf("admin");
    const slice = adminIndex >= 0 ? parts.slice(adminIndex) : parts;
    const segments = [];
    let href = "";
    slice.forEach((p) => {
      href += `/${p}`;
      segments.push({ label: p.replaceAll("-", " "), href });
    });
    return segments;
  }, [pathname]);

  return (
    <header className="admin-topbar">
      <div className="admin-topbar__inner">
        <div className="admin-topbar__left">
          <div className="admin-brand">TDLC Admin</div>
          <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.href} className="crumb">
                {i < crumbs.length - 1 ? (
                  <>
                    <Link href={c.href} className="crumb-link">
                      {c.label}
                    </Link>
                    <span className="crumb-sep">/</span>
                  </>
                ) : (
                  <span className="crumb-current">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        </div>
        <div className="admin-topbar__right">
          {/* No placeholders: shows real path context; no fake counts */}
          <span className="admin-env-tag">Control Center</span>
        </div>
      </div>
    </header>
  );
}
