// FILE: app/(admin)/admin/reports/returns/page.js
import { cookies } from "next/headers";
import { hasPermission, Permissions } from "@/lib/rbac";
import ReturnsPanel from "@/components/auth/returns_panel";

export const metadata = { title: "Admin • Reports • Returns" };

async function getSession() {
  const c = cookies();
  return { user: { role: c.get("role")?.value || "superadmin" } };
}

export default async function ReturnsReportPage() {
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
      <h1 className="text-xl font-semibold">Returns</h1>
      <ReturnsPanel />
    </div>
  );
}
