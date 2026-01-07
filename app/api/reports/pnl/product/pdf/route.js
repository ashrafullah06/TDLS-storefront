// my-project/app/api/reports/pnl/product/pdf/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { computeProductPnl } from "@/lib/analytics/pnl";

const INCH = 72;
const M = { top: 1 * INCH, bottom: 1 * INCH, left: 0.5 * INCH, right: 0.5 * INCH }; // strict empty margins
const W = 595,
  H = 842; // A4 pt
const CW = W - M.left - M.right;

const bdMoney = (n) =>
  new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", currencyDisplay: "code", maximumFractionDigits: 2 }).format(Number(n || 0));

const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const clampGroup = (g) => {
  const v = String(g || "month").toLowerCase();
  return ["day", "week", "month", "quarter", "half", "year", "all"].includes(v) ? v : "month";
};
function parseIsoDateSafe(s, fallback) {
  if (!s) return fallback;
  const m = decodeURIComponent(String(s)).match(/\d{4}-\d{2}-\d{2}/);
  if (!m) return fallback;
  const d = new Date(m[0] + "T00:00:00");
  return Number.isNaN(d.getTime()) ? fallback : d;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function titleOf(g) {
  if (g === "day") return "Daily";
  if (g === "week") return "Weekly";
  if (g === "month") return "Monthly";
  if (g === "quarter") return "Quarterly";
  if (g === "half") return "Half-Yearly";
  if (g === "year") return "Yearly";
  if (g === "all") return "Total";
  return g.charAt(0).toUpperCase() + g.slice(1);
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const group = clampGroup(searchParams.get("group"));
    const start = parseIsoDateSafe(searchParams.get("start"), new Date(Date.now() - 30 * 86400000));
    const end = endOfDay(parseIsoDateSafe(searchParams.get("end"), new Date()));

    const filter = {};
    const sku = searchParams.get("sku");
    const productId = searchParams.get("productId");
    const variantId = searchParams.get("variantId");
    if (productId) filter.productId = productId;
    if (sku) filter.sku = sku;
    if (variantId) filter.variantId = variantId;

    const label = sku || productId || variantId || "All Products";

    // Build blocks
    const blocks = [];
    if (group === "all") {
      for (const g of ["day", "week", "month", "quarter", "half", "year"]) {
        const r = await computeProductPnl({
          startISO: isoDate(start),
          endISO: isoDate(end),
          group: g,
          ...filter,
        });
        blocks.push([titleOf(g), r]);
      }
      const total = await computeProductPnl({
        startISO: isoDate(start),
        endISO: isoDate(end),
        group: "month",
        ...filter,
      });
      blocks.push(["Total", total]);
    } else {
      const r = await computeProductPnl({
        startISO: isoDate(start),
        endISO: isoDate(end),
        group,
        ...filter,
      });
      blocks.push([titleOf(group), r]);
    }

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const navy = rgb(11 / 255, 27 / 255, 57 / 255);
    const gold = rgb(200 / 255, 168 / 255, 80 / 255);
    const ink = rgb(0, 0, 0);
    const faint = rgb(0.95, 0.96, 0.985);
    const zebra = rgb(0.985, 0.985, 0.99);
    const grid = rgb(0.78, 0.8, 0.84);

    let page = addPage();
    let y = H - M.top; // start below top margin
    const x0 = M.left,
      x1 = W - M.right;

    function addPage() {
      return pdf.addPage([W, H]); // margins left empty per spec
    }
    function need(h = 80) {
      if (y - h < M.bottom) {
        page = addPage();
        y = H - M.top;
      }
    }
    function title(text) {
      need(48);
      page.drawRectangle({ x: x0, y: y - 18, width: 4, height: 14, color: gold });
      page.drawText(text, { x: x0 + 10, y: y - 16, size: 13.5, font: helvB, color: navy });
      y -= 28;
      page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.5, color: grid });
      y -= 10;
    }
    function text(line, size = 10, bold = false, color = ink) {
      page.drawText(String(line), { x: x0, y, size, font: bold ? helvB : helv, color });
      y -= size + 6;
    }
    function head(cols, widths) {
      need(30);
      page.drawRectangle({ x: x0, y: y - 2, width: CW, height: 16, color: faint });
      let cx = x0;
      for (let i = 0; i < cols.length; i++) {
        page.drawText(String(cols[i]), { x: cx + 3, y, size: 10, font: helvB, color: navy });
        cx += widths[i];
      }
      y -= 18;
    }
    function row(cols, widths, odd = false) {
      need(20);
      if (odd) page.drawRectangle({ x: x0, y: y - 2, width: CW, height: 14, color: zebra });
      let cx = x0;
      for (let i = 0; i < cols.length; i++) {
        page.drawText(String(cols[i] ?? ""), { x: cx + 3, y, size: 9.5, font: helv, color: ink });
        cx += widths[i];
      }
      y -= 16;
    }

    // Header (inside content box; keep margins empty)
    text("THE DNA LAB CLOTHING (TDLC)", 11, true, navy);
    page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 2, color: gold });
    y -= 10;
    text(`Product: ${label}`, 10);
    text(`Range: ${isoDate(start)} to ${isoDate(end)}`, 10);
    y -= 6;

    const widths = [
      CW * 0.18, // Period
      CW * 0.12, // Rev incl VAT
      CW * 0.09, // VAT
      CW * 0.12, // Net Sales
      CW * 0.06, // Units
      CW * 0.10, // COGS
      CW * 0.10, // Gross
      CW * 0.10, // Ship Subsidy
      CW * 0.08, // Reship
      CW * 0.08, // Fees
      CW * 0.09, // Overhead
      CW * 0.10, // Net
    ];

    for (const [section, block] of blocks) {
      title(section);

      head(["Totals", "Rev (incl VAT)", "VAT", "Net Sales", "Units", "COGS", "Gross", "Ship Subsidy", "Reship", "Fees", "Overhead", "Net"], widths);
      const gross = (block.totals.netSalesExVat || 0) - (block.totals.cogs || 0);
      row(
        [
          "",
          bdMoney(block.totals.revenueInclVat),
          bdMoney(block.totals.vatCollected),
          bdMoney(block.totals.netSalesExVat),
          String(block.totals.units || 0),
          bdMoney(block.totals.cogs),
          bdMoney(gross),
          bdMoney(block.totals.shippingSubsidy),
          bdMoney(block.totals.reshipCost),
          bdMoney(block.totals.paymentFees),
          bdMoney(block.totals.overheadAllocated),
          bdMoney(block.totals.netProfit),
        ],
        widths
      );

      y -= 6;
      head(["Period", "Rev (incl VAT)", "VAT", "Net Sales", "Units", "COGS", "Gross", "Ship Subsidy", "Reship", "Fees", "Overhead", "Net"], widths);
      (block.rows || []).forEach((r, i) => {
        const g = (r.netSalesExVat || 0) - (r.cogs || 0);
        row(
          [
            r.label,
            bdMoney(r.revenueInclVat),
            bdMoney(r.vatCollected),
            bdMoney(r.netSalesExVat),
            String(r.units || 0),
            bdMoney(r.cogs),
            bdMoney(g),
            bdMoney(r.shippingSubsidy),
            bdMoney(r.reshipCost),
            bdMoney(r.paymentFees),
            bdMoney(r.overheadAllocated),
            bdMoney(r.netProfit),
          ],
          widths,
          i % 2 === 1
        );
      });

      y -= 12;
    }

    const bytes = await pdf.save();
    const fname = (sku || productId || variantId || "all").toString().replace(/[^a-z0-9_-]/gi, "");
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="tdlc_product_pnl_${fname}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[product-pdf] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to generate PDF. Check query params and server logs.",
        hint:
          'Example: /api/reports/pnl/product/pdf?sku=TDLC-TS-PRM-NAVY-S&group=all&start=2025-01-01&end=2025-12-31',
        message: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}
