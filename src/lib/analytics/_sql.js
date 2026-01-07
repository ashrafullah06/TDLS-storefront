// FILE: lib/analytics/_sql.js
import { Prisma } from "@prisma/client";

/**
 * This module avoids compile-time Prisma-field coupling by:
 * - Discovering tables/columns via information_schema
 * - Running raw SQL against discovered identifiers
 *
 * Result: analytics won't break if some optional models don't exist.
 */

const SCHEMA = "public";

export function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export function clampInt(v, min, max, fallback) {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

export function parseDate(s, fallback) {
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

export async function tableExists(prisma, tableName) {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = ${SCHEMA}
        AND table_name = ${tableName}
      LIMIT 1
    `
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function resolveTable(prisma, candidates = []) {
  for (const t of candidates) {
    // try as-is
    if (await tableExists(prisma, t)) return t;
  }
  return null;
}

export async function getColumns(prisma, tableName) {
  if (!tableName) return new Set();
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${SCHEMA}
        AND table_name = ${tableName}
    `
  );
  const s = new Set();
  for (const r of rows || []) {
    if (r?.column_name) s.add(String(r.column_name));
  }
  return s;
}

export function pickCol(cols, names = []) {
  for (const name of names) {
    if (cols.has(name)) return name;
  }
  return null;
}

export function qIdent(name) {
  // Safe quoted identifier for dynamic SQL
  // Only allow typical identifier chars to prevent injection.
  const s = String(name || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return null;
  return `"${s}"`;
}

export function qTable(tableName) {
  const t = qIdent(tableName);
  if (!t) return null;
  return `${qIdent(SCHEMA).replace(/"/g, '"')}.${t}`.replace(`"${SCHEMA}".`, `"${SCHEMA}".`);
}

/**
 * Build a WHERE clause for common filter keys without breaking.
 * Filters are applied only if the corresponding column exists.
 */
export function buildOrderWhereSQL({ cols, filters = {} }) {
  const parts = [];
  const params = [];

  const statusCol = pickCol(cols, ["status", "orderStatus"]);
  const payCol = pickCol(cols, ["paymentStatus", "payment_status"]);
  const provCol = pickCol(cols, ["paymentProvider", "provider", "payment_provider"]);
  const audCol = pickCol(cols, ["audience", "audienceKey", "audience_key"]);
  const chanCol = pickCol(cols, ["channel", "orderChannel", "order_channel"]);

  function addEq(colName, value) {
    if (!colName) return;
    if (value == null || value === "") return;
    const id = qIdent(colName);
    if (!id) return;
    params.push(String(value));
    parts.push(`${id} = $${params.length}`);
  }

  addEq(statusCol, filters.status);
  addEq(payCol, filters.paymentStatus);
  addEq(provCol, filters.provider);
  addEq(audCol, filters.audience);
  addEq(chanCol, filters.channel);

  return { whereSQL: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}

export function isPaidSQL(paymentStatusExpr) {
  // Normalize "paid" concept
  return `UPPER(COALESCE(${paymentStatusExpr}, '')) IN ('PAID','SETTLED')`;
}
