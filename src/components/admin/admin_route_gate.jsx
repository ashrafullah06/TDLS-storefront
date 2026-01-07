// PATH: components/admin/admin_route_gate.jsx
"use client";

import { usePathname } from "next/navigation";

export default function AdminRouteGate({ adminTree, siteTree }) {
  const pathname = usePathname();
  const p = String(pathname || "");
  const isAdmin = p === "/admin" || p.startsWith("/admin/");

  const Tree = isAdmin ? adminTree : siteTree;

  // Allow passing either:
  // 1) React node: <Layout /> or <>...</>
  // 2) Component function: LayoutComponent
  if (typeof Tree === "function") return <Tree />;

  return Tree ?? null;
}
