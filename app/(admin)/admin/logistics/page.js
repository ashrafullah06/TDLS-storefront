// my-project/app/(admin)/admin/logistics/page.js
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import prisma from "@/lib/prisma";
import { M } from "@/lib/_mapping";

export default async function LogisticsPage() {
  const SH = M("Shipment");

  const rows = prisma[SH.model]
    ? await prisma[SH.model].findMany({
        take: 100,
        orderBy: { id: "desc" },
        select: {
          id: true,
          [SH.orderId]: true,
          [SH.carrier]: true,
          [SH.tracking]: true,
          [SH.status]: true,
        },
      })
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Logistics</h1>
      <div className="rounded border bg-white overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-left">Carrier</th>
              <th className="px-3 py-2 text-left">Tracking</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className="border-t">
                <td className="px-3 py-2">{x.id}</td>
                <td className="px-3 py-2">{x[M("Shipment").orderId]}</td>
                <td className="px-3 py-2">{x[M("Shipment").carrier]}</td>
                <td className="px-3 py-2">{x[M("Shipment").tracking] || "-"}</td>
                <td className="px-3 py-2">{x[M("Shipment").status] || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
