// FILE: app/(admin)/admin/analytics/client.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  NAVY,
  GOLD,
  NAVY_2,
  n,
  clamp,
  cx,
  isoDate,
  localISODate,
  safeText,
  pct,
  formatCompactInt,
  median,
  mad,
  movingAvg,
  groupSeries,
  tryParseSearch,
  weekdayBreakdown,
  dowLabel,
  runRate,
  concentrationTopShare,
  linRegPredictNext,
  heuristicProjectionFromTrend,
} from "./_lib/utils";

import { loadAnalyticsBundle } from "./_lib/data";
import {
  loadTargetsSafe,
  saveTargetsSafe,
  loadViewsSafe,
  saveViewsSafe,
} from "./_lib/storage";

import { Tile, Pill, BigCTAButton, TabButton, Notice, MetricKPI } from "./_components/ui";
import { MiniLineChart, MiniBars } from "./_components/charts";
import { ModuleRenderer } from "./_components/modules";

export default function AnalyticsClient({
  initialDays = 30,
  initialOverview = null,
  initialSeries = [],
  moneyFormat,
}) {
  const [days, setDays] = useState(initialDays);
  const [overview, setOverview] = useState(initialOverview || {});
  const [series, setSeries] = useState(Array.isArray(initialSeries) ? initialSeries : []);
  const [mode, setMode] = useState("unknown");
  const [modules, setModules] = useState({});
  const [rawBundle, setRawBundle] = useState(null);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState({ tone: "soft", text: "" });


const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
const [lastLoadMs, setLastLoadMs] = useState(null);
const [isOnline, setIsOnline] = useState(true);

const [targets, setTargets] = useState({ revenue: "", orders: "" });

const [tableQuery, setTableQuery] = useState("");
const [tableLimit, setTableLimit] = useState(50);

const [diagQuery, setDiagQuery] = useState("");

  const [tab, setTab] = useState("overview");
  const [showControls, setShowControls] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // bundle knobs (advanced mode)
  const [include, setInclude] = useState("all"); // comma list or "all"
  const [bundleParallel, setBundleParallel] = useState(true);
  const [bundleStrict, setBundleStrict] = useState(false);

  // profit / pnl knobs (passed to bundle endpoint)
  const [profitDimension, setProfitDimension] = useState("product"); // product|variant|batch
  const [profitPaidOnly, setProfitPaidOnly] = useState(true);
  const [refundAttribution, setRefundAttribution] = useState("refund_date"); // refund_date|sale_date
  const [moduleLimit, setModuleLimit] = useState(200);
  const [pnlGroup, setPnlGroup] = useState("month"); // week|month|quarter|half|year|total


  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    paymentStatus: "",
    provider: "",
    channel: "",
    source: "",
    campaign: "",

    // extra filters supported by /api/admin/analytics/bundle (additive)
    audience: "",
    warehouseId: "",
    productId: "",
    variantId: "",
    staffId: "",
    customerId: "",
    currency: "",
    country: "",
    city: "",
    coupon: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
  });

  const [compareOn, setCompareOn] = useState(false);
  const [compare, setCompare] = useState(null);

  const [primaryMetric, setPrimaryMetric] = useState("revenuePaid");
  const [groupUnit, setGroupUnit] = useState("day");
  const [smooth, setSmooth] = useState(true);

  const [autoRefresh, setAutoRefresh] = useState(false);

  const [sortKey, setSortKey] = useState("day");
  const [sortDir, setSortDir] = useState("asc");

  const [views, setViews] = useState([]);
  const [viewName, setViewName] = useState("");

  const abortRef = useRef(null);

  const tzOffsetMinutes = useMemo(() => {
    try {
      return -new Date().getTimezoneOffset();
    } catch {
      return 360;
    }
  }, []);

  const moneyFmt = useMemo(() => {
    try {
      if (typeof moneyFormat === "string" && moneyFormat.trim()) {
        return new Intl.NumberFormat("en-BD", {
          style: "currency",
          currency: moneyFormat.trim(),
          maximumFractionDigits: 0,
        });
      }
      if (moneyFormat && typeof moneyFormat === "object") {
        const locale = moneyFormat.locale || "en-BD";
        const currency = moneyFormat.currency || "BDT";
        const maximumFractionDigits =
          typeof moneyFormat.maximumFractionDigits === "number"
            ? moneyFormat.maximumFractionDigits
            : 0;
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits,
        });
      }
      return new Intl.NumberFormat("en-BD", {
        style: "currency",
        currency: "BDT",
        maximumFractionDigits: 0,
      });
    } catch {
      return null;
    }
  }, [moneyFormat]);

  const money = (v) => {
    const val = n(v, 0);
    if (moneyFmt) return moneyFmt.format(val);
    return String(Math.round(val));
  };

  const k = overview?.kpis || {};
  const b = overview?.breakdowns || {};
  const isLegacy = !!overview?.meta?.legacy;

  // Prefer full bundle raw, then known module blocks, then overview extras.
  const extras =
    rawBundle ||
    modules ||
    overview?.extras ||
    overview?.extended ||
    overview?.details ||
    overview?.more ||
    null;

  const sinceLabel = useMemo(() => {
    const s = overview?.sinceISO ? new Date(overview.sinceISO) : null;
    return s && !Number.isNaN(s.getTime()) ? isoDate(s) : "—";
  }, [overview]);

  const normalizedSeries = useMemo(() => {
    const xs = Array.isArray(series) ? series : [];
    return xs.map((r) => ({
      day: safeText(r?.day || r?.date || ""),
      orders: n(r?.orders, 0),
      revenuePaid: n(r?.revenuePaid ?? r?.revenue ?? 0, 0),
    }));
  }, [series]);

  const grouped = useMemo(() => groupSeries(normalizedSeries, groupUnit), [normalizedSeries, groupUnit]);

  const chartSeries = useMemo(() => {
    const xs = smooth ? movingAvg(grouped, primaryMetric, 7) : grouped;
    if (smooth && primaryMetric === "revenuePaid") {
      return xs.map((r) => ({ ...r, revenuePaid: n(r?.revenuePaidMA, r?.revenuePaid) }));
    }
    if (smooth && primaryMetric === "orders") {
      return xs.map((r) => ({ ...r, orders: n(r?.ordersMA, r?.orders) }));
    }
    return xs;
  }, [grouped, primaryMetric, smooth]);

  const derived = useMemo(() => {
    const arr = grouped;

    const lastN = Math.min(arr.length, 7);
    const last = arr.slice(-lastN);
    const prev = arr.slice(Math.max(0, arr.length - lastN * 2), arr.length - lastN);

    const avgLastOrders = lastN ? last.reduce((s, r) => s + n(r?.orders), 0) / lastN : 0;
    const avgPrevOrders = prev.length ? prev.reduce((s, r) => s + n(r?.orders), 0) / prev.length : 0;

    const avgLastRev = lastN ? last.reduce((s, r) => s + n(r?.revenuePaid), 0) / lastN : 0;
    const avgPrevRev = prev.length ? prev.reduce((s, r) => s + n(r?.revenuePaid), 0) / prev.length : 0;

    const peakOrders = arr.reduce(
      (best, r) => (n(r?.orders) > n(best?.orders) ? r : best),
      arr[0] || null
    );
    const peakRevenue = arr.reduce(
      (best, r) => (n(r?.revenuePaid) > n(best?.revenuePaid) ? r : best),
      arr[0] || null
    );

    const vol = (key) => {
      if (arr.length < 2) return 0;
      let sumAbs = 0;
      for (let i = 1; i < arr.length; i++) {
        sumAbs += Math.abs(n(arr[i]?.[key]) - n(arr[i - 1]?.[key]));
      }
      const avg = arr.reduce((s, r) => s + n(r?.[key]), 0) / Math.max(1, arr.length);
      return avg > 0 ? sumAbs / Math.max(1, arr.length - 1) / avg : 0;
    };

    const anomaly = (key) => {
      const vals = arr.map((r) => n(r?.[key], 0));
      const m = median(vals);
      const s = mad(vals) || 1;
      const rows = arr
        .map((r) => {
          const v = n(r?.[key], 0);
          const z = (0.6745 * (v - m)) / s;
          return { day: r.day, v, z };
        })
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
      return rows.slice(0, 5);
    };

    const tail = arr.slice(-Math.min(14, arr.length));
    const projOrders = linRegPredictNext(tail.map((x) => x.orders), 7);
    const projRevenue = linRegPredictNext(tail.map((x) => x.revenuePaid), 7);

    const trendOrdersPct = pct(avgLastOrders, avgPrevOrders);
    const trendRevPct = pct(avgLastRev, avgPrevRev);

    const totalRev = arr.reduce((s, r) => s + n(r.revenuePaid), 0);

    const rr30 = heuristicProjectionFromTrend(totalRev, Math.max(1, arr.length), 30, trendRevPct);
    const rr90 = heuristicProjectionFromTrend(totalRev, Math.max(1, arr.length), 90, trendRevPct);
    const rr180 = heuristicProjectionFromTrend(totalRev, Math.max(1, arr.length), 180, trendRevPct);
    const rr365 = heuristicProjectionFromTrend(totalRev, Math.max(1, arr.length), 365, trendRevPct);

    const conc = concentrationTopShare(arr, "revenuePaid", 0.2);

    return {
      trendOrdersPct,
      trendRevPct,
      peakOrders,
      peakRevenue,
      volOrders: vol("orders"),
      volRevenue: vol("revenuePaid"),
      anomaliesOrders: anomaly("orders"),
      anomaliesRevenue: anomaly("revenuePaid"),
      projection: {
        ordersNext7: projOrders.reduce((s, v) => s + n(v), 0),
        revenueNext7: projRevenue.reduce((s, v) => s + n(v), 0),
      },
      runRate: { rev30: rr30, rev90: rr90, rev180: rr180, rev365: rr365 },
      concentration: conc,
    };
  }, [grouped]);

  const canCompare = useMemo(() => {
    if (start && end) return true;
    return !!days;
  }, [start, end, days]);

  function buildQSCurrent() {
    const hasRange = !!(start && end);
    const qs = new URLSearchParams();
    if (hasRange) {
      qs.set("start", start);
      qs.set("end", end);
    } else {
      qs.set("days", String(days));
    }
    qs.set("tzOffsetMinutes", String(tzOffsetMinutes));

    if (filters?.status) qs.set("status", filters.status);
    if (filters?.paymentStatus) qs.set("paymentStatus", filters.paymentStatus);
    if (filters?.provider) qs.set("provider", filters.provider);
    if (filters?.channel) qs.set("channel", filters.channel);
    if (filters?.source) qs.set("source", filters.source);
    if (filters?.campaign) qs.set("campaign", filters.campaign);
    return qs.toString();
  }


async function applyBundle({ nextDays, nextStart, nextEnd, nextFilters }) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let aborted = false;

  setLoading(true);
  if (abortRef.current) abortRef.current.abort();
  const ac = new AbortController();
  abortRef.current = ac;

  try {
    const bundle = await loadAnalyticsBundle({
      days: nextDays,
      start: nextStart,
      end: nextEnd,
      group: groupUnit,
      compare: compareOn,
      tzOffsetMinutes,
      include,
      parallel: bundleParallel,
      strict: bundleStrict,
      filters: nextFilters,
      extra: {
        dimension: profitDimension,
        paidOnly: profitPaidOnly ? "1" : "0",
        refundAttribution,
        limit: String(moduleLimit || 200),
        pnlGroup,
      },
      signal: ac.signal,
    });

    setMode(bundle.mode);
    setOverview(bundle.overview || {});
    setSeries(bundle.series || []);
    setDays(bundle.windowDays || nextDays || days);
    setModules(bundle.modules || {});
    setRawBundle(bundle.raw || null);

    setCompareOn(false);
    setCompare(null);

    setLastUpdatedAt(Date.now());
    setNotice({ tone: "success", text: "Analytics updated." });
  } catch (e) {
    aborted = String(e?.name) === "AbortError";
    if (!aborted) {
      setNotice({ tone: "danger", text: String(e?.message || e) });
    }
  } finally {
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!aborted) setLastLoadMs(Math.max(0, Math.round(t1 - t0)));
    setLoading(false);
  }
}

  async function reloadByDays(nextDays) {
    setStart("");
    setEnd("");
    await applyBundle({ nextDays, nextStart: "", nextEnd: "", nextFilters: filters });
  }
  async function reloadByRange() {
    if (!start || !end) return;
    await applyBundle({ nextDays: days, nextStart: start, nextEnd: end, nextFilters: filters });
  }


function setPreset(preset) {
  const now = new Date();
  const endISO = localISODate(now);

  if (preset === "7d" || preset === "14d" || preset === "30d" || preset === "45d") {
    const nDays = Number.parseInt(preset.replace("d", ""), 10);
    setDays(nDays);
    setStart("");
    setEnd("");
    applyBundle({ nextDays: nDays, nextStart: "", nextEnd: "", nextFilters: filters });
    return;
  }

  if (preset === "mtd") {
    const startISO = localISODate(new Date(now.getFullYear(), now.getMonth(), 1));
    setStart(startISO);
    setEnd(endISO);
    applyBundle({ nextDays: days, nextStart: startISO, nextEnd: endISO, nextFilters: filters });
    return;
  }

  if (preset === "ytd") {
    const startISO = localISODate(new Date(now.getFullYear(), 0, 1));
    setStart(startISO);
    setEnd(endISO);
    applyBundle({ nextDays: days, nextStart: startISO, nextEnd: endISO, nextFilters: filters });
    return;
  }

  if (preset === "prev_month") {
    const startPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endPrev = new Date(now.getFullYear(), now.getMonth(), 0);
    const startISO = localISODate(startPrev);
    const endISO2 = localISODate(endPrev);
    setStart(startISO);
    setEnd(endISO2);
    applyBundle({ nextDays: days, nextStart: startISO, nextEnd: endISO2, nextFilters: filters });
    return;
  }
}

  async function loadCompare() {
    if (!canCompare) return;

    setLoading(true);
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      let qsStart = "";
      let qsEnd = "";

      if (start && end) {
        const endDt = new Date(end);
        const startDt = new Date(start);
        const windowMs = endDt.getTime() - startDt.getTime();
        const prevEnd = new Date(startDt.getTime() - 24 * 60 * 60 * 1000);
        const prevStart = new Date(prevEnd.getTime() - windowMs);
        qsStart = isoDate(prevStart);
        qsEnd = isoDate(prevEnd);
      } else {
        const now = new Date();
        const startDt = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
        const prevEnd = new Date(startDt.getTime() - 24 * 60 * 60 * 1000);
        const prevStart = new Date(prevEnd.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
        qsStart = isoDate(prevStart);
        qsEnd = isoDate(prevEnd);
      }

      const bundle = await loadAnalyticsBundle({
        days,
        start: qsStart,
        end: qsEnd,
        tzOffsetMinutes,
        filters,
        signal: ac.signal,
      });

      setCompare({ overview: bundle.overview || {}, series: bundle.series || [] });
      setCompareOn(true);
      setNotice({ tone: "success", text: "Compare loaded." });
    } catch (e) {
      if (String(e?.name) !== "AbortError") {
        setNotice({ tone: "danger", text: String(e?.message || e) });
      }
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    const keys = ["day", "orders", "revenuePaid"];
    const rows = [keys, ...(grouped || []).map((r) => keys.map((k) => r?.[k] ?? ""))];
    const csv = rows
      .map((r) => r.map((x) => `"${String(x ?? "").replaceAll(`"`, `""`)}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `analytics_${groupUnit}_${days}d_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);

    setNotice({ tone: "success", text: "CSV exported." });
  }

  function exportJSON() {
    const payload = {
      windowDays: days,
      groupUnit,
      overview,
      filters,
      series: grouped,
      exportedAt: new Date().toISOString(),
      mode,
      derived,
      modules,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `analytics_${groupUnit}_${days}d_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    setNotice({ tone: "success", text: "JSON exported." });
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Client-side Excel/DOC/PDF fallback exports (kept as-is)
  function buildReportHTML({ title = "TDLC Analytics Report" } = {}) {
    const now = new Date();
    const exportedAt = now.toISOString();
    const totalRevenue = n(k.revenuePaid, 0);
    const totalOrders = n(k.ordersCount, 0);
    const aov = totalOrders ? totalRevenue / Math.max(1, totalOrders) : 0;

    const weekday = weekdayBreakdown(normalizedSeries, tzOffsetMinutes);

    const esc = (s) =>
      String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const rows = (grouped || [])
      .map(
        (r) => `
        <tr>
          <td>${esc(r.day)}</td>
          <td style="text-align:right;">${esc(formatCompactInt(r.orders))}</td>
          <td style="text-align:right;">${esc(money(r.revenuePaid))}</td>
        </tr>`
      )
      .join("");

    const weekdayRows = (weekday || [])
      .map(
        (w) => `
        <tr>
          <td>${esc(dowLabel(w.dow))}</td>
          <td style="text-align:right;">${esc(formatCompactInt(w.orders))}</td>
          <td style="text-align:right;">${esc(money(w.revenuePaid))}</td>
          <td style="text-align:right;">${esc(money(w.revPerBucket))}</td>
        </tr>`
      )
      .join("");

    const extrasJSON = extras ? esc(JSON.stringify(extras).slice(0, 12000)) : "";

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: Arial, sans-serif; color:#0f172a; margin: 28px; }
  h1 { font-size: 20px; margin: 0 0 10px; }
  .meta { font-size: 12px; color:#475569; margin-bottom: 18px; }
  .kpis { display:flex; gap:12px; flex-wrap:wrap; margin-bottom: 16px; }
  .kpi { border:1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; min-width: 220px; }
  .kpi .l { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color:#64748b; font-weight: 700; }
  .kpi .v { font-size: 18px; font-weight: 800; margin-top: 6px; }
  .kpi .s { font-size: 12px; color:#475569; margin-top: 4px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 10px; font-size: 12px; }
  th { background:#f8fafc; text-align:left; }
  .section { margin-top: 18px; }
  .small { font-size: 11px; color:#64748b; }
  @media print {
    body { margin: 12mm; }
    .no-print { display:none; }
  }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">
    Window: <b>${esc(days)}</b> days &nbsp; | &nbsp; Since: <b>${esc(sinceLabel)}</b>
    &nbsp; | &nbsp; Group: <b>${esc(groupUnit)}</b>
    &nbsp; | &nbsp; Exported: <b>${esc(exportedAt)}</b>
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="l">Revenue</div>
      <div class="v">${esc(money(totalRevenue))}</div>
      <div class="s">Run-rate 30d: ${esc(money(derived?.runRate?.rev30))}</div>
    </div>
    <div class="kpi">
      <div class="l">Orders</div>
      <div class="v">${esc(formatCompactInt(totalOrders))}</div>
      <div class="s">Trend (7): ${esc(derived?.trendOrdersPct?.toFixed?.(1) ?? "0.0")}%</div>
    </div>
    <div class="kpi">
      <div class="l">AOV</div>
      <div class="v">${esc(money(aov))}</div>
      <div class="s">Trend (7): ${esc(derived?.trendRevPct?.toFixed?.(1) ?? "0.0")}%</div>
    </div>
    <div class="kpi">
      <div class="l">Concentration</div>
      <div class="v">${esc(((derived?.concentration?.topShare ?? 0) * 100).toFixed(1))}%</div>
      <div class="s">Top ${esc(String(derived?.concentration?.topCount ?? 0))} buckets share of revenue</div>
    </div>
  </div>

  <div class="section">
    <h2 style="font-size:14px;margin:0 0 8px;">Weekday performance</h2>
    <table>
      <thead>
        <tr>
          <th>Day</th>
          <th style="text-align:right;">Orders</th>
          <th style="text-align:right;">Revenue</th>
          <th style="text-align:right;">Revenue / bucket</th>
        </tr>
      </thead>
      <tbody>${weekdayRows || ""}</tbody>
    </table>
  </div>

  <div class="section">
    <h2 style="font-size:14px;margin:0 0 8px;">Time series (${esc(groupUnit)})</h2>
    <table>
      <thead>
        <tr>
          <th>Bucket</th>
          <th style="text-align:right;">Orders</th>
          <th style="text-align:right;">Revenue</th>
        </tr>
      </thead>
      <tbody>${rows || ""}</tbody>
    </table>
  </div>

  ${
    extras
      ? `<div class="section">
          <h2 style="font-size:14px;margin:0 0 8px;">Extended payload</h2>
          <div class="small">Includes bundle/modules payload for audit.</div>
          <pre style="white-space:pre-wrap;border:1px solid #e2e8f0;border-radius:12px;padding:10px;font-size:11px;background:#f8fafc;">${extrasJSON}</pre>
        </div>`
      : ""
  }

  <div class="section no-print small">
    Use your browser’s print dialog → “Save as PDF” for PDF export.
  </div>
</body>
</html>`;
  }

  function exportExcel() {
    const html = buildReportHTML({ title: "TDLC Analytics Report (Excel)" });
    const excel =
      `<?xml version="1.0"?>` +
      `<?mso-application progid="Excel.Sheet"?>` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:html="http://www.w3.org/TR/REC-html40">
        <Worksheet ss:Name="Analytics">
          <Table>
            <Row><Cell><Data ss:Type="String">Open in Excel. For strict XLSX, use CSV export.</Data></Cell></Row>
          </Table>
        </Worksheet>
      </Workbook>`;
    const blob = new Blob([excel, "\n\n", html], { type: "application/vnd.ms-excel;charset=utf-8" });
    downloadBlob(blob, `analytics_${groupUnit}_${days}d_${new Date().toISOString().slice(0, 10)}.xls`);
    setNotice({ tone: "success", text: "Excel exported." });
  }

  function exportDoc() {
    const html = buildReportHTML({ title: "TDLC Analytics Report" });
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
    downloadBlob(blob, `analytics_${groupUnit}_${days}d_${new Date().toISOString().slice(0, 10)}.doc`);
    setNotice({ tone: "success", text: "DOC exported." });
  }

  function exportPDF() {
    try {
      const html = buildReportHTML({ title: "TDLC Analytics Report (PDF)" });
      const w = window.open("", "_blank", "noopener,noreferrer");
      if (!w) {
        setNotice({ tone: "warn", text: "Popup blocked. Allow popups to export PDF." });
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => {
        try {
          w.print();
        } catch {}
      }, 450);
      setNotice({ tone: "success", text: "PDF export opened (Save as PDF)." });
    } catch {
      setNotice({ tone: "danger", text: "PDF export failed." });
    }
  }

  // Server-side exports (PDF/DOCX)
  function exportServer(path, filenameHint) {
    const qs = buildQSCurrent();
    const url = `${path}?${qs}`;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (filenameHint) a.download = filenameHint;
    a.click();
    setNotice({ tone: "success", text: "Export started." });
  }

  async function copyShareLink() {
    try {
      const url = new URL(window.location.href);
      const sp = url.searchParams;

      if (start && end) {
        sp.set("start", start);
        sp.set("end", end);
        sp.delete("days");
      } else {
        sp.set("days", String(days));
        sp.delete("start");
        sp.delete("end");
      }

      sp.set("group", groupUnit);
      sp.set("metric", primaryMetric);
      sp.set("smooth", smooth ? "1" : "0");
      sp.set("auto", autoRefresh ? "1" : "0");
      sp.set("tab", tab);

      Object.entries(filters || {}).forEach(([k2, v]) => {
        if (v) sp.set(k2, v);
        else sp.delete(k2);
      });

      await navigator.clipboard.writeText(url.toString());
      setNotice({ tone: "success", text: "Share link copied." });
    } catch {
      setNotice({ tone: "warn", text: "Could not copy link (browser permissions)." });
    }
  }

  function printView() {
    try {
      window.print();
    } catch {}
  }

  const compareDelta = useMemo(() => {
    if (!compareOn || !compare?.overview) return null;
    const ck = compare.overview?.kpis || {};
    return {
      revenuePct: pct(k.revenuePaid, ck.revenuePaid),
      ordersPct: pct(k.ordersCount, ck.ordersCount),
    };
  }, [compareOn, compare, k]);

  useEffect(() => {
    const initialViews = loadViewsSafe();
    setViews(initialViews);

    // Local-only preferences
    setTargets(loadTargetsSafe());
    try { setIsOnline(navigator.onLine); } catch {}
    const _on = () => setIsOnline(true);
    const _off = () => setIsOnline(false);
    try {
      window.addEventListener("online", _on);
      window.addEventListener("offline", _off);
    } catch {}

    const p = tryParseSearch();
    const allowedTabs = [
      "overview",
      "trends",
      "breakdowns",
      "all",
      "table",
      "orders",
      "customers",
      "products",
      "otp",
      "returns",
      "staff",
      "inventory",
      "profit",
      "pnl",
      "projections",
      "report",
      "export",
      "diagnostics",
    ];

    if (p) {
      if (p.group) setGroupUnit(p.group === "week" || p.group === "month" ? p.group : "day");
      if (p.metric) setPrimaryMetric(p.metric === "orders" ? "orders" : "revenuePaid");
      if (p.smooth !== null) setSmooth(!!p.smooth);
      if (p.auto !== null) setAutoRefresh(!!p.auto);
      if (p.tab && allowedTabs.includes(p.tab)) setTab(p.tab);

      if (p.start && p.end) {
        setStart(p.start);
        setEnd(p.end);
        applyBundle({
          nextDays: p.days || initialDays,
          nextStart: p.start,
          nextEnd: p.end,
          nextFilters: filters,
        });
        return;
      }
      if (p.days) {
        setDays(p.days);
        applyBundle({
          nextDays: p.days,
          nextStart: "",
          nextEnd: "",
          nextFilters: filters,
        });
        return;
      }
    }

    const hasAny = Array.isArray(initialSeries) && initialSeries.length > 0;
    const ok = initialOverview && Object.keys(initialOverview || {}).length > 0;

    if (!hasAny || !ok) {
      applyBundle({
        nextDays: initialDays,
        nextStart: "",
        nextEnd: "",
        nextFilters: filters,
      });
    } else {
      setMode(initialOverview?.meta?.legacy ? "legacy" : "advanced");
    }

    return () => {
      try {
        window.removeEventListener("online", _on);
        window.removeEventListener("offline", _off);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      if (start && end) reloadByRange();
      else reloadByDays(days);
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, start, end, days]);

  useEffect(() => {
    // Persist targets (local only)
    saveTargetsSafe(targets);
  }, [targets]);

  const revenueValue = money(k.revenuePaid);
  const ordersCount = n(k.ordersCount, 0);
  const aov = ordersCount ? money(k.aov ?? n(k.revenuePaid) / Math.max(1, ordersCount)) : "—";

  const sortedTable = useMemo(() => {
    const arr = [...(grouped || [])];
    const dir = sortDir === "desc" ? -1 : 1;
    arr.sort((a, b2) => {
      if (sortKey === "day") return String(a.day).localeCompare(String(b2.day)) * dir;
      if (sortKey === "orders") return (n(a.orders) - n(b2.orders)) * dir;
      return (n(a.revenuePaid) - n(b2.revenuePaid)) * dir;
    });
    return arr;
  }, [grouped, sortKey, sortDir]);

  const visibleTableRows = useMemo(() => {
    const q = String(tableQuery || "").trim().toLowerCase();
    const rows = Array.isArray(sortedTable) ? sortedTable : [];
    const filtered = !q
      ? rows
      : rows.filter((r) => {
          const hay = `${r.day ?? ""} ${r.orders ?? ""} ${r.revenuePaid ?? ""}`.toLowerCase();
          return hay.includes(q);
        });
    const limit = Math.max(10, Math.min(500, Number(tableLimit) || 50));
    return filtered.slice(0, limit);
  }, [sortedTable, tableQuery, tableLimit]);


const diagMatches = useMemo(() => {
  const q = String(diagQuery || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const seen = new Set();

  const walk = (node, path) => {
    if (!node || out.length >= 24) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && i < 50; i++) walk(node[i], `${path}[${i}]`);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const p = path ? `${path}.${k}` : k;
        if (String(k).toLowerCase().includes(q)) {
          if (!seen.has(p)) {
            out.push(p);
            seen.add(p);
            if (out.length >= 24) return;
          }
        }
        if (typeof v === "string" && v.toLowerCase().includes(q)) {
          if (!seen.has(p)) {
            out.push(p);
            seen.add(p);
            if (out.length >= 24) return;
          }
        }
        if (typeof v === "number" && String(v).includes(q)) {
          if (!seen.has(p)) {
            out.push(p);
            seen.add(p);
            if (out.length >= 24) return;
          }
        }
        if (typeof v === "object") walk(v, p);
      }
    }
  };

  try {
    walk(rawBundle || {}, "");
  } catch {}
  return out;
}, [diagQuery, rawBundle]);


  function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return setNotice({ tone: "warn", text: "Enter a name to save a view." });

    const payload = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name,
      at: new Date().toISOString(),
      state: {
        days,
        start,
        end,
        groupUnit,
        primaryMetric,
        smooth,
        autoRefresh,
        filters,
        tab,
      },
    };
    const next = [payload, ...(views || [])].slice(0, 20);
    setViews(next);
    saveViewsSafe(next);
    setViewName("");
    setNotice({ tone: "success", text: `Saved view: ${name}` });
  }

  function applyView(v) {
    const s = v?.state || {};
    setNotice({ tone: "soft", text: `Applied view: ${safeText(v?.name)}` });

    setDays(clamp(n(s.days, days), 1, 3650));
    setStart(s.start || "");
    setEnd(s.end || "");
    setGroupUnit(s.groupUnit === "week" || s.groupUnit === "month" ? s.groupUnit : "day");
    setPrimaryMetric(s.primaryMetric === "orders" ? "orders" : "revenuePaid");
    setSmooth(s.smooth !== false);
    setAutoRefresh(!!s.autoRefresh);
    setFilters(s.filters || filters);
    setTab(s.tab || "overview");

    if (s.start && s.end) {
      applyBundle({
        nextDays: n(s.days, days),
        nextStart: s.start,
        nextEnd: s.end,
        nextFilters: s.filters || filters,
      });
    } else {
      applyBundle({
        nextDays: n(s.days, days),
        nextStart: "",
        nextEnd: "",
        nextFilters: s.filters || filters,
      });
    }
  }

  function deleteView(id) {
    const next = (views || []).filter((x) => x.id !== id);
    setViews(next);
    saveViewsSafe(next);
    setNotice({ tone: "soft", text: "View deleted." });
  }

  const weekday = useMemo(() => weekdayBreakdown(normalizedSeries, tzOffsetMinutes), [normalizedSeries, tzOffsetMinutes]);

  // Convenience accessors for module blocks
  const modOrders = modules?.orders || null;
  const modCustomers = modules?.customers || null;
  const modProducts = modules?.products || null;
  const modOtp = modules?.otp || null;
  const modReturns = modules?.returns || null;
  const modStaff = modules?.staff || null;
  const modInventory = modules?.inventory || null;
  const modProfit = modules?.profit || null;
  const modPnl = modules?.pnl || null;
  const modProjections = modules?.projections || null;
  const modReport = modules?.report || null;

  return (
    <div style={{ ["--navy"]: NAVY, ["--gold"]: GOLD, ["--navy2"]: NAVY_2 }} className="relative min-h-screen bg-slate-50">
      <style jsx global>{`
        @keyframes tdlc-sheen {
          0% { background-position: 0% 50%; filter: brightness(1); }
          50% { background-position: 100% 50%; filter: brightness(1.03); }
          100% { background-position: 0% 50%; filter: brightness(1); }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-44 -left-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,rgba(15,33,71,0.14),transparent_60%)]" />
        <div className="absolute -top-28 left-1/2 h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(212,175,55,0.16),transparent_60%)]" />
        <div className="absolute -bottom-52 -right-56 h-[760px] w-[760px] rounded-full bg-[radial-gradient(circle_at_center,rgba(15,33,71,0.10),transparent_62%)]" />
      </div>

      <div className="relative mx-auto max-w-7xl p-6 md:p-8 space-y-5">
        <div className="sticky top-0 z-30 -mx-6 md:-mx-8 px-6 md:px-8 py-5 bg-white/75 backdrop-blur-xl border-b border-slate-200/60 shadow-[0_12px_34px_rgba(2,6,23,0.05)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-slate-900">Analytics</h1>
                <Pill tone="soft">Window: <span className="mx-1">{days}</span> days</Pill>
                <Pill tone="soft">Since <span className="mx-1">{sinceLabel}</span></Pill>
                {mode === "legacy" ? <Pill tone="warn">Legacy feed</Pill> : null}
                {mode === "advanced" ? <Pill tone="navy">Advanced feed</Pill> : null}
                {compareOn ? <Pill tone="gold">Compare ON</Pill> : null}
                {!isOnline ? <Pill tone="danger">Offline</Pill> : null}
                {lastUpdatedAt ? (
                  <Pill tone="soft">
                    Updated <span className="mx-1">{new Date(lastUpdatedAt).toLocaleTimeString()}</span>
                  </Pill>
                ) : null}
                {lastLoadMs != null ? (
                  <Pill tone="soft">
                    Latency <span className="mx-1">{lastLoadMs}</span>ms
                  </Pill>
                ) : null}
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-600">
                Revenue, orders, payment posture, fulfillment health, and decision signals.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-start xl:justify-end gap-2">
              <select
                value={days}
                disabled={loading || (start && end)}
                onChange={(e) => reloadByDays(clamp(Number(e.target.value), 7, 365))}
                className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                title={start && end ? "Clear range to change window days" : "Window days"}
              >
                {[7, 14, 30, 60, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>

              <BigCTAButton
                tone="ghost"
                disabled={loading}
                onClick={() => {
                  if (start && end) reloadByRange();
                  else reloadByDays(days);
                }}
              >
                Refresh
              </BigCTAButton>

              <BigCTAButton
                tone={showControls ? "primary" : "secondary"}
                disabled={loading}
                onClick={() => setShowControls((v) => !v)}
              >
                {showControls ? "Close Control Center" : "Control Center"}
              </BigCTAButton>

              <BigCTAButton
                tone={compareOn ? "primary" : "accent"}
                disabled={loading || !canCompare}
                onClick={
                  compareOn
                    ? () => {
                        setCompareOn(false);
                        setCompare(null);
                        setNotice({ tone: "soft", text: "Compare disabled." });
                      }
                    : loadCompare
                }
              >
                {compareOn ? "Disable compare" : "Compare period"}
              </BigCTAButton>

              <BigCTAButton
                tone={autoRefresh ? "primary" : "secondary"}
                disabled={loading}
                onClick={() => setAutoRefresh((v) => !v)}
              >
                {autoRefresh ? "Auto-refresh ON" : "Auto-refresh"}
              </BigCTAButton>
            </div>
          </div>

          <div className="mt-5">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200/70 to-transparent" />
          </div>

          <div className="mt-5">
            <div
              className={cx(
                "inline-flex flex-wrap gap-3 p-3 rounded-[999px]",
                "border border-slate-200/70 ring-1 ring-white/40",
                "bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.62))]",
                "shadow-[0_18px_60px_rgba(2,6,23,0.07)] backdrop-blur"
              )}
            >
              <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>Overview</TabButton>
              <TabButton active={tab === "trends"} onClick={() => setTab("trends")}>Trends</TabButton>
              <TabButton active={tab === "breakdowns"} onClick={() => setTab("breakdowns")}>Breakdowns</TabButton>
              <TabButton active={tab === "all"} onClick={() => setTab("all")}>All modules</TabButton>
              <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>Orders</TabButton>
              <TabButton active={tab === "customers"} onClick={() => setTab("customers")}>Customers</TabButton>
              <TabButton active={tab === "products"} onClick={() => setTab("products")}>Products</TabButton>
              <TabButton active={tab === "otp"} onClick={() => setTab("otp")}>OTP</TabButton>
              <TabButton active={tab === "returns"} onClick={() => setTab("returns")}>Returns</TabButton>
              <TabButton active={tab === "staff"} onClick={() => setTab("staff")}>Staff</TabButton>
              <TabButton active={tab === "inventory"} onClick={() => setTab("inventory")}>Inventory</TabButton>
              <TabButton active={tab === "profit"} onClick={() => setTab("profit")}>Profit/Loss</TabButton>
              <TabButton active={tab === "pnl"} onClick={() => setTab("pnl")}>P&L</TabButton>
              <TabButton active={tab === "projections"} onClick={() => setTab("projections")}>Projections</TabButton>
              <TabButton active={tab === "table"} onClick={() => setTab("table")}>Table</TabButton>
              <TabButton active={tab === "report"} onClick={() => setTab("report")}>Report</TabButton>
              <TabButton active={tab === "export"} onClick={() => setTab("export")}>Export</TabButton>
              <TabButton active={tab === "diagnostics"} onClick={() => setTab("diagnostics")}>Diagnostics</TabButton>
            </div>
          </div>
        </div>

        <Notice tone={notice?.tone || "soft"} text={notice?.text || ""} onClose={() => setNotice({ tone: "soft", text: "" })} />
        {loading ? <Notice tone="soft" text="Updating analytics…" /> : null}

        {showControls ? (
          <Tile className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-black text-slate-900">Control Center</div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                  />
                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                  />
                  <BigCTAButton tone="primary" disabled={loading || !start || !end} onClick={reloadByRange}>
                    Apply range
                  </BigCTAButton>
                </div>

<div className="mt-3 flex flex-wrap items-center gap-2">
  <Pill tone="soft" className="shadow-none">Presets</Pill>
  {[
    ["7d", "Last 7D"],
    ["14d", "Last 14D"],
    ["30d", "Last 30D"],
    ["45d", "Last 45D"],
    ["mtd", "MTD"],
    ["prev_month", "Prev Month"],
    ["ytd", "YTD"],
  ].map(([k, label]) => (
    <BigCTAButton
      key={k}
      tone="secondary"
      disabled={loading}
      className="h-[44px] px-5 text-[12px] sm:text-[12px]"
      onClick={() => setPreset(k)}
    >
      {label}
    </BigCTAButton>
  ))}
</div>


                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["campaign", "Campaign (utm / label)"],
                    ["provider", "Provider (Stripe/bKash/Nagad...)"],
                    ["status", "Order status"],
                    ["paymentStatus", "Payment status"],
                    ["channel", "Channel (WEB/ADMIN/POPUP...)"],
                    ["source", "Source (DIRECT/ORGANIC/ADS...)"],
                  ].map(([key, ph]) => (
                    <input
                      key={key}
                      value={filters[key]}
                      onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder={ph}
                      className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <BigCTAButton
                    tone={showAdvanced ? "primary" : "secondary"}
                    disabled={loading}
                    className="h-[44px] px-6 text-[12px]"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    {showAdvanced ? "Hide advanced" : "Advanced options"}
                  </BigCTAButton>

                  <Pill tone="soft" className="shadow-none">
                    Bundle: include=<span className="mx-1 font-black">{include || "all"}</span>
                    {bundleParallel ? " • parallel" : ""}{bundleStrict ? " • strict" : ""}
                  </Pill>
                </div>

                {showAdvanced ? (
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_14px_40px_rgba(2,6,23,0.06)]">
                      <div className="text-[12px] font-black uppercase tracking-[0.10em] text-slate-600">Bundle & modules</div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <input
                          value={include}
                          onChange={(e) => setInclude(e.target.value)}
                          placeholder='include (e.g., "all" or "overview,orders,customers")'
                          className="h-[52px] rounded-full border border-slate-200/80 bg-white px-6 text-[12px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                        />

                        <input
                          value={String(moduleLimit)}
                          onChange={(e) => setModuleLimit(e.target.value)}
                          placeholder="module limit (e.g., 200)"
                          inputMode="numeric"
                          className="h-[52px] rounded-full border border-slate-200/80 bg-white px-6 text-[12px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                        />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setBundleParallel((v) => !v)}
                          className={cx(
                            "rounded-full border px-4 py-2 text-[12px] font-black shadow-[0_10px_26px_rgba(2,6,23,0.06)] transition hover:-translate-y-[1px]",
                            bundleParallel ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white/80 text-slate-900"
                          )}
                        >
                          {bundleParallel ? "Parallel ON" : "Parallel OFF"}
                        </button>

                        <button
                          type="button"
                          onClick={() => setBundleStrict((v) => !v)}
                          className={cx(
                            "rounded-full border px-4 py-2 text-[12px] font-black shadow-[0_10px_26px_rgba(2,6,23,0.06)] transition hover:-translate-y-[1px]",
                            bundleStrict ? "border-[var(--navy)] bg-[var(--navy)] text-white" : "border-slate-200 bg-white/80 text-slate-900"
                          )}
                        >
                          {bundleStrict ? "Strict ON" : "Strict OFF"}
                        </button>

                        <BigCTAButton
                          tone="accent"
                          disabled={loading}
                          className="h-[44px] px-6 text-[12px]"
                          onClick={() => { if (start && end) reloadByRange(); else reloadByDays(days); }}
                        >
                          Apply advanced
                        </BigCTAButton>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_14px_40px_rgba(2,6,23,0.06)]">
                      <div className="text-[12px] font-black uppercase tracking-[0.10em] text-slate-600">Profit / P&L knobs</div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <select
                          value={profitDimension}
                          onChange={(e) => setProfitDimension(e.target.value)}
                          className="h-[52px] rounded-full border border-slate-200/80 bg-white px-6 text-[12px] font-black tracking-tight text-slate-900 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                        >
                          <option value="product">Profit dimension: Product</option>
                          <option value="variant">Profit dimension: Variant</option>
                          <option value="batch">Profit dimension: Batch</option>
                        </select>

                        <select
                          value={refundAttribution}
                          onChange={(e) => setRefundAttribution(e.target.value)}
                          className="h-[52px] rounded-full border border-slate-200/80 bg-white px-6 text-[12px] font-black tracking-tight text-slate-900 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                        >
                          <option value="refund_date">Refund attribution: Refund date</option>
                          <option value="sale_date">Refund attribution: Sale date</option>
                        </select>

                        <select
                          value={pnlGroup}
                          onChange={(e) => setPnlGroup(e.target.value)}
                          className="h-[52px] rounded-full border border-slate-200/80 bg-white px-6 text-[12px] font-black tracking-tight text-slate-900 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                        >
                          <option value="week">P&L group: Week</option>
                          <option value="month">P&L group: Month</option>
                          <option value="quarter">P&L group: Quarter</option>
                          <option value="half">P&L group: Half-year</option>
                          <option value="year">P&L group: Year</option>
                          <option value="total">P&L group: Total</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => setProfitPaidOnly((v) => !v)}
                          className={cx(
                            "h-[52px] rounded-full border px-6 text-[12px] font-black shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:-translate-y-[1px]",
                            profitPaidOnly ? "border-[var(--gold)] bg-[var(--gold)] text-slate-900" : "border-slate-200 bg-white text-slate-900"
                          )}
                        >
                          {profitPaidOnly ? "Paid-only ON" : "Paid-only OFF"}
                        </button>
                      </div>

                      <div className="mt-3 text-[12px] font-semibold text-slate-500">
                        These knobs are sent to the bundle endpoint; modules that support them will reflect the settings.
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_14px_40px_rgba(2,6,23,0.06)] lg:col-span-2">
                      <div className="text-[12px] font-black uppercase tracking-[0.10em] text-slate-600">Advanced filters</div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                          ["audience", "Audience (segment)"],
                          ["warehouseId", "Warehouse ID"],
                          ["productId", "Product ID"],
                          ["variantId", "Variant ID"],
                          ["staffId", "Staff ID"],
                          ["customerId", "Customer ID"],
                          ["currency", "Currency (e.g., BDT)"],
                          ["country", "Country"],
                          ["city", "City"],
                          ["coupon", "Coupon code"],
                          ["utmSource", "utm_source"],
                          ["utmMedium", "utm_medium"],
                          ["utmCampaign", "utm_campaign"],
                        ].map(([key, ph]) => (
                          <input
                            key={key}
                            value={filters[key]}
                            onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={ph}
                            className="h-[52px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[12px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                          />
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <BigCTAButton
                          tone="accent"
                          disabled={loading}
                          className="h-[44px] px-6 text-[12px]"
                          onClick={() => {
                            if (start && end) reloadByRange();
                            else reloadByDays(days);
                            setNotice({ tone: "success", text: "Advanced filters applied." });
                          }}
                        >
                          Apply advanced filters
                        </BigCTAButton>
                        <BigCTAButton
                          tone="ghost"
                          disabled={loading}
                          className="h-[44px] px-6 text-[12px]"
                          onClick={() => setInclude("all")}
                        >
                          Reset include=all
                        </BigCTAButton>
                      </div>
                    </div>
                  </div>
                ) : null}


                <div className="mt-4 flex flex-wrap gap-2">
                  <BigCTAButton
                    tone="accent"
                    disabled={loading}
                    onClick={() => {
                      if (start && end) reloadByRange();
                      else reloadByDays(days);
                      setNotice({ tone: "success", text: "Filters applied." });
                    }}
                  >
                    Apply filters
                  </BigCTAButton>

                  <BigCTAButton
                    tone="secondary"
                    disabled={loading}
                    onClick={() => {
                      setFilters({
                        status: "",
                        paymentStatus: "",
                        provider: "",
                        channel: "",
                        source: "",
                        campaign: "",
                        audience: "",
                        warehouseId: "",
                        productId: "",
                        variantId: "",
                        staffId: "",
                        customerId: "",
                        currency: "",
                        country: "",
                        city: "",
                        coupon: "",
                        utmSource: "",
                        utmMedium: "",
                        utmCampaign: "",
                      });
                      setNotice({ tone: "soft", text: "Filters cleared." });
                    }}
                  >
                    Clear filters
                  </BigCTAButton>

                  <BigCTAButton
                    tone="ghost"
                    disabled={loading || (!start && !end)}
                    onClick={() => {
                      setStart("");
                      setEnd("");
                      reloadByDays(days);
                      setNotice({ tone: "soft", text: "Range cleared." });
                    }}
                  >
                    Clear range
                  </BigCTAButton>
                </div>

<div className="mt-4 flex flex-wrap items-center gap-2">
  {(start && end) ? (
    <Pill tone="navy">
      Range <span className="mx-1">{start}</span>→<span className="mx-1">{end}</span>
    </Pill>
  ) : null}

  {Object.entries(filters || {})
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => (
      <button
        key={k}
        type="button"
        onClick={() => setFilters((p) => ({ ...p, [k]: "" }))}
        className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-[12px] font-black text-slate-900 shadow-[0_10px_26px_rgba(2,6,23,0.06)] transition hover:-translate-y-[1px] hover:border-slate-300 hover:bg-slate-50 hover:shadow-[0_14px_36px_rgba(2,6,23,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-300"
        title="Click to remove filter"
      >
        <span className="uppercase tracking-[0.06em] text-slate-500">{k}</span>
        <span className="max-w-[180px] truncate">{String(v)}</span>
        <span className="text-slate-400 group-hover:text-slate-900">×</span>
      </button>
    ))}
</div>

              </div>

              <div className="w-full lg:max-w-[460px]">
                <div className="text-sm font-black text-slate-900">Saved views</div>

                <div className="mt-3 flex gap-2">
                  <input
                    value={viewName}
                    onChange={(e) => setViewName(e.target.value)}
                    placeholder="View name (e.g., Eid Week)"
                    className="h-[56px] w-full rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                  />
                  <BigCTAButton tone="primary" disabled={loading} onClick={saveCurrentView}>
                    Save
                  </BigCTAButton>
                </div>

                <div className="mt-3 space-y-2">
                  {(views || []).length ? (
                    (views || []).slice(0, 8).map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white/85 px-3 py-2 shadow-[0_14px_40px_rgba(2,6,23,0.07)]"
                      >
                        <button
                          type="button"
                          className={cx(
                            "min-w-0 flex-1 text-left truncate rounded-xl px-3 py-2",
                            "text-[12px] sm:text-[13px] font-black text-slate-900",
                            "transition hover:bg-slate-100/70 hover:-translate-y-[1px]"
                          )}
                          onClick={() => applyView(v)}
                        >
                          {safeText(v.name)}
                          <span className="ml-2 text-[11px] font-semibold text-slate-500">
                            {isoDate(v.at)}
                          </span>
                        </button>
                        <div className="shrink-0 flex gap-2">
                          <BigCTAButton
                            tone="secondary"
                            disabled={loading}
                            className="h-[44px] px-5 text-[12px]"
                            onClick={() => applyView(v)}
                          >
                            Apply
                          </BigCTAButton>
                          <BigCTAButton
                            tone="ghost"
                            disabled={loading}
                            className="h-[44px] px-5 text-[12px]"
                            onClick={() => deleteView(v.id)}
                          >
                            Delete
                          </BigCTAButton>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700">
                      No saved views yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Tile>
        ) : null}

        {/* ---------------- Overview ---------------- */}
        {tab === "overview" ? (
          <div className="space-y-4">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricKPI
                label={isLegacy ? "Revenue (sold statuses)" : "Revenue (paid)"}
                value={revenueValue}
                sub={isLegacy ? "Order.grandTotal aggregation" : "Paid & settled only"}
                right={
                  compareDelta ? (
                    <Pill tone={compareDelta.revenuePct >= 0 ? "success" : "danger"}>
                      {compareDelta.revenuePct >= 0 ? "+" : ""}
                      {safeToFixed(compareDelta?.revenuePct, 1)}%
                    </Pill>
                  ) : null
                }
              />
              <MetricKPI
                label="Orders"
                value={formatCompactInt(k.ordersCount ?? 0)}
                sub={k.paidRate != null ? `Paid rate: ${k.paidRate}%` : "Volume for the selected window"}
                right={
                  compareDelta ? (
                    <Pill tone={compareDelta.ordersPct >= 0 ? "success" : "danger"}>
                      {compareDelta.ordersPct >= 0 ? "+" : ""}
                      {safeToFixed(compareDelta?.ordersPct, 1)}%
                    </Pill>
                  ) : null
                }
              />
              <MetricKPI label="Avg order value" value={aov} sub={isLegacy ? "Revenue ÷ orders" : "Revenue ÷ paid orders"} />
              <MetricKPI
                label="Projection (next 7 buckets)"
                value={primaryMetric === "orders" ? formatCompactInt(derived.projection.ordersNext7) : money(derived.projection.revenueNext7)}
                sub="Directional signal"
                right={<Pill tone="soft">Group: {groupUnit.toUpperCase()}</Pill>}
              />
            </section>


<section className="grid gap-4 md:grid-cols-3">
  <Tile className="p-5 md:col-span-2">
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-sm font-black text-slate-900">Targets & goal tracking</div>
        <div className="mt-1 text-[12px] font-semibold text-slate-500">
          Local-only targets for quick executive context (stored in your browser).
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone="soft">Window: {days}D</Pill>
        {lastUpdatedAt ? (
          <Pill tone="soft">
            Updated <span className="mx-1">{new Date(lastUpdatedAt).toLocaleString()}</span>
          </Pill>
        ) : null}
      </div>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-[0_12px_32px_rgba(2,6,23,0.05)]">
        <div className="text-[12px] font-black uppercase tracking-[0.10em] text-slate-600">Revenue target</div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={targets.revenue}
            onChange={(e) => setTargets((p) => ({ ...p, revenue: e.target.value }))}
            placeholder="e.g., 5000000"
            inputMode="numeric"
            className="h-[52px] w-full rounded-full border border-slate-200/80 bg-white px-6 text-[13px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
          />
          <BigCTAButton
            tone="ghost"
            className="h-[52px] px-6 text-[12px]"
            disabled={loading}
            onClick={() => setTargets((p) => ({ ...p, revenue: "" }))}
            title="Clear target"
          >
            Clear
          </BigCTAButton>
        </div>

        {Number.isFinite(Number(targets.revenue)) && Number(targets.revenue) > 0 ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] font-black text-slate-700">
              <span>Progress</span>
              <span>
                {Math.min(999, Math.round((n(k.revenuePaid, 0) / Math.max(1, Number(targets.revenue))) * 100))}% · {money(n(k.revenuePaid, 0))} / {money(Number(targets.revenue))}
              </span>
            </div>
            <div className="mt-2 h-3 w-full rounded-full bg-slate-100">
              <div
                className="h-3 rounded-full bg-[var(--navy)]"
                style={{
                  ["--navy"]: NAVY,
                  width: `${Math.min(100, (n(k.revenuePaid, 0) / Math.max(1, Number(targets.revenue))) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 text-[12px] font-semibold text-slate-500">
            Set a numeric target to view progress.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-[0_12px_32px_rgba(2,6,23,0.05)]">
        <div className="text-[12px] font-black uppercase tracking-[0.10em] text-slate-600">Orders target</div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={targets.orders}
            onChange={(e) => setTargets((p) => ({ ...p, orders: e.target.value }))}
            placeholder="e.g., 1500"
            inputMode="numeric"
            className="h-[52px] w-full rounded-full border border-slate-200/80 bg-white px-6 text-[13px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_12px_32px_rgba(2,6,23,0.06)] transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
          />
          <BigCTAButton
            tone="ghost"
            className="h-[52px] px-6 text-[12px]"
            disabled={loading}
            onClick={() => setTargets((p) => ({ ...p, orders: "" }))}
            title="Clear target"
          >
            Clear
          </BigCTAButton>
        </div>

        {Number.isFinite(Number(targets.orders)) && Number(targets.orders) > 0 ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] font-black text-slate-700">
              <span>Progress</span>
              <span>
                {Math.min(999, Math.round((n(k.ordersCount, 0) / Math.max(1, Number(targets.orders))) * 100))}% · {formatCompactInt(n(k.ordersCount, 0))} / {formatCompactInt(Number(targets.orders))}
              </span>
            </div>
            <div className="mt-2 h-3 w-full rounded-full bg-slate-100">
              <div
                className="h-3 rounded-full bg-[var(--gold)]"
                style={{
                  ["--gold"]: GOLD,
                  width: `${Math.min(100, (n(k.ordersCount, 0) / Math.max(1, Number(targets.orders))) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 text-[12px] font-semibold text-slate-500">
            Set a numeric target to view progress.
          </div>
        )}
      </div>
    </div>
  </Tile>

  <Tile className="p-5">
    <div className="text-sm font-black text-slate-900">Quick insights</div>
    <div className="mt-1 text-[12px] font-semibold text-slate-500">
      Lightweight derived signals (local compute).
    </div>

    <div className="mt-4 space-y-2">
      <KpiMini label="Peak revenue day" value={`${safeText(derived.peakRevenue?.day)} · ${money(derived.peakRevenue?.revenuePaid)}`} />
      <KpiMini label="Peak orders day" value={`${safeText(derived.peakOrders?.day)} · ${formatCompactInt(derived.peakOrders?.orders)}`} />
      <KpiMini label="Trend (rev)" value={`${derived.trendRevPct >= 0 ? "+" : ""}${safeToFixed(derived.trendRevPct, 1)}%`} />
      <KpiMini label="Trend (orders)" value={`${derived.trendOrdersPct >= 0 ? "+" : ""}${safeToFixed(derived.trendOrdersPct, 1)}%`} />
    </div>

    <div className="mt-4">
      <BigCTAButton
        tone="secondary"
        disabled={loading}
        onClick={() => {
          setTargets(loadTargetsSafe());
          setNotice({ tone: "soft", text: "Targets reloaded (local)." });
        }}
      >
        Reload targets
      </BigCTAButton>
    </div>
  </Tile>
</section>

            <section className="grid gap-4 md:grid-cols-2">
              <Tile className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">Run-rate projections</div>
                    <div className="mt-1 text-[12px] font-semibold text-slate-500">
                      Monthly / quarterly / half-year / yearly based on current window momentum.
                    </div>
                  </div>
                  <Pill tone={derived.trendRevPct >= 0 ? "success" : "danger"}>
                    {derived.trendRevPct >= 0 ? "+" : ""}
                    {safeToFixed(derived.trendRevPct, 1)}% rev
                  </Pill>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <KpiMini label="30 days" value={money(derived.runRate.rev30)} />
                  <KpiMini label="90 days" value={money(derived.runRate.rev90)} />
                  <KpiMini label="180 days" value={money(derived.runRate.rev180)} />
                  <KpiMini label="365 days" value={money(derived.runRate.rev365)} />
                </div>
              </Tile>

              <Tile className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">Signal quality</div>
                    <div className="mt-1 text-[12px] font-semibold text-slate-500">
                      Stability, concentration, and peaks.
                    </div>
                  </div>
                  <Pill tone="soft">
                    Top 20%: {((derived.concentration.topShare || 0) * 100).toFixed(1)}%
                  </Pill>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <KpiMini label="Volatility (rev)" value={`${(derived.volRevenue * 100).toFixed(1)}%`} />
                  <KpiMini label="Volatility (orders)" value={`${(derived.volOrders * 100).toFixed(1)}%`} />
                  <KpiMini label="Peak revenue" value={`${safeText(derived.peakRevenue?.day)} · ${money(derived.peakRevenue?.revenuePaid)}`} />
                  <KpiMini label="Peak orders" value={`${safeText(derived.peakOrders?.day)} · ${formatCompactInt(derived.peakOrders?.orders)}`} />
                </div>
              </Tile>
            </section>

            <Tile className="p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Weekday performance</div>
                  <div className="mt-1 text-[12px] font-semibold text-slate-500">
                    Revenue and orders distribution by weekday (local time).
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Pill tone="soft">TZ offset: {tzOffsetMinutes}m</Pill>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-left">
                  <thead className="bg-slate-50">
                    <tr className="text-xs font-black text-slate-700">
                      <th className="px-4 py-3">Day</th>
                      <th className="px-4 py-3">Orders</th>
                      <th className="px-4 py-3">Revenue</th>
                      <th className="px-4 py-3">Revenue / bucket</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(weekday || []).map((w) => (
                      <tr key={w.dow} className="border-t border-slate-100 text-sm">
                        <td className="px-4 py-3 font-black text-slate-900">{dowLabel(w.dow)}</td>
                        <td className="px-4 py-3 font-black text-slate-900">{formatCompactInt(w.orders)}</td>
                        <td className="px-4 py-3 font-black text-slate-900">{money(w.revenuePaid)}</td>
                        <td className="px-4 py-3 font-black text-slate-900">{money(w.revPerBucket)}</td>
                      </tr>
                    ))}
                    {!weekday?.length ? (
                      <tr>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-500" colSpan={4}>
                          No weekday data.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Tile>

            {compareOn && compare?.overview ? (
              <Tile className="p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-900">Compare snapshot</div>
                    <div className="mt-1 text-[12px] font-semibold text-slate-500">
                      Previous window (same duration).
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Pill tone="soft">Prev revenue: {money(compare.overview?.kpis?.revenuePaid)}</Pill>
                    <Pill tone="soft">Prev orders: {formatCompactInt(compare.overview?.kpis?.ordersCount)}</Pill>
                  </div>
                </div>
              </Tile>
            ) : null}
          </div>
        ) : null}

        {/* ---------------- Trends ---------------- */}
        {tab === "trends" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Trends</div>
                  <div className="mt-1 text-[12px] font-semibold text-slate-500">
                    Chart controls + operational signals.
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <select
                    value={primaryMetric}
                    disabled={loading}
                    onChange={(e) => setPrimaryMetric(e.target.value === "orders" ? "orders" : "revenuePaid")}
                    className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                  >
                    <option value="revenuePaid">Revenue</option>
                    <option value="orders">Orders</option>
                  </select>

                  <select
                    value={groupUnit}
                    disabled={loading}
                    onChange={(e) => setGroupUnit(["day", "week", "month"].includes(e.target.value) ? e.target.value : "day")}
                    className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>

                  <BigCTAButton tone={smooth ? "primary" : "secondary"} disabled={loading} onClick={() => setSmooth((v) => !v)}>
                    {smooth ? "Smoothing ON" : "Smoothing OFF"}
                  </BigCTAButton>

                  <BigCTAButton tone="accent" disabled={loading} onClick={exportCSV}>Export CSV</BigCTAButton>
                  <BigCTAButton tone="secondary" disabled={loading} onClick={copyShareLink}>Copy link</BigCTAButton>
                  <BigCTAButton tone="ghost" disabled={loading} onClick={printView}>Print</BigCTAButton>
                </div>
              </div>

              <div className="mt-4">
                {primaryMetric === "orders" ? (
                  <MiniBars data={chartSeries || []} valueKey="orders" />
                ) : (
                  <MiniLineChart data={chartSeries || []} valueKey="revenuePaid" />
                )}
              </div>
            </Tile>

            <div className="grid gap-4 md:grid-cols-2">
              <Tile className="p-5">
                <div className="text-sm font-black text-slate-900">Anomalies (orders)</div>
                <div className="mt-3 space-y-2">
                  {derived.anomaliesOrders?.length ? (
                    derived.anomaliesOrders.map((a) => (
                      <div key={a.day} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="text-xs font-black text-slate-900">{a.day}</div>
                        <div className="flex items-center gap-2">
                          <Pill tone="soft">{formatCompactInt(a.v)}</Pill>
                          <Pill tone={Math.abs(a.z) >= 2.5 ? "warn" : "neutral"}>z {a.z.toFixed(1)}</Pill>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs font-semibold text-slate-500">No anomaly data.</div>
                  )}
                </div>
              </Tile>

              <Tile className="p-5">
                <div className="text-sm font-black text-slate-900">Anomalies (revenue)</div>
                <div className="mt-3 space-y-2">
                  {derived.anomaliesRevenue?.length ? (
                    derived.anomaliesRevenue.map((a) => (
                      <div key={a.day} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="text-xs font-black text-slate-900">{a.day}</div>
                        <div className="flex items-center gap-2">
                          <Pill tone="soft">{money(a.v)}</Pill>
                          <Pill tone={Math.abs(a.z) >= 2.5 ? "warn" : "neutral"}>z {a.z.toFixed(1)}</Pill>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs font-semibold text-slate-500">No anomaly data.</div>
                  )}
                </div>
              </Tile>
            </div>
          </div>
        ) : null}

        {/* ---------------- Breakdowns ---------------- */}
        {tab === "breakdowns" ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Tile className="p-5 lg:col-span-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Breakdowns</div>
                  <div className="mt-1 text-[12px] font-semibold text-slate-500">
                    Status and posture distribution (auto-populates when API provides maps).
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BigCTAButton
                    tone="accent"
                    disabled={loading}
                    onClick={() => {
                      if (start && end) reloadByRange();
                      else reloadByDays(days);
                    }}
                  >
                    Refresh
                  </BigCTAButton>
                  <BigCTAButton tone="secondary" disabled={loading} onClick={copyShareLink}>
                    Copy link
                  </BigCTAButton>
                </div>
              </div>
            </Tile>

            {b?.status ? <BreakdownBlock title="Order status" map={b.status} /> : <EmptyBreakdown title="Order status" />}
            {b?.payment ? <BreakdownBlock title="Payment status" map={b.payment} /> : <EmptyBreakdown title="Payment status" />}
            {b?.fulfillment ? <BreakdownBlock title="Fulfillment status" map={b.fulfillment} /> : <EmptyBreakdown title="Fulfillment status" />}
          </div>
        ) : null}

        
        {/* ---------------- All modules ---------------- */}
        {tab === "all" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">All modules</div>
                  <div className="mt-1 text-[12px] font-semibold text-slate-500">
                    Every analytics module requested from the bundle endpoint (include=all). Module errors render inline.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BigCTAButton
                    tone="accent"
                    disabled={loading}
                    onClick={() => { if (start && end) reloadByRange(); else reloadByDays(days); }}
                  >
                    Refresh all
                  </BigCTAButton>
                  <BigCTAButton tone="secondary" disabled={loading} onClick={copyShareLink}>
                    Copy link
                  </BigCTAButton>
                </div>
              </div>
            </Tile>

            {(modules && Object.keys(modules).length) ? (
              Object.keys(modules)
                .slice()
                .sort((a, b) => a.localeCompare(b))
                .map((key) => (
                  <ModuleRenderer
                    key={key}
                    title={`Module: ${key}`}
                    module={modules[key]}
                    money={money}
                  />
                ))
            ) : (
              <Tile className="p-5">
                <div className="text-sm font-black text-slate-900">No module payload</div>
                <div className="mt-1 text-[12px] font-semibold text-slate-500">
                  The bundle response did not include any modules. Ensure the client is fetching /api/admin/analytics/bundle with include=all.
                </div>
              </Tile>
            )}
          </div>
        ) : null}

{/* ---------------- Orders ---------------- */}
        {tab === "orders" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Orders module</div>
                  <div className="mt-1 text-[12px] font-semibold text-slate-500">
                    Completion, pending, sent, returned, refund/exchange posture and reasons (from DB).
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BigCTAButton tone="accent" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/pdf", null)}>
                    Server PDF
                  </BigCTAButton>
                  <BigCTAButton tone="secondary" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/docx", null)}>
                    Server DOCX
                  </BigCTAButton>
                  <BigCTAButton tone="ghost" disabled={loading} onClick={() => { if (start && end) reloadByRange(); else reloadByDays(days); }}>
                    Refresh
                  </BigCTAButton>
                </div>
              </div>
            </Tile>

            <ModuleRenderer
              title="Orders analytics"
              module={modOrders}
              money={money}
            />

            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Order breakdown snapshots</div>
              <div className="mt-3 grid gap-4 lg:grid-cols-3">
                {b?.status ? <BreakdownBlock title="Order status" map={b.status} /> : <EmptyBreakdown title="Order status" />}
                {b?.payment ? <BreakdownBlock title="Payment status" map={b.payment} /> : <EmptyBreakdown title="Payment status" />}
                {b?.fulfillment ? <BreakdownBlock title="Fulfillment status" map={b.fulfillment} /> : <EmptyBreakdown title="Fulfillment status" />}
              </div>
            </Tile>
          </div>
        ) : null}

        {/* ---------------- Customers ---------------- */}
        {tab === "customers" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Customers module</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                Accounts, account-wise orders & spend, carts & wishlist posture (from DB).
              </div>
            </Tile>

            <ModuleRenderer title="Customers analytics" module={modCustomers} money={money} />
          </div>
        ) : null}

        {/* ---------------- Products ---------------- */}
        {tab === "products" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Products module</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                Best-selling, trending, demand by period, remaining stock analysis (from DB).
              </div>
            </Tile>

            <ModuleRenderer title="Products analytics" module={modProducts} money={money} />
          </div>
        ) : null}

        {/* ---------------- OTP ---------------- */}
        {tab === "otp" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">OTP module</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                OTP counts by purpose, delivery posture, verification rates, projections (from DB).
              </div>
            </Tile>

            <ModuleRenderer title="OTP analytics" module={modOtp} money={money} />
          </div>
        ) : null}

        {/* ---------------- Returns / Refunds / Exchanges ---------------- */}
        {tab === "returns" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Returns / Refunds / Exchanges module</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                Reason breakdowns, outcome posture, refund totals (from DB).
              </div>
            </Tile>

            <ModuleRenderer title="Returns analytics" module={modReturns} money={money} />
          </div>
        ) : null}

        {/* ---------------- Staff ---------------- */}
        {tab === "staff" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Staff module</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                Admin/staff operational performance over time (from DB).
              </div>
            </Tile>

            <ModuleRenderer title="Staff analytics" module={modStaff} money={money} />
          </div>
        ) : null}

        
        {/* ---------------- Inventory ---------------- */}
        {tab === "inventory" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Inventory module</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                On-hand, reserved, available, low-stock posture and risk (from DB).
              </div>
            </Tile>

            <ModuleRenderer title="Inventory analytics" module={modInventory} money={money} />
          </div>
        ) : null}

{/* ---------------- Profit/Loss ---------------- */}
        {tab === "profit" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Profit/Loss module</div>
                  <div className="mt-1 text-[12px] font-semibold text-slate-500">
                    Product / batch / time profitability and margin posture (from DB).
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BigCTAButton tone="primary" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/pdf", null)}>
                    Server PDF
                  </BigCTAButton>
                  <BigCTAButton tone="secondary" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/docx", null)}>
                    Server DOCX
                  </BigCTAButton>
                </div>
              </div>
            </Tile>

            <ModuleRenderer title="Profit/Loss analytics" module={modProfit} money={money} />
          </div>
        ) : null}

        
        {/* ---------------- P&L ---------------- */}
        {tab === "pnl" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">P&L totals</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                Consolidated P&L grouped totals (month/quarter/half/year/total) where supported.
              </div>
            </Tile>

            <ModuleRenderer title="P&L totals" module={modPnl} money={money} />
          </div>
        ) : null}

{/* ---------------- Projections ---------------- */}
        {tab === "projections" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Projections module</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-500">
                Monthly, quarterly, half-yearly, yearly forecasts (from DB + model logic).
              </div>
            </Tile>

            <ModuleRenderer title="Projections" module={modProjections} money={money} />
          </div>
        ) : null}

        {/* ---------------- Table ---------------- */}
        {tab === "table" ? (
          <Tile className="p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black text-slate-900">Series table</div>
                <div className="mt-1 text-[12px] font-semibold text-slate-500">Audit view for exports.</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                >
                  <option value="day">Sort: Day</option>
                  <option value="orders">Sort: Orders</option>
                  <option value="revenuePaid">Sort: Revenue</option>
                </select>

                <input
                  value={tableQuery}
                  onChange={(e) => setTableQuery(e.target.value)}
                  placeholder="Search bucket…"
                  className="h-[56px] w-[220px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                />

                <select
                  value={tableLimit}
                  onChange={(e) => setTableLimit(Number(e.target.value))}
                  className="h-[56px] rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
                  title="Max rows"
                >
                  {[50, 100, 200, 500].map((n) => (
                    <option key={n} value={n}>Top {n}</option>
                  ))}
                </select>

                <BigCTAButton tone="secondary" disabled={loading} onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
                  {sortDir === "asc" ? "ASC" : "DESC"}
                </BigCTAButton>

                <BigCTAButton tone="accent" disabled={loading} onClick={exportCSV}>Export CSV</BigCTAButton>
                <BigCTAButton tone="secondary" disabled={loading} onClick={exportJSON}>Export JSON</BigCTAButton>
                <BigCTAButton tone="secondary" disabled={loading} onClick={exportExcel}>Export Excel</BigCTAButton>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left">
                <thead className="bg-slate-50">
                  <tr className="text-xs font-black text-slate-700">
                    <th className="px-4 py-3">Bucket</th>
                    <th className="px-4 py-3">Orders</th>
                    <th className="px-4 py-3">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(visibleTableRows || []).map((r) => (
                    <tr key={r.day} className="border-t border-slate-100 text-sm">
                      <td className="px-4 py-3 font-black text-slate-900">{r.day}</td>
                      <td className="px-4 py-3 font-black text-slate-900">{formatCompactInt(r.orders)}</td>
                      <td className="px-4 py-3 font-black text-slate-900">{money(r.revenuePaid)}</td>
                    </tr>
                  ))}
                  {!visibleTableRows?.length ? (
                    <tr>
                      <td className="px-4 py-4 text-sm font-semibold text-slate-500" colSpan={3}>
                        No series data.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Tile>
        ) : null}

        {/* ---------------- Report ---------------- */}
        {tab === "report" ? (
          <div className="space-y-4">
            <Tile className="p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">Report</div>
                  <div className="mt-1 text-[12px] font-semibold text-slate-500">
                    Full narrative + detailed blocks (from DB via bundle/report endpoint).
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <BigCTAButton tone="primary" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/pdf", null)}>
                    Server PDF
                  </BigCTAButton>
                  <BigCTAButton tone="secondary" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/docx", null)}>
                    Server DOCX
                  </BigCTAButton>
                  <BigCTAButton tone="ghost" disabled={loading} onClick={exportJSON}>
                    Export JSON
                  </BigCTAButton>
                </div>
              </div>
            </Tile>

            <ModuleRenderer title="Report payload" module={modReport} money={money} />

            {rawBundle ? (
              <Tile className="p-5">
                <div className="text-sm font-black text-slate-900">Bundle (audit)</div>
                <div className="mt-2 text-[12px] font-semibold text-slate-500">
                  Raw bundle response for verification.
                </div>
                <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs font-semibold text-slate-700 overflow-x-auto">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(rawBundle, null, 2)}</pre>
                </div>
              </Tile>
            ) : null}
          </div>
        ) : null}

        {/* ---------------- Export ---------------- */}
        {tab === "export" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Export (fast)</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <BigCTAButton tone="accent" disabled={loading} onClick={exportCSV}>CSV</BigCTAButton>
                <BigCTAButton tone="secondary" disabled={loading} onClick={exportJSON}>JSON</BigCTAButton>
                <BigCTAButton tone="secondary" disabled={loading} onClick={exportExcel}>Excel</BigCTAButton>
                <BigCTAButton tone="secondary" disabled={loading} onClick={exportDoc}>DOC</BigCTAButton>
                <BigCTAButton tone="primary" disabled={loading} onClick={exportPDF}>PDF (Print)</BigCTAButton>
              </div>
            </Tile>

            <Tile className="p-5">
              <div className="text-sm font-black text-slate-900">Export (server)</div>
              <div className="mt-2 text-[12px] font-semibold text-slate-500">
                Uses your API routes so exports are consistent with DB analytics.
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <BigCTAButton tone="primary" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/pdf", null)}>
                  PDF
                </BigCTAButton>
                <BigCTAButton tone="secondary" disabled={loading} onClick={() => exportServer("/api/admin/analytics/export/docx", null)}>
                  DOCX
                </BigCTAButton>
                <BigCTAButton tone="ghost" disabled={loading} onClick={copyShareLink}>
                  Copy share link
                </BigCTAButton>
              </div>
            </Tile>
          </div>
        ) : null}

{/* ---------------- Diagnostics ---------------- */}
{tab === "diagnostics" ? (
  <div className="grid gap-4 lg:grid-cols-2">
    <Tile className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">Diagnostics</div>
          <div className="mt-1 text-[12px] font-semibold text-slate-500">
            Client-side state, data mode, and payload inspection (no server mutation).
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="soft">Mode: {mode}</Pill>
          <Pill tone="soft">Series: {formatCompactInt(grouped?.length || 0)}</Pill>
          {modules ? <Pill tone="soft">Modules: {formatCompactInt(Object.keys(modules || {}).length)}</Pill> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <KpiMini label="Window" value={`${days} days`} />
        <KpiMini label="Group" value={String(groupUnit).toUpperCase()} />
        <KpiMini label="Metric" value={primaryMetric === "orders" ? "Orders" : "Revenue"} />
        <KpiMini label="Smooth" value={smooth ? "ON" : "OFF"} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-4">
        <div className="text-[12px] font-black uppercase tracking-[0.10em] text-slate-600">Current params</div>
        <div className="mt-2 grid gap-2 text-[12px] font-semibold text-slate-700">
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Range</span><span className="font-black">{start && end ? `${start} → ${end}` : "—"}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">TZ offset</span><span className="font-black">{tzOffsetMinutes}m</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Auto-refresh</span><span className="font-black">{autoRefresh ? "ON" : "OFF"}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Last updated</span><span className="font-black">{lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : "—"}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Last latency</span><span className="font-black">{lastLoadMs != null ? `${lastLoadMs}ms` : "—"}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Online</span><span className="font-black">{isOnline ? "YES" : "NO"}</span></div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <BigCTAButton
          tone="primary"
          disabled={loading}
          onClick={copyShareLink}
        >
          Copy share link
        </BigCTAButton>
        <BigCTAButton
          tone="secondary"
          disabled={loading}
          onClick={() => {
            try {
              const payload = {
                tab,
                mode,
                days,
                start,
                end,
                groupUnit,
                primaryMetric,
                smooth,
                autoRefresh,
                filters,
                derived,
                overview,
                modules: Object.keys(modules || {}),
                exportedAt: new Date().toISOString(),
              };
              const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `analytics_diagnostics_${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              setNotice({ tone: "success", text: "Diagnostics JSON downloaded." });
            } catch {
              setNotice({ tone: "warn", text: "Could not generate diagnostics JSON." });
            }
          }}
        >
          Download diagnostics JSON
        </BigCTAButton>
        <BigCTAButton tone="ghost" disabled={loading} onClick={printView}>
          Print
        </BigCTAButton>
      </div>
    </Tile>

    <Tile className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">Payload search</div>
          <div className="mt-1 text-[12px] font-semibold text-slate-500">
            Find keys/values inside the current bundle (limited results for safety).
          </div>
        </div>
        <Pill tone="soft">Raw: {rawBundle ? "YES" : "NO"}</Pill>
      </div>

      <div className="mt-3">
        <input
          value={diagQuery}
          onChange={(e) => setDiagQuery(e.target.value)}
          placeholder="Search key/value… (e.g., bkash, delivered, otp)"
          className="h-[56px] w-full rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
        />
      </div>

      <div className="mt-3 space-y-2">
        {diagQuery.trim() ? (
          diagMatches.length ? (
            diagMatches.map((p) => (
              <div key={p} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-[12px] font-black text-slate-900">
                {p}
              </div>
            ))
          ) : (
            <div className="text-[12px] font-semibold text-slate-500">No matches.</div>
          )
        ) : (
          <div className="text-[12px] font-semibold text-slate-500">
            Enter a query to scan keys/values. This is a client-only inspection tool.
          </div>
        )}
      </div>

      <div className="mt-4">
        <BigCTAButton
          tone="secondary"
          disabled={loading || !rawBundle}
          onClick={() => {
            try {
              const blob = new Blob([JSON.stringify(rawBundle, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `analytics_raw_bundle_${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              setNotice({ tone: "success", text: "Raw bundle downloaded." });
            } catch {
              setNotice({ tone: "warn", text: "Could not download raw bundle." });
            }
          }}
        >
          Download raw bundle
        </BigCTAButton>
      </div>
    </Tile>
  </div>
) : null}

      </div>
    </div>
  );
}

/* ---------------- small UI helpers ---------------- */


function safeToFixed(v, digits = 1) {
  const x = Number(v);
  if (!Number.isFinite(x)) return (0).toFixed(digits);
  return x.toFixed(digits);
}
function KpiMini({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
      <div className="text-[12px] font-black text-slate-700">{label}</div>
      <div className="mt-1 text-[18px] font-black text-slate-900">{value}</div>
    </div>
  );
}

/* ---- Breakdown UI ---- */
function EmptyBreakdown({ title }) {
  return (
    <Tile className="p-5">
      <div className="text-sm font-black text-slate-900">{title}</div>
      <div className="mt-2 text-[12px] font-semibold text-slate-500">No data.</div>
    </Tile>
  );
}

function BreakdownBlock({ title, map }) {
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const all = Object.entries(map || {})
      .map(([k, v]) => ({ k, v: n(v) }))
      .sort((a, b) => b.v - a.v);

    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((r) => String(r.k).toLowerCase().includes(s));
  }, [map, q]);

  const total = rows.reduce((s, r) => s + r.v, 0);

  return (
    <Tile className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">{title}</div>
          <div className="mt-1 text-[12px] font-semibold text-slate-500">Distribution</div>
        </div>
        <Pill tone="soft">{formatCompactInt(total)} total</Pill>
      </div>

      <div className="mt-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="h-[56px] w-full rounded-full border border-slate-200/80 bg-white/90 px-6 text-[13px] sm:text-[14px] font-black tracking-tight text-slate-900 placeholder:text-slate-400 outline-none shadow-[0_14px_40px_rgba(2,6,23,0.07)] transition hover:border-slate-300 hover:shadow-[0_20px_62px_rgba(2,6,23,0.09)] focus:border-slate-300 focus:ring-2 focus:ring-[rgba(15,33,71,0.18)]"
        />
      </div>

      <div className="mt-3 space-y-2">
        {rows.length ? (
          rows.slice(0, 12).map((r) => (
            <div
              key={r.k}
              className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <div className="min-w-0 truncate text-xs font-black text-slate-900">{r.k}</div>
              <div className="shrink-0 text-xs font-black text-slate-900">{formatCompactInt(r.v)}</div>
            </div>
          ))
        ) : (
          <div className="text-xs font-semibold text-slate-500">No matches.</div>
        )}
      </div>
    </Tile>
  );
}

