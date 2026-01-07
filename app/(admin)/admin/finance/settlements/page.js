import { getPrisma } from "@/lib/_dynamic_prisma";

export default async function SettlementsPage() {
  const prisma = await getPrisma();
  const model = prisma.settlement || prisma.settlements || null;
  const rows = model ? await model.findMany({ take: 100, orderBy: { createdAt: "desc" } }) : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settlements</h1>
      <div className="rounded border bg-white overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Provider</th>
              <th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(x => (
              <tr key={x.id} className="border-t">
                <td className="px-3 py-2">{x.id}</td>
                <td className="px-3 py-2">{x.provider || "-"}</td>
                <td className="px-3 py-2">{Number(x.amount || 0).toFixed(2)}</td>
                <td className="px-3 py-2">{x.status || "-"}</td>
                <td className="px-3 py-2">{(x.createdAt || "").toString().slice(0,19).replace("T"," ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
