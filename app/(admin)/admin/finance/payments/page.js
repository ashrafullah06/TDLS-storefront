//app/(admin)/admin/finance/payments/page.js
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

export default async function PaymentsPage() {
  const prisma = await getPrisma();
  const PAY = M("Payment");

  const rows = await prisma[PAY.model].findMany({
    take: 100,
    orderBy: { [(PAY.createdAt || "createdAt")]: "desc" },
    select: {
      id: true,
      [PAY.orderId]: true,
      [PAY.provider]: true,
      [PAY.amount]: true,
      [PAY.status]: true,
      [(PAY.createdAt || "createdAt")]: true,
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Payments</h1>
      <div className="rounded border bg-white overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Order</th>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2">{p.id}</td>
                <td className="px-3 py-2">{p[M("Payment").orderId]}</td>
                <td className="px-3 py-2">{p[M("Payment").provider] || "-"}</td>
                <td className="px-3 py-2">
                  {Number(p[M("Payment").amount] || 0).toFixed(2)}
                </td>
                <td className="px-3 py-2">{p[M("Payment").status]}</td>
                <td className="px-3 py-2">
                  {(p[M("Payment").createdAt] || "")
                    .toString()
                    .slice(0, 19)
                    .replace("T", " ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
