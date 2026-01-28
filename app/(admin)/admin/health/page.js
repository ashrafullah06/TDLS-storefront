//app/(admin)/admin/health/page.jsx
export const dynamic = "force-dynamic";

import React from "react";
import HealthClient from "@/components/admin/health-client";

export const metadata = {
  title: "Admin • Health",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      nocache: true,
    },
  },
};

/**
 * Admin Health page (server component wrapper)
 * Route: /admin/health
 */
export default function AdminHealthPage() {
  return (
    <div className="px-4 py-6 md:px-6 md:py-8">
      <HealthClient />
    </div>
  );
}
