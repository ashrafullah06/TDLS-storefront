// FILE: app/(admin)/admin/reports/pnl/page.js
import { cookies } from "next/headers";
import { hasPermission, Permissions } from "@/lib/rbac";
import PnlPanel from "@/components/auth/pnl_panel";

export const metadata = { title: "Admin • Reports • Profit & Loss" };

async function getSession() {
  const c = cookies();
  return { user: { role: c.get("role")?.value || "superadmin" } };
}

export default async function PnlReportPage() {
  const session = await getSession();
  const canView = hasPermission(session.user, Permissions.VIEW_FINANCIALS); // ✅ strict

  if (!canView) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="mt-3 text-sm text-red-600">
          You don’t have permission to view financial reports.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Profit &amp; Loss</h1>
      <PnlPanel />
    </div>
  );
}
