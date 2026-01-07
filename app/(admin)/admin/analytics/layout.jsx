// FILE: app/(admin)/admin/analytics/layout.js
// Route layout for /admin/analytics
// Purpose: premium analytics shell + consistent spacing + loads admin CSS.
// Does NOT change your page logic/components.

export const dynamic = "force-dynamic";

import "@/styles/admin.css";

const NAVY = "#0F2147";

export default function Layout({ children }) {
  return (
    <div className="admin-surface">
      <div className="admin-page-outer">
        <div className="admin-page-frame">
          {/* Premium route header (Server-safe, no client-only code) */}
          <div className="mb-6 md:mb-8">
            <div className="rounded-3xl border border-slate-200 bg-white/80 shadow-sm backdrop-blur">
              <div className="px-5 py-5 md:px-7 md:py-6">
                {/* Breadcrumb */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: NAVY }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-slate-600">Admin</span>
                  </span>
                  <span className="text-slate-300">/</span>
                  <span className="font-semibold text-slate-900">Analytics</span>
                </div>

                {/* Title + helper */}
                <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="min-w-0">
                    <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
                      Analytics
                    </h1>
                    <p className="mt-1 text-sm text-slate-600 max-w-3xl">
                      Revenue, orders, customers, performance signals and operational health —
                      organized for fast decisions.
                    </p>
                  </div>

                  {/* CTA row placeholders (pure UI; your page/client can render real controls inside children) */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
                      Live • No cache
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
                      Multi-range supported
                    </span>
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
                      Export-ready layout
                    </span>
                  </div>
                </div>

                {/* Divider */}
                <div className="mt-5 h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="relative">
            {/* Soft background accents to make charts/cards feel premium */}
            <div
              className="pointer-events-none absolute -top-10 right-0 h-48 w-48 rounded-full blur-3xl opacity-20"
              style={{ backgroundColor: NAVY }}
              aria-hidden="true"
            />
            <div className="relative">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
