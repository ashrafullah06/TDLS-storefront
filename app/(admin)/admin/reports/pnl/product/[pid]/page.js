// FILE: app/(admin)/admin/reports/pnl/product/[pid]/page.js
import { cookies } from "next/headers";
import { hasPermission, Permissions } from "@/lib/rbac";
import ProductPnlPanel from "@/components/auth/product_pnl_panel";

export const metadata = { title: "Admin • Reports • Product P&L" };

async function getSession() {
  const c = cookies();
  return { user: { role: c.get("role")?.value || "superadmin" } };
}

export default async function ProductPnlPage({ params, searchParams }) {
  const session = await getSession();
  const canView = hasPermission(session.user, Permissions.VIEW_FINANCIALS);

  if (!canView) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="mt-3 text-sm text-red-600">You don’t have permission to view financial reports.</p>
      </div>
    );
  }

  const pid = decodeURIComponent(params.pid);
  const kind = (searchParams?.kind || "").toLowerCase(); // 'product' | 'sku' | 'variant'
  const start = searchParams?.start || "";
  const end = searchParams?.end || "";
  const group = searchParams?.group || "month";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Product Profit &amp; Loss</h1>
        <p className="mt-2 text-sm text-gray-500">
          TDLC finance dashboard — export branded PDFs and inspect live P&amp;L by period.
        </p>
      </div>
      <ProductPnlPanel pid={pid} kind={kind} start={start} end={end} initialGroup={group} />
    </div>
  );
}
