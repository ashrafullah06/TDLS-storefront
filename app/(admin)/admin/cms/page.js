// FILE: app/(admin)/admin/cms/page.js
"use client";

import { useEffect, useMemo, useState } from "react";

export default function CmsAdminPage() {
  const [perms, setPerms] = useState(null);
  const [strapi, setStrapi] = useState(null);
  const [prisma, setPrisma] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await fetch("/api/admin/session", { cache: "no-store" }).then(r => r.json());
        setPerms(s?.user?.permissions || []);
      } catch { setPerms([]); }
    })();
  }, []);
  const canManage = useMemo(() => perms?.includes("MANAGE_CMS"), [perms]);

  async function load() {
    setErr("");
    try {
      const [a, b] = await Promise.all([
        fetch("/api/cms/strapi/status", { cache: "no-store" }).then(r => r.json()),
        fetch("/api/cms/prisma/status", { cache: "no-store" }).then(r => r.json()),
      ]);
      setStrapi(a); setPrisma(b);
    } catch (e) { setErr(String(e.message || e)); }
  }
  useEffect(() => { load(); }, []);

  async function call(path, method = "POST") {
    setErr("");
    const r = await fetch(path, { method });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "action failed"); return; }
    await load();
  }

  if (perms === null) return <div className="text-sm">Checking permissions…</div>;
  if (!canManage) return <div className="rounded border bg-white p-4 text-sm text-red-600">You need MANAGE_CMS.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">CMS</h1>
          <div className="text-xs text-neutral-600 mt-1">Strapi & Prisma controls.</div>
        </div>
        <button onClick={load} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Refresh</button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded border bg-white overflow-hidden">
          <div className="p-3 border-b font-medium">Strapi</div>
          <div className="p-3 text-sm space-y-2">
            <div>Status: <b>{strapi?.status || "—"}</b></div>
            <div>Version: {strapi?.version || "—"}</div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => call("/api/cms/strapi/clear-cache")} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Clear Cache</button>
              <button onClick={() => call("/api/cms/strapi/rebuild")} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Rebuild</button>
              <button onClick={() => call("/api/cms/strapi/publish")} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Publish</button>
            </div>
          </div>
        </div>

        <div className="rounded border bg-white overflow-hidden">
          <div className="p-3 border-b font-medium">Prisma</div>
          <div className="p-3 text-sm space-y-2">
            <div>Status: <b>{prisma?.status || "—"}</b></div>
            <div>Datasource: {prisma?.db || "—"}</div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => call("/api/cms/prisma/migrate")} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Migrate</button>
              <button onClick={() => call("/api/cms/prisma/generate")} className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">Generate Client</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
