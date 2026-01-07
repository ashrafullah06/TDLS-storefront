// FILE: app/api/audit/search/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET search with filters:
 * q, actor, role, action, resource, status, from, to, page, pageSize
 * ?format=csv streams CSV.
 */
export async function GET(req) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q") || "";
  const actor = u.searchParams.get("actor") || undefined;
  const role = u.searchParams.get("role") || undefined;
  const action = u.searchParams.get("action") || undefined;
  const resource = u.searchParams.get("resource") || undefined;
  const status = u.searchParams.get("status") || undefined;
  const from = u.searchParams.get("from") ? new Date(u.searchParams.get("from")) : undefined;
  const to = u.searchParams.get("to") ? new Date(u.searchParams.get("to")) : undefined;
  const page = Math.max(1, Number(u.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(u.searchParams.get("pageSize") || 20)));
  const skip = (page - 1) * pageSize;
  const format = (u.searchParams.get("format") || "json").toLowerCase();

  const where = {
    ...(actor ? { actorId: actor } : {}),
    ...(role ? { actorRole: role } : {}),
    ...(action ? { action } : {}),
    ...(resource ? { resourceType: resource } : {}),
    ...(status ? { status } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(q ? {
      OR: [
        { actorEmail: { contains: q, mode: "insensitive" } },
        { action: { contains: q, mode: "insensitive" } },
        { resourceId: { contains: q, mode: "insensitive" } },
        { ip: { contains: q, mode: "insensitive" } }
      ]
    } : {})
  };

  try {
    if (format === "csv") {
      const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });
      const header = "time,actor,role,action,resource,status,ip\n";
      const csv = header + rows.map(r =>
        [
          new Date(r.createdAt).toISOString(),
          JSON.stringify(r.actorEmail || r.actorId || ""),
          JSON.stringify(r.actorRole || ""),
          JSON.stringify(r.action || ""),
          JSON.stringify(`${r.resourceType||""}/${r.resourceId||""}`),
          JSON.stringify(r.status || ""),
          JSON.stringify(r.ip || "")
        ].join(",")
      ).join("\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv" } });
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: pageSize }),
      prisma.auditLog.count({ where })
    ]);
    return NextResponse.json({ items, total, page, pageSize });
  } catch (e) {
    return NextResponse.json({ error: "audit search unavailable (model missing)", detail: String(e) }, { status: 503 });
  }
}
