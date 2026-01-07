// FILE: app/api/admin/analytics/export/docx/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
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

/**
 * Optional dependency loader for "docx".
 * Important: avoids static `import("docx")` so bundlers don't fail the build
 * when the package isn't installed. If not present, returns null and we use
 * the .doc (HTML) fallback.
 */
async function loadDocxOptional() {
  try {
    const mod = await import("node:module");
    const createRequire = mod?.createRequire;
    if (typeof createRequire !== "function") return null;

    const require = createRequire(import.meta.url);
    const docx = require("docx");
    return docx || null;
  } catch {
    return null;
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

  // Build bundle URL pinned to this same window
  const bundleUrl = new URL(req.url);
  bundleUrl.searchParams.set("start", since.toISOString());
  bundleUrl.searchParams.set("end", untilExclusive.toISOString());
  bundleUrl.searchParams.set("include", parseInclude(searchParams));

  const expanded = await buildAdminAnalyticsBundle(bundleUrl.toString());
  const meta = expanded?.meta || {};
  const data = expanded?.data || {};

  const ov =
    data?.overview?.ok === false
      ? null
      : data?.overview?.kpis ||
        data?.overview?.totals ||
        data?.overview?.summary ||
        null;

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

  // Try real DOCX if package exists (runtime-only optional)
  try {
    const docx = await loadDocxOptional();
    if (!docx) throw new Error("docx not installed");

    const { Document, Packer, Paragraph, HeadingLevel, TextRun } = docx;

    const lines = [];
    const H1 = (t) =>
      lines.push(new Paragraph({ text: t, heading: HeadingLevel.HEADING_1 }));
    const H2 = (t) =>
      lines.push(new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 }));
    const P = (t) => lines.push(new Paragraph(String(t || "")));
    const KV = (k, v) =>
      lines.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${k}: `, bold: true }),
            new TextRun({ text: String(v ?? "—") }),
          ],
        })
      );

    lines.push(
      new Paragraph({
        text: "TDLC Admin Analytics Report",
        heading: HeadingLevel.TITLE,
      })
    );
    P(
      `Range: ${shortISO(
        meta?.range?.sinceISO || since.toISOString()
      )} → ${shortISO(
        meta?.range?.untilExclusiveISO || untilExclusive.toISOString()
      )}`
    );
    P(
      `Include: ${String(
        meta?.range?.include ||
          bundleUrl.searchParams.get("include") ||
          "all"
      )}`
    );
    P("");

    H1("Headline KPIs");
    KV("Orders (window)", ov?.ordersCount ?? orders?.totals?.orders ?? "—");
    KV(
      "Revenue Paid (BDT)",
      fmtBDT(ov?.revenuePaid ?? orders?.totals?.revenuePaid ?? 0)
    );
    KV("Paid Orders", ov?.paidOrdersCount ?? orders?.totals?.paidOrders ?? "—");
    KV("AOV Paid", fmtBDT(ov?.aovPaid ?? orders?.totals?.aovPaid ?? 0));
    P("");

    if (orders) {
      H1("Orders & Fulfillment");
      const byStatus = orders?.byStatus || orders?.pipeline?.byStatus || {};
      const keys = Object.keys(byStatus);
      if (keys.length) {
        H2("Status counts");
        keys
          .sort((a, b) => String(a).localeCompare(String(b)))
          .forEach((k) => P(`${k}: ${byStatus[k]}`));
      } else {
        P("No status breakdown available in this window.");
      }
      P("");
    }

    if (products) {
      H1("Products");
      const best = products?.bestSellers || products?.best_sellers || [];
      const trending = products?.trending || products?.trendingProducts || [];
      H2("Best-selling (Top 10)");
      best.slice(0, 10).forEach((p, idx) => {
        P(
          `${idx + 1}. ${p.name || p.title || p.sku || "—"} — units: ${
            p.units ?? p.qty ?? "—"
          }, revenue: ${fmtBDT(p.revenue ?? p.rev ?? 0)}`
        );
      });
      P("");
      if (trending.length) {
        H2("Trending (Top 10)");
        trending.slice(0, 10).forEach((p, idx) => {
          P(
            `${idx + 1}. ${p.name || p.title || p.sku || "—"} — score: ${
              p.score ?? p.delta ?? "—"
            }`
          );
        });
        P("");
      }
    }

    if (customers) {
      H1("Customers");
      KV("Total customers", customers?.totals?.customers ?? customers?.total ?? "—");
      KV(
        "New customers (window)",
        customers?.totals?.newCustomers ?? customers?.recent ?? "—"
      );
      P("");
      const top = customers?.topCustomers || customers?.leaders || [];
      if (top.length) {
        H2("Top customers by spend (Top 10)");
        top.slice(0, 10).forEach((c, idx) => {
          P(
            `${idx + 1}. ${c.name || c.email || c.phone || c.customerId || "—"} — orders: ${
              c.orders ?? "—"
            }, spend: ${fmtBDT(c.spend ?? c.totalSpent ?? 0)}`
          );
        });
        P("");
      }
    }

    if (otp) {
      H1("OTP");
      KV("Total OTPs", otp?.totals?.count ?? otp?.total ?? "—");
      KV("Success rate (%)", otp?.totals?.successRate ?? otp?.successRate ?? "—");
      P("");
      const byPurpose = otp?.byPurpose || otp?.breakdowns?.purpose || {};
      const purposeKeys = Object.keys(byPurpose);
      if (purposeKeys.length) {
        H2("OTP by purpose");
        purposeKeys
          .sort((a, b) => String(a).localeCompare(String(b)))
          .forEach((k) => P(`${k}: ${byPurpose[k]}`));
        P("");
      }
    }

    if (returns) {
      H1("Returns / Exchanges / Refunds");
      KV("Returns", returns?.totals?.returns ?? "—");
      KV("Exchanges", returns?.totals?.exchanges ?? "—");
      KV("Refunds", returns?.totals?.refunds ?? "—");
      KV("Return rate (%)", returns?.totals?.returnRate ?? "—");
      P("");
      const topReturned = returns?.topReturnedVariants || [];
      if (topReturned.length) {
        H2("Top returned variants (Top 10)");
        topReturned.slice(0, 10).forEach((v, idx) => {
          P(`${idx + 1}. ${v.sku || v.title || v.variantId} — qty returned: ${v.qtyReturned ?? 0}`);
        });
        P("");
      }
    }

    if (inventory) {
      H1("Inventory");
      KV("On-hand", inventory?.totals?.onHand ?? inventory?.summary?.onHand ?? "—");
      KV("Reserved", inventory?.totals?.reserved ?? inventory?.summary?.reserved ?? "—");
      KV("Safety", inventory?.totals?.safety ?? inventory?.summary?.safety ?? "—");
      P("");
      const low = inventory?.top_low_stock || inventory?.lowStock || [];
      if (low.length) {
        H2("Low stock variants (Top 15)");
        low.slice(0, 15).forEach((v, idx) => {
          P(
            `${idx + 1}. ${v.sku || v.variantId || "—"} — onHand: ${
              v.onHand ?? v.on_hand ?? 0
            }, safety: ${v.safetyStock ?? v.safety_stock ?? 0}`
          );
        });
        P("");
      }
    }

    if (staff) {
      H1("Staff Performance");
      const leaders = staff?.leaders || staff?.topStaff || [];
      if (leaders.length) {
        H2("Leaders (Top 10)");
        leaders.slice(0, 10).forEach((s, idx) => {
          P(`${idx + 1}. ${s.name || s.staffId || "—"} — actions: ${s.actions ?? s.count ?? "—"}`);
        });
        P("");
      } else {
        P("No staff aggregation available in this window.");
        P("");
      }
    }

    if (pnl) {
      H1("P&L");
      KV("Source", pnl?.source ?? "—");
      const rows = pnl?.rows || pnl?.series || [];
      if (rows.length) {
        H2("Grouped totals");
        rows.slice(0, 24).forEach((r) => {
          const k = r.key || r.period || r.group || "—";
          const rev = fmtBDT(r.revenue ?? r.sales ?? 0);
          const cost = fmtBDT(r.cost ?? r.cogs ?? 0);
          const prof = fmtBDT(r.profit ?? r.grossProfit ?? 0);
          P(`${k} — revenue: ${rev}, cost: ${cost}, profit: ${prof}`);
        });
        P("");
      }
    }

    if (profit) {
      H1("Profit by Product / Variant / Batch");
      const rows = profit?.rows || profit?.items || [];
      if (rows.length) {
        rows.slice(0, 25).forEach((r, idx) => {
          P(
            `${idx + 1}. ${r.key || r.sku || r.variantId || r.productId || "—"} — revenue: ${fmtBDT(
              r.revenue ?? 0
            )}, cost: ${fmtBDT(r.cost ?? 0)}, profit: ${fmtBDT(r.profit ?? 0)}`
          );
        });
        P("");
      } else {
        P("No profit rows returned for this window.");
        P("");
      }
    }

    if (projections) {
      H1("Projections");
      const m = projections?.monthly?.projection?.next || [];
      if (m.length) {
        H2("Next 12 months revenue projection (BDT)");
        m.slice(0, 12).forEach((v, idx) => P(`${idx + 1}. ${fmtBDT(v)}`));
      } else {
        P("No projections computed for this window.");
      }
      P("");
    }

    const doc = new Document({ sections: [{ children: lines }] });
    const buf = await Packer.toBuffer(doc);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="tdlc_analytics_${days}d.docx"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    // Fallback: Word-readable HTML (.doc)
    const best = (products?.bestSellers || products?.best_sellers || []).slice(0, 15);
    const topReturned = (returns?.topReturnedVariants || []).slice(0, 10);

    const html = `<!doctype html>
<html>
<head><meta charset="utf-8" />
<title>TDLC Analytics</title>
</head>
<body>
  <h1>TDLC Admin Analytics Report</h1>
  <p><strong>Range:</strong> ${shortISO(meta?.range?.sinceISO || since.toISOString())} → ${shortISO(
      meta?.range?.untilExclusiveISO || untilExclusive.toISOString()
    )}</p>
  <p><strong>Include:</strong> ${String(
    meta?.range?.include || bundleUrl.searchParams.get("include") || "all"
  )}</p>

  <h2>Headline KPIs</h2>
  <ul>
    <li>Orders: ${ov?.ordersCount ?? orders?.totals?.orders ?? "-"}</li>
    <li>Revenue (Paid): ${fmtBDT(ov?.revenuePaid ?? orders?.totals?.revenuePaid ?? 0)}</li>
    <li>Paid Orders: ${ov?.paidOrdersCount ?? orders?.totals?.paidOrders ?? "-"}</li>
    <li>AOV (Paid): ${fmtBDT(ov?.aovPaid ?? orders?.totals?.aovPaid ?? 0)}</li>
  </ul>

  <h2>Best-selling Products</h2>
  <ol>
    ${best
      .map(
        (p) =>
          `<li>${p.name || p.title || p.sku || "—"} — units: ${p.units ?? p.qty ?? "—"}, revenue: ${fmtBDT(
            p.revenue ?? p.rev ?? 0
          )}</li>`
      )
      .join("")}
  </ol>

  <h2>Top Returned Variants</h2>
  <ol>
    ${topReturned
      .map(
        (v) =>
          `<li>${v.sku || v.title || v.variantId} — qty returned: ${v.qtyReturned ?? 0}</li>`
      )
      .join("")}
  </ol>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "application/msword; charset=utf-8",
        "content-disposition": `attachment; filename="tdlc_analytics_${days}d.doc"`,
        "cache-control": "no-store",
      },
    });
  }
}
