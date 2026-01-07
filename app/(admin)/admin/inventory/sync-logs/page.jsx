// FILE: app/(admin)/admin/inventory/sync-logs/page.jsx
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/_dynamic_prisma";
import Link from "next/link";

/* ───────────────── helpers ───────────────── */

function hasInventoryAccess(user) {
  if (!user) return false;

  const bag = new Set(
    []
      .concat(user.roles || [])
      .concat(user.permissions || [])
      .concat(user.perms || [])
      .concat(user.role ? [user.role] : [])
      .map((v) => String(v || "").toUpperCase())
  );

  return (
    bag.has("ADMIN") ||
    bag.has("SUPERADMIN") ||
    bag.has("MANAGE_CATALOG") ||
    bag.has("VIEW_ANALYTICS") ||
    bag.has("MANAGE_INVENTORY")
  );
}

function formatTimestamp(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  // Compact ISO-like, easier to read: YYYY-MM-DD HH:MM
  return d.toISOString().replace("T", " ").slice(0, 16);
}

/* ───────────────── page ───────────────── */

export default async function StockSyncLogsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!hasInventoryAccess(session.user)) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-red-600">Access denied</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Your account does not have permission to view stock sync logs.
        </p>
      </div>
    );
  }

  const prisma = await getPrisma();

  const logs = await prisma.stockSyncLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100, // latest 100 runs
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Stock sync logs
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            History of Prisma → Strapi stock synchronization runs, with
            who triggered them and how many variants / size rows were updated.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-2 md:items-end">
          <Link
            href="/admin/inventory"
            className="inline-flex items-center justify-center rounded border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            ← Back to Inventory
          </Link>
        </div>
      </div>

      {/* Logs table */}
      <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
          <h2 className="text-sm font-semibold text-neutral-900">
            Recent sync runs
          </h2>
          <p className="text-[11px] text-neutral-500">
            Showing latest {logs.length} entries (max 100).
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Triggered By</th>
                <th className="px-3 py-2 text-right">Variants</th>
                <th className="px-3 py-2 text-right">Size Rows Updated</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Message / Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-xs text-neutral-500"
                  >
                    No sync logs yet. Run a stock sync from the Inventory page.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const ok = String(log.status || "").toUpperCase() === "SUCCESS";
                  return (
                    <tr
                      key={log.id}
                      className="border-t border-neutral-100 align-top"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-xs text-neutral-900">
                          {log.triggeredByEmail || "—"}
                        </div>
                        {log.triggeredByUserId && (
                          <div className="text-[10px] text-neutral-500">
                            ID: {log.triggeredByUserId}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {log.totalVariants}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {log.totalUpdated}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            ok
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {log.status || "UNKNOWN"}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-xs">
                        {log.message && (
                          <div className="text-[11px] text-neutral-800">
                            {log.message}
                          </div>
                        )}
                        {log.errorDetail && (
                          <div className="mt-1 text-[10px] text-red-600 whitespace-pre-wrap">
                            {log.errorDetail}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
