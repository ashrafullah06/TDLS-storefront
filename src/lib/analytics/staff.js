// FILE: lib/analytics/staff.js
import { resolveTable, getColumns, pickCol, qIdent, qTable, n } from "./_sql";

async function runAggByActor(prisma, { table, createdCol, actorCol, start, end }) {
  const t = qTable(table);
  const qCreated = qIdent(createdCol);
  const qActor = qIdent(actorCol);

  if (!t || !qCreated || !qActor) return null;

  const sql = `
    SELECT
      ${qActor} AS actor,
      COUNT(*)::int AS actions
    FROM ${t}
    WHERE ${qCreated} >= $1 AND ${qCreated} < $2
    GROUP BY ${qActor}
    ORDER BY actions DESC
    LIMIT 50
  `;

  const rows = await prisma.$queryRawUnsafe(sql, start, end);
  return (rows || []).map((r) => ({
    actor: String(r?.actor ?? "UNKNOWN"),
    actions: n(r?.actions, 0),
  }));
}

async function runAggByType(prisma, { table, createdCol, typeCol, start, end, label = "type" }) {
  const t = qTable(table);
  const qCreated = qIdent(createdCol);
  const qType = qIdent(typeCol);

  if (!t || !qCreated || !qType) return null;

  const sql = `
    SELECT
      ${qType} AS ${label},
      COUNT(*)::int AS c
    FROM ${t}
    WHERE ${qCreated} >= $1 AND ${qCreated} < $2
    GROUP BY ${qType}
    ORDER BY c DESC
  `;

  const rows = await prisma.$queryRawUnsafe(sql, start, end);
  return (rows || []).map((r) => ({
    [label]: String(r?.[label] ?? "UNKNOWN"),
    count: n(r?.c, 0),
  }));
}

export async function computeStaffAnalytics(prisma, { start, end }) {
  const eventTable = await resolveTable(prisma, ["OrderEvent", "order_events"]);
  const auditTable = await resolveTable(prisma, ["AuditLog", "audit_logs"]);

  const out = { ok: true, orderEvents: null, audit: null, leaders: [] };

  // ---------------- Order events ----------------
  if (eventTable) {
    const cols = await getColumns(prisma, eventTable);
    const createdCol = pickCol(cols, ["createdAt", "created_at"]);
    const actorCol = pickCol(cols, ["actorId", "actor_id", "actorEmail", "actor_email", "actor"]);
    const typeCol = pickCol(cols, ["type", "eventType", "event_type", "action"]);

    try {
      const byActor = await runAggByActor(prisma, {
        table: eventTable,
        createdCol,
        actorCol,
        start,
        end,
      });

      if (byActor) {
        out.orderEvents = { table: eventTable, byActor };

        const byType = await runAggByType(prisma, {
          table: eventTable,
          createdCol,
          typeCol,
          start,
          end,
          label: "type",
        });

        if (byType) out.orderEvents.byType = byType;
      }
    } catch (e) {
      // keep best-effort behavior: don't fail whole analytics if one table is missing/mismatched
      out.orderEvents = { table: eventTable, error: "ORDER_EVENTS_QUERY_FAILED" };
    }
  }

  // ---------------- Audit logs ----------------
  if (auditTable) {
    const cols = await getColumns(prisma, auditTable);
    const createdCol = pickCol(cols, ["createdAt", "created_at"]);
    const actorCol = pickCol(cols, ["actorId", "actor_id", "actorEmail", "actor_email", "actor"]);
    const actionCol = pickCol(cols, ["action", "type"]);

    try {
      const byActor = await runAggByActor(prisma, {
        table: auditTable,
        createdCol,
        actorCol,
        start,
        end,
      });

      if (byActor) {
        out.audit = { table: auditTable, byActor };

        const byAction = await runAggByType(prisma, {
          table: auditTable,
          createdCol,
          typeCol: actionCol,
          start,
          end,
          label: "action",
        });

        if (byAction) out.audit.byAction = byAction;
      }
    } catch (e) {
      out.audit = { table: auditTable, error: "AUDIT_QUERY_FAILED" };
    }
  }

  // ---------------- Merge leaders (orderEvents + audit) ----------------
  const merged = new Map();

  function add(list = []) {
    for (const r of list || []) {
      const k = String(r?.actor ?? "UNKNOWN");
      merged.set(k, (merged.get(k) || 0) + n(r?.actions, 0));
    }
  }

  add(out.orderEvents?.byActor);
  add(out.audit?.byActor);

  out.leaders = Array.from(merged.entries())
    .map(([actor, actions]) => ({ actor, actions }))
    .sort((a, b) => b.actions - a.actions)
    .slice(0, 50);

  return out;
}
