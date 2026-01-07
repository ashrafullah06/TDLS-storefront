// FILE: app/(admin)/admin/analytics/loading.js
export default function Loading() {
  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-52 rounded-xl bg-slate-200 animate-pulse" />
          <div className="h-4 w-80 rounded-xl bg-slate-100 animate-pulse" />
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="h-10 w-40 rounded-full bg-slate-100 animate-pulse" />
          <div className="h-10 w-32 rounded-full bg-slate-100 animate-pulse" />
          <div className="h-10 w-32 rounded-full bg-slate-100 animate-pulse" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
            <div className="mt-3 h-8 w-44 rounded bg-slate-200 animate-pulse" />
            <div className="mt-2 h-3 w-56 rounded bg-slate-100 animate-pulse" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-52 rounded bg-slate-100 animate-pulse" />
          <div className="mt-4 h-72 rounded-xl bg-slate-100 animate-pulse" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-40 rounded bg-slate-100 animate-pulse" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="h-4 w-56 rounded bg-slate-100 animate-pulse" />
        <div className="mt-4 h-56 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    </div>
  );
}
