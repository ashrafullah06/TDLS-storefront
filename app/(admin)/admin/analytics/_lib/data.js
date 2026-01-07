// FILE: app/(admin)/admin/analytics/_lib/data.js
"use client";

/**
 * Admin Analytics (Client Data Loader)
 * - Always fetches the bundle endpoint (advanced mode) and requests ALL modules by default.
 * - Normalizes unknown module shapes defensively so UI never hard-crashes.
 * - Does not depend on customer session/cookies; relies on browser fetch credentials for admin cookies only.
 */

function safeStr(v) {
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

function cleanParam(v) {
  const s = safeStr(v).trim();
  return s ? s : "";
}

function appendIf(sp, key, val) {
  const v = cleanParam(val);
  if (v) sp.set(key, v);
}

function appendFilter(sp, key, val) {
  const v = cleanParam(val);
  if (!v) return;
  sp.set(key, v);
}

function extractSeries(timeseries) {
  if (!timeseries) return [];
  // common shapes:
  // - { series: [...] }
  // - { rows: [...] }
  // - { data: [...] }
  // - [...] (already a series array)
  if (Array.isArray(timeseries)) return timeseries;
  if (Array.isArray(timeseries.series)) return timeseries.series;
  if (Array.isArray(timeseries.rows)) return timeseries.rows;
  if (Array.isArray(timeseries.data)) return timeseries.data;
  // sometimes modules return an object with a top-level "buckets"
  if (Array.isArray(timeseries.buckets)) return timeseries.buckets;
  return [];
}

function splitModules(data) {
  const d = data && typeof data === "object" ? data : {};
  const modules = {};
  for (const k of Object.keys(d)) {
    if (k === "overview" || k === "timeseries") continue;
    modules[k] = d[k];
  }
  return modules;
}

export function buildBundleUrl({
  days,
  start,
  end,
  group,
  compare,
  tzOffsetMinutes,
  include,
  parallel,
  strict,
  filters,
  extra,
} = {}) {
  const base =
    typeof window !== "undefined"
      ? new URL("/api/admin/analytics/bundle", window.location.origin)
      : new URL("http://localhost/api/admin/analytics/bundle");

  const sp = base.searchParams;

  // window selection
  if (start && end) {
    appendIf(sp, "start", start);
    appendIf(sp, "end", end);
  } else {
    // days fallback (API clamps internally)
    if (days != null) appendIf(sp, "days", String(days));
  }

  // grouping + compare
  appendIf(sp, "group", group || "day");
  if (compare) sp.set("compare", "1");

  // modules: default ALL
  appendIf(sp, "include", include || "all");

  // perf knobs
  if (parallel) sp.set("parallel", "1");
  if (strict) sp.set("strict", "1");

  // tz offset (client minutes, Dhaka default used server-side if omitted)
  if (tzOffsetMinutes != null) appendIf(sp, "tzOffsetMinutes", String(tzOffsetMinutes));

  // filters (additive; server ignores unknowns safely)
  const f = filters && typeof filters === "object" ? filters : {};
  for (const key of Object.keys(f)) appendFilter(sp, key, f[key]);

  // extra knobs (profit/pnl etc.)
  const ex = extra && typeof extra === "object" ? extra : {};
  for (const key of Object.keys(ex)) appendFilter(sp, key, ex[key]);

  return base.toString();
}

export async function loadAnalyticsBundle({
  days,
  start,
  end,
  group = "day",
  compare = false,
  filters = {},
  include = "all",
  parallel = true,
  strict = false,
  tzOffsetMinutes,
  extra,
  signal,
} = {}) {
  // Prefer explicit tzOffsetMinutes, else compute from browser
  let tz = tzOffsetMinutes;
  if (tz == null) {
    try {
      tz = -new Date().getTimezoneOffset(); // minutes east of UTC (Dhaka ~ +360)
    } catch {
      tz = 360;
    }
  }

  const url = buildBundleUrl({
    days,
    start,
    end,
    group,
    compare,
    tzOffsetMinutes: tz,
    include,
    parallel,
    strict,
    filters,
    extra,
  });

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: { "Accept": "application/json" },
      signal,
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json || json.ok === false) {
      return {
        ok: false,
        mode: "advanced",
        error: json?.error || "bundle_failed",
        message: json?.message || `Bundle request failed (${res.status})`,
        meta: json?.meta || null,
        overview: null,
        series: [],
        modules: {},
        raw: json,
      };
    }

    const data = json.data || {};
    const overview = data.overview || null;
    const series = extractSeries(data.timeseries);
    const modules = splitModules(data);

    return {
      ok: true,
      mode: "advanced",
      meta: json.meta || null,
      overview,
      series,
      modules,
      raw: json,
    };
  } catch (e) {
    return {
      ok: false,
      mode: "advanced",
      error: "network_error",
      message: safeStr(e?.message || e) || "Network error",
      meta: null,
      overview: null,
      series: [],
      modules: {},
      raw: null,
    };
  }
}
