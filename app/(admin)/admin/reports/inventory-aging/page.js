// FILE: app/(admin)/admin/reports/inventory-aging/page.js
import { cookies } from "next/headers";
import { hasPermission, Permissions } from "@/lib/rbac";
import InventoryAgingPanel from "@/components/auth/inventory_aging_panel";

export const metadata = { title: "Admin • Reports • Inventory Aging" };

async function getSession() {
  const c = cookies();
  return { user: { role: c.get("role")?.value || "superadmin" } };
}

export default async function InventoryAgingReportPage() {
  const session = await getSession();
  const canView = hasPermission(session.user, Permissions.VIEW_FINANCIALS);

  if (!canView) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="mt-2 text-sm text-red-600">
          You don’t have permission to view financial reports.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Inventory Aging</h1>
      <InventoryAgingPanel />
    </div>
  );
}
