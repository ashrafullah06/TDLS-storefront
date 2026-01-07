// PATH: app/(admin)/admin/settings/page.js
import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="mt-1 text-xs text-neutral-600">
            Manage roles, staff access, payment providers, and automation rules.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* RBAC roles & permissions */}
        <Link
          href="/admin/settings/rbac"
          className="group flex flex-col rounded-lg border bg-white p-4 text-sm shadow-sm hover:border-indigo-500 hover:shadow-md transition"
        >
          <div className="font-semibold text-neutral-900">
            Roles &amp; Permissions
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            Control which roles can access which admin areas and actions.
          </p>
          <span className="mt-3 text-xs font-medium text-indigo-600 group-hover:underline">
            Open RBAC settings →
          </span>
        </Link>

        {/* Staff & admin accounts */}
        <Link
          href="/admin/users"
          className="group flex flex-col rounded-lg border bg-white p-4 text-sm shadow-sm hover:border-indigo-500 hover:shadow-md transition"
        >
          <div className="font-semibold text-neutral-900">
            Staff &amp; Admin Users
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            Create or manage staff accounts and assign appropriate roles.
          </p>
          <span className="mt-3 text-xs font-medium text-indigo-600 group-hover:underline">
            Manage users →
          </span>
        </Link>

        {/* Payment providers configuration (stub link for now) */}
        <div className="flex flex-col rounded-lg border bg-white p-4 text-sm opacity-70">
          <div className="font-semibold text-neutral-900">
            Payment Providers
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            Configure SSLCommerz, bKash, Nagad, Stripe, and fees (coming soon).
          </p>
          <span className="mt-3 text-xs font-medium text-neutral-400">
            Not configured yet
          </span>
        </div>

        {/* Automation rules */}
        <div className="flex flex-col rounded-lg border bg-white p-4 text-sm opacity-70">
          <div className="font-semibold text-neutral-900">
            Automation Rules
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            Trigger workflows on events like order.paid or return.received
            (coming soon).
          </p>
          <span className="mt-3 text-xs font-medium text-neutral-400">
            Not configured yet
          </span>
        </div>

        {/* Wallet & loyalty rules */}
        <div className="flex flex-col rounded-lg border bg-white p-4 text-sm opacity-70">
          <div className="font-semibold text-neutral-900">
            Wallet &amp; Loyalty
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            Define wallet top-up rules and loyalty points (coming soon).
          </p>
          <span className="mt-3 text-xs font-medium text-neutral-400">
            Not configured yet
          </span>
        </div>
      </div>
    </div>
  );
}
