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

  // Prefer a finance/reporting permission if you have one; otherwise fall back.
  const required =
    Permissions.VIEW_REPORTS ||
    Permissions.VIEW_FINANCIALS ||
    Permissions.VIEW_ANALYTICS;

  const canView = required ? hasPermission(session.user, required) : hasPermission(session.user, Permissions.VIEW_ANALYTICS);

  if (!canView) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="mt-2 text-sm text-red-600">You don’t have permission to view financial reports.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <h1 className="text-xl font-semibold">Profit &amp; Loss</h1>
      {/* Live P&L with Refresh / CSV / PDF (unchanged logic) */}
      <PnlPanel />
    </div>
  );
}
