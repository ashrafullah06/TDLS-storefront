// app/(admin)/admin/dashboard/page.js
export const metadata = { title: "Admin • Dashboard" };

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-neutral-500">Today’s Orders</div>
          <div className="mt-2 text-3xl font-bold">—</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-neutral-500">Revenue (7d)</div>
          <div className="mt-2 text-3xl font-bold">—</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-sm text-neutral-500">Low Stock</div>
          <div className="mt-2 text-3xl font-bold">—</div>
        </div>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="text-lg font-medium mb-3">Quick Links</h2>
        <ul className="list-disc pl-6 space-y-2 text-sm">
          <li><a className="underline" href="/admin/analytics">Analytics</a></li>
          <li><a className="underline" href="/admin/catalog">Catalog</a></li>
          <li><a className="underline" href="/admin/orders">Orders</a></li>
          <li><a className="underline" href="/admin/customers">Customers</a></li>
          <li><a className="underline" href="/admin/returns">Returns</a></li>
          <li><a className="underline" href="/admin/settings">Settings</a></li>
        </ul>
      </section>
    </div>
  );
}
