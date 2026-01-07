// FILE: app/api/admin/analytics/export/pdf/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildAdminAnalyticsBundle } from "../../bundle";

const DAY = 24 * 60 * 60 * 1000;

function clampDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 30;
  return Math.max(7, Math.min(365, Math.round(x)));
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseInclude(searchParams) {
  const raw = String(searchParams.get("include") || "").trim();
  if (!raw) return "all";
  return raw;
}

function safeNum(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function fmtBDT(v) {
  const x = safeNum(v, 0);
  return x.toLocaleString("en-BD", { maximumFractionDigits: 2 });
}

function shortISO(iso) {
  try {
    return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return String(iso || "");
  }
}

export async function GET(req) {
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
  const { searchParams } = url;

  const days = clampDays(searchParams.get("days") ?? 30);
  const start = parseDate(searchParams.get("start"));
  const end = parseDate(searchParams.get("end"));

  const now = new Date();
  const since = start || new Date(now.getTime() - (days - 1) * DAY);
  const untilExclusive = end || new Date(since.getTime() + days * DAY);

  const bundleUrl = new URL(req.url);
  bundleUrl.searchParams.set("start", since.toISOString());
  bundleUrl.searchParams.set("end", untilExclusive.toISOString());
  bundleUrl.searchParams.set("include", parseInclude(searchParams));

  const expanded = await buildAdminAnalyticsBundle(bundleUrl.toString());
  const meta = expanded?.meta || {};
  const data = expanded?.data || {};

  const ovBlock = data?.overview?.ok === false ? null : data?.overview;
  const ov = ovBlock?.kpis || ovBlock?.totals || ovBlock?.summary || {};
  const orders = data?.orders?.ok === false ? null : data?.orders;
  const products = data?.products?.ok === false ? null : data?.products;
  const customers = data?.customers?.ok === false ? null : data?.customers;
  const otp = data?.otp?.ok === false ? null : data?.otp;
  const returns = data?.returns?.ok === false ? null : data?.returns;
  const inventory = data?.inventory?.ok === false ? null : data?.inventory;
  const staff = data?.staff?.ok === false ? null : data?.staff;
  const pnl = data?.pnl?.ok === false ? null : data?.pnl;
  const profit = data?.profit?.ok === false ? null : data?.profit;
  const projections = data?.projections?.ok === false ? null : data?.projections;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageSize = [595.28, 841.89]; // A4
  let page = pdf.addPage(pageSize);
  let y = 800;
  const left = 40;

  const newPage = () => {
    page = pdf.addPage(pageSize);
    y = 800;
  };

  const line = (txt, { b = false, size = 11, gap = 14 } = {}) => {
    if (y < 60) newPage();
    page.drawText(String(txt ?? ""), { x: left, y, size, font: b ? bold : font });
    y -= gap;
  };

  line("TDLC Admin Analytics Report", { b: true, size: 16, gap: 18 });
  line(
    `Range: ${shortISO(meta?.range?.sinceISO || since.toISOString())} → ${shortISO(
      meta?.range?.untilExclusiveISO || untilExclusive.toISOString()
    )}`,
    { size: 10 }
  );
  line(`Include: ${String(meta?.range?.include || bundleUrl.searchParams.get("include") || "all")}`, {
    size: 10,
  });
  line(" ", { gap: 10 });

  line("Headline KPIs", { b: true, gap: 16 });
  line(`Orders: ${ov?.ordersCount ?? orders?.totals?.orders ?? "—"}`);
  line(`Revenue (Paid, BDT): ${fmtBDT(ov?.revenuePaid ?? orders?.totals?.revenuePaid ?? 0)}`);
  line(`Paid Orders: ${ov?.paidOrdersCount ?? orders?.totals?.paidOrders ?? "—"}`);
  line(`AOV (Paid): ${fmtBDT(ov?.aovPaid ?? orders?.totals?.aovPaid ?? 0)}`);
  line(" ", { gap: 10 });

  if (products) {
    line("Products", { b: true, gap: 16 });
    const best = products?.bestSellers || products?.best_sellers || [];
    line("Best-selling (Top 10)", { b: true, size: 12, gap: 16 });
    best.slice(0, 10).forEach((p, idx) => {
      line(
        `${idx + 1}. ${p.name || p.title || p.sku || "—"} — units: ${p.units ?? p.qty ?? "—"}, rev: ${fmtBDT(
          p.revenue ?? p.rev ?? 0
        )}`,
        { size: 10, gap: 12 }
      );
    });
    line(" ", { gap: 10 });
  }

  if (returns) {
    line("Returns / Exchanges / Refunds", { b: true, gap: 16 });
    line(`Returns: ${returns?.totals?.returns ?? "—"}`);
    line(`Exchanges: ${returns?.totals?.exchanges ?? "—"}`);
    line(`Refunds: ${returns?.totals?.refunds ?? "—"}`);
    line(`Return rate: ${returns?.totals?.returnRate ?? "—"}%`);
    const topReturned = returns?.topReturnedVariants || [];
    if (topReturned.length) {
      line("Top returned variants (Top 10)", { b: true, size: 12, gap: 16 });
      topReturned.slice(0, 10).forEach((v, idx) => {
        line(`${idx + 1}. ${v.sku || v.title || v.variantId} — qty: ${v.qtyReturned ?? 0}`, {
          size: 10,
          gap: 12,
        });
      });
    }
    line(" ", { gap: 10 });
  }

  if (otp) {
    line("OTP", { b: true, gap: 16 });
    line(`Total OTPs: ${otp?.totals?.count ?? otp?.total ?? "—"}`);
    line(`Success rate: ${otp?.totals?.successRate ?? otp?.successRate ?? "—"}%`);
    line(" ", { gap: 10 });
  }

  if (inventory) {
    line("Inventory", { b: true, gap: 16 });
    line(`On-hand: ${inventory?.totals?.onHand ?? inventory?.summary?.onHand ?? "—"}`);
    line(`Reserved: ${inventory?.totals?.reserved ?? inventory?.summary?.reserved ?? "—"}`);
    line(`Safety: ${inventory?.totals?.safety ?? inventory?.summary?.safety ?? "—"}`);
    const low = inventory?.top_low_stock || inventory?.lowStock || [];
    if (low.length) {
      line("Low stock variants (Top 10)", { b: true, size: 12, gap: 16 });
      low.slice(0, 10).forEach((v, idx) => {
        line(
          `${idx + 1}. ${v.sku || v.variantId || "—"} — onHand: ${v.onHand ?? v.on_hand ?? 0}, safety: ${
            v.safetyStock ?? v.safety_stock ?? 0
          }`,
          { size: 10, gap: 12 }
        );
      });
    }
    line(" ", { gap: 10 });
  }

  if (customers) {
    line("Customers", { b: true, gap: 16 });
    line(`Total customers: ${customers?.totals?.customers ?? customers?.total ?? "—"}`);
    line(`New customers (window): ${customers?.totals?.newCustomers ?? customers?.recent ?? "—"}`);
    line(" ", { gap: 10 });
  }

  if (staff) {
    line("Staff", { b: true, gap: 16 });
    const leaders = staff?.leaders || staff?.topStaff || [];
    if (leaders.length) {
      leaders.slice(0, 10).forEach((s, idx) => {
        line(`${idx + 1}. ${s.name || s.staffId || "—"} — actions: ${s.actions ?? s.count ?? "—"}`, {
          size: 10,
          gap: 12,
        });
      });
    } else {
      line("No staff aggregation available in this window.", { size: 10 });
    }
    line(" ", { gap: 10 });
  }

  if (pnl) {
    line("P&L", { b: true, gap: 16 });
    const rows = pnl?.rows || pnl?.series || [];
    rows.slice(0, 15).forEach((r) => {
      const k = r.key || r.period || r.group || "—";
      line(
        `${k} — rev: ${fmtBDT(r.revenue ?? r.sales ?? 0)}, cost: ${fmtBDT(r.cost ?? r.cogs ?? 0)}, profit: ${fmtBDT(
          r.profit ?? r.grossProfit ?? 0
        )}`,
        { size: 10, gap: 12 }
      );
    });
    line(" ", { gap: 10 });
  }

  if (profit) {
    line("Profit by Product/Variant/Batch", { b: true, gap: 16 });
    const rows = profit?.rows || profit?.items || [];
    rows.slice(0, 15).forEach((r, idx) => {
      line(
        `${idx + 1}. ${r.key || r.sku || r.variantId || r.productId || "—"} — rev: ${fmtBDT(r.revenue ?? 0)}, cost: ${fmtBDT(
          r.cost ?? 0
        )}, profit: ${fmtBDT(r.profit ?? 0)}`,
        { size: 10, gap: 12 }
      );
    });
    line(" ", { gap: 10 });
  }

  if (projections) {
    line("Projections", { b: true, gap: 16 });
    const next = projections?.monthly?.projection?.next || [];
    if (next.length) {
      line("Next 12 months revenue projection (BDT):", { size: 10 });
      next.slice(0, 12).forEach((v, idx) => line(`${idx + 1}. ${fmtBDT(v)}`, { size: 10, gap: 12 }));
    } else {
      line("No projections computed for this window.", { size: 10 });
    }
    line(" ", { gap: 10 });
  }

  const bytes = await pdf.save();

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="tdlc_analytics_${days}d.pdf"`,
      "cache-control": "no-store",
    },
  });
}
