// FILE: app/(admin)/admin/analytics/_lib/utils.js
// Shared helpers for the Admin Analytics client (client-safe only).

/** TDLC Brand */
export const NAVY = "#0F2147";
export const GOLD = "#D4AF37";
export const NAVY_2 = "#183A7B";

/* ---------------- tiny helpers ---------------- */
export function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}

export function isoDate(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

export function localISODate(d) {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}

export function safeText(v, fallback = "—") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

export function pct(cur, prev) {
  const p = n(prev, 0);
  if (!p) return 0;
  return ((n(cur, 0) - p) / Math.max(1e-9, p)) * 100;
}

export function formatCompactInt(x) {
  const v = n(x, 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

export function median(arr) {
  const a = (arr || []).map((x) => n(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function mad(arr) {
  const m = median(arr);
  const dev = (arr || []).map((x) => Math.abs(n(x) - m));
  return median(dev);
}

export function movingAvg(arr, key, window = 7) {
  const xs = Array.isArray(arr) ? arr : [];
  if (!xs.length) return [];
  const out = [];
  for (let i = 0; i < xs.length; i++) {
    const from = Math.max(0, i - window + 1);
    const slice = xs.slice(from, i + 1);
    const v =
      slice.reduce((s, r) => s + n(r?.[key], 0), 0) / Math.max(1, slice.length);
    out.push({ ...xs[i], [`${key}MA`]: v });
  }
  return out;
}

export function startOfWeekISO(dateISO) {
  const d = new Date(dateISO + "T00:00:00.000Z");
  if (Number.isNaN(d.getTime())) return dateISO;
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function startOfMonthISO(dateISO) {
  const d = new Date(dateISO + "T00:00:00.000Z");
  if (Number.isNaN(d.getTime())) return dateISO;
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

export function groupSeries(series, unit) {
  const xs = Array.isArray(series) ? series : [];
  if (unit === "day") return xs;

  const keyFn =
    unit === "week"
      ? (day) => startOfWeekISO(day)
      : unit === "month"
      ? (day) => startOfMonthISO(day)
      : (day) => day;

  const m = new Map();
  for (const r of xs) {
    const day = safeText(r?.day || r?.date || "");
    const bucket = keyFn(day);
    if (!m.has(bucket)) m.set(bucket, { day: bucket, orders: 0, revenuePaid: 0 });
    const b = m.get(bucket);
    b.orders += n(r?.orders, 0);
    b.revenuePaid += n(r?.revenuePaid ?? r?.revenue ?? 0, 0);
  }
  return Array.from(m.values()).sort((a, b) =>
    String(a.day).localeCompare(String(b.day))
  );
}

export function tryParseSearch() {
  if (typeof window === "undefined") return null;
  try {
    const sp = new URL(window.location.href).searchParams;
    const days = sp.get("days");
    const start = sp.get("start");
    const end = sp.get("end");
    const group = sp.get("group");
    const metric = sp.get("metric");
    const smooth = sp.get("smooth");
    const auto = sp.get("auto");
    const tab = sp.get("tab");

    return {
      days: days ? clamp(Number(days), 1, 3650) : null,
      start: start || "",
      end: end || "",
      group: group || "",
      metric: metric || "",
      smooth: smooth === "0" ? false : smooth === "1" ? true : null,
      auto: auto === "1" ? true : auto === "0" ? false : null,
      tab: tab || "",
    };
  } catch {
    return null;
  }
}

/* ---------------- extended computations ---------------- */
export function safeISO(d) {
  const s = String(d || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function toLocalDow(dateISO, tzOffsetMinutes = 0) {
  const s = safeISO(dateISO);
  if (!s) return null;
  const base = new Date(s + "T00:00:00.000Z");
  if (Number.isNaN(base.getTime())) return null;
  const shifted = new Date(base.getTime() + tzOffsetMinutes * 60_000);
  return shifted.getUTCDay(); // 0..6
}

export function dowLabel(dow) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dow] || "—";
}

export function weekdayBreakdown(series, tzOffsetMinutes) {
  const xs = Array.isArray(series) ? series : [];
  const acc = new Map();
  for (const r of xs) {
    const dow = toLocalDow(r?.day || r?.date, tzOffsetMinutes);
    if (dow == null) continue;
    if (!acc.has(dow)) acc.set(dow, { dow, orders: 0, revenuePaid: 0, buckets: 0 });
    const row = acc.get(dow);
    row.orders += n(r?.orders, 0);
    row.revenuePaid += n(r?.revenuePaid ?? r?.revenue ?? 0, 0);
    row.buckets += 1;
  }
  const out = Array.from(acc.values()).map((r) => ({
    ...r,
    aovBucket: r.orders > 0 ? r.revenuePaid / Math.max(1, r.orders) : 0,
    revPerBucket: r.buckets > 0 ? r.revenuePaid / Math.max(1, r.buckets) : 0,
    ordersPerBucket: r.buckets > 0 ? r.orders / Math.max(1, r.buckets) : 0,
  }));
  out.sort((a, b) => a.dow - b.dow);
  return out;
}

export function concentrationTopShare(series, valueKey = "revenuePaid", topFrac = 0.2) {
  const xs = Array.isArray(series) ? series : [];
  if (!xs.length) return { topShare: 0, topCount: 0, total: 0 };
  const vals = xs.map((r) => n(r?.[valueKey], 0)).sort((a, b) => b - a);
  const total = vals.reduce((s, v) => s + v, 0);
  const topCount = Math.max(1, Math.round(vals.length * topFrac));
  const topSum = vals.slice(0, topCount).reduce((s, v) => s + v, 0);
  return { topShare: total > 0 ? topSum / total : 0, topCount, total };
}

export function linRegPredictNext(values, steps = 7) {
  const ys = (values || []).map((v) => n(v));
  const m = ys.length;
  if (m < 4) return Array.from({ length: steps }, () => 0);

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (let i = 0; i < m; i++) {
    const x = i;
    const y = ys[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = m * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (m * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / m;

  const out = [];
  for (let s = 1; s <= steps; s++) {
    const x = m - 1 + s;
    out.push(intercept + slope * x);
  }
  return out.map((v) => Math.max(0, v));
}

export function runRate(totalValue, windowDays, targetDays) {
  const wd = Math.max(1, n(windowDays, 0));
  const perDay = n(totalValue, 0) / wd;
  return perDay * n(targetDays, 0);
}

export function heuristicProjectionFromTrend(totalValue, windowDays, targetDays, trendPct) {
  const base = runRate(totalValue, windowDays, targetDays);
  const t = clamp(n(trendPct, 0) / 100, -0.6, 1.2);
  return Math.max(0, base * (1 + 0.35 * t));
}
