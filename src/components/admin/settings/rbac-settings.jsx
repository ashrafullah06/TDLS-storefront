// FILE: src/components/admin/settings/rbac-settings.jsx
"use client";

import React from "react";
import RbacPanel from "./rbac-panel";

const NAVY = "#0F2147";

export default function RbacSettings() {
  return (
    <div className="mx-auto max-w-6xl px-4 lg:px-6 py-6">
      {/* Header + context */}
      <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            RBAC roles &amp; permissions
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Configure which admin roles (superadmin, admin, manager, finance,
            analyst, staff, etc.) can access each sensitive capability in the
            TDLC Control Center. Changes here are applied immediately to{" "}
            <span className="font-semibold">requireAdmin()</span> checks.
          </p>
        </div>

        {/* Status chip group */}
        <div className="flex flex-col items-start gap-2 text-xs md:items-end">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="font-semibold">RBAC Matrix Online</span>
          </div>
          <div className="text-[11px] text-slate-500">
            All admin features are guarded by this matrix, including settings,
            inventory, refunds and P&amp;L.
          </div>
        </div>
      </header>

      {/* Main card */}
      <div
        className="rounded-3xl border border-slate-200 bg-white/80 shadow-[0_18px_55px_rgba(15,33,71,0.08)] backdrop-blur-sm"
        style={{
          boxShadow:
            "0 18px 45px rgba(15, 33, 71, 0.10), 0 0 0 1px rgba(148, 163, 184, 0.18)",
        }}
      >
        <div className="border-b border-slate-100 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <div className="space-y-0.5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-700">
                ACCESS CONTROL CONSOLE
              </h2>
              <p className="text-xs text-slate-500">
                Toggle permissions per role in real time. Superadmin always
                retains full access.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              Changes are applied to all admin sessions on next permission
              check.
            </div>
          </div>
        </div>

        <div className="px-4 py-4 sm:px-6 sm:py-5">
          {/* Inner panel (matrix, filters, actions…) */}
          <RbacPanel />
        </div>
      </div>
    </div>
  );
}
