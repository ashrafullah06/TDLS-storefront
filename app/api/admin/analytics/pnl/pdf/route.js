// FILE: app/api/admin/analytics/pnl/pdf/route.js
import "server-only";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { computePnl } from "@/lib/analytics/pnl"; // unchanged business logic

const DAY = 24 * 60 * 60 * 1000;

function jsonNoStore(payload, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function clampInt(v, min, max, fallback) {
  const x = parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function clampGroup(g) {
  const v = String(g || "month").toLowerCase().trim();
  const allowed = new Set(["week", "month", "quarter", "half", "year", "total"]);
  return allowed.has(v) ? v : "month";
}

function isDateOnly(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

/**
 * Date parsing rules:
 * - If YYYY-MM-DD:
 *   - start => 00:00:00.000Z
 *   - end   => 23:59:59.999Z (inclusive end-of-day)
 * - Else: Date.parse()
 */
function parseDateFlex(input, fallback, { isEnd = false } = {}) {
  if (!input) return fallback;
  const raw = String(input).trim();
  if (!raw) return fallback;

  if (isDateOnly(raw)) {
    const base = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(base.getTime())) return fallback;
    if (!isEnd) return base;
    return new Date(base.getTime() + DAY - 1);
  }

  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t) : fallback;
}

function toISODate(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function fmtNumber(v, { maximumFractionDigits = 2 } = {}) {
  const num = Number(v || 0);
  const safe = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(safe);
}

function pctChange(curr, prev) {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
}

// Admin-only guard (NO dependency on customer auth/session)
async function requireAdminSignal() {
  const jar = await cookies();

  const adminRole =
    jar.get("admin_role")?.value ||
    jar.get("tdlc_admin_role")?.value ||
    jar.get("adminRole")?.value ||
    "";

  const adminSession =
    jar.get("admin_session")?.value ||
    jar.get("tdlc_admin_session")?.value ||
    jar.get("admin_sid")?.value ||
    "";

  const ok = Boolean(adminRole || adminSession);
  return { ok, role: adminRole || null };
}

/**
 * Range selection:
 * - If start/end are provided, use them
 * - Else, use days (default 30)
 * End is inclusive for user inputs; computePnl receives (start, end) as Date objects.
 */
function computeRange(search) {
  const days = clampInt(search.get("days"), 1, 365, 30);

  const endFallback = new Date();
  const startFallback = new Date(Date.now() - (days - 1) * DAY);

  const start = parseDateFlex(search.get("start"), startFallback, { isEnd: false });
  const end = parseDateFlex(search.get("end"), endFallback, { isEnd: true });

  let s = start;
  let e = end;
  if (s > e) {
    const tmp = s;
    s = e;
    e = tmp;
  }

  // Clamp span to 365 days to prevent accidental huge exports
  const spanDays = Math.max(1, Math.ceil((e.getTime() - s.getTime() + 1) / DAY));
  if (spanDays > 365) {
    e = new Date(s.getTime() + 365 * DAY - 1);
  }

  return { start: s, end: e, days: Math.max(1, Math.ceil((e.getTime() - s.getTime() + 1) / DAY)) };
}

export async function GET(req) {
  const gate = await requireAdminSignal();
  if (!gate.ok) {
    return jsonNoStore(
      {
        ok: false,
        error: "admin_auth_required",
        message: "Admin session not detected. Please sign in to the admin panel.",
      },
      401
    );
  }

  const url = new URL(req.url);
  const search = url.searchParams;

  const debug = search.get("debug") === "1";

  // Optional knobs (additive; UI can ignore)
  const compare = search.get("compare") === "1";
  const includeProducts = (search.get("products") ?? "1") !== "0";
  const topN = clampInt(search.get("topN"), 1, 100, 20);
  const disposition = String(search.get("disposition") || "inline").toLowerCase() === "attachment"
    ? "attachment"
    : "inline";

  const group = clampGroup(search.get("group") || "month");
  const { start, end, days } = computeRange(search);

  try {
    // 1) Get current window data
    const t0 = Date.now();
    const data = await computePnl({ start, end, group });
    const t1 = Date.now();

    if (!data || !data.totals || !Array.isArray(data.byPeriod)) {
      throw new Error("computePnl returned unexpected shape. Expected { totals, byPeriod[] }.");
    }

    // 2) Optional compare window (previous same-length window)
    let compareBlock = null;
    if (compare) {
      const windowMs = end.getTime() - start.getTime() + 1;
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - windowMs + 1);

      const prev = await computePnl({ start: prevStart, end: prevEnd, group });

      if (prev?.totals) {
        compareBlock = {
          range: { start: prevStart, end: prevEnd },
          totals: prev.totals,
          deltaPct: {
            revenue: pctChange(data.totals?.revenue, prev.totals?.revenue),
            cogs: pctChange(data.totals?.cogs, prev.totals?.cogs),
            profit: pctChange(data.totals?.profit, prev.totals?.profit),
            margin: pctChange(data.totals?.margin, prev.totals?.margin),
          },
        };
      }
    }

    // 3) Build PDF (lazy import)
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([842, 595]); // A4 landscape
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let x = 40,
      y = 555;

    const drawText = (txt, size = 11, bold = false, color = rgb(0, 0, 0)) => {
      page.drawText(String(txt ?? ""), { x, y, size, font: bold ? fontBold : font, color });
      y -= size + 4;
    };

    const drawRow = (cols, widths, size = 10, bold = false) => {
      let cx = x;
      for (let i = 0; i < cols.length; i++) {
        page.drawText(String(cols[i] ?? ""), {
          x: cx + 2,
          y,
          size,
          font: bold ? fontBold : font,
          color: rgb(0.1, 0.1, 0.1),
        });
        cx += widths[i];
      }
      y -= size + 6;
    };

    const line = () => {
      page.drawLine({
        start: { x, y },
        end: { x: 802, y },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
      });
      y -= 8;
    };

    const newPage = () => {
      page = pdf.addPage([842, 595]);
      x = 40;
      y = 555;
    };

    // Header
    const periodLabel = `${toISODate(start)} → ${toISODate(end)}`;
    drawText("Profit & Loss Report", 16, true);
    drawText(`Period: ${periodLabel} • Grouping: ${group.toUpperCase()} • Days: ${days}`, 11);
    drawText(`Generated for role: ${gate.role || "admin"}`, 10);
    line();

    // Totals
    drawText("Totals", 12, true);
    drawRow(["Revenue", "COGS", "Profit", "Margin %"], [150, 150, 150, 150], 11, true);
    drawRow(
      [
        fmtNumber(data.totals.revenue),
        fmtNumber(data.totals.cogs),
        fmtNumber(data.totals.profit),
        `${fmtNumber(data.totals.margin)}%`,
      ],
      [150, 150, 150, 150]
    );
    line();

    // Compare (optional)
    if (compareBlock) {
      drawText("Previous Window Comparison", 12, true);
      drawText(
        `Previous: ${toISODate(compareBlock.range.start)} → ${toISODate(compareBlock.range.end)}`,
        10
      );
      drawRow(["Metric", "Prev", "Curr", "Δ %"], [160, 120, 120, 100], 10, true);

      const prevT = compareBlock.totals || {};
      const currT = data.totals || {};
      const dp = compareBlock.deltaPct || {};

      const rows = [
        ["Revenue", fmtNumber(prevT.revenue), fmtNumber(currT.revenue), `${fmtNumber(dp.revenue)}%`],
        ["COGS", fmtNumber(prevT.cogs), fmtNumber(currT.cogs), `${fmtNumber(dp.cogs)}%`],
        ["Profit", fmtNumber(prevT.profit), fmtNumber(currT.profit), `${fmtNumber(dp.profit)}%`],
        ["Margin %", `${fmtNumber(prevT.margin)}%`, `${fmtNumber(currT.margin)}%`, `${fmtNumber(dp.margin)}%`],
      ];

      for (const r of rows) {
        if (y < 120) newPage();
        drawRow(r, [160, 120, 120, 100], 10, false);
      }
      line();
    }

    // By Period
    drawText("By Period", 12, true);
    drawRow(["Period", "Revenue", "COGS", "Profit", "Margin %"], [130, 120, 120, 120, 120], 10, true);

    for (const row of data.byPeriod) {
      if (y < 120) newPage();
      drawRow(
        [
          row.period,
          fmtNumber(row.revenue),
          fmtNumber(row.cogs),
          fmtNumber(row.profit),
          `${fmtNumber(row.margin)}%`,
        ],
        [130, 120, 120, 120, 120]
      );
    }
    line();

    // Top products (optional; uses last period if available)
    if (includeProducts) {
      const last = data.byPeriod[data.byPeriod.length - 1];
      if (last && Array.isArray(last.byProduct) && last.byProduct.length) {
        if (y < 90) newPage();
        drawText(`Top Products (Period: ${last.period})`, 12, true);
        drawRow(
          ["Product", "Units", "Revenue", "COGS", "Profit", "Margin %"],
          [180, 70, 110, 110, 110, 90],
          10,
          true
        );

        for (const p of last.byProduct.slice(0, topN)) {
          if (y < 60) newPage();
          drawRow(
            [
              p.id,
              fmtNumber(p.units, { maximumFractionDigits: 0 }),
              fmtNumber(p.revenue),
              fmtNumber(p.cogs),
              fmtNumber(p.profit),
              `${fmtNumber(p.margin)}%`,
            ],
            [180, 70, 110, 110, 110, 90]
          );
        }
        line();
      }
    }

    // Footer meta (optional perf)
    drawText(`Generated at: ${new Date().toISOString()}`, 9);
    drawText(`Compute time: ${t1 - t0} ms`, 9);

    const bytes = await pdf.save();

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="pnl_${toISODate(start)}_to_${toISODate(
          end
        )}_${group}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/admin/analytics/pnl/pdf] ERROR:", err);

    if (debug) {
      return jsonNoStore(
        {
          ok: false,
          message: String(err?.message || err),
          stack: String(err?.stack || ""),
          hint:
            "If this fails, verify computePnl() returns { totals, byPeriod[] } and that pdf-lib is installed.",
        },
        500
      );
    }

    return new NextResponse("Internal Server Error", {
      status: 500,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
