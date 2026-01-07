export const dynamic = "force-dynamic";

import React from "react";
import HealthClient from "@/components/admin/health-client";

/**
 * Admin Health page (server component wrapper)
 * Delegates all interactive logic to the client-side HealthClient.
 */
export default function AdminHealthPage() {
  return (
    <div className="px-4 py-6 md:px-6 md:py-8">
      <HealthClient />
    </div>
  );
}
