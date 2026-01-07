// FILE: src/components/route-flagger.jsx
"use client";

import { usePathname } from "next/navigation";

/**
 * Adds a .route-home wrapper when pathname === "/".
 * CSS uses this to disable the global border only on the homepage.
 */
export default function RouteFlagger({ children }) {
  const pathname = usePathname();
  const isHome =
    pathname === "/" || pathname === "" || pathname === "/home";

  return (
    <div className={isHome ? "route-home" : "route-page"}>
      {children}
    </div>
  );
}
