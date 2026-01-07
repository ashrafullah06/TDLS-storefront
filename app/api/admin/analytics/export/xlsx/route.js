// FILE: app/api/admin/analytics/export/xlsx/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { buildAdminAnalyticsBundle } from "../../bundle";

function clampDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 30;
  return Math.max(7, Math.min(365, Math.round(x)));
}

function safeSheetName(name) {
  const s = String(name || "Sheet")
    .replace(/[\[\]\:\*\?\/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, 31) || "Sheet";
}

function toStr(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function asNumber(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function flattenObject(obj, { prefix = "", out = [] } = {}) {
  const o = obj && typeof obj === "object" ? obj : null;
  if (!o) return out;

  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;

    if (v == null) {
      out.push([key, ""]);
      continue;
    }

    if (Array.isArray(v)) {
      out.push([key, `Array(${v.length})`]);
      continue;
    }

    if (v instanceof Date) {
      out.push([key, v.toISOString()]);
      continue;
    }

    if (typeof v === "object") {
      flattenObject(v, { prefix: key, out });
      continue;
    }

    out.push([key, String(v)]);
  }

  return out;
}

function guessRowsForModule(key, mod) {
  const candidates = [
    "rows",
    "items",
    "series",
    "timeline",
    "bestSellers",
    "trending",
    "topCustomers",
    "byPurpose",
    "reasons",
    "lowStock",
    "leaders",
    "lines",
    "breakdown",
  ];

  for (const c of candidates) {
    if (Array.isArray(mod?.[c]) && mod[c].length) {
      const arr = mod[c];

      // Array of primitives → single column
      if (arr.every((x) => x == null || typeof x !== "object")) {
        return [["Value"], ...arr.map((x) => [toStr(x)])];
      }

      // Array of objects → header from union keys (bounded)
      const keys = new Set();
      for (const row of arr.slice(0, 500)) {
        if (row && typeof row === "object") {
          Object.keys(row).forEach((k) => keys.add(k));
        }
      }
      const header = Array.from(keys);
      const body = arr
        .slice(0, 500)
        .map((row) => header.map((h) => toStr(row?.[h])));
      return [header, ...body];
    }
  }

  // Fall back: try flattening known blocks first
  const blocks = [];
  if (mod?.kpis && typeof mod.kpis === "object") blocks.push(["kpis", mod.kpis]);
  if (mod?.totals && typeof mod.totals === "object")
    blocks.push(["totals", mod.totals]);
  if (mod?.summary && typeof mod.summary === "object")
    blocks.push(["summary", mod.summary]);

  if (blocks.length) {
    const rows = [["Key", "Value"]];
    for (const [label, obj] of blocks) {
      rows.push([label, ""]);
      rows.push(...flattenObject(obj).map(([k, v]) => [k, v]));
      rows.push(["", ""]);
    }
    return rows;
  }

  // Absolute fall back: JSON string
  return [
    ["Key", "Value"],
    ["module", key],
    ["payload", toStr(mod)],
  ];
}

function buildMetaRows(meta) {
  const rows = [["Key", "Value"]];
  rows.push(["range.days", toStr(meta?.range?.days)]);
  rows.push(["range.sinceISO", toStr(meta?.range?.sinceISO)]);
  rows.push(["range.untilExclusiveISO", toStr(meta?.range?.untilExclusiveISO)]);
  rows.push(["range.group", toStr(meta?.range?.group)]);
  rows.push(["range.include", toStr(meta?.range?.include)]);
  rows.push(["dbCoverage", toStr(meta?.dbCoverage)]);
  rows.push(["generatedAt", toStr(meta?.generatedAt)]);
  return rows;
}

function buildSummaryRows(bundle) {
  const rows = [["Key", "Value"]];
  rows.push(["ok", toStr(bundle?.ok)]);
  rows.push(["modules.count", toStr(Object.keys(bundle?.data || {}).length)]);
  if (bundle?.apiSummary?.exports) {
    rows.push(["exports.pdf", toStr(bundle.apiSummary.exports.pdf)]);
    rows.push(["exports.xlsx", toStr(bundle.apiSummary.exports.xlsx)]);
    rows.push(["exports.docx", toStr(bundle.apiSummary.exports.docx)]);
  }
  return rows;
}

function toExcelXmlWorkbook(sheets) {
  // Excel 2003 XML (SpreadsheetML) with multiple worksheets.
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const xmlSheets = (sheets || [])
    .map(({ name, rows }) => {
      const xmlRows = (rows || [])
        .map((r) => {
          const cells = (r || [])
            .map((c) => `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`)
            .join("");
          return `<Row>${cells}</Row>`;
        })
        .join("");

      return `
 <Worksheet ss:Name="${esc(safeSheetName(name))}">
  <Table>
   ${xmlRows}
  </Table>
 </Worksheet>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${xmlSheets}
</Workbook>`;
}

export async function GET(req) {
  // RBAC gate
  try {
    await requireAdmin(req, { permission: Permissions.VIEW_ANALYTICS });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return NextResponse.json(
      { ok: false, error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED" },
      { status }
    );
  }

  const url = new URL(req.url);
  const sp = url.searchParams;

  // Default export behavior: include everything for parity with your plan
  if (!sp.get("include")) sp.set("include", "all");

  // Keep days sane if provided
  if (sp.get("days")) sp.set("days", String(clampDays(sp.get("days"))));

  // Build bundle (real DB-backed computations)
  const bundle = await buildAdminAnalyticsBundle(url.toString());
  if (!bundle?.ok) {
    return NextResponse.json(
      { ok: false, error: "BUNDLE_FAILED", details: bundle || null },
      { status: 500 }
    );
  }

  const meta = bundle.meta || {};
  const data = bundle.data || {};

  // Build sheets
  const sheets = [];
  sheets.push({ name: "Meta", rows: buildMetaRows(meta) });
  sheets.push({ name: "Summary", rows: buildSummaryRows(bundle) });

  // One sheet per module key in bundle.data
  for (const [key, mod] of Object.entries(data)) {
    const title = key.charAt(0).toUpperCase() + key.slice(1);
    sheets.push({ name: title, rows: guessRowsForModule(key, mod) });
  }

  // Optional: add an Errors sheet if any module failed
  const failures = Object.entries(data)
    .filter(([, mod]) => mod && typeof mod === "object" && mod.ok === false)
    .map(([k, mod]) => [k, toStr(mod.error), toStr(mod.message)]);
  if (failures.length) {
    sheets.push({
      name: "Errors",
      rows: [["Module", "Error", "Message"], ...failures],
    });
  }

  const days = asNumber(meta?.range?.days, asNumber(sp.get("days"), 30));
  const fname = `tdlc_analytics_${days}d.xlsx`;

  // Try strict XLSX first
  try {
    const xlsx = await import("xlsx");
    const wb = xlsx.utils.book_new();

    for (const sh of sheets) {
      const aoa = (sh.rows || []).map((r) => (r || []).map((c) => toStr(c)));
      const ws = xlsx.utils.aoa_to_sheet(aoa);
      xlsx.utils.book_append_sheet(wb, ws, safeSheetName(sh.name));
    }

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fname}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    // Fallback: SpreadsheetML (still opens in Excel)
    const xml = toExcelXmlWorkbook(sheets);
    const fallbackName = `tdlc_analytics_${days}d.xls`;

    return new NextResponse(xml, {
      status: 200,
      headers: {
        "content-type": "application/vnd.ms-excel; charset=utf-8",
        "content-disposition": `attachment; filename="${fallbackName}"`,
        "cache-control": "no-store",
      },
    });
  }
}
